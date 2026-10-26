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

@implementation ArdiaHostEngineDelegate

- (void)engineDidStart {
  NSLog(@"[ardiacore] engine started (Chromium %@)", ArdiaCoreEngine.sharedEngine.chromiumVersion);
  gStarted = YES;
  WatchReservedShortcuts();
  ardia_host::InstallActivationGuardsLate();
  if (gScratchDataDir && ardia_host::Background())
    ardia_host::InstallTestCrashGuard([gDataDirectory stringByDeletingLastPathComponent]);
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  if (ArdiaCoreProfile *profile = ardia_host::PersonalIfLoaded(engine)) Profiles()[@""] = profile;
  ardia_host::LoadContentBlocker(@"");
  [ArdiaWebView installScrollZoom];
  [ArdiaWebView installSwitchPrewarm];
  [ArdiaWebView installOutgoingFocusSnapshots];
  [ArdiaServices watchDownloads:@""];

  NSBundle *bundle = [NSBundle bundleForClass:ArdiaHostEngineDelegate.class];
  NSString *path = [bundle pathForResource:@"page_script" ofType:@"js"];
  NSString *script = path ? [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] : nil;
  if (script) engine.pageScript = script;
  if (gAppKitDidFinish) StartEarlyWindow();
  else gEarlyWindowPending = true;

  CFRunLoopObserverRef idle = CFRunLoopObserverCreateWithHandler(
      nullptr, kCFRunLoopBeforeWaiting, false, 0, ^(CFRunLoopObserverRef observer, CFRunLoopActivity) {
        CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
        __block id started = [NSNotificationCenter.defaultCenter
            addObserverForName:@"RCTJavaScriptWillStartExecutingNotification"
                        object:nil
                         queue:nil
                    usingBlock:^(NSNotification *) {
                      [NSNotificationCenter.defaultCenter removeObserver:started];
                      started = nil;
                      dispatch_async(dispatch_get_main_queue(), ^{ StartLaunchTab(); });
                    }];
        [self launchApp];
      });
  CFRunLoopAddObserver(CFRunLoopGetMain(), idle, kCFRunLoopCommonModes);
  CFRelease(idle);
}

- (void)launchApp {
  NSArray<NSURL *> *launchURLs = gBootstrap.urls.copy;
  LinksArrived(launchURLs);
  gAppDelegate = gMakeDelegate();
  const SEL openURLs = @selector(application:openURLs:);
  if (Method open = class_getInstanceMethod([gAppDelegate class], openURLs)) {
    IMP original = method_getImplementation(open);
    method_setImplementation(open, imp_implementationWithBlock(^(id delegate, NSApplication *app, NSArray<NSURL *> *urls) {
      LinksArrived(urls);
      ((void (*)(id, SEL, NSApplication *, NSArray<NSURL *> *))original)(delegate, openURLs, app, urls);
    }));
  }
  NSApp.delegate = gAppDelegate;
  gBootstrap = nil;
  NSNotification *note = [NSNotification notificationWithName:NSApplicationWillFinishLaunchingNotification object:NSApp];
  if (gAppKitWillFinish && [gAppDelegate respondsToSelector:@selector(applicationWillFinishLaunching:)])
    [gAppDelegate applicationWillFinishLaunching:note];
  if (!gAppKitDidFinish) {
    NSLog(@"[ardiacore] app delegate %@ set before AppKit finished launching", NSStringFromClass([gAppDelegate class]));
    gPendingLaunchURLs = launchURLs;
    return;
  }
  note = [NSNotification notificationWithName:NSApplicationDidFinishLaunchingNotification object:NSApp];
  if ([gAppDelegate respondsToSelector:@selector(applicationDidFinishLaunching:)])
    [gAppDelegate applicationDidFinishLaunching:note];
  NSLog(@"[ardiacore] app delegate %@ launched", NSStringFromClass([gAppDelegate class]));
  if (launchURLs.count && [gAppDelegate respondsToSelector:@selector(application:openURLs:)])
    [gAppDelegate application:NSApp openURLs:launchURLs];
}

- (void)engineWillShutDown {
  gStarted = NO;
}

- (void)engineQuitCancelled {
  NSLog(@"[ardiacore] quit cancelled");
  [NSNotificationCenter.defaultCenter postNotificationName:ArdiaQuitCancelledNotification object:nil];
}

- (void)engine:(ArdiaCoreEngine *)engine permissionRequest:(NSDictionary *)request tab:(ArdiaCoreTab *)tab {
  if (tab && ardia_host::AskPermissionInPopupWindow(tab, request)) return;
  NSMutableDictionary *payload = [request mutableCopy];
  payload[@"tabId"] = ardia_host::AppTabIdValue(tab);
  if (tab && !ardia_host::AppTabIdOf(tab)) return ardia_host::HoldUntilHosted(tab, @"permissions.requested", payload);
  [ArdiaEvents emit:@"permissions.requested" data:payload];
}

- (void)engine:(ArdiaCoreEngine *)engine deviceChooser:(NSDictionary *)chooser tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [chooser mutableCopy];
  payload[@"tabId"] = ardia_host::AppTabIdValue(tab);
  if ([ArdiaEvents listens:@"media"]) [ArdiaEvents emit:@"media.deviceChooser" data:payload];
  else if ([payload[@"open"] boolValue])
    [ArdiaCoreEngine cancelDeviceChooser:[payload[@"id"] intValue]];
}

- (void)engine:(ArdiaCoreEngine *)engine castDialog:(NSDictionary *)dialog tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [dialog mutableCopy];
  payload[@"tabId"] = ardia_host::AppTabIdValue(tab);
  if ([ArdiaEvents listens:@"media"]) [ArdiaEvents emit:@"media.castDialog" data:payload];
  else if ([payload[@"open"] boolValue])
    [ArdiaCoreEngine closeCastDialog:[payload[@"id"] intValue]];
}

- (void)engine:(ArdiaCoreEngine *)engine castRoutes:(NSArray *)routes profile:(ArdiaCoreProfile *)profile {
  if (![ArdiaEvents listens:@"media"]) return;
  NSMutableArray<NSString *> *names = [NSMutableArray array];
  if (profile.offTheRecord)
    for (NSString *name in ardia_host::LoadedProfileNames())
      if (ardia_host::LoadedProfile(name) == profile) [names addObject:name];
  if (!names.count) [names addObject:ardia_host::ProfileName(profile)];
  for (NSString *name in names) [ArdiaEvents emit:@"media.castRoutes" data:@{@"profile" : name, @"routes" : routes ?: @[]}];
}

- (void)engine:(ArdiaCoreEngine *)engine extensionSidePanel:(NSDictionary *)panel tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [panel mutableCopy];
  payload[@"tabId"] = ardia_host::AppTabIdValue(tab);
  [ArdiaEvents emit:@"extensions.sidePanel" data:payload];
}

- (BOOL)engine:(ArdiaCoreEngine *)engine extensionActionPopup:(NSDictionary *)popup tab:(ArdiaCoreTab *)tab {
  if (![ArdiaEvents listens:@"extensions"] || !tab) {
    NSLog(@"[ardiacore] action.openPopup for %@: %@", popup[@"extensionId"], tab ? @"the app isn't listening yet" : @"no tab");
    return NO;
  }
  NSMutableDictionary *payload = [popup mutableCopy];
  payload[@"tabId"] = ardia_host::AppTabIdValue(tab);
  [ArdiaEvents emit:@"extensions.actionPopup" data:payload];
  return YES;
}

- (BOOL)engineIsReservedKey:(NSString *)key unshiftedKey:(NSString *)unshiftedKey modifiers:(NSEventModifierFlags)modifiers {
  return ardia_host::IsReservedBinding(key, unshiftedKey, modifiers);
}

- (BOOL)engineIsReservedKeyEvent:(NSEvent *)event {
  return event.type == NSEventTypeKeyDown && ardia_host::IsReservedKeyEvent(event);
}

- (BOOL)engine:(ArdiaCoreEngine *)engine extensionActionShortcut:(NSDictionary *)shortcut tab:(ArdiaCoreTab *)tab {
  if (![ArdiaEvents listens:@"extensions"] || !tab) return NO;
  NSMutableDictionary *payload = [shortcut mutableCopy];
  payload[@"tabId"] = ardia_host::AppTabIdValue(tab);
  [ArdiaEvents emit:@"extensions.actionShortcut" data:payload];
  return YES;
}

- (void)engine:(ArdiaCoreEngine *)engine extensionInstallPrompt:(NSDictionary *)prompt tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [prompt mutableCopy];
  payload[@"tabId"] = ardia_host::AppTabIdValue(tab);
  if ([prompt[@"profile"] isKindOfClass:NSString.class]) payload[@"profile"] = ardia_host::ProfileNameOfDirectory(prompt[@"profile"]);
  gInstallPrompts[payload[@"requestId"] ?: @""] = payload;
  [ArdiaEvents emit:@"extensions.installPrompt" data:payload];
}

- (void)engine:(ArdiaCoreEngine *)engine permissionRequestDismissed:(NSString *)requestId {
  ardia_host::DropPopupWindowPermission(requestId ?: @"");
  ardia_host::DropHeldEvent(@"permissions.requested", requestId ?: @"");
  [ArdiaEvents emit:@"permissions.dismissed" data:@{@"id" : requestId ?: @""}];
}

- (ArdiaCoreWindow *)engineWindowForNewBrowserOfProfile:(ArdiaCoreProfile *)profile type:(NSString *)type {
  if (![type isEqualToString:@"normal"] && ![type isEqualToString:@"popup"]) return nil;
  if ([type isEqualToString:@"normal"] && !profile.offTheRecord)
    if (ArdiaWindowController *made = [ArdiaWindowController chromeMadeWindowForProfile:profile]) return made.coreWindow;
  return [ArdiaWindowController strayWindowForProfile:profile].coreWindow;
}

@end
