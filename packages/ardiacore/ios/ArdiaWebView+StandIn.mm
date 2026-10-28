#import "ArdiaWebViewInternal.h"

#import <QuartzCore/QuartzCore.h>

using namespace ardia_web_view;

namespace {

constexpr CFTimeInterval kStandInTeardownDelay = 0.1;
constexpr CFTimeInterval kTakeOverLendSeconds = 1;

void WithoutActions(void (^block)(void)) {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  block();
  [CATransaction commit];
}
}

@implementation ArdiaWebView (StandIn)

- (void)lendPageToSuccessor {
  NSView *page = _tab.view;
  if (!page || _standalone || _devtoolsView || page.superview != self || page.hidden || self.alphaValue <= 0 ||
      self.isHiddenOrHasHiddenAncestor)
    return;
  ArdiaWebView *holder = nil;
  const CFTimeInterval now = CACurrentMediaTime();
  for (ArdiaWebView *other in LiveViews().allObjects)
    if (other->_tookOverFrom == self && now - other->_tookOverAt < kTakeOverLendSeconds && (other->_visible || other->_revealed))
      holder = other;
  if (!holder) return;
  NSView *holderPage = holder->_tab.view;
  if (holder->_standInPage || !holder.window || holder.window != self.window || holderPage.superview != holder) return;
  const BOOL covers = holder->_awaitingFrame;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ lends its page to %@ until it draws", _transferKey, holder->_transferKey);
  NSWindow *window = self.window;
  NSResponder *responder = window.firstResponder;
  if ([responder isKindOfClass:NSView.class] && [(NSView *)responder isDescendantOf:page]) [window makeFirstResponder:nil];
  _lentTo = holder;
  holder->_standInPage = page;
  holder->_standInTab = _tab;
  holder->_standInLender = self;
  holder->_standInCloses = NO;
  WithoutActions(^{
    page.frame = holder.bounds;
    if (covers) [holder addSubview:page positioned:NSWindowAbove relativeTo:nil];
    else [holder addSubview:page positioned:NSWindowBelow relativeTo:holderPage];
    if (covers) holder.alphaValue = 1;
  });
  if (covers) return;
  __weak ArdiaWebView *weakHolder = holder;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kStandInTeardownDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakHolder;
    if (view && view->_standInPage == page && !view->_awaitingFrame) [view dropStandIn];
  });
}

- (void)reclaimLentPage {
  NSView *page = _tab.view;
  ArdiaWebView *holder = _lentTo;
  if (!page || !self.window || (!holder && page.superview)) return;
  _lentTo = nil;
  if (holder && holder->_standInPage == page) [holder cancelStandIn];
  if (page.superview == self) return;
  if (page.window != self.window) [page removeFromSuperview];
  WithoutActions(^{
    [self addSubview:page];
  });
  [self layoutPage];
  [self applyPainting];
}

- (void)clearStandIn {
  ArdiaWebView *lender = _standInLender;
  if (lender && lender->_lentTo == self) lender->_lentTo = nil;
  _standInPage = nil;
  _standInTab = nil;
  _standInLender = nil;
  _standInCloses = NO;
  _standInLeaving = NO;
  _standInGeneration++;
}

- (void)cancelStandIn {
  NSView *page = _standInPage;
  const BOOL leaving = _standInLeaving;
  const float opacity = _standInOpacity;
  [self clearStandIn];
  WithoutActions(^{
    if (leaving && page.layer.opacity == 0) page.layer.opacity = opacity;
  });
  [self applyPainting];
}

- (BOOL)closesLentTab:(ArdiaCoreTab *)tab {
  if (!tab || _standInTab != tab || _standInPage.superview != self) return NO;
  _standInCloses = YES;
  return YES;
}

- (void)dropStandIn {
  if ((!_standInTab && !_standInPage) || _standInLeaving) return;
  NSView *page = _standInPage;
  if (page.superview != self) return [self finishStandIn];
  _standInLeaving = YES;
  _standInOpacity = page.layer.opacity;
  WithoutActions(^{
    page.layer.opacity = 0;
  });
  const NSUInteger generation = ++_standInGeneration;
  const void *holder = (__bridge const void *)self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kStandInTeardownDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    for (ArdiaWebView *view in LiveViews().allObjects)
      if ((__bridge const void *)view == holder && view->_standInLeaving && view->_standInGeneration == generation) return [view finishStandIn];
  });
}

- (void)finishStandIn {
  if (!_standInTab && !_standInPage) return;
  NSView *page = _standInPage;
  ArdiaCoreTab *tab = _standInTab;
  const BOOL closes = _standInCloses, leaving = _standInLeaving;
  const float opacity = _standInOpacity;
  ArdiaWebView *lender = _standInLender;
  [self clearStandIn];
  WithoutActions(^{
    if (page.superview == self) [page removeFromSuperview];
    if (leaving && page.layer.opacity == 0) page.layer.opacity = opacity;
  });
  if (closes && !tab.closed) return [tab closeNow];
  if (lender && lender->_tab.view == page && lender.window && !page.superview) {
    [lender addSubview:page];
    [lender layoutPage];
    [lender applyPainting];
  }
}

- (NSView *)hitTest:(NSPoint)point {
  NSView *hit = [super hitTest:point];
  NSView *standIn = _standInPage;
  if (!hit || !standIn || standIn.superview != self || !(hit == standIn || [hit isDescendantOf:standIn])) return hit;
  const NSPoint local = [self convertPoint:point fromView:self.superview];
  for (NSView *sub in self.subviews.reverseObjectEnumerator) {
    if (sub == standIn || sub.hidden) continue;
    if (NSView *under = [sub hitTest:local]) return under;
  }
  return self;
}

@end
