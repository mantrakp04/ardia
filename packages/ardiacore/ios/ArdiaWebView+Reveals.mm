#import "ArdiaWebViewInternal.h"

using namespace ardia_web_view;

namespace {

constexpr CFTimeInterval kRevealBackstopSeconds = 5;

void OnMain(void (^block)(void)) {
  if (NSThread.isMainThread) block();
  else dispatch_async(dispatch_get_main_queue(), block);
}
}

@implementation ArdiaWebView (Reveals)

static ArdiaWebView *ViewForKey(NSString *key) {
  for (ArdiaWebView *view in LiveViews().allObjects)
    if (view->_tab && [view->_transferKey isEqualToString:key]) return view;
  return nil;
}

+ (void)revealTab:(NSString *)transferKey {
  if (!transferKey.length) return;
  NSString *key = [transferKey copy];
  OnMain(^{
    ArdiaWebView *view = ViewForKey(key);
    if (!view.window) return;
    [ArdiaWebView dropRevealsInWindow:view.window except:view];
    [view revealAhead];
  });
}

+ (void)dropTabReveals:(NSString *)transferKey {
  if (!transferKey.length) return;
  NSString *key = [transferKey copy];
  OnMain(^{
    ArdiaWebView *view = ViewForKey(key);
    if (view.window) [ArdiaWebView dropRevealsInWindow:view.window except:nil];
  });
}

+ (void)dropRevealsInWindow:(NSWindow *)window except:(ArdiaWebView *)keep {
  for (ArdiaWebView *other in LiveViews().allObjects) {
    if (other.window != window) continue;
    [other dropFront];
    if (other != keep) [other dropReveal];
  }
}

static NSView *PaneUnder(NSView *view, NSView *ancestor) {
  for (NSView *v = view; v; v = v.superview)
    if (v.superview == ancestor) return v;
  return nil;
}

static NSView *SharedAncestor(NSView *a, NSView *b) {
  NSHashTable<NSView *> *chain = [NSHashTable weakObjectsHashTable];
  for (NSView *v = a.superview; v; v = v.superview) [chain addObject:v];
  for (NSView *v = b.superview; v; v = v.superview)
    if ([chain containsObject:v]) return v;
  return nil;
}

+ (void)revealOffered:(NSString *)adoptId over:(NSString *)transferKey {
  if (!adoptId.length || !transferKey.length) return;
  NSString *offer = [adoptId copy], *key = [transferKey copy];
  OnMain(^{
    ArdiaWebView *view = ViewForKey(key);
    if (!view.window) return;
    [ArdiaWebView dropRevealsInWindow:view.window except:nil];
    ArdiaCoreTab *tab = [ArdiaTabRegistry offeredTab:offer];
    NSView *page = tab.view;
    if (TraceVisibility())
      NSLog(@"[ardiacore-vis] %@ front %@ offered=%d closed=%d superview=%@ adopted=%d", key, offer, tab != nil, tab.closed,
            page.superview.className, [ArdiaTabRegistry viewForTab:tab] != nil);
    if (!tab || tab.closed || !page || page.superview || [ArdiaTabRegistry viewForTab:tab]) return;
    [view frontPage:page profile:tab.profile];
  });
}

- (BOOL)onlyShownInWindow {
  NSWindow *window = self.window;
  if (!_visible || _warm || _revealed || _standalone || _closing || !window || self.alphaValue < 1 || self.isHiddenOrHasHiddenAncestor) return NO;
  for (ArdiaWebView *other in LiveViews().allObjects)
    if (other != self && other.window == window && (other->_visible || other->_warm || other->_revealed)) return NO;
  return YES;
}

- (void)frontPage:(NSView *)page profile:(ArdiaCoreProfile *)profile {
  NSView *mine = _tab.view;
  if (_frontedPage || _devtoolsView || !mine || mine.superview != self || mine.hidden || _tab.profile != profile || ![self onlyShownInWindow]) return;
  page.frame = self.bounds;
  page.hidden = NO;
  [self addSubview:page positioned:NSWindowAbove relativeTo:mine];
  _frontedPage = page;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ fronts a new tab's page", _transferKey);
  const NSUInteger generation = ++_frontGeneration;
  __weak ArdiaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRevealBackstopSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (view && view->_frontGeneration == generation) [view dropFront];
  });
}

- (void)dropFront {
  NSView *fronted = _frontedPage;
  _frontedPage = nil;
  _frontGeneration++;
  if (fronted.superview == self) [fronted removeFromSuperview];
}

- (void)revealAhead {
  NSWindow *window = self.window;
  NSView *page = _tab.view;
  if (_visible || _revealed || _warm || _standalone || _closing || !window || !page || page.superview != self) return;
  ArdiaWebView *shown = nil;
  for (ArdiaWebView *other in LiveViews().allObjects) {
    if (other == self || other.window != window) continue;
    if (other->_warm || other->_revealed) return;
    if (!other->_visible) continue;
    if (shown) return;
    shown = other;
  }
  if (!shown || shown.alphaValue < 1 || shown->_frontedPage) return;
  const NSRect mine = [self convertRect:self.bounds toView:nil];
  if (NSIsEmptyRect(mine) || !NSEqualRects(mine, [shown convertRect:shown.bounds toView:nil])) return;
  NSView *shared = SharedAncestor(self, shown);
  NSView *pane = PaneUnder(self, shared);
  NSView *shownPane = PaneUnder(shown, shared);
  if (!shared || !pane || !shownPane || !shownPane.layer || pane == shownPane || pane.isHiddenOrHasHiddenAncestor || pane.alphaValue < 1) return;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ revealed over %@", _transferKey, shown->_transferKey);
  _revealed = YES;
  _loweredPane = shownPane;
  _loweredPaneZ = shownPane.layer.zPosition;
  shownPane.layer.zPosition = _loweredPaneZ - 1;
  [self applyPainting];
  const NSUInteger generation = ++_revealGeneration;
  __weak ArdiaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRevealBackstopSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (view && view->_revealGeneration == generation && view->_revealed) [view dropReveal];
  });
}

- (void)endReveal {
  if (!_revealed) return;
  _revealed = NO;
  _revealGeneration++;
  if (NSView *pane = _loweredPane) pane.layer.zPosition = _loweredPaneZ;
  _loweredPane = nil;
}

- (void)dropReveal {
  if (!_revealed) return;
  [self endReveal];
  [self schedulePainting];
}

- (void)settleRevealsInWindow {
  [self endReveal];
  NSWindow *window = self.window;
  if (window) [ArdiaWebView dropRevealsInWindow:window except:self];
}

@end
