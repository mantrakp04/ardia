#include "ardia/linux/ac_linux_auto_pip_service.h"

#include <vector>

#include "ardia/linux/ac_linux_auto_pip.h"
#include "base/check.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_manager_observer.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/content_settings/core/common/content_settings.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "content/public/browser/browser_thread.h"

namespace ardiacore {
namespace {

class AutoPictureInPictureProfiles : public ProfileManagerObserver {
 public:
  void Set(bool enabled) {
    ProfileManager* manager = g_browser_process ? g_browser_process->profile_manager() : nullptr;
    if (manager && !observation_.IsObserving()) observation_.Observe(manager);
    preference_.Set(enabled, manager ? manager->GetLoadedProfiles() : std::vector<Profile*>());
  }

 private:
  static void Apply(Profile* profile, bool enabled) {
    if (HostContentSettingsMap* map = HostContentSettingsMapFactory::GetForProfile(profile)) {
      map->SetDefaultContentSetting(ContentSettingsType::AUTO_PICTURE_IN_PICTURE,
                                    enabled ? CONTENT_SETTING_ALLOW : CONTENT_SETTING_BLOCK);
    }
  }

  static bool Regular(Profile* profile) {
    return profile->IsRegularProfile() && !profile->ShutdownStarted();
  }

  void OnProfileAdded(Profile* profile) override {
    preference_.Added(profile);
  }

  void OnProfileManagerDestroying() override {
    observation_.Reset();
  }

  linux_auto_pip::Preference<Profile> preference_{&AutoPictureInPictureProfiles::Apply,
                                                   &AutoPictureInPictureProfiles::Regular};
  base::ScopedObservation<ProfileManager, ProfileManagerObserver> observation_{this};
};

}

void SetLinuxAutoPictureInPicture(bool enabled) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  static base::NoDestructor<AutoPictureInPictureProfiles> profiles;
  profiles->Set(enabled);
}

}
