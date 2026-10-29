#ifndef ARDIA_LINUX_AC_LINUX_NAVIGATION_HOLD_H_
#define ARDIA_LINUX_AC_LINUX_NAVIGATION_HOLD_H_

#include <string>

class Profile;

namespace ardia {

void InstallLinuxNavigationHold();
void HoldLinuxNavigations(Profile* profile);
void ReleaseLinuxNavigations(Profile* profile, const std::string& why);
bool LinuxNavigationsHeld(Profile* profile);

}

#endif
