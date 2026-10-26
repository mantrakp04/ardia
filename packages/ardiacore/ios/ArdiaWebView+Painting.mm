#import "ArdiaWebViewInternal.h"
#import "ArdiaEarlyWindow.h"

#import <QuartzCore/QuartzCore.h>

using namespace ardia_web_view;

namespace {

constexpr CFTimeInterval kLeaveScreenDelay = 0.1;
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
  return _visible || (_warm && !self.neighbourPageAsleep) || _leaving || _revealed;
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
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  self.alphaValue = _visible || _revealed || !(_warm || _leaving) ? 1 : 0;
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
  _leaving = !_visible && !_warm && !_revealed && page.superview == self && !page.hidden && self.alphaValue > 0;
  if (!_leaving) return;
  __weak ArdiaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLeaveScreenDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (!view || view->_leaveGeneration != generation) return;
    view->_leaving = NO;
    [view schedulePainting];
  });
}

@end
