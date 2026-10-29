#ifndef ARDIA_CORE_AC_LIFETIME_H_
#define ARDIA_CORE_AC_LIFETIME_H_

namespace ardiacore {

void InstallAppOverrides();

void StartLifetimeObservers();

void QuitEngine();
bool IsQuitting();

void HostQuitCancelled();

}

#endif
