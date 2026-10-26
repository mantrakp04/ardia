// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_autofill.h"

#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/ardia/ac_autofill_internal.h"
#include "chrome/browser/ardia/ac_reauth.h"
#include "chrome/browser/autofill/personal_data_manager_factory.h"
#include "components/autofill/core/browser/data_manager/addresses/address_data_manager.h"
#include "components/autofill/core/browser/data_manager/payments/payments_data_manager.h"
#include "components/autofill/core/browser/data_manager/personal_data_manager.h"
#include "components/autofill/core/browser/data_manager/personal_data_manager_observer.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_profile.h"
#include "components/autofill/core/browser/data_model/payments/credit_card.h"
#include "components/autofill/core/common/credit_card_network_identifiers.h"
#include "components/strings/grit/components_strings.h"
#include "ui/base/l10n/l10n_util.h"

namespace ardia {
namespace autofill_internal {
namespace {

using autofill::PersonalDataManager;

constexpr base::TimeDelta kSettleStep = base::Milliseconds(50);

const char* NetworkName(const std::string& network) {
  static constexpr std::pair<const char*, const char*> kNetworks[] = {
      {autofill::kVisaCard, "visa"},
      {autofill::kMasterCard, "mastercard"},
      {autofill::kAmericanExpressCard, "amex"},
      {autofill::kDiscoverCard, "discover"},
      {autofill::kDinersCard, "diners"},
      {autofill::kJCBCard, "jcb"},
      {autofill::kUnionPay, "unionpay"},
  };
  for (const auto& [id, name] : kNetworks) {
    if (network == id) {
      return name;
    }
  }
  return "card";
}

base::DictValue AddressEntry(const autofill::AutofillProfile& profile) {
  base::DictValue entry;
  entry.Set("id", profile.guid());
  for (const auto& [key, type] : kAddressFields) {
    std::u16string value = profile.GetRawInfo(type);
    if (!value.empty()) {
      entry.Set(key, value);
    }
  }
  return entry;
}

base::DictValue CardEntry(const autofill::CreditCard& card) {
  base::DictValue entry;
  entry.Set("id", card.guid());
  std::u16string name = card.GetRawInfo(autofill::CREDIT_CARD_NAME_FULL);
  if (!name.empty()) {
    entry.Set("name", name);
  }
  entry.Set("network", NetworkName(card.network()));
  entry.Set("last4", card.LastFourDigits());
  if (card.expiration_month()) {
    entry.Set("expMonth", card.expiration_month());
  }
  if (card.expiration_year()) {
    entry.Set("expYear", card.expiration_year());
  }
  return entry;
}

using Ready = base::OnceCallback<void(PersonalDataManager*)>;

}

std::string Digits(const std::string& text) {
  std::string digits;
  for (char c : text) {
    if (base::IsAsciiDigit(c)) {
      digits.push_back(c);
    }
  }
  return digits;
}

class AutofillState : public ProfileState,
                      public autofill::PersonalDataManagerObserver {
 public:
  explicit AutofillState(Profile* profile) : ProfileState(profile) {}

  void WhenLoaded(PersonalDataManager* pdm, Ready ready) {
    if (!observation_.IsObserving()) {
      observation_.Observe(pdm);
    }
    if (pdm->IsDataLoaded()) {
      return std::move(ready).Run(pdm);
    }
    waiting_.push_back(std::move(ready));
  }

  int changes() const { return changes_; }
  base::WeakPtr<AutofillState> GetWeakPtr() {
    return weak_factory_.GetWeakPtr();
  }

 private:
  void Release() override {
    weak_factory_.InvalidateWeakPtrs();
    observation_.Reset();
    waiting_.clear();
  }

  void OnPersonalDataChanged() override {
    ++changes_;
    PersonalDataManager* pdm = observation_.GetSource();
    if (!pdm->IsDataLoaded()) {
      return;
    }
    for (Ready& ready : std::exchange(waiting_, {})) {
      std::move(ready).Run(pdm);
    }
  }

  base::ScopedObservation<PersonalDataManager,
                          autofill::PersonalDataManagerObserver>
      observation_{this};
  std::vector<Ready> waiting_;
  int changes_ = 0;
  base::WeakPtrFactory<AutofillState> weak_factory_{this};
};

void Load(const Call& call,
          base::OnceCallback<void(PersonalDataManager*, Reply)> then,
          Reply reply) {
  PersonalDataManager* pdm =
      autofill::PersonalDataManagerFactory::GetForBrowserContext(
          call.profile());
  if (!pdm) {
    return reply.Error("no autofill in this profile");
  }
  StateFor<AutofillState>(call.profile())
      .WhenLoaded(
          pdm,
          base::BindOnce(
              [](base::OnceCallback<void(PersonalDataManager*, Reply)> then,
                 Reply reply, PersonalDataManager* pdm) {
                std::move(then).Run(pdm, std::move(reply));
              },
              std::move(then), std::move(reply)));
}

Write StartWrite(Profile* profile, PersonalDataManager* pdm) {
  AutofillState& state = StateFor<AutofillState>(profile);
  return {pdm->GetWeakPtr(), state.GetWeakPtr(), state.changes()};
}

void Settle(Write write,
            Check landed,
            base::DictValue result,
            Reply reply,
            int checks_left) {
  if (!write.pdm || !write.state) {
    return reply.Error("closed");
  }
  if (write.state->changes() > write.changes && landed.Run(write.pdm.get())) {
    return reply.Send(std::move(result));
  }
  if (checks_left <= 1) {
    return reply.Error("Chrome didn't save the change");
  }
  base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(&Settle, write, landed, std::move(result),
                     std::move(reply), checks_left - 1),
      kSettleStep);
}

}
}

using ardia::Call;
using ardia::Reply;
using autofill::PersonalDataManager;

AC_ENGINE_CALL(ac_autofill_addresses) {
  AC_AUTOFILL_CALL();
  ardia::autofill_internal::Load(
      call, base::BindOnce([](PersonalDataManager* pdm, Reply reply) {
        base::ListValue list;
        for (const autofill::AutofillProfile* profile :
             pdm->address_data_manager().GetProfilesForSettings()) {
          list.Append(ardia::autofill_internal::AddressEntry(*profile));
        }
        reply.Send(base::DictValue().Set("addresses", std::move(list)));
      }),
      call.TakeReply());
}

AC_ENGINE_CALL(ac_autofill_cards) {
  AC_AUTOFILL_CALL();
  ardia::autofill_internal::Load(
      call, base::BindOnce([](PersonalDataManager* pdm, Reply reply) {
        base::ListValue list;
        for (const autofill::CreditCard* card :
             pdm->payments_data_manager().GetCreditCards()) {
          list.Append(ardia::autofill_internal::CardEntry(*card));
        }
        reply.Send(base::DictValue().Set("cards", std::move(list)));
      }),
      call.TakeReply());
}

AC_ENGINE_CALL(ac_autofill_card_number) {
  AC_AUTOFILL_CALL();
  ardia::autofill_internal::Load(
      call,
      base::BindOnce(
          [](Profile* profile, std::string id, PersonalDataManager* pdm,
             Reply reply) {
            if (!pdm->payments_data_manager().GetCreditCardByGUID(id)) {
              return reply.Send(base::DictValue().Set("number", base::Value()));
            }
            ardia::Reauth(
                profile, device_reauth::DeviceAuthSource::kAutofill,
                l10n_util::GetStringUTF16(
                    IDS_PAYMENTS_AUTOFILL_EDIT_CARD_MANDATORY_REAUTH_PROMPT),
                base::TimeDelta(),
                base::BindOnce(
                    [](std::string id, base::WeakPtr<PersonalDataManager> pdm,
                       Reply reply, bool authenticated) {
                      const autofill::CreditCard* card =
                          authenticated && pdm ? pdm->payments_data_manager()
                                                     .GetCreditCardByGUID(id)
                                               : nullptr;
                      std::string number =
                          card ? ardia::autofill_internal::Digits(
                                     base::UTF16ToUTF8(card->GetRawInfo(
                                         autofill::CREDIT_CARD_NUMBER)))
                               : std::string();
                      base::DictValue result;
                      if (number.empty()) {
                        result.Set("number", base::Value());
                      } else {
                        result.Set("number", number);
                      }
                      result.Set("authenticated", authenticated);
                      reply.Send(std::move(result));
                    },
                    id, pdm->GetWeakPtr(), std::move(reply)));
          },
          call.profile(), call.String("id")),
      call.TakeReply());
}
