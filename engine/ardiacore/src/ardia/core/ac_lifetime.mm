#include "ardia/core/ac_lifetime.h"

#import <AppKit/AppKit.h>
#include <CoreServices/CoreServices.h>
#import <objc/runtime.h>

#include <string.h>

#include <utility>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#import "chrome/browser/app_controller_mac.h"
#include "chrome/browser/browser_process.h"
#import "chrome/browser/chrome_browser_application_mac.h"
#include "chrome/browser/devtools/chrome_devtools_manager_delegate.h"
#include "chrome/browser/download/download_core_service.h"
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/lifetime/application_lifetime_desktop.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_attributes_entry.h"
#include "chrome/browser/profiles/profile_attributes_storage.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profiles_state.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/color_provider_browser_helper.h"
#include "ui/color/color_provider.h"
#include "ui/color/color_provider_source.h"
#include "ui/color/color_provider_manager.h"
#include "ui/native_theme/native_theme.h"
#include <vector>
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_main_delegate.h"
#include "ardia/core/ac_launch_switches.h"

namespace ardiacore {

namespace {

enum class QuitPhase { kNone, kAskingHost, kAskingDownloads, kClosing, kCancelling, kExiting };
QuitPhase g_phase = QuitPhase::kNone;
int g_quit_generation = 0;

LifetimeCallbacks& Callbacks() {
  static base::NoDestructor<LifetimeCallbacks> callbacks;
  return *callbacks;
}

base::CallbackListSubscription& ClosingAllBrowsersSubscription() {
  static base::NoDestructor<base::CallbackListSubscription> subscription;
  return *subscription;
}

void QuitCancelled() {
  if (g_phase == QuitPhase::kNone || g_phase == QuitPhase::kCancelling ||
      g_phase == QuitPhase::kExiting) {
    return;
  }
  g_phase = QuitPhase::kCancelling;
  browser_shutdown::SetTryingToQuit(false);
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce([] {
        g_phase = QuitPhase::kNone;
        NotifyWindowsQuitCancelled();
        if (Callbacks().quit_cancelled) {
          Callbacks().quit_cancelled.Run();
        }
      }));
}

void StartQuit() {
  g_phase = QuitPhase::kClosing;
  chrome::OnClosingAllBrowsers(true);
  chrome::CloseAllBrowsersAndQuit();
}

void Terminate() {
  if (g_phase != QuitPhase::kNone) {
    return;
  }
  id<NSApplicationDelegate> delegate = NSApp.delegate;
  if (![delegate respondsToSelector:@selector(applicationShouldTerminate:)]) {
    QuitEngine();
    return;
  }
  const int attempt = ++g_quit_generation;
  g_phase = QuitPhase::kAskingHost;
  const NSApplicationTerminateReply reply = [delegate applicationShouldTerminate:NSApp];
  if (attempt != g_quit_generation || g_phase != QuitPhase::kAskingHost) {
    return;
  }
  switch (reply) {
    case NSTerminateNow:
      g_phase = QuitPhase::kNone;
      QuitEngine();
      break;
    case NSTerminateLater:
      break;
    case NSTerminateCancel:
      QuitCancelled();
      break;
  }
}

}

bool IsQuitting() {
  return g_phase != QuitPhase::kNone;
}

void SetLifetimeCallbacks(LifetimeCallbacks callbacks) {
  Callbacks() = std::move(callbacks);
}

void QuitEngine() {
  if (g_phase != QuitPhase::kNone || browser_shutdown::IsTryingToQuit()) {
    return;
  }
  const int generation = ++g_quit_generation;
  const int downloads = DownloadCoreService::BlockingShutdownCountAllProfiles();
  if (downloads == 0) {
    StartQuit();
    return;
  }
  g_phase = QuitPhase::kAskingDownloads;
  ConfirmQuitWithDownloads(
      downloads, base::BindOnce(
                     [](int generation, bool quit_anyway) {
                       if (generation != g_quit_generation ||
                           g_phase != QuitPhase::kAskingDownloads) {
                         return;
                       }
                       if (quit_anyway) {
                         StartQuit();
                       } else {
                         QuitCancelled();
                       }
                     },
                     generation));
}

void StartLifetimeObservers() {
  ClosingAllBrowsersSubscription() =
      chrome::AddClosingAllBrowsersCallback(base::BindRepeating([](bool closing) {
        if (!closing && g_phase == QuitPhase::kClosing &&
            !browser_shutdown::IsTryingToQuit()) {
          QuitCancelled();
        }
      }));
  [NSNotificationCenter.defaultCenter
      addObserverForName:NSApplicationWillTerminateNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                g_phase = QuitPhase::kExiting;
                ReleaseAppKeepAlive();
                ChromeDevToolsManagerDelegate::AllowBrowserToClose();
              }];
}

}

@interface ACAppControllerStandIn : NSObject
@end

@implementation ACAppControllerStandIn

- (BOOL)startupComplete {
  return YES;
}

- (Profile*)lastProfileIfLoaded {
  return ProfileManager::GetLastUsedProfileIfLoaded();
}

- (Profile*)lastProfile {
  return [self lastProfileIfLoaded];
}

- (void)mainMenuCreated {
}

- (void)didEndMainMessageLoop {
}

- (void)tryToTerminateApplication {
  [NSApp terminate:nil];
}

- (void)stopTryingToTerminateApplication {
  browser_shutdown::SetTryingToQuit(false);
}

- (ConfirmQuitResult)confirmQuitIfNeeded {
  return ConfirmQuitResultNotPrompted;
}

- (void)willPowerOff:(NSNotification*)notification {
}

- (BOOL)keyWindowIsModal {
  if (NSApp.modalWindow) {
    return YES;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser();
  BrowserWindow* window = browser ? BrowserWindow::FromBrowser(browser) : nullptr;
  return window && [window->GetNativeWindow().GetNativeNSWindow().attachedSheet
                       isKindOfClass:[NSWindow class]];
}

- (void)commandDispatch:(id)sender {
}

- (void)executeCommand:(id)sender withProfile:(Profile*)profile {
}

- (IBAction)showPreferences:(id)sender {
}

- (IBAction)showPreferencesForProfile:(Profile*)profile {
}

- (IBAction)orderFrontStandardAboutPanel:(id)sender {
}

- (IBAction)orderFrontStandardAboutPanelForProfile:(Profile*)profile {
}

- (IBAction)toggleConfirmToQuit:(id)sender {
}

- (NSMenu*)applicationDockMenu:(NSApplication*)sender {
  return nil;
}

- (BookmarkMenuBridge*)bookmarkMenuBridge {
  return nullptr;
}

- (HistoryMenuBridge*)historyMenuBridge {
  return nullptr;
}

- (TabMenuBridge*)tabMenuBridge {
  return nullptr;
}

- (void)setLastProfile:(Profile*)profile {
}

- (const ui::ColorProvider&)lastActiveColorProvider {
  if (BrowserWindowInterface* browser =
          GlobalBrowserCollection::GetInstance()->GetLastActiveBrowser()) {
    auto* helper = ColorProviderBrowserHelper::From(browser);
    if (ui::ColorProviderSource* source =
            helper ? helper->color_provider_source() : nullptr) {
      if (const auto* provider = source->GetColorProvider()) {
        return *provider;
      }
    }
  }
  return *ui::ColorProviderManager::Get().GetColorProviderFor(
      ui::NativeTheme::GetInstanceForNativeUi()->GetColorProviderKey(nullptr));
}

- (void)updateMenuItemKeyEquivalents {
}

- (BOOL)windowHasBrowserTabs:(NSWindow*)window {
  ardiacore::WindowHost* host = ardiacore::WindowHost::ForNSWindow(window);
  if (!host) {
    return NO;
  }
  for (Browser* browser : host->browsers()) {
    if (!browser->GetTabStripModel()->empty()) {
      return YES;
    }
  }
  return NO;
}

- (Profile*)safeProfileForNewWindows:(Profile*)profile {
  if (!profile || profile->IsSystemProfile()) {
    return nullptr;
  }
  if (profile->IsGuestSession() && !profiles::IsGuestModeEnabled()) {
    return nullptr;
  }
  ProfileManager* profile_manager = g_browser_process->profile_manager();
  ProfileAttributesEntry* entry =
      profile_manager ? profile_manager->GetProfileAttributesStorage()
                            .GetProfileAttributesWithPath(profile->GetPath())
                      : nullptr;
  if (entry && entry->IsSigninRequired()) {
    return nullptr;
  }
  return ProfileManager::MaybeForceOffTheRecordMode(profile);
}

- (void)allowApplicationToTerminate {
}

- (void)resetKeepAliveWhileHidden {
}

- (void)applicationDidFinishLaunching:(NSNotification*)notification {
}

- (NSMethodSignature*)methodSignatureForSelector:(SEL)selector {
  return [super methodSignatureForSelector:selector]
             ?: [AppController instanceMethodSignatureForSelector:selector];
}

- (void)forwardInvocation:(NSInvocation*)invocation {
  const SEL selector = invocation.selector;
  NSMethodSignature* signature = invocation.methodSignature;
  const char* type = signature.methodReturnType;
  while (*type && strchr("rnNoORV", *type)) {
    ++type;
  }
  const bool zeroable = strchr("vcCsSiIlLqQBfd@#:", *type) != nullptr;
  LOG(ERROR) << "[ardiacore] AppController stand-in has no -"
             << sel_getName(selector) << " (returns " << type << ")";
  CHECK(zeroable && !ardiacore::BackgroundInstance())
      << "AppController stand-in: implement -" << sel_getName(selector);
  if (const NSUInteger length = signature.methodReturnLength) {
    std::vector<char> zero(length, 0);
    [invocation setReturnValue:zero.data()];
  }
}

@end

namespace {

id StandInSharedController(id self, SEL _cmd) {
  static ACAppControllerStandIn* stand_in = [[ACAppControllerStandIn alloc] init];
  return stand_in;
}

void ACTerminate(id self, SEL _cmd, id sender) {
  ardiacore::Terminate();
}

void ACCancelTerminate(id self, SEL _cmd, id sender) {
  browser_shutdown::SetTryingToQuit(false);
}

void ACReplyToApplicationShouldTerminate(id self, SEL _cmd, BOOL should_terminate) {
  if (ardiacore::g_phase != ardiacore::QuitPhase::kAskingHost) {
    return;
  }
  if (should_terminate) {
    ardiacore::g_phase = ardiacore::QuitPhase::kNone;
    ardiacore::QuitEngine();
  } else {
    ardiacore::QuitCancelled();
  }
}

}

@interface ACQuitAppleEventHandler : NSObject
- (void)handleQuitEvent:(NSAppleEventDescriptor*)event
              withReply:(NSAppleEventDescriptor*)reply;
@end

@implementation ACQuitAppleEventHandler
- (void)handleQuitEvent:(NSAppleEventDescriptor*)event
              withReply:(NSAppleEventDescriptor*)reply {
  [NSApp terminate:nil];
}
@end

namespace ardiacore {

namespace {
void InstallQuitAppleEventHandler() {
  static ACQuitAppleEventHandler* handler = [[ACQuitAppleEventHandler alloc] init];
  [NSAppleEventManager.sharedAppleEventManager
      setEventHandler:handler
          andSelector:@selector(handleQuitEvent:withReply:)
        forEventClass:kCoreEventClass
           andEventID:kAEQuitApplication];
}
}

void InstallAppOverrides() {
  Class app_controller = [AppController class];
  class_replaceMethod(object_getClass(app_controller), @selector(sharedController),
                      reinterpret_cast<IMP>(StandInSharedController), "@@:");
  Class app = [BrowserCrApplication class];
  class_replaceMethod(app, @selector(terminate:), reinterpret_cast<IMP>(ACTerminate),
                      "v@:@");
  class_replaceMethod(app, @selector(cancelTerminate:),
                      reinterpret_cast<IMP>(ACCancelTerminate), "v@:@");
  class_replaceMethod(app, @selector(replyToApplicationShouldTerminate:),
                      reinterpret_cast<IMP>(ACReplyToApplicationShouldTerminate), "v@:c");
  [NSNotificationCenter.defaultCenter
      addObserverForName:NSApplicationDidFinishLaunchingNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                InstallQuitAppleEventHandler();
              }];
}

}
