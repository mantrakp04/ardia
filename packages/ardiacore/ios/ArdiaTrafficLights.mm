#import "ArdiaChromeWindowInternal.h"
#import "ArdiaLaunchConfig.h"

#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>

#include <initializer_list>

using namespace ardia_window;

namespace ardia_window {

const void *kLightsCenterKey = &kLightsCenterKey;

const void *kLightsShownKey = &kLightsShownKey;

const void *kLightsMoveKey = &kLightsMoveKey;

}

namespace {

NSColor *WindowColor() {
  return [NSColor colorWithName:nil
                dynamicProvider:^NSColor *(NSAppearance *appearance) {
                  const bool dark = [[appearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameDarkAqua, NSAppearanceNameAqua ]]
                      isEqualToString:NSAppearanceNameDarkAqua];
                  return dark ? [NSColor colorWithSRGBRed:0.17 green:0.12 blue:0.14 alpha:1]
                              : [NSColor colorWithSRGBRed:0.93 green:0.91 blue:0.90 alpha:1];
                }];
}

constexpr CGFloat kTrafficLightInsetX = 18;

constexpr CGFloat kTrafficLightTop = 20;

const void *kInsetLightsKey = &kInsetLightsKey;

const void *kLoggedKey = &kLoggedKey;

NSFileHandle *gLightsLog;

NSString *LightsState(NSWindow *window) {
  NSMutableString *state = [NSMutableString string];
  BOOL hidden = NO;
  CGFloat alpha = 1;
  for (NSWindowButton kind : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton}) {
    NSButton *button = [window standardWindowButton:kind];
    if (!button) return @"no buttons";
    const NSRect r = [button convertRect:button.bounds toView:nil];
    [state appendFormat:@"%@=(%.1f,%.1f) ", kind == NSWindowCloseButton ? @"close" : kind == NSWindowZoomButton ? @"zoom" : @"mini",
                        NSMinX(r), NSHeight(window.frame) - NSMaxY(r)];
    hidden |= button.hiddenOrHasHiddenAncestor;
    CGFloat opacity = 1;
    for (NSView *view = button; view && view != window.contentView.superview; view = view.superview) opacity *= view.alphaValue;
    alpha = MIN(alpha, opacity);
  }
  [state appendFormat:@"hidden=%d alpha=%.2f", hidden, alpha];
  return state;
}

void LogLights(NSWindow *window, NSString *what) {
  if (!gLightsLog || !window) return;
  NSArray<NSString *> *stack = NSThread.callStackSymbols;
  NSMutableArray<NSString *> *callers = [NSMutableArray array];
  for (NSUInteger i = 2; i < stack.count && callers.count < 8; i++) {
    NSString *frame = stack[i];
    const NSRange at = [frame rangeOfString:@"0x"];
    NSString *symbol = at.location == NSNotFound ? frame : [frame substringFromIndex:at.location];
    const NSRange space = [symbol rangeOfString:@" "];
    [callers addObject:space.location == NSNotFound ? symbol : [symbol substringFromIndex:space.location + 1]];
  }
  NSString *line = [NSString stringWithFormat:@"%.3f window=%ld %@ -> %@ | %@\n", NSProcessInfo.processInfo.systemUptime,
                                              (long)window.windowNumber, what, LightsState(window),
                                              [callers componentsJoinedByString:@" < "]];
  if (![gLightsLog writeData:[line dataUsingEncoding:NSUTF8StringEncoding] error:nil]) gLightsLog = nil;
}

void Swizzle(Class cls, SEL sel, id (^make)(IMP original)) {
  Method method = class_getInstanceMethod(cls, sel);
  IMP original = method_getImplementation(method);
  method_setImplementation(method, imp_implementationWithBlock(make(original)));
}

void InstallTrafficLightsLog() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    ArdiaLaunchConfig *config = ArdiaLaunchConfig.shared;
    if (![config traced:@"trafficLights"] || !config.dataDirectory) return;
    NSString *path = [config.dataDirectory stringByAppendingPathComponent:@"traffic-lights.log"];
    [NSFileManager.defaultManager createFileAtPath:path contents:nil attributes:nil];
    gLightsLog = [NSFileHandle fileHandleForWritingAtPath:path];
    if (!gLightsLog || ![gLightsLog seekToEndReturningOffset:nil error:nil]) {
      gLightsLog = nil;
      return;
    }
    auto logged = ^NSWindow *(NSView *view) { return objc_getAssociatedObject(view, kLoggedKey) ? view.window : nil; };
    Swizzle(NSView.class, @selector(setFrameOrigin:), ^id(IMP original) {
      return ^(NSView *self, NSPoint origin) {
        const NSRect before = self.frame;
        ((void (*)(id, SEL, NSPoint))original)(self, @selector(setFrameOrigin:), origin);
        if (NSWindow *window = logged(self); window && !NSEqualRects(before, self.frame))
          LogLights(window, [NSString stringWithFormat:@"%@ setFrameOrigin %@", self.className, NSStringFromPoint(origin)]);
      };
    });
    Swizzle(NSView.class, @selector(setFrameSize:), ^id(IMP original) {
      return ^(NSView *self, NSSize size) {
        const NSRect before = self.frame;
        ((void (*)(id, SEL, NSSize))original)(self, @selector(setFrameSize:), size);
        if (NSWindow *window = logged(self); window && !NSEqualRects(before, self.frame))
          LogLights(window, [NSString stringWithFormat:@"%@ setFrameSize %@", self.className, NSStringFromSize(size)]);
      };
    });
    Swizzle(NSView.class, @selector(setFrame:), ^id(IMP original) {
      return ^(NSView *self, NSRect frame) {
        const NSRect before = self.frame;
        ((void (*)(id, SEL, NSRect))original)(self, @selector(setFrame:), frame);
        if (NSWindow *window = logged(self); window && !NSEqualRects(before, self.frame))
          LogLights(window, [NSString stringWithFormat:@"%@ setFrame %@", self.className, NSStringFromRect(frame)]);
      };
    });
    Swizzle(NSView.class, @selector(setHidden:), ^id(IMP original) {
      return ^(NSView *self, BOOL hidden) {
        const BOOL before = self.hidden;
        ((void (*)(id, SEL, BOOL))original)(self, @selector(setHidden:), hidden);
        if (NSWindow *window = logged(self); window && before != hidden)
          LogLights(window, [NSString stringWithFormat:@"%@ setHidden %d", self.className, hidden]);
      };
    });
    Swizzle(NSView.class, @selector(setAlphaValue:), ^id(IMP original) {
      return ^(NSView *self, CGFloat alpha) {
        const CGFloat before = self.alphaValue;
        ((void (*)(id, SEL, CGFloat))original)(self, @selector(setAlphaValue:), alpha);
        if (NSWindow *window = logged(self); window && before != alpha)
          LogLights(window, [NSString stringWithFormat:@"%@ setAlphaValue %.2f", self.className, alpha]);
      };
    });
    const SEL layout = NSSelectorFromString(@"_updateButtonPositions");
    if (Class themeFrame = NSClassFromString(@"NSThemeFrame"); class_getInstanceMethod(themeFrame, layout))
      Swizzle(themeFrame, layout, ^id(IMP original) {
        return ^(NSView *self) {
          ((void (*)(id, SEL))original)(self, layout);
          if (objc_getAssociatedObject(self.window, kLoggedKey)) LogLights(self.window, @"layout");
        };
      });
    Swizzle(NSWindow.class, @selector(setStyleMask:), ^id(IMP original) {
      return ^(NSWindow *self, NSWindowStyleMask mask) {
        const NSWindowStyleMask before = self.styleMask;
        ((void (*)(id, SEL, NSWindowStyleMask))original)(self, @selector(setStyleMask:), mask);
        if (objc_getAssociatedObject(self, kLoggedKey) && before != mask)
          LogLights(self, [NSString stringWithFormat:@"setStyleMask %#llx -> %#llx", (unsigned long long)before, (unsigned long long)mask]);
      };
    });
  });
}

void LogTrafficLightsOf(NSWindow *window) {
  if (!gLightsLog || !window) return;
  objc_setAssociatedObject(window, kLoggedKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  for (NSWindowButton kind : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton})
    for (NSView *view = [window standardWindowButton:kind]; view && view != window.contentView.superview; view = view.superview)
      objc_setAssociatedObject(view, kLoggedKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

void InstallTrafficLightsOrigin(Class frameClass) {
  static NSMutableSet<Class> *installed = [NSMutableSet set];
  if (!frameClass || [installed containsObject:frameClass]) return;
  [installed addObject:frameClass];
  const SEL sel = NSSelectorFromString(@"_closeButtonOrigin");
  Method method = class_getInstanceMethod(frameClass, sel);
  if (!method) return;
  const IMP standard = method_getImplementation(method);
  const IMP ours = imp_implementationWithBlock(^NSPoint(NSView *frameView) {
    NSWindow *window = frameView.window;
    if (!window || !objc_getAssociatedObject(window, kInsetLightsKey) || (window.styleMask & NSWindowStyleMaskFullScreen))
      return ((NSPoint (*)(id, SEL))standard)(frameView, sel);
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    const NSSize size = close ? close.frame.size : NSMakeSize(14, 14);
    const CGFloat height = NSHeight(frameView.bounds);
    if (NSValue *center = objc_getAssociatedObject(window, kLightsCenterKey))
      return NSMakePoint(center.pointValue.x - size.width / 2, height - center.pointValue.y - size.height / 2);
    return NSMakePoint(kTrafficLightInsetX, height - kTrafficLightTop - size.height);
  });
  if (!class_addMethod(frameClass, sel, ours, method_getTypeEncoding(method))) method_setImplementation(method, ours);
}

const void *kSharingIndicatorTuckedKey = &kSharingIndicatorTuckedKey;

void KeepSharingIndicatorInWindow(NSView *frameView, CGFloat dx) {
  const SEL sel = NSSelectorFromString(@"sharingIndicator");
  NSView *indicator = [frameView respondsToSelector:sel] ? ((NSView * (*)(id, SEL))objc_msgSend)(frameView, sel) : nil;
  if (![indicator isKindOfClass:NSView.class]) return;
  if (indicator.layer && (dx != 0 || indicator.layer.affineTransform.tx != 0))
    indicator.layer.affineTransform = CGAffineTransformMakeTranslation(dx, 0);
  const NSRect shown = NSOffsetRect([indicator convertRect:indicator.bounds toView:frameView], dx, 0);
  const BOOL outside = !NSContainsRect(frameView.bounds, shown);
  if (outside == (objc_getAssociatedObject(indicator, kSharingIndicatorTuckedKey) != nil)) return;
  objc_setAssociatedObject(indicator, kSharingIndicatorTuckedKey, outside ? @YES : nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  indicator.hidden = outside;
}

void InstallSharingIndicatorBounds(Class frameClass) {
  static NSMutableSet<Class> *installed = [NSMutableSet set];
  if (!frameClass || [installed containsObject:frameClass]) return;
  [installed addObject:frameClass];
  const SEL sel = NSSelectorFromString(@"_positionSharingIndicator");
  Method method = class_getInstanceMethod(frameClass, sel);
  if (!method) return;
  const IMP standard = method_getImplementation(method);
  const IMP ours = imp_implementationWithBlock(^(NSView *frameView) {
    ((void (*)(id, SEL))standard)(frameView, sel);
    NSWindow *window = frameView.window;
    if (!objc_getAssociatedObject(window, kInsetLightsKey)) return;
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    KeepSharingIndicatorInWindow(frameView, close.layer ? close.layer.affineTransform.tx : 0);
  });
  if (!class_addMethod(frameClass, sel, ours, method_getTypeEncoding(method))) method_setImplementation(method, ours);
}

const void *kSharingWindowPlacedKey = &kSharingWindowPlacedKey;

const void *kSharingWindowShiftKey = &kSharingWindowShiftKey;

const void *kSharingWindowTuckedKey = &kSharingWindowTuckedKey;

void TuckSharingWindow(NSWindow *pill, BOOL outside) {
  NSDictionary *tucked = objc_getAssociatedObject(pill, kSharingWindowTuckedKey);
  if (outside) {
    if (!tucked)
      objc_setAssociatedObject(pill, kSharingWindowTuckedKey, @{@"alpha" : @(pill.alphaValue), @"ignores" : @(pill.ignoresMouseEvents)},
                               OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    pill.alphaValue = 0;
    pill.ignoresMouseEvents = YES;
    return;
  }
  if (!tucked) return;
  objc_setAssociatedObject(pill, kSharingWindowTuckedKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  pill.alphaValue = [tucked[@"alpha"] doubleValue];
  pill.ignoresMouseEvents = [tucked[@"ignores"] boolValue];
}

void KeepSharingWindowOnHost(NSWindow *pill) {
  const SEL hostSel = NSSelectorFromString(@"hostWindow");
  NSWindow *host = [pill respondsToSelector:hostSel] ? ((NSWindow * (*)(id, SEL))objc_msgSend)(pill, hostSel) : nil;
  NSPoint origin = pill.frame.origin;
  NSValue *placed = objc_getAssociatedObject(pill, kSharingWindowPlacedKey);
  if (placed && NSEqualPoints(origin, placed.pointValue))
    origin.x -= [objc_getAssociatedObject(pill, kSharingWindowShiftKey) doubleValue];
  const BOOL follows = [host isKindOfClass:NSWindow.class] && objc_getAssociatedObject(host, kInsetLightsKey) &&
                       !(host.styleMask & NSWindowStyleMaskFullScreen);
  NSButton *close = follows ? [host standardWindowButton:NSWindowCloseButton] : nil;
  const CGFloat dx = close.layer ? close.layer.affineTransform.tx : 0;
  const NSPoint target = NSMakePoint(origin.x + dx, origin.y);
  if (!NSEqualPoints(target, pill.frame.origin)) [pill setFrameOrigin:target];
  objc_setAssociatedObject(pill, kSharingWindowPlacedKey, [NSValue valueWithPoint:target], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  objc_setAssociatedObject(pill, kSharingWindowShiftKey, @(dx), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  TuckSharingWindow(pill, follows && !NSContainsRect(host.frame, pill.frame));
}

void InstallSharingWindowBounds() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Class pillClass = NSClassFromString(@"NSLocalWindowSharingWindow");
    const SEL sel = NSSelectorFromString(@"_syncToWindowControls");
    Method method = pillClass ? class_getInstanceMethod(pillClass, sel) : nullptr;
    if (!method) return;
    const IMP standard = method_getImplementation(method);
    const IMP ours = imp_implementationWithBlock(^(NSWindow *pill) {
      ((void (*)(id, SEL))standard)(pill, sel);
      KeepSharingWindowOnHost(pill);
    });
    if (!class_addMethod(pillClass, sel, ours, method_getTypeEncoding(method))) method_setImplementation(method, ours);
  });
}

void SyncSharingWindows(NSWindow *window) {
  Class pillClass = NSClassFromString(@"NSLocalWindowSharingWindow");
  const SEL sel = NSSelectorFromString(@"_syncToWindowControls");
  for (NSWindow *child in window.childWindows)
    if ([child isKindOfClass:pillClass] && [child respondsToSelector:sel]) ((void (*)(id, SEL))objc_msgSend)(child, sel);
}

constexpr int64_t kLightsSettle = 50 * NSEC_PER_MSEC;

}

namespace ardia_window {

void RetileTrafficLights(NSWindow *window) {
  NSView *frameView = window.contentView.superview;
  for (NSString *name in @[ @"_updateButtonPositions", @"_positionSharingIndicator" ]) {
    const SEL sel = NSSelectorFromString(name);
    if ([frameView respondsToSelector:sel]) ((void (*)(id, SEL))objc_msgSend)(frameView, sel);
  }
  SyncSharingWindows(window);
}

NSArray<NSButton *> *TrafficLightButtons(NSWindow *window) {
  NSMutableArray *buttons = [NSMutableArray array];
  for (NSWindowButton kind : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton})
    if (NSButton *button = [window standardWindowButton:kind]) [buttons addObject:button];
  return buttons;
}

NSPoint LightsCenter(NSValue *center, NSSize size) {
  return center ? center.pointValue : NSMakePoint(kTrafficLightInsetX + size.width / 2, kTrafficLightTop + size.height / 2);
}

void TranslateTrafficLights(NSWindow *window, CGFloat dx) {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  for (NSButton *button in TrafficLightButtons(window)) button.layer.affineTransform = CGAffineTransformMakeTranslation(dx, 0);
  KeepSharingIndicatorInWindow(window.contentView.superview, dx);
  SyncSharingWindows(window);
  [CATransaction commit];
}

}

namespace {

void SettleTrafficLights(NSWindow *window) {
  id shown = objc_getAssociatedObject(window, kLightsShownKey);
  if (!shown) return;
  objc_setAssociatedObject(window, kLightsShownKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  objc_setAssociatedObject(window, kLightsCenterKey, shown == NSNull.null ? nil : shown, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  TranslateTrafficLights(window, 0);
  RetileTrafficLights(window);
  [CATransaction commit];
}

void InsetTrafficLights(NSWindow *window) {
  objc_setAssociatedObject(window, kInsetLightsKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  InstallTrafficLightsOrigin([window.contentView.superview class]);
  InstallSharingIndicatorBounds([window.contentView.superview class]);
  InstallSharingWindowBounds();
  RetileTrafficLights(window);
  LogTrafficLightsOf(window);
}

}

namespace ardia_window {

bool MoveTrafficLights(NSWindow *window, NSValue *center) {
  NSArray<NSButton *> *buttons = TrafficLightButtons(window);
  if (!buttons.count || !objc_getAssociatedObject(window, kInsetLightsKey) || (window.styleMask & NSWindowStyleMaskFullScreen))
    return false;
  for (NSButton *button in buttons)
    if (!button.layer) return false;
  const NSSize size = buttons[0].frame.size;
  const NSPoint laidOut = LightsCenter(objc_getAssociatedObject(window, kLightsCenterKey), size), to = LightsCenter(center, size);
  if (to.y != laidOut.y) return false;
  TranslateTrafficLights(window, to.x - laidOut.x);
  if (to.x == laidOut.x) {
    objc_setAssociatedObject(window, kLightsShownKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, kLightsMoveKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return true;
  }
  objc_setAssociatedObject(window, kLightsShownKey, center ?: NSNull.null, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  NSObject *move = [[NSObject alloc] init];
  objc_setAssociatedObject(window, kLightsMoveKey, move, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  __weak NSWindow *weakWindow = window;
  __weak NSObject *weakMove = move;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kLightsSettle), dispatch_get_main_queue(), ^{
    if (NSWindow *w = weakWindow; w && weakMove) SettleTrafficLights(w);
  });
  return true;
}

void ConfigureWindow(NSWindow *window) {
  InstallTrafficLightsLog();
  const NSRect frame = window.frame;
  window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  if (!NSEqualRects(window.frame, frame)) [window setFrame:frame display:NO];
  window.titlebarAppearsTransparent = YES;
  window.titleVisibility = NSWindowTitleHidden;
  window.title = @"Ardia";
  window.minSize = NSMakeSize(720, 460);
  window.backgroundColor = WindowColor();
  window.releasedWhenClosed = NO;
  window.tabbingMode = NSWindowTabbingModeDisallowed;
  InsetTrafficLights(window);
  WatchFullScreenLights(window);
  SuppressFullScreenTitlebar(window);
}

}

NSValue *ArdiaTrafficLightsCenter(NSWindow *window) {
  return window ? objc_getAssociatedObject(window, kLightsCenterKey) : nil;
}
