#import "ArdiaWebViewInternal.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaFieldTiming.h"
#import "ArdiaNavigationDownloads.h"

using namespace ardia_web_view;

namespace {

bool IsRendererDebugURL(NSString *url) {
  NSURLComponents *c = [NSURLComponents componentsWithString:url];
  if (![@[ @"chrome", @"ardia" ] containsObject:c.scheme.lowercaseString ?: @""]) return false;
  static NSSet *hosts = [NSSet setWithArray:@[
    @"badcastcrash", @"crash", @"crashdump", @"kill", @"hang", @"shorthang", @"memory-exhaust", @"memory-pressure-critical",
    @"memory-pressure-moderate", @"gpuclean", @"gpucrash", @"gpuhang", @"inducebrowsercrashforrealz",
    @"inducebrowserdcheckforrealz", @"cfi-crash", @"heap-corruption-crash"
  ]];
  return [hosts containsObject:c.host.lowercaseString ?: @""];
}

NSString *ReportedTitle(NSString *title, NSString *url, BOOL loading) {
  if (!loading || !title.length) return title ?: @"";
  NSURLComponents *c = [NSURLComponents componentsWithString:url];
  NSString *scheme = c.scheme.lowercaseString;
  if ((![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) || ![[url substringWithRange:NSMakeRange(scheme.length, MIN(3, url.length - scheme.length))] isEqualToString:@"://"])
    return title;
  NSString *shown = [url substringFromIndex:scheme.length + 3];
  if ([shown.lowercaseString hasPrefix:@"www."]) shown = [shown substringFromIndex:4];
  if ([c.path isEqualToString:@"/"] && !c.query && !c.fragment && [shown hasSuffix:@"/"]) shown = [shown substringToIndex:shown.length - 1];
  shown = [shown stringByReplacingOccurrencesOfString:@"%20" withString:@" "];
  return [title isEqualToString:shown] ? @"" : title;
}

NSString *PNGDataURL(NSImage *image) {
  CGImageRef cg = [image CGImageForProposedRect:nil context:nil hints:nil];
  if (!cg) return nil;
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:cg];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  return png.length ? [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]] : nil;
}
}

@implementation ArdiaWebView (Navigation)

- (void)emitNavigation {
  _sent.navigationQueued = NO;
  if (!_tab) return;
  NSString *theme = _reports.theme ?: _tab.themeColor;
  NSString *themeSource = _reports.theme ? _reports.themeSource : (theme ? @"meta" : nil);
  NSString *url = _tab.url ?: @"";
  if (IsRendererDebugURL(url)) url = _sent.navigation[@"url"] ?: @"";
  [ArdiaEarlyWindow page:_tab emitted:url];
  NSDictionary *navigation = @{
        @"url" : url,
        @"title" : ReportedTitle(_tab.title, url, _tab.loading),
        @"canGoBack" : @(_tab.canGoBack),
        @"canGoForward" : @(_tab.canGoForward),
        @"isLoading" : @(_tab.loading),
        @"themeColor" : theme ?: NSNull.null,
        @"themeColorSource" : themeSource ?: NSNull.null,
  };
  if (_tab) {
    NSMutableDictionary *withInitial = [navigation mutableCopy];
    withInitial[@"initialDocumentAccessed"] = @(_tab.initialDocumentAccessed);
    withInitial[@"committedInitial"] = @(_tab.committedInitial);
    navigation = withInitial;
  }
  if (_reports.crashed && _tab.loading) {
    _reports.crashed = NO;
    NSMutableDictionary *gone = [navigation mutableCopy];
    gone[@"url"] = @"";
    _sent.navigation = gone;
    [self emit:@"navigation" payload:gone];
  }
  if ([navigation isEqualToDictionary:_sent.navigation]) return;
  _sent.navigation = navigation;
  [self emit:@"navigation" payload:navigation];
}

- (void)queueNavigation {
  if (_sent.navigationQueued) return;
  _sent.navigationQueued = YES;
  __weak ArdiaWebView *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (view && view->_sent.navigationQueued) [view emitNavigation];
  });
}

- (void)tabDidChangeTitle:(ArdiaCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeURL:(ArdiaCoreTab *)tab {
  [self queueNavigation];
  [ArdiaEarlyWindow page:tab shownURL:_shownURL];
}

- (void)tabDidChangeLoading:(ArdiaCoreTab *)tab {
  if (!tab.loading && tab.url.length && ![tab.url hasPrefix:@"about:"]) [self revealLittlePage:YES];
  if (tab.loading) [self resetBlocked:YES];
  if (tab.loading) ArdiaFieldMarkNow(_transferKey, @"start");
  [self queueNavigation];
}

- (void)resetBlocked:(BOOL)report {
  _sent.blockedGeneration++;
  _sent.blockedEmitQueued = NO;
  const BOOL had = _reports.blockedCount || _reports.lastBlocked;
  _reports.blockedCount = 0;
  _reports.lastBlocked = nil;
  if (report && had) [self emit:@"contentBlocked" payload:@{@"count" : @0, @"url" : @""}];
}

- (void)tabDidChangeNavigationState:(ArdiaCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeThemeColor:(ArdiaCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidCommitDocument:(ArdiaCoreTab *)tab {
  ArdiaFieldMarkNow(_transferKey, @"commit");
  [ArdiaEarlyWindow pageCommitted:tab shownURL:_shownURL];
  _reports.theme = nil;
  _reports.themeSource = nil;
  _sent.favicon = nil;
  [self queueNavigation];
}

- (void)tabDidChangeProgress:(ArdiaCoreTab *)tab {
  const double progress = tab.progress;
  const CFTimeInterval wait = _sent.progressAt + 0.1 - CACurrentMediaTime();
  if (progress <= 0.1 || progress >= 1 || wait <= 0) return [self sendProgress];
  if (_sent.progressQueued) return;
  _sent.progressQueued = YES;
  __weak ArdiaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(wait * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (view && view->_sent.progressQueued) [view sendProgress];
  });
}

- (void)sendProgress {
  _sent.progressQueued = NO;
  if (!_tab || _tab.progress == _sent.progress) return;
  _sent.progress = _tab.progress;
  _sent.progressAt = CACurrentMediaTime();
  [self emit:@"progress" payload:@{@"progress" : @(_sent.progress)}];
}

- (void)tab:(ArdiaCoreTab *)tab didRequestAppURL:(NSString *)url userGesture:(BOOL)userGesture {
  [self emit:@"openWindow" payload:@{@"url" : url ?: @"", @"disposition" : @"current", @"userGesture" : @(userGesture)}];
}

- (void)tabDidChangeFavicon:(ArdiaCoreTab *)tab {
  NSImage *image = tab.favicon;
  if (!image) return;
  NSString *url = tab.faviconURL;
  if (url.length) [ArdiaFavicons noteImage:image forURL:url profile:_profile];
  else url = PNGDataURL(image);
  if (!url.length || [url isEqualToString:_sent.favicon]) return;
  _sent.favicon = url;
  [self emit:@"favicon" payload:@{@"url" : url, @"urls" : @[ url ]}];
}

- (void)loadURL:(NSString *)url userInitiated:(BOOL)userInitiated {
  if (!url.length) return;
  NSString *transferred = _life.transferredURL;
  _life.transferredURL = nil;
  NSString *creating = _life.creatingURL;
  _life.creatingURL = nil;
  if (_tab && SamePage(url, transferred)) return;
  if ((_tab || _life.phase == ArdiaTabPhase::Creating) && [url isEqualToString:creating] && CACurrentMediaTime() - _life.creatingAt < 2) return;
  if (_tab) return [self loadNow:url userInitiated:userInitiated];
  _life.pendingURL = url;
  _life.pendingUserInitiated = userInitiated;
  if (self.window) [self ensureTab];
}

- (void)loadNow:(NSString *)url userInitiated:(BOOL)userInitiated {
  if ([self skipsNavigationDownload:url userInitiated:userInitiated]) return;
  if (url.length && ![url hasPrefix:@"about:"]) [self holdLittlePage];
  ArdiaFieldMarkNow(_transferKey, @"request");
  [_tab loadURL:url userInitiated:userInitiated];
  [self focusAfterLoad];
}

- (BOOL)skipsNavigationDownload:(NSString *)url userInitiated:(BOOL)userInitiated {
  const BOOL first = !_requests.loadedOnce;
  _requests.loadedOnce = YES;
  _life.pendingUserInitiated = NO;
  if (first && !userInitiated && ardia_host::WasNavigationDownload(url, _profile)) {
    __weak ArdiaWebView *weakSelf = self;
    NSDictionary *payload = @{@"url" : url ?: @"", @"committedUrl" : @"", @"skipped" : @YES};
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf emit:@"downloadNavigation" payload:payload]; });
    return YES;
  }
  _requests.requestedURL = url;
  return NO;
}

- (void)goBack {
  [_tab goBack];
}

- (void)goForward {
  [_tab goForward];
}

- (void)goToHistoryOffset:(NSInteger)offset {
  [_tab goToOffset:(int)offset];
}

- (void)reload {
  [_tab reload];
}

- (void)reloadIgnoringCache {
  [_tab reloadIgnoringCache];
}

- (void)stopLoading {
  [_tab stop];
}

- (void)tab:(ArdiaCoreTab *)tab navigationBecameDownload:(NSString *)url {
  ardia_host::NoteNavigationDownload(url, _profile);
  if (_requests.requestedURL && ![_requests.requestedURL isEqualToString:url]) ardia_host::NoteNavigationDownload(_requests.requestedURL, _profile);
  _requests.requestedURL = nil;
  [self emit:@"downloadNavigation" payload:@{@"url" : url ?: @"", @"committedUrl" : tab.url ?: @"", @"skipped" : @NO}];
}

- (void)tab:(ArdiaCoreTab *)tab didFailLoad:(NSString *)url code:(int)code description:(NSString *)text {
  [self emit:@"loadError" payload:@{@"url" : url ?: @"", @"code" : @(code), @"text" : text ?: @""}];
}

- (void)tab:(ArdiaCoreTab *)tab didChangeStatusText:(NSString *)text {
  [self emit:@"status" payload:@{@"text" : text ?: @""}];
}

- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always {
  [_tab openBlockedPopup:popupId always:always];
}

- (void)tab:(ArdiaCoreTab *)tab didBlockRequests:(int)count lastURL:(NSString *)url {
  if (tab != _tab) return;
  _reports.blockedCount += count;
  _reports.lastBlocked = url;
  if (_sent.blockedEmitQueued) return;
  _sent.blockedEmitQueued = YES;
  __weak ArdiaWebView *weakSelf = self;
  const NSUInteger generation = _sent.blockedGeneration;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 150 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (!view || view->_sent.blockedGeneration != generation || !view->_tab) return;
    view->_sent.blockedEmitQueued = NO;
    [view emit:@"contentBlocked" payload:@{@"count" : @(view->_reports.blockedCount), @"url" : view->_reports.lastBlocked ?: @""}];
  });
}

- (void)tab:(ArdiaCoreTab *)tab didBlockPopup:(NSDictionary<NSString *, NSString *> *)popup {
  [self emit:@"popupBlocked" payload:popup];
}

@end
