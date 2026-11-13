#include "ardia/linux/ac_linux_autoplay.h"

#include <utility>

#include "base/memory/raw_ptr.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "components/content_settings/core/browser/content_settings_observer.h"
#include "components/content_settings/core/browser/content_settings_type_set.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/content_settings/core/common/content_settings.h"
#include "components/content_settings/core/common/content_settings_pattern.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/page.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "url/gurl.h"

extern bool (*g_ardia_linux_autoplay_blocked)(content::WebContents* contents);

namespace ardiacore {
namespace {

HostContentSettingsMap* SettingsFor(content::BrowserContext* context) {
  return context ? HostContentSettingsMapFactory::GetForProfile(Profile::FromBrowserContext(context)) : nullptr;
}

class LinuxAutoplayFollower : public content::WebContentsObserver,
                              public content::WebContentsUserData<LinuxAutoplayFollower>,
                              public content_settings::Observer {
 public:
  LinuxAutoplayFollower(const LinuxAutoplayFollower&) = delete;
  LinuxAutoplayFollower& operator=(const LinuxAutoplayFollower&) = delete;
  ~LinuxAutoplayFollower() override { Stop(); }

 private:
  friend class content::WebContentsUserData<LinuxAutoplayFollower>;
  LinuxAutoplayFollower(content::WebContents* contents, base::RepeatingCallback<void()> changed)
      : content::WebContentsObserver(contents),
        content::WebContentsUserData<LinuxAutoplayFollower>(*contents),
        changed_(std::move(changed)),
        settings_(SettingsFor(contents->GetBrowserContext())),
        blocked_(Blocked()) {
    if (settings_) settings_->AddObserver(this);
  }

  bool Blocked() {
    content::WebContents* contents = web_contents();
    return contents && LinuxAutoplayBlocked(contents->GetLastCommittedURL(), contents->GetBrowserContext());
  }

  void OnContentSettingChanged(const ContentSettingsPattern&, const ContentSettingsPattern&,
                               ContentSettingsTypeSet types) override {
    if (!types.Contains(ContentSettingsType::AUTOPLAY) || !web_contents()) return;
    const bool blocked = Blocked();
    if (blocked == blocked_) return;
    blocked_ = blocked;
    web_contents()->OnWebPreferencesChanged();
    changed_.Run();
  }

  void PrimaryPageChanged(content::Page&) override { blocked_ = Blocked(); }

  void WebContentsDestroyed() override { Stop(); }

  void Stop() {
    if (settings_) settings_->RemoveObserver(this);
    settings_ = nullptr;
  }

  base::RepeatingCallback<void()> changed_;
  raw_ptr<HostContentSettingsMap> settings_;
  bool blocked_;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(LinuxAutoplayFollower);

}

bool LinuxAutoplayBlocked(const GURL& url, content::BrowserContext* context) {
  if (!url.SchemeIsHTTPOrHTTPS()) return false;
  HostContentSettingsMap* settings = SettingsFor(context);
  return settings && settings->GetContentSetting(url, url, ContentSettingsType::AUTOPLAY) == CONTENT_SETTING_BLOCK;
}

void InstallLinuxAutoplayPolicy() {
  g_ardia_linux_autoplay_blocked = [](content::WebContents* contents) {
    return contents && LinuxAutoplayBlocked(contents->GetLastCommittedURL(), contents->GetBrowserContext());
  };
}

void FollowLinuxAutoplay(content::WebContents* contents, base::RepeatingCallback<void()> changed) {
  if (!contents || LinuxAutoplayFollower::FromWebContents(contents)) return;
  LinuxAutoplayFollower::CreateForWebContents(contents, std::move(changed));
}

}
