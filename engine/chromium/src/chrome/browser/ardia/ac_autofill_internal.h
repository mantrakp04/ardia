// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_AUTOFILL_INTERNAL_H_
#define CHROME_BROWSER_ARDIA_AC_AUTOFILL_INTERNAL_H_

#include <cstddef>
#include <string>
#include <utility>

#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "components/autofill/core/browser/field_types.h"

class Profile;

namespace autofill {
class PersonalDataManager;
}

#define AC_AUTOFILL_CALL()                           \
  Call call(profile_dir, args_json, reply, context); \
  if (!call) {                                       \
    return;                                          \
  }

namespace ardia {
namespace autofill_internal {

inline constexpr int kSettleChecks = 20;
inline constexpr size_t kMaxImportBytes = 4 * 1024 * 1024;

inline constexpr std::pair<const char*, autofill::FieldType> kAddressFields[] =
    {
        {"name", autofill::NAME_FULL},
        {"organization", autofill::COMPANY_NAME},
        {"street", autofill::ADDRESS_HOME_STREET_ADDRESS},
        {"city", autofill::ADDRESS_HOME_CITY},
        {"state", autofill::ADDRESS_HOME_STATE},
        {"postalCode", autofill::ADDRESS_HOME_ZIP},
        {"country", autofill::ADDRESS_HOME_COUNTRY},
        {"phone", autofill::PHONE_HOME_WHOLE_NUMBER},
        {"email", autofill::EMAIL_ADDRESS},
};

class AutofillState;

std::string Digits(const std::string& text);

void Load(const Call& call,
          base::OnceCallback<void(autofill::PersonalDataManager*, Reply)> then,
          Reply reply);

using Check = base::RepeatingCallback<bool(autofill::PersonalDataManager*)>;

struct Write {
  base::WeakPtr<autofill::PersonalDataManager> pdm;
  base::WeakPtr<AutofillState> state;
  int changes;
};

Write StartWrite(Profile* profile, autofill::PersonalDataManager* pdm);

void Settle(Write write,
            Check landed,
            base::DictValue result,
            Reply reply,
            int checks_left = kSettleChecks);

}
}

#endif
