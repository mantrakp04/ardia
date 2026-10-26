#import "ArdiaChromeWindowInternal.h"

#import <objc/runtime.h>

#include <initializer_list>

using namespace ardia_window;

namespace {

const void *kFullScreenLightsKey = &kFullScreenLightsKey;

const void *kFullScreenLightsWatchKey = &kFullScreenLightsWatchKey;

}

@interface ArdiaFullScreenLights : NSView
@end

@implementation ArdiaFullScreenLights {
  BOOL _hovered;
}

+ (instancetype)lightsForWindow:(NSWindow *)window {
  NSButton *standardClose = [window standardWindowButton:NSWindowCloseButton];
  if (!standardClose) return nil;
  ArdiaFullScreenLights *lights = [[ArdiaFullScreenLights alloc] initWithFrame:NSZeroRect];
  NSRect bounds = NSZeroRect;
  for (NSWindowButton kind : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton}) {
    NSButton *standard = [window standardWindowButton:kind];
    NSButton *button = standard ? [NSWindow standardWindowButton:kind forStyleMask:window.styleMask & ~NSWindowStyleMaskFullScreen] : nil;
    if (!button) continue;
    [button setFrameOrigin:NSMakePoint(NSMinX(standard.frame) - NSMinX(standardClose.frame), 0)];
    button.target = window;
    button.action = kind == NSWindowCloseButton ? @selector(performClose:)
                    : kind == NSWindowMiniaturizeButton ? @selector(performMiniaturize:)
                                                         : @selector(toggleFullScreen:);
    [lights addSubview:button];
    bounds = NSUnionRect(bounds, button.frame);
  }
  [lights setFrameSize:bounds.size];
  lights.autoresizingMask = NSViewMaxXMargin | NSViewMinYMargin;
  [lights addTrackingArea:[[NSTrackingArea alloc] initWithRect:NSZeroRect
                                                       options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect
                                                         owner:lights
                                                      userInfo:nil]];
  return lights;
}

- (void)setHovered:(BOOL)hovered {
  _hovered = hovered;
  for (NSView *button in self.subviews) button.needsDisplay = YES;
}

- (void)mouseEntered:(NSEvent *)event {
  [self setHovered:YES];
}

- (void)mouseExited:(NSEvent *)event {
  [self setHovered:NO];
}

- (BOOL)_mouseInGroup:(NSButton *)button {
  return _hovered;
}

@end

@interface NSTitlebarAccessoryViewController (ArdiaRevealAmount)
- (double)revealAmount;
- (void)setRevealAmount:(double)revealAmount;
@end

@interface ArdiaTitlebarRevealWatch : NSTitlebarAccessoryViewController
@property(nonatomic, copy) void (^revealChanged)(void);
@end

@implementation ArdiaTitlebarRevealWatch

- (void)setRevealAmount:(double)revealAmount {
  [super setRevealAmount:revealAmount];
  if (self.revealChanged) self.revealChanged();
}

@end

namespace {

const void *kTitlebarRevealWatchKey = &kTitlebarRevealWatchKey;

BOOL FullScreenTitlebarRevealed(NSWindow *window) {
  ArdiaTitlebarRevealWatch *watch = window ? objc_getAssociatedObject(window, kTitlebarRevealWatchKey) : nil;
  return watch && (window.styleMask & NSWindowStyleMaskFullScreen) && watch.revealAmount > 0;
}

}

namespace ardia_window {

void PlaceFullScreenLights(NSWindow *window) {
  ArdiaFullScreenLights *lights = window ? objc_getAssociatedObject(window, kFullScreenLightsKey) : nil;
  NSView *frameView = window.contentView.superview;
  NSView *close = lights.subviews.firstObject;
  if (!lights || !frameView || !close) return;
  ArdiaWindowFullScreen *state = objc_getAssociatedObject(window, kWindowFullScreenKey);
  lights.hidden = state.pageFullScreen || FullScreenTitlebarRevealed(window);
  const NSSize size = close.frame.size;
  const NSPoint center = LightsCenter(objc_getAssociatedObject(window, kLightsCenterKey), size);
  const CGFloat top = center.y - size.height / 2;
  [lights setFrameOrigin:NSMakePoint(center.x - size.width / 2,
                                     frameView.isFlipped ? top : NSHeight(frameView.bounds) - top - NSHeight(lights.frame))];
}
}

namespace {

void ShowFullScreenLights(NSWindow *window, BOOL show) {
  ArdiaFullScreenLights *lights = objc_getAssociatedObject(window, kFullScreenLightsKey);
  if (!show) {
    [lights removeFromSuperview];
    objc_setAssociatedObject(window, kFullScreenLightsKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return;
  }
  NSView *frameView = window.contentView.superview;
  if (lights || !frameView || !(lights = [ArdiaFullScreenLights lightsForWindow:window])) return;
  objc_setAssociatedObject(window, kFullScreenLightsKey, lights, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [frameView addSubview:lights positioned:NSWindowAbove relativeTo:nil];
  PlaceFullScreenLights(window);
}

void HideStandardLights(NSWindow *window, BOOL hide) {
  for (NSButton *button in TrafficLightButtons(window)) button.hidden = hide;
}

void ShowLightsForReveal(NSWindow *window) {
  if (!objc_getAssociatedObject(window, kFullScreenLightsKey)) return;
  HideStandardLights(window, !FullScreenTitlebarRevealed(window));
  PlaceFullScreenLights(window);
}

void WatchTitlebarReveal(NSWindow *window) {
  if (!(window.styleMask & NSWindowStyleMaskFullScreen) || objc_getAssociatedObject(window, kTitlebarRevealWatchKey) ||
      ![NSTitlebarAccessoryViewController instancesRespondToSelector:@selector(setRevealAmount:)])
    return;
  ArdiaTitlebarRevealWatch *watch = [[ArdiaTitlebarRevealWatch alloc] init];
  watch.view = [[NSView alloc] initWithFrame:NSZeroRect];
  watch.layoutAttribute = NSLayoutAttributeBottom;
  watch.fullScreenMinHeight = 0;
  __weak NSWindow *weakWindow = window;
  __weak ArdiaTitlebarRevealWatch *weakWatch = watch;
  watch.revealChanged = ^{
    NSWindow *w = weakWindow;
    if (w && objc_getAssociatedObject(w, kTitlebarRevealWatchKey) == weakWatch) ShowLightsForReveal(w);
  };
  objc_setAssociatedObject(window, kTitlebarRevealWatchKey, watch, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [window addTitlebarAccessoryViewController:watch];
}

void UnwatchTitlebarReveal(NSWindow *window) {
  ArdiaTitlebarRevealWatch *watch = objc_getAssociatedObject(window, kTitlebarRevealWatchKey);
  if (!watch) return;
  watch.revealChanged = nil;
  objc_setAssociatedObject(window, kTitlebarRevealWatchKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [watch removeFromParentViewController];
}

}

@interface ArdiaFullScreenLightsWatch : NSObject
@end

@implementation ArdiaFullScreenLightsWatch {
  __weak NSWindow *_window;
}

+ (void)watchWindow:(NSWindow *)window {
  if (!window || objc_getAssociatedObject(window, kFullScreenLightsWatchKey)) return;
  ArdiaFullScreenLightsWatch *watch = [[ArdiaFullScreenLightsWatch alloc] init];
  watch->_window = window;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [center addObserver:watch selector:@selector(didEnter) name:NSWindowDidEnterFullScreenNotification object:window];
  [center addObserver:watch selector:@selector(didExit) name:NSWindowDidExitFullScreenNotification object:window];
  objc_setAssociatedObject(window, kFullScreenLightsWatchKey, watch, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

- (void)didEnter {
  NSWindow *window = _window;
  if (!window) return;
  ShowFullScreenLights(window, YES);
  HideStandardLights(window, YES);
  WatchTitlebarReveal(window);
  ShowLightsForReveal(window);
}

- (void)didExit {
  NSWindow *window = _window;
  if (!window) return;
  UnwatchTitlebarReveal(window);
  HideStandardLights(window, NO);
  ShowFullScreenLights(window, NO);
}

@end

namespace ardia_window {

void WatchFullScreenLights(NSWindow *window) {
  [ArdiaFullScreenLightsWatch watchWindow:window];
}
}
