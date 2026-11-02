#import "ArdiaWebViewInternal.h"
#import "ArdiaEarlyWindow.h"

#import <objc/runtime.h>

using namespace ardia_web_view;

namespace {

const char kPageReportsKey = 0;
}

@interface ArdiaStashedPageReports : NSObject {
 @public
  NSString *url;
  ArdiaPageReports reports;
}
@end

@implementation ArdiaStashedPageReports
@end

@implementation ArdiaWebView (Tab)

- (void)adoptIntoWindow {
  if (_standalone) return;
  ArdiaWindowController *controller = self.controller;
  if (!controller.coreWindow) return;
  if ([[controller.coreWindow tabsForProfile:_tab.profile] containsObject:_tab]) return;
  ArdiaWindowController *source = [ArdiaWindowController holding:_tab];
  _life.moving = YES;
  controller.hostChanges++;
  source.hostChanges++;
  [controller.coreWindow adoptTab:_tab];
  source.hostChanges--;
  controller.hostChanges--;
  _life.moving = NO;
  if (_tabIndex >= 0) [self placeTab];
}

- (void)attach:(ArdiaCoreTab *)tab {
  NSAssert(_life.canAttach(_tab != nil), @"a closed view, or one that has a tab, was given another tab");
  if (!_life.canAttach(_tab != nil)) return;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ attach tab=%d visible=%d", _transferKey, (int)tab.tabId, _visible);
  const BOOL shownEarly = [ArdiaEarlyWindow holdsPage:tab];
  [LiveViews() addObject:self];
  InstallControlPressMonitor();
  _tab = tab;
  _life.attached();
  tab.delegate = self;
  [ArdiaTabRegistry setView:self forTab:tab];
  [self markTemporary];
  [self pushPeekModifier];
  [self pushSelectionPopover];
  [self bindRestoreKey];
  [self takePageReports];
  [tab deliverHeldPageMessages];
  [self userSightChanged];
  [self adoptIntoWindow];
  NSView *page = tab.view;
  if (page.superview != self) {
    if (!page.window || page.window != self.window) [page removeFromSuperview];
    [self addSubview:page];
    [ArdiaEarlyWindow pageMoved:tab];
  }
  if (NSView *devtools = tab.devToolsView) [self devToolsChanged:devtools];
  [self layoutPage];
  [self applyPainting];
  if (!shownEarly && (_life.creatingURL.length || tab.loading)) [self holdLittlePage];
  if (_muted) tab.muted = YES;
  if (_pageBackgroundColor) tab.pageBackgroundColor = _pageBackgroundColor;
  if (_contentsBackgroundColor) tab.contentsBackgroundColor = _contentsBackgroundColor;
  if (_pageColor) tab.pageColor = _pageColor;
  if (_life.pendingURL) {
    [self loadNow:_life.pendingURL userInitiated:_life.pendingUserInitiated];
    _life.pendingURL = nil;
  }
  [self emit:@"ready" payload:@{}];
  ardia_host::ReleaseHeldEvents(tab);
  [self emitNavigation];
  if (_extensionHost.length && tab && tab.preferredSize.width > 0)
    [self tab:tab preferredSizeDidChange:tab.preferredSize];
  [self emitMedia];
  [self tabDidChangeFavicon:tab];
  if (_tabIndex >= 0) [self placeTab];
  if (ArdiaWindowController *controller = self.controller)
    [ArdiaTabStrip changedInWindow:controller profile:tab.profile cause:NSNull.null];
}

- (void)detach {
  if (!_tab) return;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ detach tab=%d", _transferKey, (int)_tab.tabId);
  [self revealLittlePage:NO];
  if (_tab.delegate == self) _tab.delegate = nil;
  [ArdiaTabRegistry setView:nil forTab:_tab];
  [ArdiaWebView noteShown:_tab];
  [self stashPageReports];
  AcceptDrops(_tab.view, YES);
  if (_tab.view.superview == self) [_tab.view removeFromSuperview];
  [self dropDevTools];
  [self resetBlocked:NO];
  [self endReveal];
  [self dropFront];
  [self finishFrameHold];
  [self finishStandIn];
  [self stopHolding];
  _standIn.lentTo = nil;
  _tab = nil;
  _life.detached();
  _focus.onActivate = NO;
  _focus.page = ArdiaPageFocus::Unknown;
  _focus.devTools = nil;
  _life.handingOff = NO;
  _leave.active = NO;
  _leave.generation++;
}

- (void)stashPageReports {
  ArdiaStashedPageReports *stash = [ArdiaStashedPageReports new];
  stash->url = _tab.url ?: @"";
  stash->reports = _reports;
  if (!_tab.closed) objc_setAssociatedObject(_tab, &kPageReportsKey, stash, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [self takeReports:nil];
}

- (void)takePageReports {
  ArdiaStashedPageReports *stash = objc_getAssociatedObject(_tab, &kPageReportsKey);
  objc_setAssociatedObject(_tab, &kPageReportsKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [self takeReports:stash && [stash->url isEqual:_tab.url ?: @""] ? stash : nil];
}

- (void)takeReports:(ArdiaStashedPageReports *)stash {
  const BOOL seen = _reports.seenByUser;
  _reports = stash ? stash->reports : ArdiaPageReports{};
  if (!stash) _reports.seenByUser = seen;
}

- (void)placeTab {
  ArdiaWindowController *controller = self.controller;
  if (!_tab || !controller.coreWindow) return;
  controller.hostChanges++;
  [controller.coreWindow placeTab:_tab index:(int)_tabIndex pinned:_pinned];
  controller.hostChanges--;
}

- (void)openedTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition {
  [self announceOpenedTab:tab adoptId:adoptId disposition:disposition tries:0];
}

- (void)announceOpenedTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition tries:(int)tries {
  if (tab.closed) return;
  NSString *url = tab.url;
  if ((!url.length || [url isEqualToString:@"about:blank"]) && tries < 20) {
    __weak ArdiaWebView *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [weakSelf announceOpenedTab:tab adoptId:adoptId disposition:disposition tries:tries + 1];
    });
    return;
  }
  NSMutableDictionary *payload = [@{
    @"url" : url ?: @"",
    @"disposition" : disposition,
    @"adoptId" : adoptId,
    @"userGesture" : @YES,
    @"postBody" : @NO,
  } mutableCopy];
  if (tab.profile.offTheRecord) payload[@"profile"] = ardia_host::OriginalProfileNameOf(tab.profile);
  [self emit:@"openWindow" payload:payload];
}

- (void)tabRemovedFromWindow:(ArdiaCoreWindow *)window {
  if (_life.moving || _life.closed() || !_tab) return;
  {
    ArdiaCoreTab *removed = _tab;
    __weak ArdiaWebView *weakSelf = self;
    dispatch_async(dispatch_get_main_queue(), ^{
      ArdiaWebView *view = weakSelf;
      if (view && view->_tab == removed && removed.closed) [view detach];
    });
  }
}

- (void)tabActivatedByChrome:(BOOL)chromes {
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ chrome-activated tab=%d byChrome=%d", _transferKey, _tab ? (int)_tab.tabId : -1, chromes);
  if (_standalone) return;
  [self requestFocusRestore];
  if (_sent.navigationQueued) [self emitNavigation];
}

- (void)devToolsChanged:(NSView *)devToolsView {
  if (_devtoolsView && _devtoolsView != devToolsView && _devtoolsView.superview == self) {
    AcceptDrops(_devtoolsView, YES);
    [_devtoolsView removeFromSuperview];
  }
  _devtoolsView = devToolsView;
  if (devToolsView && devToolsView.superview != self) {
    [devToolsView removeFromSuperview];
    NSView *page = _tab.view;
    if (page.superview == self) [self addSubview:devToolsView positioned:NSWindowBelow relativeTo:page];
    else [self addSubview:devToolsView];
    AcceptDrops(devToolsView, _visible);
  }
  [self layoutPage];
}

- (void)dropDevTools {
  AcceptDrops(_devtoolsView, YES);
  if (_devtoolsView.superview == self) [_devtoolsView removeFromSuperview];
  _devtoolsView = nil;
}

- (void)tabWillClose:(ArdiaCoreTab *)tab {
  [ArdiaEarlyWindow dropPage:tab];
  if (_life.closed() || tab != _tab) return;
  [self detach];
  [self emit:@"windowClose" payload:@{}];
}

- (void)tab:(ArdiaCoreTab *)tab rendererGone:(NSString *)status code:(int)code {
  _reports.crashed = YES;
  [self resetPageMedia];
  [self emit:@"crashed" payload:@{@"status" : @(code), @"reason" : status ?: @"unknown", @"code" : @(code)}];
}

- (void)resolveUnresponsive:(BOOL)terminate {
  [_tab resolveUnresponsive:terminate];
}

- (NSString *)discard:(BOOL)unload {
  if (unload) return @"unsupported";
  if (!_tab) return @"refused";
  if (_tab.discarded) return @"already";
  return [_tab discard] && _tab.discarded ? @"discarded" : @"refused";
}

- (void)tabDidChangeDiscarded:(ArdiaCoreTab *)tab {
  if (tab.discarded) [self emit:@"discarded" payload:@{@"url" : tab.url ?: @""}];
  else [self emit:@"ready" payload:@{}];
}

- (void)tabBecameUnresponsive:(ArdiaCoreTab *)tab {
  [self emit:@"unresponsive" payload:@{}];
}

- (void)tabBecameResponsive:(ArdiaCoreTab *)tab {
  [self emit:@"responsive" payload:@{}];
}

@end
