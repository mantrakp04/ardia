#ifndef ARDIA_CORE_AC_BROWSER_INTERNAL_H_
#define ARDIA_CORE_AC_BROWSER_INTERNAL_H_

#include <vector>

namespace ardiacore {

class WindowHost;

std::vector<WindowHost*>& Hosts();

extern int g_tab_strip_notifying;
extern int g_navigation_notifying;

}

#endif
