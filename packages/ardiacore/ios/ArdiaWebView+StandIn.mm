#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"

#import <QuartzCore/QuartzCore.h>

using namespace ardia_web_view;
using namespace ardia_runtime;

namespace {

constexpr CFTimeInterval kStandInTeardownDelay = 0.1;
constexpr CFTimeInterval kTakeOverLendSeconds = 1;

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
    if (other->_frameHold.tookOverFrom == self && now - other->_frameHold.tookOverAt < kTakeOverLendSeconds && (other->_visible || other->_reveal.active))
      holder = other;
  if (!holder) return;
  NSView *holderPage = holder->_tab.view;
  if (holder->_standIn.page || !holder.window || holder.window != self.window || holderPage.superview != holder) return;
  const BOOL covers = holder->_frameHold.awaiting;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ lends its page to %@ until it draws", _transferKey, holder->_transferKey);
  NSWindow *window = self.window;
  NSResponder *responder = window.firstResponder;
  if ([responder isKindOfClass:NSView.class] && [(NSView *)responder isDescendantOf:page]) [window makeFirstResponder:nil];
  _standIn.lentTo = holder;
  holder->_standIn.page = page;
  holder->_standIn.tab = _tab;
  holder->_standIn.lender = self;
  holder->_standIn.closes = NO;
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
    if (view && view->_standIn.page == page && !view->_frameHold.awaiting) [view dropStandIn];
  });
}

- (void)reclaimLentPage {
  NSView *page = _tab.view;
  ArdiaWebView *holder = _standIn.lentTo;
  if (!page || !self.window || (!holder && page.superview)) return;
  _standIn.lentTo = nil;
  if (holder && holder->_standIn.page == page) [holder cancelStandIn];
  if (page.superview == self) return;
  if (page.window != self.window) [page removeFromSuperview];
  WithoutActions(^{
    [self addSubview:page];
  });
  [self layoutPage];
  [self applyPainting];
}

- (void)clearStandIn {
  ArdiaWebView *lender = _standIn.lender;
  if (lender && lender->_standIn.lentTo == self) lender->_standIn.lentTo = nil;
  _standIn.page = nil;
  _standIn.tab = nil;
  _standIn.lender = nil;
  _standIn.closes = NO;
  _standIn.leaving = NO;
  _standIn.generation++;
}

- (void)cancelStandIn {
  NSView *page = _standIn.page;
  const BOOL leaving = _standIn.leaving;
  const float opacity = _standIn.opacity;
  [self clearStandIn];
  WithoutActions(^{
    if (leaving && page.layer.opacity == 0) page.layer.opacity = opacity;
  });
  [self applyPainting];
}

- (BOOL)closesLentTab:(ArdiaCoreTab *)tab {
  if (!tab || _standIn.tab != tab || _standIn.page.superview != self) return NO;
  _standIn.closes = YES;
  return YES;
}

- (void)dropStandIn {
  if ((!_standIn.tab && !_standIn.page) || _standIn.leaving) return;
  NSView *page = _standIn.page;
  if (page.superview != self) return [self finishStandIn];
  _standIn.leaving = YES;
  _standIn.opacity = page.layer.opacity;
  WithoutActions(^{
    page.layer.opacity = 0;
  });
  const NSUInteger generation = ++_standIn.generation;
  const void *holder = (__bridge const void *)self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kStandInTeardownDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    for (ArdiaWebView *view in LiveViews().allObjects)
      if ((__bridge const void *)view == holder && view->_standIn.leaving && view->_standIn.generation == generation) return [view finishStandIn];
  });
}

- (void)finishStandIn {
  if (!_standIn.tab && !_standIn.page) return;
  NSView *page = _standIn.page;
  ArdiaCoreTab *tab = _standIn.tab;
  const BOOL closes = _standIn.closes, leaving = _standIn.leaving;
  const float opacity = _standIn.opacity;
  ArdiaWebView *lender = _standIn.lender;
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
  NSView *standIn = _standIn.page;
  if (!hit || !standIn || standIn.superview != self || !(hit == standIn || [hit isDescendantOf:standIn])) return hit;
  const NSPoint local = [self convertPoint:point fromView:self.superview];
  for (NSView *sub in self.subviews.reverseObjectEnumerator) {
    if (sub == standIn || sub.hidden) continue;
    if (NSView *under = [sub hitTest:local]) return under;
  }
  return self;
}

@end
