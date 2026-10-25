#import "ardia/core/public/ArdiaCore.h"

#include <cmath>
#include <map>
#include <sstream>
#include <memory>
#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/task/thread_pool.h"
#include "content/public/browser/browser_thread.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/strings/sys_string_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/ardia/ac_tab_restore.h"  // nogncheck
#include "chrome/browser/devtools/devtools_contents_resizing_strategy.h"
#include "chrome/browser/devtools/devtools_window.h"
#include "base/metrics/user_metrics.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/devtools/devtools_toggle_action.h"
#include "chrome/browser/ui/tab_contents/core_tab_helper.h"
#include "chrome/common/content_restriction.h"
#include "chrome/common/pref_names.h"
#include "content/public/common/url_utils.h"
#include "components/policy/core/common/policy_pref_names.h"
#include "components/web_modal/web_contents_modal_dialog_manager.h"
#include "pdf/buildflags.h"
#include "printing/buildflags/buildflags.h"
#if BUILDFLAG(ENABLE_PDF)
#include "chrome/browser/pdf/pdf_extension_util.h"
#include "pdf/pdf_features.h"
#endif
#if BUILDFLAG(ENABLE_PRINTING)
#include "chrome/browser/printing/print_view_manager_common.h"
#endif
#if BUILDFLAG(ENABLE_PRINT_PREVIEW)
#include "chrome/browser/printing/print_preview_dialog_controller.h"
#endif
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "components/keep_alive_registry/keep_alive_registry.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "chrome/browser/profiles/profile_manager_observer.h"
#include "chrome/browser/browsing_data/chrome_browsing_data_remover_constants.h"
#include "content/public/browser/browsing_data_remover.h"
#include "components/prefs/pref_service.h"
#include "base/scoped_observation.h"
#include "base/supports_user_data.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/browser_commands.h"
#include "components/find_in_page/find_tab_helper.h"
#include "components/find_in_page/find_types.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/browser_window/public/browser_window_features.h"
#include "chrome/browser/ui/exclusive_access/exclusive_access_manager.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/sessions/content/session_tab_helper.h"
#include "content/public/browser/media_session.h"
#include "components/version_info/version_info.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/render_frame_host.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "url/scheme_host_port.h"
#include "url/url_constants.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/spare_render_process_host_manager.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "extensions/browser/extension_action.h"
#include "extensions/browser/extension_action_manager.h"
#include "extensions/browser/extension_host.h"
#include "extensions/browser/extension_host_registry.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/extension.h"
#include "ardia/core/ac_extension_shortcuts.h"
#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_autofill_prompt.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_contents_background.h"
#include "ardia/core/ac_browser_window.h"
#include "ardia/core/ac_extension_view.h"
#include "ardia/core/ac_installed_bubble.h"
#include "ardia/core/ac_lifetime.h"
#include "ardia/core/ac_main_delegate.h"
#include "ardia/core/ac_video_upscaling.h"
#include "ardia/core/ac_navigation_hold.h"
#include "ardia/core/ac_page_channel.h"
#include "ardia/core/ac_password_prompt.h"
#include "ardia/core/ac_tab_info.h"
#include "ardia/core/ac_permissions.h"
#include "chrome/browser/ui/tab_sharing/tab_sharing_infobar_delegate.h"
#include "components/infobars/content/content_infobar_manager.h"
#include "components/infobars/core/infobar.h"
#include "chrome/browser/ui/browser_window/public/desktop_browser_window_capabilities.h"
#include "base/pickle.h"
#include "chrome/browser/ui/browser_tabrestore.h"
#include "components/sessions/core/serialized_navigation_entry.h"
#include "components/sessions/core/serialized_user_agent_override.h"
#include "ardia/core/ac_device_chooser.h"
#include "ardia/core/ac_cast_dialog.h"
#include "ardia/core/ac_desktop_capture.h"
#include "ardia/core/ac_devtools_call.h"
#include "ardia/core/ac_host_visibility.h"
#include "ardia/core/ac_picture_in_picture.h"
#include "ardia/core/ac_autofill_trigger.h"
#include "base/trace_event/trace_config.h"
#include "chrome/browser/media/webrtc/media_capture_devices_dispatcher.h"
#include "chrome/browser/media/webrtc/media_stream_capture_indicator.h"
#include "chrome/browser/picture_in_picture/auto_picture_in_picture_tab_helper.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/tracing_controller.h"
#include "content/public/browser/web_contents_media_capture_id.h"
#include "extensions/browser/install_prompt_data.h"
#include "chrome/browser/profiles/delete_profile_helper.h"
#include "chrome/browser/profiles/nuke_profile_directory_utils.h"
#include "chrome/browser/profiles/profile_destroyer.h"
#include "chrome/browser/profiles/profile_metrics.h"
#include "chrome/browser/extensions/component_loader.h"
#include "extensions/common/manifest.h"
#include "extensions/common/mojom/manifest.mojom-shared.h"
#include "ardia/core/ac_external_apps.h"
#include "base/base64.h"
#include "chrome/browser/extensions/api/side_panel/side_panel_service.h"
#include "chrome/browser/extensions/extension_action_runner.h"
#include "chrome/browser/resource_coordinator/lifecycle_unit_state.mojom.h"
#include "chrome/browser/resource_coordinator/tab_lifecycle_unit_external.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/image/image_skia.h"
#include "ui/gfx/image/image_skia_rep.h"
#include "base/auto_reset.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "chrome/browser/apps/platform_apps/shortcut_manager.h"
#include "base/strings/string_number_conversions.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "components/blocked_content/popup_blocker_tab_helper.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/zoom/page_zoom.h"
#include "components/zoom/zoom_controller.h"
#include "content/public/common/page_zoom.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_model.h"
#include "third_party/skia/include/core/SkColor.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "third_party/skia/include/core/SkBitmap.h"
#include "third_party/skia/include/core/SkColorSpace.h"
#include "third_party/skia/include/core/SkData.h"
#include "third_party/skia/include/encode/SkICC.h"
#include "third_party/skia/modules/skcms/skcms.h"
#include <algorithm>
#include <optional>
#import "ardia/core/ardiacore_internal.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/image/image.h"
#include "ui/gfx/mac/coordinate_conversion.h"

extern "C" int ChromeMain(int argc, const char** argv);

@interface ArdiaCoreProfile (Lifetime)
- (void)profileWillBeDestroyed;
@end

namespace {

id<ArdiaCoreEngineDelegate> __strong g_delegate;
ArdiaCoreEngine* __strong g_engine;

NSString* NS(const std::string& s) {
  return base::SysUTF8ToNSString(s);
}

CGImageRef CreatePicture(const SkBitmap& bitmap) {
  if (bitmap.drawsNothing() || bitmap.bytesPerPixel() != 4 ||
      (bitmap.colorType() != kBGRA_8888_SkColorType &&
       bitmap.colorType() != kRGBA_8888_SkColorType)) {
    return nullptr;
  }
  const bool opaque = bitmap.alphaType() == kOpaque_SkAlphaType;
  const CGBitmapInfo info =
      bitmap.colorType() == kBGRA_8888_SkColorType
          ? kCGBitmapByteOrder32Little |
                (opaque ? kCGImageAlphaNoneSkipFirst : kCGImageAlphaPremultipliedFirst)
          : kCGBitmapByteOrder32Big |
                (opaque ? kCGImageAlphaNoneSkipLast : kCGImageAlphaPremultipliedLast);
  CGColorSpaceRef space = nullptr;
  if (SkColorSpace* sk = bitmap.colorSpace()) {
    skcms_TransferFunction fn;
    skcms_Matrix3x3 toXYZD50;
    if (sk->isNumericalTransferFn(&fn) && sk->toXYZD50(&toXYZD50)) {
      if (sk_sp<SkData> icc = SkWriteICCProfile(fn, toXYZD50)) {
        CFDataRef data = CFDataCreate(nullptr, icc->bytes(), icc->size());
        space = CGColorSpaceCreateWithICCData(data);
        CFRelease(data);
      }
    }
  }
  if (!space) {
    space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  }
  CFDataRef pixels = CFDataCreate(nullptr, static_cast<const UInt8*>(bitmap.getPixels()),
                                  bitmap.computeByteSize());
  CGDataProviderRef provider = CGDataProviderCreateWithCFData(pixels);
  CGImageRef image = CGImageCreate(bitmap.width(), bitmap.height(), 8, 32, bitmap.rowBytes(),
                                   space, info, provider, nullptr, false,
                                   kCGRenderingIntentDefault);
  CGDataProviderRelease(provider);
  CFRelease(pixels);
  CGColorSpaceRelease(space);
  return image;
}

NSString* NS(const std::u16string& s) {
  return base::SysUTF16ToNSString(s);
}

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

class ComponentBackgroundObserver
    : public extensions::ExtensionHostRegistry::Observer,
      public content::WebContentsObserver {
 public:
  ComponentBackgroundObserver(Profile* profile,
                              const std::string& extension_id,
                              void (^on_load)(void))
      : profile_(profile->GetWeakPtr()),
        extension_id_(extension_id),
        on_load_([on_load copy]) {
    auto* registry = extensions::ExtensionHostRegistry::Get(profile);
    observation_.Observe(registry);
    for (auto* host : registry->GetHostsForExtension(extension_id_)) {
      Watch(host);
    }
  }

  void OnExtensionHostRenderProcessReady(content::BrowserContext*,
                                         extensions::ExtensionHost* host) override {
    Watch(host);
  }

  void OnExtensionHostDestroyed(content::BrowserContext*,
                               extensions::ExtensionHost* host) override {
    if (web_contents() == host->host_contents()) {
      Observe(nullptr);
    }
  }

  void OnExtensionHostRegistryShutdown(
      extensions::ExtensionHostRegistry*) override {
    Observe(nullptr);
    observation_.Reset();
  }

  void DidFinishLoad(content::RenderFrameHost* frame, const GURL&) override {
    if (profile_ && frame == web_contents()->GetPrimaryMainFrame()) {
      void (^on_load)(void) = on_load_;
      on_load();
    }
  }

 private:
  void Watch(extensions::ExtensionHost* host) {
    const auto* extension = host->extension();
    if (profile_ && host->browser_context() == profile_.get() && extension &&
        host->extension_id() == extension_id_ &&
        extension->location() == extensions::mojom::ManifestLocation::kComponent &&
        host->extension_host_type() ==
            extensions::mojom::ViewType::kExtensionBackgroundPage) {
      Observe(host->host_contents());
    }
  }

  base::WeakPtr<Profile> profile_;
  const std::string extension_id_;
  void (^__strong on_load_)(void);
  base::ScopedObservation<extensions::ExtensionHostRegistry,
                          extensions::ExtensionHostRegistry::Observer>
      observation_{this};
};

id HexColor(SkColor color) {
  if (!SkColorGetA(color)) {
    return NSNull.null;
  }
  return [NSString stringWithFormat:@"#%02x%02x%02x", SkColorGetR(color),
                                    SkColorGetG(color), SkColorGetB(color)];
}

NSString* PngDataURL(const gfx::Image& image) {
  if (image.IsEmpty()) {
    return @"";
  }
  const gfx::ImageSkiaRep& rep = image.ToImageSkia()->GetRepresentation(2.0f);
  std::optional<std::vector<uint8_t>> png = gfx::PNGCodec::EncodeBGRASkBitmap(
      rep.GetBitmap(), false);
  if (!png) {
    return @"";
  }
  return NS("data:image/png;base64," + base::Base64Encode(*png));
}

bool g_auto_picture_in_picture = true;

void ApplyAutoPictureInPicture(Profile* profile) {
  g_ardia_auto_picture_in_picture_off = !g_auto_picture_in_picture;
  HostContentSettingsMapFactory::GetForProfile(profile)->SetDefaultContentSetting(
      ContentSettingsType::AUTO_PICTURE_IN_PICTURE,
      g_auto_picture_in_picture ? CONTENT_SETTING_ALLOW : CONTENT_SETTING_BLOCK);
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

namespace {

const char* BrowserTypeName(BrowserWindowInterface::Type type) {
  switch (type) {
    case BrowserWindowInterface::TYPE_NORMAL:
      return "normal";
    case BrowserWindowInterface::TYPE_POPUP:
      return "popup";
    case BrowserWindowInterface::TYPE_DEVTOOLS:
      return "devtools";
    case BrowserWindowInterface::TYPE_PICTURE_IN_PICTURE:
      return "picture_in_picture";
    default:
      return "app";
  }
}

BrowserWindow* WindowForChromeBrowser(Browser* browser) {
  if (ardiacore::ACBrowserWindow::IsOurs(browser) ||
      browser->GetType() == BrowserWindowInterface::TYPE_PICTURE_IN_PICTURE ||
      ![g_delegate respondsToSelector:@selector
                   (engineWindowForNewBrowserOfProfile:type:)]) {
    return nullptr;
  }
  ArdiaCoreWindow* window = [g_delegate
      engineWindowForNewBrowserOfProfile:[ArdiaCoreProfile
                                             wrapperFor:browser->GetProfile()]
                                    type:@(BrowserTypeName(browser->GetType()))];
  ardiacore::WindowHost* host = window.host;
  return host ? host->HostChromeBrowser(browser) : nullptr;
}

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

void WhenProfileGone(Profile* profile, base::OnceClosure done) {
  auto* notifier = static_cast<GoneNotifier*>(profile->GetUserData(GoneNotifier::Key()));
  if (!notifier) {
    auto owned = std::make_unique<GoneNotifier>();
    notifier = owned.get();
    profile->SetUserData(GoneNotifier::Key(), std::move(owned));
  }
  notifier->Add(std::move(done));
}
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

void HostPermissionRequest(content::WebContents* contents, NSDictionary* request) {
  if ([g_delegate respondsToSelector:@selector(engine:permissionRequest:tab:)]) {
    [g_delegate engine:g_engine
        permissionRequest:request
                      tab:TabBridge::GetOrCreate(contents)->tab()];
  }
}

namespace {

std::string InstallPromptTypeName(extensions::InstallPromptData::PromptType type) {
  switch (type) {
    case extensions::InstallPromptData::INSTALL_PROMPT:
      return "install";
    case extensions::InstallPromptData::RE_ENABLE_PROMPT:
      return "re-enable";
    case extensions::InstallPromptData::PERMISSIONS_PROMPT:
      return "permissions";
    case extensions::InstallPromptData::EXTERNAL_INSTALL_PROMPT:
      return "external";
    case extensions::InstallPromptData::REMOTE_INSTALL_PROMPT:
      return "remote";
    case extensions::InstallPromptData::REPAIR_PROMPT:
      return "repair";
    default:
      return "other";
  }
}

using InstallDone = extensions::ExtensionInstallPromptClient::DoneCallback;

struct PendingInstall {
  InstallDone done;
  base::WeakPtr<Profile> profile;
};

std::map<std::string, PendingInstall>& InstallPrompts() {
  static base::NoDestructor<std::map<std::string, PendingInstall>> prompts;
  return *prompts;
}

}

bool HostExtensionInstallPrompt(Profile* profile,
                                content::WebContents* parent,
                                const extensions::InstallPromptData& prompt,
                                InstallDone* done_callback) {
  const extensions::Extension* extension = prompt.extension();
  if (!extension || !done_callback || done_callback->is_null() ||
      ![g_delegate respondsToSelector:@selector(engine:extensionInstallPrompt:tab:)]) {
    return false;
  }
  if (prompt.type() == extensions::InstallPromptData::EXTERNAL_INSTALL_PROMPT) {
    using Payload = extensions::ExtensionInstallPromptClient::DoneCallbackPayload;
    using Result = extensions::ExtensionInstallPromptClient::Result;
    content::GetUIThreadTaskRunner({})->PostTask(
        FROM_HERE,
        base::BindOnce(std::move(*done_callback), Payload(Result::ABORTED)));
    return true;
  }
  static int last_id = 0;
  const std::string request_id = "install" + std::to_string(++last_id);
  NSMutableArray* permissions = [NSMutableArray array];
  for (size_t i = 0; i < prompt.GetPermissionCount(); ++i) {
    [permissions addObject:NS(prompt.GetPermission(i))];
  }
  NSString* icon = @"";
  if (!prompt.icon().IsEmpty()) {
    if (auto png = prompt.icon().As1xPNGBytes(); png && png->size()) {
      icon = NS("data:image/png;base64," +
                base::Base64Encode(base::span<const uint8_t>(*png)));
    }
  }
  NSDictionary* payload = @{
    @"requestId" : NS(request_id),
    @"profile" : NS(profile->GetOriginalProfile()->GetBaseName().value()),
    @"id" : NS(extension->id()),
    @"name" : NS(extension->name()),
    @"version" : NS(extension->VersionString()),
    @"type" : NS(InstallPromptTypeName(prompt.type())),
    @"icon" : icon,
    @"permissions" : permissions,
  };
  InstallPrompts()[request_id] = {std::move(*done_callback), profile->GetWeakPtr()};
  ArdiaCoreTab* tab = parent ? TabBridge::GetOrCreate(parent)->tab() : nil;
  dispatch_async(dispatch_get_main_queue(), ^{
    [g_delegate engine:g_engine extensionInstallPrompt:payload tab:tab];
  });
  return true;
}

void ResolveExtensionInstallPrompt(const std::string& request_id, bool accepted) {
  auto it = InstallPrompts().find(request_id);
  if (it == InstallPrompts().end()) {
    return;
  }
  PendingInstall pending = std::move(it->second);
  InstallPrompts().erase(it);
  if (!pending.profile) {
    return;
  }
  InstallDone done = std::move(pending.done);
  using Payload = extensions::ExtensionInstallPromptClient::DoneCallbackPayload;
  using Result = extensions::ExtensionInstallPromptClient::Result;
  std::move(done).Run(Payload(accepted ? Result::ACCEPTED : Result::USER_CANCELED));
}

void HostCastRoutes(Profile* profile, NSArray* routes) {
  if ([g_delegate respondsToSelector:@selector(engine:castRoutes:profile:)]) {
    [g_delegate engine:g_engine castRoutes:routes profile:[ArdiaCoreProfile wrapperFor:profile]];
  }
}

bool HostWantsCastDialogs() {
  return [g_delegate respondsToSelector:@selector(engine:castDialog:tab:)];
}

void HostCastDialog(content::WebContents* contents, NSDictionary* state) {
  if (HostWantsCastDialogs()) {
    [g_delegate engine:g_engine castDialog:state tab:TabBridge::GetOrCreate(contents)->tab()];
  }
}

bool HostWantsDeviceChoosers() {
  return [g_delegate respondsToSelector:@selector(engine:deviceChooser:tab:)];
}

void HostDeviceChooser(content::WebContents* contents, NSDictionary* state) {
  if (HostWantsDeviceChoosers()) {
    [g_delegate engine:g_engine
         deviceChooser:state
                   tab:TabBridge::GetOrCreate(contents)->tab()];
  }
}

bool HostExtensionSidePanel(content::WebContents* contents,
                            const std::string& extension_id,
                            bool open) {
  if (![g_delegate respondsToSelector:@selector(engine:extensionSidePanel:tab:)]) {
    return false;
  }
  [g_delegate engine:g_engine
      extensionSidePanel:@{@"extensionId" : NS(extension_id), @"open" : @(open)}
                     tab:TabBridge::GetOrCreate(contents)->tab()];
  return true;
}

bool HostExtensionActionPopup(content::WebContents* contents,
                              const std::string& extension_id) {
  if (![g_delegate respondsToSelector:@selector(engine:extensionActionPopup:tab:)]) {
    return false;
  }
  return [g_delegate engine:g_engine
       extensionActionPopup:@{@"extensionId" : NS(extension_id)}
                        tab:TabBridge::GetOrCreate(contents)->tab()];
}

bool HostReservesKey(NSString* key, NSString* unshifted_key, unsigned long modifiers) {
  return [g_delegate respondsToSelector:@selector(engineIsReservedKey:unshiftedKey:modifiers:)] &&
         [g_delegate engineIsReservedKey:key unshiftedKey:unshifted_key modifiers:modifiers];
}

bool HostExtensionActionShortcut(content::WebContents* contents,
                                 const std::string& extension_id) {
  if (![g_delegate respondsToSelector:@selector(engine:extensionActionShortcut:tab:)]) {
    return false;
  }
  return [g_delegate engine:g_engine
      extensionActionShortcut:@{@"extensionId" : NS(extension_id)}
                          tab:TabBridge::GetOrCreate(contents)->tab()];
}

void HostPermissionRequestDismissed(NSString* request_id) {
  if ([g_delegate respondsToSelector:@selector(engine:permissionRequestDismissed:)]) {
    [g_delegate engine:g_engine permissionRequestDismissed:request_id];
  }
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
  g_ardia_browser_window_factory = &WindowForChromeBrowser;
  ardiacore::InstallRuleMatchedHook();
  ardiacore::InstallExtensionInstalledHook();
  ardiacore::InstallActionPopupHook();
  g_ardia_reserved_accelerator = [](const ui::Accelerator& accelerator) {
    NSEvent* event = NSApp.currentEvent;
    return event.type == NSEventTypeKeyDown &&
           ardiacore::ExtensionShortcuts::AcceleratorFor(event) == accelerator &&
           [g_delegate respondsToSelector:@selector(engineIsReservedKeyEvent:)] &&
           [g_delegate engineIsReservedKeyEvent:event];
  };
  g_ardia_reserved_global_accelerator = &ardiacore::IsReservedGlobalAccelerator;
  g_ardia_global_shortcuts_resumed = &ardiacore::GlobalShortcutsResumed;
  g_ardia_history_eligible = [](content::WebContents* contents) {
    BrowserWindowInterface* browser =
        GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
    ardiacore::WindowHost* host = browser ? ardiacore::WindowHost::ForBrowser(browser) : nullptr;
    return !host || !host->internal();
  };
  AppShortcutManager::SuppressShortcutsForTesting();
  ardiacore::SetLifetimeCallbacks({
      .quit_cancelled = base::BindRepeating([] {
        if ([g_delegate respondsToSelector:@selector(engineQuitCancelled)]) {
          [g_delegate engineQuitCancelled];
        }
      }),
  });
  ardiacore::SetEngineCallbacks({
      .started = base::BindOnce([] {
        StartApplyingProfilePrefs();
        ardia::StartTabHistoryCleaner();
        ardiacore::InstallPermissionPrompts();
        ardiacore::StartMediaCaptureObserver();
        ardiacore::InstallExternalAppPrompts();
        ardiacore::StartPictureInPictureObserver();
        ardiacore::StartHostVisibility();
        ardiacore::StartVideoUpscaling();
        [g_delegate engineDidStart];
      }),
      .shutting_down = base::BindOnce([] {
        ardiacore::CloseAllExtensionViews();
        if ([g_delegate respondsToSelector:@selector(engineWillShutDown)]) {
          [g_delegate engineWillShutDown];
        }
      }),
  });

  std::vector<const char*> args(argv, argv + argc);
  static std::string features = "--enable-features=WebContentsDiscard";
  bool merged = false;
  for (const char*& arg : args) {
    if (strncmp(arg, "--enable-features=", 18) == 0 && !merged) {
      features = std::string(arg) + ",WebContentsDiscard";
      arg = features.c_str();
      merged = true;
    }
  }
  if (!merged) {
    args.push_back(features.c_str());
  }
  int rv = ChromeMain(static_cast<int>(args.size()), args.data());
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

- (void)resolvePermission:(NSString*)requestId
                   result:(NSString*)result
                 remember:(BOOL)remember {
  ardiacore::ResolvePermission(base::SysNSStringToUTF8(requestId),
                            base::SysNSStringToUTF8(result), remember);
}

static bool g_tracing = false;

namespace {

struct TracingStart {
  void (^completion)(BOOL);
  bool answered = false;
  int session = 0;
};

int g_tracing_session = 0;
std::weak_ptr<TracingStart>& PendingTracingStart() {
  static base::NoDestructor<std::weak_ptr<TracingStart>> pending;
  return *pending;
}

constexpr int kTracingStartChecks = 100;

bool IsCurrent(const TracingStart& start) {
  return start.session == g_tracing_session;
}

void AnswerTracingStart(const std::shared_ptr<TracingStart>& start, bool started) {
  if (start->answered) {
    return;
  }
  start->answered = true;
  if (!started && IsCurrent(*start)) {
    g_tracing = false;
  }
  start->completion(started);
}

void WatchTracingStart(std::shared_ptr<TracingStart> start, int checks_left) {
  if (start->answered) {
    return;
  }
  if (!IsCurrent(*start)) {
    AnswerTracingStart(start, false);
    return;
  }
  content::TracingController* tracing = content::TracingController::GetInstance();
  if (!tracing->IsTracing()) {
    AnswerTracingStart(start, false);
    return;
  }
  if (checks_left == 0) {
    AnswerTracingStart(start, false);
    tracing->StopTracing(nullptr);
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE, base::BindOnce(&WatchTracingStart, std::move(start), checks_left - 1),
      base::Milliseconds(100));
}

}

+ (void)beginTracing:(void (^)(BOOL started))completion {
  if (g_tracing) {
    completion(NO);
    return;
  }
  auto start = std::make_shared<TracingStart>();
  start->completion = completion;
  start->session = ++g_tracing_session;
  PendingTracingStart() = start;
  g_tracing = content::TracingController::GetInstance()->StartTracing(
      base::trace_event::TraceConfig(),
      base::BindOnce(
          [](std::shared_ptr<TracingStart> start) {
            if (start->answered) {
              if (IsCurrent(*start) && !g_tracing) {
                content::TracingController::GetInstance()->StopTracing(nullptr);
              }
              return;
            }
            AnswerTracingStart(start, true);
          },
          start));
  if (!g_tracing) {
    AnswerTracingStart(start, false);
    return;
  }
  WatchTracingStart(start, kTracingStartChecks);
}

+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString* _Nullable path))completion {
  if (!g_tracing) {
    completion(nil);
    return;
  }
  g_tracing = false;
  ++g_tracing_session;
  if (std::shared_ptr<TracingStart> pending = PendingTracingStart().lock()) {
    AnswerTracingStart(pending, false);
  }
  NSDateFormatter* format = [[NSDateFormatter alloc] init];
  format.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  format.dateFormat = @"yyyy-MM-dd 'at' HH.mm.ss.SSS";
  NSString* folder =
      keep ? [NSFileManager.defaultManager URLsForDirectory:NSDownloadsDirectory
                                                  inDomains:NSUserDomainMask]
                 .firstObject.path
           : NSTemporaryDirectory();
  [NSFileManager.defaultManager createDirectoryAtPath:folder
                          withIntermediateDirectories:YES
                                           attributes:nil
                                                error:nil];
  NSString* path = [folder
      stringByAppendingPathComponent:[NSString stringWithFormat:@"Ardia Trace %@.json",
                                                                [format stringFromDate:NSDate.date]]];
  const bool stopped = content::TracingController::GetInstance()->StopTracing(
      content::TracingController::CreateFileEndpoint(
          base::FilePath(base::SysNSStringToUTF8(path)),
          base::BindOnce(
              [](NSString* path, BOOL keep, void (^completion)(NSString*)) {
                if (keep) {
                  completion(path);
                } else {
                  [NSFileManager.defaultManager removeItemAtPath:path error:nil];
                  completion(nil);
                }
              },
              path, keep, completion)));
  if (!stopped) {
    completion(nil);
  }
}

+ (BOOL)isTracing {
  return g_tracing;
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

+ (BOOL)isReservedGlobalShortcut:(NSString*)shortcut {
  return ardiacore::IsReservedGlobalShortcut(shortcut);
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
  g_auto_picture_in_picture = enabled;
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

@implementation ArdiaCoreProfile {
  base::WeakPtr<Profile> _profile;
  std::unique_ptr<ProfileGoneObserver> _observer;
  std::unique_ptr<ComponentBackgroundObserver> _backgroundObserver;
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
  _backgroundObserver.reset();
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

- (void)watchComponentExtensionBackground:(NSString*)extensionId
                                  onLoad:(void (^)(void))onLoad {
  _backgroundObserver.reset();
  if (_profile && extensionId.length && onLoad) {
    _backgroundObserver = std::make_unique<ComponentBackgroundObserver>(
        _profile.get(), base::SysNSStringToUTF8(extensionId), onLoad);
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

@implementation ArdiaCoreWindow {
  std::unique_ptr<ardiacore::WindowHost> _host;
}

@synthesize delegate = _delegate;

- (instancetype)initWithContentRect:(NSRect)rect {
  if ((self = [super init])) {
    _host = std::make_unique<ardiacore::WindowHost>(self,
                                                 gfx::ScreenRectFromNSRect(rect));
  }
  return self;
}

- (ardiacore::WindowHost*)host {
  return _host.get();
}

- (NSWindow*)window {
  return _host->ns_window();
}

- (NSView*)hostView {
  return _host->host_view();
}

- (ArdiaCoreTab*)openTab:(NSString*)url
              profile:(ArdiaCoreProfile*)profile
           foreground:(BOOL)foreground {
  Browser* browser = _host->BrowserFor(profile.chromeProfile);
  if (!browser) {
    return nil;
  }
  const bool ahead = !url.length;
  NavigateParams params(browser, GURL(ahead ? "about:blank" : base::SysNSStringToUTF8(url)),
                        ui::PAGE_TRANSITION_TYPED);
  params.disposition = foreground ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                                  : WindowOpenDisposition::NEW_BACKGROUND_TAB;
  params.window_action = NavigateParams::WindowAction::kNoAction;
  base::AutoReset<ardiacore::WindowHost::PendingOpen> pending(
      &_host->pending_open(), ardiacore::WindowHost::PendingOpen{params.disposition, nullptr});
  Navigate(&params);
  content::WebContents* contents = params.navigated_or_inserted_contents;
  if (!contents) {
    return nil;
  }
  ardiacore::TabBridge* bridge = ardiacore::TabBridge::GetOrCreate(contents);
  if (ahead) {
    bridge->set_made_ahead();
    ardiacore::MarkAheadBlank(contents);
  }
  return bridge->tab();
}

- (ArdiaCoreTab*)openExtensionView:(NSString*)url
                        profile:(ArdiaCoreProfile*)profile
                           kind:(NSString*)kind {
  content::WebContents* contents = ardiacore::OpenExtensionView(
      _host->BrowserFor(profile.chromeProfile), GURL(base::SysNSStringToUTF8(url)),
      [kind isEqualToString:@"sidePanel"] ? ardiacore::ExtensionViewKind::kSidePanel
                                          : ardiacore::ExtensionViewKind::kPopup);
  return contents ? ardiacore::TabBridge::GetOrCreate(contents)->tab() : nil;
}

- (ArdiaCoreProfile*)activeProfile {
  Profile* profile = _host->active_profile();
  return profile ? [ArdiaCoreProfile wrapperFor:profile] : nil;
}

- (void)setActiveProfile:(ArdiaCoreProfile*)profile {
  if (profile.chromeProfile) {
    _host->BrowserFor(profile.chromeProfile);
    _host->SetActiveProfile(profile.chromeProfile);
  }
}

- (void)activateTab:(ArdiaCoreTab*)tab {
  if (ardiacore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self activateTab:tab];
    });
    return;
  }
  content::WebContents* contents = tab.contents;
  if (!contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser) {
    return;
  }
  auto focusing = ardiacore::TabBridge::GetOrCreate(contents)->HostFocuses();
  _host->NoteHostActivated(static_cast<Browser*>(browser));
  TabStripModel* model = browser->GetTabStripModel();
  int index = model->GetIndexOfWebContents(contents);
  if (index != TabStripModel::kNoTab && index != model->active_index()) {
    model->ActivateTabAt(index);
  }
}

- (NSArray<ArdiaCoreTab*>*)tabsForProfile:(ArdiaCoreProfile*)profile {
  NSMutableArray* tabs = [NSMutableArray array];
  Browser* browser = _host->ExistingBrowserFor(profile.chromeProfile);
  if (!browser) {
    return tabs;
  }
  TabStripModel* model = browser->GetTabStripModel();
  for (int i = 0; i < model->count(); ++i) {
    [tabs addObject:ardiacore::TabBridge::GetOrCreate(model->GetWebContentsAt(i))
                        ->tab()];
  }
  return tabs;
}

- (int)chromeWindowIdForProfile:(ArdiaCoreProfile*)profile {
  Browser* browser = _host->ExistingBrowserFor(profile.chromeProfile);
  return browser ? browser->GetSessionID().id() : -1;
}

- (BOOL)executeChromeCommand:(int)commandId profile:(ArdiaCoreProfile*)profile {
  Browser* browser = _host->ExistingBrowserFor(profile.chromeProfile);
  return browser && chrome::ExecuteCommand(browser, commandId);
}

- (BOOL)internal {
  return _host->internal();
}

- (void)setInternal:(BOOL)internal {
  _host->set_internal(internal);
}

- (void)showInactive {
  _host->ShowInactive();
}

- (BOOL)actedFullScreen {
  return _host->acted_fullscreen();
}

- (void)setActedFullScreen:(BOOL)acted {
  _host->set_acted_fullscreen(acted);
}

- (void)adoptTab:(ArdiaCoreTab*)tab {
  if (ardiacore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self adoptTab:tab];
    });
    return;
  }
  content::WebContents* contents = tab.contents;
  if (!contents) {
    return;
  }
  BrowserWindowInterface* from =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  Browser* to = _host->BrowserFor(
      Profile::FromBrowserContext(contents->GetBrowserContext()));
  if (!from || !to || from == to) {
    return;
  }
  TabStripModel* source = from->GetTabStripModel();
  const int index = source->GetIndexOfWebContents(contents);
  if (index == TabStripModel::kNoTab) {
    return;
  }
  std::unique_ptr<tabs::TabModel> moved = source->DetachTabAtForInsertion(index);
  if (!moved) {
    return;
  }
  TabStripModel* target = to->GetTabStripModel();
  target->InsertDetachedTabAt(target->count(), std::move(moved),
                              AddTabTypes::ADD_NONE);
}

- (void)placeTab:(ArdiaCoreTab*)tab index:(int)index pinned:(BOOL)pinned {
  if (ardiacore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self placeTab:tab index:index pinned:pinned];
    });
    return;
  }
  content::WebContents* contents = tab.contents;
  if (!contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser || ardiacore::WindowHost::ForBrowser(browser) != _host.get()) {
    return;
  }
  TabStripModel* model = browser->GetTabStripModel();
  int at = model->GetIndexOfWebContents(contents);
  if (at == TabStripModel::kNoTab) {
    return;
  }
  if (model->IsTabPinned(at) != static_cast<bool>(pinned)) {
    at = model->SetTabPinned(at, pinned);
  }
  const int pinned_count = model->IndexOfFirstNonPinnedTab();
  int to = std::clamp(index, 0, model->count() - 1);
  to = pinned ? std::min(to, pinned_count - 1) : std::max(to, pinned_count);
  if (to != at) {
    model->MoveWebContentsAt(at, to, false);
  }
}

- (ArdiaCoreTab*)restoreTab:(NSString*)state
                 profile:(ArdiaCoreProfile*)profile
              foreground:(BOOL)foreground {
  if (ardiacore::IsNotifyingTabStrip()) {
    return nil;
  }
  std::optional<std::vector<uint8_t>> bytes =
      state ? base::Base64Decode(base::SysNSStringToUTF8(state)) : std::nullopt;
  Browser* browser = profile.chromeProfile ? _host->BrowserFor(profile.chromeProfile) : nullptr;
  if (!bytes || bytes->empty() || !browser) {
    return nil;
  }
  base::Pickle pickle = base::Pickle::WithUnownedBuffer(*bytes);
  base::PickleIterator it(pickle);
  int version = 0, selected = 0, count = 0;
  if (!it.ReadInt(&version) || version != 1 || !it.ReadInt(&selected) ||
      !it.ReadInt(&count) || count <= 0 || count > 1000) {
    return nil;
  }
  std::vector<sessions::SerializedNavigationEntry> navigations;
  for (int i = 0; i < count; ++i) {
    sessions::SerializedNavigationEntry entry;
    if (!entry.ReadFromPickle(&it)) {
      return nil;
    }
    navigations.push_back(std::move(entry));
  }
  selected = std::clamp(selected, 0, count - 1);
  base::AutoReset<ardiacore::WindowHost::PendingOpen> pending(
      &_host->pending_open(),
      ardiacore::WindowHost::PendingOpen{
          foreground ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                     : WindowOpenDisposition::NEW_BACKGROUND_TAB,
          nullptr});
  content::WebContents* contents = chrome::AddRestoredTab(
      browser, navigations, browser->GetTabStripModel()->count(), selected,
      std::string(), std::nullopt, foreground,
      false, base::TimeTicks::Now(), base::Time::Now(),
      nullptr, sessions::SerializedUserAgentOverride(),
      {}, false,
      std::nullopt);
  return contents ? ardiacore::TabBridge::GetOrCreate(contents)->tab() : nil;
}

- (ArdiaCoreTab*)duplicateTab:(ArdiaCoreTab*)source
                   profile:(ArdiaCoreProfile*)profile
                foreground:(BOOL)foreground {
  if (ardiacore::IsNotifyingTabStrip()) {
    return nil;
  }
  content::WebContents* contents = source.contents;
  Profile* chrome_profile = profile.chromeProfile;
  if (!contents || !chrome_profile ||
      Profile::FromBrowserContext(contents->GetBrowserContext()) != chrome_profile) {
    return nil;
  }
  Browser* browser = _host->BrowserFor(chrome_profile);
  if (!browser) {
    return nil;
  }
  std::unique_ptr<content::WebContents> copy = contents->Clone();
  content::WebContents* raw = copy.get();
  base::AutoReset<ardiacore::WindowHost::PendingOpen> pending(
      &_host->pending_open(),
      ardiacore::WindowHost::PendingOpen{
          foreground ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                     : WindowOpenDisposition::NEW_BACKGROUND_TAB,
          contents->GetWeakPtr()});
  TabStripModel* model = browser->GetTabStripModel();
  model->InsertWebContentsAt(model->count(), std::move(copy),
                             foreground ? AddTabTypes::ADD_ACTIVE : AddTabTypes::ADD_NONE);
  return ardiacore::TabBridge::GetOrCreate(raw)->tab();
}

- (void)prepareProfile:(ArdiaCoreProfile*)profile {
  if (profile.chromeProfile) {
    _host->BrowserFor(profile.chromeProfile);
  }
}

- (void)close {
  _host->Close();
}

@end

namespace {

std::optional<bool> RunPageCommand(content::WebContents* contents, int command) {
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  PrefService* prefs = profile->GetPrefs();
  CoreTabHelper* core = CoreTabHelper::FromWebContents(contents);
  const int restrictions = core ? core->content_restrictions() : 0;
  switch (command) {
#if BUILDFLAG(ENABLE_PRINTING)
    case IDC_PRINT:
    case IDC_BASIC_PRINT: {
      auto* dialogs = web_modal::WebContentsModalDialogManager::FromWebContents(contents);
      const bool can_print = prefs->GetBoolean(prefs::kPrintingEnabled) && !contents->IsCrashed() &&
                             !(dialogs && dialogs->IsDialogActive()) &&
                             !(restrictions & CONTENT_RESTRICTION_PRINT);
      bool preview = false;
#if BUILDFLAG(ENABLE_PRINT_PREVIEW)
      auto* previews = printing::PrintPreviewDialogController::GetInstance();
      preview = previews && (previews->GetPrintPreviewForContents(contents) ||
                             previews->is_creating_print_preview_dialog());
#endif
      if (!can_print && !(command == IDC_BASIC_PRINT && preview &&
                          prefs->GetBoolean(prefs::kPrintingEnabled))) {
        return false;
      }
      if (command == IDC_PRINT) {
        printing::StartPrint(contents, prefs->GetBoolean(prefs::kPrintPreviewDisabled),
                             false);
      } else {
        printing::StartBasicPrint(contents);
      }
      return true;
    }
#endif
    case IDC_SAVE_PAGE: {
      PrefService* local_state = g_browser_process->local_state();
      content::NavigationEntry* entry = contents->GetController().GetLastCommittedEntry();
      if ((local_state && !local_state->GetBoolean(prefs::kAllowFileSelectionDialogs)) ||
          static_cast<policy::DownloadRestriction>(
              prefs->GetInteger(policy::policy_prefs::kDownloadRestrictions)) ==
              policy::DownloadRestriction::ALL_FILES ||
          (restrictions & CONTENT_RESTRICTION_SAVE) ||
          (entry && !content::IsSavableURL(entry->GetURL()))) {
        return false;
      }
      base::RecordAction(base::UserMetricsAction("SavePage"));
#if BUILDFLAG(ENABLE_PDF)
      if (contents->GetContentsMimeType() == "application/pdf" &&
          chrome_pdf::features::IsOopifPdfEnabled() &&
          pdf_extension_util::MaybeDispatchSaveEvent(contents->GetPrimaryMainFrame())) {
        return true;
      }
#endif
      contents->OnSavePage();
      return true;
    }
    case IDC_DEV_TOOLS_CONSOLE:
    case IDC_DEV_TOOLS_INSPECT:
      DevToolsWindow::OpenDevToolsWindow(
          contents,
          command == IDC_DEV_TOOLS_CONSOLE ? DevToolsToggleAction::ShowConsolePanel()
                                           : DevToolsToggleAction::Inspect(),
          DevToolsOpenedByAction::kMainMenuOrMainShortcut);
      return true;
    case IDC_DEV_TOOLS_TOGGLE: {
      DevToolsWindow* tools = DevToolsWindow::GetInstanceForInspectedWebContents(contents);
      if (tools && tools->IsDocked()) {
        if (content::WebContents* docked = DevToolsWindow::GetInTabWebContents(contents, nullptr)) {
          docked->DispatchBeforeUnload(false);
        }
      } else {
        DevToolsWindow::OpenDevToolsWindow(contents, DevToolsToggleAction::Show(),
                                           DevToolsOpenedByAction::kMainMenuOrMainShortcut);
      }
      return true;
    }
    default:
      return std::nullopt;
  }
}

}

@interface ArdiaCoreInputSuppression : NSObject
- (instancetype)initWithContents:(content::WebContents*)contents;
@end

@implementation ArdiaCoreInputSuppression {
  std::optional<content::WebContents::ScopedIgnoreInputEvents> _ignoring;
}

- (instancetype)initWithContents:(content::WebContents*)contents {
  if ((self = [super init])) {
    _ignoring.emplace(contents->IgnoreInputEvents(std::nullopt));
  }
  return self;
}

- (void)dealloc {
  _ignoring.reset();
}

@end

@implementation ArdiaCoreTab {
  raw_ptr<content::WebContents> _contents;
  int _browserId;
  NSColor* __strong _pageBackgroundColor;
}

@synthesize delegate = _delegate;

- (instancetype)initWithContents:(content::WebContents*)contents {
  if ((self = [super init])) {
    static int lastBrowserId = 0;
    _contents = contents;
    _browserId = ++lastBrowserId;
  }
  return self;
}

- (int)browserId {
  return _browserId;
}

- (BOOL)initialDocumentAccessed {
  return _contents && content::ArdiaHasAccessedInitialMainDocument(_contents);
}

- (BOOL)committedInitial {
  if (!_contents) {
    return NO;
  }
  content::NavigationEntry* entry = _contents->GetController().GetLastCommittedEntry();
  return !entry || entry->IsInitialEntry();
}

+ (NSString*)originForURL:(NSString*)url {
  GURL gurl(base::SysNSStringToUTF8(url ?: @""));
  if (!gurl.is_valid()) {
    return nil;
  }
  const url::Origin origin = url::Origin::Create(gurl);
  const url::SchemeHostPort& tuple = origin.GetTupleOrPrecursorTupleIfOpaque();
  return tuple.IsValid() ? base::SysUTF8ToNSString(tuple.Serialize()) : @"";
}

- (NSString*)committedOrigin {
  if (!_contents) {
    return nil;
  }
  content::NavigationEntry* entry = _contents->GetController().GetLastCommittedEntry();
  if (!entry || entry->IsInitialEntry()) {
    return nil;
  }
  const url::SchemeHostPort& tuple =
      _contents->GetPrimaryMainFrame()->GetLastCommittedOrigin().GetTupleOrPrecursorTupleIfOpaque();
  return tuple.IsValid() ? base::SysUTF8ToNSString(tuple.Serialize()) : @"";
}

- (id)suppressInput {
  return _contents ? [[ArdiaCoreInputSuppression alloc] initWithContents:_contents] : nil;
}

- (NSString*)faviconURL {
  if (!_contents) {
    return nil;
  }
  const GURL& url = ardiacore::TabBridge::GetOrCreate(_contents)->favicon_url();
  return url.is_valid() ? NS(url.spec()) : nil;
}

- (NSString*)themeColor {
  std::optional<SkColor> color = _contents ? _contents->GetThemeColor() : std::nullopt;
  if (!color) {
    return nil;
  }
  return [NSString stringWithFormat:@"#%02x%02x%02x", SkColorGetR(*color),
                                    SkColorGetG(*color), SkColorGetB(*color)];
}

- (BOOL)audible {
  return _contents && _contents->IsCurrentlyAudible();
}

- (BOOL)muted {
  return _contents && _contents->IsAudioMuted();
}

- (void)setMuted:(BOOL)muted {
  if (_contents) {
    _contents->SetAudioMuted(muted);
  }
}

- (void)loadURL:(NSString*)url userInitiated:(BOOL)userInitiated {
  if (!_contents) {
    return;
  }
  content::NavigationController::LoadURLParams params(
      GURL(base::SysNSStringToUTF8(url)));
  if (params.url.SchemeIs(url::kJavaScriptScheme)) {
    ardiacore::EndAheadBlank(_contents);
  }
  params.transition_type = userInitiated
                               ? ui::PageTransitionFromInt(
                                     ui::PAGE_TRANSITION_TYPED |
                                     ui::PAGE_TRANSITION_FROM_ADDRESS_BAR)
                               : ui::PAGE_TRANSITION_AUTO_TOPLEVEL;
  params.has_user_gesture = userInitiated;
  if (ardiacore::OnlyShowedBlank(_contents)) {
    params.should_replace_current_entry = true;
  }
  _contents->GetController().LoadURLWithParams(params);
}

- (void)goToOffset:(int)offset {
  if (_contents && _contents->GetController().CanGoToOffset(offset)) {
    _contents->GetController().GoToOffset(offset);
  }
}

- (void)reloadIgnoringCache {
  if (_contents) {
    _contents->GetController().Reload(content::ReloadType::BYPASSING_CACHE, true);
  }
}

- (NSArray<NSDictionary<NSString*, id>*>*)navigationEntries {
  NSMutableArray* entries = [NSMutableArray array];
  if (!_contents) {
    return entries;
  }
  content::NavigationController& controller = _contents->GetController();
  const int current = controller.GetCurrentEntryIndex();
  for (int i = 0; i < controller.GetEntryCount(); ++i) {
    content::NavigationEntry* entry = controller.GetEntryAtIndex(i);
    [entries addObject:@{
      @"url" : NS(entry->GetURL().spec()),
      @"title" : NS(entry->GetTitle()),
      @"current" : @(i == current),
    }];
  }
  return entries;
}

- (void)executeJavaScript:(NSString*)code {
  if (_contents) {
    ardiacore::EndAheadBlank(_contents);
    ardiacore::PageChannel::GetOrCreate(_contents)->Execute(
        base::SysNSStringToUTF8(code));
  }
}

- (NSDictionary*)securityInfo {
  return ardiacore::SecurityInfoFor(_contents);
}

- (double)zoomFactor {
  return _contents ? blink::ZoomLevelToZoomFactor(
                         zoom::ZoomController::GetZoomLevelForWebContents(_contents))
                   : 1;
}

- (void)setZoomFactor:(double)zoomFactor {
  if (!_contents || zoomFactor <= 0) {
    return;
  }
  if (auto* zoom = zoom::ZoomController::FromWebContents(_contents)) {
    zoom->SetZoomLevel(blink::ZoomFactorToZoomLevel(zoomFactor));
  }
}

- (void)zoomStep:(int)direction {
  if (_contents) {
    zoom::PageZoom::Zoom(_contents, direction > 0   ? content::PAGE_ZOOM_IN
                                    : direction < 0 ? content::PAGE_ZOOM_OUT
                                                    : content::PAGE_ZOOM_RESET);
  }
}

- (double)pinchScale {
  return _contents ? ardiacore::TabBridge::GetOrCreate(_contents)->pinch_scale() : 1;
}

- (BOOL)discard {
  if (!_contents) {
    return NO;
  }
  auto* unit =
      resource_coordinator::TabLifecycleUnitExternal::FromWebContents(_contents);
  return unit && unit->DiscardTab(
                     ::mojom::LifecycleUnitDiscardReason::EXTERNAL);
}

- (BOOL)discarded {
  return _contents && _contents->WasDiscarded();
}

- (BOOL)frozen {
  return _contents && ardiacore::TabBridge::GetOrCreate(_contents)->frozen();
}

- (void)setFrozen:(BOOL)frozen {
  if (frozen && _contents &&
      _contents->GetVisibility() == content::Visibility::VISIBLE) {
    return;
  }
  if (_contents) {
    ardiacore::TabBridge::GetOrCreate(_contents)->set_frozen(frozen);
    _contents->SetPageFrozen(frozen);
  }
}

- (void)resolveUnresponsive:(BOOL)terminate {
  if (_contents) {
    ardiacore::TabBridge::GetOrCreate(_contents)->ResolveUnresponsive(terminate);
  }
}

- (NSColor*)pageBackgroundColor {
  return _pageBackgroundColor;
}

- (NSString*)pageColor {
  if (!_contents) {
    return nil;
  }
  auto* channel = ardiacore::PageChannel::FromWebContents(_contents);
  return channel && !channel->page_color().empty()
             ? base::SysUTF8ToNSString(channel->page_color())
             : nil;
}

- (void)setPageColor:(NSString*)color {
  if (_contents) {
    ardiacore::PageChannel::GetOrCreate(_contents)->SetPageColor(
        color ? base::SysNSStringToUTF8(color) : std::string());
  }
}

- (void)setPageBackgroundColor:(NSColor*)color {
  _pageBackgroundColor = color;
  if (!_contents) {
    return;
  }
  if (!color) {
    ardiacore::SetHostPageBaseBackgroundColor(_contents, std::nullopt);
    return;
  }
  NSColor* rgb = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  ardiacore::SetHostPageBaseBackgroundColor(
      _contents, SkColorSetARGB(rgb.alphaComponent * 255, rgb.redComponent * 255,
                                rgb.greenComponent * 255, rgb.blueComponent * 255));
}

- (NSColor*)contentsBackgroundColor {
  std::optional<SkColor> color =
      _contents ? ardiacore::ContentsBackgroundColor(_contents) : std::nullopt;
  return color ? [NSColor colorWithSRGBRed:SkColorGetR(*color) / 255.0
                                     green:SkColorGetG(*color) / 255.0
                                      blue:SkColorGetB(*color) / 255.0
                                     alpha:1]
               : nil;
}

- (void)setContentsBackgroundColor:(NSColor*)color {
  if (!_contents) {
    return;
  }
  NSColor* rgb = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
  ardiacore::SetContentsBackgroundColor(
      _contents, rgb ? std::optional<SkColor>(SkColorSetRGB(std::lround(rgb.redComponent * 255),
                                                            std::lround(rgb.greenComponent * 255),
                                                            std::lround(rgb.blueComponent * 255)))
                     : std::nullopt);
}

- (NSString*)executeExtensionAction:(NSString*)extensionId {
  if (!_contents) {
    return @"none";
  }
  const extensions::Extension* extension =
      extensions::ExtensionRegistry::Get(_contents->GetBrowserContext())
          ->enabled_extensions()
          .GetByID(base::SysNSStringToUTF8(extensionId));
  auto* runner = extensions::ExtensionActionRunner::GetForWebContents(_contents);
  if (!extension || !runner) {
    return @"none";
  }
  switch (runner->RunAction(extension, true)) {
    case extensions::ExtensionAction::ShowAction::kShowPopup:
      return @"popup";
    case extensions::ExtensionAction::ShowAction::kToggleSidePanel:
      return @"sidePanel";
    case extensions::ExtensionAction::ShowAction::kNone:
      return @"none";
  }
  return @"none";
}

- (NSDictionary<NSString*, NSDictionary*>*)actionStatesForExtensions:
    (NSArray<NSString*>*)extensionIds {
  NSMutableDictionary* states = [NSMutableDictionary dictionary];
  if (!_contents) {
    return states;
  }
  content::BrowserContext* context = _contents->GetBrowserContext();
  const int tab_id = self.tabId;
  for (NSString* extensionId in extensionIds) {
    const extensions::Extension* extension =
        extensions::ExtensionRegistry::Get(context)->enabled_extensions().GetByID(
            base::SysNSStringToUTF8(extensionId));
    extensions::ExtensionAction* action =
        extension ? extensions::ExtensionActionManager::Get(context)
                        ->GetExtensionAction(*extension)
                  : nullptr;
    if (!action) {
      continue;
    }
    gfx::Image icon = action->GetExplicitlySetIcon(tab_id);
    if (icon.IsEmpty()) {
      icon = action->GetDeclarativeIcon(tab_id);
    }
    NSString* badge = NS(action->GetDisplayBadgeText(tab_id));
    states[extensionId] = @{
      @"title" : NS(action->GetTitle(tab_id)),
      @"badgeText" : [badge hasPrefix:@"<<"] ? @"" : badge,
      @"badgeColor" : HexColor(action->GetBadgeBackgroundColor(tab_id)),
      @"badgeTextColor" : HexColor(action->GetBadgeTextColor(tab_id)),
      @"popup" : NS(action->GetPopupUrl(tab_id).spec()),
      @"enabled" : @(action->GetIsVisible(tab_id)),
      @"icon" : PngDataURL(icon),
    };
  }
  return states;
}

- (NSString*)sidePanelURLForExtension:(NSString*)extensionId {
  if (!_contents) {
    return nil;
  }
  content::BrowserContext* context = _contents->GetBrowserContext();
  const extensions::Extension* extension =
      extensions::ExtensionRegistry::Get(context)->enabled_extensions().GetByID(
          base::SysNSStringToUTF8(extensionId));
  auto* service = extension ? extensions::SidePanelService::Get(context) : nullptr;
  if (!service) {
    return nil;
  }
  auto options = service->GetOptions(*extension, self.tabId);
  if (!options.path || !options.enabled.value_or(false)) {
    return nil;
  }
  return NS(extension->GetResourceURL(*options.path).spec());
}

- (void)openBlockedPopup:(NSString*)popupId always:(BOOL)always {
  if (ardiacore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self openBlockedPopup:popupId always:always];
    });
    return;
  }
  if (!_contents) {
    return;
  }
  auto* popups = blocked_content::PopupBlockerTabHelper::FromWebContents(_contents);
  int id_number = 0;
  if (!popups || !base::StringToInt(base::SysNSStringToUTF8(popupId), &id_number) ||
      !popups->GetBlockedPopupRequests().contains(id_number)) {
    return;
  }
  if (always) {
    HostContentSettingsMapFactory::GetForProfile(_contents->GetBrowserContext())
        ->SetContentSettingDefaultScope(_contents->GetLastCommittedURL(), GURL(),
                                        ContentSettingsType::POPUPS,
                                        CONTENT_SETTING_ALLOW);
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  ardiacore::WindowHost* host = ardiacore::WindowHost::ForBrowser(browser);
  std::optional<base::AutoReset<ardiacore::WindowHost::PendingOpen>> pending;
  if (host) {
    pending.emplace(&host->pending_open(),
                    ardiacore::WindowHost::PendingOpen{
                        WindowOpenDisposition::NEW_FOREGROUND_TAB,
                        _contents->GetWeakPtr()});
  }
  popups->ShowBlockedPopup(id_number, WindowOpenDisposition::NEW_FOREGROUND_TAB);
}

- (BOOL)executeChromeCommand:(int)command {
  if (ardiacore::IsNotifyingTabStrip()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self executeChromeCommand:command];
    });
    return YES;
  }
  if (!_contents) {
    return NO;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  if (!browser) {
    return NO;
  }
  TabStripModel* model = browser->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(_contents);
  const int active = model->active_index();
  if (index == TabStripModel::kNoTab) {
    return NO;
  }
  if (index == active) {
    return chrome::ExecuteCommand(browser, command);
  }
  if (std::optional<bool> ran = RunPageCommand(_contents, command)) {
    return *ran;
  }
  if (command == IDC_CARET_BROWSING_TOGGLE) {
    return chrome::ExecuteCommand(browser, command);
  }
  return NO;
}

- (void)devToolsCall:(NSString*)method
              params:(NSDictionary*)params
          completion:(void (^)(NSDictionary* result, NSString* error))completion {
  [self devToolsCall:method params:params timeout:0 completion:completion];
}

- (void)devToolsCall:(NSString*)method
              params:(NSDictionary*)params
             timeout:(NSTimeInterval)timeout
          completion:(void (^)(NSDictionary* result, NSString* error))completion {
  base::DictValue dict;
  if (params.count) {
    NSData* data = [NSJSONSerialization dataWithJSONObject:params options:0 error:nil];
    std::optional<base::DictValue> parsed =
        data ? base::JSONReader::ReadDict(
                   std::string_view(static_cast<const char*>(data.bytes), data.length),
                   base::JSON_PARSE_RFC)
             : std::nullopt;
    if (!parsed) {
      dispatch_async(dispatch_get_main_queue(), ^{
        completion(nil, @"params aren't JSON");
      });
      return;
    }
    dict = std::move(*parsed);
  }
  ardiacore::CallDevTools(
      _contents, base::SysNSStringToUTF8(method), std::move(dict),
      timeout > 0 ? std::optional<base::TimeDelta>(base::Seconds(timeout)) : std::nullopt,
      base::BindOnce(
          [](void (^completion)(NSDictionary*, NSString*),
             std::optional<base::DictValue> result, std::optional<std::string> error) {
            if (!result) {
              completion(nil, base::SysUTF8ToNSString(error.value_or("error")));
              return;
            }
            std::optional<std::string> json = base::WriteJson(*result);
            NSData* data = json ? [NSData dataWithBytes:json->data() length:json->size()] : nil;
            id object = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
                             : nil;
            if (![object isKindOfClass:NSDictionary.class]) {
              completion(nil, @"the reply isn't JSON");
              return;
            }
            completion(object, nil);
          },
          completion));
}

- (NSString*)mediaCaptureSourceId {
  content::RenderFrameHost* frame =
      _contents ? _contents->GetPrimaryMainFrame() : nullptr;
  if (!frame || !frame->IsRenderFrameLive()) {
    return nil;
  }
  return NS(content::WebContentsMediaCaptureId(frame->GetProcess()->GetDeprecatedID(),
                                               frame->GetRoutingID())
                .ToString());
}

- (void)copyPicture:(NSTimeInterval)timeout completion:(void (^)(CGImageRef))completion {
  content::RenderWidgetHostView* view =
      _contents ? _contents->GetRenderWidgetHostView() : nullptr;
  if (!view || !view->IsSurfaceAvailableForCopy()) {
    completion(nullptr);
    return;
  }
  void (^done)(CGImageRef) = [completion copy];
  view->CopyFromSurface(
      gfx::Rect(), gfx::Size(), base::Seconds(timeout),
      base::BindOnce(^(const content::CopyFromSurfaceResult& result) {
        CGImageRef image = result.has_value() ? CreatePicture(result->bitmap) : nullptr;
        content::GetUIThreadTaskRunner({})->PostTask(FROM_HERE, base::BindOnce(^{
                                                       done(image);
                                                       if (image) {
                                                         CGImageRelease(image);
                                                       }
                                                     }));
      }));
}

- (BOOL)stopCapture {
  if (!_contents) {
    return NO;
  }
  scoped_refptr<MediaStreamCaptureIndicator> indicator =
      MediaCaptureDevicesDispatcher::GetInstance()->GetMediaStreamCaptureIndicator();
  const bool capturing = indicator->IsCapturingTab(_contents) ||
                         indicator->IsCapturingWindow(_contents) ||
                         indicator->IsCapturingDisplay(_contents);
  indicator->StopMediaCapturing(_contents,
                                MediaStreamCaptureIndicator::MediaType::kDisplayMedia);
  return capturing;
}

- (void)noteShownByHost:(BOOL)shown {
  if (_contents) {
    ardiacore::NoteTabShownByHost(_contents, shown);
  }
}

- (void)exitFullscreen {
  if (_contents && _contents->IsFullscreen()) {
    _contents->ExitFullscreen(true);
  }
}

- (void)exitExclusiveAccess {
  if (!_contents) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  ExclusiveAccessManager* manager =
      browser ? ExclusiveAccessManager::From(browser) : nullptr;
  if (manager) {
    manager->OnTabDeactivated(_contents);
  }
}

- (void)tracePictureInPicture:(NSString*)line withInputs:(BOOL)withInputs {
  if (!ardiacore::PictureInPictureTracing()) {
    return;
  }
  if (withInputs && _contents) {
    ardiacore::TraceAutoPictureInPictureInputs(_contents, line.UTF8String);
  } else {
    ardiacore::TracePictureInPicture(base::SysNSStringToUTF8(line));
  }
}

- (BOOL)autoPictureInPictureIsChromes {
  if (!_contents) {
    return NO;
  }
  auto* helper = AutoPictureInPictureTabHelper::FromWebContents(_contents);
  if (!helper) {
    return NO;
  }
  if (helper->IsInAutoPictureInPicture() || helper->AreAutoPictureInPicturePreconditionsMet()) {
    return YES;
  }
  const GURL& url = _contents->GetLastCommittedURL();
  Profile* profile = Profile::FromBrowserContext(_contents->GetBrowserContext());
  return !g_ardia_auto_picture_in_picture_off &&
         helper->HasAutoPictureInPictureBeenRegistered() &&
         (url.SchemeIs(url::kHttpsScheme) || url.SchemeIsFile()) &&
         MediaCaptureDevicesDispatcher::GetInstance()
             ->GetMediaStreamCaptureIndicator()
             ->IsCapturingUserMedia(_contents) &&
         HostContentSettingsMapFactory::GetForProfile(profile)->GetContentSetting(
             url, url, ContentSettingsType::AUTO_PICTURE_IN_PICTURE) == CONTENT_SETTING_ALLOW;
}

- (BOOL)showCastDialog {
  return ardiacore::ShowCastDialog(_contents);
}

- (BOOL)devShowBluetoothChooser:(BOOL)unauthorized {
  return ardiacore::ShowTestBluetoothChooser(_contents, unauthorized);
}

- (NSSize)preferredSize {
  const gfx::Size size =
      _contents ? ardiacore::ExtensionPopupPreferredSize(_contents) : gfx::Size();
  return NSMakeSize(size.width(), size.height());
}

- (NSDictionary<NSString*, NSNumber*>*)popupFeatures {
  ardiacore::TabBridge* bridge =
      _contents ? ardiacore::TabBridge::FromWebContents(_contents) : nullptr;
  return bridge ? bridge->popup_features() : nil;
}

namespace {
TabSharingInfoBarDelegate* TabSharingDelegateFor(content::WebContents* contents,
                                                 content::WebContents* capturer) {
  auto* manager =
      contents ? infobars::ContentInfoBarManager::FromWebContents(contents) : nullptr;
  if (!manager || !capturer) {
    return nullptr;
  }
  TabSharingInfoBarDelegate* found = nullptr;
  for (infobars::InfoBar* infobar : manager->infobars()) {
    if (infobar->delegate()->GetIdentifier() !=
        infobars::InfoBarDelegate::TAB_SHARING_INFOBAR_DELEGATE) {
      continue;
    }
    auto* sharing = static_cast<TabSharingInfoBarDelegate*>(infobar->delegate());
    content::RenderFrameHost* frame =
        content::RenderFrameHost::FromID(sharing->capturer_id());
    if (frame && content::WebContents::FromRenderFrameHost(frame) == capturer) {
      if (found) {
        return nullptr;
      }
      found = sharing;
    }
  }
  return found;
}
}

- (BOOL)canShareThisTabInsteadFor:(ArdiaCoreTab*)capturer {
  TabSharingInfoBarDelegate* sharing =
      TabSharingDelegateFor(_contents, capturer.contents);
  return sharing &&
         (sharing->GetButtons() & TabSharingInfoBarDelegate::kShareThisTabInstead) &&
         sharing->IsButtonEnabled(TabSharingInfoBarDelegate::kShareThisTabInstead);
}

- (BOOL)shareThisTabInsteadFor:(ArdiaCoreTab*)capturer {
  if (![self canShareThisTabInsteadFor:capturer]) {
    return NO;
  }
  TabSharingDelegateFor(_contents, capturer.contents)->ShareThisTabInstead();
  return YES;
}

- (BOOL)showAutofillSuggestions:(BOOL)passwords {
  return ardiacore::ShowAutofillSuggestions(_contents, passwords);
}

- (void)executeJavaScript:(NSString*)code frame:(NSString*)frameId {
  if (_contents) {
    ardiacore::EndAheadBlank(_contents);
    ardiacore::PageChannel::GetOrCreate(_contents)->ExecuteInFrame(
        base::SysNSStringToUTF8(frameId), base::SysNSStringToUTF8(code));
  }
}

- (void)evaluate:(NSString*)code completion:(void (^)(NSString*))completion {
  if (!_contents) {
    completion(nil);
    return;
  }
  ardiacore::EndAheadBlank(_contents);
  ardiacore::PageChannel::GetOrCreate(_contents)->Evaluate(
      base::SysNSStringToUTF8(code),
      base::BindOnce(
          [](void (^completion)(NSString*), const std::optional<std::string>& json) {
            completion(json ? NS(*json) : nil);
          },
          completion));
}

- (void)enterPictureInPictureForClickAt:(NSTimeInterval)clickTime
                             completion:(void (^)(NSString* route, BOOL opened))completion {
  if (!_contents) {
    completion(@"none", NO);
    return;
  }
  const ardiacore::PictureInPictureRoute route =
      ardiacore::PageChannel::GetOrCreate(_contents)->EnterPictureInPictureForClick(
          clickTime > 0 ? std::optional<base::TimeTicks>(base::TimeTicks() +
                                                         base::Seconds(clickTime))
                        : std::nullopt,
          base::BindOnce(
              [](void (^completion)(NSString*, BOOL), bool opened) {
                completion(@"element", opened);
              },
              completion));
  if (route == ardiacore::PictureInPictureRoute::kMediaSession) {
    completion(@"session", NO);
  } else if (route == ardiacore::PictureInPictureRoute::kNone) {
    completion(@"none", NO);
  }
}

- (void)exitPictureInPicture {
  if (!_contents) {
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<content::WebContents> contents) {
                       PictureInPictureWindowManager* manager =
                           PictureInPictureWindowManager::GetInstance();
                       if (contents && manager->GetWebContents() == contents.get()) {
                         manager->ExitPictureInPicture();
                       }
                     },
                     _contents->GetWeakPtr()));
}

- (BOOL)hasLiveFrame:(NSString*)frameId {
  return _contents && (!frameId.length ||
                       ardiacore::PageChannel::GetOrCreate(_contents)->HasFrame(
                           base::SysNSStringToUTF8(frameId)));
}

- (void)callPage:(NSString*)kind json:(NSString*)json {
  if (_contents) {
    ardiacore::EndAheadBlank(_contents);
    ardiacore::PageChannel::GetOrCreate(_contents)->CallPage(
        base::SysNSStringToUTF8(kind), base::SysNSStringToUTF8(json));
  }
}

- (void)callFrame:(NSString*)frameId kind:(NSString*)kind json:(NSString*)json {
  if (_contents) {
    ardiacore::EndAheadBlank(_contents);
    ardiacore::PageChannel::GetOrCreate(_contents)->CallFrame(
        base::SysNSStringToUTF8(frameId), base::SysNSStringToUTF8(kind),
        base::SysNSStringToUTF8(json));
  }
}

- (content::WebContents*)contents {
  return _contents;
}

- (void)contentsDestroyed {
  _contents = nullptr;
}

- (void)notify:(SEL)selector {
  id<ArdiaCoreTabDelegate> delegate = _delegate;
  if ([delegate respondsToSelector:selector]) {
    [delegate performSelector:selector withObject:self];
  }
}

- (BOOL)closed {
  return !_contents;
}

- (NSView*)view {
  return _contents ? _contents->GetNativeView().GetNativeNSView() : nil;
}

- (ArdiaCoreProfile*)profile {
  return _contents ? [ArdiaCoreProfile
                         wrapperFor:Profile::FromBrowserContext(
                                        _contents->GetBrowserContext())]
                   : nil;
}

- (int)tabId {
  return _contents ? sessions::SessionTabHelper::IdForTab(_contents).id() : -1;
}

- (NSString*)url {
  return _contents ? NS(_contents->GetVisibleURL().spec()) : @"";
}

- (NSString*)title {
  return _contents ? NS(_contents->GetTitle()) : @"";
}

- (BOOL)loading {
  return _contents && _contents->IsLoading();
}

- (double)progress {
  return _contents ? _contents->GetLoadProgress() : 0;
}

- (NSImage*)favicon {
  if (!_contents) {
    return nil;
  }
  auto* driver = favicon::ContentFaviconDriver::FromWebContents(_contents);
  if (!driver || !driver->FaviconIsValid()) {
    return nil;
  }
  gfx::Image image = driver->GetFavicon();
  return image.IsEmpty() ? nil : image.ToNSImage();
}

- (BOOL)canGoBack {
  return _contents && _contents->GetController().CanGoBack();
}

- (BOOL)canGoForward {
  return _contents && _contents->GetController().CanGoForward();
}

- (void)loadURL:(NSString*)url {
  if (_contents) {
    GURL target(base::SysNSStringToUTF8(url));
    if (target.SchemeIs(url::kJavaScriptScheme)) {
      ardiacore::EndAheadBlank(_contents);
    }
    _contents->GetController().LoadURL(target,
                                       content::Referrer(),
                                       ui::PAGE_TRANSITION_TYPED, std::string());
  }
}

- (void)focus {
  if (_contents) {
    auto focusing = ardiacore::TabBridge::GetOrCreate(_contents)->HostFocuses();
    _contents->Focus();
  }
}

- (void)find:(NSString*)text forward:(BOOL)forward {
  if (!_contents) {
    return;
  }
  ardiacore::TabBridge::GetOrCreate(_contents)->EnsureFindObserved();
  if (auto* helper = find_in_page::FindTabHelper::FromWebContents(_contents)) {
    helper->StartFinding(base::SysNSStringToUTF16(text), forward,
                         false, true);
  }
}

- (void)stopFinding {
  if (!_contents) {
    return;
  }
  if (auto* helper = find_in_page::FindTabHelper::FromWebContents(_contents)) {
    helper->StopFinding(find_in_page::SelectionAction::kKeep);
  }
}

- (void)goBack {
  if (self.canGoBack) {
    _contents->GetController().GoBack();
  }
}

- (void)goForward {
  if (self.canGoForward) {
    _contents->GetController().GoForward();
  }
}

- (void)reload {
  if (_contents) {
    _contents->GetController().Reload(content::ReloadType::NORMAL, true);
  }
}

- (void)loadIfNeeded {
  if (_contents && _contents->GetController().NeedsReload()) {
    _contents->GetController().LoadIfNecessary();
  }
}

- (void)stop {
  if (_contents) {
    _contents->Stop();
  }
}

- (BOOL)temporary {
  return _contents && ardiacore::TabBridge::GetOrCreate(_contents)->temporary();
}

- (void)setTemporary:(BOOL)temporary {
  if (_contents) {
    ardiacore::TabBridge::GetOrCreate(_contents)->SetTemporary(temporary);
  }
}

- (void)deliverHeldPageMessages {
  if (_contents) {
    ardiacore::PageChannel::GetOrCreate(_contents)->DeliverHeld();
  }
}

- (void)setTemporarySource:(ArdiaCoreTab*)source {
  if (_contents) {
    ardiacore::TabBridge::GetOrCreate(_contents)->SetTemporarySource(
        source && source->_contents
            ? sessions::SessionTabHelper::IdForTab(source->_contents).id()
            : 0);
  }
}

- (void)closeNow {
  if (ardiacore::IsNotifyingTabStrip() || ardiacore::IsNotifyingNavigation()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self closeNow];
    });
    return;
  }
  if (!_contents || ardiacore::CloseExtensionView(_contents)) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  if (!browser) {
    return;
  }
  ardiacore::TabBridge::GetOrCreate(_contents)->set_closed_by_host();
  TabStripModel* model = browser->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(_contents);
  if (index == TabStripModel::kNoTab) {
    return;
  }
  content::NavigationEntry* committed = _contents->GetController().GetLastCommittedEntry();
  if (!Profile::FromBrowserContext(_contents->GetBrowserContext())->IsOffTheRecord() &&
      committed && !committed->IsInitialEntry() && !ardiacore::OnlyShowedBlank(_contents)) {
    model->delegate()->CreateHistoricalTab(_contents);
  }
  model->DetachAndDeleteWebContentsAt(index);
}

- (void)close {
  if (ardiacore::IsNotifyingTabStrip() || ardiacore::IsNotifyingNavigation()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self close];
    });
    return;
  }
  if (!_contents || ardiacore::CloseExtensionView(_contents)) {
    return;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(_contents);
  if (!browser) {
    return;
  }
  ardiacore::TabBridge::GetOrCreate(_contents)->set_closed_by_host();
  TabStripModel* model = browser->GetTabStripModel();
  int index = model->GetIndexOfWebContents(_contents);
  if (index != TabStripModel::kNoTab) {
    uint32_t close_types = TabCloseTypes::CLOSE_USER_GESTURE;
    if (!ardiacore::OnlyShowedBlank(_contents)) {
      close_types |= TabCloseTypes::CLOSE_CREATE_HISTORICAL_TAB;
    }
    model->CloseWebContentsAt(index, close_types);
  }
}

- (void)showDevTools {
  if (_contents) {
    DevToolsWindow::OpenDevToolsWindow(_contents, DevToolsToggleAction::Show(),
                                       DevToolsOpenedByAction::kUnknown);
  }
}

- (void)closeDevTools {
  if (!_contents) {
    return;
  }
  if (content::WebContents* devtools =
          DevToolsWindow::GetInTabWebContents(_contents, nullptr)) {
    devtools->ClosePage();
  }
}

- (NSView*)devToolsView {
  if (!_contents) {
    return nil;
  }
  content::WebContents* devtools =
      DevToolsWindow::GetInTabWebContents(_contents, nullptr);
  return devtools ? devtools->GetNativeView().GetNativeNSView() : nil;
}

- (void)devToolsLayoutForSize:(NSSize)size
                     devTools:(NSRect*)devToolsFrame
                         page:(NSRect*)pageFrame {
  DevToolsContentsResizingStrategy strategy;
  gfx::Rect devtools_bounds, page_bounds;
  gfx::Rect container(0, 0, size.width, size.height);
  if (_contents && DevToolsWindow::GetInTabWebContents(_contents, &strategy)) {
    ApplyDevToolsContentsResizingStrategy(strategy, container, &devtools_bounds,
                                          &page_bounds);
  } else {
    page_bounds = container;
  }
  if (devToolsFrame) {
    *devToolsFrame = devtools_bounds.ToCGRect();
  }
  if (pageFrame) {
    *pageFrame = page_bounds.ToCGRect();
  }
}

- (NSDictionary<NSString*, id>*)passwordPrompt {
  return ardiacore::PasswordPrompt(_contents);
}

- (void)resolvePasswordPrompt:(NSString*)action
                     username:(NSString*)username
                     password:(NSString*)password {
  ardiacore::ResolvePasswordPrompt(_contents, action, username, password);
}

- (NSDictionary<NSString*, id>*)autofillPrompt {
  return ardiacore::AutofillPrompt(_contents);
}

- (void)resolveAutofillPrompt:(NSInteger)promptId action:(NSString*)action {
  ardiacore::ResolveAutofillPrompt(_contents, promptId, action);
}

@end
