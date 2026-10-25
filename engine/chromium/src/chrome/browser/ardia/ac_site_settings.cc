// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_site_settings.h"

#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>

#include "base/containers/flat_set.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_remover_constants.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "components/content_settings/core/browser/content_settings_info.h"
#include "components/content_settings/core/browser/content_settings_observer.h"
#include "components/content_settings/core/browser/content_settings_registry.h"
#include "components/content_settings/core/browser/content_settings_type_set.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/content_settings/core/common/content_settings.h"
#include "components/content_settings/core/common/content_settings_pattern.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "content/public/browser/browsing_data_filter_builder.h"
#include "content/public/browser/browsing_data_remover.h"
#include "content/public/browser/storage_partition.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
#include "net/base/schemeful_site.h"
#include "net/cookies/cookie_partition_key.h"
#include "net/cookies/cookie_partition_key_collection.h"
#include "services/network/public/mojom/cookie_manager.mojom.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace ardia {
namespace {

struct SettingType {
  const char* name;
  ContentSettingsType type;
};

constexpr SettingType kTypes[] = {
    {"popups", ContentSettingsType::POPUPS},
    {"camera", ContentSettingsType::MEDIASTREAM_CAMERA},
    {"microphone", ContentSettingsType::MEDIASTREAM_MIC},
    {"location", ContentSettingsType::GEOLOCATION},
    {"notifications", ContentSettingsType::NOTIFICATIONS},
    {"sound", ContentSettingsType::SOUND},
    {"autoplay", ContentSettingsType::AUTOPLAY},
    {"javascript", ContentSettingsType::JAVASCRIPT},
    {"images", ContentSettingsType::IMAGES},
    {"clipboard", ContentSettingsType::CLIPBOARD_READ_WRITE},
    {"automaticDownloads", ContentSettingsType::AUTOMATIC_DOWNLOADS},
    {"cookies", ContentSettingsType::COOKIES},
    {"midi", ContentSettingsType::MIDI_SYSEX},
    {"sensors", ContentSettingsType::SENSORS},
    {"windowManagement", ContentSettingsType::WINDOW_MANAGEMENT},
    {"localFonts", ContentSettingsType::LOCAL_FONTS},
    {"idleDetection", ContentSettingsType::IDLE_DETECTION},
    {"storageAccess", ContentSettingsType::STORAGE_ACCESS},
    {"fileSystem", ContentSettingsType::FILE_SYSTEM_WRITE_GUARD},
    {"keyboardLock", ContentSettingsType::KEYBOARD_LOCK},
    {"pointerLock", ContentSettingsType::POINTER_LOCK},
    {"cameraPanTiltZoom", ContentSettingsType::CAMERA_PAN_TILT_ZOOM},
};

const SettingType* TypeNamed(std::string_view name) {
  for (const SettingType& type : kTypes) {
    if (name == type.name) {
      return &type;
    }
  }
  return nullptr;
}

const char* NameOf(ContentSettingsType type) {
  for (const SettingType& entry : kTypes) {
    if (entry.type == type) {
      return entry.name;
    }
  }
  return nullptr;
}

const char* ValueName(ContentSetting value) {
  switch (value) {
    case CONTENT_SETTING_ALLOW:
    case CONTENT_SETTING_SESSION_ONLY:
      return "allow";
    case CONTENT_SETTING_BLOCK:
      return "block";
    case CONTENT_SETTING_ASK:
      return "ask";
    default:
      return "default";
  }
}

std::optional<ContentSetting> ValueNamed(std::string_view name) {
  if (name == "allow") {
    return CONTENT_SETTING_ALLOW;
  }
  if (name == "block") {
    return CONTENT_SETTING_BLOCK;
  }
  if (name == "ask") {
    return CONTENT_SETTING_ASK;
  }
  if (name == "default") {
    return CONTENT_SETTING_DEFAULT;
  }
  return std::nullopt;
}

GURL SiteOf(std::string_view spec) {
  GURL url(spec);
  if (!url.is_valid() || !url.SchemeIsHTTPOrHTTPS() || url.host().empty()) {
    return GURL();
  }
  return url::Origin::Create(url).GetURL();
}

std::string RegistrableDomainOf(const GURL& site) {
  std::string domain = net::registry_controlled_domains::GetDomainAndRegistry(
      site, net::registry_controlled_domains::INCLUDE_PRIVATE_REGISTRIES);
  return domain.empty() ? std::string(site.host()) : domain;
}

net::CookiePartitionKeyCollection PartitionsOf(const std::string& domain) {
  base::flat_set<net::CookiePartitionKey> keys;
  for (const char* scheme : {"https://", "http://"}) {
    const net::SchemefulSite top_level(GURL(scheme + domain));
    for (const net::CookiePartitionKey& key :
         net::CookiePartitionKeyCollection::MatchesSite(top_level)
             .PartitionKeys()) {
      keys.insert(key);
    }
  }
  return net::CookiePartitionKeyCollection(std::move(keys));
}

std::unique_ptr<content::BrowsingDataFilterBuilder> SiteFilter(
    const std::string& domain) {
  auto filter = content::BrowsingDataFilterBuilder::Create(
      content::BrowsingDataFilterBuilder::Mode::kDelete);
  filter->AddRegisterableDomain(domain);
  filter->SetCookiePartitionKeyCollection(PartitionsOf(domain));
  return filter;
}

network::mojom::CookieDeletionFilterPtr CookiesPartitionedUnder(
    const std::string& domain) {
  auto filter = network::mojom::CookieDeletionFilter::New();
  filter->cookie_partition_key_collection = PartitionsOf(domain);
  filter->partitioned_state_only = true;
  return filter;
}

constexpr uint64_t kSiteDataTypes =
    chrome_browsing_data_remover::DATA_TYPE_SITE_DATA &
    ~chrome_browsing_data_remover::DATA_TYPE_EXTERNAL_PROTOCOL_DATA;

class SiteDataCleared : public content::BrowsingDataRemover::Observer {
 public:
  SiteDataCleared(content::BrowsingDataRemover* remover,
                  Reply reply,
                  uint32_t cookies)
      : reply_(std::move(reply)), cookies_(cookies) {
    observation_.Observe(remover);
  }

  void OnBrowsingDataRemoverDone(uint64_t failed_data_types) override {
    observation_.Reset();
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](Reply reply, uint32_t cookies, bool storage) {
                         reply.Send(base::DictValue()
                                        .Set("cookies", static_cast<int>(cookies))
                                        .Set("storage", storage));
                       },
                       std::move(reply_), cookies_, failed_data_types == 0));
    delete this;
  }

 private:
  Reply reply_;
  const uint32_t cookies_;
  base::ScopedObservation<content::BrowsingDataRemover,
                          content::BrowsingDataRemover::Observer>
      observation_{this};
};

std::string Serialize(const GURL& site) {
  return url::Origin::Create(site).Serialize();
}

std::string OriginOfPattern(const ContentSettingsPattern& pattern) {
  const std::string spec = pattern.ToString();
  if (spec.find('*') != std::string::npos) {
    return std::string();
  }
  const GURL site = SiteOf(spec);
  return site.is_valid() ? Serialize(site) : std::string();
}

bool Registered(ContentSettingsType type) {
  return content_settings::ContentSettingsRegistry::GetInstance()->Get(type) !=
         nullptr;
}

HostContentSettingsMap* MapFor(Profile* profile) {
  return HostContentSettingsMapFactory::GetForProfile(profile);
}

std::set<std::string> ExceptionOrigins(HostContentSettingsMap* map,
                                       ContentSettingsType type) {
  std::set<std::string> origins;
  if (!Registered(type)) {
    return origins;
  }
  for (const ContentSettingPatternSource& rule :
       map->GetSettingsForOneType(type)) {
    if (rule.source != content_settings::mojom::ProviderType::kPrefProvider ||
        (rule.incognito && !map->IsOffTheRecord())) {
      continue;
    }
    std::string origin = OriginOfPattern(rule.primary_pattern);
    if (!origin.empty()) {
      origins.insert(std::move(origin));
    }
  }
  return origins;
}

class SiteSettingsState : public ProfileState,
                          public content_settings::Observer {
 public:
  explicit SiteSettingsState(Profile* profile) : ProfileState(profile) {
    observation_.Observe(MapFor(profile));
  }

 private:
  void Release() override {
    weak_factory_.InvalidateWeakPtrs();
    observation_.Reset();
  }

  void OnContentSettingChanged(
      const ContentSettingsPattern& primary_pattern,
      const ContentSettingsPattern& secondary_pattern,
      ContentSettingsTypeSet content_type_set) override {
    base::Value type;
    if (!content_type_set.ContainsAllTypes()) {
      const char* name = NameOf(content_type_set.GetType());
      if (!name) {
        return;
      }
      type = base::Value(name);
    }
    const std::string origin = OriginOfPattern(primary_pattern);
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](base::WeakPtr<SiteSettingsState> state,
               base::DictValue payload) {
              if (state) {
                Emit("siteSettings.changed", state->profile(),
                     std::move(payload));
              }
            },
            weak_factory_.GetWeakPtr(),
            base::DictValue()
                .Set("origin",
                     origin.empty() ? base::Value() : base::Value(origin))
                .Set("type", std::move(type))));
  }

  base::ScopedObservation<HostContentSettingsMap, content_settings::Observer>
      observation_{this};
  base::WeakPtrFactory<SiteSettingsState> weak_factory_{this};
};

GURL SiteFor(Call& call) {
  GURL site = SiteOf(call.String("origin"));
  if (!site.is_valid()) {
    call.TakeReply().Error("origin must be an http(s) origin");
  }
  return site;
}

}
}

AC_ENGINE_CALL(ac_site_settings_get) {
  ardia::Call call(profile_dir, args_json, reply, context,
                       ardia::OffTheRecord::kAllow);
  if (!call) {
    return;
  }
  ardia::StateFor<ardia::SiteSettingsState>(call.profile());
  const GURL site = ardia::SiteFor(call);
  if (!site.is_valid()) {
    return;
  }
  HostContentSettingsMap* map = ardia::MapFor(call.profile());
  const std::string origin = ardia::Serialize(site);
  base::DictValue settings;
  for (const ardia::SettingType& type : ardia::kTypes) {
    if (!ardia::Registered(type.type)) {
      continue;
    }
    settings.Set(
        type.name,
        base::DictValue()
            .Set("value", ardia::ValueName(
                              map->GetContentSetting(site, site, type.type)))
            .Set("isDefault",
                 !ardia::ExceptionOrigins(map, type.type).contains(origin)));
  }
  call.TakeReply().Send(base::DictValue().Set("settings", std::move(settings)));
}

AC_ENGINE_CALL(ac_site_settings_set) {
  ardia::Call call(profile_dir, args_json, reply, context,
                       ardia::OffTheRecord::kAllow);
  if (!call) {
    return;
  }
  ardia::StateFor<ardia::SiteSettingsState>(call.profile());
  const GURL site = ardia::SiteFor(call);
  if (!site.is_valid()) {
    return;
  }
  const ardia::SettingType* type =
      ardia::TypeNamed(call.String("type"));
  if (!type) {
    return call.TakeReply().Error("unknown type");
  }
  const std::optional<ContentSetting> value =
      ardia::ValueNamed(call.String("value"));
  if (!value) {
    return call.TakeReply().Error("unknown value");
  }
  const content_settings::ContentSettingsInfo* info =
      content_settings::ContentSettingsRegistry::GetInstance()->Get(
          type->type);
  if (!info) {
    return call.TakeReply().Error("type not available");
  }
  if (*value != CONTENT_SETTING_DEFAULT && !info->IsSettingValid(*value)) {
    return call.TakeReply().Error("value not valid for type");
  }
  ardia::MapFor(call.profile())
      ->SetContentSettingDefaultScope(site, site, type->type, *value);
  call.TakeReply().Ok();
}

AC_ENGINE_CALL(ac_site_settings_reset) {
  ardia::Call call(profile_dir, args_json, reply, context,
                       ardia::OffTheRecord::kAllow);
  if (!call) {
    return;
  }
  ardia::StateFor<ardia::SiteSettingsState>(call.profile());
  const GURL site = ardia::SiteFor(call);
  if (!site.is_valid()) {
    return;
  }
  HostContentSettingsMap* map = ardia::MapFor(call.profile());
  for (const ardia::SettingType& type : ardia::kTypes) {
    if (ardia::Registered(type.type)) {
      map->SetContentSettingDefaultScope(site, site, type.type,
                                         CONTENT_SETTING_DEFAULT);
    }
  }
  call.TakeReply().Ok();
}

AC_ENGINE_CALL(ac_site_settings_origins) {
  ardia::Call call(profile_dir, args_json, reply, context,
                       ardia::OffTheRecord::kAllow);
  if (!call) {
    return;
  }
  ardia::StateFor<ardia::SiteSettingsState>(call.profile());
  HostContentSettingsMap* map = ardia::MapFor(call.profile());
  std::set<std::string> origins;
  for (const ardia::SettingType& type : ardia::kTypes) {
    origins.merge(ardia::ExceptionOrigins(map, type.type));
  }
  base::ListValue list;
  for (const std::string& origin : origins) {
    list.Append(origin);
  }
  call.TakeReply().Send(base::DictValue().Set("origins", std::move(list)));
}

AC_ENGINE_CALL(ac_site_data_clear) {
  ardia::Call call(profile_dir, args_json, reply, context,
                       ardia::OffTheRecord::kAllow);
  if (!call) {
    return;
  }
  const GURL site = ardia::SiteOf(call.String("origin"));
  if (!site.is_valid()) {
    return call.TakeReply().Send(
        base::DictValue().Set("cookies", false).Set("storage", false));
  }
  const std::string domain = ardia::RegistrableDomainOf(site);
  network::mojom::CookieManager* cookies =
      call.profile()->GetDefaultStoragePartition()
          ->GetCookieManagerForBrowserProcess();
  cookies->DeleteCookies(
      ardia::SiteFilter(domain)->BuildCookieDeletionFilter(),
      base::BindOnce(
          [](ardia::Reply reply, base::WeakPtr<Profile> profile,
             std::string domain, uint32_t own) {
            if (!profile) {
              return reply.Send(base::DictValue()
                                    .Set("cookies", static_cast<int>(own))
                                    .Set("storage", false));
            }
            profile->GetDefaultStoragePartition()
                ->GetCookieManagerForBrowserProcess()
                ->DeleteCookies(
                    ardia::CookiesPartitionedUnder(domain),
                    base::BindOnce(
                        [](ardia::Reply reply, base::WeakPtr<Profile> profile,
                           std::string domain, uint32_t own,
                           uint32_t embedded) {
                          const uint32_t deleted = own + embedded;
                          if (!profile) {
                            return reply.Send(
                                base::DictValue()
                                    .Set("cookies", static_cast<int>(deleted))
                                    .Set("storage", false));
                          }
                          content::BrowsingDataRemover* remover =
                              profile->GetBrowsingDataRemover();
                          remover->RemoveWithFilterAndReply(
                              base::Time(), base::Time::Max(),
                              ardia::kSiteDataTypes,
                              content::BrowsingDataRemover::
                                      ORIGIN_TYPE_UNPROTECTED_WEB |
                                  content::BrowsingDataRemover::
                                      ORIGIN_TYPE_PROTECTED_WEB,
                              ardia::SiteFilter(domain),
                              new ardia::SiteDataCleared(
                                  remover, std::move(reply), deleted));
                        },
                        std::move(reply), profile, domain, own));
          },
          call.TakeReply(), call.profile()->GetWeakPtr(), domain));
}

AC_ENGINE_CALL(ac_privacy_settings) {
  ardia::Call call(profile_dir, args_json, reply, context, ardia::OffTheRecord::kAllow);
  if (!call) return;
  PrefService* prefs = call.profile()->GetPrefs();
  const auto value = call.args().FindBool("globalPrivacyControl");
  if (value.has_value()) {
    if (call.profile()->IsOffTheRecord() || prefs->IsManagedPreference(prefs::kHeliumGlobalPrivacyControl)) {
      return call.TakeReply().Error("This privacy preference cannot be changed here.");
    }
    prefs->SetBoolean(prefs::kHeliumGlobalPrivacyControl, *value);
  }
  const GURL origin = ardia::SiteOf(call.String("origin"));
  call.TakeReply().Send(base::DictValue()
      .Set("globalPrivacyControl", prefs->GetBoolean(prefs::kHeliumGlobalPrivacyControl))
      .Set("managed", prefs->IsManagedPreference(prefs::kHeliumGlobalPrivacyControl))
      .Set("site", origin.is_valid() ? ardia::RegistrableDomainOf(origin) : ""));
}
