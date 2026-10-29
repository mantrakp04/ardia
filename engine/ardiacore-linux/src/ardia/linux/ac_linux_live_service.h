#ifndef ARDIA_LINUX_AC_LINUX_LIVE_SERVICE_H_
#define ARDIA_LINUX_AC_LINUX_LIVE_SERVICE_H_

#include <string>
#include <string_view>

#include "base/functional/callback.h"
#include "base/values.h"

class Profile;

namespace ardia {

struct LinuxLiveCaller {
  std::string key;
  bool private_window = false;
};

bool LinuxLiveInvokes(std::string_view method);
void AppendLinuxLiveCapabilities(base::ListValue& capabilities);
void LinuxLiveInvoke(const LinuxLiveCaller& caller, Profile* app_profile, const std::string& method,
                     const base::ListValue& values, base::OnceCallback<void(bool, base::Value)> done);
void LinuxLiveCallerGone(const std::string& key);

}

#endif
