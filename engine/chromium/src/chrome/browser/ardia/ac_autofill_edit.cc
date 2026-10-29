// Copyright 2026 Ardia. Apache-2.0.

#include <optional>
#include <string>
#include <utility>

#include "base/functional/bind.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/uuid.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/ardia/ac_autofill_internal.h"
#include "chrome/browser/ardia/ac_sensitive_args.h"
#include "components/autofill/core/browser/data_manager/addresses/address_data_manager.h"
#include "components/autofill/core/browser/data_manager/payments/payments_data_manager.h"
#include "components/autofill/core/browser/data_manager/personal_data_manager.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_i18n_api.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_profile.h"
#include "components/autofill/core/browser/data_model/payments/credit_card.h"

using ardia::Call;
using ardia::Reply;
using autofill::PersonalDataManager;

AC_PROFILE_CALL(ac_autofill_save_address) {
  const base::DictValue* address = call.args().FindDict("address");
  if (!address) {
    return call.TakeReply().Error("address required");
  }
  ardia::autofill_internal::Load(
      call,
      base::BindOnce(
          [](Profile* owner, base::DictValue address, PersonalDataManager* pdm,
             Reply reply) {
            autofill::AddressDataManager& adm = pdm->address_data_manager();
            const std::string* id = address.FindString("id");
            const autofill::AutofillProfile* existing =
                id && !id->empty() ? adm.GetProfileByGUID(*id) : nullptr;
            if (id && !id->empty() && !existing) {
              return reply.Error("No such address");
            }
            const std::string* country = address.FindString("country");
            autofill::AutofillProfile profile =
                existing
                    ? *existing
                    : autofill::AutofillProfile(
                          adm.IsEligibleForAddressAccountStorage()
                              ? autofill::AutofillProfile::RecordType::kAccount
                              : autofill::AutofillProfile::RecordType::
                                    kLocalOrSyncable,
                          country && !country->empty()
                              ? autofill::AddressCountryCode(*country)
                              : autofill::i18n_model_definition::
                                    kLegacyHierarchyCountryCode);
            for (const auto& [key, type] :
                 ardia::autofill_internal::kAddressFields) {
              const std::string* value = address.FindString(key);
              std::u16string trimmed;
              base::TrimWhitespace(base::UTF8ToUTF16(value ? *value : ""),
                                   base::TRIM_ALL, &trimmed);
              profile.SetRawInfoWithVerificationStatus(
                  type, trimmed, autofill::VerificationStatus::kUserVerified);
            }
            profile.FinalizeAfterImport();
            const std::string guid = profile.guid();
            if (existing && existing->Compare(profile) == 0) {
              return reply.Send(base::DictValue().Set("id", guid));
            }
            ardia::autofill_internal::Write write =
                ardia::autofill_internal::StartWrite(owner, pdm);
            if (existing) {
              adm.UpdateProfile(profile);
            } else {
              adm.AddProfile(profile);
            }
            ardia::autofill_internal::Settle(
                write,
                base::BindRepeating(
                    [](const autofill::AutofillProfile& wanted,
                       PersonalDataManager* pdm) {
                      const autofill::AutofillProfile* saved =
                          pdm->address_data_manager().GetProfileByGUID(
                              wanted.guid());
                      return saved && saved->Compare(wanted) == 0;
                    },
                    profile),
                base::DictValue().Set("id", guid), std::move(reply));
          },
          call.profile(), address->Clone()),
      call.TakeReply());
}

AC_PROFILE_CALL(ac_autofill_save_card,
                ardia::Sensitive{ardia::autofill_internal::kMaxImportBytes}) {
  const base::DictValue* card = call.args().FindDict("card");
  if (!card) {
    return call.TakeReply().Error("card required");
  }
  std::optional<ardia::Secret> number = call.SecretAt("number");
  if (!number) {
    return call.TakeReply().Error("bad arguments");
  }
  ardia::autofill_internal::Load(
      call,
      base::BindOnce(
          [](Profile* owner, base::DictValue card, ardia::Secret number,
             PersonalDataManager* pdm, Reply reply) {
            autofill::PaymentsDataManager& paydm = pdm->payments_data_manager();
            const std::string* id = card.FindString("id");
            const autofill::CreditCard* existing =
                id && !id->empty() ? paydm.GetCreditCardByGUID(*id) : nullptr;
            if (id && !id->empty() && !existing) {
              return reply.Error("No such card");
            }
            const ardia::Secret digits(
                ardia::autofill_internal::Digits(number.value()));
            if (!existing &&
                (digits.value().size() < 12 || digits.value().size() > 19)) {
              return reply.Error("invalid number");
            }
            autofill::CreditCard credit_card =
                existing
                    ? *existing
                    : autofill::CreditCard(
                          base::Uuid::GenerateRandomV4().AsLowercaseString());
            if (!existing) {
              credit_card.set_is_user_confirmed(true);
            }
            if (const std::string* name = card.FindString("name")) {
              credit_card.SetRawInfo(autofill::CREDIT_CARD_NAME_FULL,
                                     base::UTF8ToUTF16(*name));
            }
            if (!digits.value().empty()) {
              std::u16string digits16 = base::UTF8ToUTF16(digits.value());
              credit_card.SetRawInfo(autofill::CREDIT_CARD_NUMBER, digits16);
              ardia::Cleanse(digits16);
            }
            if (std::optional<int> month = card.FindInt("expMonth");
                month && *month > 0) {
              credit_card.SetRawInfo(
                  autofill::CREDIT_CARD_EXP_MONTH,
                  base::UTF8ToUTF16((*month < 10 ? "0" : "") +
                                    base::NumberToString(*month)));
            }
            if (std::optional<int> year = card.FindInt("expYear");
                year && *year > 0) {
              credit_card.SetRawInfo(autofill::CREDIT_CARD_EXP_4_DIGIT_YEAR,
                                     base::NumberToString16(*year));
            }
            const std::string guid = credit_card.guid();
            if (existing && existing->Compare(credit_card) == 0) {
              return reply.Send(base::DictValue().Set("id", guid));
            }
            ardia::autofill_internal::Write write =
                ardia::autofill_internal::StartWrite(owner, pdm);
            if (existing) {
              paydm.UpdateCreditCard(credit_card);
            } else {
              paydm.AddCreditCard(credit_card);
            }
            ardia::autofill_internal::Settle(
                write,
                base::BindRepeating(
                    [](const autofill::CreditCard& wanted,
                       PersonalDataManager* pdm) {
                      const autofill::CreditCard* saved =
                          pdm->payments_data_manager().GetCreditCardByGUID(
                              wanted.guid());
                      return saved && saved->Compare(wanted) == 0;
                    },
                    credit_card),
                base::DictValue().Set("id", guid), std::move(reply));
          },
          call.profile(), card->Clone(), std::move(*number)),
      call.TakeReply());
}

AC_PROFILE_CALL(ac_autofill_remove) {
  ardia::autofill_internal::Load(
      call,
      base::BindOnce(
          [](Profile* owner, std::string id, PersonalDataManager* pdm,
             Reply reply) {
            const bool address =
                !!pdm->address_data_manager().GetProfileByGUID(id);
            if (!address &&
                !pdm->payments_data_manager().GetCreditCardByGUID(id)) {
              return reply.Ok();
            }
            ardia::autofill_internal::Write write =
                ardia::autofill_internal::StartWrite(owner, pdm);
            if (address) {
              pdm->address_data_manager().RemoveProfile(id);
            } else {
              pdm->payments_data_manager().RemoveByGUID(id);
            }
            ardia::autofill_internal::Settle(
                write,
                base::BindRepeating(
                    [](const std::string& id, PersonalDataManager* pdm) {
                      return !pdm->address_data_manager().GetProfileByGUID(
                                 id) &&
                             !pdm->payments_data_manager().GetCreditCardByGUID(
                                 id);
                    },
                    id),
                base::DictValue().Set("ok", true), std::move(reply));
          },
          call.profile(), call.String("id")),
      call.TakeReply());
}
