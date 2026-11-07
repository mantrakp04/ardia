#ifndef ARDIA_LINUX_AC_LINUX_FAVICONS_H_
#define ARDIA_LINUX_AC_LINUX_FAVICONS_H_

#include "base/functional/callback.h"
#include "base/values.h"

class GURL;
class Profile;
class SkBitmap;
namespace content { class WebContents; }

namespace ardiacore {

using LinuxFaviconReply = base::OnceCallback<void(base::Value)>;

base::Value LinuxFaviconImage(const SkBitmap& bitmap);
bool LinuxFaviconPublicURL(const GURL& url);

void DownloadLinuxFavicon(content::WebContents* contents, const GURL& url,
                          base::RepeatingCallback<bool()> current, LinuxFaviconReply reply);

void FetchLinuxFavicon(Profile* profile, const GURL& url, LinuxFaviconReply reply);

}

#endif
