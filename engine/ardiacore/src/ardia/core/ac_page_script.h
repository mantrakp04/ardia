#ifndef ARDIA_CORE_AC_PAGE_SCRIPT_H_
#define ARDIA_CORE_AC_PAGE_SCRIPT_H_

#include <string>

namespace content {
class RenderProcessHost;
}

namespace ardiacore {

void SetPageScript(const std::string& script);
const std::string& GetPageScript();
void SendPageScript(content::RenderProcessHost* host);

}

#endif
