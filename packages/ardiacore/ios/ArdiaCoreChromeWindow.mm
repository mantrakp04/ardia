#import "ACChromeWindow.h"
#import "ArdiaCoreEarlyWindow.h"
#import "ArdiaCoreInternal.h"
#import "ArdiaCoreWebView.h"
#import "ArdiaCoreWebViewInternal.h"
#import "ArdiaCoreServices.h"

#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>

#include <initializer_list>

namespace {

BOOL (^gShouldClose)(NSWindow *);
BOOL (^gRefusesUnhandledKey)(NSWindow *, NSEvent *);
void (^gSwapped)(NSWindow *, NSWindow *);

NSMapTable<NSWindow *, ArdiaCoreWindowController *> *Controllers() {
  static NSMapTable *controllers = [NSMapTable weakToStrongObjectsMapTable];
  return controllers;
}

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
const void *kLightsCenterKey = &kLightsCenterKey;

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
    NSString *path = NSProcessInfo.processInfo.environment[@"ARDIA_TRAFFIC_LIGHTS_LOG"];
    if (!path.length) return;
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

void RetileTrafficLights(NSWindow *window) {
  NSView *frameView = window.contentView.superview;
  const SEL sel = NSSelectorFromString(@"_updateButtonPositions");
  if ([frameView respondsToSelector:sel]) ((void (*)(id, SEL))objc_msgSend)(frameView, sel);
}

const void *kLightsShownKey = &kLightsShownKey;
const void *kLightsMoveKey = &kLightsMoveKey;
constexpr int64_t kLightsSettle = 50 * NSEC_PER_MSEC;

NSArray<NSButton *> *TrafficLightButtons(NSWindow *window) {
  NSMutableArray *buttons = [NSMutableArray array];
  for (NSWindowButton kind : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton})
    if (NSButton *button = [window standardWindowButton:kind]) [buttons addObject:button];
  return buttons;
}

NSPoint LightsCenter(NSValue *center, NSSize size) {
  return center ? center.pointValue : NSMakePoint(kTrafficLightInsetX + size.width / 2, kTrafficLightTop + size.height / 2);
}

void TranslateTrafficLights(NSArray<NSButton *> *buttons, CGFloat dx) {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  for (NSButton *button in buttons) button.layer.affineTransform = CGAffineTransformMakeTranslation(dx, 0);
  [CATransaction commit];
}

void SettleTrafficLights(NSWindow *window) {
  id shown = objc_getAssociatedObject(window, kLightsShownKey);
  if (!shown) return;
  objc_setAssociatedObject(window, kLightsShownKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  objc_setAssociatedObject(window, kLightsCenterKey, shown == NSNull.null ? nil : shown, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  TranslateTrafficLights(TrafficLightButtons(window), 0);
  RetileTrafficLights(window);
  [CATransaction commit];
}

bool MoveTrafficLights(NSWindow *window, NSValue *center) {
  NSArray<NSButton *> *buttons = TrafficLightButtons(window);
  if (!buttons.count || !objc_getAssociatedObject(window, kInsetLightsKey) || (window.styleMask & NSWindowStyleMaskFullScreen))
    return false;
  for (NSButton *button in buttons)
    if (!button.layer) return false;
  const NSSize size = buttons[0].frame.size;
  const NSPoint laidOut = LightsCenter(objc_getAssociatedObject(window, kLightsCenterKey), size), to = LightsCenter(center, size);
  if (to.y != laidOut.y) return false;
  TranslateTrafficLights(buttons, to.x - laidOut.x);
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

void InsetTrafficLights(NSWindow *window) {
  objc_setAssociatedObject(window, kInsetLightsKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  InstallTrafficLightsOrigin(object_getClass(window.contentView.superview));
  RetileTrafficLights(window);
  LogTrafficLightsOf(window);
}

void WatchFullScreenLights(NSWindow *window);

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
}

NSSet<NSString *> *ReservedIdentifiers() {
  static NSSet<NSString *> *reserved = [NSSet setWithArray:@[
    @"ardia.command.newTab", @"ardia.command.reopenClosedTab", @"ardia.command.closeTab", @"ardia.command.newWindow",
    @"ardia.command.newIncognitoWindow", @"ardia.command.tabSwitcher", @"ardia.command.nextTab", @"ardia.command.previousTab",
    @"ardia.shortcut.std:closeWindow:", @"ardia.shortcut.std:quit:"
  ]];
  return reserved;
}

NSMenuItem *ReservedMenuItem(NSMenu *menu, NSString *key, NSEventModifierFlags mods) {
  NSSet<NSString *> *reserved = ReservedIdentifiers();
  const NSEventModifierFlags relevant = NSEventModifierFlagCommand | NSEventModifierFlagShift | NSEventModifierFlagOption | NSEventModifierFlagControl;
  for (NSMenuItem *item in menu.itemArray) {
    if (item.submenu) {
      if (item.submenu == NSApp.servicesMenu) continue;
      if (NSMenuItem *found = ReservedMenuItem(item.submenu, key, mods)) return found;
      continue;
    }
    if (!item.identifier || ![reserved containsObject:item.identifier] || !item.keyEquivalent.length) continue;
    if (item.isHidden && !item.allowsKeyEquivalentWhenHidden) continue;
    NSEventModifierFlags itemMods = item.keyEquivalentModifierMask & relevant;
    if (![item.keyEquivalent isEqualToString:item.keyEquivalent.lowercaseString]) itemMods |= NSEventModifierFlagShift;
    if (itemMods == (mods & relevant) && [item.keyEquivalent.lowercaseString isEqualToString:key]) return item;
  }
  return nil;
}

NSMenuItem *ReservedMenuItemForEvent(NSEvent *event) {
  const NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  NSString *key = event.charactersIgnoringModifiers.lowercaseString;
  const unichar first = key.length ? [key characterAtIndex:0] : 0;
  const bool functionKey = first >= NSF1FunctionKey && first <= NSF35FunctionKey;
  if (!functionKey && !(mods & (NSEventModifierFlagCommand | NSEventModifierFlagControl))) return nil;
  if ([key isEqualToString:@"\x19"]) key = @"\t";
  if (NSMenuItem *item = ReservedMenuItem(NSApp.mainMenu, key, mods)) return item;
  NSString *unshifted = [event charactersByApplyingModifiers:0].lowercaseString;
  if (!unshifted.length || [unshifted isEqualToString:key]) return nil;
  return ReservedMenuItem(NSApp.mainMenu, unshifted, mods);
}

bool IsReservedKey(NSEvent *event) {
  return ReservedMenuItemForEvent(event) != nil;
}

}

namespace {

const void *kActedFullScreenKey = &kActedFullScreenKey;
const void *kActingKey = &kActingKey;
const void *kWindowFullScreenKey = &kWindowFullScreenKey;

BOOL IsWindowFullScreen(NSWindow *window) {
  return window && ((window.styleMask & NSWindowStyleMaskFullScreen) || objc_getAssociatedObject(window, kActedFullScreenKey));
}

const void *kActedOcclusionKey = &kActedOcclusionKey;

void ActOcclusion(NSWindow *window, NSNumber *visible) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Method m = class_getInstanceMethod(NSWindow.class, @selector(occlusionState));
    auto original = (NSWindowOcclusionState(*)(id, SEL))method_getImplementation(m);
    method_setImplementation(m, imp_implementationWithBlock(^NSWindowOcclusionState(NSWindow *w) {
      NSNumber *acted = objc_getAssociatedObject(w, kActedOcclusionKey);
      return acted ? (acted.boolValue ? NSWindowOcclusionStateVisible : 0) : original(w, @selector(occlusionState));
    }));
  });
  objc_setAssociatedObject(window, kActedOcclusionKey, visible, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  if (getenv("ARDIA_TRACE_VISIBILITY")) NSLog(@"[ardiacore-vis] window %ld acted occlusion %@", (long)window.windowNumber, visible ?: @"off");
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowDidChangeOcclusionStateNotification object:window];
}

NSTimeInterval gActedOcclusionGap = NAN;
const void *kActedOcclusionTurnKey = &kActedOcclusionTurnKey;
const void *kActedRestoreFrameKey = &kActedRestoreFrameKey;

void ActWindowFullScreen(ArdiaCoreWindow *coreWindow, BOOL enter, NSTimeInterval seconds) {
  NSWindow *window = coreWindow.window;
  if (!window || objc_getAssociatedObject(window, kActingKey)) return;
  __weak NSWindow *weakWindow = window;
  __weak ArdiaCoreWindow *weakCore = coreWindow;
  void (^set)(BOOL) = ^(BOOL on) {
    if (NSWindow *w = weakWindow) objc_setAssociatedObject(w, kActedFullScreenKey, on ? @YES : nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    ArdiaCoreWindow *c = weakCore;
    if ([c respondsToSelector:@selector(setActedFullScreen:)]) c.actedFullScreen = on;
  };
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  const BOOL trace = getenv("ARDIA_TRACE_VISIBILITY") != nullptr;
  if (trace) NSLog(@"[ardiacore-vis] window %ld acted %@", (long)window.windowNumber, enter ? @"willEnterFullScreen" : @"willExitFullScreen");
  [center postNotificationName:enter ? NSWindowWillEnterFullScreenNotification : NSWindowWillExitFullScreenNotification object:window];
  if (enter) set(YES);
  if (enter) {
    objc_setAssociatedObject(window, kActedRestoreFrameKey, [NSValue valueWithRect:window.frame], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (NSScreen *screen = window.screen ?: NSScreen.mainScreen) [window setFrame:screen.frame display:YES];
  } else if (NSValue *restore = objc_getAssociatedObject(window, kActedRestoreFrameKey)) {
    objc_setAssociatedObject(window, kActedRestoreFrameKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [window setFrame:restore.rectValue display:YES];
  }
  objc_setAssociatedObject(window, kActingKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  const NSTimeInterval gap = gActedOcclusionGap;
  if (!isnan(gap)) {
    NSObject *turn = [NSObject new];
    objc_setAssociatedObject(window, kActedOcclusionTurnKey, turn, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    ActOcclusion(window, @NO);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(MAX(0, seconds + gap) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      NSWindow *w = weakWindow;
      if (w && objc_getAssociatedObject(w, kActedOcclusionTurnKey) == turn) ActOcclusion(w, @YES);
    });
  }
  void (^finish)(void) = ^{
    NSWindow *w = weakWindow;
    if (!w) return;
    objc_setAssociatedObject(w, kActingKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (!enter) set(NO);
    if (trace) NSLog(@"[ardiacore-vis] window %ld acted %@", (long)w.windowNumber, enter ? @"didEnterFullScreen" : @"didExitFullScreen");
    [center postNotificationName:enter ? NSWindowDidEnterFullScreenNotification : NSWindowDidExitFullScreenNotification object:w];
  };
  if (seconds > 0) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), finish);
  else finish();
}

NSTimeInterval gActedTransition = NSProcessInfo.processInfo.environment[@"ARDIA_FAKE_FULLSCREEN_MS"].doubleValue / 1000;

void ToggleWindowFullScreen(ArdiaCoreWindow *coreWindow) {
  NSWindow *window = coreWindow.window;
  if (!ardiacore_host::Background()) return [window toggleFullScreen:nil];
  const BOOL enter = !IsWindowFullScreen(window);
  ardiacore_host::LogActivation(enter ? @"toggleFullScreen: (page full screen; acted out)" : @"toggleFullScreen: (page left full screen; acted out)");
  ActWindowFullScreen(coreWindow, enter, gActedTransition);
}

}

NSNotificationName const ArdiaCoreWindowSeenDidChange = @"ArdiaCoreWindowSeenDidChange";

static const NSTimeInterval kPageDrawWait = 0.4;

@interface ACPageDrawWait : NSObject
@end

@implementation ACPageDrawWait {
  __weak ArdiaCoreTab *_tab;
  NSInteger (^_test)(BOOL fullScreen, BOOL fills);
  void (^_done)(void);
}

+ (void)tab:(ArdiaCoreTab *)tab draws:(NSInteger (^)(BOOL fullScreen, BOOL fills))test then:(void (^)(void))done {
  NSView *page = tab.view;
  if (!page.window || page.isHiddenOrHasHiddenAncestor || ![tab respondsToSelector:@selector(evaluate:completion:)]) return done();
  ACPageDrawWait *wait = [ACPageDrawWait new];
  wait->_tab = tab;
  wait->_test = test;
  wait->_done = done;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPageDrawWait * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (wait->_done && getenv("ARDIA_TRACE_VISIBILITY")) NSLog(@"[ardiacore-vis] full screen: the page didn't draw in time");
    [wait finish];
  });
  [wait ask];
}

- (void)finish {
  void (^done)(void) = _done;
  _done = nil;
  if (done) done();
}

- (void)ask {
  ArdiaCoreTab *tab = _tab;
  NSView *page = tab.view;
  if (!_done) return;
  if (!page.window) return [self finish];
  const NSSize asked = [page convertRect:page.bounds toView:nil].size;
  __weak ACPageDrawWait *weakSelf = self;
  [tab evaluate:@"requestAnimationFrame(() => requestAnimationFrame(() => post('result', JSON.stringify("
                @"[innerWidth * devicePixelRatio, innerHeight * devicePixelRatio, !!document.fullscreenElement]))))"
     completion:^(NSString *json) {
       [weakSelf answered:json asked:asked];
     }];
}

- (void)answered:(NSString *)json asked:(NSSize)asked {
  if (!_done) return;
  NSView *page = _tab.view;
  NSWindow *window = page.window;
  if (!window || !json) return [self finish];
  NSArray *drawn = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![drawn isKindOfClass:NSArray.class] || drawn.count != 3 || ![drawn[0] isKindOfClass:NSNumber.class] ||
      ![drawn[1] isKindOfClass:NSNumber.class] || ![drawn[2] isKindOfClass:NSNumber.class])
    return [self finish];
  const NSSize now = [page convertRect:page.bounds toView:nil].size, pixels = [page convertSizeToBacking:page.bounds.size];
  const NSSize content = window.contentView.bounds.size;
  const BOOL fills = fabs(now.width - content.width) < 1 && fabs(now.height - content.height) < 1;
  const BOOL sized = NSEqualSizes(asked, now) && fabs([drawn[0] doubleValue] - pixels.width) <= 2 &&
                     fabs([drawn[1] doubleValue] - pixels.height) <= 2;
  const NSInteger drew = sized ? _test([drawn[2] boolValue], fills) : 0;
  if (getenv("ARDIA_TRACE_VISIBILITY"))
    NSLog(@"[ardiacore-vis] full screen: page drew %@, its view %@ (fills=%d) -> %ld", json, NSStringFromSize(pixels), fills, (long)drew);
  if (drew) return [self finish];
  [self ask];
}

@end

static const NSTimeInterval kPageCoverPicture = 0.25;
static const NSTimeInterval kPageCoverLimit = 4;
static BOOL gPageCoverOff = NO;

@interface ACPageCover : NSView
@property(readonly, weak) ArdiaCoreTab *tab;
@end

@implementation ACPageCover {
  CGImageRef _picture;
  NSSize _pictured;
}

+ (void)coverTabs:(NSArray<ArdiaCoreTab *> *)tabs then:(void (^)(NSArray<ACPageCover *> *covers))then {
  NSMutableArray<ACPageCover *> *covers = [NSMutableArray array];
  __block NSUInteger waiting = tabs.count + 1;
  void (^one)(ACPageCover *) = ^(ACPageCover *cover) {
    if (cover) [covers addObject:cover];
    if (--waiting == 0) then(covers);
  };
  for (ArdiaCoreTab *tab in tabs) [self coverTab:tab then:one];
  one(nil);
}

+ (void)coverTab:(ArdiaCoreTab *)tab then:(void (^)(ACPageCover *cover))then {
  NSView *page = tab.view;
  if (gPageCoverOff || !page.window || page.isHiddenOrHasHiddenAncestor ||
      ![tab respondsToSelector:@selector(copyPicture:completion:)])
    return then(nil);
  __weak ArdiaCoreTab *weakTab = tab;
  __weak NSWindow *weakWindow = page.window;
  __weak NSView *weakHost = page.superview;
  const NSSize pictured = page.bounds.size;
  [tab copyPicture:kPageCoverPicture
        completion:^(CGImageRef picture) {
          ArdiaCoreTab *t = weakTab;
          NSView *now = t.view;
          if (!picture || !now.window || now.window != weakWindow || now.superview != weakHost) return then(nil);
          ACPageCover *cover = [[ACPageCover alloc] initWithFrame:now.bounds picture:picture];
          cover->_tab = t;
          cover->_pictured = pictured;
          [now addSubview:cover];
          [cover displayIfNeeded];
          cover.layer.contents = (__bridge id)cover->_picture;
          then(cover);
        }];
}

- (instancetype)initWithFrame:(NSRect)frame picture:(CGImageRef)picture {
  if ((self = [super initWithFrame:frame])) {
    _picture = CGImageRetain(picture);
    self.wantsLayer = YES;
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    __weak ACPageCover *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPageCoverLimit * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [weakSelf uncover:NO];
    });
  }
  return self;
}

- (void)dealloc {
  CGImageRelease(_picture);
}

- (BOOL)wantsUpdateLayer {
  return YES;
}

- (void)updateLayer {
  self.layer.contents = (__bridge id)_picture;
  self.layer.contentsGravity = kCAGravityResize;
}

- (NSView *)hitTest:(NSPoint)point {
  return nil;
}

- (BOOL)isAccessibilityElement {
  return NO;
}

- (void)repicture {
  ArdiaCoreTab *tab = _tab;
  NSView *page = tab.view;
  if (!self.superview || !page) return;
  __weak ACPageCover *weakSelf = self;
  const NSSize before = _pictured;
  [ACPageDrawWait tab:tab
                draws:^NSInteger(BOOL, BOOL) { return NSEqualSizes(page.bounds.size, before) ? 0 : 1; }
                 then:^{
                   ACPageCover *me = weakSelf;
                   ArdiaCoreTab *t = me.tab;
                   const NSSize now = t.view.bounds.size;
                   if (!me.superview || !t || NSEqualSizes(now, before)) return;
                   [t copyPicture:kPageCoverPicture
                       completion:^(CGImageRef picture) {
                         ACPageCover *again = weakSelf;
                         if (!picture || !again.superview) return;
                         CGImageRelease(again->_picture);
                         again->_picture = CGImageRetain(picture);
                         again->_pictured = now;
                         again.layer.contents = (__bridge id)again->_picture;
                       }];
                 }];
}

- (void)uncover:(BOOL)fade {
  if (!self.superview) return;
  if (!fade) return [self removeFromSuperview];
  [NSAnimationContext
      runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = 0.1;
        self.animator.alphaValue = 0;
      }
      completionHandler:^{
        [self removeFromSuperview];
      }];
}

@end

@interface ACWindowFullScreen : NSObject
- (ArdiaCoreTab *)probedTab;
- (BOOL)covered;
- (NSInteger)covers;
- (BOOL)transitioning;
- (BOOL)pageFullScreen;
@end

namespace {

const void *kFullScreenLightsKey = &kFullScreenLightsKey;
const void *kFullScreenLightsWatchKey = &kFullScreenLightsWatchKey;

}

@interface ACFullScreenLights : NSView
@end

@implementation ACFullScreenLights {
  BOOL _hovered;
}

+ (instancetype)lightsForWindow:(NSWindow *)window {
  NSButton *standardClose = [window standardWindowButton:NSWindowCloseButton];
  if (!standardClose) return nil;
  ACFullScreenLights *lights = [[ACFullScreenLights alloc] initWithFrame:NSZeroRect];
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

namespace {

void PlaceFullScreenLights(NSWindow *window) {
  ACFullScreenLights *lights = window ? objc_getAssociatedObject(window, kFullScreenLightsKey) : nil;
  NSView *frameView = window.contentView.superview;
  NSView *close = lights.subviews.firstObject;
  if (!lights || !frameView || !close) return;
  ACWindowFullScreen *state = objc_getAssociatedObject(window, kWindowFullScreenKey);
  lights.hidden = state.pageFullScreen;
  const NSSize size = close.frame.size;
  const NSPoint center = LightsCenter(objc_getAssociatedObject(window, kLightsCenterKey), size);
  const CGFloat top = center.y - size.height / 2;
  [lights setFrameOrigin:NSMakePoint(center.x - size.width / 2,
                                     frameView.isFlipped ? top : NSHeight(frameView.bounds) - top - NSHeight(lights.frame))];
}

void ShowFullScreenLights(NSWindow *window, BOOL show) {
  ACFullScreenLights *lights = objc_getAssociatedObject(window, kFullScreenLightsKey);
  if (!show) {
    [lights removeFromSuperview];
    objc_setAssociatedObject(window, kFullScreenLightsKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    return;
  }
  NSView *frameView = window.contentView.superview;
  if (lights || !frameView || !(lights = [ACFullScreenLights lightsForWindow:window])) return;
  objc_setAssociatedObject(window, kFullScreenLightsKey, lights, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [frameView addSubview:lights positioned:NSWindowAbove relativeTo:nil];
  PlaceFullScreenLights(window);
}

void HideStandardLights(NSWindow *window, BOOL hide) {
  for (NSButton *button in TrafficLightButtons(window)) button.hidden = hide;
}

}

@interface ACFullScreenLightsWatch : NSObject
@end

@implementation ACFullScreenLightsWatch {
  __weak NSWindow *_window;
}

+ (void)watchWindow:(NSWindow *)window {
  if (!window || objc_getAssociatedObject(window, kFullScreenLightsWatchKey)) return;
  ACFullScreenLightsWatch *watch = [[ACFullScreenLightsWatch alloc] init];
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
}

- (void)didExit {
  NSWindow *window = _window;
  if (!window) return;
  HideStandardLights(window, NO);
  ShowFullScreenLights(window, NO);
}

@end

namespace {

void WatchFullScreenLights(NSWindow *window) {
  [ACFullScreenLightsWatch watchWindow:window];
}

}

@implementation ACWindowFullScreen {
  __weak ArdiaCoreWindow *_coreWindow;
  __weak ArdiaCoreTab *_tab;
  BOOL _entered;
  NSInteger _asked;
  BOOL _transitioning;
  BOOL _ours;
  BOOL _settling;
  BOOL _seen;
  BOOL _closed;
  NSArray *_observers;
  __weak ArdiaCoreTab *_leftTab;
  NSInteger _waitingFor;
  NSUInteger _wait;
  BOOL _askedWait;
  BOOL _drew;
  NSInteger _telling;
  NSArray<ACPageCover *> *_covers;
  __weak ArdiaCoreTab *_lastTab;
  NSUInteger _coverTurn;
  BOOL _picturing;
}

+ (instancetype)ofWindow:(ArdiaCoreWindow *)coreWindow create:(BOOL)create {
  NSWindow *window = coreWindow.window;
  if (!window) return nil;
  ACWindowFullScreen *state = objc_getAssociatedObject(window, kWindowFullScreenKey);
  if (state || !create) return state;
  state = [[ACWindowFullScreen alloc] initWithCoreWindow:coreWindow];
  objc_setAssociatedObject(window, kWindowFullScreenKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  return state;
}

- (instancetype)initWithCoreWindow:(ArdiaCoreWindow *)coreWindow {
  if ((self = [super init])) {
    _coreWindow = coreWindow;
    _seen = YES;
    __weak ACWindowFullScreen *weakSelf = self;
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    NSMutableArray *observers = [NSMutableArray array];
    for (NSNotificationName name in @[
           NSWindowWillEnterFullScreenNotification, NSWindowWillExitFullScreenNotification, NSWindowDidEnterFullScreenNotification,
           NSWindowDidExitFullScreenNotification, NSWindowDidChangeOcclusionStateNotification, NSWindowWillCloseNotification
         ]) {
      [observers addObject:[center addObserverForName:name
                                               object:coreWindow.window
                                                queue:nil
                                           usingBlock:^(NSNotification *note) {
                                             [weakSelf windowDid:note.name];
                                           }]];
    }
    _observers = observers;
  }
  return self;
}

- (void)dealloc {
  for (id observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
}

- (BOOL)occlusionActed {
  return ardiacore_host::Background() && (!getenv("ARDIA_ALLOW_OCCLUSION") || objc_getAssociatedObject(_coreWindow.window, kActedOcclusionKey));
}

- (BOOL)windowVisible {
  NSWindow *window = _coreWindow.window;
  if (!window) return NO;
  if ([self occlusionActed] && !objc_getAssociatedObject(window, kActedOcclusionKey)) return YES;
  return (window.occlusionState & NSWindowOcclusionStateVisible) != 0;
}

- (void)windowDid:(NSNotificationName)name {
  if ([name isEqualToString:NSWindowWillCloseNotification]) {
    _closed = YES;
    for (ACPageCover *cover in _covers) [cover uncover:NO];
    _covers = nil;
    return;
  }
  const BOOL will = [name isEqualToString:NSWindowWillEnterFullScreenNotification] || [name isEqualToString:NSWindowWillExitFullScreenNotification];
  const BOOL did = [name isEqualToString:NSWindowDidEnterFullScreenNotification] || [name isEqualToString:NSWindowDidExitFullScreenNotification];
  const BOOL entering = [name isEqualToString:NSWindowWillEnterFullScreenNotification] || [name isEqualToString:NSWindowDidEnterFullScreenNotification];
  if (will) {
    _transitioning = _settling = YES;
    _ours = _asked == (entering ? 1 : -1);
    _asked = 0;
    for (ACPageCover *cover in _covers) [cover repicture];
  }
  if (did) _transitioning = NO;
  if (!_transitioning && [self windowVisible]) _settling = NO;
  [self updateSeen];
  if (!did) return;
  [self uncoverWhenDrawn];
  const BOOL ours = _ours;
  _ours = NO;
  __weak ACWindowFullScreen *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf settled:entering ours:ours]; });
}

- (void)updateSeen {
  if (![self occlusionActed] && [CFBridgingRelease(CGSessionCopyCurrentDictionary())[@"CGSSessionScreenIsLocked"] boolValue]) return;
  const BOOL seen = _settling || [self windowVisible] || IsWindowFullScreen(_coreWindow.window);
  if (getenv("ARDIA_TRACE_VISIBILITY"))
    NSLog(@"[ardiacore-vis] window %ld seen=%d (transitioning=%d settling=%d)", (long)_coreWindow.window.windowNumber, seen, _transitioning, _settling);
  if (seen == _seen) return;
  _seen = seen;
  if (NSWindow *window = _coreWindow.window) [NSNotificationCenter.defaultCenter postNotificationName:ArdiaCoreWindowSeenDidChange object:window];
}

- (BOOL)seen {
  return _seen;
}

- (void)settled:(BOOL)entered ours:(BOOL)ours {
  if (!entered && !ours) {
    _entered = NO;
    ArdiaCoreTab *tab = _tab;
    if (tab && [tab respondsToSelector:@selector(exitFullscreen)]) return [tab exitFullscreen];
  }
  [self sync];
}

static NSMapTable<ArdiaCoreTab *, NSNumber *> *FullScreenChanges() {
  static NSMapTable *changes = [NSMapTable weakToStrongObjectsMapTable];
  return changes;
}

- (void)tab:(ArdiaCoreTab *)tab fullScreen:(BOOL)fullScreen tell:(void (^)(void))tell {
  const NSUInteger change = [FullScreenChanges() objectForKey:tab].unsignedIntegerValue;
  _waitingFor = 0;
  _coverTurn++;
  _picturing = NO;
  if (fullScreen) {
    _tab = _lastTab = tab;
  } else if (_tab == tab || !_tab) {
    if (_tab) _leftTab = _tab;
    _tab = nil;
  }
  PlaceFullScreenLights(_coreWindow.window);
  _telling++;
  __weak ACWindowFullScreen *weakSelf = self;
  __weak ArdiaCoreTab *weakTab = tab;
  [ACPageDrawWait tab:tab
                draws:^NSInteger(BOOL drawnFullScreen, BOOL) {
                  if (fullScreen) return drawnFullScreen ? 1 : 0;
                  return drawnFullScreen ? -1 : 1;
                }
                 then:^{
                   ACWindowFullScreen *me = weakSelf;
                   if (me) me->_telling--;
                   ArdiaCoreTab *t = weakTab;
                   if (t && [FullScreenChanges() objectForKey:t].unsignedIntegerValue == change) tell();
                   [me sync];
                 }];
}

- (void)sync {
  ArdiaCoreWindow *coreWindow = _coreWindow;
  NSWindow *window = coreWindow.window;
  if (!window || _closed || _transitioning) return;
  const BOOL full = IsWindowFullScreen(window), page = _tab != nil;
  const NSInteger toggle = page && !full && !_entered ? 1 : !page && full && _entered ? -1 : 0;
  if (toggle != _waitingFor) {
    _waitingFor = toggle;
    _drew = _askedWait = NO;
    _wait++;
  }
  if (toggle == 1) {
    if (_telling > 0 || _picturing || ![self pageDrew:_tab entering:YES]) return;
    [self coverThenToggle:_tab entering:YES];
  } else if (toggle == -1) {
    if (_telling > 0 || _picturing || ![self pageDrew:_leftTab entering:NO]) return;
    [self coverThenToggle:_leftTab entering:NO];
  } else if (!page) {
    _entered = NO;
  }
}

- (NSArray<ArdiaCoreTab *> *)shownTabs:(ArdiaCoreTab *)tab entering:(BOOL)entering {
  ArdiaCoreWindow *coreWindow = _coreWindow;
  NSWindow *window = coreWindow.window;
  NSMutableArray<ArdiaCoreTab *> *tabs = [NSMutableArray array];
  if (tab) [tabs addObject:tab];
  if (entering || !coreWindow.activeProfile) return tabs;
  for (ArdiaCoreTab *other in [coreWindow tabsForProfile:coreWindow.activeProfile]) {
    NSView *page = other.view;
    ArdiaCoreWebView *view = [ArdiaCoreTabs viewForTab:other];
    if (other == tab || page.window != window || page.isHiddenOrHasHiddenAncestor || !view || view.alphaValue < 0.5) continue;
    [tabs addObject:other];
  }
  return tabs;
}

- (void)coverThenToggle:(ArdiaCoreTab *)tab entering:(BOOL)entering {
  _picturing = YES;
  const NSUInteger turn = ++_coverTurn;
  __weak ACWindowFullScreen *weakSelf = self;
  [ACPageCover coverTabs:[self shownTabs:tab entering:entering]
                    then:^(NSArray<ACPageCover *> *covers) {
                      ACWindowFullScreen *me = weakSelf;
                      if (!me || me->_coverTurn != turn) {
                        for (ACPageCover *cover in covers) [cover uncover:NO];
                        return;
                      }
                      me->_picturing = NO;
                      for (ACPageCover *cover in me->_covers) [cover uncover:NO];
                      me->_covers = covers;
                      [me toggle:entering];
                    }];
}

- (void)toggle:(BOOL)entering {
  ArdiaCoreWindow *coreWindow = _coreWindow;
  NSWindow *window = coreWindow.window;
  const BOOL wanted = window && !_closed && !_transitioning && IsWindowFullScreen(window) != entering &&
                      (entering ? _tab && !_entered : !_tab && _entered);
  if (!wanted) {
    for (ACPageCover *cover in _covers) [cover uncover:NO];
    _covers = nil;
    return [self sync];
  }
  _entered = entering;
  _asked = entering ? 1 : -1;
  if (!entering) _leftTab = nil;
  [CATransaction flush];
  ToggleWindowFullScreen(coreWindow);
  NSArray *covers = _covers;
  if (!covers.count) return;
  __weak ACWindowFullScreen *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ACWindowFullScreen *me = weakSelf;
    if (me && me->_covers == covers && !me->_transitioning) [me uncoverWhenDrawn];
  });
}

- (ArdiaCoreTab *)probedTab {
  return _tab ?: _leftTab ?: _lastTab;
}

- (NSInteger)covers {
  NSInteger covers = 0;
  NSMutableArray<NSView *> *views = [NSMutableArray arrayWithObject:_coreWindow.window.contentView ?: [NSView new]];
  while (views.count) {
    NSView *view = views.lastObject;
    [views removeLastObject];
    if ([view isKindOfClass:ACPageCover.class]) covers++;
    [views addObjectsFromArray:view.subviews];
  }
  return covers;
}

- (BOOL)covered {
  return self.covers > 0;
}

- (BOOL)transitioning {
  return _transitioning;
}

- (BOOL)pageFullScreen {
  return _tab != nil;
}

- (void)uncoverWhenDrawn {
  NSArray<ACPageCover *> *covers = _covers;
  _covers = nil;
  for (ACPageCover *cover in covers) {
    ArdiaCoreTab *tab = cover.tab;
    if (!tab) {
      [cover uncover:NO];
      continue;
    }
    [ACPageDrawWait tab:tab
                  draws:^NSInteger(BOOL, BOOL) { return 1; }
                   then:^{
                     dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.034 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                       [cover uncover:YES];
                     });
                   }];
  }
}

- (BOOL)pageDrew:(ArdiaCoreTab *)tab entering:(BOOL)entering {
  if (_drew) {
    _drew = _askedWait = NO;
    _waitingFor = 0;
    _wait++;
    return YES;
  }
  if (_askedWait) return NO;
  _askedWait = YES;
  const NSUInteger wait = _wait;
  __weak ACWindowFullScreen *weakSelf = self;
  __block BOOL now = YES;
  [ACPageDrawWait tab:tab
                draws:^NSInteger(BOOL fullScreen, BOOL fills) { return fullScreen == entering && fills == entering; }
                 then:^{
                   ACWindowFullScreen *me = weakSelf;
                   if (!me || me->_wait != wait) return;
                   me->_drew = YES;
                   if (!now) [me sync];
                 }];
  now = NO;
  if (!_drew) return NO;
  _drew = _askedWait = NO;
  _waitingFor = 0;
  _wait++;
  return YES;
}

- (NSDictionary *)state {
  NSWindow *window = _coreWindow.window;
  ArdiaCoreTab *tab = _tab;
  return @{
    @"page" : tab ? @(ardiacore_host::BrowserId(tab)) : NSNull.null,
    @"entered" : @(_entered),
    @"asked" : @(_asked),
    @"waitingForPage" : @(_waitingFor),
    @"telling" : @(_telling),
    @"picturing" : @(_picturing),
    @"covered" : @([self covered]),
    @"transitioning" : @(_transitioning),
    @"ours" : @(_ours),
    @"settling" : @(_settling),
    @"seen" : @(_seen),
    @"fullScreen" : @(IsWindowFullScreen(window)),
  };
}

@end

namespace {

void AnnounceStrayTab(ArdiaCoreTab *tab, int tries) {
  if (tab.closed) return;
  NSString *url = tab.url;
  if ((!url.length || [url isEqualToString:@"about:blank"]) && tries < 20) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ AnnounceStrayTab(tab, tries + 1); });
    return;
  }
  if (!ArdiaCoreServices.extensionsHandler) return;
  ArdiaCoreServices.extensionsHandler(@"tabs", @{
    @"action" : @"open", @"url" : url ?: @"", @"profile" : ardiacore_host::ProfileName(tab.profile), @"active" : @YES,
    @"window" : NSNull.null, @"extensionId" : @"", @"adoptId" : [ArdiaCoreTabs offerTab:tab prefix:@"tab"]
  });
}

void HandOffTab(ArdiaCoreTab *tab) {
  ArdiaCoreProfile *profile = tab.profile;
  if (!profile) return (void)dispatch_async(dispatch_get_main_queue(), ^{ [tab closeNow]; });
  ArdiaCoreWebView *view = [ArdiaCoreWindowController hostingViewForProfile:profile];
  if (view || !profile.offTheRecord) {
    if (view && ([view.profile isEqualToString:ardiacore_host::ProfileName(profile)] ||
                 ardiacore_host::IsOffTheRecordOf(profile, view.profile)))
      [view openedTab:tab adoptId:[ArdiaCoreTabs offerTab:tab prefix:@"tab"] disposition:@"foreground"];
    else
      AnnounceStrayTab(tab, 0);
    return;
  }
  if (!(view = [ArdiaCoreWindowController hostingViewForProfile:nil])) return;
  [view openedTab:tab adoptId:[ArdiaCoreTabs offerTab:tab prefix:@"tab"] disposition:@"incognito"];
}

}

@implementation ArdiaCoreWindowController {
  NSHashTable<ArdiaCoreTab *> *_closing;
  NSString *_chromeToken;
  BOOL _awaitingApp;
  BOOL _showInactive;
  BOOL _announced;
  __weak ArdiaCoreTab *_chromeActive;
}

+ (BOOL)userSees:(NSWindow *)window {
  ArdiaCoreWindowController *controller = [self forNSWindow:window];
  if (!controller || controller.stray || controller.standalone) return YES;
  return [[ACWindowFullScreen ofWindow:controller.coreWindow create:YES] seen];
}

+ (instancetype)strayWindowForProfile:(ArdiaCoreProfile *)profile {
  ArdiaCoreWindow *coreWindow = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)];
  if (!coreWindow.window) return nil;
  ArdiaCoreWindowController *controller = [[ArdiaCoreWindowController alloc] initWithCoreWindow:coreWindow];
  controller->_stray = YES;
  [Controllers() setObject:controller forKey:coreWindow.window];
  return controller;
}

NSMutableDictionary<NSString *, ArdiaCoreWindowController *> *ChromeMadeWindows() {
  static NSMutableDictionary *windows = [NSMutableDictionary dictionary];
  return windows;
}

+ (instancetype)chromeMadeWindowForProfile:(ArdiaCoreProfile *)profile {
  ArdiaCoreWindow *coreWindow = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1360, 860)];
  NSWindow *window = coreWindow.window;
  if (!window) return nil;
  ConfigureWindow(window);
  ArdiaCoreWindowController *controller = [[ArdiaCoreWindowController alloc] initWithCoreWindow:coreWindow];
  controller->_chromeToken = NSUUID.UUID.UUIDString;
  controller->_awaitingApp = YES;
  [Controllers() setObject:controller forKey:window];
  ChromeMadeWindows()[controller->_chromeToken] = controller;
  __weak ArdiaCoreWindowController *weakController = controller;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    [weakController stopAwaitingApp];
  });
  return controller;
}

+ (instancetype)claimChromeMadeWindow:(NSString *)token {
  ArdiaCoreWindowController *controller = token.length ? ChromeMadeWindows()[token] : nil;
  if (!controller) return nil;
  [ChromeMadeWindows() removeObjectForKey:token];
  if (!controller->_awaitingApp || !controller.coreWindow.window) return nil;
  controller->_awaitingApp = NO;
  return controller;
}

- (void)stopAwaitingApp {
  if (!_awaitingApp) return;
  _awaitingApp = NO;
  [ChromeMadeWindows() removeObjectForKey:_chromeToken];
  _stray = YES;
  NSArray<ArdiaCoreTab *> *tabs = @[];
  for (ArdiaCoreProfile *profile in ardiacore_host::LoadedProfiles())
    tabs = [tabs arrayByAddingObjectsFromArray:[_coreWindow tabsForProfile:profile]];
  if (!tabs.count) return [_coreWindow close];
  for (ArdiaCoreTab *tab in tabs)
    if (![ArdiaCoreTabs viewForTab:tab]) HandOffTab(tab);
}

- (void)announceChromeMadeTab:(ArdiaCoreTab *)tab tries:(int)tries {
  if (_stray || tab.closed || ![[_coreWindow tabsForProfile:tab.profile] containsObject:tab]) return;
  NSString *moving = [ArdiaCoreTabs viewForTab:tab].transferKey;
  NSString *url = tab.url;
  const BOOL blank = !moving.length && (!url.length || [url isEqualToString:@"about:blank"]);
  if ((blank && tries < 20) || (!ArdiaCoreServices.extensionsHandler && tries < 400)) {
    __weak ArdiaCoreWindowController *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [weakSelf announceChromeMadeTab:tab tries:tries + 1];
    });
    return;
  }
  if (!ArdiaCoreServices.extensionsHandler) return;
  NSMutableDictionary *request = [@{
    @"action" : @"open", @"url" : url ?: @"", @"profile" : ardiacore_host::ProfileName(tab.profile),
    @"active" : @(!_chromeActive || _chromeActive == tab), @"window" : NSNull.null, @"extensionId" : @"",
    @"chromeWindow" : _chromeToken, @"focused" : @(!_showInactive)
  } mutableCopy];
  if (moving.length) request[@"tabKey"] = moving;
  else if ([ArdiaCoreTabs viewForTab:tab]) return;
  else request[@"adoptId"] = [ArdiaCoreTabs offerTab:tab prefix:@"tab"];
  _announced = YES;
  ArdiaCoreServices.extensionsHandler(@"tabs", request);
}

- (void)window:(ArdiaCoreWindow *)window showRequestedActive:(BOOL)active {
  if (_awaitingApp) _showInactive = !active;
}

NSMapTable<ArdiaCoreProfile *, ArdiaCoreWindowController *> *StandaloneWindows() {
  static NSMapTable *windows = [NSMapTable weakToStrongObjectsMapTable];
  return windows;
}

+ (instancetype)standaloneWindowForProfile:(ArdiaCoreProfile *)profile {
  NSMapTable<ArdiaCoreProfile *, ArdiaCoreWindowController *> *windows = StandaloneWindows();
  ArdiaCoreWindowController *controller = [windows objectForKey:profile];
  if (controller && controller.coreWindow.window) return controller;
  ArdiaCoreWindow *coreWindow = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)];
  if (!coreWindow.window) return nil;
  if ([coreWindow respondsToSelector:@selector(setInternal:)]) coreWindow.internal = YES;
  controller = [[ArdiaCoreWindowController alloc] initWithCoreWindow:coreWindow];
  controller->_standalone = YES;
  [Controllers() setObject:controller forKey:coreWindow.window];
  [windows setObject:controller forKey:profile];
  return controller;
}

+ (ArdiaCoreWebView *)hostingViewForProfile:(ArdiaCoreProfile *)profile {
  ArdiaCoreWebView *any = nil;
  for (NSWindow *window in NSApp.orderedWindows) {
    ArdiaCoreWindowController *c = [Controllers() objectForKey:window];
    if (!c || c.stray || c.standalone) continue;
    if (ArdiaCoreWebView *view = profile ? [c anyShownViewForProfile:profile] : nil) return view;
    any = any ?: [c anyView];
  }
  return profile.offTheRecord ? nil : any;
}

+ (instancetype)holding:(ArdiaCoreTab *)tab {
  ArdiaCoreProfile *profile = tab.profile;
  if (!profile) return nil;
  for (ArdiaCoreWindowController *c in Controllers().objectEnumerator)
    if ([[c.coreWindow tabsForProfile:profile] containsObject:tab]) return c;
  return nil;
}

- (void)noteClosing:(ArdiaCoreTab *)tab {
  if (!_closing) _closing = [NSHashTable weakObjectsHashTable];
  [_closing addObject:tab];
  __weak ArdiaCoreWindowController *weakSelf = self;
  __weak ArdiaCoreTab *weakTab = tab;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    ArdiaCoreWindowController *c = weakSelf;
    ArdiaCoreTab *t = weakTab;
    if (c && t) [c->_closing removeObject:t];
  });
}

- (BOOL)appChanging {
  return _hostChanges > 0 || _closing.count > 0;
}

+ (instancetype)forNSWindow:(NSWindow *)window {
  return window ? [Controllers() objectForKey:window] : nil;
}

+ (NSArray<ArdiaCoreWindowController *> *)all {
  return Controllers().objectEnumerator.allObjects;
}

- (instancetype)initWithCoreWindow:(ArdiaCoreWindow *)coreWindow {
  if ((self = [super init])) {
    _coreWindow = coreWindow;
    coreWindow.delegate = self;
    __weak ArdiaCoreWindowController *weakSelf = self;
    [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                    object:coreWindow.window
                                                     queue:nil
                                                usingBlock:^(NSNotification *) {
                                                  if (ArdiaCoreWindowController *c = weakSelf) [ArdiaCoreTabStrip windowClosed:c];
                                                }];
  }
  return self;
}

- (ArdiaCoreWebView *)viewFor:(ArdiaCoreTab *)tab {
  return tab ? [ArdiaCoreTabs viewForTab:tab] : nil;
}

- (ArdiaCoreWebView *)anyShownViewForProfile:(ArdiaCoreProfile *)profile {
  for (ArdiaCoreTab *tab in [_coreWindow tabsForProfile:profile]) {
    ArdiaCoreWebView *view = [ArdiaCoreTabs viewForTab:tab];
    if (view.visible) return view;
  }
  return nil;
}

- (ArdiaCoreWebView *)anyView {
  for (ArdiaCoreProfile *profile in ardiacore_host::LoadedProfiles())
    for (ArdiaCoreTab *tab in [_coreWindow tabsForProfile:profile])
      if (ArdiaCoreWebView *view = [ArdiaCoreTabs viewForTab:tab]) return view;
  return nil;
}

- (void)window:(ArdiaCoreWindow *)window didInsertTab:(ArdiaCoreTab *)tab opener:(ArdiaCoreTab *)opener disposition:(NSString *)disposition {
  [ArdiaCoreTabStrip changedInWindow:self profile:tab.profile];
  if (_hostChanges > 0) return;
  if (_awaitingApp) {
    __weak ArdiaCoreWindowController *weakSelf = self;
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf announceChromeMadeTab:tab tries:0]; });
    return;
  }
  if ([ArdiaCoreTabs viewForTab:tab]) return;
  if (_stray) return HandOffTab(tab);
  ArdiaCoreWebView *openerView = [self viewFor:opener];
  if ([disposition isEqualToString:@"popup"] && [tab respondsToSelector:@selector(popupFeatures)]) {
    return ardiacore_host::OpenPopupWindow(tab, openerView);
  }
  if (openerView) {
    [openerView openedTab:tab adoptId:[ArdiaCoreTabs offerTab:tab] disposition:ardiacore_host::AppDisposition(disposition)];
  } else if (ArdiaCoreWebView *view = [self anyShownViewForProfile:tab.profile]) {
    [view openedTab:tab adoptId:[ArdiaCoreTabs offerTab:tab prefix:@"tab"] disposition:@"foreground"];
  } else {
    HandOffTab(tab);
  }
}

- (void)window:(ArdiaCoreWindow *)window didRemoveTab:(ArdiaCoreTab *)tab {
  [ArdiaCoreTabStrip removed:tab fromWindow:self];
  if (ArdiaCoreProfile *profile = tab.profile) [ArdiaCoreTabStrip changedInWindow:self profile:profile];
  [[self viewFor:tab] tabRemovedFromWindow:window];
  if (_stray || _standalone || _awaitingApp) {
    __weak ArdiaCoreWindowController *weakSelf = self;
    ArdiaCoreProfile *removedProfile = tab.profile;
    dispatch_async(dispatch_get_main_queue(), ^{
      ArdiaCoreWindowController *c = weakSelf;
      if (!c) return;
      NSMutableArray<ArdiaCoreProfile *> *profiles = [ardiacore_host::LoadedProfiles() mutableCopy];
      if (removedProfile) [profiles addObject:removedProfile];
      for (ArdiaCoreProfile *p in profiles)
        if ([c.coreWindow tabsForProfile:p].count) return;
      if (c->_awaitingApp) {
        c->_awaitingApp = NO;
        [ChromeMadeWindows() removeObjectForKey:c->_chromeToken];
        if (c->_announced && ArdiaCoreServices.extensionsHandler)
          ArdiaCoreServices.extensionsHandler(@"tabs", @{@"action" : @"closeWindow", @"chromeWindow" : c->_chromeToken});
      } else if (!c.stray && !c.standalone) {
        return;
      }
      if (c.standalone) {
        NSMapTable<ArdiaCoreProfile *, ArdiaCoreWindowController *> *windows = StandaloneWindows();
        for (ArdiaCoreProfile *p in windows.keyEnumerator.allObjects)
          if ([windows objectForKey:p] == c) [windows removeObjectForKey:p];
      }
      [c.coreWindow close];
    });
  }
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_closing removeObject:tab]; });
}

- (void)window:(ArdiaCoreWindow *)window didActivateTab:(ArdiaCoreTab *)tab {
  if (_awaitingApp) _chromeActive = tab;
  [ArdiaCoreTabStrip activated:tab inWindow:self];
  [ArdiaCoreTabStrip changedInWindow:self profile:tab.profile];
  [[self viewFor:tab] tabActivatedByChrome:!self.appChanging];
}

- (void)window:(ArdiaCoreWindow *)window devToolsDidChangeForTab:(ArdiaCoreTab *)tab view:(NSView *)devToolsView {
  [[self viewFor:tab] devToolsChanged:devToolsView];
}

- (void)window:(ArdiaCoreWindow *)window tab:(ArdiaCoreTab *)tab didChangeFullscreen:(BOOL)fullscreen {
  [FullScreenChanges() setObject:@([FullScreenChanges() objectForKey:tab].unsignedIntegerValue + 1) forKey:tab];
  __weak ArdiaCoreWindowController *weakSelf = self;
  __weak ArdiaCoreTab *weakTab = tab;
  void (^tell)(void) = ^{
    ArdiaCoreTab *t = weakTab;
    if (t) [[weakSelf viewFor:t] emit:@"fullscreen" payload:@{@"fullscreen" : @(fullscreen)}];
  };
  if (_stray || _standalone) return tell();
  [[ACWindowFullScreen ofWindow:window create:YES] tab:tab fullScreen:fullscreen tell:tell];
}

- (void)window:(ArdiaCoreWindow *)window passwordPrompt:(NSDictionary<NSString *, id> *)prompt forTab:(ArdiaCoreTab *)tab {
  [[self viewFor:tab] emit:@"passwordPrompt" payload:prompt];
}

- (void)window:(ArdiaCoreWindow *)window autofillPrompt:(NSDictionary<NSString *, id> *)prompt forTab:(ArdiaCoreTab *)tab {
  [[self viewFor:tab] emit:@"autofillPrompt" payload:prompt];
}

- (BOOL)windowShouldClose:(ArdiaCoreWindow *)window {
  return [ACChromeWindowHost windowShouldClose:window.window];
}

- (void)windowDidCancelClose:(ArdiaCoreWindow *)window {
  NSLog(@"[ardiacore] window close cancelled");
}

- (void)window:(ArdiaCoreWindow *)window confirmCloseWithDownloads:(int)count completion:(void (^)(BOOL))completion {
  completion(YES);
}

- (BOOL)window:(ArdiaCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  return IsReservedKey(event) && [NSApp.mainMenu performKeyEquivalent:event];
}

- (BOOL)window:(ArdiaCoreWindow *)window handleKeyEvent:(NSEvent *)event {
  const NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  if (event.type == NSEventTypeKeyDown && event.keyCode == 53 && !(mods & (NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagControl))) {
    NSResponder *focused = window.window.firstResponder;
    ArdiaCoreWebView *target = nil;
    for (ArdiaCoreProfile *profile in ardiacore_host::LoadedProfiles()) {
      for (ArdiaCoreTab *tab in [window tabsForProfile:profile]) {
        ArdiaCoreWebView *view = [ArdiaCoreTabs viewForTab:tab];
        if (view.visible && [focused isKindOfClass:NSView.class] && [(NSView *)focused isDescendantOf:tab.view]) target = view;
      }
      if (target) break;
    }
    [target emit:@"command" payload:@{@"command" : @"escape", @"text" : @""}];
  }
  return gRefusesUnhandledKey && gRefusesUnhandledKey(window.window, event);
}

@end

@interface ArdiaCorePopupWindow : NSObject <ArdiaCoreWindowDelegate, ArdiaCoreTabDelegate>
@end

namespace {

NSMutableSet<ArdiaCorePopupWindow *> *PopupWindows() {
  static NSMutableSet *windows = [NSMutableSet set];
  return windows;
}

NSString *HostOf(NSString *url) {
  return [NSURL URLWithString:url ?: @""].host ?: @"";
}

}

@implementation ArdiaCorePopupWindow {
  ArdiaCoreWindow *_coreWindow;
  ArdiaCoreTab *_tab;
  __weak ArdiaCoreWebView *_opener;
  id _closeObserver;
  BOOL _adopting;
}

- (instancetype)initWithTab:(ArdiaCoreTab *)tab opener:(ArdiaCoreWebView *)opener {
  if (!(self = [super init])) return nil;
  _tab = tab;
  _opener = opener;
  NSDictionary<NSString *, NSNumber *> *features = tab.popupFeatures ?: @{};
  const NSSize size = NSMakeSize(MAX(features[@"width"] ? features[@"width"].doubleValue : 500, 200),
                                 MAX(features[@"height"] ? features[@"height"].doubleValue : 600, 150));
  _coreWindow = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, size.width, size.height)];
  NSWindow *window = _coreWindow.window;
  if (!window) return nil;
  _coreWindow.delegate = self;
  window.styleMask |= NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
                      NSWindowStyleMaskResizable;
  window.releasedWhenClosed = NO;
  window.tabbingMode = NSWindowTabbingModeDisallowed;
  window.minSize = NSMakeSize(200, 150);
  [window setContentSize:size];
  [self placeWithFeatures:features];
  __weak ArdiaCorePopupWindow *weakSelf = self;
  _closeObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                                   object:window
                                                                    queue:nil
                                                               usingBlock:^(NSNotification *) { [weakSelf windowWillClose]; }];
  return self;
}

- (void)placeWithFeatures:(NSDictionary<NSString *, NSNumber *> *)features {
  NSWindow *window = _coreWindow.window;
  NSWindow *parent = _opener.window;
  NSScreen *screen = parent.screen ?: NSScreen.mainScreen;
  NSRect frame = window.frame;
  if (features[@"x"] || features[@"y"]) {
    const NSRect primary = NSScreen.screens.firstObject.frame;
    const NSRect content = [window contentRectForFrameRect:frame];
    const CGFloat left = features[@"x"] ? features[@"x"].doubleValue : NSMidX(parent.frame) - NSWidth(frame) / 2;
    const CGFloat top = features[@"y"] ? features[@"y"].doubleValue : NSMaxY(primary) - NSMaxY(parent.frame) + 60;
    frame.origin = NSMakePoint(left, NSMaxY(primary) - top - NSHeight(content));
  } else if (parent) {
    frame.origin = NSMakePoint(NSMidX(parent.frame) - NSWidth(frame) / 2, NSMaxY(parent.frame) - NSHeight(frame) - 60);
  } else {
    [window center];
    frame = window.frame;
  }
  const NSRect visible = screen.visibleFrame;
  frame.origin.x = MAX(NSMinX(visible), MIN(NSMinX(frame), NSMaxX(visible) - NSWidth(frame)));
  frame.origin.y = MAX(NSMinY(visible), MIN(NSMinY(frame), NSMaxY(visible) - NSHeight(frame)));
  [window setFrame:frame display:NO];
}

- (void)takeTab {
  if (_tab.closed) return [_coreWindow close];
  _adopting = YES;
  [_coreWindow adoptTab:_tab];
  _adopting = NO;
  if (ArdiaCoreProfile *profile = _tab.profile) _coreWindow.activeProfile = profile;
  _tab.delegate = self;
  NSView *page = _tab.view;
  [page removeFromSuperview];
  page.frame = _coreWindow.hostView.bounds;
  page.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [_coreWindow.hostView addSubview:page];
  [self updateTitle];
  if (ardiacore_host::Background()) [_coreWindow showInactive];
  else [_coreWindow.window makeKeyAndOrderFront:nil];
  [_tab focus];
}

- (void)updateTitle {
  NSString *url = _tab.url ?: @"", *host = HostOf(url), *title = _tab.title;
  NSWindow *window = _coreWindow.window;
  window.title = title.length && ![title isEqualToString:url] ? title : host;
  window.subtitle = [window.title isEqualToString:host] ? @"" : host;
}

- (void)windowWillClose {
  if (_closeObserver) [NSNotificationCenter.defaultCenter removeObserver:_closeObserver];
  _closeObserver = nil;
  if (_tab.delegate == self) _tab.delegate = nil;
  ArdiaCorePopupWindow *me = self;
  dispatch_async(dispatch_get_main_queue(), ^{ [PopupWindows() removeObject:me]; });
}

- (void)tabDidChangeTitle:(ArdiaCoreTab *)tab {
  [self updateTitle];
}

- (void)tabDidChangeURL:(ArdiaCoreTab *)tab {
  [self updateTitle];
}

- (void)tab:(ArdiaCoreTab *)tab requestsActivation:(NSString *)reason {
  if (!ardiacore_host::Background()) [_coreWindow.window makeKeyAndOrderFront:nil];
}

- (void)tab:(ArdiaCoreTab *)tab externalAppRequest:(NSDictionary<NSString *, id> *)request {
  id<ArdiaCoreTabDelegate> opener = (id<ArdiaCoreTabDelegate>)_opener;
  if ([opener respondsToSelector:@selector(tab:externalAppRequest:)]) [opener tab:tab externalAppRequest:request];
}

- (void)window:(ArdiaCoreWindow *)window didInsertTab:(ArdiaCoreTab *)tab opener:(ArdiaCoreTab *)opener disposition:(NSString *)disposition {
  if (_adopting || tab == _tab) return;
  if ([disposition isEqualToString:@"popup"]) return ardiacore_host::OpenPopupWindow(tab, _opener);
  ArdiaCoreWebView *view = _opener ?: [ArdiaCoreWindowController hostingViewForProfile:tab.profile];
  if (view) [view openedTab:tab adoptId:[ArdiaCoreTabs offerTab:tab] disposition:ardiacore_host::AppDisposition(disposition)];
  else [tab closeNow];
}

- (void)window:(ArdiaCoreWindow *)window didRemoveTab:(ArdiaCoreTab *)tab {
  if (tab != _tab) return;
  __weak ArdiaCoreWindow *coreWindow = _coreWindow;
  dispatch_async(dispatch_get_main_queue(), ^{ [coreWindow close]; });
}

- (BOOL)window:(ArdiaCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  NSMenuItem *reserved = ReservedMenuItemForEvent(event);
  if (!reserved) return NO;
  if ([reserved.identifier isEqualToString:@"ardia.command.closeTab"]) {
    [_coreWindow close];
    return YES;
  }
  return [NSApp.mainMenu performKeyEquivalent:event];
}

@end

namespace ardiacore_host {

bool IsReservedKeyEvent(NSEvent *event) {
  return IsReservedKey(event);
}

bool IsReservedBinding(NSString *key, NSString *unshiftedKey, NSEventModifierFlags modifiers) {
  if (key.length && ReservedMenuItem(NSApp.mainMenu, key.lowercaseString, modifiers)) return true;
  return unshiftedKey.length && ReservedMenuItem(NSApp.mainMenu, unshiftedKey.lowercaseString, modifiers);
}

void OpenPopupWindow(ArdiaCoreTab *tab, ArdiaCoreWebView *opener) {
  ArdiaCorePopupWindow *popup = [[ArdiaCorePopupWindow alloc] initWithTab:tab opener:opener];
  if (!popup) {
    if (opener) [opener openedTab:tab adoptId:[ArdiaCoreTabs offerTab:tab] disposition:@"foreground"];
    return;
  }
  [PopupWindows() addObject:popup];
  __weak ArdiaCorePopupWindow *weakPopup = popup;
  dispatch_async(dispatch_get_main_queue(), ^{ [weakPopup takeTab]; });
}

NSUInteger PopupWindowCount() {
  return PopupWindows().count;
}

void ActToggleFullScreen(NSWindow *window) {
  LogActivation(@"toggleFullScreen: (acted out)");
  if (ArdiaCoreWindow *coreWindow = [ArdiaCoreWindowController forNSWindow:window].coreWindow)
    ActWindowFullScreen(coreWindow, !IsWindowFullScreen(window), gActedTransition);
}

}

NSValue *ACTrafficLightsCenter(NSWindow *window) {
  return window ? objc_getAssociatedObject(window, kLightsCenterKey) : nil;
}

NSView *ACWindowRootView(NSWindow *window) {
  return [ACChromeWindowHost rootViewOfWindow:window] ?: window.contentView;
}

@implementation ACChromeWindowHost

+ (NSWindow *)makeWindowForProfile:(NSString *)profile {
  if (!ArdiaCoreHost.isStarted) return nil;
  ArdiaCoreWindow *coreWindow = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1360, 860)];
  NSWindow *window = coreWindow.window;
  if (!window) return nil;
  ConfigureWindow(window);
  ArdiaCoreWindowController *controller = [[ArdiaCoreWindowController alloc] initWithCoreWindow:coreWindow];
  [Controllers() setObject:controller forKey:window];
  [self showProfile:profile ?: @"" inWindow:window];
  return window;
}

+ (NSWindow *)makeWindowForProfile:(NSString *)profile chromeWindow:(NSString *)chromeWindow {
  ArdiaCoreWindowController *made = [ArdiaCoreWindowController claimChromeMadeWindow:chromeWindow];
  if (!made) return [self makeWindowForProfile:profile];
  NSWindow *window = made.coreWindow.window;
  [self showProfile:profile ?: @"" inWindow:window];
  return window;
}

+ (NSWindow *)makeWindowForProfile:(NSString *)profile chromeWindow:(NSString *)chromeWindow appWindow:(NSString *)appWindow {
  const BOOL link = [appWindow hasPrefix:@"link:"];
  NSWindow *window = chromeWindow.length ? nil
                     : link ? [ArdiaCoreEarlyWindow claimLittleWindowForLink:appWindow profile:profile]
                            : [ArdiaCoreEarlyWindow claimForAppWindow:appWindow profile:profile];
  if (window) [self showProfile:profile ?: @"" inWindow:window];
  else window = [self makeWindowForProfile:profile chromeWindow:chromeWindow];
  if (window && appWindow.length && !link) [ArdiaCoreWindowController forNSWindow:window].appWindowId = appWindow;
  return window;
}

+ (void)recordLaunchLayout {
  [ArdiaCoreEarlyWindow recordNow];
}

+ (void)forgetLaunchPictures {
  [ArdiaCoreEarlyWindow forgetPicturesNow];
}

+ (BOOL)takeDismissedAppWindow:(NSString *)appWindow {
  return [ArdiaCoreEarlyWindow takeDismissed:appWindow];
}

+ (void)showProfile:(NSString *)profile inWindow:(NSWindow *)window {
  ArdiaCoreWindowController *controller = [ArdiaCoreWindowController forNSWindow:window];
  if (!controller) return;
  __weak ArdiaCoreWindow *coreWindow = controller.coreWindow;
  __weak ArdiaCoreWindowController *weakController = controller;
  ardiacore_host::WithProfile(profile ?: @"", ^(ArdiaCoreProfile *p) {
    ArdiaCoreWindowController *shown = weakController;
    if (!p || !coreWindow || !shown) return;
    coreWindow.activeProfile = p;
    ArdiaCoreTab *tab = [ArdiaCoreTabStrip activeTabInWindow:shown profile:p];
    ArdiaCoreWebView *view = tab ? [ArdiaCoreTabs viewForTab:tab] : nil;
    NSWindow *shownWindow = coreWindow.window;
    if (view && shownWindow && view.window == shownWindow && [[coreWindow tabsForProfile:p] containsObject:tab])
      [view requestFocusRestoreIn:shownWindow];
  });
}

+ (void)prepareProfiles:(NSArray<NSString *> *)profiles forWindow:(NSWindow *)window {
  ArdiaCoreWindowController *controller = [ArdiaCoreWindowController forNSWindow:window];
  if (!controller || ![controller.coreWindow respondsToSelector:@selector(prepareProfile:)]) return;
  __weak ArdiaCoreWindow *coreWindow = controller.coreWindow;
  for (NSString *profile in profiles)
    ardiacore_host::WithProfile(profile, ^(ArdiaCoreProfile *p) {
      if (p && coreWindow) [coreWindow prepareProfile:p];
    });
}

+ (void)setTrafficLightsCenter:(NSValue *)center inWindow:(NSWindow *)window {
  if (objc_getAssociatedObject(window, kLightsShownKey)) {
    objc_setAssociatedObject(window, kLightsShownKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(window, kLightsMoveKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    TranslateTrafficLights(TrafficLightButtons(window), 0);
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
  ArdiaCoreWindowController *controller = [ArdiaCoreWindowController forNSWindow:window];
  [ArdiaCoreWebView keepTransfersOfWindow:window];
  if (controller) [controller.coreWindow close];
  else [window close];
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
  ArdiaCoreWindowController *controller = [ArdiaCoreWindowController forNSWindow:window];
  if (!controller) return;
  NSView *host = controller.coreWindow.hostView;
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  root.frame = host.bounds;
  NSView *cover = [ArdiaCoreEarlyWindow coverInWindow:window];
  if (cover.superview == host) [host addSubview:root positioned:NSWindowBelow relativeTo:cover];
  else [host addSubview:root];
  controller.root = root;
  [ArdiaCoreEarlyWindow rootEmbedded:root inWindow:window];
}

+ (NSView *)rootViewOfWindow:(NSWindow *)window {
  return [ArdiaCoreWindowController forNSWindow:window].root;
}

+ (void)removeRootViewOfWindow:(NSWindow *)window {
  ArdiaCoreWindowController *controller = [ArdiaCoreWindowController forNSWindow:window];
  [controller.root removeFromSuperview];
  controller.root = nil;
}

@end

namespace {

NSString *Describe(NSView *view) {
  if (view && ![view isKindOfClass:NSView.class]) return NSStringFromClass([(id)view class]);
  NSMutableArray *chain = [NSMutableArray array];
  for (NSView *v = view; v && chain.count < 6; v = v.superview) [chain addObject:NSStringFromClass(v.class)];
  return [chain componentsJoinedByString:@" < "];
}

NSPoint WindowPoint(NSWindow *window, NSString *spec) {
  NSArray<NSString *> *n = [spec componentsSeparatedByString:@","];
  if (n.count < 2) return NSMakePoint(-1, -1);
  CGFloat height = window.contentView.superview.bounds.size.height;
  return NSMakePoint(n[0].doubleValue, height - n[1].doubleValue);
}

NSEvent *Mouse(NSWindow *window, NSEventType type, NSPoint at) {
  return [NSEvent mouseEventWithType:type location:at modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                        windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
}

NSEvent *Key(NSWindow *window, NSEventType type, NSEventModifierFlags flags, NSString *chars, unsigned short code) {
  return [NSEvent keyEventWithType:type location:NSZeroPoint modifierFlags:flags timestamp:NSProcessInfo.processInfo.systemUptime
                      windowNumber:window.windowNumber context:nil characters:chars charactersIgnoringModifiers:chars
                         isARepeat:NO keyCode:code];
}

}

namespace {

NSDictionary *ProbeFrame(NSWindow *window, ACWindowFullScreen *state, CFTimeInterval start, NSSize before) {
  NSView *content = window.contentView;
  CALayer *layer = content.layer;
  if (!layer) return nil;
  const CGFloat scale = 0.125;
  const NSSize size = content.bounds.size;
  const size_t w = MAX(1, (size_t)ceil(size.width * scale)), h = MAX(1, (size_t)ceil(size.height * scale));
  NSMutableData *pixels = [NSMutableData dataWithLength:w * h * 4];
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels.mutableBytes, w, h, 8, w * 4, space,
                                               (CGBitmapInfo)kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!context) return nil;
  CGContextScaleCTM(context, scale, scale);
  if (content.isFlipped || layer.geometryFlipped) {
    CGContextTranslateCTM(context, 0, size.height);
    CGContextScaleCTM(context, 1, -1);
  }
  [layer renderInContext:context];
  CGContextRelease(context);
  NSMutableDictionary *frame = [@{
    @"t" : @(round((CACurrentMediaTime() - start) * 1000)),
    @"size" : @[ @(size.width), @(size.height) ],
    @"cover" : @(state.covered),
    @"covers" : @(state.covers),
    @"transitioning" : @(state.transitioning),
  } mutableCopy];
  if (!NSEqualSizes(before, NSZeroSize) && !NSEqualSizes(before, size)) {
    NSMutableArray<NSView *> *views = [NSMutableArray arrayWithArray:content.subviews];
    for (NSUInteger i = 0; i < views.count && i < 64; i++) {
      if (NSEqualSizes(views[i].frame.size, before)) {
        frame[@"relayout"] = @YES;
        break;
      }
      [views addObjectsFromArray:views[i].subviews];
    }
  }
  NSView *page = state.probedTab.view;
  if (!page.window || page.window != window) return frame;
  const NSRect r = [page convertRect:page.bounds toView:content];
  const CGFloat top = content.isFlipped ? NSMinY(r) : size.height - NSMaxY(r);
  frame[@"page"] = @[ @(NSMinX(r)), @(top), @(NSWidth(r)), @(NSHeight(r)) ];
  const long x0 = lround(NSMinX(r) * scale), y0 = lround(top * scale);
  const long x1 = MIN((long)w, lround(NSMaxX(r) * scale)), y1 = MIN((long)h, lround((top + NSHeight(r)) * scale));
  if (x1 - x0 < 8 || y1 - y0 < 6) return frame;
  const uint8_t *p = (const uint8_t *)pixels.bytes;
  NSMutableDictionary<NSNumber *, NSNumber *> *counts = [NSMutableDictionary dictionary];
  double sums[6][8][3] = {};
  long cells[6][8] = {}, n = 0, most = 0;
  for (long y = y0; y < y1; y++) {
    for (long x = x0; x < x1; x++) {
      const uint8_t *px = p + (y * w + x) * 4;
      NSNumber *key = @(((px[0] >> 3) << 10) | ((px[1] >> 3) << 5) | (px[2] >> 3));
      const long c = counts[key].longValue + 1;
      counts[key] = @(c);
      most = MAX(most, c);
      const long gy = (y - y0) * 6 / (y1 - y0), gx = (x - x0) * 8 / (x1 - x0);
      for (int k = 0; k < 3; k++) sums[gy][gx][k] += px[k];
      cells[gy][gx]++;
      n++;
    }
  }
  NSMutableArray *grid = [NSMutableArray array];
  for (int gy = 0; gy < 6; gy++)
    for (int gx = 0; gx < 8; gx++) {
      const long c = MAX(1, cells[gy][gx]);
      [grid addObject:[NSString stringWithFormat:@"%02x%02x%02x", (int)(sums[gy][gx][0] / c), (int)(sums[gy][gx][1] / c),
                                                 (int)(sums[gy][gx][2] / c)]];
    }
  frame[@"uniform"] = @(round((double)most / n * 1000) / 1000);
  frame[@"grid"] = grid;
  return frame;
}

}

@implementation ACChromeWindowHost (Dev)

+ (NSString *)devAction:(NSString *)action window:(NSWindow *)window {
  if (!window) return nil;
  if ([action hasPrefix:@"fakeFullScreenMs:"]) {
    if (!ardiacore_host::Background()) return @"test instances only";
    gActedTransition = MAX(0, [action substringFromIndex:17].doubleValue / 1000);
    return [NSString stringWithFormat:@"%.0f", gActedTransition * 1000];
  }
  if ([action hasPrefix:@"pageCover:"]) {
    if (!ardiacore_host::Background()) return @"test instances only";
    gPageCoverOff = ![[action substringFromIndex:10] isEqualToString:@"1"];
    return @(!gPageCoverOff).stringValue;
  }
  if ([action hasPrefix:@"fullScreenProbe"]) {
    static NSMutableArray *frames;
    static NSTimer *timer;
    if ([action isEqualToString:@"fullScreenProbe"]) {
      NSData *json = [NSJSONSerialization dataWithJSONObject:frames ?: @[] options:0 error:nil];
      return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]";
    }
    if (!ardiacore_host::Background()) return @"test instances only";
    ArdiaCoreWindow *coreWindow = [ArdiaCoreWindowController forNSWindow:window].coreWindow;
    ACWindowFullScreen *state = coreWindow ? [ACWindowFullScreen ofWindow:coreWindow create:YES] : nil;
    if (!state) return @"not an ArdiaCore window";
    [timer invalidate];
    frames = [NSMutableArray array];
    const CFTimeInterval start = CACurrentMediaTime(), until = start + MAX(0, [action substringFromIndex:16].doubleValue) / 1000;
    __weak NSWindow *weakWindow = window;
    timer = [NSTimer timerWithTimeInterval:1.0 / 60
                                   repeats:YES
                                     block:^(NSTimer *t) {
                                       NSWindow *w = weakWindow;
                                       if (!w || CACurrentMediaTime() > until) return [t invalidate];
                                       NSArray *last = [frames.lastObject objectForKey:@"size"];
                                       const NSSize before = last ? NSMakeSize([last[0] doubleValue], [last[1] doubleValue]) : NSZeroSize;
                                       if (NSDictionary *frame = ProbeFrame(w, state, start, before)) [frames addObject:frame];
                                     }];
    [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
    return @"started";
  }
  if ([action hasPrefix:@"fakeFullScreenOcclusionMs:"]) {
    if (!ardiacore_host::Background()) return @"test instances only";
    const double ms = [action substringFromIndex:26].doubleValue;
    gActedOcclusionGap = ms == -1 ? NAN : ms / 1000;
    return [NSString stringWithFormat:@"%.0f", ms];
  }
  if ([action hasPrefix:@"fakeAppActive:"]) {
    if (!ardiacore_host::Background()) return @"test instances only";
    ardiacore_host::SetAppActive([[action substringFromIndex:14] isEqualToString:@"1"]);
    return @(NSApp.isActive).stringValue;
  }
  if ([action hasPrefix:@"postNotification:"]) {
    if (!ardiacore_host::Background()) return @"test instances only";
    NSArray<NSString *> *parts = [[action substringFromIndex:17] componentsSeparatedByString:@":"];
    if (parts.count != 2) return @"postNotification:<workspace|app|window|windows>:<name>";
    NSString *center = parts[0], *name = parts[1];
    if ([center isEqualToString:@"workspace"]) [NSWorkspace.sharedWorkspace.notificationCenter postNotificationName:name object:NSWorkspace.sharedWorkspace];
    else if ([center isEqualToString:@"app"]) [NSNotificationCenter.defaultCenter postNotificationName:name object:NSApp];
    else if ([center isEqualToString:@"window"]) [NSNotificationCenter.defaultCenter postNotificationName:name object:window];
    else if ([center isEqualToString:@"windows"])
      for (NSWindow *each in NSApp.windows) [NSNotificationCenter.defaultCenter postNotificationName:name object:each];
    else return @"unknown center";
    return @"posted";
  }
  if ([action hasPrefix:@"fakeOcclusion:"]) {
    if (!ardiacore_host::Background()) return @"test instances only";
    NSString *to = [action substringFromIndex:14];
    ActOcclusion(window, [to isEqualToString:@"off"] ? nil : @([to isEqualToString:@"visible"]));
    return @((window.occlusionState & NSWindowOcclusionStateVisible) != 0).stringValue;
  }
  if ([action hasPrefix:@"fakeFullScreen:"] || [action isEqualToString:@"fullScreen"]) {
    ArdiaCoreWindow *coreWindow = [ArdiaCoreWindowController forNSWindow:window].coreWindow;
    if (!coreWindow) return @"not an ArdiaCore window";
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    if (parts.count > 1) {
      if (!ardiacore_host::Background()) return @"test instances only";
      const BOOL enter = [parts[1] isEqualToString:@"1"];
      if (enter != IsWindowFullScreen(window)) ActWindowFullScreen(coreWindow, enter, parts.count > 2 ? parts[2].doubleValue / 1000 : 0);
    }
    NSMutableDictionary *state = [@{
      @"fullScreen" : @(IsWindowFullScreen(window)),
      @"styleMask" : @((window.styleMask & NSWindowStyleMaskFullScreen) != 0),
      @"acted" : @(objc_getAssociatedObject(window, kActedFullScreenKey) != nil),
      @"chromeCounts" : @([coreWindow respondsToSelector:@selector(actedFullScreen)] && coreWindow.actedFullScreen),
    } mutableCopy];
    if (ACWindowFullScreen *page = [ACWindowFullScreen ofWindow:coreWindow create:NO]) state[@"pageFullScreen"] = [page state];
    NSData *json = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"{}";
  }
  NSView *frameView = window.contentView.superview;
  if ([action isEqualToString:@"children"]) {
    NSMutableArray *children = [NSMutableArray array];
    for (NSWindow *child in window.childWindows)
      [children addObject:@{@"class" : NSStringFromClass(child.class), @"frame" : NSStringFromRect(child.frame),
                            @"visible" : @(child.visible), @"title" : child.title ?: @""}];
    NSData *json = [NSJSONSerialization dataWithJSONObject:children options:0 error:nil];
    return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]";
  }
  if ([action hasPrefix:@"hit:"]) {
    NSPoint p = WindowPoint(window, [action substringFromIndex:4]);
    return Describe([frameView hitTest:p]);
  }
  if ([action isEqualToString:@"windowDrags"]) {
    static NSMutableArray<NSString *> *drags;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      drags = [NSMutableArray array];
      for (NSString *name in @[ @"performWindowDragWithEvent:", @"performWindowDragWithEvent:completionHandler:" ]) {
        Method m = class_getInstanceMethod(NSWindow.class, NSSelectorFromString(name));
        if (!m) continue;
        IMP original = method_getImplementation(m);
        bool handler = [name hasSuffix:@"Handler:"];
        method_setImplementation(m, handler ? imp_implementationWithBlock(^(NSWindow *w, NSEvent *e, id done) {
          [drags addObject:[[NSThread callStackSymbols] componentsJoinedByString:@"\n"]];
          ((void (*)(id, SEL, NSEvent *, id))original)(w, NSSelectorFromString(name), e, done);
        }) : imp_implementationWithBlock(^(NSWindow *w, NSEvent *e) {
          [drags addObject:[[NSThread callStackSymbols] componentsJoinedByString:@"\n"]];
          ((void (*)(id, SEL, NSEvent *))original)(w, NSSelectorFromString(name), e);
        }));
      }
    });
    NSString *out = [NSString stringWithFormat:@"%lu\n%@", (unsigned long)drags.count, [drags componentsJoinedByString:@"\n---\n"]];
    [drags removeAllObjects];
    return out;
  }
  if ([action isEqualToString:@"responderChanges"]) {
    if (!ardiacore_host::Background()) return @"test instances only";
    static NSMutableArray<NSString *> *changes;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      changes = [NSMutableArray array];
      SEL sel = @selector(makeFirstResponder:);
      Method m = class_getInstanceMethod(NSWindow.class, sel);
      IMP original = method_getImplementation(m);
      method_setImplementation(m, imp_implementationWithBlock(^BOOL(NSWindow *w, NSResponder *r) {
        [changes addObject:[NSString stringWithFormat:@"-> %@\n%@", Describe((NSView *)r),
                                                       [[NSThread callStackSymbols] componentsJoinedByString:@"\n"]]];
        return ((BOOL(*)(id, SEL, NSResponder *))original)(w, sel, r);
      }));
    });
    NSString *out = [NSString stringWithFormat:@"%lu\n%@", (unsigned long)changes.count, [changes componentsJoinedByString:@"\n---\n"]];
    [changes removeAllObjects];
    return out;
  }
  if ([action isEqualToString:@"fakeActiveClicks"]) {
    if (!ardiacore_host::Background()) return @"test instances only";
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      NSMutableSet<Class> *classes = [NSMutableSet setWithObject:NSTextView.class];
      if (Class page = NSClassFromString(@"RenderWidgetHostViewCocoa")) [classes addObject:page];
      for (Class cls in classes) {
        SEL sel = @selector(acceptsFirstMouse:);
        Method m = class_getInstanceMethod(cls, sel);
        IMP original = method_getImplementation(m);
        IMP takes = imp_implementationWithBlock(^BOOL(NSView *v, NSEvent *e) {
          return v.window.isKeyWindow || ((BOOL(*)(id, SEL, NSEvent *))original)(v, sel, e);
        });
        if (!class_addMethod(cls, sel, takes, method_getTypeEncoding(m))) method_setImplementation(m, takes);
      }
    });
    return @"1";
  }
  if ([action hasPrefix:@"click:"]) {
    NSString *spec = [action substringFromIndex:6];
    bool right = [spec hasSuffix:@",right"];
    NSPoint p = WindowPoint(window, spec);
    NSView *target = [frameView hitTest:p];
    NSString *hit = Describe(target);
    bool page = [target isKindOfClass:NSClassFromString(@"RenderWidgetHostViewCocoa")];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!page) {
        [window sendEvent:Mouse(window, right ? NSEventTypeRightMouseDown : NSEventTypeLeftMouseDown, p)];
        [window sendEvent:Mouse(window, right ? NSEventTypeRightMouseUp : NSEventTypeLeftMouseUp, p)];
      } else if (right) {
        [target rightMouseDown:Mouse(window, NSEventTypeRightMouseDown, p)];
        [target rightMouseUp:Mouse(window, NSEventTypeRightMouseUp, p)];
      } else {
        [target mouseDown:Mouse(window, NSEventTypeLeftMouseDown, p)];
        [target mouseUp:Mouse(window, NSEventTypeLeftMouseUp, p)];
      }
    });
    return hit;
  }
  if ([action hasPrefix:@"mouse:"]) {
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    if (parts.count < 3) return @"mouse:<down|up|dragged|moved|otherdown|otherup>:<x>,<y>[,<clickCount>[,<flags>]]";
    NSDictionary<NSString *, NSNumber *> *types = @{
      @"down" : @(NSEventTypeLeftMouseDown), @"up" : @(NSEventTypeLeftMouseUp),
      @"dragged" : @(NSEventTypeLeftMouseDragged), @"moved" : @(NSEventTypeMouseMoved),
      @"otherdown" : @(NSEventTypeOtherMouseDown), @"otherup" : @(NSEventTypeOtherMouseUp),
    };
    NSNumber *type = types[parts[1]];
    if (!type) return @"unknown mouse event";
    NSArray<NSString *> *n = [parts[2] componentsSeparatedByString:@","];
    NSPoint p = WindowPoint(window, parts[2]);
    const NSEventType t = (NSEventType)type.unsignedIntegerValue;
    NSEvent *event = [NSEvent mouseEventWithType:t location:p modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                                    windowNumber:window.windowNumber context:nil eventNumber:0
                                      clickCount:n.count > 2 ? n[2].integerValue : (t == NSEventTypeMouseMoved ? 0 : 1)
                                        pressure:t == NSEventTypeLeftMouseUp || t == NSEventTypeMouseMoved ? 0 : 1];
    const bool other = t == NSEventTypeOtherMouseDown || t == NSEventTypeOtherMouseUp;
    if (other || n.count > 3) {
      CGEventRef cg = event.CGEvent;
      if (n.count > 3) CGEventSetFlags(cg, (CGEventFlags)n[3].longLongValue);
      if (other) CGEventSetIntegerValueField(cg, kCGMouseEventButtonNumber, kCGMouseButtonCenter);
      event = [NSEvent eventWithCGEvent:cg];
    }
    [NSApp postEvent:event atStart:NO];
    return Describe([frameView hitTest:p]);
  }
  if ([action hasPrefix:@"drag:"]) {
    NSMutableArray<NSValue *> *points = [NSMutableArray array];
    for (NSString *spec in [[action substringFromIndex:5] componentsSeparatedByString:@";"])
      [points addObject:[NSValue valueWithPoint:WindowPoint(window, spec)]];
    if (points.count < 2) return @"drag needs two points";
    NSMutableArray<NSEvent *> *events = [NSMutableArray arrayWithObject:Mouse(window, NSEventTypeLeftMouseDown, points[0].pointValue)];
    for (NSUInteger i = 1; i < points.count; i++) {
      NSPoint a = points[i - 1].pointValue, b = points[i].pointValue;
      for (int k = 1; k <= 12; k++)
        [events addObject:Mouse(window, NSEventTypeLeftMouseDragged, NSMakePoint(a.x + (b.x - a.x) * k / 12, a.y + (b.y - a.y) * k / 12))];
    }
    [events addObject:Mouse(window, NSEventTypeLeftMouseUp, points.lastObject.pointValue)];
    NSString *hit = Describe([frameView hitTest:points[0].pointValue]);
    for (NSUInteger i = 0; i < events.count; i++)
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((i ? 150 + i * 16 : 0) * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
        [window sendEvent:events[i]];
      });
    return [NSString stringWithFormat:@"%@ (%lu events)", hit, (unsigned long)events.count];
  }
  if ([action hasPrefix:@"type:"]) {
    NSString *text = [action substringFromIndex:5];
    for (NSUInteger i = 0; i < text.length; i++) {
      NSString *c = [text substringWithRange:NSMakeRange(i, 1)];
      [window.firstResponder keyDown:Key(window, NSEventTypeKeyDown, 0, c, 0)];
      [window.firstResponder keyUp:Key(window, NSEventTypeKeyUp, 0, c, 0)];
    }
    return Describe((NSView *)window.firstResponder);
  }
  if ([action hasPrefix:@"keys:"]) {
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    if (parts.count < 3) return @"keys:<flags>:<characters>[:<keyCode>]";
    NSEventModifierFlags flags = (NSEventModifierFlags)parts[1].longLongValue;
    unsigned short code = parts.count > 3 ? (unsigned short)parts[3].intValue : 0;
    [NSApp postEvent:Key(window, NSEventTypeKeyDown, flags, parts[2], code) atStart:YES];
    NSEvent *down = [NSApp nextEventMatchingMask:NSEventMaskKeyDown untilDate:NSDate.distantPast inMode:NSDefaultRunLoopMode dequeue:YES];
    if (!down) return @"keys: the key event didn't come back";
    NSString *handler = @"none";
    if ([window performKeyEquivalent:down]) handler = @"window";
    else if ([NSApp.mainMenu performKeyEquivalent:down]) handler = @"mainMenu";
    else {
      [window.firstResponder keyDown:down];
      handler = @"keyDown";
    }
    return [NSString stringWithFormat:@"%@ (first responder %@)", handler, Describe((NSView *)window.firstResponder)];
  }
  if ([action isEqualToString:@"ax"]) {
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    __block void (^walk)(id, NSUInteger);
    __block __weak void (^weakWalk)(id, NSUInteger);
    weakWalk = walk = ^(id element, NSUInteger depth) {
      if (lines.count > 400 || depth > 40) return;
      NSString *role = [element respondsToSelector:@selector(accessibilityRole)] ? [element accessibilityRole] : @"?";
      NSMutableArray *text = [NSMutableArray array];
      for (NSString *key in @[ @"accessibilityTitle", @"accessibilityLabel", @"accessibilityValue" ]) {
        SEL sel = NSSelectorFromString(key);
        id value = [element respondsToSelector:sel] ? [element valueForKey:key] : nil;
        if ([value isKindOfClass:NSString.class] && [value length]) [text addObject:value];
      }
      [lines addObject:[NSString stringWithFormat:@"%@%@%@", [@"" stringByPaddingToLength:depth withString:@" " startingAtIndex:0],
                                                 role ?: @"", text.count ? [@": " stringByAppendingString:[text componentsJoinedByString:@" | "]] : @""]];
      NSArray *children = [element respondsToSelector:@selector(accessibilityChildren)] ? [element accessibilityChildren] : nil;
      for (id child in children) weakWalk(child, depth + 1);
    };
    walk(window, 0);
    return [lines componentsJoinedByString:@"\n"];
  }
  if ([action isEqualToString:@"winfo"]) {
    NSMutableDictionary *info = [NSMutableDictionary dictionary];
    info[@"frame"] = NSStringFromRect(window.frame);
    info[@"contentView"] = [NSString stringWithFormat:@"%@ %@", window.contentView.className, NSStringFromRect(window.contentView.frame)];
    info[@"frameView"] = [NSString stringWithFormat:@"%@ %@", window.contentView.superview.className, NSStringFromRect(window.contentView.superview.frame)];
    info[@"root"] = NSStringFromRect([ACChromeWindowHost rootViewOfWindow:window].frame);
    info[@"styleMask"] = @(window.styleMask);
    info[@"opaque"] = @(window.opaque);
    info[@"hasShadow"] = @(window.hasShadow);
    info[@"alpha"] = @(window.alphaValue);
    info[@"level"] = @(window.level);
    info[@"background"] = window.backgroundColor.description ?: @"";
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    info[@"closeButton"] = close ? NSStringFromRect([close convertRect:close.bounds toView:nil]) : @"";
    info[@"appearance"] = window.appearance.name ?: @"";
    NSWindow *sheet = window.attachedSheet;
    info[@"sheet"] = sheet ? [NSString stringWithFormat:@"%@ %@", sheet.className, NSStringFromRect(sheet.frame)] : @"";
    if ([sheet.windowController respondsToSelector:@selector(window)] || sheet) {
      NSMutableArray *texts = [NSMutableArray array];
      NSMutableArray *stack = [NSMutableArray arrayWithObject:sheet.contentView ?: [NSView new]];
      while (stack.count) {
        NSView *v = stack.lastObject;
        [stack removeLastObject];
        if ([v isKindOfClass:NSTextField.class] && [(NSTextField *)v stringValue].length) [texts addObject:[(NSTextField *)v stringValue]];
        if ([v isKindOfClass:NSButton.class] && [(NSButton *)v title].length) [texts addObject:[(NSButton *)v title]];
        [stack addObjectsFromArray:v.subviews];
      }
      info[@"sheetText"] = texts;
    }
    NSMutableArray *effects = [NSMutableArray array];
    NSMutableArray *walk = [NSMutableArray arrayWithObject:[ACChromeWindowHost rootViewOfWindow:window] ?: window.contentView];
    while (walk.count) {
      NSView *v = walk.lastObject;
      [walk removeLastObject];
      if ([v isKindOfClass:NSVisualEffectView.class]) {
        NSVisualEffectView *e = (NSVisualEffectView *)v;
        [effects addObject:[NSString stringWithFormat:@"material %ld blending %ld state %ld emphasized %d %@ hidden %d alpha %.2f",
                                                      (long)e.material, (long)e.blendingMode, (long)e.state, e.emphasized,
                                                      NSStringFromSize(e.frame.size), e.isHiddenOrHasHiddenAncestor, e.alphaValue]];
      }
      [walk addObjectsFromArray:v.subviews];
    }
    info[@"effects"] = effects;
    NSArray *list = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, (CGWindowID)window.windowNumber));
    info[@"cgBounds"] = [list.firstObject objectForKey:(id)kCGWindowBounds] ?: @{};
    NSData *json = [NSJSONSerialization dataWithJSONObject:info options:0 error:nil];
    return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  }
  if ([action hasPrefix:@"ns:"]) {
    if ([action hasSuffix:@"out"]) [window orderOut:nil];
    else [window orderFront:nil];
    return [NSString stringWithFormat:@"visible=%d", window.visible];
  }
  if ([action isEqualToString:@"performClose"]) {
    dispatch_async(dispatch_get_main_queue(), ^{ [window performClose:nil]; });
    return @"ok";
  }
  if ([action hasPrefix:@"style:"]) {
    window.styleMask = (NSWindowStyleMask)[action substringFromIndex:6].longLongValue;
    return @"ok";
  }
  if ([action hasPrefix:@"shadow:"]) {
    window.hasShadow = [action hasSuffix:@"1"];
    return @"ok";
  }
  if ([action hasPrefix:@"root:"]) {
    [ACChromeWindowHost rootViewOfWindow:window].hidden = [action hasSuffix:@"hide"];
    return @"ok";
  }
  if ([action hasPrefix:@"opaque:"]) {
    window.opaque = [action hasSuffix:@"1"];
    if (!window.opaque) window.backgroundColor = NSColor.clearColor;
    return [NSString stringWithFormat:@"opaque=%d", window.opaque];
  }
  if ([action hasPrefix:@"ime:"]) {
    NSArray<NSString *> *parts = [[action substringFromIndex:4] componentsSeparatedByString:@"|"];
    id<NSTextInputClient> client = (id<NSTextInputClient>)window.firstResponder;
    if (![(id)client conformsToProtocol:@protocol(NSTextInputClient)]) return @"first responder isn't a text input client";
    [client setMarkedText:parts[0] selectedRange:NSMakeRange(parts[0].length, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
    const BOOL marked = client.hasMarkedText;
    const NSRange range = client.markedRange;
    if (parts.count > 1) [client insertText:parts[1] replacementRange:NSMakeRange(NSNotFound, 0)];
    return [NSString stringWithFormat:@"%@ marked=%d range=%@ after commit marked=%d", Describe((NSView *)client), marked,
                                      NSStringFromRange(range), client.hasMarkedText];
  }
  if ([action isEqualToString:@"tabviews"]) {
    NSMutableArray *out = [NSMutableArray array];
    Class tabClass = ArdiaCoreWebView.class;
    NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:window.contentView];
    while (queue.count) {
      NSView *v = queue.lastObject;
      [queue removeLastObject];
      if ([v isKindOfClass:tabClass]) {
        if (v.hiddenOrHasHiddenAncestor) continue;
        NSMutableArray *subs = [NSMutableArray array];
        for (NSView *sub in v.subviews)
          [subs addObject:[NSString stringWithFormat:@"%@ %@%@", NSStringFromClass(sub.class), NSStringFromRect(sub.frame),
                                                     sub.hidden ? @" hidden" : @""]];
        [out addObject:@{@"frame" : NSStringFromRect(v.frame), @"subviews" : subs}];
        continue;
      }
      [queue addObjectsFromArray:v.subviews];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
    return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  }
  if ([action isEqualToString:@"responder"]) {
    id r = window.firstResponder;
    return [r isKindOfClass:NSView.class] ? Describe(r) : NSStringFromClass([r class]);
  }
  if ([action isEqualToString:@"lights"]) {
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    if (!close) return nil;
    NSRect r = [close convertRect:close.bounds toView:nil];
    return [NSString stringWithFormat:@"%.1f,%.1f,%.1f,%.1f", r.origin.x, r.origin.y, r.size.width, r.size.height];
  }
  if ([action isEqualToString:@"cover"] || [action isEqualToString:@"uncover"]) {
    static NSMapTable<NSWindow *, NSWindow *> *covers = [NSMapTable weakToStrongObjectsMapTable];
    NSWindow *cover = [covers objectForKey:window];
    if ([action isEqualToString:@"cover"]) {
      if (!cover) {
        cover = [[NSWindow alloc] initWithContentRect:NSInsetRect(window.frame, -4, -4)
                                            styleMask:NSWindowStyleMaskBorderless
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
        cover.releasedWhenClosed = NO;
        cover.opaque = YES;
        cover.backgroundColor = NSColor.windowBackgroundColor;
        cover.ignoresMouseEvents = YES;
        [covers setObject:cover forKey:window];
      }
      [cover orderWindow:NSWindowAbove relativeTo:window.windowNumber];
      return NSStringFromRect(cover.frame);
    }
    [cover orderOut:nil];
    [covers removeObjectForKey:window];
    return @"uncovered";
  }
  if ([action isEqualToString:@"close-button"]) {
    [[window standardWindowButton:NSWindowCloseButton] performClick:nil];
    return @"clicked";
  }
  return nil;
}

@end
