#import "ArdiaWebViewInternal.h"
#import "ArdiaEarlyWindow.h"

#import <QuartzCore/QuartzCore.h>
#import <React/UIView+React.h>

using namespace ardia_web_view;

namespace {

constexpr CFTimeInterval kLeaveScreenDelay = 0.1;
constexpr CFTimeInterval kFirstFrameHoldSeconds = 0.25;
constexpr CFTimeInterval kHolderBackstopSeconds = kFirstFrameHoldSeconds + 0.05;
constexpr CFTimeInterval kLingeringPaneSunkSeconds = 0.5;
NSString *const kLingeringPane = @"ardia.lingeringPane";
}

@interface ArdiaNeighbourWake : NSObject
@property(nonatomic) CFTimeInterval committedUntil;
@property(nonatomic) CFTimeInterval speculativeUntil;
@property(nonatomic, readonly) CFTimeInterval until;
@end

@implementation ArdiaNeighbourWake
- (CFTimeInterval)until {
  return MAX(_committedUntil, _speculativeUntil);
}
@end

namespace {

NSMapTable<NSWindow *, ArdiaNeighbourWake *> *NeighbourPagesAwake() {
  static NSMapTable *windows = [NSMapTable weakToStrongObjectsMapTable];
  return windows;
}

NSHashTable<ArdiaWebView *> *PendingPainting() {
  static NSHashTable *views = [NSHashTable weakObjectsHashTable];
  return views;
}
bool gPaintingScheduled = false;

NSHashTable<ArdiaWebView *> *AwaitingFrames() {
  static NSHashTable *views = [NSHashTable weakObjectsHashTable];
  return views;
}
bool gFrameWatchScheduled = false;

NSView *RenderWidgetIn(NSView *page) {
  static Class widgetClass = NSClassFromString(@"RenderWidgetHostViewCocoa");
  if (!page || !widgetClass) return nil;
  NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:page];
  while (queue.count) {
    NSView *view = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if ([view isKindOfClass:widgetClass]) return view;
    [queue addObjectsFromArray:view.subviews];
  }
  return nil;
}

NSArray *FrameMarkOf(NSView *widget) {
  NSMutableArray *mark = [NSMutableArray array];
  for (CALayer *tree in widget.layer.sublayers)
    for (CALayer *content in tree.sublayers) {
      [mark addObject:content];
      [mark addObject:content.contents ?: NSNull.null];
    }
  return mark;
}

NSRect InWindow(NSView *view) {
  return [view convertRect:view.bounds toView:nil];
}

void WithoutActions(void (^block)(void)) {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  block();
  [CATransaction commit];
}

NSView *LingeringPaneOver(NSView *view) {
  for (NSView *ancestor = view.superview; ancestor; ancestor = ancestor.superview)
    for (NSView *sibling in ancestor.subviews)
      if ([sibling.nativeID isEqualToString:kLingeringPane] && !sibling.hidden) return sibling;
  return nil;
}

BOOL Above(NSView *a, NSView *b) {
  const CGFloat za = a.layer.zPosition, zb = b.layer.zPosition;
  if (za != zb) return za > zb;
  NSArray<NSView *> *order = a.superview.subviews;
  return [order indexOfObjectIdenticalTo:a] > [order indexOfObjectIdenticalTo:b];
}
}

@implementation ArdiaWebView (Painting)

- (void)setFrameSize:(NSSize)newSize {
  [super setFrameSize:newSize];
  [self layoutPage];
  if (_visible) [ArdiaEarlyWindow noteLayoutChangeIn:self.window];
}

- (void)setFrameOrigin:(NSPoint)newOrigin {
  [super setFrameOrigin:newOrigin];
  if (_visible) [ArdiaEarlyWindow noteLayoutChangeIn:self.window];
}

- (void)layoutPage {
  if (NSView *fronted = _frontedPage; fronted.superview == self) fronted.frame = self.bounds;
  if (NSView *standIn = _standInPage; standIn.superview == self) standIn.frame = self.bounds;
  NSView *page = _tab.view;
  if (!page || page.superview != self) return;
  if (_devtoolsView) {
    NSRect devtools = NSZeroRect, pageFrame = self.bounds;
    [_tab devToolsLayoutForSize:self.bounds.size devTools:&devtools page:&pageFrame];
    _devtoolsView.frame = devtools;
    page.frame = pageFrame;
  } else {
    page.frame = self.bounds;
  }
}

- (BOOL)paints {
  return _visible || (_warm && !self.neighbourPageAsleep) || _leaving || _revealed || _holding;
}

- (BOOL)neighbourPageAsleep {
  if (!_warm || !_neighbour || _visible) return NO;
  NSWindow *window = self.window;
  if (!window) return NO;
  return [NeighbourPagesAwake() objectForKey:window].until <= CACurrentMediaTime();
}

+ (void)wakeNeighbourPagesIn:(NSWindow *)window seconds:(CFTimeInterval)seconds committed:(BOOL)committed {
  const CFTimeInterval now = CACurrentMediaTime();
  ArdiaNeighbourWake *wake = [NeighbourPagesAwake() objectForKey:window];
  const BOOL wasAwake = wake.until > now;
  if (!wake) [NeighbourPagesAwake() setObject:(wake = [ArdiaNeighbourWake new]) forKey:window];
  if (committed) wake.committedUntil = MAX(wake.committedUntil, now + seconds);
  else wake.speculativeUntil = MAX(wake.speculativeUntil, now + seconds);
  if (wasAwake) return;
  [self repaintWarmPagesIn:window];
  [self sleepNeighbourPagesIn:window after:seconds];
}

+ (void)releaseNeighbourPagesIn:(NSWindow *)window {
  ArdiaNeighbourWake *wake = [NeighbourPagesAwake() objectForKey:window];
  const CFTimeInterval now = CACurrentMediaTime();
  if (!wake || wake.speculativeUntil <= now) return;
  wake.speculativeUntil = 0;
  if (wake.committedUntil <= now) [self repaintWarmPagesIn:window];
}

+ (void)sleepNeighbourPagesIn:(NSWindow *)window after:(CFTimeInterval)delay {
  __weak NSWindow *weakWindow = window;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSWindow *window = weakWindow;
    ArdiaNeighbourWake *wake = window ? [NeighbourPagesAwake() objectForKey:window] : nil;
    if (!wake) return;
    const CFTimeInterval left = wake.until - CACurrentMediaTime();
    if (left > 0) return [self sleepNeighbourPagesIn:window after:left];
    [NeighbourPagesAwake() removeObjectForKey:window];
    [self repaintWarmPagesIn:window];
  });
}

+ (void)repaintWarmPagesIn:(NSWindow *)window {
  for (ArdiaWebView *view in LiveViews().allObjects)
    if (view->_warm && view.window == window) [view schedulePainting];
}

- (void)holdLittlePage {
  NSView *page = _tab.view;
  if (_littlePageHeld || _littlePageSettled || !page || page.superview != self ||
      ![self.window.identifier isEqualToString:@"ardia.window.small"])
    return;
  _littlePageHeld = YES;
  page.wantsLayer = YES;
  _littlePageOpacity = page.layer.opacity;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  page.layer.opacity = 0;
  [CATransaction commit];
  [self callFrame:@"" kind:@"firstPaint" json:@"{}"];
  const NSUInteger generation = ++_littlePageGeneration;
  __weak ArdiaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(4 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (view && view->_littlePageGeneration == generation) [view revealLittlePage:YES];
  });
}

- (void)revealLittlePage:(BOOL)animated {
  if (!_littlePageHeld) return;
  _littlePageHeld = NO;
  _littlePageSettled = YES;
  _littlePageGeneration++;
  CALayer *layer = _tab.view.layer;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  layer.opacity = _littlePageOpacity;
  if (animated) {
    CABasicAnimation *fade = [CABasicAnimation animationWithKeyPath:@"opacity"];
    fade.fromValue = @0;
    fade.toValue = @(_littlePageOpacity);
    fade.duration = 0.16;
    fade.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.23 :1 :0.32 :1];
    [layer addAnimation:fade forKey:@"ardia.little.page"];
  }
  [CATransaction commit];
}

- (void)applyPainting {
  if (_awaitingFrame && !_visible && !_revealed) [self finishFrameHold];
  if (_visible) [self sinkLingeringPane];
  if (_visible) [self takeFocusFromLingeringPane];
  [self beginFrameHoldIfCold];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  self.alphaValue = _awaitingFrame && (_standInPage.superview != self || _standInLeaving) ? 0 : _visible || _revealed || _holding || !(_warm || _leaving) ? 1 : 0;
  const BOOL shown = self.paints;
  for (NSView *sub in self.subviews) {
    sub.hidden = !shown;
    AcceptDrops(sub, _visible);
  }
  [CATransaction commit];
  if (TraceVisibility())
    NSLog(@"[ardiacore-vis] %@ paint visible=%d warm=%d tab=%d page=%@ inWindow=%ld hiddenAncestor=%d", _transferKey,
          _visible, _warm, _tab ? (int)_tab.tabId : -1, _tab.view.superview == self ? @"here" : @"elsewhere",
          (long)self.window.windowNumber, _tab.view.isHiddenOrHasHiddenAncestor);
}

+ (void)noteShown:(ArdiaCoreTab *)tab {
  if (!tab) return;
  static NSMapTable<ArdiaCoreTab *, NSNumber *> *changes = [NSMapTable weakToStrongObjectsMapTable];
  const NSUInteger change = [changes objectForKey:tab].unsignedIntegerValue + 1;
  [changes setObject:@(change) forKey:tab];
  ArdiaWebView *view = [ArdiaTabRegistry viewForTab:tab];
  if (view.seenByUser) return [tab noteShownByHost:YES];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    if ([changes objectForKey:tab].unsignedIntegerValue != change) return;
    ArdiaWebView *now = [ArdiaTabRegistry viewForTab:tab];
    if (!now.seenByUser) [tab noteShownByHost:NO];
  });
}

- (void)markTemporary {
  if (_tab.temporary != _temporary) _tab.temporary = _temporary;
  ArdiaCoreTab *source = nil;
  if (_temporary && _temporarySource.length)
    for (ArdiaWebView *view in LiveViews().allObjects)
      if ([view.transferKey isEqualToString:_temporarySource]) source = view->_tab;
  [_tab setTemporarySource:source];
}

- (BOOL)seenByUser {
  return _visible && [ArdiaWindowController userSees:self.window];
}

- (void)userSightChanged {
  if (_tab) [ArdiaWebView noteShown:_tab];
  const BOOL seen = self.seenByUser;
  if (seen == _seenByUser) return;
  _seenByUser = seen;
  [self traceAutoPictureInPicture:seen ? @"app: the user sees the tab" : @"app: the user left the tab"];
  [self updateAutoPictureInPicture];
}

- (void)schedulePainting {
  [PendingPainting() addObject:self];
  if (gPaintingScheduled) return;
  gPaintingScheduled = true;
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(nil, kCFRunLoopBeforeWaiting | kCFRunLoopExit, false, 0, ^(CFRunLoopObserverRef, CFRunLoopActivity) {
    [ArdiaWebView drainPainting];
  });
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  CFRelease(observer);
}

+ (void)drainPainting {
  gPaintingScheduled = false;
  NSArray<ArdiaWebView *> *views = PendingPainting().allObjects;
  [PendingPainting() removeAllObjects];
  for (ArdiaWebView *view in views)
    if (view->_visible) [view beginFrameHoldIfCold];
  for (ArdiaWebView *view in views) {
    if (view->_visible) continue;
    [view leaveScreen];
    [view applyPainting];
  }
  for (ArdiaWebView *view in views)
    if (view->_visible) [view applyPainting];
  for (ArdiaWebView *view in views)
    if (view->_visible) [view restoreFocusIfDue];
}

- (void)leaveScreen {
  const NSUInteger generation = ++_leaveGeneration;
  NSView *page = _tab.view;
  const BOOL shown = !_visible && !_warm && !_revealed && page.superview == self && !page.hidden && self.alphaValue > 0;
  [self stopHolding];
  if (ArdiaWebView *awaited = shown ? [self awaitedOver] : nil) {
    _leaving = NO;
    return [self holdFor:awaited];
  }
  _leaving = shown;
  if (!_leaving) return;
  __weak ArdiaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLeaveScreenDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (!view || view->_leaveGeneration != generation) return;
    view->_leaving = NO;
    [view schedulePainting];
  });
}

- (BOOL)sharesScreenWith:(ArdiaWebView *)other {
  return other != self && other.window == self.window && [other->_profile isEqualToString:_profile] &&
         NSEqualRects(InWindow(other), InWindow(self));
}

- (BOOL)showsPageFor:(ArdiaWebView *)incoming {
  NSView *page = _tab.view;
  return [self sharesScreenWith:incoming] && page.superview == self && !page.hidden && !_awaitingFrame &&
         self.alphaValue > 0 && !self.isHiddenOrHasHiddenAncestor;
}

- (void)beginFrameHoldIfCold {
  NSView *page = _tab.view;
  NSWindow *window = self.window;
  if (_awaitingFrame || _standalone || !window || page.superview != self || !page.hidden || !(_visible || _revealed) ||
      [window.identifier isEqualToString:@"ardia.window.small"])
    return;
  if (NSIsEmptyRect(InWindow(self))) return;
  ArdiaWebView *outgoing = nil;
  for (ArdiaWebView *other in LiveViews().allObjects)
    if ([other showsPageFor:self]) outgoing = other;
  NSView *lingering = outgoing || !_visible ? nil : LingeringPaneOver(self);
  NSView *widget = outgoing || lingering ? RenderWidgetIn(page) : nil;
  if (!widget.hidden) return;
  _awaitingFrame = YES;
  _tookOverFrom = outgoing;
  _tookOverAt = CACurrentMediaTime();
  _frameMark = FrameMarkOf(widget);
  const NSUInteger generation = ++_frameHoldGeneration;
  [AwaitingFrames() addObject:self];
  [ArdiaWebView watchFrames];
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ waits for its first frame over %@", _transferKey, outgoing ? outgoing->_transferKey : @"a lingering pane");
  __weak ArdiaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kFirstFrameHoldSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (view && view->_awaitingFrame && view->_frameHoldGeneration == generation) [view frameShown:NO];
  });
}

+ (void)watchFrames {
  if (gFrameWatchScheduled) return;
  gFrameWatchScheduled = true;
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(nil, kCFRunLoopBeforeWaiting, true, 0, ^(CFRunLoopObserverRef watching, CFRunLoopActivity) {
    [ArdiaWebView checkFrames];
    if (AwaitingFrames().count) return;
    CFRunLoopObserverInvalidate(watching);
    gFrameWatchScheduled = false;
  });
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  CFRelease(observer);
}

+ (void)checkFrames {
  for (ArdiaWebView *view in AwaitingFrames().allObjects) {
    if (!view->_awaitingFrame) {
      [AwaitingFrames() removeObject:view];
      continue;
    }
    NSView *widget = RenderWidgetIn(view->_tab.view);
    if (!widget || ![FrameMarkOf(widget) isEqualToArray:view->_frameMark]) [view frameShown:YES];
  }
}

- (void)frameShown:(BOOL)drawn {
  if (!_awaitingFrame) return;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ first frame %@", _transferKey, drawn ? @"drawn" : @"late, shown anyway");
  WithoutActions(^{
    [self finishFrameHold];
    [self applyPainting];
  });
}

- (void)finishFrameHold {
  [self dropStandIn];
  if (!_awaitingFrame) return;
  _awaitingFrame = NO;
  _frameMark = nil;
  _frameHoldGeneration++;
  [AwaitingFrames() removeObject:self];
  if (NSView *pane = _framePane) pane.layer.zPosition = _framePaneZ;
  _framePane = nil;
  for (ArdiaWebView *view in LiveViews().allObjects)
    if (view->_holding && view->_holdingFor == self) [view releaseHold];
}

- (ArdiaWebView *)awaitedOver {
  if (!self.window) return nil;
  for (ArdiaWebView *other in AwaitingFrames().allObjects)
    if (other->_awaitingFrame && [self sharesScreenWith:other]) return other;
  return nil;
}

- (void)holdFor:(ArdiaWebView *)awaited {
  _holding = YES;
  _holdingFor = awaited;
  const NSUInteger generation = ++_holdGeneration;
  [awaited keepPaneBelow:self];
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ keeps its page up for %@", _transferKey, awaited->_transferKey);
  __weak ArdiaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kHolderBackstopSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (!view || !view->_holding || view->_holdGeneration != generation) return;
    WithoutActions(^{
      [view releaseHold];
    });
  });
}

- (void)stopHolding {
  _holding = NO;
  _holdingFor = nil;
  _holdGeneration++;
}

- (void)releaseHold {
  [self stopHolding];
  [self leaveScreen];
  [self applyPainting];
}

- (void)takeFocusFromLingeringPane {
  NSWindow *window = self.window;
  NSResponder *responder = window.firstResponder;
  NSView *focused = [responder isKindOfClass:NSView.class] ? (NSView *)responder : nil;
  NSView *lingering = focused ? LingeringPaneOver(self) : nil;
  if (!lingering || ![focused isDescendantOf:lingering]) return;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ takes focus from the lingering New Tab pane", _transferKey);
  [window makeFirstResponder:nil];
}

- (void)sinkLingeringPane {
  NSView *lingering = LingeringPaneOver(self);
  NSView *mine = lingering ? PaneUnder(self, lingering.superview) : nil;
  if (!mine || mine == lingering || !mine.layer || !lingering.layer || !Above(lingering, mine)) return;
  const CGFloat was = lingering.layer.zPosition, sunk = mine.layer.zPosition - 1;
  WithoutActions(^{
    lingering.layer.zPosition = sunk;
  });
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ shows over the lingering New Tab pane", _transferKey);
  __weak NSView *weakPane = lingering;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLingeringPaneSunkSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSView *pane = weakPane;
    if (pane.layer.zPosition == sunk) pane.layer.zPosition = was;
  });
}

- (void)keepPaneBelow:(ArdiaWebView *)held {
  NSView *shared = SharedAncestor(self, held);
  NSView *mine = PaneUnder(self, shared);
  NSView *theirs = PaneUnder(held, shared);
  if (!shared || !mine || !theirs || mine == theirs || !mine.layer || !theirs.layer) return;
  const CGFloat below = theirs.layer.zPosition;
  NSArray<NSView *> *order = shared.subviews;
  const BOOL above = mine.layer.zPosition > below ||
                     (mine.layer.zPosition == below && [order indexOfObjectIdenticalTo:mine] > [order indexOfObjectIdenticalTo:theirs]);
  if (!above) return;
  if (_framePane != mine) {
    if (NSView *previous = _framePane) previous.layer.zPosition = _framePaneZ;
    _framePane = mine;
    _framePaneZ = mine.layer.zPosition;
  }
  WithoutActions(^{
    mine.layer.zPosition = below - 1;
  });
}

@end
