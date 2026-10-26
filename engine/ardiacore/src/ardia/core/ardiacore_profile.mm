#import "ardia/core/public/ArdiaCore.h"

#include <algorithm>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/location.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/strings/sys_string_conversions.h"
#include "base/supports_user_data.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_remover_constants.h"
#include "chrome/browser/extensions/component_loader.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/browsing_data_remover.h"
#include "content/public/browser/spare_render_process_host_manager.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/extension.h"
#include "extensions/common/manifest.h"
#include "extensions/common/mojom/manifest.mojom-shared.h"
#include "ardia/core/ac_cast_dialog.h"
#include "ardia/core/ac_navigation_hold.h"
#import "ardia/core/ardiacore_api_internal.h"
#import "ardia/core/ardiacore_internal.h"

using ardiacore::NS;

@interface ArdiaCoreProfile (Lifetime)
- (void)profileWillBeDestroyed;
@end

namespace {

std::map<Profile*, ArdiaCoreProfile*>& ProfileWrappers() {
  static base::NoDestructor<std::map<Profile*, ArdiaCoreProfile*>> wrappers;
  return *wrappers;
}

class ProfileGoneObserver : public ProfileObserver {
 public:
  ProfileGoneObserver(Profile* profile, ArdiaCoreProfile* wrapper)
      : wrapper_(wrapper) {
    observation_.Observe(profile);
  }
  void OnProfileWillBeDestroyed(Profile* profile) override {
    observation_.Reset();
    ardiacore::NoteProfileDying(profile);
    [wrapper_ profileWillBeDestroyed];
  }

 private:
  __weak ArdiaCoreProfile* wrapper_;
  base::ScopedObservation<Profile, ProfileObserver> observation_{this};
};

bool IsHostPreference(const std::string& name) {
  static const char* const kAllowed[] = {
      "credentials_enable_service", "autofill.profile_enabled",
      "autofill.credit_card_enabled", "download_bubble.partial_view_enabled"};
  for (const char* allowed : kAllowed) {
    if (name == allowed) {
      return true;
    }
  }
  return false;
}

class BrowsingDataDone : public content::BrowsingDataRemover::Observer {
 public:
  BrowsingDataDone(content::BrowsingDataRemover* remover, void (^completion)(void))
      : completion_(completion) {
    observation_.Observe(remover);
  }
  void OnBrowsingDataRemoverDone(uint64_t failed_data_types) override {
    if (completion_) {
      completion_();
    }
    delete this;
  }

 private:
  void (^completion_)(void);
  base::ScopedObservation<content::BrowsingDataRemover,
                          content::BrowsingDataRemover::Observer>
      observation_{this};
};

}

namespace ardiacore {

namespace {
std::vector<base::WeakPtr<Profile>>& DyingProfiles() {
  static base::NoDestructor<std::vector<base::WeakPtr<Profile>>> dying;
  return *dying;
}
}

void NoteProfileDying(Profile* profile) {
  if (profile && !IsProfileDying(profile)) {
    DyingProfiles().push_back(profile->GetWeakPtr());
  }
}

bool IsProfileDying(const Profile* profile) {
  std::erase_if(DyingProfiles(), [](const base::WeakPtr<Profile>& p) { return !p; });
  return profile && std::ranges::any_of(DyingProfiles(), [&](const base::WeakPtr<Profile>& p) {
           return p.get() == profile;
         });
}

namespace {
class GoneNotifier : public base::SupportsUserData::Data {
 public:
  static const void* Key() {
    static const int key = 0;
    return &key;
  }
  ~GoneNotifier() override {
    for (base::OnceClosure& waiter : waiters_) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE, std::move(waiter));
    }
  }
  void Add(base::OnceClosure waiter) { waiters_.push_back(std::move(waiter)); }

 private:
  std::vector<base::OnceClosure> waiters_;
};
}

void WhenProfileGone(Profile* profile, base::OnceClosure done) {
  auto* notifier = static_cast<GoneNotifier*>(profile->GetUserData(GoneNotifier::Key()));
  if (!notifier) {
    auto owned = std::make_unique<GoneNotifier>();
    notifier = owned.get();
    profile->SetUserData(GoneNotifier::Key(), std::move(owned));
  }
  notifier->Add(std::move(done));
}

namespace {
std::vector<base::WeakPtr<Profile>>& DeletingProfiles() {
  static base::NoDestructor<std::vector<base::WeakPtr<Profile>>> deleting;
  return *deleting;
}
}

void NoteProfileDeleting(Profile* profile) {
  if (profile && !IsProfileDeleting(profile)) {
    DeletingProfiles().push_back(profile->GetWeakPtr());
  }
}

bool IsProfileDeleting(const Profile* profile) {
  std::erase_if(DeletingProfiles(), [](const base::WeakPtr<Profile>& p) { return !p; });
  return profile && std::ranges::any_of(DeletingProfiles(), [&](const base::WeakPtr<Profile>& p) {
           return p.get() == profile;
         });
}

}

@implementation ArdiaCoreProfile {
  base::WeakPtr<Profile> _profile;
  std::unique_ptr<ProfileGoneObserver> _observer;
  NSString* __strong _name;
  NSString* __strong _path;
  BOOL _offTheRecord;
}

+ (ArdiaCoreProfile*)wrapperFor:(Profile*)profile {
  if (!profile || ardiacore::IsProfileDying(profile)) {
    return nil;
  }
  ArdiaCoreProfile* __strong& wrapper = ProfileWrappers()[profile];
  if (!wrapper) {
    wrapper = [[ArdiaCoreProfile alloc] init];
    wrapper->_profile = profile->GetWeakPtr();
    wrapper->_offTheRecord = profile->IsOffTheRecord();
    wrapper->_name = NS(profile->GetBaseName().value());
    wrapper->_path = NS(profile->GetPath().value());
    wrapper->_observer = std::make_unique<ProfileGoneObserver>(profile, wrapper);
  }
  return wrapper;
}

- (void)profileWillBeDestroyed {
  ProfileWrappers().erase(_profile.get());
  _profile.reset();
  _observer.reset();
}

- (Profile*)chromeProfile {
  return _profile.get();
}

- (BOOL)destroyed {
  return !_profile;
}

- (BOOL)offTheRecord {
  return _offTheRecord;
}

- (NSString*)name {
  return _name;
}

- (NSString*)path {
  return _path;
}

- (NSNumber*)boolPreference:(NSString*)name {
  const std::string key = base::SysNSStringToUTF8(name);
  if (!_profile || !IsHostPreference(key)) {
    return nil;
  }
  const PrefService::Preference* pref = _profile->GetPrefs()->FindPreference(key);
  return pref && pref->GetValue()->is_bool() ? @(pref->GetValue()->GetBool()) : nil;
}

- (void)setBoolPreference:(NSString*)name value:(BOOL)value {
  const std::string key = base::SysNSStringToUTF8(name);
  if (_profile && IsHostPreference(key) &&
      _profile->GetPrefs()->FindPreference(key)) {
    _profile->GetPrefs()->SetBoolean(key, value);
  }
}

- (void)clearBrowsingData:(NSArray<NSString*>*)types
                    since:(NSDate*)since
               completion:(void (^)(void))completion {
  uint64_t mask = 0;
  for (NSString* type in types) {
    if ([type isEqualToString:@"history"]) {
      mask |= chrome_browsing_data_remover::DATA_TYPE_HISTORY;
    } else if ([type isEqualToString:@"siteData"]) {
      mask |= chrome_browsing_data_remover::DATA_TYPE_SITE_DATA;
    } else if ([type isEqualToString:@"cache"]) {
      mask |= content::BrowsingDataRemover::DATA_TYPE_CACHE;
    } else if ([type isEqualToString:@"downloads"]) {
      mask |= content::BrowsingDataRemover::DATA_TYPE_DOWNLOADS;
    }
  }
  if (!_profile || !mask) {
    if (completion) {
      completion();
    }
    return;
  }
  content::BrowsingDataRemover* remover = _profile->GetBrowsingDataRemover();
  const base::Time begin =
      since ? base::Time::FromSecondsSinceUnixEpoch(since.timeIntervalSince1970)
            : base::Time();
  remover->RemoveAndReply(begin, base::Time::Max(), mask,
                          content::BrowsingDataRemover::ORIGIN_TYPE_UNPROTECTED_WEB,
                          new BrowsingDataDone(remover, completion));
}

- (NSString*)loadComponentExtension:(NSString*)path {
  if (!_profile || !path.length) {
    return nil;
  }
  const base::FilePath root(base::SysNSStringToUTF8(path));
  for (const auto& extension :
       extensions::ExtensionRegistry::Get(_profile.get())->enabled_extensions()) {
    if (extension->location() == extensions::mojom::ManifestLocation::kComponent &&
        extension->path() == root) {
      return NS(extension->id());
    }
  }
  extensions::ComponentLoader* loader = extensions::ComponentLoader::Get(_profile.get());
  if (!loader) {
    return nil;
  }
  const std::string extension_id = loader->AddOrReplace(root);
  return extension_id.empty() ? nil : NS(extension_id);
}

- (void)warmSpareRenderer {
  if (_profile) {
    content::SpareRenderProcessHostManager::Get().WarmupSpare(_profile.get());
  }
}

- (void)unloadComponentExtension:(NSString*)extensionId {
  if (!_profile || !extensionId.length) {
    return;
  }
  if (extensions::ComponentLoader* loader = extensions::ComponentLoader::Get(_profile.get())) {
    loader->Remove(base::SysNSStringToUTF8(extensionId));
  }
}

- (void)holdNavigationsUntilRulesetsOf:(NSString*)extensionId {
  if (_profile) {
    ardiacore::HoldNavigationsForRulesets(_profile.get(), base::SysNSStringToUTF8(extensionId));
  }
}

- (void)releaseNavigationHold:(NSString*)reason {
  if (_profile) {
    ardiacore::ReleaseNavigationHold(_profile.get(), base::SysNSStringToUTF8(reason));
  }
}

- (void)releaseNavigationHoldReady {
  if (_profile) {
    ardiacore::ReleaseNavigationHoldReady(_profile.get());
  }
}

- (void)watchCastRoutes {
  ardiacore::WatchCastRoutes(_profile.get());
}

- (NSArray<NSDictionary<NSString*, id>*>*)extensions {
  NSMutableArray* list = [NSMutableArray array];
  if (!_profile) {
    return list;
  }
  auto* registry = extensions::ExtensionRegistry::Get(_profile.get());
  auto* actions = extensions::ExtensionActionManager::Get(_profile.get());
  for (const auto& extension : registry->enabled_extensions()) {
    if (extensions::Manifest::IsComponentLocation(extension->location())) {
      continue;
    }
    extensions::ExtensionAction* action =
        actions->GetExtensionAction(*extension);
    [list addObject:@{
      @"id" : NS(extension->id()),
      @"name" : NS(extension->name()),
      @"version" : NS(extension->VersionString()),
      @"enabled" : @YES,
      @"actionPopupURL" :
          action ? NS(action->GetPopupUrl(extensions::ExtensionAction::kDefaultTabId)
                          .spec())
                 : @"",
    }];
  }
  return list;
}

@end
