#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaChromeWindowHost.h"
#import "ArdiaPiPThrowMath.h"
#import "ArdiaRuntime.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

using namespace ardia_pip;

namespace {

NSString *const kKeepOnTopDefault = @"ACPictureInPictureKeepOnTop";

}

namespace ardia_pip {

NSString *const kZoomDefault = @"ACPictureInPictureZoom";

}

namespace {

NSString *const kThrowDefault = @"ACPictureInPictureThrow";

const void *const kControllerKey = &kControllerKey;

void LetMoveAcrossDisplays(NSWindow *window) {
  static NSMutableSet<Class> *patched = [NSMutableSet set];
  Class cls = window.class;
  if ([patched containsObject:cls]) return;
  [patched addObject:cls];
  ardia_runtime::ReplaceMethod(cls, @selector(constrainFrameRect:toScreen:), ^id(IMP original) {
    return ^NSRect(NSWindow *w, NSRect frame, NSScreen *screen) {
      if (objc_getAssociatedObject(w, kControllerKey)) return frame;
      return ((NSRect (*)(id, SEL, NSRect, NSScreen *))original)(w, @selector(constrainFrameRect:toScreen:), frame, screen);
    };
  });
}

}

namespace ardia_pip {

const void *const kZoomKey = &kZoomKey;

}

namespace {

BOOL KeepOnTop() {
  id value = [NSUserDefaults.standardUserDefaults objectForKey:kKeepOnTopDefault];
  return value ? [value boolValue] : YES;
}

BOOL ShowsPage(NSView *view) {
  static Class page = NSClassFromString(@"RenderWidgetHostViewCocoa");
  if (page && [view isKindOfClass:page]) return YES;
  for (NSView *child in view.subviews)
    if (ShowsPage(child)) return YES;
  return NO;
}

}

namespace ardia_pip {

BOOL IsChromeFloatingWindow(NSWindow *window) {
  return [ArdiaCoreWindow isChromeFramelessWindow:window] && window.visible && window.level >= NSFloatingWindowLevel &&
         (window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces);
}

BOOL IsChromeVideoPictureInPicture(NSWindow *window) {
  return IsChromeFloatingWindow(window) && !ShowsPage(window.contentView);
}

BOOL IsChromeDocumentPictureInPicture(NSWindow *window) {
  return [ArdiaCoreWindow isChromeFramelessWindow:window] && ShowsPage(window.contentView);
}

}

namespace {

NSScreen *OverlappingScreen(NSRect frame) {
  NSScreen *best = nil;
  CGFloat bestArea = 0;
  for (NSScreen *screen in NSScreen.screens) {
    NSRect overlap = NSIntersectionRect(frame, screen.frame);
    CGFloat area = overlap.size.width * overlap.size.height;
    if (area > bestArea) best = screen, bestArea = area;
  }
  return best;
}

}

namespace ardia_pip {

NSScreen *ScreenFor(NSRect frame) { return OverlappingScreen(frame) ?: NSScreen.mainScreen; }

}

namespace ardia_pip {

void PreventActivation(NSWindow *window) {
  if ([window respondsToSelector:@selector(_setPreventsActivation:)]) [window _setPreventsActivation:YES];
}

BOOL PreventsActivation(NSWindow *window) {
  return [window respondsToSelector:@selector(_preventsActivation)] && [window _preventsActivation];
}

NSInteger gActivations = 0;

void ActivateApp(NSString *why) {
  gActivations++;
  if (ardia_host::Background()) return ardia_host::LogActivation([@"activate (skipped in a test instance): " stringByAppendingString:why]);
  [NSApp activate];
}

BOOL ThrowEnabled() {
  id value = [NSUserDefaults.standardUserDefaults objectForKey:kThrowDefault];
  return value ? [value boolValue] : YES;
}

NSPoint PointerOf(NSEvent *event) {
  CGPoint point = CGEventGetLocation(event.CGEvent);
  return NSMakePoint(point.x, NSMaxY(NSScreen.screens.firstObject.frame) - point.y);
}

ardia_pip_throw::Rect ThrowRect(NSRect r) { return {NSMinX(r), NSMinY(r), NSWidth(r), NSHeight(r)}; }

int ScreenIndex(NSScreen *screen) {
  const NSUInteger index = screen ? [NSScreen.screens indexOfObjectIdenticalTo:screen] : NSNotFound;
  return index == NSNotFound ? -1 : (int)index;
}

std::vector<ardia_pip_throw::Screen> ThrowScreens() {
  std::vector<ardia_pip_throw::Screen> screens;
  for (NSScreen *screen in NSScreen.screens) screens.push_back({ThrowRect(screen.frame), ThrowRect(screen.visibleFrame)});
  return screens;
}

}

namespace {

NSString *CornerName(int corner) {
  switch (corner) {
    case ardia_pip_throw::kTopLeft: return @"topLeft";
    case ardia_pip_throw::kTopRight: return @"topRight";
    case ardia_pip_throw::kBottomLeft: return @"bottomLeft";
    case ardia_pip_throw::kBottomRight: return @"bottomRight";
    default: return @"none";
  }
}

}

@implementation ArdiaPiPController

+ (instancetype)forWindow:(NSWindow *)window {
  return objc_getAssociatedObject(window, kControllerKey);
}

- (instancetype)initWithWindow:(NSWindow *)window {
  if ((self = [super init])) {
    _window = window;
    NSView *root = ArdiaWindowRootView(window);
    _overlay = [[ArdiaPiPOverlay alloc] initWithFrame:root.bounds];
    __weak ArdiaPiPController *weakSelf = self;
    _overlay.handle.onClick = ^{ [weakSelf unstash]; };
    [root addSubview:_overlay];
    objc_setAssociatedObject(window, kControllerKey, self, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    LetMoveAcrossDisplays(window);

    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    _observers = [NSMutableArray array];
    for (NSNotificationName name in @[ NSWindowDidMoveNotification, NSWindowDidResizeNotification ]) {
      [_observers addObject:[center addObserverForName:name object:window queue:nil usingBlock:^(NSNotification *) {
                    [weakSelf windowMoved];
                  }]];
    }
    [_observers addObject:[center addObserverForName:NSWindowDidResizeNotification
                                              object:window
                                               queue:nil
                                          usingBlock:^(NSNotification *) { [weakSelf roundCorners]; }]];
    [_observers addObject:[center addObserverForName:NSWindowDidChangeScreenNotification
                                              object:window
                                               queue:nil
                                          usingBlock:^(NSNotification *) { [weakSelf screenChanged]; }]];
    [_observers addObject:[center addObserverForName:NSApplicationDidChangeScreenParametersNotification
                                              object:NSApp
                                               queue:nil
                                          usingBlock:^(NSNotification *) { [weakSelf screenChanged]; }]];
    [_observers addObject:[center addObserverForName:NSApplicationDidChangeScreenParametersNotification
                                              object:nil
                                               queue:nil
                                          usingBlock:^(NSNotification *) { [weakSelf screensChanged]; }]];
    [_observers addObject:[center addObserverForName:NSWindowWillStartLiveResizeNotification
                                              object:window
                                               queue:nil
                                          usingBlock:^(NSNotification *) { [weakSelf stopMotion]; }]];
    [_observers addObject:[center addObserverForName:NSWindowWillCloseNotification
                                              object:window
                                               queue:nil
                                          usingBlock:^(NSNotification *) { [weakSelf detach]; }]];
    self.keepOnTop = KeepOnTop();
  }
  return self;
}

- (void)detach {
  [ArdiaPiPController abandonSwipeOn:_window];
  for (id observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  [_observers removeAllObjects];
  [NSObject cancelPreviousPerformRequestsWithTarget:self];
  [_slide invalidate];
  [_overlay removeFromSuperview];
  objc_setAssociatedObject(_window, kControllerKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

- (void)roundCorners {
  NSView *content = _window.contentView;
  content.wantsLayer = YES;
  CALayer *layer = content.layer;
  if (layer.cornerCurve != kCACornerCurveCircular || !layer.masksToBounds) {
    layer.cornerCurve = kCACornerCurveCircular;
    layer.masksToBounds = YES;
  }
  CALayer *rim = _overlay.layer;
  rim.cornerCurve = kCACornerCurveCircular;
  rim.borderWidth = 1;
  rim.borderColor = [NSColor colorWithWhite:1 alpha:kRimAlpha].CGColor;
  [self fitCorners:NO];
  _window.opaque = NO;
  _window.backgroundColor = NSColor.clearColor;
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_window invalidateShadow]; });
}

- (CGFloat)cornerRadius {
  return ardia_pip_throw::CornerRadius(ThrowRect(_window.frame), ThrowRect([self homeScreen].visibleFrame));
}

- (void)fitCorners:(BOOL)animated {
  [self bendCornersTo:[self cornerRadius] animated:animated];
}

- (void)bendCornersTo:(CGFloat)radius animated:(BOOL)animated {
  CALayer *content = _window.contentView.layer, *rim = _overlay.layer;
  if (!content || !rim) return;
  if (animated && content.cornerRadius == radius && rim.cornerRadius == radius) return;
  __weak NSWindow *window = _window;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [CATransaction setCompletionBlock:^{ [window invalidateShadow]; }];
  for (CALayer *layer in @[ content, rim ]) {
    if (animated) {
      CABasicAnimation *bend = [CABasicAnimation animationWithKeyPath:@"cornerRadius"];
      bend.fromValue = @((layer.presentationLayer ?: layer).cornerRadius);
      bend.toValue = @(radius);
      bend.duration = kCornerBendDuration;
      bend.timingFunction = [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseInEaseOut];
      [layer addAnimation:bend forKey:@"cornerRadius"];
    } else {
      [layer removeAnimationForKey:@"cornerRadius"];
    }
    layer.cornerRadius = radius;
  }
  [CATransaction commit];
}

- (void)setKeepOnTop:(BOOL)keepOnTop {
  _keepOnTop = keepOnTop;
  _window.level = keepOnTop ? NSFloatingWindowLevel : NSNormalWindowLevel;
}

- (void)toggleKeepOnTop:(id)sender {
  self.keepOnTop = !_keepOnTop;
  [NSUserDefaults.standardUserDefaults setBool:_keepOnTop forKey:kKeepOnTopDefault];
}

- (NSMenu *)menu {
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@""];
  NSMenuItem *back = [menu addItemWithTitle:@"Back to Tab" action:@selector(backToTabFromMenu:) keyEquivalent:@""];
  back.target = self;
  back.enabled = self.view != nil;
  [menu addItem:NSMenuItem.separatorItem];
  NSMenuItem *top = [menu addItemWithTitle:@"Keep Window on Top" action:@selector(toggleKeepOnTop:) keyEquivalent:@""];
  top.target = self;
  top.state = _keepOnTop ? NSControlStateValueOn : NSControlStateValueOff;
  return menu;
}

- (void)backToTabFromMenu:(id)sender { [self backToTab]; }

- (void)backToTab {
  ArdiaWebView *view = self.view;
  if (!view) return;
  ActivateApp(@"Back to Tab (menu)");
  [view emit:@"activateRequest" payload:@{@"reason" : @"pictureInPicture"}];
  [view exitPictureInPicture];
}

- (void)screenChanged {
  NSScreen *screen = [self homeScreen];
  if (_animating) return;
  [self fitCorners:YES];
  _lastScreenFit = @{
    @"radius" : @([self cornerRadius]),
    @"frame" : NSStringFromRect(_window.frame),
    @"visibleFrame" : NSStringFromRect(screen.visibleFrame),
  };
}

- (void)windowMoved {
  [self homeScreen];
  if (!_animating) [self fitCorners:YES];
  if (_animating || (_swiping && NSProcessInfo.processInfo.systemUptime - _swipeLastAt < 1)) return;
  if (_swiping) [ArdiaPiPController abandonSwipeOn:_window];
  if (NSEvent.pressedMouseButtons & 1) _sawDrag = YES;
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  [self performSelector:@selector(settle) withObject:nil afterDelay:0.12];
}

- (NSScreen *)homeScreen {
  NSScreen *screen = OverlappingScreen(_window.frame);
  if (screen) _lastScreen = screen;
  return screen ?: _lastScreen ?: NSScreen.mainScreen;
}

- (BOOL)displayBeyond:(ArdiaPiPEdge)side {
  return [self displayBeyond:side of:[self homeScreen]];
}

- (BOOL)displayBeyond:(ArdiaPiPEdge)side of:(NSScreen *)screen {
  const auto screens = ThrowScreens();
  const int home = ScreenIndex(screen);
  if (home < 0 || home >= (int)screens.size()) return NO;
  return ardia_pip_throw::DisplayBeyond(ThrowRect(_window.frame), home, screens.data(), (int)screens.size(),
                                        side == ArdiaPiPEdgeRight ? ardia_pip_throw::kRight : ardia_pip_throw::kLeft);
}

- (ArdiaPiPEdge)edgeBeyond {
  NSRect frame = _window.frame;
  NSRect visible = [self homeScreen].visibleFrame;
  CGFloat half = NSWidth(frame) / 2;
  if (NSMaxX(frame) - NSMaxX(visible) > half && ![self displayBeyond:ArdiaPiPEdgeRight]) return ArdiaPiPEdgeRight;
  if (NSMinX(visible) - NSMinX(frame) > half && ![self displayBeyond:ArdiaPiPEdgeLeft]) return ArdiaPiPEdgeLeft;
  return ArdiaPiPEdgeNone;
}

- (void)settle {
  if (NSEvent.pressedMouseButtons & 1) {
    [self performSelector:@selector(settle) withObject:nil afterDelay:0.12];
    return;
  }
  BOOL dragged = _sawDrag;
  _sawDrag = NO;
  ArdiaPiPEdge edge = [self edgeBeyond];
  if (edge != ArdiaPiPEdgeNone) return [self stashAt:edge velocity:NSZeroPoint];
  if (_stashedEdge != ArdiaPiPEdgeNone && !dragged) return [self stashAt:_stashedEdge velocity:NSZeroPoint];
  if (_stashedEdge != ArdiaPiPEdgeNone) [self setStashedEdge:ArdiaPiPEdgeNone];
  [self rescueIfLost];
}

- (ArdiaPiPEdge)edgeFlungTowards:(NSPoint)velocity {
  const NSRect frame = _window.frame;
  const NSRect visible = [self homeScreen].visibleFrame;
  const auto side = ardia_pip_throw::FlungOffSide(ThrowRect(frame), {velocity.x, velocity.y}, ThrowRect(visible),
                                                   [self displayBeyond:ArdiaPiPEdgeLeft], [self displayBeyond:ArdiaPiPEdgeRight]);
  return side == ardia_pip_throw::kFlungRight ? ArdiaPiPEdgeRight : side == ardia_pip_throw::kFlungLeft ? ArdiaPiPEdgeLeft : ArdiaPiPEdgeNone;
}

- (ArdiaPiPEdge)landWithVelocity:(NSPoint)velocity flings:(BOOL)flings thrown:(BOOL *)thrown {
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  _sawDrag = NO;
  *thrown = NO;
  if (_stashedEdge != ArdiaPiPEdgeNone) {
    _stashScreen = [self homeScreen];
    const ArdiaPiPEdge side = _stashedEdge;
    const NSRect frame = _window.frame, visible = [self homeScreen].visibleFrame;
    const CGFloat shown = side == ArdiaPiPEdgeRight ? NSMaxX(visible) - NSMinX(frame) : NSMaxX(frame) - NSMinX(visible);
    if (shown < NSWidth(frame) - 0.5) {
      const CGFloat inward = side == ArdiaPiPEdgeRight ? -velocity.x : velocity.x;
      const BOOL sideways = flings && fabs(velocity.x) > fabs(velocity.y);
      const BOOL open = sideways ? inward > 0 : shown > NSWidth(frame) * kOpenShare;
      const NSPoint carried = flings ? velocity : NSZeroPoint;
      if (open) [self unstashWithVelocity:carried];
      else [self stashAt:side velocity:carried];
      return open ? ArdiaPiPEdgeNone : side;
    }
  }
  ArdiaPiPEdge edge = [self edgeBeyond];
  if (edge == ArdiaPiPEdgeNone && flings) edge = [self edgeFlungTowards:velocity];
  if (edge != ArdiaPiPEdgeNone) {
    [self stashAt:edge velocity:flings ? velocity : NSZeroPoint];
    return edge;
  }
  if (_stashedEdge != ArdiaPiPEdgeNone) [self setStashedEdge:ArdiaPiPEdgeNone];
  *thrown = flings && [self throwWithVelocity:velocity];
  if (!*thrown) [self rescueIfLost];
  return ArdiaPiPEdgeNone;
}

- (void)screensChanged {
  if (_swiping) return;
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(screensChanged) object:nil];
  if (_sawDrag || (NSEvent.pressedMouseButtons & 1)) {
    [self performSelector:@selector(screensChanged) withObject:nil afterDelay:0.12];
    return;
  }
  if (_stashedEdge != ArdiaPiPEdgeNone && ![NSScreen.screens containsObject:_stashScreen]) [self setStashedEdge:ArdiaPiPEdgeNone];
  if (_stashedEdge != ArdiaPiPEdgeNone && [self displayBeyond:_stashedEdge of:_stashScreen]) return [self unstash];
  if (_stashedEdge != ArdiaPiPEdgeNone) return [self stashAt:_stashedEdge velocity:NSZeroPoint on:_stashScreen];
  [self rescueIfLost];
}

- (NSScreen *)gestureHome {
  return _stashedEdge != ArdiaPiPEdgeNone && _stashScreen ? _stashScreen : [self homeScreen];
}

- (void)rescueIfLost {
  if (_stashedEdge != ArdiaPiPEdgeNone || _animating || _swiping || !_window.visible) return;
  const auto screens = ThrowScreens();
  const auto rescued =
      ardia_pip_throw::Rescue(ThrowRect(_window.frame), screens.data(), (int)screens.size(), ScreenIndex([self homeScreen]));
  const NSRect target = NSMakeRect(rescued.x, rescued.y, rescued.w, rescued.h);
  if (!NSEqualRects(target, _window.frame)) [self springTo:target velocity:NSZeroPoint response:ardia_pip_throw::kSettleResponse record:nil];
}

- (NSRect)frameStashedAt:(ArdiaPiPEdge)edge {
  return [self frameStashedAt:edge on:[self homeScreen]];
}

- (NSRect)frameStashedAt:(ArdiaPiPEdge)edge on:(NSScreen *)screen {
  NSRect frame = _window.frame;
  NSRect visible = screen.visibleFrame;
  frame.origin.x = edge == ArdiaPiPEdgeRight ? NSMaxX(visible) - kPeek : NSMinX(visible) - NSWidth(frame) + kPeek;
  frame.origin.y = MIN(MAX(NSMinY(frame), NSMinY(visible)), NSMaxY(visible) - NSHeight(frame));
  return frame;
}

- (void)stashAt:(ArdiaPiPEdge)edge {
  [self stashAt:edge velocity:NSZeroPoint];
}

- (void)stashAt:(ArdiaPiPEdge)edge velocity:(NSPoint)velocity {
  [self stashAt:edge velocity:velocity on:[self homeScreen]];
}

- (void)stashAt:(ArdiaPiPEdge)edge velocity:(NSPoint)velocity on:(NSScreen *)screen {
  _stashScreen = screen;
  const NSRect target = [self frameStashedAt:edge on:screen];
  [self setStashedEdge:edge];
  [self springTo:target velocity:velocity response:ardia_pip_throw::kSettleResponse record:nil];
}

- (void)unstash {
  [self unstashWithVelocity:NSZeroPoint];
}

- (void)unstashWithVelocity:(NSPoint)velocity {
  ArdiaPiPEdge edge = _stashedEdge;
  if (edge == ArdiaPiPEdgeNone) return;
  NSRect frame = _window.frame;
  NSRect visible = (_stashScreen ?: [self homeScreen]).visibleFrame;
  frame.origin.x = edge == ArdiaPiPEdgeRight ? NSMaxX(visible) - NSWidth(frame) - kReturnMargin : NSMinX(visible) + kReturnMargin;
  frame.origin.y = MIN(MAX(NSMinY(frame), NSMinY(visible)), NSMaxY(visible) - NSHeight(frame));
  [self setStashedEdge:ArdiaPiPEdgeNone];
  [self springTo:frame velocity:velocity response:ardia_pip_throw::kSettleResponse record:nil];
}

- (void)setStashedEdge:(ArdiaPiPEdge)edge {
  const BOOL was = _stashedEdge != ArdiaPiPEdgeNone;
  _stashedEdge = edge;
  ArdiaPiPHandle *handle = _overlay.handle;
  if (edge != ArdiaPiPEdgeNone) {
    if (!was || handle.edge != edge) handle.alphaValue = 0;
    handle.edge = edge;
    handle.hidden = NO;
    _overlay.needsLayout = YES;
    [_overlay layoutSubtreeIfNeeded];
    return;
  }
  if (!was) return;
  [NSAnimationContext
      runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = 0.1;
        context.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.23 :1 :0.32 :1];
        handle.animator.alphaValue = 0;
      }
      completionHandler:^{
        if (self->_stashedEdge == ArdiaPiPEdgeNone) handle.hidden = YES;
      }];
}

- (void)revealHandle {
  ArdiaPiPHandle *handle = _overlay.handle;
  if (_stashedEdge == ArdiaPiPEdgeNone || handle.alphaValue >= 1) return;
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
    context.duration = 0.12;
    context.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.23 :1 :0.32 :1];
    handle.animator.alphaValue = 1;
  }];
}

- (void)springSettled {
  _animating = NO;
  _sawDrag = NO;
  [self revealHandle];
  [self fitCorners:YES];
  [self rescueIfLost];
}

- (void)springTo:(NSRect)target velocity:(NSPoint)velocity response:(double)response record:(NSMutableDictionary *)record {
  [self stopMotion];
  const NSRect from = _window.frame;
  if (NSEqualPoints(from.origin, target.origin) || !_window.visible || NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
    if (!NSEqualPoints(from.origin, target.origin)) [_window setFrameOrigin:target.origin];
    record[@"settledAfter"] = @0;
    return [self springSettled];
  }
  NSMutableArray *trace = record[@"frames"];
  _animating = YES;
  _slideTarget = target;
  const CFTimeInterval start = CACurrentMediaTime();
  __weak ArdiaPiPController *weakSelf = self;
  _slide = [NSTimer scheduledTimerWithTimeInterval:1.0 / 120 repeats:YES block:^(NSTimer *timer) {
    ArdiaPiPController *strongSelf = weakSelf;
    NSWindow *window = strongSelf.window;
    if (!strongSelf || !window.visible) {
      [timer invalidate];
      if (strongSelf) strongSelf->_animating = NO;
      return;
    }
    const double t = CACurrentMediaTime() - start;
    const auto x = ardia_pip_throw::SpringAt(NSMinX(from) - NSMinX(target), velocity.x, t, response);
    const auto y = ardia_pip_throw::SpringAt(NSMinY(from) - NSMinY(target), velocity.y, t, response);
    const BOOL done = ardia_pip_throw::Resolved(x, y);
    const NSPoint origin = done ? target.origin : NSMakePoint(round(NSMinX(target) + x.offset), round(NSMinY(target) + y.offset));
    if (!NSEqualPoints(origin, window.frame.origin)) {
      [window setFrameOrigin:origin];
      CALayer *content = window.contentView.layer;
      if (trace.count < 1200)
        [trace addObject:@[ @(round(t * 10000) / 10000), @(origin.x), @(origin.y), @((content.presentationLayer ?: content).cornerRadius) ]];
    }
    if (!done) return;
    [timer invalidate];
    record[@"settledAfter"] = @(t);
    [strongSelf springSettled];
  }];
  [NSRunLoop.currentRunLoop addTimer:_slide forMode:NSRunLoopCommonModes];
}

- (void)stopMotion {
  [_slide invalidate];
  _slide = nil;
  _animating = NO;
}

- (BOOL)throwWithVelocity:(NSPoint)velocity {
  const NSRect frame = _window.frame;
  const auto screens = ThrowScreens();
  const ardia_pip_throw::Point center{NSMidX(frame), NSMidY(frame)};
  const int index = ScreenIndex([self homeScreen]);
  if (index < 0) return NO;
  const ardia_pip_throw::Rect area = screens[index].visible;
  const ardia_pip_throw::Corner corner = ardia_pip_throw::PickCorner(center, {velocity.x, velocity.y}, area);
  if (corner == ardia_pip_throw::kNoCorner) return NO;
  const ardia_pip_throw::Rect target = ardia_pip_throw::CornerFrame(corner, NSWidth(frame), NSHeight(frame), area);
  [self throwTo:NSMakeRect(target.x, target.y, target.w, target.h) velocity:velocity corner:corner];
  return YES;
}

- (void)throwTo:(NSRect)target velocity:(NSPoint)velocity corner:(int)corner {
  [self stopMotion];
  [self bendCornersTo:ardia_pip_throw::kFreeRadius animated:NO];
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  _sawDrag = NO;
  if (_stashedEdge != ArdiaPiPEdgeNone) [self setStashedEdge:ArdiaPiPEdgeNone];
  NSMutableDictionary *record = [@{
    @"corner" : CornerName(corner),
    @"from" : NSStringFromRect(_window.frame),
    @"target" : NSStringFromRect(target),
    @"velocity" : NSStringFromPoint(velocity),
    @"frames" : [NSMutableArray array],
  } mutableCopy];
  _lastThrow = record;
  [self springTo:target velocity:velocity response:ardia_pip_throw::kResponse record:record];
}

- (void)dragReleasedAt:(NSPoint)pointer velocity:(NSPoint)velocity {
  const BOOL reduceMotion = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
  const BOOL flings = ThrowEnabled() && !reduceMotion && ardia_pip_throw::DragFlings({velocity.x, velocity.y});
  BOOL thrown = NO;
  const ArdiaPiPEdge stashed = [self landWithVelocity:velocity flings:flings thrown:&thrown];
  _lastRelease = @{
    @"pointer" : NSStringFromPoint(pointer),
    @"velocity" : NSStringFromPoint(velocity),
    @"flings" : @(flings),
    @"thrown" : @(thrown),
    @"stashed" : @(stashed),
    @"frame" : NSStringFromRect(_window.frame),
  };
}

- (void)swipeBegan:(NSEvent *)event {
  [self stopMotion];
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  _swiping = YES;
  _swipeStart = _window.frame;
  _swipeHome = [self gestureHome];
  const NSPoint pointer = PointerOf(event);
  _swipeGrab = NSMakePoint(MIN(MAX(pointer.x - NSMinX(_swipeStart), 0), NSWidth(_swipeStart)),
                           MIN(MAX(pointer.y - NSMinY(_swipeStart), 0), NSHeight(_swipeStart)));
  _swipePointer = NSEvent.mouseLocation;
  _swipeBeganAt = CACurrentMediaTime();
  _swipeLastDelta = NSZeroPoint;
  if (!ardia_host::Background()) [NSCursor setHiddenUntilMouseMoves:YES];
  [self swipeMoved:event];
}

- (void)moveBy:(ardia_pip_throw::Point)delta {
  if (delta.x == 0 && delta.y == 0) return;
  const auto screens = ThrowScreens();
  const auto next =
      ardia_pip_throw::SwipeStep(ThrowRect(_window.frame), delta, screens.data(), (int)screens.size(), ScreenIndex(_swipeHome));
  const NSPoint origin = NSMakePoint(next.x, next.y);
  if (!NSEqualPoints(origin, _window.frame.origin)) [_window setFrameOrigin:origin];
}

- (void)abandonSwipe {
  if (!_swiping) return;
  _swiping = NO;
  if (!ardia_host::Background()) [NSCursor setHiddenUntilMouseMoves:NO];
}

- (void)swipeMoved:(NSEvent *)event {
  const auto delta = ardia_pip_throw::FingerDelta(event.scrollingDeltaX, event.scrollingDeltaY, event.isDirectionInvertedFromDevice);
  _swipeLastDelta = NSMakePoint(delta.x, delta.y);
  _swipeLastAt = NSProcessInfo.processInfo.systemUptime;
  [self moveBy:delta];
}

- (void)swipeEnded:(NSEvent *)event cancelled:(BOOL)cancelled {
  [self moveBy:ardia_pip_throw::FingerDelta(event.scrollingDeltaX, event.scrollingDeltaY, event.isDirectionInvertedFromDevice)];
  _swiping = NO;
  const NSPoint last = _swipeLastDelta;
  const BOOL fresh = NSProcessInfo.processInfo.systemUptime - _swipeLastAt <= ardia_pip_throw::kVelocityWindow;
  const BOOL flings = !cancelled && fresh && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion &&
                      ardia_pip_throw::SwipeFlings({last.x, last.y});
  const NSRect frame = _window.frame;
  const auto velocity = ardia_pip_throw::SwipeVelocity({last.x, last.y});
  BOOL thrown = NO;
  const ArdiaPiPEdge edge = [self landWithVelocity:NSMakePoint(velocity.x, velocity.y) flings:flings thrown:&thrown];
  const NSRect destination = _animating ? _slideTarget : _window.frame;
  const NSPoint landing = NSMakePoint(NSMinX(destination) + _swipeGrab.x, NSMinY(destination) + _swipeGrab.y);
  const BOOL unmoved = NSEqualPoints(NSEvent.mouseLocation, _swipePointer);
  const BOOL warp = edge == ArdiaPiPEdgeNone && unmoved && (!thrown || CACurrentMediaTime() - _swipeBeganAt >= 0.15);
  if (!ardia_host::Background()) {
    if (warp) {
      CGWarpMouseCursorPosition(CGPointMake(landing.x, NSMaxY(NSScreen.screens.firstObject.frame) - landing.y));
      [NSCursor setHiddenUntilMouseMoves:YES];
    } else {
      [NSCursor setHiddenUntilMouseMoves:NO];
    }
  }
  _lastSwipe = @{
    @"start" : NSStringFromRect(_swipeStart),
    @"released" : NSStringFromRect(frame),
    @"lastDelta" : NSStringFromPoint(last),
    @"fresh" : @(fresh),
    @"cancelled" : @(cancelled),
    @"flings" : @(flings),
    @"thrown" : @(thrown),
    @"stashed" : @(edge),
    @"warp" : warp ? NSStringFromPoint(landing) : @"",
  };
}

- (NSDictionary *)throwInfo {
  return @{@"lastThrow" : _lastThrow ?: @{}, @"lastSwipe" : _lastSwipe ?: @{}, @"lastRelease" : _lastRelease ?: @{}, @"lastScreenFit" : _lastScreenFit ?: @{}, @"swiping" : @(_swiping)};
}

@end
