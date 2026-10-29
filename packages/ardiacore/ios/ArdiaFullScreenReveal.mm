#import "ArdiaChromeWindowInternal.h"
#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"

#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>

#include <algorithm>
#include <cmath>

using namespace ardia_window;
using namespace ardia_runtime;

@interface ArdiaFullScreenReveal : NSObject {
 @public
  double _amount;
  CGFloat _height;
  NSArray *_observers;
}
@end

@implementation ArdiaFullScreenReveal

- (void)dealloc {
  for (id observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
}

@end

namespace {

const void *kRevealKey = &kRevealKey;

const void *kSuppressesTitlebarKey = &kSuppressesTitlebarKey;

const void *kBackdropPlacedKey = &kBackdropPlacedKey;

const void *kBackdropShiftKey = &kBackdropShiftKey;

CGFloat gMenuBarHeight;

NSScreen *ScreenOf(NSWindow *window) {
  return window.screen ?: NSScreen.mainScreen;
}

CGFloat MenuBarHeight(NSScreen *screen) {
  if (screen.safeAreaInsets.top > 0) return screen.safeAreaInsets.top;
  const CGFloat height = NSApp.mainMenu.menuBarHeight;
  if (height > 0) gMenuBarHeight = height;
  return gMenuBarHeight;
}

CGFloat MenuBarOverlap(NSWindow *window) {
  NSScreen *screen = ScreenOf(window);
  const CGFloat height = MenuBarHeight(screen);
  if (!screen || height <= 0) return 0;
  const CGFloat top = objc_getAssociatedObject(window, kActedFullScreenKey) ? NSMaxY(screen.frame) - screen.safeAreaInsets.top : NSMaxY(window.frame);
  return std::clamp(top - (NSMaxY(screen.frame) - height), (CGFloat)0, height);
}

NSView *HostView(NSWindow *window) {
  return [ArdiaWindowController forNSWindow:window].coreWindow.hostView;
}

NSArray<NSView *> *Backdrops(NSView *root) {
  static Class backdrop = NSClassFromString(@"ArdiaShaders.WindowBackdropView");
  NSMutableArray<NSView *> *found = [NSMutableArray array];
  if (!root || !backdrop) return found;
  const NSSize full = root.bounds.size;
  NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithArray:root.subviews];
  while (queue.count) {
    NSView *view = queue.lastObject;
    [queue removeLastObject];
    if (!NSEqualSizes(view.frame.size, full)) continue;
    if ([view isKindOfClass:backdrop]) [found addObject:view];
    else [queue addObjectsFromArray:view.subviews];
  }
  return found;
}

void RaiseBackdrop(NSView *backdrop, CGFloat up) {
  NSPoint base = backdrop.frame.origin;
  NSValue *placed = objc_getAssociatedObject(backdrop, kBackdropPlacedKey);
  if (placed && NSEqualPoints(placed.pointValue, base)) base.y -= [objc_getAssociatedObject(backdrop, kBackdropShiftKey) doubleValue];
  const CGFloat dy = backdrop.superview.isFlipped ? -up : up;
  const NSPoint target = NSMakePoint(base.x, base.y + dy);
  if (!NSEqualPoints(target, backdrop.frame.origin)) [backdrop setFrameOrigin:target];
  objc_setAssociatedObject(backdrop, kBackdropPlacedKey, up ? [NSValue valueWithPoint:target] : nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  objc_setAssociatedObject(backdrop, kBackdropShiftKey, up ? @(dy) : nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

BOOL ShiftContent(NSWindow *window, CGFloat height) {
  NSView *host = HostView(window), *content = host.superview;
  if (!host || !content) return NO;
  const NSPoint origin = NSMakePoint(NSMinX(host.frame), content.isFlipped ? height : -height);
  const BOOL moved = !NSEqualPoints(origin, host.frame.origin);
  if (moved) [host setFrameOrigin:origin];
  for (NSView *backdrop in Backdrops([ArdiaChromeWindowHost rootViewOfWindow:window])) RaiseBackdrop(backdrop, height);
  return moved;
}

NSArray<NSView *> *PageViews(NSWindow *window) {
  static Class page = NSClassFromString(@"RenderWidgetHostViewCocoa");
  NSMutableArray<NSView *> *pages = [NSMutableArray array];
  if (!page) return pages;
  for (ArdiaWebView *view in ardia_web_view::LiveViews()) {
    if (view.window != window) continue;
    NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:view];
    while (queue.count) {
      NSView *v = queue.lastObject;
      [queue removeLastObject];
      if ([v isKindOfClass:page]) [pages addObject:v];
      else [queue addObjectsFromArray:v.subviews];
    }
  }
  return pages;
}

void TellPagesTheyMoved(NSWindow *window) {
  const SEL moved = NSSelectorFromString(@"windowChangedGlobalFrame:");
  for (NSView *page in PageViews(window)) {
    if ([page respondsToSelector:moved]) ((void (*)(id, SEL, id))objc_msgSend)(page, moved, nil);
    else [page setFrameOrigin:page.frame.origin];
  }
}

CGFloat Top(NSView *view) {
  NSView *frameView = view.window.contentView.superview;
  if (!frameView) return 0;
  const NSRect r = [view convertRect:view.bounds toView:frameView];
  return frameView.isFlipped ? NSMinY(r) : NSHeight(frameView.bounds) - NSMaxY(r);
}

id FrameHeight(NSView *frameView, NSString *name) {
  const SEL sel = NSSelectorFromString(name);
  return [frameView respondsToSelector:sel] ? @(((double (*)(id, SEL))objc_msgSend)(frameView, sel)) : NSNull.null;
}

NSArray *SizeOf(NSView *view) {
  return view ? @[ @(NSWidth(view.frame)), @(NSHeight(view.frame)) ] : @[];
}

void PlaceReveal(NSWindow *window, BOOL force) {
  ArdiaFullScreenReveal *reveal = window ? objc_getAssociatedObject(window, kRevealKey) : nil;
  ArdiaWindowFullScreen *state = reveal ? objc_getAssociatedObject(window, kWindowFullScreenKey) : nil;
  const CGFloat scale = window.backingScaleFactor ?: 1;
  const CGFloat height = reveal && IsWindowFullScreen(window) && !state.pageFullScreen
                             ? round(reveal->_amount * MenuBarOverlap(window) * scale) / scale
                             : 0;
  if (!reveal || (!force && height == reveal->_height)) return PlaceFullScreenLights(window);
  reveal->_height = height;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  const BOOL moved = ShiftContent(window, height);
  PlaceFullScreenLights(window);
  [CATransaction commit];
  if (moved) TellPagesTheyMoved(window);
}

NSArray *WatchGeometry(NSWindow *window) {
  __weak NSWindow *weakWindow = window;
  NSMutableArray *observers = [NSMutableArray array];
  for (NSNotificationName name in @[
         NSWindowDidResizeNotification, NSWindowDidChangeScreenNotification, NSWindowDidChangeBackingPropertiesNotification
       ])
    [observers addObject:[NSNotificationCenter.defaultCenter addObserverForName:name
                                                                         object:window
                                                                          queue:nil
                                                                     usingBlock:^(NSNotification *) {
                                                                       NSWindow *w = weakWindow;
                                                                       if (w && IsWindowFullScreen(w)) PlaceReveal(w, YES);
                                                                     }]];
  return observers;
}

void InstallTitlebarHeights(Class frameClass) {
  static NSMutableSet<Class> *installed = [NSMutableSet set];
  if (!frameClass || [installed containsObject:frameClass]) return;
  [installed addObject:frameClass];
  for (NSString *name in @[ @"fullScreenTitlebarMaxHeight", @"fullScreenTitlebarMinHeight" ]) {
    const SEL sel = NSSelectorFromString(name);
    ReplaceMethod(frameClass, sel, ^id(IMP standard) {
      return ^double(NSView *frameView) {
        NSWindow *window = frameView.window;
        if (window && objc_getAssociatedObject(window, kSuppressesTitlebarKey) && IsWindowFullScreen(window)) return 0;
        return ((double (*)(id, SEL))standard)(frameView, sel);
      };
    });
  }
}

}

namespace ardia_window {

void SuppressFullScreenTitlebar(NSWindow *window) {
  objc_setAssociatedObject(window, kSuppressesTitlebarKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  InstallTitlebarHeights([window.contentView.superview class]);
}

CGFloat FullScreenRevealHeight(NSWindow *window) {
  ArdiaFullScreenReveal *reveal = window ? objc_getAssociatedObject(window, kRevealKey) : nil;
  return reveal ? reveal->_height : 0;
}

void ApplyFullScreenReveal(NSWindow *window) {
  PlaceReveal(window, NO);
}

void SetFullScreenRevealAmount(NSWindow *window, double amount) {
  if (!window) return;
  ArdiaFullScreenReveal *reveal = objc_getAssociatedObject(window, kRevealKey);
  if (!reveal && !(amount > 0)) return;
  if (!reveal) {
    reveal = [ArdiaFullScreenReveal new];
    reveal->_observers = WatchGeometry(window);
    objc_setAssociatedObject(window, kRevealKey, reveal, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  reveal->_amount = std::isfinite(amount) ? std::clamp(amount, 0.0, 1.0) : 0;
  ApplyFullScreenReveal(window);
}

NSDictionary *FullScreenRevealState(NSWindow *window) {
  ArdiaFullScreenReveal *reveal = objc_getAssociatedObject(window, kRevealKey);
  ArdiaWindowFullScreen *state = objc_getAssociatedObject(window, kWindowFullScreenKey);
  NSView *frameView = window.contentView.superview, *host = HostView(window), *root = [ArdiaChromeWindowHost rootViewOfWindow:window];
  NSView *lights = FullScreenLightsView(window);
  NSMutableArray *backdrops = [NSMutableArray array], *pages = [NSMutableArray array], *standard = [NSMutableArray array];
  for (NSView *backdrop in Backdrops(root)) [backdrops addObject:@{@"top" : @(Top(backdrop)), @"size" : SizeOf(backdrop)}];
  for (NSView *page in PageViews(window)) [pages addObject:@{@"top" : @(Top(page)), @"size" : SizeOf(page)}];
  for (NSButton *button in TrafficLightButtons(window)) [standard addObject:@(button.hiddenOrHasHiddenAncestor)];
  NSMutableDictionary *out = [@{
    @"fullScreen" : @(IsWindowFullScreen(window)),
    @"styleMask" : @((window.styleMask & NSWindowStyleMaskFullScreen) != 0),
    @"pageFullScreen" : @(state.pageFullScreen),
    @"amount" : @(reveal ? reveal->_amount : 0),
    @"menuBarHeight" : @(MenuBarHeight(ScreenOf(window))),
    @"overlap" : @(MenuBarOverlap(window)),
    @"height" : @(FullScreenRevealHeight(window)),
    @"frameClass" : NSStringFromClass(object_getClass(frameView)) ?: @"",
    @"titlebarMaxHeight" : FrameHeight(frameView, @"fullScreenTitlebarMaxHeight"),
    @"titlebarMinHeight" : FrameHeight(frameView, @"fullScreenTitlebarMinHeight"),
    @"windowSize" : @[ @(NSWidth(window.frame)), @(NSHeight(window.frame)) ],
    @"contentSize" : SizeOf(window.contentView),
    @"hostTop" : @(host ? Top(host) : 0),
    @"hostSize" : SizeOf(host),
    @"rootTop" : @(root ? Top(root) : 0),
    @"rootSize" : SizeOf(root),
    @"backdrops" : backdrops,
    @"pages" : pages,
    @"standardLightsHidden" : standard,
  } mutableCopy];
  if (lights)
    out[@"lights"] = @{
      @"top" : @(Top(lights)),
      @"left" : @(NSMinX([lights convertRect:lights.bounds toView:nil])),
      @"size" : SizeOf(lights),
      @"hidden" : @(lights.hiddenOrHasHiddenAncestor),
    };
  return out;
}

}
