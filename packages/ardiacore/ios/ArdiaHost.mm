#import "ArdiaHostInternal.h"
#import "ArdiaLaunchConfig.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaServices.h"
#import "ArdiaNavigationDownloads.h"
#import "ArdiaStartup.h"
#import "ArdiaTabParking.h"
#import "ArdiaWebViewInternal.h"

#import <Security/Security.h>
#import <objc/runtime.h>

#include <cctype>
#include <cstring>
#include <set>
#include <string>
#include <vector>

using namespace ardia_host;

namespace ardia_host {

id<NSApplicationDelegate> (^gMakeDelegate)(void);

id<NSApplicationDelegate> gAppDelegate;


NSString *gDataDirectory;

}

namespace {

BOOL gMenuShortcutsReady;

void SendReservedShortcuts() {
  if (!ArdiaLaunchSequence.shared.engineRunning || !gMenuShortcutsReady) return;
  [ArdiaCoreEngine reservedShortcutsChanged];
}

}

namespace ardia_host {

void WatchReservedShortcuts() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    [NSNotificationCenter.defaultCenter addObserverForName:NSTextInputContextKeyboardSelectionDidChangeNotification object:nil queue:NSOperationQueue.mainQueue
                    usingBlock:^(NSNotification *) { SendReservedShortcuts(); }];
  });
  SendReservedShortcuts();
}

bool IsTeamSigned() {
  SecCodeRef code = nullptr;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess) return false;
  CFDictionaryRef info = nullptr;
  OSStatus status = SecCodeCopySigningInformation((SecStaticCodeRef)code, kSecCSSigningInformation, &info);
  CFRelease(code);
  if (status != errSecSuccess || !info) return false;
  bool team = CFDictionaryGetValue(info, kSecCodeInfoTeamIdentifier) != nullptr;
  CFRelease(info);
  return team;
}

ArdiaBootstrapDelegate *gBootstrap;

bool gScratchDataDir = false;







NSMutableDictionary<NSString *, NSDictionary *> *gInstallPrompts = [NSMutableDictionary dictionary];

}

@implementation ArdiaHost

static void (^gQuitCancelledHandler)(void);

+ (void (^)(void))quitCancelledHandler {
  return gQuitCancelledHandler;
}

+ (void)setQuitCancelledHandler:(void (^)(void))handler {
  gQuitCancelledHandler = [handler copy];
}

+ (void)menuShortcutsChanged {
  gMenuShortcutsReady = YES;
  SendReservedShortcuts();
}

+ (void)replayInstallPrompts {
  for (NSDictionary *prompt in gInstallPrompts.allValues) [ArdiaEvents emit:@"extensions.installPrompt" data:prompt];
}

+ (void)resolveExtensionInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted {
  [gInstallPrompts removeObjectForKey:requestId ?: @""];
  [ArdiaCoreEngine resolveExtensionInstallPrompt:requestId accepted:accepted];
}

+ (void)beginTracing:(void (^)(BOOL))completion {
  [ArdiaCoreEngine beginTracing:completion];
}

+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *))completion {
  [ArdiaCoreEngine endTracing:keep completion:completion];
}

+ (BOOL)isTracing {
  return ArdiaCoreEngine.isTracing;
}

+ (void)deleteProfileData:(NSString *)profile completion:(void (^)(NSArray<NSString *> *))completion {
  if (ardia_host::IsPrivateProfile(profile)) return completion(@[]);
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  ArdiaCoreProfile *p = ardia_host::LoadedProfile(profile);
  if (!profile.length || !engine) return completion(@[ @"data" ]);
  [DeletedProfiles() addObject:profile];
  void (^remove)(ArdiaCoreProfile *) = ^(ArdiaCoreProfile *loaded) {
    if (!loaded) {
      NSString *path = [gDataDirectory stringByAppendingPathComponent:ardia_host::ProfileDirectoryName(profile)];
      [NSFileManager.defaultManager removeItemAtPath:path error:nil];
      return completion([NSFileManager.defaultManager fileExistsAtPath:path] ? @[ @"files" ] : @[]);
    }
    [engine deleteProfile:loaded completion:^(BOOL deleted) {
      if (deleted) [Profiles() removeObjectForKey:profile];
      else [DeletedProfiles() removeObject:profile];
      completion(deleted ? @[] : @[ @"data" ]);
    }];
  };
  if (!p && ProfileWaiters()[profile]) {
    DeletionsAfterLoad()[profile] = [remove copy];
    return;
  }
  remove(p);
}

+ (void)releaseProfile:(NSString *)profile {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  ArdiaCoreProfile *p = ardia_host::LoadedProfile(profile);
  if (ardia_host::IsPrivateProfile(profile)) {
    if (profile) [ReleasedPrivateNames() addObject:profile];
    [Profiles() removeObjectForKey:profile];
    NSArray *waiting = ProfileWaiters()[profile];
    [ProfileWaiters() removeObjectForKey:profile];
    for (void (^waiter)(ArdiaCoreProfile *) in waiting) waiter(nil);
    ardia_host::ForgetPrivateNavigationDownloads(profile);
    if ([Profiles().allValues containsObject:p]) return;
  }
  if (p) [engine releaseProfile:p];
}

+ (NSArray<NSString *> *)loadedProfiles {
  return ardia_host::LoadedDataProfileNames();
}

+ (BOOL)stopCapture:(NSString *)tabId {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab stopCapture];
}

+ (BOOL)showAutofillSuggestions:(NSString *)tabId passwords:(BOOL)passwords {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab showAutofillSuggestions:passwords];
}

+ (void)deviceChooser:(int)chooserId select:(int)index {
  [ArdiaCoreEngine selectDevice:chooserId index:index];
}

+ (void)deviceChooser:(int)chooserId action:(NSString *)action {
  if ([action isEqualToString:@"cancel"])
    [ArdiaCoreEngine cancelDeviceChooser:chooserId];
  else if ([action isEqualToString:@"refresh"])
    [ArdiaCoreEngine refreshDeviceChooser:chooserId];
  else if ([action isEqualToString:@"settings"])
    [ArdiaCoreEngine openDeviceChooserSettings:chooserId];
}

+ (NSArray<NSDictionary *> *)testExternalLaunches {
  return ArdiaCoreEngine.testExternalLaunches ?: @[];
}

+ (BOOL)devShowBluetoothChooser:(NSString *)tabId unauthorized:(BOOL)unauthorized {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab devShowBluetoothChooser:unauthorized];
}

+ (NSArray<NSDictionary *> *)testChooserEvents {
  return ArdiaCoreEngine.testChooserEvents ?: @[];
}

+ (BOOL)shareTabInstead:(NSString *)capturerTabId target:(NSString *)targetTabId {
  ArdiaCoreTab *capturer = ardia_host::TabWithAppTabId(capturerTabId);
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(targetTabId);
  return capturer && [tab shareThisTabInsteadFor:capturer];
}

+ (BOOL)showCastDialog:(NSString *)tabId {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab showCastDialog];
}

+ (void)castDialog:(int)dialogId start:(NSString *)sink mode:(int)mode {
  [ArdiaCoreEngine startCasting:dialogId sink:sink mode:mode];
}

+ (void)castDialog:(int)dialogId stop:(NSString *)route {
  [ArdiaCoreEngine stopCasting:dialogId route:route];
}

+ (void)closeCastDialog:(int)dialogId {
  [ArdiaCoreEngine closeCastDialog:dialogId];
}

+ (void)watchCastRoutes:(NSString *)profileName {
  ardia_host::WithProfile(profileName, ^(ArdiaCoreProfile *profile) {
    [profile watchCastRoutes];
  });
}

+ (void)terminateCastRoute:(NSString *)route {
  [ArdiaCoreEngine terminateCastRoute:route];
}

+ (void)resolveExternalApp:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember {
  [ArdiaCoreEngine resolveExternalApp:requestId open:open remember:remember];
}

+ (NSDictionary *)actionStates:(NSString *)tabId extensions:(NSArray<NSString *> *)ids {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab actionStatesForExtensions:ids] ?: @{};
}

+ (NSString *)sidePanelURL:(NSString *)tabId extension:(NSString *)extensionId {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return [tab sidePanelURLForExtension:extensionId];
}

+ (BOOL)isPrivateProfile:(NSString *)profile {
  return ardia_host::IsPrivateProfile(profile);
}

+ (NSString *)baseProfileOf:(NSString *)profile {
  return ardia_host::OriginalProfileName(profile);
}

+ (int)chromeTabIdOfTab:(NSString *)tabId {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return tab ? tab.tabId : -1;
}

static NSMutableDictionary<NSString *, ArdiaCoreWindow *> *OffscreenWindows() {
  static NSMutableDictionary<NSString *, ArdiaCoreWindow *> *windows = [NSMutableDictionary dictionary];
  return windows;
}

static ArdiaCoreWindow *OffscreenWindowFor(ArdiaCoreProfile *profile) {
  NSString *name = ardia_host::ProfileName(profile);
  ArdiaCoreWindow *window = OffscreenWindows()[name];
  if (window.window) return window;
  window = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1280, 800)];
  if (!window.window) return nil;
  window.internal = YES;
  window.automation = YES;
  OffscreenWindows()[name] = window;
  return window;
}

static NSDictionary<NSString *, id> *OffscreenRefusal(NSString *reason) {
  return @{@"ok" : @NO, @"reason" : reason};
}

+ (void)cliMoveOffscreen:(NSString *)tabId tries:(NSInteger)tries completion:(void (^)(NSDictionary<NSString *, id> *moved))completion {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  ArdiaWebView *view = tab ? [ArdiaTabRegistry viewForTab:tab] : nil;
  if (!tab || tab.closed || tab.discarded || !view) return completion(OffscreenRefusal(@"That tab has no page loaded."));
  ArdiaCoreWindow *window = OffscreenWindowFor(tab.profile);
  const ArdiaCoreAdoption adoption = window ? [window canAdoptTab:tab] : ArdiaCoreAdoptionRefused;
  if (adoption == ArdiaCoreAdoptionBusy && tries > 0) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [self cliMoveOffscreen:tabId tries:tries - 1 completion:completion];
    });
    return;
  }
  if (adoption != ArdiaCoreAdoptionAdopted) return completion(OffscreenRefusal(@"Ardia couldn't take that tab off-screen."));
  if (![view releasePageForOffscreen]) return completion(OffscreenRefusal(@"That tab is shown in a window, so it can't go off-screen."));
  if ([window adoptTab:tab] != ArdiaCoreAdoptionAdopted) {
    [tab close];
    return completion(OffscreenRefusal(@"Ardia couldn't take that tab off-screen, and closed it."));
  }
  NSView *page = tab.view, *host = window.hostView;
  [page removeFromSuperview];
  page.frame = host.bounds;
  page.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  page.hidden = NO;
  [host addSubview:page];
  completion(@{@"ok" : @YES});
}

+ (void)cliMoveOffscreen:(NSString *)tabId completion:(void (^)(NSDictionary<NSString *, id> *moved))completion {
  [self cliMoveOffscreen:tabId tries:50 completion:completion];
}

+ (void)cliCloseOffscreenTabs {
  for (ArdiaCoreWindow *window in OffscreenWindows().allValues)
    for (ArdiaCoreProfile *profile in ardia_host::LoadedProfiles())
      for (ArdiaCoreTab *tab in [[window tabsForProfile:profile] copy]) [tab close];
}

+ (void)cliTabTargets:(NSArray<NSString *> *)tabIds completion:(void (^)(NSDictionary<NSString *, id> *targets))completion {
  static NSMutableDictionary<NSString *, NSString *> *lastTarget;
  static NSMutableDictionary<NSString *, NSNumber *> *generations;
  if (!lastTarget) {
    lastTarget = [NSMutableDictionary dictionary];
    generations = [NSMutableDictionary dictionary];
  }
  NSMutableDictionary<NSString *, id> *answer = [NSMutableDictionary dictionary];
  void (^record)(NSString *, NSString *) = ^(NSString *tabId, NSString *targetId) {
    if (targetId && ![lastTarget[tabId] isEqualToString:targetId]) {
      lastTarget[tabId] = targetId;
      generations[tabId] = @(generations[tabId].integerValue + 1);
    }
    answer[tabId] = @{@"targetId" : targetId ?: NSNull.null, @"pageGeneration" : generations[tabId] ?: @0};
  };
  dispatch_group_t pending = dispatch_group_create();
  for (NSString *tabId in tabIds) {
    ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
    if (!tab || tab.closed || tab.discarded || [ArdiaTabRegistry viewForTab:tab].awaitsFirstDocument) {
      record(tabId, nil);
      continue;
    }
    dispatch_group_enter(pending);
    [tab devToolsCall:@"Target.getTargetInfo"
               params:@{}
              timeout:1.0
           completion:^(NSDictionary *result, NSString *error) {
             id info = result[@"targetInfo"];
             id targetId = [info isKindOfClass:NSDictionary.class] ? info[@"targetId"] : nil;
             record(tabId, [targetId isKindOfClass:NSString.class] ? targetId : nil);
             dispatch_group_leave(pending);
           }];
  }
  dispatch_group_notify(pending, dispatch_get_main_queue(), ^{
    completion(answer);
  });
}

+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember {
  [ArdiaCoreEngine resolvePermission:requestId result:result remember:remember];
}

+ (NSArray<NSDictionary<NSString *, id> *> *)displayMediaSources {
  NSMutableArray *sources = [NSMutableArray array];
  NSUInteger index = 0;
  for (NSScreen *screen in NSScreen.screens) {
    NSNumber *display = screen.deviceDescription[@"NSScreenNumber"];
    index++;
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"screen:%u:0", display.unsignedIntValue],
      @"kind" : @"screen",
      @"name" : screen.localizedName ?: [NSString stringWithFormat:@"Screen %lu", (unsigned long)index],
      @"width" : @(screen.frame.size.width),
      @"height" : @(screen.frame.size.height),
    }];
  }
  NSArray *windows = CFBridgingRelease(
      CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
  for (NSDictionary *w in windows) {
    if ([w[(id)kCGWindowLayer] intValue] != 0) continue;
    NSDictionary *bounds = w[(id)kCGWindowBounds];
    const CGFloat width = [bounds[@"Width"] doubleValue], height = [bounds[@"Height"] doubleValue];
    if (width < 50 || height < 50) continue;
    NSString *app = w[(id)kCGWindowOwnerName] ?: @"";
    NSString *title = w[(id)kCGWindowName];
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"window:%u:0", [w[(id)kCGWindowNumber] unsignedIntValue]],
      @"kind" : @"window",
      @"name" : title.length ? title : app,
      @"app" : app,
      @"pid" : w[(id)kCGWindowOwnerPID] ?: @0,
      @"width" : @(width),
      @"height" : @(height),
    }];
  }
  return sources;
}

+ (BOOL)screenRecordingAllowed {
  NSString *answer = [ArdiaLaunchConfig.shared testValue:@"screenRecording"];
  if (answer.length) return [answer isEqualToString:@"allowed"];
  return CGPreflightScreenCaptureAccess();
}

+ (BOOL)requestScreenRecording {
  if (self.screenRecordingAllowed) return YES;
  if (ArdiaLaunchConfig.shared.background) {
    NSLog(@"[ardia] background mode: Screen Recording request not shown");
    return NO;
  }
  if (CGRequestScreenCaptureAccess()) return YES;
  [NSWorkspace.sharedWorkspace
      openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"]];
  return NO;
}

+ (BOOL)isStarted {
  return ArdiaLaunchSequence.shared.engineRunning;
}

+ (NSString *)dataDirectory {
  return gDataDirectory ?: @"";
}

+ (NSDictionary<NSString *, id> *)engineInfo {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  NSInteger chromeWindows = 0;
  for (ArdiaWindowController *c in ArdiaWindowController.all) chromeWindows += c.coreWindow ? 1 : 0;
  return @{
    @"pid" : @(NSProcessInfo.processInfo.processIdentifier),
    @"dataDirectory" : gDataDirectory ?: @"",
    @"engine" : @"ardiacore",
    @"chromiumVersion" : engine.chromiumVersion ?: @"",
    @"liveBrowsers" : @0,
    @"popupWindows" : @(ardia_host::PopupWindowCount()),
    @"chromeWindows" : @(chromeWindows),
    @"keepAlive" : engine.keepAliveState ?: @"",
    @"lastUsedProfile" : engine.defaultProfile.name ?: @"",
    @"focus" : ardia_host::FocusState(),
  };
}

+ (NSArray<NSDictionary<NSString *, id> *> *)chromeWindows {
  NSMutableArray *list = [NSMutableArray array];
  for (ArdiaWindowController *c in ArdiaWindowController.all) {
    NSWindow *w = c.coreWindow.window;
    if (!w) continue;
    ArdiaCoreProfile *active = c.coreWindow.activeProfile;
    [list addObject:@{
      @"profile" : ardia_host::ProfileName(active),
      @"window" : @(w.windowNumber),
      @"frame" : NSStringFromRect(w.frame),
      @"alpha" : @(w.alphaValue),
      @"key" : @(w.isKeyWindow),
      @"canBecomeKey" : @(w.canBecomeKeyWindow),
      @"visible" : @(w.isVisible),
      @"occlusionVisible" : @((w.occlusionState & NSWindowOcclusionStateVisible) != 0),
      @"chromeOccluded" : [w respondsToSelector:NSSelectorFromString(@"isOccluded")] ? [w valueForKey:@"occluded"] : NSNull.null,
      @"parentWindow" : @(w.parentWindow.windowNumber),
      @"chromeWindows" : @1,
      @"anchorBrowserId" : @0,
      @"anyTabBrowserId" : @0,
      @"ready" : @YES,
      @"active" : @(w.isMainWindow),
      @"pageInsets" : @[ @0, @0, @0, @0 ],
      @"hosting" : @(c.root != nil),
      @"group" : @"",
      @"hasRoot" : @(c.root != nil),
      @"translucent" : @(!w.opaque),
    }];
  }
  return list;
}

@end
