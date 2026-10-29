#include <cassert>
#include <cstdio>

#include "autoplay_support.h"
#include "ardia/linux/ac_linux_autoplay.h"

bool (*g_ardia_linux_autoplay_blocked)(content::WebContents* contents) = nullptr;

namespace {

struct Tab {
  Profile profile;
  content::WebContents contents;
  int refreshes = 0;
  explicit Tab(const std::string& url) {
    contents.frame.url = GURL(url);
    contents.context_override = &profile;
  }
};

void BlockedSitesFollowTheirSetting() {
  ardiacore::InstallLinuxAutoplayPolicy();
  Tab tab("https://media.test/");
  ardiacore::FollowLinuxAutoplay(&tab.contents, base::RepeatingCallback<void()>([&tab] { ++tab.refreshes; }));
  ardiacore::FollowLinuxAutoplay(&tab.contents, base::RepeatingCallback<void()>([&tab] { tab.refreshes += 100; }));
  assert(tab.profile.map.observers.size() == 1);
  assert(!g_ardia_linux_autoplay_blocked(&tab.contents));
  tab.profile.map.Set("https://media.test/", ContentSettingsType::AUTOPLAY, CONTENT_SETTING_BLOCK);
  assert(g_ardia_linux_autoplay_blocked(&tab.contents));
  assert(tab.contents.preference_updates == 1 && tab.refreshes == 1);
  tab.profile.map.Set("https://media.test/", ContentSettingsType::AUTOPLAY, CONTENT_SETTING_BLOCK);
  tab.profile.map.Set("https://media.test/", ContentSettingsType::SOUND, CONTENT_SETTING_BLOCK);
  tab.profile.map.Set("https://other.test/", ContentSettingsType::AUTOPLAY, CONTENT_SETTING_BLOCK);
  assert(tab.contents.preference_updates == 1 && tab.refreshes == 1);
  tab.profile.map.Set("https://media.test/", ContentSettingsType::AUTOPLAY, CONTENT_SETTING_ALLOW);
  assert(tab.contents.preference_updates == 2 && tab.refreshes == 2 && !g_ardia_linux_autoplay_blocked(&tab.contents));
  tab.contents.frame.url = GURL("https://other.test/");
  tab.contents.ChangePrimaryPage();
  tab.profile.map.Set("https://other.test/", ContentSettingsType::AUTOPLAY, CONTENT_SETTING_ALLOW);
  assert(tab.contents.preference_updates == 3 && tab.refreshes == 3);
  tab.contents.Destroy();
  assert(tab.profile.map.observers.empty());
}

void OnlyWebPagesAreBlocked() {
  Tab tab("file:///home/me/video.html");
  tab.profile.map.settings[{"file:///home/me/video.html", ContentSettingsType::AUTOPLAY}] = CONTENT_SETTING_BLOCK;
  assert(!g_ardia_linux_autoplay_blocked(&tab.contents));
  ardiacore::FollowLinuxAutoplay(&tab.contents, base::RepeatingCallback<void()>([&tab] { ++tab.refreshes; }));
  tab.profile.map.Set("file:///home/me/video.html", ContentSettingsType::AUTOPLAY, CONTENT_SETTING_BLOCK);
  assert(tab.contents.preference_updates == 0 && tab.refreshes == 0);
}

}

int main() {
  BlockedSitesFollowTheirSetting();
  OnlyWebPagesAreBlocked();
  std::puts("autoplay scenarios passed");
}
