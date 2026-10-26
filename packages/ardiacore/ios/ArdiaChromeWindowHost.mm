#import "ArdiaChromeWindowInternal.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaWebViewInternal.h"

#import <objc/runtime.h>

using namespace ardia_window;

namespace {

BOOL (^gShouldClose)(NSWindow *);

void (^gSwapped)(NSWindow *, NSWindow *);

}

NSView *ArdiaWindowRootView(NSWindow *window) {
  return [ArdiaChromeWindowHost rootViewOfWindow:window] ?: window.contentView;
}

@implementation ArdiaChromeWindowHost

+ (NSWindow *)makeWindowForProfile:(NSString *)profile {
  if (!ArdiaHost.isStarted) return nil;
  ArdiaCoreWindow *coreWindow = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1360, 860)];
  NSWindow *window = coreWindow.window;
  if (!window) return nil;
  ConfigureWindow(window);
  ArdiaWindowController *controller = [[ArdiaWindowController alloc] initWithCoreWindow:coreWindow];
  [Controllers() setObject:controller forKey:window];
  [self showProfile:profile ?: @"" inWindow:window];
  return window;
}

+ (NSWindow *)makeWindowForProfile:(NSString *)profile chromeWindow:(NSString *)chromeWindow {
  ArdiaWindowController *made = [ArdiaWindowController claimChromeMadeWindow:chromeWindow];
  if (!made) return [self makeWindowForProfile:profile];
  NSWindow *window = made.coreWindow.window;
  [self showProfile:profile ?: @"" inWindow:window];
  return window;
}

+ (NSWindow *)makeWindowForProfile:(NSString *)profile chromeWindow:(NSString *)chromeWindow appWindow:(NSString *)appWindow {
  const BOOL link = [appWindow hasPrefix:@"link:"];
  NSWindow *window = chromeWindow.length ? nil
                     : link ? [ArdiaEarlyWindow claimLittleWindowForLink:appWindow profile:profile]
                            : [ArdiaEarlyWindow claimForAppWindow:appWindow profile:profile];
  if (window) [self showProfile:profile ?: @"" inWindow:window];
  else window = [self makeWindowForProfile:profile chromeWindow:chromeWindow];
  if (window && appWindow.length && !link) [ArdiaWindowController forNSWindow:window].appWindowId = appWindow;
  return window;
}

+ (void)recordLaunchLayout {
  [ArdiaEarlyWindow recordNow];
}

+ (void)forgetLaunchPictures {
  [ArdiaEarlyWindow forgetPicturesNow];
}

+ (BOOL)takeDismissedAppWindow:(NSString *)appWindow {
  return [ArdiaEarlyWindow takeDismissed:appWindow];
}

+ (void)showProfile:(NSString *)profile inWindow:(NSWindow *)window {
  ArdiaWindowController *controller = [ArdiaWindowController forNSWindow:window];
  if (!controller) return;
  __weak ArdiaCoreWindow *coreWindow = controller.coreWindow;
  __weak ArdiaWindowController *weakController = controller;
  ardia_host::WithProfile(profile ?: @"", ^(ArdiaCoreProfile *p) {
    ArdiaWindowController *shown = weakController;
    if (!p || !coreWindow || !shown) return;
    coreWindow.activeProfile = p;
    ArdiaCoreTab *tab = [ArdiaTabStrip activeTabInWindow:shown profile:p];
    ArdiaWebView *view = tab ? [ArdiaTabRegistry viewForTab:tab] : nil;
    NSWindow *shownWindow = coreWindow.window;
    if (view && shownWindow && view.window == shownWindow && [[coreWindow tabsForProfile:p] containsObject:tab])
      [view requestFocusRestoreIn:shownWindow];
  });
}

+ (void)prepareProfiles:(NSArray<NSString *> *)profiles forWindow:(NSWindow *)window {
  ArdiaWindowController *controller = [ArdiaWindowController forNSWindow:window];
  if (!controller) return;
  __weak ArdiaCoreWindow *coreWindow = controller.coreWindow;
  for (NSString *profile in profiles)
    ardia_host::WithProfile(profile, ^(ArdiaCoreProfile *p) {
      if (p && coreWindow) [coreWindow prepareProfile:p];
    });
}

+ (void)setTrafficLightsCenter:(NSValue *)center inWindow:(NSWindow *)window {
  if (objc_getAssociatedObject(window, kLightsShownKey)) {
    objc_setAssociatedObject(window, kLightsShownKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, kLightsMoveKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    TranslateTrafficLights(window, 0);
  }
  NSValue *current = objc_getAssociatedObject(window, kLightsCenterKey);
  if (current == center || [current isEqual:center]) return;
  objc_setAssociatedObject(window, kLightsCenterKey, center, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  RetileTrafficLights(window);
  PlaceFullScreenLights(window);
}

+ (void)moveTrafficLightsCenter:(NSValue *)center inWindow:(NSWindow *)window {
  id shown = objc_getAssociatedObject(window, kLightsShownKey);
  NSValue *current = shown ? (shown == NSNull.null ? nil : shown) : objc_getAssociatedObject(window, kLightsCenterKey);
  if (current == center || [current isEqual:center]) return;
  if (!MoveTrafficLights(window, center)) [self setTrafficLightsCenter:center inWindow:window];
}

+ (void)setSwappedHandler:(void (^)(NSWindow *, NSWindow *))handler {
  gSwapped = [handler copy];
}

+ (void (^)(NSWindow *, NSWindow *))swappedHandler {
  return gSwapped;
}

+ (void)closeWindow:(NSWindow *)window {
  ArdiaWindowController *controller = [ArdiaWindowController forNSWindow:window];
  [ArdiaWebView keepTransfersOfWindow:window];
  if (controller) [controller.coreWindow close];
  else [window close];
}

+ (BOOL)windowFullScreenIsForPage:(NSWindow *)window {
  return [objc_getAssociatedObject(window, kWindowFullScreenKey) enteredForPage];
}

+ (void)setShouldCloseHandler:(BOOL (^)(NSWindow *))handler {
  gShouldClose = [handler copy];
}

+ (BOOL (^)(NSWindow *))shouldCloseHandler {
  return gShouldClose;
}

+ (BOOL)windowShouldClose:(NSWindow *)window {
  return gShouldClose ? gShouldClose(window) : YES;
}

+ (void)setRefusesUnhandledKeyHandler:(BOOL (^)(NSWindow *, NSEvent *))handler {
  gRefusesUnhandledKey = [handler copy];
}

+ (BOOL (^)(NSWindow *, NSEvent *))refusesUnhandledKeyHandler {
  return gRefusesUnhandledKey;
}

+ (void)embedRootView:(NSView *)root inWindow:(NSWindow *)window {
  ArdiaWindowController *controller = [ArdiaWindowController forNSWindow:window];
  if (!controller) return;
  NSView *host = controller.coreWindow.hostView;
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  root.frame = host.bounds;
  NSView *cover = [ArdiaEarlyWindow coverInWindow:window];
  if (cover.superview == host) [host addSubview:root positioned:NSWindowBelow relativeTo:cover];
  else [host addSubview:root];
  controller.root = root;
  [ArdiaEarlyWindow rootEmbedded:root inWindow:window];
}

+ (NSView *)rootViewOfWindow:(NSWindow *)window {
  return [ArdiaWindowController forNSWindow:window].root;
}

+ (void)removeRootViewOfWindow:(NSWindow *)window {
  ArdiaWindowController *controller = [ArdiaWindowController forNSWindow:window];
  [controller.root removeFromSuperview];
  controller.root = nil;
}

@end
