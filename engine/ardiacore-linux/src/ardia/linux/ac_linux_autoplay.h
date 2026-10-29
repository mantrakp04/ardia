#ifndef ARDIA_LINUX_AC_LINUX_AUTOPLAY_H_
#define ARDIA_LINUX_AC_LINUX_AUTOPLAY_H_

#include "base/functional/callback.h"

class GURL;

namespace content {
class BrowserContext;
class WebContents;
}

namespace ardiacore {

bool LinuxAutoplayBlocked(const GURL& url, content::BrowserContext* context);
void InstallLinuxAutoplayPolicy();
void FollowLinuxAutoplay(content::WebContents* contents, base::RepeatingCallback<void()> changed);

}

#endif
