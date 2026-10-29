#ifndef ARDIA_TESTS_AUTOPLAY_SUPPORT_H_
#define ARDIA_TESTS_AUTOPLAY_SUPPORT_H_

#include <set>

#include "web_store_support.h"

enum class ContentSettingsType { AUTOPLAY, SOUND };
enum ContentSetting { CONTENT_SETTING_DEFAULT, CONTENT_SETTING_ALLOW, CONTENT_SETTING_BLOCK };

class ContentSettingsPattern {};

class ContentSettingsTypeSet {
 public:
  explicit ContentSettingsTypeSet(ContentSettingsType type) : type_(type) {}
  bool Contains(ContentSettingsType type) const { return type == type_; }

 private:
  ContentSettingsType type_;
};

namespace content_settings {
class Observer {
 public:
  virtual ~Observer() = default;
  virtual void OnContentSettingChanged(const ContentSettingsPattern&, const ContentSettingsPattern&, ContentSettingsTypeSet) {}
};
}

class HostContentSettingsMap {
 public:
  ContentSetting GetContentSetting(const GURL& primary, const GURL&, ContentSettingsType type) const {
    auto found = settings.find({primary.spec(), type});
    return found == settings.end() ? CONTENT_SETTING_ALLOW : found->second;
  }
  void AddObserver(content_settings::Observer* observer) { observers.push_back(observer); }
  void RemoveObserver(content_settings::Observer* observer) { std::erase(observers, observer); }
  void Set(const std::string& url, ContentSettingsType type, ContentSetting value) {
    settings[{url, type}] = value;
    for (auto* observer : std::vector<content_settings::Observer*>(observers))
      observer->OnContentSettingChanged(ContentSettingsPattern(), ContentSettingsPattern(), ContentSettingsTypeSet(type));
  }
  std::map<std::pair<std::string, ContentSettingsType>, ContentSetting> settings;
  std::vector<content_settings::Observer*> observers;
};

class Profile : public content::BrowserContext {
 public:
  static Profile* FromBrowserContext(content::BrowserContext* context) { return static_cast<Profile*>(context); }
  HostContentSettingsMap map;
};

class HostContentSettingsMapFactory {
 public:
  static HostContentSettingsMap* GetForProfile(Profile* profile) { return profile ? &profile->map : nullptr; }
};

namespace content {
class WebContents;
}

#endif
