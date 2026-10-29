#import "ardia/core/public/ArdiaCore.h"

#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/thread_pool.h"
#include "base/time/time.h"
#include "chrome/browser/apps/platform_apps/shortcut_manager.h"
#include "chrome/browser/ardia/ac_tab_restore.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/delete_profile_helper.h"
#include "chrome/browser/profiles/nuke_profile_directory_utils.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_destroyer.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_manager_observer.h"
#include "chrome/browser/profiles/profile_metrics.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/browser_window/public/desktop_browser_window_capabilities.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/keep_alive_registry/keep_alive_registry.h"
#include "components/prefs/pref_service.h"
#include "components/version_info/version_info.h"
#include "content/public/browser/browser_thread.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_browser_window.h"
#include "ardia/core/ac_cast_dialog.h"
#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_desktop_capture.h"
#include "ardia/core/ac_device_chooser.h"
#include "ardia/core/ac_extension_shortcuts.h"
#include "ardia/core/ac_extension_view.h"
#include "ardia/core/ac_external_apps.h"
#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_host_visibility.h"
#include "ardia/core/ac_installed_bubble.h"
#include "ardia/core/ac_lifetime.h"
#include "ardia/core/ac_main_delegate.h"
#include "ardia/core/ac_page_script.h"
#include "ardia/core/ac_permissions.h"
#include "ardia/core/ac_picture_in_picture.h"
#include "ardia/core/ac_video_upscaling.h"
#import "ardia/core/ardiacore_api_internal.h"
#import "ardia/core/ardiacore_internal.h"

extern "C" int ChromeMain(int argc, const char** argv);

namespace ardiacore {

id<ArdiaCoreEngineDelegate> __strong g_delegate;
ArdiaCoreEngine* __strong g_engine;

NSString* NS(const std::string& s) {
  return base::SysUTF8ToNSString(s);
}

NSString* NS(const std::u16string& s) {
  return base::SysUTF16ToNSString(s);
}

}

using ardiacore::g_delegate;
using ardiacore::g_engine;
using ardiacore::NS;

namespace {

void ApplyAutoPictureInPicture(Profile* profile) {
  HostContentSettingsMapFactory::GetForProfile(profile)->SetDefaultContentSetting(
      ContentSettingsType::AUTO_PICTURE_IN_PICTURE,
      g_ardia_auto_picture_in_picture_off ? CONTENT_SETTING_BLOCK : CONTENT_SETTING_ALLOW);
}

void PrepareProfilePrefs(Profile* profile) {
  if (!profile || profile->IsOffTheRecord()) {
    return;
  }
  PrefService* prefs = profile->GetPrefs();
  if (prefs->FindPreference("session.restore_on_startup")) {
    prefs->SetInteger("session.restore_on_startup", 5);
  }
  if (prefs->FindPreference("download_bubble.partial_view_enabled")) {
    prefs->SetBoolean("download_bubble.partial_view_enabled", false);
  }
  ApplyAutoPictureInPicture(profile);
}

class ProfilePrefsApplier : public ProfileManagerObserver {
 public:
  explicit ProfilePrefsApplier(ProfileManager* manager) {
    observation_.Observe(manager);
  }
  void OnProfileAdded(Profile* profile) override { PrepareProfilePrefs(profile); }
  void OnProfileManagerDestroying() override { observation_.Reset(); }

 private:
  base::ScopedObservation<ProfileManager, ProfileManagerObserver> observation_{this};
};

void StartApplyingProfilePrefs() {
  ProfileManager* manager = g_browser_process->profile_manager();
  for (Profile* profile : manager->GetLoadedProfiles()) {
    PrepareProfilePrefs(profile);
  }
  static base::NoDestructor<ProfilePrefsApplier> applier(manager);
}


}

namespace ardiacore {

void OnEngineStarted() {
  StartApplyingProfilePrefs();
  ardia::StartTabHistoryCleaner();
  InstallPermissionPrompts();
  StartMediaCaptureObserver();
  InstallExternalAppPrompts();
  StartPictureInPictureObserver();
  StartHostVisibility();
  StartVideoUpscaling();
  [g_delegate engineDidStart];
}

void OnEngineShuttingDown() {
  CloseAllExtensionViews();
  [g_delegate engineWillShutDown];
}

}

extern "C" __attribute__((visibility("default"))) int ArdiaCoreMain(
    int argc,
    const char** argv) {
  return ChromeMain(argc, argv);
}

@implementation ArdiaCoreEngine

+ (int)runWithArgc:(int)argc
              argv:(const char**)argv
          delegate:(id<ArdiaCoreEngineDelegate>)delegate {
  bool is_browser = true;
  for (int i = 1; i < argc; ++i) {
    if (strncmp(argv[i], "--type=", 7) == 0) {
      is_browser = false;
    }
  }
  if (!is_browser) {
    return ChromeMain(argc, argv);
  }

  g_delegate = delegate;
  g_engine = [[ArdiaCoreEngine alloc] init];
  AppShortcutManager::SuppressShortcutsForTesting();

  int rv = ChromeMain(argc, argv);
  g_delegate = nil;
  return rv;
}

+ (ArdiaCoreEngine*)sharedEngine {
  return g_engine;
}

- (ArdiaCoreProfile*)defaultProfile {
  Profile* profile = ProfileManager::GetLastUsedProfileIfLoaded();
  return profile ? [ArdiaCoreProfile wrapperFor:profile] : nil;
}

- (void)loadProfile:(NSString*)directoryName
         completion:(void (^)(ArdiaCoreProfile*))completion {
  ProfileManager* manager = g_browser_process->profile_manager();
  base::FilePath path =
      manager->user_data_dir().Append(base::SysNSStringToUTF8(directoryName));
  Profile* loaded = manager->GetProfileByPath(path);
  if (IsProfileDirectoryMarkedForDeletion(path) ||
      (loaded && ardiacore::IsProfileDeleting(loaded))) {
    completion(nil);
    return;
  }
  manager->CreateProfileAsync(
      path, base::BindOnce(
                [](void (^completion)(ArdiaCoreProfile*), Profile* profile) {
                  completion(profile && !ardiacore::IsProfileDeleting(profile)
                                 ? [ArdiaCoreProfile wrapperFor:profile]
                                 : nil);
                },
                completion));
}

- (void)quit {
  ardiacore::QuitEngine();
}

- (NSString*)pageScript {
  const std::string& script = ardiacore::GetPageScript();
  return script.empty() ? nil : NS(script);
}

- (void)setPageScript:(NSString*)pageScript {
  ardiacore::SetPageScript(pageScript ? base::SysNSStringToUTF8(pageScript)
                                   : std::string());
}

+ (void)resolvePermission:(NSString*)requestId
                   result:(NSString*)result
                 remember:(BOOL)remember {
  ardiacore::ResolvePermission(base::SysNSStringToUTF8(requestId),
                            base::SysNSStringToUTF8(result), remember);
}

+ (void)startCasting:(int)dialogId sink:(NSString*)sinkId mode:(int)castMode {
  ardiacore::StartCasting(dialogId, base::SysNSStringToUTF8(sinkId), castMode);
}

+ (void)stopCasting:(int)dialogId route:(NSString*)routeId {
  ardiacore::StopCasting(dialogId, base::SysNSStringToUTF8(routeId));
}

+ (void)reservedShortcutsChanged {
  ardiacore::ReservedShortcutsChanged();
}

+ (void)setVideoUpscaling:(BOOL)enabled {
  ardiacore::SetVideoUpscalingEnabled(enabled);
}

+ (void)setVideoUpscalingTestConditions:(NSDictionary<NSString*, NSNumber*>*)conditions {
  NSNumber* low_power = conditions[@"lowPower"];
  NSNumber* thermal = conditions[@"thermalPressure"];
  ardiacore::SetVideoUpscalingTestConditions(
      low_power ? std::optional<bool>(low_power.boolValue) : std::nullopt,
      thermal ? std::optional<bool>(thermal.boolValue) : std::nullopt);
}

+ (NSDictionary<NSString*, id>*)videoUpscalingState {
  return ardiacore::VideoUpscalingState();
}

+ (void)setAutoPictureInPicture:(BOOL)enabled {
  g_ardia_auto_picture_in_picture_off = !enabled;
  for (Profile* profile : g_browser_process->profile_manager()->GetLoadedProfiles()) {
    if (!profile->IsOffTheRecord()) {
      ApplyAutoPictureInPicture(profile);
    }
  }
}

+ (void)terminateCastRoute:(NSString*)routeId {
  ardiacore::TerminateCastRoute(base::SysNSStringToUTF8(routeId));
}

+ (void)closeCastDialog:(int)dialogId {
  ardiacore::CloseCastDialog(dialogId);
}

+ (void)selectDevice:(int)chooserId index:(int)index {
  ardiacore::SelectDevice(chooserId, index);
}

+ (void)cancelDeviceChooser:(int)chooserId {
  ardiacore::CancelDeviceChooser(chooserId);
}

+ (void)refreshDeviceChooser:(int)chooserId {
  ardiacore::RefreshDeviceChooser(chooserId);
}

+ (void)openDeviceChooserSettings:(int)chooserId {
  ardiacore::OpenDeviceChooserSettings(chooserId);
}

+ (void)resolveExtensionInstallPrompt:(NSString*)requestId accepted:(BOOL)accepted {
  ardiacore::ResolveExtensionInstallPrompt(base::SysNSStringToUTF8(requestId), accepted);
}

- (void)deleteProfile:(ArdiaCoreProfile*)profile completion:(void (^)(BOOL deleted))completion {
  Profile* chrome_profile = profile.chromeProfile;
  ProfileManager* manager = g_browser_process->profile_manager();
  if (!chrome_profile || !chrome_profile->IsRegularProfile() ||
      chrome_profile->GetPath() ==
          manager->user_data_dir().Append(ProfileManager::GetInitialProfileDir())) {
    if (completion) {
      completion(NO);
    }
    return;
  }
  ardiacore::NoteProfileDeleting(chrome_profile);
  base::WeakPtr<Profile> weak = chrome_profile->GetWeakPtr();
  const base::FilePath path = chrome_profile->GetPath();
  manager->GetDeleteProfileHelper().MaybeScheduleProfileForDeletion(
      chrome_profile->GetPath(), base::DoNothing(),
      ProfileMetrics::DELETE_PROFILE_SETTINGS);
  if (weak) {
    manager->ClearFirstBrowserWindowKeepAlive(weak.get());
  }
  for (const base::TimeDelta delay : {base::Seconds(2), base::Seconds(10)}) {
    content::GetUIThreadTaskRunner({})->PostDelayedTask(
        FROM_HERE, base::BindOnce([](const base::FilePath& dir) {
          if (!IsProfileDirectoryMarkedForDeletion(dir) ||
              g_browser_process->profile_manager()->GetProfileByPath(dir)) {
            return;
          }
          base::ThreadPool::PostTask(
              FROM_HERE,
              {base::MayBlock(), base::TaskPriority::BEST_EFFORT,
               base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN},
              base::BindOnce(base::IgnoreResult(&base::DeletePathRecursively), dir));
        }, path),
        delay);
  }
  if (completion) {
    completion(YES);
  }
}

- (void)releaseProfile:(ArdiaCoreProfile*)profile {
  Profile* chrome_profile = profile.chromeProfile;
  if (!chrome_profile || !chrome_profile->IsOffTheRecord()) {
    return;
  }
  bool in_use = false;
  GlobalBrowserCollection::GetInstance()->ForEach([&](BrowserWindowInterface* browser) {
    in_use |= browser->GetProfile() == chrome_profile &&
              !browser->capabilities()->IsAttemptingToCloseBrowser();
    return !in_use;
  });
  if (!in_use) {
    ProfileDestroyer::DestroyOTRProfileWhenAppropriate(chrome_profile);
  }
}

+ (void)allowDesktopCapture:(NSString*)sourceId
                        tab:(ArdiaCoreTab*)tab
                      frame:(NSString*)frameId
                     origin:(NSString*)origin
                      audio:(NSString*)audio {
  ardiacore::AllowDesktopCapture(tab.contents, base::SysNSStringToUTF8(sourceId ?: @""),
                              base::SysNSStringToUTF8(frameId ?: @""),
                              base::SysNSStringToUTF8(origin ?: @""),
                              base::SysNSStringToUTF8(audio ?: @""));
}

+ (NSDictionary<NSString*, NSNumber*>*)desktopCaptureAudio {
  return @{
    @"system" : @(ardiacore::IsDesktopCaptureSystemAudioSupported()),
    @"application" : @(ardiacore::IsDesktopCaptureApplicationAudioSupported()),
  };
}

+ (NSArray<NSDictionary*>*)testExternalLaunches {
  return ardiacore::TestExternalLaunches();
}

+ (NSArray<NSDictionary*>*)testChooserEvents {
  return ardiacore::TestChooserEvents();
}

+ (void)resolveExternalApp:(NSString*)requestId open:(BOOL)open remember:(BOOL)remember {
  ardiacore::ResolveExternalApp(base::SysNSStringToUTF8(requestId), open, remember);
}

- (void)offTheRecordProfileFor:(ArdiaCoreProfile*)profile
                    completion:(void (^)(ArdiaCoreProfile*, NSString*))completion {
  Profile* original = profile.chromeProfile;
  if (!original || original->IsOffTheRecord()) {
    completion(nil, original ? @"not a regular profile" : @"the profile went");
    return;
  }
  Profile* current = original->GetPrimaryOTRProfile(false);
  if (current && ardiacore::IsProfileDying(current)) {
    ardiacore::WhenProfileGone(current, base::BindOnce(^{
                              [self offTheRecordProfileFor:profile completion:completion];
                            }));
    return;
  }
  ArdiaCoreProfile* otr =
      [ArdiaCoreProfile wrapperFor:original->GetPrimaryOTRProfile(true)];
  completion(otr, otr ? nil : @"Chrome is destroying it");
}

- (NSString*)keepAliveState {
  std::ostringstream out;
  out << *KeepAliveRegistry::GetInstance()
      << " trying_to_quit=" << browser_shutdown::IsTryingToQuit();
  return NS(out.str());
}

- (NSString*)chromiumVersion {
  return NS(std::string(version_info::GetVersionNumber()));
}

@end
