// Copyright 2026 Ardia. Apache-2.0.

#include <cmath>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/uuid.h"
#include "chrome/browser/ardia/ac_autofill.h"
#include "chrome/browser/ardia/ac_autofill_internal.h"
#include "chrome/browser/ardia/ac_sensitive_args.h"
#include "components/autofill/core/browser/data_manager/addresses/address_data_manager.h"
#include "components/autofill/core/browser/data_manager/payments/payments_data_manager.h"
#include "components/autofill/core/browser/data_manager/personal_data_manager.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_i18n_api.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_profile.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_profile_comparator.h"
#include "components/autofill/core/browser/data_model/payments/credit_card.h"

namespace ardia {
namespace autofill_internal {
namespace {

using autofill::PersonalDataManager;

constexpr size_t kMaxImportItems = 1000;

struct ImportedAddress {
  std::vector<std::pair<autofill::FieldType, std::u16string>> fields;
  std::string country;
};

struct ImportBatch {
  std::vector<ImportedAddress> addresses;
  std::vector<autofill::CreditCard> cards;
  int rejected = 0;
};

std::optional<int> IntArg(const base::DictValue& dict, std::string_view key) {
  if (std::optional<int> value = dict.FindInt(key)) {
    return value;
  }
  if (std::optional<double> value = dict.FindDouble(key);
      value && std::isfinite(*value) && std::abs(*value) < 1e6) {
    return static_cast<int>(*value);
  }
  int value = 0;
  const std::string* text = dict.FindString(key);
  if (text && base::StringToInt(*text, &value)) {
    return value;
  }
  return std::nullopt;
}

bool PassesLuhn(const std::string& digits) {
  int sum = 0;
  bool twice = false;
  for (size_t i = digits.size(); i-- > 0;) {
    int digit = digits[i] - '0';
    if (twice) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    twice = !twice;
  }
  return sum % 10 == 0;
}

std::optional<ImportedAddress> ToAddress(const base::Value& entry) {
  const base::DictValue* dict = entry.GetIfDict();
  if (!dict) {
    return std::nullopt;
  }
  ImportedAddress address;
  for (const auto& [key, type] : kAddressFields) {
    const std::string* value = dict->FindString(key);
    if (!value) {
      continue;
    }
    std::u16string trimmed;
    base::TrimWhitespace(base::UTF8ToUTF16(*value), base::TRIM_ALL, &trimmed);
    if (!trimmed.empty()) {
      address.fields.emplace_back(type, std::move(trimmed));
    }
  }
  if (address.fields.empty()) {
    return std::nullopt;
  }
  if (const std::string* country = dict->FindString("country")) {
    address.country = base::ToUpperASCII(*country);
  }
  return address;
}

std::optional<autofill::CreditCard> ToCard(const base::Value& entry) {
  const base::DictValue* dict = entry.GetIfDict();
  if (!dict) {
    return std::nullopt;
  }
  const std::string* number = dict->FindString("number");
  if (!number) {
    return std::nullopt;
  }
  std::string digits;
  digits.reserve(number->size());
  bool clean = true;
  for (char c : *number) {
    if (base::IsAsciiDigit(c)) {
      digits.push_back(c);
    } else if (c != ' ' && c != '-') {
      clean = false;
    }
  }
  const bool valid =
      clean && digits.size() >= 12 && digits.size() <= 19 && PassesLuhn(digits);
  std::optional<int> month = IntArg(*dict, "expMonth");
  std::optional<int> year = IntArg(*dict, "expYear");
  if (year && *year > 0 && *year < 100) {
    *year += 2000;
  }
  const bool valid_expiry =
      (!month || *month == 0 || (*month >= 1 && *month <= 12)) &&
      (!year || *year == 0 || (*year >= 1900 && *year <= 2199));
  if (!valid || !valid_expiry) {
    Cleanse(digits);
    return std::nullopt;
  }

  autofill::CreditCard card(base::Uuid::GenerateRandomV4().AsLowercaseString());
  card.set_is_user_confirmed(true);
  std::u16string number16 = base::ASCIIToUTF16(digits);
  card.SetRawInfo(autofill::CREDIT_CARD_NUMBER, number16);
  Cleanse(number16);
  Cleanse(digits);
  if (const std::string* name = dict->FindString("name")) {
    card.SetRawInfo(autofill::CREDIT_CARD_NAME_FULL, base::UTF8ToUTF16(*name));
  }
  if (month && *month > 0) {
    card.SetExpirationMonth(*month);
  }
  if (year && *year > 0) {
    card.SetExpirationYear(*year);
  }
  if (const std::string* nickname = dict->FindString("nickname");
      nickname && !nickname->empty()) {
    card.SetNickname(base::UTF8ToUTF16(*nickname));
  }
  return card;
}

void ImportLoaded(ImportBatch batch, PersonalDataManager* pdm, Reply reply) {
  autofill::AddressDataManager& adm = pdm->address_data_manager();
  autofill::PaymentsDataManager& paydm = pdm->payments_data_manager();
  autofill::AutofillProfileComparator comparator(adm.app_locale());
  int existing = 0;
  int rejected = batch.rejected;

  std::vector<autofill::AutofillProfile> added_addresses;
  for (const ImportedAddress& address : batch.addresses) {
    autofill::AutofillProfile profile(
        adm.IsEligibleForAddressAccountStorage()
            ? autofill::AutofillProfile::RecordType::kAccount
            : autofill::AutofillProfile::RecordType::kLocalOrSyncable,
        !address.country.empty()
            ? autofill::AddressCountryCode(address.country)
            : autofill::i18n_model_definition::kLegacyHierarchyCountryCode);
    for (const auto& [type, value] : address.fields) {
      profile.SetRawInfoWithVerificationStatus(
          type, value, autofill::VerificationStatus::kUserVerified);
    }
    profile.FinalizeAfterImport();
    if (profile.IsEmpty(adm.app_locale())) {
      ++rejected;
      continue;
    }
    bool present = false;
    for (const autofill::AutofillProfile* other : adm.GetProfiles()) {
      present = present || profile.IsSubsetOf(comparator, *other);
    }
    for (const autofill::AutofillProfile& other : added_addresses) {
      present = present || profile.IsSubsetOf(comparator, other);
    }
    if (present) {
      ++existing;
      continue;
    }
    adm.AddProfile(profile);
    added_addresses.push_back(std::move(profile));
  }

  std::vector<const autofill::CreditCard*> added_cards;
  for (const autofill::CreditCard& card : batch.cards) {
    bool present = false;
    for (const autofill::CreditCard* other : paydm.GetCreditCards()) {
      present = present || card.HasSameNumberAs(*other);
    }
    for (const autofill::CreditCard* other : added_cards) {
      present = present || card.HasSameNumberAs(*other);
    }
    if (present) {
      ++existing;
      continue;
    }
    paydm.AddCreditCard(card);
    added_cards.push_back(&card);
  }

  reply.Send(base::DictValue()
                 .Set("addresses", static_cast<int>(added_addresses.size()))
                 .Set("cards", static_cast<int>(added_cards.size()))
                 .Set("existing", existing)
                 .Set("rejected", rejected));
}

}
}
}

using ardia::Call;

AC_ENGINE_CALL(ac_autofill_import) {
  Call call(profile_dir, nullptr, reply, context);
  if (!call) {
    return;
  }
  if (call.profile()->IsOffTheRecord()) {
    return call.TakeReply().Error("private profile");
  }
  ardia::autofill_internal::ImportBatch batch;
  {
    ardia::SensitiveArgs args(args_json,
                              ardia::autofill_internal::kMaxImportBytes);
    if (args.too_large()) {
      return call.TakeReply().Error("arguments too large");
    }
    if (!args.dict()) {
      return call.TakeReply().Error("arguments are not a JSON object");
    }
    if (args.dict()->FindBool("offTheRecord").value_or(false)) {
      return call.TakeReply().Error("not for a private session");
    }
    const base::ListValue* addresses = args.dict()->FindList("addresses");
    const base::ListValue* cards = args.dict()->FindList("cards");
    if ((addresses &&
         addresses->size() > ardia::autofill_internal::kMaxImportItems) ||
        (cards && cards->size() > ardia::autofill_internal::kMaxImportItems)) {
      return call.TakeReply().Error("too many items in one call");
    }
    if (addresses) {
      for (const base::Value& entry : *addresses) {
        if (std::optional<ardia::autofill_internal::ImportedAddress> address =
                ardia::autofill_internal::ToAddress(entry)) {
          batch.addresses.push_back(std::move(*address));
        } else {
          ++batch.rejected;
        }
      }
    }
    if (cards) {
      for (const base::Value& entry : *cards) {
        if (std::optional<autofill::CreditCard> card =
                ardia::autofill_internal::ToCard(entry)) {
          batch.cards.push_back(std::move(*card));
        } else {
          ++batch.rejected;
        }
      }
    }
  }
  ardia::autofill_internal::Load(
      call,
      base::BindOnce(&ardia::autofill_internal::ImportLoaded, std::move(batch)),
      call.TakeReply());
}
