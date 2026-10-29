#ifndef ARDIA_LINUX_AC_LINUX_PROFILE_SERVICE_H_
#define ARDIA_LINUX_AC_LINUX_PROFILE_SERVICE_H_

#include <optional>
#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_profiles.h"
#include "base/functional/callback.h"

class Profile;

namespace ardiacore {

using LinuxProfileDone = base::OnceCallback<void(Profile*, linux_profiles::ProfileError)>;

bool SetLinuxAppProfile(Profile* profile);
Profile* LinuxProfile(std::string_view id);
bool LinuxProfileHosts(std::string_view id, const Profile* window_profile);
void ResolveLinuxProfile(std::string_view id, LinuxProfileDone done);
std::optional<std::string> LinuxProfileName(const Profile* profile);
std::optional<std::string> LinuxProfileNameForPath(std::string_view path);
bool ReleaseLinuxProfile(std::string_view id);

}

#endif
