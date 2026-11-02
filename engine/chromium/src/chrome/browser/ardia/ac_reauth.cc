// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_reauth.h"

#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/weak_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "ardia/core/ac_launch_switches.h"
#include "chrome/browser/device_reauth/chrome_device_authenticator_factory.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "components/device_reauth/device_authenticator.h"

namespace ardia {
namespace {

bool TestGrant() {
  return ardiacore::TestValue("reauth") == "granted";
}

const char* Histogram(device_reauth::DeviceAuthSource source) {
  return source == device_reauth::DeviceAuthSource::kPasswordManager
             ? "PasswordManager.ReauthToAccessPasswordInSettings"
             : "Autofill.PaymentMethods.SettingsPage.Reauth";
}

class ReauthState : public ProfileState {
 public:
  explicit ReauthState(Profile* profile) : ProfileState(profile) {}

  void Start(device_reauth::DeviceAuthSource source,
             const std::u16string& purpose,
             base::TimeDelta validity,
             base::OnceCallback<void(bool)> done) {
    base::WeakPtr<ReauthState> self = weak_factory_.GetWeakPtr();
    const int generation = ++generation_;
    while (authenticator_) {
      std::unique_ptr<device_reauth::DeviceAuthenticator> older =
          std::move(authenticator_);
      older->Cancel();
      older.reset();
      if (!self) {
        return;
      }
      if (generation_ != generation) {
        std::move(done).Run(false);
        return;
      }
    }
    authenticator_ = ChromeDeviceAuthenticatorFactory::GetForProfile(
        profile(), device_reauth::DeviceAuthParams(validity, source,
                                                   Histogram(source)));
    authenticator_->AuthenticateWithMessage(
        purpose, base::BindOnce(&ReauthState::Done, self, generation,
                                std::move(done)));
  }

 private:
  void Release() override {
    weak_factory_.InvalidateWeakPtrs();
    authenticator_.reset();
  }

  void Done(int generation,
            base::OnceCallback<void(bool)> done,
            bool authenticated) {
    if (generation == generation_) {
      authenticator_.reset();
    }
    std::move(done).Run(authenticated);
  }

  std::unique_ptr<device_reauth::DeviceAuthenticator> authenticator_;
  int generation_ = 0;
  base::WeakPtrFactory<ReauthState> weak_factory_{this};
};

}

void Reauth(Profile* profile,
            device_reauth::DeviceAuthSource source,
            const std::u16string& purpose,
            base::TimeDelta validity,
            base::OnceCallback<void(bool)> done) {
  if (ardiacore::BackgroundInstance()) {
    const bool granted = TestGrant();
    LOG(WARNING) << "[ardia] OS reauth (" << purpose
                 << ") in a hidden test instance, no prompt: "
                 << (granted ? "granted" : "denied");
    Emit("reauth.requested", profile,
         base::DictValue().Set("purpose", purpose).Set("granted", granted));
    std::move(done).Run(granted);
    return;
  }
  StateFor<ReauthState>(profile).Start(source, purpose, validity,
                                       std::move(done));
}

}
