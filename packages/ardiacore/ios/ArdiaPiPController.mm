#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaChromeWindowHost.h"
#import "ArdiaPiPThrowMath.h"

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

namespace {

BOOL ScreenAt(CGFloat x, CGFloat y) {
  for (NSScreen *screen in NSScreen.screens)
    if (NSPointInRect(NSMakePoint(x, y), screen.frame)) return YES;
  return NO;
}

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
  if (layer.cornerRadius != kCornerRadius || !layer.masksToBounds) {
    layer.cornerRadius = kCornerRadius;
    layer.cornerCurve = kCACornerCurveCircular;
    layer.masksToBounds = YES;
  }
  CALayer *rim = _overlay.layer;
  rim.cornerRadius = kCornerRadius;
  rim.cornerCurve = kCACornerCurveCircular;
  rim.borderWidth = 1;
  rim.borderColor = [NSColor colorWithWhite:1 alpha:kRimAlpha].CGColor;
  _window.opaque = NO;
  _window.backgroundColor = NSColor.clearColor;
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_window invalidateShadow]; });
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

- (void)windowMoved {
  [self homeScreen];
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

- (ArdiaPiPEdge)edgeBeyond {
  NSRect frame = _window.frame;
  NSRect visible = [self homeScreen].visibleFrame;
  CGFloat half = NSWidth(frame) / 2;
  if (NSMaxX(frame) - NSMaxX(visible) > half && !ScreenAt(NSMaxX(visible) + 1, NSMidY(frame))) return ArdiaPiPEdgeRight;
  if (NSMinX(visible) - NSMinX(frame) > half && !ScreenAt(NSMinX(visible) - 1, NSMidY(frame))) return ArdiaPiPEdgeLeft;
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
  if (edge != ArdiaPiPEdgeNone) return [self stashAt:edge];
  if (_stashedEdge != ArdiaPiPEdgeNone && !dragged) return [self stashAt:_stashedEdge];
  if (_stashedEdge != ArdiaPiPEdgeNone) [self setStashedEdge:ArdiaPiPEdgeNone];
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
  if (!NSEqualRects(target, _window.frame)) [self animateTo:target];
}

- (NSRect)frameStashedAt:(ArdiaPiPEdge)edge {
  NSRect frame = _window.frame;
  NSRect visible = [self homeScreen].visibleFrame;
  frame.origin.x = edge == ArdiaPiPEdgeRight ? NSMaxX(visible) - kPeek : NSMinX(visible) - NSWidth(frame) + kPeek;
  frame.origin.y = MIN(MAX(NSMinY(frame), NSMinY(visible)), NSMaxY(visible) - NSHeight(frame));
  return frame;
}

- (void)stashAt:(ArdiaPiPEdge)edge {
  _stashScreen = [self homeScreen];
  [self setStashedEdge:edge];
  [self animateTo:[self frameStashedAt:edge]];
}

- (void)unstash {
  ArdiaPiPEdge edge = _stashedEdge;
  if (edge == ArdiaPiPEdgeNone) return;
  NSRect frame = _window.frame;
  NSRect visible = [self homeScreen].visibleFrame;
  frame.origin.x = edge == ArdiaPiPEdgeRight ? NSMaxX(visible) - NSWidth(frame) - kReturnMargin : NSMinX(visible) + kReturnMargin;
  [self setStashedEdge:ArdiaPiPEdgeNone];
  [self animateTo:frame];
}

- (void)setStashedEdge:(ArdiaPiPEdge)edge {
  _stashedEdge = edge;
  ArdiaPiPHandle *handle = _overlay.handle;
  if (edge != ArdiaPiPEdgeNone) {
    handle.edge = edge;
    handle.hidden = NO;
    _overlay.needsLayout = YES;
  }
  [NSAnimationContext
      runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = 0.25;
        handle.animator.alphaValue = edge != ArdiaPiPEdgeNone ? 1 : 0;
      }
      completionHandler:^{
        if (self->_stashedEdge == ArdiaPiPEdgeNone) handle.hidden = YES;
      }];
}

- (void)animateTo:(NSRect)target {
  [_slide invalidate];
  NSRect from = _window.frame;
  if (NSEqualRects(from, target)) return;
  _animating = YES;
  CFTimeInterval start = CACurrentMediaTime();
  __weak ArdiaPiPController *weakSelf = self;
  _slide = [NSTimer scheduledTimerWithTimeInterval:1.0 / 120 repeats:YES block:^(NSTimer *timer) {
    ArdiaPiPController *strongSelf = weakSelf;
    double t = MIN((CACurrentMediaTime() - start) / 0.25, 1);
    double eased = 1 - pow(1 - t, 3);
    NSRect frame = NSMakeRect(round(NSMinX(from) + (NSMinX(target) - NSMinX(from)) * eased),
                              round(NSMinY(from) + (NSMinY(target) - NSMinY(from)) * eased), NSWidth(target), NSHeight(target));
    [strongSelf.window setFrame:t < 1 ? frame : target display:YES];
    if (t < 1 && strongSelf) return;
    [timer invalidate];
    if (strongSelf) strongSelf->_animating = NO, strongSelf->_sawDrag = NO;
    [strongSelf rescueIfLost];
  }];
  [NSRunLoop.currentRunLoop addTimer:_slide forMode:NSRunLoopCommonModes];
}

- (void)stopMotion {
  [_slide invalidate];
  _slide = nil;
  _animating = NO;
}

- (BOOL)throwFrom:(NSPoint)grab velocity:(NSPoint)velocity {
  NSRect frame = _window.frame;
  NSScreen *screen = [self homeScreen];
  ardia_pip_throw::Corner corner =
      ardia_pip_throw::PickCorner({grab.x, grab.y}, {velocity.x, velocity.y}, ThrowRect(screen.frame));
  if (corner == ardia_pip_throw::kNoCorner) return NO;
  ardia_pip_throw::Rect target =
      ardia_pip_throw::CornerFrame(corner, NSWidth(frame), NSHeight(frame), ThrowRect(screen.visibleFrame));
  [self throwTo:NSMakeRect(target.x, target.y, target.w, target.h) velocity:velocity corner:corner];
  return YES;
}

- (void)throwTo:(NSRect)target velocity:(NSPoint)velocity corner:(int)corner {
  [self stopMotion];
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  _sawDrag = NO;
  if (_stashedEdge != ArdiaPiPEdgeNone) [self setStashedEdge:ArdiaPiPEdgeNone];
  const NSRect from = _window.frame;
  NSMutableArray *trace = [NSMutableArray array];
  NSMutableDictionary *record = [@{
    @"corner" : CornerName(corner),
    @"from" : NSStringFromRect(from),
    @"target" : NSStringFromRect(target),
    @"velocity" : NSStringFromPoint(velocity),
    @"frames" : trace,
  } mutableCopy];
  _lastThrow = record;
  _animating = YES;
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
    const auto x = ardia_pip_throw::SpringAt(NSMinX(from) - NSMinX(target), velocity.x, t);
    const auto y = ardia_pip_throw::SpringAt(NSMinY(from) - NSMinY(target), velocity.y, t);
    const BOOL done = ardia_pip_throw::Resolved(x, y);
    const NSPoint origin = done ? target.origin : NSMakePoint(round(NSMinX(target) + x.offset), round(NSMinY(target) + y.offset));
    if (!NSEqualPoints(origin, window.frame.origin)) {
      [window setFrameOrigin:origin];
      if (trace.count < 1200) [trace addObject:@[ @(round(t * 10000) / 10000), @(origin.x), @(origin.y) ]];
    }
    if (!done) return;
    [timer invalidate];
    strongSelf->_animating = NO;
    record[@"settledAfter"] = @(t);
    [strongSelf rescueIfLost];
  }];
  [NSRunLoop.currentRunLoop addTimer:_slide forMode:NSRunLoopCommonModes];
}

- (void)dragReleasedAt:(NSPoint)pointer velocity:(NSPoint)velocity {
  const BOOL reduceMotion = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
  const BOOL flings = ThrowEnabled() && !reduceMotion && ardia_pip_throw::DragFlings({velocity.x, velocity.y}) &&
                      [self edgeBeyond] == ArdiaPiPEdgeNone;
  const BOOL thrown = flings && [self throwFrom:pointer velocity:velocity];
  _lastRelease = @{
    @"pointer" : NSStringFromPoint(pointer),
    @"velocity" : NSStringFromPoint(velocity),
    @"flings" : @(flings),
    @"thrown" : @(thrown),
    @"frame" : NSStringFromRect(_window.frame),
  };
  if (!thrown) [self rescueIfLost];
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
  const NSPoint grab = NSMakePoint(NSMinX(frame) + _swipeGrab.x, NSMinY(frame) + _swipeGrab.y);
  const ArdiaPiPEdge edge = [self edgeBeyond];
  BOOL thrown = NO;
  NSRect destination = frame;
  if (edge != ArdiaPiPEdgeNone) {
    destination = [self frameStashedAt:edge];
    [self stashAt:edge];
  } else {
    if (_stashedEdge != ArdiaPiPEdgeNone) [self setStashedEdge:ArdiaPiPEdgeNone];
    const auto velocity = ardia_pip_throw::SwipeVelocity({last.x, last.y});
    thrown = flings && [self throwFrom:grab velocity:NSMakePoint(velocity.x, velocity.y)];
    if (thrown) destination = NSRectFromString(_lastThrow[@"target"]);
  }
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
  [self rescueIfLost];
}

- (NSDictionary *)throwInfo {
  return @{@"lastThrow" : _lastThrow ?: @{}, @"lastSwipe" : _lastSwipe ?: @{}, @"lastRelease" : _lastRelease ?: @{}, @"swiping" : @(_swiping)};
}

@end
