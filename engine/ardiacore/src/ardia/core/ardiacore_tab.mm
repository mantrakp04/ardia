#import "ardia/core/public/ArdiaCore.h"

#include <optional>
#include <string>

#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/resource_coordinator/lifecycle_unit_state.mojom.h"
#include "chrome/browser/resource_coordinator/tab_lifecycle_unit_external.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/tabs/tab_enums.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/unload_controller.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/find_in_page/find_tab_helper.h"
#include "components/find_in_page/find_types.h"
#include "components/sessions/content/session_tab_helper.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "third_party/skia/include/core/SkColor.h"
#include "ui/gfx/image/image.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "url/scheme_host_port.h"
#include "ardia/core/ac_autofill_prompt.h"
#include "ardia/core/ac_autofill_trigger.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_extension_view.h"
#include "ardia/core/ac_page_channel.h"
#include "ardia/core/ac_password_prompt.h"
#include "ardia/core/ac_tab_info.h"
#import "ardia/core/ardiacore_api_internal.h"
#import "ardia/core/ardiacore_internal.h"
#import "ardia/core/ardiacore_tab_internal.h"

using ardiacore::NS;

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

@implementation ArdiaCoreTab

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

- (NSDictionary*)securityInfo {
  return ardiacore::SecurityInfoFor(_contents);
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

- (BOOL)showAutofillSuggestions:(BOOL)passwords {
  return ardiacore::ShowAutofillSuggestions(_contents, passwords);
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
  if (!_contents) {
    return YES;
  }
  ardiacore::TabBridge* bridge = ardiacore::TabBridge::FromWebContents(_contents);
  return bridge && bridge->closing_after_unload();
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
  ardiacore::TabBridge* bridge = ardiacore::TabBridge::GetOrCreate(_contents);
  if (bridge->closing_after_unload() ||
      browser->GetTabStripModel()->GetIndexOfWebContents(_contents) ==
          TabStripModel::kNoTab) {
    return;
  }
  bridge->set_closed_by_host();
  if (!browser_shutdown::HasShutdownStarted() &&
      _contents->NeedToFireBeforeUnloadOrUnloadEvents()) {
    bridge->CloseAfterUnloadHandlers(
        browser_shutdown::IsTryingToQuit() ||
        UnloadController::From(browser)->is_attempting_to_close_browser());
    return;
  }
  ardiacore::DeleteTabClosedByHost(_contents);
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
