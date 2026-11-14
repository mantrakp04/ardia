#ifndef ARDIA_WIN_EXTERNAL_APPS_H_
#define ARDIA_WIN_EXTERNAL_APPS_H_

#include <string>

namespace content {
class WebContents;
}

namespace ardia_win {

void InstallExternalAppAsks();

bool ExternalAppAlive(content::WebContents* contents, const std::string& id);

}

#endif
