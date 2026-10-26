#import "ArdiaHostInternal.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaServices.h"
#import "ArdiaNavigationDownloads.h"
#import "ArdiaStartup.h"
#import "ArdiaTabParking.h"
#import "ArdiaWebViewInternal.h"
#import "ArdiaNotifications.h"

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

BOOL gStarted;

NSString *gDataDirectory;

}

namespace {

BOOL gMenuShortcutsReady;

void SendReservedShortcuts() {
  if (!gStarted || !gMenuShortcutsReady) return;
  [ArdiaCoreEngine reservedShortcutsChanged];
}

}

namespace ardia_host {

void WatchReservedShortcuts() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserverForName:ArdiaMenuShortcutsChangedNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
      gMenuShortcutsReady = YES;
      SendReservedShortcuts();
    }];
    [center addObserverForName:NSTextInputContextKeyboardSelectionDidChangeNotification object:nil queue:NSOperationQueue.mainQueue
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

bool gAppKitWillFinish = false;

bool gAppKitDidFinish = false;

NSArray<NSURL *> *gPendingLaunchURLs;

NSArray<NSURL *> *gLaunchLinks;

bool gLinksHandled = false;

bool gJSStarted = false;

NSMutableDictionary<NSString *, NSDictionary *> *gInstallPrompts = [NSMutableDictionary dictionary];

}

@implementation ArdiaHost

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
  const pid_t me = getpid();
  for (NSDictionary *w in windows) {
    if ([w[(id)kCGWindowLayer] intValue] != 0 || [w[(id)kCGWindowOwnerPID] intValue] == me) continue;
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

+ (BOOL)isStarted {
  return gStarted;
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
