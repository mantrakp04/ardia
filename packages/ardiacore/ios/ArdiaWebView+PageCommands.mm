#import "ArdiaWebViewInternal.h"

using namespace ardia_web_view;

@implementation ArdiaWebView (PageCommands)

- (void)emitMedia {
  const BOOL playing = _tab.audible;
  const BOOL muted = _tab ? _tab.muted : _muted;
  [self emit:@"media" payload:@{@"playing" : @(playing), @"muted" : @(muted)}];
}

- (void)emitZoom {
  const double zoom = _tab ? _tab.zoomFactor : 1;
  [self emit:@"zoom"
      payload:@{
        @"zoom" : @(round(zoom * 100) / 100),
        @"host" : [NSURL URLWithString:_tab.url ?: @""].host.lowercaseString ?: @"",
        @"isDefault" : @(fabs(zoom - 1) < 0.001),
        @"pinchScale" : @(_pinchScale ?: 1),
      }];
}

- (void)tabDidChangeZoom:(ArdiaCoreTab *)tab {
  [self emitZoom];
}

- (void)tabDidChangeAudio:(ArdiaCoreTab *)tab {
  [self emitMedia];
}

- (void)tab:(ArdiaCoreTab *)tab didFindMatches:(int)count active:(int)active final:(BOOL)final {
  [self emit:@"find" payload:@{@"count" : @(count), @"active" : @(active), @"final" : @(final)}];
}

- (void)setMuted:(BOOL)muted {
  _muted = muted;
  _tab.muted = muted;
}

- (void)setZoomFactor:(double)factor {
  _tab.zoomFactor = factor;
}

- (void)zoomStep:(NSInteger)direction {
  [_tab zoomStep:(int)direction];
}

- (void)find:(NSString *)text forward:(BOOL)forward findNext:(BOOL)findNext {
  [_tab find:text forward:forward];
}

- (void)stopFinding:(BOOL)clearSelection {
  [_tab stopFinding];
}

- (void)print {
  [self runChromeCommand:35003];
}

- (void)runChromeCommand:(int)command {
  [_tab executeChromeCommand:command];
}

- (void)showDevTools {
  [_tab showDevTools];
}

- (void)showDevToolsPanel:(NSString *)panel {
  const int command = [panel isEqualToString:@"console"]   ? 40005
                      : [panel isEqualToString:@"inspect"] ? 40023
                      : [panel isEqualToString:@"toggle"]  ? 40237
                                                           : 0;
  if (command && _tab) [self runChromeCommand:command];
  else [_tab showDevTools];
}

- (void)runPageCommand:(NSString *)name {
  const int command = [name isEqualToString:@"savePage"]        ? 35004
                      : [name isEqualToString:@"systemPrint"]   ? 35007
                      : [name isEqualToString:@"caretBrowsing"] ? 40260
                                                                : 0;
  if (command) [self runChromeCommand:command];
}

- (void)executeJavaScript:(NSString *)code {
  [_tab executeJavaScript:code frame:nil];
}

- (void)thawHiddenPage {
  if (!_visible && !_frozen) _tab.frozen = NO;
}

- (void)evaluate:(NSString *)code completion:(void (^)(NSString *))completion {
  if (!_tab) return completion(nil);
  [self thawHiddenPage];
  [_tab evaluate:code completion:completion];
}

- (void)capturePicture:(double)scale completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  NSWindow *window = self.window;
  if (!_tab || !window || self.hidden) return completion(nil);
  NSRect inWindow = [self convertRect:self.bounds toView:nil];
  CGFloat top = NSHeight(window.contentView.frame);
  NSArray *frame = @[ @(NSMinX(inWindow)), @(top - NSMaxY(inWindow)), @(NSWidth(inWindow)), @(NSHeight(inWindow)) ];
  __block BOOL answered = NO;
  void (^answer)(NSDictionary *) = ^(NSDictionary *result) {
    if (answered) return;
    answered = YES;
    completion(result);
  };
  NSDictionary *params = @{@"format" : @"jpeg", @"quality" : @(scale < 0.5 ? 55 : 75), @"optimizeForSpeed" : @YES};
  void (^done)(NSDictionary *, NSString *) = ^(NSDictionary *shot, NSString *error) {
    NSString *data = shot[@"data"];
    answer([data isKindOfClass:NSString.class] ? @{@"data" : data, @"frame" : frame} : nil);
  };
  [_tab devToolsCall:@"Page.captureScreenshot" params:params timeout:1.0 completion:done];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{ answer(nil); });
}

- (void)navigationEntries:(void (^)(NSArray<NSDictionary<NSString *, id> *> *))completion {
  completion(_tab ? _tab.navigationEntries : @[]);
}

- (void)downloadFavicon:(NSString *)url name:(NSString *)name completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  [ArdiaFavicons fetch:url profile:_profile name:name completion:completion];
}

- (void)downloadImage:(NSString *)url maxPixels:(NSInteger)maxPixels completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  [ArdiaFavicons fetch:url profile:_profile name:nil completion:completion];
}

- (void)mediaCommand:(NSString *)action seconds:(double)seconds {
  [self thawHiddenPage];
  [self callFrame:_nowPlayingFrame ?: @"" kind:@"media" json:JSONString(@{@"action" : action ?: @"", @"seconds" : @(seconds)})];
}

@end
