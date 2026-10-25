#import "ArdiaCorePictureInPicture.h"

#import "ACChromeWindow.h"
#import "ArdiaCorePiPThrow.h"
#import "ArdiaCorePiPZoom.h"
#import "ArdiaCoreWebViewInternal.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

#include <vector>

@interface NSWindow (ACPreventsActivation)
- (void)_setPreventsActivation:(BOOL)prevents;
- (BOOL)_preventsActivation;
- (NSInteger)_resizeDirectionForMouseLocation:(NSPoint)location;
@end

namespace {

constexpr CGFloat kPeek = 28;
constexpr CGFloat kReturnMargin = 16;
constexpr CGFloat kButtonMargin = 12, kButtonSize = 28;
constexpr CGFloat kCornerRadius = 6;
constexpr CGFloat kRimAlpha = 0.17;

NSString *const kKeepOnTopDefault = @"ACPictureInPictureKeepOnTop";
NSString *const kZoomDefault = @"ACPictureInPictureZoom";
NSString *const kThrowDefault = @"ACPictureInPictureThrow";
const void *const kControllerKey = &kControllerKey;
const void *const kZoomKey = &kZoomKey;

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

BOOL IsChromeFloatingWindow(NSWindow *window) {
  static Class frameless = NSClassFromString(@"NativeWidgetMacFramelessNSWindow");
  return frameless && [window isKindOfClass:frameless] && window.visible && window.level >= NSFloatingWindowLevel &&
         (window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces);
}

BOOL IsChromeVideoPictureInPicture(NSWindow *window) {
  return IsChromeFloatingWindow(window) && !ShowsPage(window.contentView);
}

BOOL IsChromeDocumentPictureInPicture(NSWindow *window) {
  static Class frameless = NSClassFromString(@"NativeWidgetMacFramelessNSWindow");
  return frameless && [window isKindOfClass:frameless] && ShowsPage(window.contentView);
}

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

NSScreen *ScreenFor(NSRect frame) { return OverlappingScreen(frame) ?: NSScreen.mainScreen; }

BOOL ScreenAt(CGFloat x, CGFloat y) {
  for (NSScreen *screen in NSScreen.screens)
    if (NSPointInRect(NSMakePoint(x, y), screen.frame)) return YES;
  return NO;
}

void PreventActivation(NSWindow *window) {
  if ([window respondsToSelector:@selector(_setPreventsActivation:)]) [window _setPreventsActivation:YES];
}

BOOL PreventsActivation(NSWindow *window) {
  return [window respondsToSelector:@selector(_preventsActivation)] && [window _preventsActivation];
}

NSInteger gActivations = 0;

void ActivateApp(NSString *why) {
  gActivations++;
  if (ardiacore_host::Background()) return ardiacore_host::LogActivation([@"activate (skipped in a test instance): " stringByAppendingString:why]);
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

ardiacore_pip_throw::Rect ThrowRect(NSRect r) { return {NSMinX(r), NSMinY(r), NSWidth(r), NSHeight(r)}; }

int ScreenIndex(NSScreen *screen) {
  const NSUInteger index = screen ? [NSScreen.screens indexOfObjectIdenticalTo:screen] : NSNotFound;
  return index == NSNotFound ? -1 : (int)index;
}

std::vector<ardiacore_pip_throw::Screen> ThrowScreens() {
  std::vector<ardiacore_pip_throw::Screen> screens;
  for (NSScreen *screen in NSScreen.screens) screens.push_back({ThrowRect(screen.frame), ThrowRect(screen.visibleFrame)});
  return screens;
}

NSString *CornerName(int corner) {
  switch (corner) {
    case ardiacore_pip_throw::kTopLeft: return @"topLeft";
    case ardiacore_pip_throw::kTopRight: return @"topRight";
    case ardiacore_pip_throw::kBottomLeft: return @"bottomLeft";
    case ardiacore_pip_throw::kBottomRight: return @"bottomRight";
    default: return @"none";
  }
}

}

typedef NS_ENUM(NSInteger, ACPiPEdge) { ACPiPEdgeNone = 0, ACPiPEdgeLeft = -1, ACPiPEdgeRight = 1 };

@class ACPiPController;

@interface ACPiPControl : NSView
@property (nonatomic, copy) void (^onClick)(void);
@property (nonatomic) BOOL hovered;
@end

@implementation ACPiPControl {
  NSEvent *_down;
  NSTrackingArea *_tracking;
}

- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)mouseDownCanMoveWindow { return NO; }

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_tracking) [self removeTrackingArea:_tracking];
  _tracking = [[NSTrackingArea alloc]
      initWithRect:NSZeroRect
           options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect | NSTrackingCursorUpdate
             owner:self
          userInfo:nil];
  [self addTrackingArea:_tracking];
}

- (void)mouseEntered:(NSEvent *)event { self.hovered = YES; }
- (void)mouseExited:(NSEvent *)event { self.hovered = NO; }
- (void)cursorUpdate:(NSEvent *)event { [NSCursor.pointingHandCursor set]; }

- (void)mouseDown:(NSEvent *)event { _down = event; }

- (void)mouseDragged:(NSEvent *)event {
  if (!_down) return;
  NSPoint a = _down.locationInWindow, b = event.locationInWindow;
  if (hypot(b.x - a.x, b.y - a.y) < 3) return;
  NSEvent *down = _down;
  _down = nil;
  [self.window performWindowDragWithEvent:down];
}

- (void)mouseUp:(NSEvent *)event {
  if (!_down) return;
  _down = nil;
  if (self.onClick) self.onClick();
}

@end

@interface ACPiPHandle : ACPiPControl
@property (nonatomic) ACPiPEdge edge;
@end

@implementation ACPiPHandle {
  NSImageView *_chevron;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    _chevron = [[NSImageView alloc] init];
    _chevron.contentTintColor = [NSColor colorWithWhite:1 alpha:0.95];
    _chevron.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:15 weight:NSFontWeightSemibold];
    [self addSubview:_chevron];
    self.toolTip = @"Show Picture in Picture";
    [self setHovered:NO];
  }
  return self;
}

- (void)setEdge:(ACPiPEdge)edge {
  _edge = edge;
  NSString *name = edge == ACPiPEdgeLeft ? @"chevron.compact.right" : @"chevron.compact.left";
  _chevron.image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:@"Show Picture in Picture"];
  self.needsLayout = YES;
}

- (void)setHovered:(BOOL)hovered {
  [super setHovered:hovered];
  self.layer.backgroundColor = [NSColor colorWithWhite:0 alpha:hovered ? 0.7 : 0.5].CGColor;
}

- (void)layout {
  [super layout];
  NSSize size = NSMakeSize(16, 28);
  _chevron.frame = NSMakeRect(floor((NSWidth(self.bounds) - size.width) / 2), floor((NSHeight(self.bounds) - size.height) / 2),
                              size.width, size.height);
}

@end

@interface ACPiPOverlay : NSView
@property (nonatomic, readonly) ACPiPHandle *handle;
@end

@interface ACPiPController : NSObject
@property (nonatomic, readonly) NSWindow *window;
@property (nonatomic, weak) ArdiaCoreWebView *view;
@property (nonatomic, copy) NSString *host;
@property (nonatomic, readonly) ACPiPOverlay *overlay;
@property (nonatomic, readonly) ACPiPEdge stashedEdge;
@property (nonatomic) BOOL keepOnTop;
- (void)setVideoFrame:(NSString *)frameId;
- (void)roundCorners;
- (void)backToTab;
- (void)unstash;
- (NSMenu *)menu;
- (void)stopMotion;
- (void)abandonSwipe;
- (NSScreen *)gestureHome;
- (void)dragReleasedAt:(NSPoint)pointer velocity:(NSPoint)velocity;
+ (BOOL)handleSwipe:(NSEvent *)event;
+ (void)abandonSwipeOn:(NSWindow *)window;
- (NSDictionary *)throwInfo;
- (void)devSwipe:(NSArray<NSString *> *)args;
- (void)devDrag:(NSArray<NSString *> *)args;
@end

@implementation ACPiPOverlay

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.layer.zPosition = 100;
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _handle = [[ACPiPHandle alloc] initWithFrame:NSZeroRect];
    _handle.hidden = YES;
    _handle.alphaValue = 0;
    [self addSubview:_handle];
  }
  return self;
}

- (BOOL)isFlipped { return YES; }

- (NSView *)hitTest:(NSPoint)point {
  NSPoint local = [self convertPoint:point fromView:self.superview];
  if (!_handle.hidden && NSPointInRect(local, _handle.frame)) return _handle;
  return nil;
}

- (void)layout {
  [super layout];
  NSSize size = self.bounds.size;
  _handle.frame = _handle.edge == ACPiPEdgeLeft ? NSMakeRect(size.width - kPeek, 0, kPeek, size.height)
                                                 : NSMakeRect(0, 0, kPeek, size.height);
}

@end

@implementation ACPiPController {
  NSMutableArray *_observers;
  NSString *_frameId;
  NSTimer *_slide;
  BOOL _animating;
  BOOL _sawDrag;
  BOOL _swiping;
  NSPoint _swipeGrab;
  NSPoint _swipeLastDelta;
  NSPoint _swipePointer;
  CFTimeInterval _swipeBeganAt;
  NSTimeInterval _swipeLastAt;
  NSRect _swipeStart;
  NSDictionary *_lastRelease;
  NSDictionary *_lastSwipe;
  NSMutableDictionary *_lastThrow;
  __weak NSScreen *_lastScreen;
  __weak NSScreen *_swipeHome;
  __weak NSScreen *_stashScreen;
}

+ (instancetype)forWindow:(NSWindow *)window {
  return objc_getAssociatedObject(window, kControllerKey);
}

- (instancetype)initWithWindow:(NSWindow *)window {
  if ((self = [super init])) {
    _window = window;
    NSView *root = ACWindowRootView(window);
    _overlay = [[ACPiPOverlay alloc] initWithFrame:root.bounds];
    __weak ACPiPController *weakSelf = self;
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
  [ACPiPController abandonSwipeOn:_window];
  for (id observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  [_observers removeAllObjects];
  [NSObject cancelPreviousPerformRequestsWithTarget:self];
  [_slide invalidate];
  [_overlay removeFromSuperview];
  _frameId = nil;
  objc_setAssociatedObject(_window, kControllerKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

- (void)setVideoFrame:(NSString *)frameId { _frameId = [frameId copy]; }

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
  ArdiaCoreWebView *view = self.view;
  if (!view) return;
  ActivateApp(@"Back to Tab (menu)");
  [view emit:@"activateRequest" payload:@{@"reason" : @"pictureInPicture"}];
  [view exitPictureInPictureInFrame:_frameId];
}

- (void)windowMoved {
  [self homeScreen];
  if (_animating || (_swiping && NSProcessInfo.processInfo.systemUptime - _swipeLastAt < 1)) return;
  if (_swiping) [ACPiPController abandonSwipeOn:_window];
  if (NSEvent.pressedMouseButtons & 1) _sawDrag = YES;
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  [self performSelector:@selector(settle) withObject:nil afterDelay:0.12];
}

- (NSScreen *)homeScreen {
  NSScreen *screen = OverlappingScreen(_window.frame);
  if (screen) _lastScreen = screen;
  return screen ?: _lastScreen ?: NSScreen.mainScreen;
}

- (ACPiPEdge)edgeBeyond {
  NSRect frame = _window.frame;
  NSRect visible = [self homeScreen].visibleFrame;
  CGFloat half = NSWidth(frame) / 2;
  if (NSMaxX(frame) - NSMaxX(visible) > half && !ScreenAt(NSMaxX(visible) + 1, NSMidY(frame))) return ACPiPEdgeRight;
  if (NSMinX(visible) - NSMinX(frame) > half && !ScreenAt(NSMinX(visible) - 1, NSMidY(frame))) return ACPiPEdgeLeft;
  return ACPiPEdgeNone;
}

- (void)settle {
  if (NSEvent.pressedMouseButtons & 1) {
    [self performSelector:@selector(settle) withObject:nil afterDelay:0.12];
    return;
  }
  BOOL dragged = _sawDrag;
  _sawDrag = NO;
  ACPiPEdge edge = [self edgeBeyond];
  if (edge != ACPiPEdgeNone) return [self stashAt:edge];
  if (_stashedEdge != ACPiPEdgeNone && !dragged) return [self stashAt:_stashedEdge];
  if (_stashedEdge != ACPiPEdgeNone) [self setStashedEdge:ACPiPEdgeNone];
  [self rescueIfLost];
}

- (NSScreen *)gestureHome {
  return _stashedEdge != ACPiPEdgeNone && _stashScreen ? _stashScreen : [self homeScreen];
}

- (void)rescueIfLost {
  if (_stashedEdge != ACPiPEdgeNone || _animating || _swiping || !_window.visible) return;
  const auto screens = ThrowScreens();
  const auto rescued =
      ardiacore_pip_throw::Rescue(ThrowRect(_window.frame), screens.data(), (int)screens.size(), ScreenIndex([self homeScreen]));
  const NSRect target = NSMakeRect(rescued.x, rescued.y, rescued.w, rescued.h);
  if (!NSEqualRects(target, _window.frame)) [self animateTo:target];
}

- (NSRect)frameStashedAt:(ACPiPEdge)edge {
  NSRect frame = _window.frame;
  NSRect visible = [self homeScreen].visibleFrame;
  frame.origin.x = edge == ACPiPEdgeRight ? NSMaxX(visible) - kPeek : NSMinX(visible) - NSWidth(frame) + kPeek;
  frame.origin.y = MIN(MAX(NSMinY(frame), NSMinY(visible)), NSMaxY(visible) - NSHeight(frame));
  return frame;
}

- (void)stashAt:(ACPiPEdge)edge {
  _stashScreen = [self homeScreen];
  [self setStashedEdge:edge];
  [self animateTo:[self frameStashedAt:edge]];
}

- (void)unstash {
  ACPiPEdge edge = _stashedEdge;
  if (edge == ACPiPEdgeNone) return;
  NSRect frame = _window.frame;
  NSRect visible = [self homeScreen].visibleFrame;
  frame.origin.x = edge == ACPiPEdgeRight ? NSMaxX(visible) - NSWidth(frame) - kReturnMargin : NSMinX(visible) + kReturnMargin;
  [self setStashedEdge:ACPiPEdgeNone];
  [self animateTo:frame];
}

- (void)setStashedEdge:(ACPiPEdge)edge {
  _stashedEdge = edge;
  ACPiPHandle *handle = _overlay.handle;
  if (edge != ACPiPEdgeNone) {
    handle.edge = edge;
    handle.hidden = NO;
    _overlay.needsLayout = YES;
  }
  [NSAnimationContext
      runAnimationGroup:^(NSAnimationContext *context) {
        context.duration = 0.25;
        handle.animator.alphaValue = edge != ACPiPEdgeNone ? 1 : 0;
      }
      completionHandler:^{
        if (self->_stashedEdge == ACPiPEdgeNone) handle.hidden = YES;
      }];
}

- (void)animateTo:(NSRect)target {
  [_slide invalidate];
  NSRect from = _window.frame;
  if (NSEqualRects(from, target)) return;
  _animating = YES;
  CFTimeInterval start = CACurrentMediaTime();
  __weak ACPiPController *weakSelf = self;
  _slide = [NSTimer scheduledTimerWithTimeInterval:1.0 / 120 repeats:YES block:^(NSTimer *timer) {
    ACPiPController *strongSelf = weakSelf;
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
  ardiacore_pip_throw::Corner corner =
      ardiacore_pip_throw::PickCorner({grab.x, grab.y}, {velocity.x, velocity.y}, ThrowRect(screen.frame));
  if (corner == ardiacore_pip_throw::kNoCorner) return NO;
  ardiacore_pip_throw::Rect target =
      ardiacore_pip_throw::CornerFrame(corner, NSWidth(frame), NSHeight(frame), ThrowRect(screen.visibleFrame));
  [self throwTo:NSMakeRect(target.x, target.y, target.w, target.h) velocity:velocity corner:corner];
  return YES;
}

- (void)throwTo:(NSRect)target velocity:(NSPoint)velocity corner:(int)corner {
  [self stopMotion];
  [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
  _sawDrag = NO;
  if (_stashedEdge != ACPiPEdgeNone) [self setStashedEdge:ACPiPEdgeNone];
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
  __weak ACPiPController *weakSelf = self;
  _slide = [NSTimer scheduledTimerWithTimeInterval:1.0 / 120 repeats:YES block:^(NSTimer *timer) {
    ACPiPController *strongSelf = weakSelf;
    NSWindow *window = strongSelf.window;
    if (!strongSelf || !window.visible) {
      [timer invalidate];
      if (strongSelf) strongSelf->_animating = NO;
      return;
    }
    const double t = CACurrentMediaTime() - start;
    const auto x = ardiacore_pip_throw::SpringAt(NSMinX(from) - NSMinX(target), velocity.x, t);
    const auto y = ardiacore_pip_throw::SpringAt(NSMinY(from) - NSMinY(target), velocity.y, t);
    const BOOL done = ardiacore_pip_throw::Resolved(x, y);
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
  const BOOL flings = ThrowEnabled() && !reduceMotion && ardiacore_pip_throw::DragFlings({velocity.x, velocity.y}) &&
                      [self edgeBeyond] == ACPiPEdgeNone;
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
  if (!ardiacore_host::Background()) [NSCursor setHiddenUntilMouseMoves:YES];
  [self swipeMoved:event];
}

- (void)moveBy:(ardiacore_pip_throw::Point)delta {
  if (delta.x == 0 && delta.y == 0) return;
  const auto screens = ThrowScreens();
  const auto next =
      ardiacore_pip_throw::SwipeStep(ThrowRect(_window.frame), delta, screens.data(), (int)screens.size(), ScreenIndex(_swipeHome));
  const NSPoint origin = NSMakePoint(next.x, next.y);
  if (!NSEqualPoints(origin, _window.frame.origin)) [_window setFrameOrigin:origin];
}

- (void)abandonSwipe {
  if (!_swiping) return;
  _swiping = NO;
  if (!ardiacore_host::Background()) [NSCursor setHiddenUntilMouseMoves:NO];
}

- (void)swipeMoved:(NSEvent *)event {
  const auto delta = ardiacore_pip_throw::FingerDelta(event.scrollingDeltaX, event.scrollingDeltaY, event.isDirectionInvertedFromDevice);
  _swipeLastDelta = NSMakePoint(delta.x, delta.y);
  _swipeLastAt = NSProcessInfo.processInfo.systemUptime;
  [self moveBy:delta];
}

- (void)swipeEnded:(NSEvent *)event cancelled:(BOOL)cancelled {
  [self moveBy:ardiacore_pip_throw::FingerDelta(event.scrollingDeltaX, event.scrollingDeltaY, event.isDirectionInvertedFromDevice)];
  _swiping = NO;
  const NSPoint last = _swipeLastDelta;
  const BOOL fresh = NSProcessInfo.processInfo.systemUptime - _swipeLastAt <= ardiacore_pip_throw::kVelocityWindow;
  const BOOL flings = !cancelled && fresh && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion &&
                      ardiacore_pip_throw::SwipeFlings({last.x, last.y});
  const NSRect frame = _window.frame;
  const NSPoint grab = NSMakePoint(NSMinX(frame) + _swipeGrab.x, NSMinY(frame) + _swipeGrab.y);
  const ACPiPEdge edge = [self edgeBeyond];
  BOOL thrown = NO;
  NSRect destination = frame;
  if (edge != ACPiPEdgeNone) {
    destination = [self frameStashedAt:edge];
    [self stashAt:edge];
  } else {
    if (_stashedEdge != ACPiPEdgeNone) [self setStashedEdge:ACPiPEdgeNone];
    const auto velocity = ardiacore_pip_throw::SwipeVelocity({last.x, last.y});
    thrown = flings && [self throwFrom:grab velocity:NSMakePoint(velocity.x, velocity.y)];
    if (thrown) destination = NSRectFromString(_lastThrow[@"target"]);
  }
  const NSPoint landing = NSMakePoint(NSMinX(destination) + _swipeGrab.x, NSMinY(destination) + _swipeGrab.y);
  const BOOL unmoved = NSEqualPoints(NSEvent.mouseLocation, _swipePointer);
  const BOOL warp = edge == ACPiPEdgeNone && unmoved && (!thrown || CACurrentMediaTime() - _swipeBeganAt >= 0.15);
  if (!ardiacore_host::Background()) {
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

static __weak NSWindow *gSwipeWindow;
static __weak NSWindow *gSwipeMomentum;

+ (void)abandonSwipeOn:(NSWindow *)window {
  if (!window) return;
  if (gSwipeWindow == window) gSwipeWindow = nil;
  [[self forWindow:window] abandonSwipe];
}

+ (ACPiPController *)swipeTargetFor:(NSEvent *)event {
  NSWindow *window = event.window;
  if (!window) {
    const NSPoint point = PointerOf(event);
    for (NSWindow *candidate in NSApp.orderedWindows)
      if (candidate.visible && NSPointInRect(point, candidate.frame)) {
        window = candidate;
        break;
      }
  }
  ACPiPController *controller = window ? [self forWindow:window] : nil;
  return controller && window.visible ? controller : nil;
}

+ (BOOL)handleSwipe:(NSEvent *)event {
  if (event.type != NSEventTypeScrollWheel) return NO;
  const NSEventPhase phase = event.phase, momentum = event.momentumPhase;
  if (momentum != NSEventPhaseNone) {
    const BOOL ours = gSwipeMomentum != nil;
    if (momentum & (NSEventPhaseEnded | NSEventPhaseCancelled)) gSwipeMomentum = nil;
    return ours;
  }
  if (phase == NSEventPhaseNone) return NO;
  if (phase & (NSEventPhaseBegan | NSEventPhaseMayBegin)) {
    gSwipeMomentum = nil;
    [self abandonSwipeOn:gSwipeWindow];
    if (phase != NSEventPhaseBegan || !ThrowEnabled() || !event.hasPreciseScrollingDeltas ||
        (event.modifierFlags & NSEventModifierFlagCommand))
      return NO;
    ACPiPController *controller = [self swipeTargetFor:event];
    if (!controller) return NO;
    gSwipeWindow = controller.window;
    [controller swipeBegan:event];
    return YES;
  }
  NSWindow *window = gSwipeWindow;
  ACPiPController *controller = window ? [self forWindow:window] : nil;
  if (!controller) return NO;
  if (phase & (NSEventPhaseEnded | NSEventPhaseCancelled)) {
    gSwipeWindow = nil;
    gSwipeMomentum = window;
    [controller swipeEnded:event cancelled:(phase & NSEventPhaseCancelled) != 0];
  } else {
    [controller swipeMoved:event];
  }
  return YES;
}

- (void)devSwipe:(NSArray<NSString *> *)args {
  const double fx = args.count > 0 ? args[0].doubleValue : 0, fy = args.count > 1 ? args[1].doubleValue : 0;
  const int steps = MAX(1, args.count > 2 ? args[2].intValue : 10);
  NSString *mode = args.count > 3 ? args[3] : @"trackpad";
  const BOOL wheel = [mode isEqual:@"wheel"], command = [mode isEqual:@"command"];
  const double pause = [mode isEqual:@"pause"] ? 0.3 : 0;
  NSWindow *window = _window;
  NSEvent * (^make)(CGScrollPhase, CGMomentumScrollPhase, double, double) =
      ^NSEvent *(CGScrollPhase phase, CGMomentumScrollPhase momentum, double fdx, double fdy) {
        CGEventRef cg = CGEventCreateScrollWheelEvent2(nullptr, kCGScrollEventUnitPixel, 2, 0, 0, 0);
        const NSRect f = window.frame;
        CGEventSetLocation(cg, CGPointMake(NSMidX(f), NSMaxY(NSScreen.screens.firstObject.frame) - NSMidY(f)));
        CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, wheel ? 0 : 1);
        CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase, wheel ? 0 : phase);
        CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, momentum);
        CGEventSetFlags(cg, command ? kCGEventFlagMaskCommand : 0);
        const BOOL inverted = [NSEvent eventWithCGEvent:cg].isDirectionInvertedFromDevice;
        const double sdx = inverted ? fdx : -fdx, sdy = inverted ? -fdy : fdy;
        if (wheel) {
          CGEventSetIntegerValueField(cg, kCGScrollWheelEventDeltaAxis1, lround(sdy / 10));
          CGEventSetIntegerValueField(cg, kCGScrollWheelEventDeltaAxis2, lround(sdx / 10));
        } else {
          CGEventSetIntegerValueField(cg, kCGScrollWheelEventPointDeltaAxis1, lround(sdy));
          CGEventSetIntegerValueField(cg, kCGScrollWheelEventPointDeltaAxis2, lround(sdx));
          CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis1, sdy);
          CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis2, sdx);
        }
        NSEvent *event = [NSEvent eventWithCGEvent:cg];
        CFRelease(cg);
        return event;
      };
  auto post = [=](double seconds, CGScrollPhase phase, CGMomentumScrollPhase momentum, double fdx, double fdy) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [NSApp postEvent:make(phase, momentum, fdx, fdy) atStart:NO];
    });
  };
  const double interval = 1.0 / 120;
  post(0, kCGScrollPhaseBegan, kCGMomentumScrollPhaseNone, 0, 0);
  for (int i = 1; i <= steps; i++) post(i * interval, kCGScrollPhaseChanged, kCGMomentumScrollPhaseNone, fx / steps, fy / steps);
  const double end = (steps + 1) * interval + pause;
  post(end, kCGScrollPhaseEnded, kCGMomentumScrollPhaseNone, 0, 0);
  if ([mode isEqual:@"momentum"]) {
    post(end + interval, (CGScrollPhase)0, kCGMomentumScrollPhaseBegin, fx / steps, fy / steps);
    for (int i = 2; i <= 6; i++) post(end + i * interval, (CGScrollPhase)0, kCGMomentumScrollPhaseContinue, fx / steps / i, fy / steps / i);
    post(end + 7 * interval, (CGScrollPhase)0, kCGMomentumScrollPhaseEnd, 0, 0);
  }
}

- (void)devDrag:(NSArray<NSString *> *)args {
  const double fx = args.count > 0 ? args[0].doubleValue : 0, fy = args.count > 1 ? args[1].doubleValue : 0;
  const int steps = MAX(1, args.count > 2 ? args[2].intValue : 10);
  const double interval = (args.count > 3 ? args[3].doubleValue : 8) / 1000, pause = (args.count > 4 ? args[4].doubleValue : 0) / 1000;
  NSWindow *window = _window;
  const NSRect frame = window.frame;
  const NSPoint grab = NSMakePoint(NSWidth(frame) * 0.5, NSHeight(frame) * 0.3);
  const NSPoint start = NSMakePoint(NSMinX(frame) + grab.x, NSMinY(frame) + grab.y);
  auto post = [=](double seconds, NSEventType type, NSPoint screen) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      const NSPoint local = NSMakePoint(screen.x - NSMinX(window.frame), screen.y - NSMinY(window.frame));
      [NSApp postEvent:[NSEvent mouseEventWithType:type location:local modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                                      windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1
                                          pressure:type == NSEventTypeLeftMouseUp ? 0 : 1]
               atStart:NO];
    });
  };
  post(0, NSEventTypeLeftMouseDown, start);
  for (int i = 1; i <= steps; i++)
    post(i * interval, NSEventTypeLeftMouseDragged, NSMakePoint(start.x + fx * i / steps, start.y + fy * i / steps));
  post(steps * interval + pause + 0.004, NSEventTypeLeftMouseUp, NSMakePoint(start.x + fx, start.y + fy));
}

- (NSString *)snapshot:(NSString *)name {
  NSWindow *window = _window;
  NSString *dir = [NSString stringWithUTF8String:getenv("ARDIA_DATA_DIR") ?: "/tmp"];
  NSView *content = ACWindowRootView(window);
  NSSize size = content.bounds.size;
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nil pixelsWide:size.width * 2 pixelsHigh:size.height * 2
                                                                bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
                                                               colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  CGContextRef cg = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep].CGContext;
  CGContextSetRGBFillColor(cg, 0.36, 0.42, 0.5, 1);
  CGContextFillRect(cg, CGRectMake(0, 0, size.width * 2, size.height * 2));
  CGContextScaleCTM(cg, 2, 2);
  if (content.isFlipped) CGContextTranslateCTM(cg, 0, size.height), CGContextScaleCTM(cg, 1, -1);
  [content.layer renderInContext:cg];
  NSString *path = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@"pip-%@.png", name]];
  [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path atomically:YES];
  return path;
}

- (void)runSelfTest {
  NSMutableArray *steps = [NSMutableArray array];
  NSWindow *window = _window;
  NSRect start = window.frame;
  auto outermost = [=](BOOL right) {
    NSScreen *pick = ScreenFor(start);
    for (NSScreen *screen in NSScreen.screens) {
      const NSRect f = screen.frame;
      if (NSMidY(start) < NSMinY(f) || NSMidY(start) >= NSMaxY(f)) continue;
      if (right ? NSMaxX(f) > NSMaxX(pick.frame) : NSMinX(f) < NSMinX(pick.frame)) pick = screen;
    }
    return pick.visibleFrame;
  };
  const NSRect visibleRight = outermost(YES), visibleLeft = outermost(NO);
  auto record = [=](NSString *name, BOOL pass, NSDictionary *extra) {
    NSMutableDictionary *step = [@{@"step" : name, @"pass" : @(pass), @"frame" : NSStringFromRect(window.frame)} mutableCopy];
    [step addEntriesFromDictionary:extra ?: @{}];
    [steps addObject:step];
    NSLog(@"[pip-selftest] %@ %@ %@", name, pass ? @"PASS" : @"FAIL", step);
  };
  NSString *dir = [NSString stringWithUTF8String:getenv("ARDIA_DATA_DIR") ?: "/tmp"];
  auto snapshot = [=](NSString *name) { [self snapshot:name]; };
  auto write = [=] {
    NSString *path = [dir stringByAppendingPathComponent:@"pip-selftest.json"];
    NSDictionary *result = @{@"windowNumber" : @(window.windowNumber), @"host" : self.host ?: @"", @"steps" : steps};
    [[NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil] writeToFile:path atomically:YES];
  };
  auto after = [](double seconds, dispatch_block_t block) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
  };
  auto rounded = [=] {
    CALayer *layer = window.contentView.layer;
    return layer.cornerRadius == kCornerRadius && layer.masksToBounds && !window.opaque && window.hasShadow &&
           self.overlay.layer.borderWidth == 1;
  };
  auto dragTo = [=](CGFloat x) {
    self->_sawDrag = YES;
    [window setFrameOrigin:NSMakePoint(x, NSMinY(window.frame))];
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
    [self settle];
  };

  record(@"attached", self.overlay.superview == ACWindowRootView(window) && [ACWindowRootView(window).subviews.lastObject isEqual:self.overlay],
         @{@"level" : @(window.level), @"keepOnTop" : @(self.keepOnTop), @"shadow" : @(window.hasShadow)});
  after(0.6, ^{
    record(@"nothing of ours at rest", self.overlay.handle.hidden && [self.overlay hitTest:NSMakePoint(20, 20)] == nil, nil);
    record(@"rounded corners", rounded(), @{
      @"cornerRadius" : @(window.contentView.layer.cornerRadius),
      @"masksToBounds" : @(window.contentView.layer.masksToBounds),
      @"opaque" : @(window.opaque),
      @"shadow" : @(window.hasShadow),
      @"rim" : @(self.overlay.layer.borderWidth),
    });
    snapshot(@"rest");
    dragTo(NSMaxX(visibleRight) - NSWidth(window.frame) * 0.3);
  });
  after(2.2, ^{
    record(@"drag past right edge stashes", self.stashedEdge == ACPiPEdgeRight &&
                                                 fabs(NSMinX(window.frame) - (NSMaxX(visibleRight) - kPeek)) < 0.5 &&
                                                 !self.overlay.handle.hidden && self.overlay.handle.alphaValue > 0.99,
           @{@"handle" : NSStringFromRect(self.overlay.handle.frame)});
    snapshot(@"stashed-right");
    [window setFrameOrigin:NSMakePoint(NSMaxX(visibleRight) - NSWidth(window.frame) - 40, NSMinY(window.frame))];
  });
  after(3.4, ^{
    record(@"Chrome's move re-stashes", self.stashedEdge == ACPiPEdgeRight && fabs(NSMinX(window.frame) - (NSMaxX(visibleRight) - kPeek)) < 0.5, nil);
    self.overlay.handle.onClick();
  });
  after(4.6, ^{
    record(@"handle click brings it back", self.stashedEdge == ACPiPEdgeNone && self.overlay.handle.hidden &&
                                                fabs(NSMaxX(window.frame) - (NSMaxX(visibleRight) - kReturnMargin)) < 0.5,
           nil);
    dragTo(NSMinX(visibleLeft) - NSWidth(window.frame) * 0.7);
  });
  after(5.8, ^{
    record(@"drag past left edge stashes", self.stashedEdge == ACPiPEdgeLeft &&
                                                fabs(NSMaxX(window.frame) - (NSMinX(visibleLeft) + kPeek)) < 0.5 &&
                                                NSMinX(self.overlay.handle.frame) == NSWidth(self.overlay.bounds) - kPeek,
           @{@"handle" : NSStringFromRect(self.overlay.handle.frame)});
    snapshot(@"stashed-left");
    dragTo(NSMinX(visibleLeft) + 100);
  });
  after(7.0, ^{
    record(@"drag out of the stash", self.stashedEdge == ACPiPEdgeNone && fabs(NSMinX(window.frame) - (NSMinX(visibleLeft) + 100)) < 0.5, nil);
    NSArray *saved = [NSArray arrayWithContentsOfFile:[dir stringByAppendingPathComponent:@"Chromium/ArdiaPictureInPicture.plist"]];
    NSRect frame = window.frame;
    CGFloat top = NSMaxY(NSScreen.screens.firstObject.frame) - NSMaxY(frame);
    record(@"Chrome remembers where it was left",
           saved.count == 4 && [saved[0] intValue] == (int)NSMinX(frame) && [saved[1] intValue] == (int)top &&
               [saved[2] intValue] == (int)NSWidth(frame) && [saved[3] intValue] == (int)NSHeight(frame),
           @{@"saved" : saved ?: @[]});
    NSMenu *menu = [self menu];
    BOOL onBefore = [menu itemWithTitle:@"Keep Window on Top"].state == NSControlStateValueOn;
    [self toggleKeepOnTop:nil];
    BOOL off = window.level == NSNormalWindowLevel && [[self menu] itemWithTitle:@"Keep Window on Top"].state == NSControlStateValueOff;
    [self toggleKeepOnTop:nil];
    record(@"Keep Window on Top toggles", onBefore && off && window.level == NSFloatingWindowLevel,
           @{@"menu" : [[self menu].itemArray valueForKey:@"title"]});
    [window setFrame:NSInsetRect(start, 40, 22.5) display:YES];
  });
  after(7.6, ^{
    record(@"still rounded after a resize", rounded(), nil);
    [window setFrame:start display:YES];
  });
  after(8.2, ^{
    record(@"menu: Back to Tab", self.view != nil, nil);
    [self backToTab];
  });
  after(9.7, ^{
    record(@"PiP closed after Back to Tab", !window.visible, nil);
    write();
  });
}

- (void)runButtonSelfTest:(NSString *)button {
  NSWindow *window = _window;
  NSString *dir = [NSString stringWithUTF8String:getenv("ARDIA_DATA_DIR") ?: "/tmp"];
  CGFloat center = kButtonMargin + kButtonSize / 2;
  NSPoint point = NSMakePoint([button isEqual:@"close"] ? NSWidth(window.frame) - center : center, NSHeight(window.frame) - center);
  auto event = [=](NSEventType type) {
    return [NSEvent mouseEventWithType:type location:point modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                          windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:type == NSEventTypeLeftMouseDown];
  };
  auto after = [](double seconds, dispatch_block_t block) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
  };
  after(1.5, ^{ [window.contentView mouseMoved:event(NSEventTypeMouseMoved)]; });
  after(2.1, ^{
    const BOOL prevents = PreventsActivation(window);
    const NSInteger activations = gActivations;
    [NSApp postEvent:event(NSEventTypeLeftMouseDown) atStart:NO];
    [NSApp postEvent:event(NSEventTypeLeftMouseUp) atStart:NO];
    after(1, ^{
      NSDictionary *result = @{
        @"button" : button,
        @"closed" : @(!window.visible),
        @"point" : NSStringFromPoint(point),
        @"preventsActivation" : @(prevents),
        @"activations" : @(gActivations - activations),
        @"appActive" : @(NSApp.isActive),
      };
      NSLog(@"[pip-selftest] %@", result);
      [[NSJSONSerialization dataWithJSONObject:result options:0 error:nil]
          writeToFile:[dir stringByAppendingPathComponent:@"pip-button-selftest.json"]
           atomically:YES];
    });
  });
}

- (void)runHoverSelfTest {
  NSWindow *window = _window;
  NSString *dir = [NSString stringWithUTF8String:getenv("ARDIA_DATA_DIR") ?: "/tmp"];
  NSString *where = NSProcessInfo.processInfo.environment[@"ARDIA_PIP_HOVER"];
  CGFloat center = kButtonMargin + kButtonSize / 2;
  NSSize size = window.frame.size;
  NSPoint point = [where isEqual:@"close"]  ? NSMakePoint(size.width - center, size.height - center)
                  : [where isEqual:@"back"] ? NSMakePoint(center, size.height - center)
                                            : NSMakePoint(size.width / 2, size.height * 0.7);
  __weak NSWindow *weakWindow = window;
  NSTimer *timer = [NSTimer timerWithTimeInterval:1 repeats:YES block:^(NSTimer *t) {
    NSWindow *strongWindow = weakWindow;
    if (!strongWindow.visible) return [t invalidate];
    NSEvent *move = [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:point modifierFlags:0
                                      timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:strongWindow.windowNumber
                                        context:nil eventNumber:0 clickCount:0 pressure:0];
    [strongWindow.contentView mouseMoved:move];
  }];
  [NSRunLoop.currentRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
  NSDictionary *result = @{
    @"windowNumber" : @(window.windowNumber),
    @"frame" : NSStringFromRect(window.frame),
    @"hover" : where ?: @"video",
    @"cornerRadius" : @(window.contentView.layer.cornerRadius),
    @"masksToBounds" : @(window.contentView.layer.masksToBounds),
    @"opaque" : @(window.opaque),
  };
  [[NSJSONSerialization dataWithJSONObject:result options:0 error:nil] writeToFile:[dir stringByAppendingPathComponent:@"pip-hover.json"]
                                                                       atomically:YES];
}

@end


@interface ACPiPZoom : NSObject
+ (BOOL)handle:(NSEvent *)event;
@end

@implementation ACPiPZoom {
  __weak NSWindow *_window;
  NSRect _last;
  double _width;
  double _aspect;
  double _target;
  NSPoint _pointer;
  NSTimer *_ease;
}

+ (BOOL)zooms:(NSWindow *)window {
  if (!window.visible || !(window.styleMask & NSWindowStyleMaskResizable)) return NO;
  ACPiPController *controller = [ACPiPController forWindow:window];
  if (controller) return controller.stashedEdge == ACPiPEdgeNone;
  return IsChromeDocumentPictureInPicture(window) && IsChromeFloatingWindow(window);
}

+ (instancetype)forWindow:(NSWindow *)window {
  ACPiPZoom *zoom = objc_getAssociatedObject(window, kZoomKey);
  if (!zoom) {
    zoom = [[ACPiPZoom alloc] init];
    zoom->_window = window;
    objc_setAssociatedObject(window, kZoomKey, zoom, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return zoom;
}

static __weak NSWindow *gZoomGesture;

+ (BOOL)handle:(NSEvent *)event {
  BOOL handled = [self route:event];
  static BOOL trace = getenv("ARDIA_PIP_ZOOM_TRACE") != nullptr;
  if (trace)
    NSLog(@"[pip-zoom] type %lu window %ld (%@) cmd %d phase %lu/%lu dy %.2f precise %d mag %.3f -> %@ %@", (unsigned long)event.type,
          (long)event.windowNumber, event.window.className, (event.modifierFlags & NSEventModifierFlagCommand) != 0,
          (unsigned long)(event.type == NSEventTypeScrollWheel ? event.phase : 0),
          (unsigned long)(event.type == NSEventTypeScrollWheel ? event.momentumPhase : 0),
          event.type == NSEventTypeScrollWheel ? event.scrollingDeltaY : 0,
          event.type == NSEventTypeScrollWheel ? event.hasPreciseScrollingDeltas : 0,
          event.type == NSEventTypeMagnify ? event.magnification : 0, handled ? @"zoomed" : @"passed",
          NSStringFromRect(event.window.frame));
  return handled;
}

+ (NSWindow *)windowFor:(NSEvent *)event {
  if (event.window) return event.window;
  NSPoint point = event.locationInWindow;
  for (NSWindow *window in NSApp.orderedWindows)
    if (NSPointInRect(point, window.frame) && [self zooms:window]) return window;
  return nil;
}

+ (BOOL)route:(NSEvent *)event {
  NSWindow *window = [self windowFor:event];
  BOOL command = (event.modifierFlags & NSEventModifierFlagCommand) != 0;
  BOOL scroll = event.type == NSEventTypeScrollWheel;
  if (scroll) {
    NSEventPhase phase = event.phase, momentum = event.momentumPhase;
    BOOL wheel = phase == NSEventPhaseNone && momentum == NSEventPhaseNone;
    if (wheel || (phase & (NSEventPhaseBegan | NSEventPhaseMayBegin))) gZoomGesture = nil;
    if (gZoomGesture) window = gZoomGesture;
    if (!window || (!command && gZoomGesture != window)) return NO;
    if (![self zooms:window] || ![self enabled]) return NO;
    if (!wheel) gZoomGesture = window;
    if (momentum & (NSEventPhaseEnded | NSEventPhaseCancelled)) gZoomGesture = nil;
    double dy = event.scrollingDeltaY;
    if (dy == 0) return YES;
    [[self forWindow:window] zoomBy:ardiacore_pip_zoom::ScrollFactor(dy, event.hasPreciseScrollingDeltas)
                                 at:[self screenPoint:event]
                               ease:!event.hasPreciseScrollingDeltas];
    return YES;
  }
  if (!window || ![self zooms:window] || ![self enabled]) return NO;
  [[self forWindow:window] zoomBy:ardiacore_pip_zoom::MagnifyFactor(event.magnification)
                               at:[self screenPoint:event]
                             ease:NO];
  return YES;
}

+ (NSPoint)screenPoint:(NSEvent *)event {
  return event.window ? [event.window convertPointToScreen:event.locationInWindow] : event.locationInWindow;
}

+ (BOOL)enabled {
  id value = [NSUserDefaults.standardUserDefaults objectForKey:kZoomDefault];
  return value ? [value boolValue] : YES;
}

- (void)zoomBy:(double)factor at:(NSPoint)pointer ease:(BOOL)ease {
  NSWindow *window = _window;
  [[ACPiPController forWindow:window] stopMotion];
  NSRect frame = window.frame;
  if (!NSEqualRects(frame, _last) || _width <= 0) {
    double aspect = NSWidth(frame) / MAX(NSHeight(frame), 1);
    if (!(_aspect > 0 && fabs(NSWidth(frame) / _aspect - NSHeight(frame)) <= 1)) _aspect = aspect;
    _width = NSWidth(frame), _target = 0;
    [_ease invalidate], _ease = nil;
  }
  _pointer = pointer;
  if (!ease) {
    [_ease invalidate], _ease = nil, _target = 0;
    return [self step:factor];
  }
  double low, high;
  ardiacore_pip_zoom::WidthLimits(_aspect, [self minSize], [self maxSize], [self visible], &low, &high);
  _target = MIN(MAX((_target > 0 ? _target : _width) * factor, low), high);
  if (_ease) return;
  __weak ACPiPZoom *weakSelf = self;
  _ease = [NSTimer timerWithTimeInterval:1.0 / 120 repeats:YES block:^(NSTimer *timer) {
    ACPiPZoom *strongSelf = weakSelf;
    if (!strongSelf || !strongSelf->_window.visible || !NSEqualRects(strongSelf->_window.frame, strongSelf->_last)) {
      if (strongSelf) strongSelf->_ease = nil, strongSelf->_target = 0;
      return [timer invalidate];
    }
    double width = strongSelf->_width, target = strongSelf->_target;
    BOOL done = fabs(target - width) < 0.25;
    [strongSelf step:(done ? target : width + (target - width) * 0.25) / width];
    if (!done) return;
    strongSelf->_ease = nil, strongSelf->_target = 0;
    [timer invalidate];
  }];
  [NSRunLoop.currentRunLoop addTimer:_ease forMode:NSRunLoopCommonModes];
  _last = frame;
}

- (ardiacore_pip_zoom::Size)minSize {
  NSSize size = _window.contentMinSize;
  return {size.width, size.height};
}

- (ardiacore_pip_zoom::Size)maxSize {
  NSSize size = _window.contentMaxSize;
  return {size.width > 0 ? size.width : CGFLOAT_MAX, size.height > 0 ? size.height : CGFLOAT_MAX};
}

- (ardiacore_pip_zoom::Rect)visible {
  NSRect visible = ScreenFor(_window.frame).visibleFrame;
  return {NSMinX(visible), NSMinY(visible), NSWidth(visible), NSHeight(visible)};
}

- (void)step:(double)factor {
  NSWindow *window = _window;
  NSRect frame = window.frame;
  ardiacore_pip_zoom::Result result = ardiacore_pip_zoom::Zoom(
      {NSMinX(frame), NSMinY(frame), NSWidth(frame), NSHeight(frame)}, _width, _aspect, factor, {_pointer.x, _pointer.y},
      [self visible], [self minSize], [self maxSize]);
  _width = result.width;
  NSRect next = NSMakeRect(result.frame.x, result.frame.y, result.frame.w, result.frame.h);
  if (!NSEqualRects(next, frame)) [window setFrame:next display:YES];
  _last = window.frame;
}

@end

namespace ardiacore_pip {

namespace {

void InstallMenuMonitor() {
  static id monitor;
  if (monitor) return;
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskRightMouseDown
                                                  handler:^NSEvent *(NSEvent *event) {
                                                    ACPiPController *controller =
                                                        event.window ? [ACPiPController forWindow:event.window] : nil;
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
  if (!window || ![ACPiPController forWindow:window] || event.clickCount > 1 || (event.modifierFlags & NSEventModifierFlagControl))
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
std::vector<ardiacore_pip_throw::Sample> gDragSamples;

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
                                       [ACPiPController abandonSwipeOn:window];
                                       [[ACPiPController forWindow:window] stopMotion];
                                       NSPoint mouse = ScreenLocation(event);
                                       gLastMouse = mouse;
                                       gGrabLocal = NSMakePoint(mouse.x - NSMinX(window.frame), mouse.y - NSMinY(window.frame));
                                       gDragHome = [[ACPiPController forWindow:window] gestureHome];
                                       gDragSamples.clear();
                                       SampleDrag(event, mouse);
                                       return nil;
                                     }
                                     NSWindow *window = gDragged;
                                     if (!window) return event;
                                     if (event.type == NSEventTypeLeftMouseUp) {
                                       gDragged = nil;
                                       const NSPoint grabbed = NSMakePoint(NSMinX(window.frame) + gGrabLocal.x, NSMinY(window.frame) + gGrabLocal.y);
                                       const auto velocity = ardiacore_pip_throw::ReleaseVelocity(
                                           gDragSamples.data(), (int)gDragSamples.size(), event.timestamp);
                                       gDragSamples.clear();
                                       [[ACPiPController forWindow:window] dragReleasedAt:grabbed
                                                                                 velocity:NSMakePoint(velocity.x, velocity.y)];
                                       return nil;
                                     }
                                     NSPoint mouse = ScreenLocation(event);
                                     SampleDrag(event, mouse);
                                     const auto screens = ThrowScreens();
                                     const auto next = ardiacore_pip_throw::DragStep(
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
                                                    return [ACPiPController handleSwipe:event] || [ACPiPZoom handle:event] ? nil : event;
                                                  }];
}

static __weak ArdiaCoreWebView *gPictureInPictureOwner;

NSWindow *PictureInPictureWindowFor(ArdiaCoreWebView *view) {
  NSWindow *claimedByOldOwner = nil;
  for (NSWindow *window in NSApp.windows) {
    ACPiPController *controller = [ACPiPController forWindow:window];
    if (!IsChromeVideoPictureInPicture(window) && !(controller && window.visible)) continue;
    if (!window.hasShadow) continue;
    if (!controller.view || controller.view == view) return window;
    if (!claimedByOldOwner) claimedByOldOwner = window;
  }
  return claimedByOldOwner;
}

bool Attach(ArdiaCoreWebView *view, NSString *host, NSString *frameId) {
  NSWindow *window = PictureInPictureWindowFor(view);
  if (!window) return false;
  ACPiPController *controller = [ACPiPController forWindow:window];
  BOOL fresh = !controller;
  if (fresh) controller = [[ACPiPController alloc] initWithWindow:window];
  controller.view = view;
  controller.host = host;
  [controller setVideoFrame:frameId];
  [controller roundCorners];
  PreventActivation(window);
  if (ardiacore_host::Background()) {
    window.alphaValue = 0;
    window.ignoresMouseEvents = YES;
  }
  InstallMenuMonitor();
  InstallDragMonitor();
  InstallZoomMonitor();
  NSString *selfTest = NSProcessInfo.processInfo.environment[@"ARDIA_PIP_SELFTEST"];
  if (fresh && [@[ @"close", @"backToTab" ] containsObject:selfTest]) [controller runButtonSelfTest:selfTest];
  else if (fresh && [selfTest isEqual:@"hover"]) [controller runHoverSelfTest];
  else if (fresh && selfTest) [controller runSelfTest];
  return true;
}

}

void WatchZoom() { InstallZoomMonitor(); }

void TabRequestedActivation(ArdiaCoreWebView *view) {
  for (NSWindow *window in NSApp.windows)
    if ([ACPiPController forWindow:window].view == view && window.visible && !window.hasShadow)
      return ActivateApp(@"Back to Tab (Chrome's button)");
}

void VideoChanged(ArdiaCoreWebView *view, NSString *host, NSString *frameId, bool active) {
  static NSMapTable<ArdiaCoreWebView *, NSNumber *> *searches = [NSMapTable weakToStrongObjectsMapTable];
  const NSInteger search = [searches objectForKey:view].integerValue + 1;
  [searches setObject:@(search) forKey:view];
  if (!active) {
    if (gPictureInPictureOwner == view) gPictureInPictureOwner = nil;
    return;
  }
  gPictureInPictureOwner = view;
  __block int tries = 0;
  __block void (^look)(void);
  __weak ArdiaCoreWebView *weakView = view;
  look = ^{
    ArdiaCoreWebView *strongView = weakView;
    if (!strongView || strongView != gPictureInPictureOwner || [searches objectForKey:strongView].integerValue != search ||
        Attach(strongView, host, frameId) || ++tries >= 20) {
      look = nil;
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 50 * NSEC_PER_MSEC), dispatch_get_main_queue(), look);
  };
  look();
}

}

@implementation ArdiaCoreWebView (PictureInPictureDev)

+ (NSArray<NSDictionary<NSString *, id> *> *)devPictureInPicture {
  NSMutableArray *list = [NSMutableArray array];
  for (NSWindow *window in NSApp.windows) {
    ACPiPController *controller = [ACPiPController forWindow:window];
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
  ACPiPController *controller = nil;
  for (NSWindow *window in NSApp.windows)
    if ([ACPiPController forWindow:window] && window.visible) controller = [ACPiPController forWindow:window];
  if (!controller) return @"";
  if ([action isEqual:@"selftest"]) [controller runSelfTest];
  else if ([@[ @"close", @"backToTab" ] containsObject:action]) [controller runButtonSelfTest:action];
  else if ([action isEqual:@"menu"]) return [[controller.menu.itemArray valueForKey:@"title"] componentsJoinedByString:@"|"];
  else if ([action hasPrefix:@"snapshot:"]) return [controller snapshot:[action substringFromIndex:9]];
  else if ([action hasPrefix:@"frame:"]) [controller.window setFrame:NSRectFromString([action substringFromIndex:6]) display:YES];
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
