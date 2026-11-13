#ifndef ARDIA_LINUX_AC_LINUX_WEB_STORE_H_
#define ARDIA_LINUX_AC_LINUX_WEB_STORE_H_

#include "base/functional/callback.h"
#include "base/values.h"

namespace content {
class WebContents;
}

namespace ardiacore {

void InstallLinuxWebStore(base::RepeatingCallback<bool(content::WebContents*)> holds_tab,
                          base::RepeatingCallback<bool(content::WebContents*)> confirming);
void LinuxWebStoreRequest(content::WebContents* contents, base::OnceCallback<void(bool, base::Value)> done);

}

#endif
