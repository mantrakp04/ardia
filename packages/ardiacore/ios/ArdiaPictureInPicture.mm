#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaLaunchConfig.h"
#import "ArdiaChromeWindowHost.h"
#import "ArdiaPiPThrowMath.h"

#import <dlfcn.h>
#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

using namespace ardia_pip;

namespace {

void InstallMenuMonitor() {
  static id monitor;
  if (monitor) return;
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskRightMouseDown
                                                  handler:^NSEvent *(NSEvent *event) {
                                                    ArdiaPiPController *controller =
                                                        event.window ? [ArdiaPiPController forWindow:event.window] : nil;
                                                    if (!controller) return event;
                                                    [NSMenu popUpContextMenu:[controller menu] withEvent:event forView:controller.overlay];
                                                    return nil;
                                                  }];
}

NSPoint ScreenLocation(NSEvent *event) {
  CGPoint point = CGEventGetLocation(event.CGEvent);
  return NSMakePoint(point.x, NSMaxY(NSScreen.screens.firstObject.frame) - point.y);
}

BOOL GrabsWindowBackground(NSWindow *window, NSEvent *event) {
  if (!window || ![ArdiaPiPController forWindow:window] || event.clickCount > 1 || (event.modifierFlags & NSEventModifierFlagControl))
    return NO;
  if ([window respondsToSelector:@selector(_resizeDirectionForMouseLocation:)] &&
      [window _resizeDirectionForMouseLocation:event.locationInWindow] != -1)
    return NO;
  NSView *frameView = window.contentView.superview;
  return frameView && [frameView hitTest:event.locationInWindow] == frameView;
}

__weak NSWindow *gDragged;

NSPoint gLastMouse;

NSPoint gGrabLocal;

__weak NSScreen *gDragHome;

std::vector<ardia_pip_throw::Sample> gDragSamples;

void SampleDrag(NSEvent *event, NSPoint mouse) {
  if (gDragSamples.size() >= 64) gDragSamples.erase(gDragSamples.begin(), gDragSamples.begin() + 32);
  gDragSamples.push_back({event.timestamp, mouse.x, mouse.y});
}

void InstallDragMonitor() {
  static id monitor;
  if (monitor) return;
  monitor = [NSEvent
      addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseUp
                                   handler:^NSEvent *(NSEvent *event) {
                                     if (event.type == NSEventTypeLeftMouseDown) {
                                       NSWindow *window = event.window;
                                       gDragged = GrabsWindowBackground(window, event) ? window : nil;
                                       if (!gDragged) return event;
                                       [ArdiaPiPController abandonSwipeOn:window];
                                       [[ArdiaPiPController forWindow:window] stopMotion];
                                       NSPoint mouse = ScreenLocation(event);
                                       gLastMouse = mouse;
                                       gGrabLocal = NSMakePoint(mouse.x - NSMinX(window.frame), mouse.y - NSMinY(window.frame));
                                       gDragHome = [[ArdiaPiPController forWindow:window] gestureHome];
                                       gDragSamples.clear();
                                       SampleDrag(event, mouse);
                                       return nil;
                                     }
                                     NSWindow *window = gDragged;
                                     if (!window) return event;
                                     if (event.type == NSEventTypeLeftMouseUp) {
                                       gDragged = nil;
                                       const NSPoint grabbed = NSMakePoint(NSMinX(window.frame) + gGrabLocal.x, NSMinY(window.frame) + gGrabLocal.y);
                                       const auto velocity = ardia_pip_throw::ReleaseVelocity(
                                           gDragSamples.data(), (int)gDragSamples.size(), event.timestamp);
                                       gDragSamples.clear();
                                       [[ArdiaPiPController forWindow:window] dragReleasedAt:grabbed
                                                                                 velocity:NSMakePoint(velocity.x, velocity.y)];
                                       return nil;
                                     }
                                     NSPoint mouse = ScreenLocation(event);
                                     SampleDrag(event, mouse);
                                     const auto screens = ThrowScreens();
                                     const auto next = ardia_pip_throw::DragStep(
                                         ThrowRect(window.frame), {mouse.x - gLastMouse.x, mouse.y - gLastMouse.y}, screens.data(),
                                         (int)screens.size(), ScreenIndex(gDragHome));
                                     gLastMouse = mouse;
                                     [window setFrameOrigin:NSMakePoint(next.x, next.y)];
                                     return nil;
                                   }];
}

void InstallZoomMonitor() {
  static id monitor;
  if (monitor) return;
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel | NSEventMaskMagnify
                                                  handler:^NSEvent *(NSEvent *event) {
                                                    return [ArdiaPiPController handleSwipe:event] || [ArdiaPiPZoom handle:event] ? nil : event;
                                                  }];
}

bool Attach(ArdiaWebView *view, NSString *host) {
  for (NSWindow *window in NSApp.windows) {
    ArdiaPiPController *controller = [ArdiaPiPController forWindow:window];
    if (!IsChromeVideoPictureInPicture(window) && !(controller && window.visible)) continue;
    if (!window.hasShadow) continue;
    if (controller.view && controller.view.browserId != view.browserId) continue;
    BOOL fresh = !controller;
    if (fresh) controller = [[ArdiaPiPController alloc] initWithWindow:window];
    controller.view = view;
    controller.host = host;
    [controller roundCorners];
    PreventActivation(window);
    if (ardia_host::Background()) {
      window.alphaValue = 0;
      window.ignoresMouseEvents = YES;
    }
    InstallMenuMonitor();
    InstallDragMonitor();
    InstallZoomMonitor();
    NSString *selfTest = ardia_host::Background() ? [ArdiaLaunchConfig.shared testValue:@"pipSelfTest"] : nil;
    if (fresh && [@[ @"close", @"backToTab" ] containsObject:selfTest]) [controller runButtonSelfTest:selfTest];
    else if (fresh && [selfTest isEqual:@"hover"]) [controller runHoverSelfTest];
    else if (fresh && selfTest) [controller runSelfTest];
    return true;
  }
  return false;
}

}

namespace {

NSString *DevShowAlpha(NSWindow *window, float alpha) {
  using MainConnection = int (*)(void);
  using SetAlpha = int (*)(int, int, float);
  auto connection = (MainConnection)dlsym(RTLD_DEFAULT, "CGSMainConnectionID");
  auto set = (SetAlpha)dlsym(RTLD_DEFAULT, "CGSSetWindowAlpha");
  if (!ArdiaLaunchConfig.shared.testInstance) return @"test instances only";
  if (!connection || !set) return @"no CGSSetWindowAlpha";
  return set(connection(), (int)window.windowNumber, alpha) == 0 ? @"started" : @"refused";
}

}

namespace ardia_pip {

void WatchZoom() { InstallZoomMonitor(); }

void TabRequestedActivation(ArdiaWebView *view) {
  for (NSWindow *window in NSApp.windows)
    if ([ArdiaPiPController forWindow:window].view == view && window.visible && !window.hasShadow)
      return ActivateApp(@"Back to Tab (Chrome's button)");
}

void VideoEntered(ArdiaWebView *view, NSString *host) {
  __block int tries = 0;
  __block void (^look)(void);
  __weak ArdiaWebView *weakView = view;
  look = ^{
    ArdiaWebView *strongView = weakView;
    if (!strongView || Attach(strongView, host) || ++tries >= 20) {
      look = nil;
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), look);
  };
  look();
}

}

@implementation ArdiaWebView (PictureInPictureDev)

+ (NSArray<NSDictionary<NSString *, id> *> *)devPictureInPicture {
  NSMutableArray *list = [NSMutableArray array];
  for (NSWindow *window in NSApp.windows) {
    ArdiaPiPController *controller = [ArdiaPiPController forWindow:window];
    if (!controller && !(window.visible && window.level >= NSFloatingWindowLevel) && !IsChromeDocumentPictureInPicture(window))
      continue;
    CALayer *content = window.contentView.layer;
    [list addObject:@{
      @"window" : @(window.windowNumber),
      @"class" : NSStringFromClass(window.class),
      @"title" : window.title ?: @"",
      @"video" : @(IsChromeVideoPictureInPicture(window)),
      @"document" : @(IsChromeDocumentPictureInPicture(window)),
      @"frame" : NSStringFromRect(window.frame),
      @"visible" : @(window.visible),
      @"alpha" : @(window.alphaValue),
      @"ignoresMouseEvents" : @(window.ignoresMouseEvents),
      @"level" : @(window.level),
      @"styled" : @(controller != nil),
      @"rounded" : @(content.cornerRadius == kCornerRadius && content.masksToBounds && !window.opaque),
      @"rim" : @(controller.overlay.layer.borderWidth),
      @"keepOnTop" : @(controller.keepOnTop),
      @"stashed" : @(controller.stashedEdge),
      @"key" : @(window.keyWindow),
      @"host" : controller.host ?: @"",
      @"backToTab" : @(controller.view != nil),
      @"minSize" : NSStringFromSize(window.contentMinSize),
      @"maxSize" : NSStringFromSize(window.contentMaxSize),
      @"resizable" : @((window.styleMask & NSWindowStyleMaskResizable) != 0),
      @"visibleFrame" : NSStringFromRect(ScreenFor(window.frame).visibleFrame),
    }];
  }
  return list;
}

+ (NSString *)devPictureInPictureAction:(NSString *)action {
  ArdiaPiPController *controller = nil;
  for (NSWindow *window in NSApp.windows)
    if ([ArdiaPiPController forWindow:window] && window.visible) controller = [ArdiaPiPController forWindow:window];
  if (!controller) return @"";
  if ([action isEqual:@"selftest"]) [controller runSelfTest];
  else if ([@[ @"close", @"backToTab" ] containsObject:action]) [controller runButtonSelfTest:action];
  else if ([action isEqual:@"menu"]) return [[controller.menu.itemArray valueForKey:@"title"] componentsJoinedByString:@"|"];
  else if ([action hasPrefix:@"snapshot:"]) return [controller snapshot:[action substringFromIndex:9]];
  else if ([action hasPrefix:@"frame:"]) [controller.window setFrame:NSRectFromString([action substringFromIndex:6]) display:YES];
  else if ([action hasPrefix:@"alpha:"]) return DevShowAlpha(controller.window, [action substringFromIndex:6].floatValue);
  else if ([action hasPrefix:@"mouse:"]) [controller devMouse:[[action substringFromIndex:6] componentsSeparatedByString:@":"]];
  else if ([action isEqual:@"stash"]) [controller stashAt:ArdiaPiPEdgeRight];
  else if ([action isEqual:@"handle"]) [controller.overlay.handle setHovered:!controller.overlay.handle.hovered];
  else if ([action hasPrefix:@"swipe:"]) [controller devSwipe:[[action substringFromIndex:6] componentsSeparatedByString:@","]];
  else if ([action hasPrefix:@"drag:"]) [controller devDrag:[[action substringFromIndex:5] componentsSeparatedByString:@","]];
  else if ([action isEqual:@"throw"]) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:[controller throwInfo] options:0 error:nil];
    return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"";
  }
  else return @"";
  return @"started";
}

@end
