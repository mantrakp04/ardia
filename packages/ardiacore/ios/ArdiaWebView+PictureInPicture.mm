#import "ArdiaWebViewInternal.h"
#import "ArdiaLaunchConfig.h"
#import "ArdiaPictureInPicture.h"

#import <objc/runtime.h>

using namespace ardia_web_view;

static const NSUInteger kControlPressesKept = 8;
static const NSTimeInterval kControlClickLifetime = 10;
static const NSTimeInterval kControlKeyLifetime = 2;
static const double kControlClickMatchMs = 1;

static NSMutableArray<NSDictionary *> *ControlPresses() {
  static NSMutableArray<NSDictionary *> *presses = [NSMutableArray array];
  return presses;
}

static BOOL InWebContent(NSView *view) {
  for (; view; view = view.superview)
    if ([view isKindOfClass:ArdiaWebView.class] || [NSStringFromClass(view.class) hasPrefix:@"RenderWidgetHostView"]) return YES;
  return NO;
}

static BOOL LandsInWebContent(NSEvent *event) {
  NSView *frame = event.window.contentView.superview ?: event.window.contentView;
  NSView *hit = [frame hitTest:event.locationInWindow];
  return !hit || InWebContent(hit);
}

static NSNumber *ControlTag(NSResponder *responder) {
  if (![responder isKindOfClass:NSView.class] || !((NSView *)responder).window || InWebContent((NSView *)responder)) return nil;
  if (![responder respondsToSelector:NSSelectorFromString(@"reactTag")]) return nil;
  id tag = [responder valueForKey:@"reactTag"];
  return [tag isKindOfClass:NSNumber.class] && [tag integerValue] > 0 ? tag : nil;
}

static NSNumber *ControlKeyTarget(NSEvent *event) {
  const NSEventModifierFlags chord = NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption;
  if (event.isARepeat || (event.keyCode != 49 && event.keyCode != 36 && event.keyCode != 76) || (event.modifierFlags & chord)) return nil;
  return ControlTag(event.window.firstResponder);
}

static void RecordControlPress(NSTimeInterval at, NSInteger window, NSNumber *target) {
  NSMutableArray<NSDictionary *> *presses = ControlPresses();
  NSMutableDictionary *press = [@{@"at" : @(at), @"window" : @(window)} mutableCopy];
  if (target) press[@"target"] = target;
  [presses addObject:press];
  if (presses.count > kControlPressesKept) [presses removeObjectAtIndex:0];
}

static BOOL (*gReactPerformPress)(id, SEL);

static void InstallAccessibilityPressRecord() {
  Class reactView = NSClassFromString(@"RCTView");
  Method method = reactView ? class_getInstanceMethod(reactView, @selector(accessibilityPerformPress)) : nil;
  if (!method || gReactPerformPress) return;
  IMP recording = imp_implementationWithBlock(^BOOL(NSView *view) {
    if (NSNumber *target = ControlTag(view)) RecordControlPress(NSProcessInfo.processInfo.systemUptime, view.window.windowNumber, target);
    return gReactPerformPress(view, @selector(accessibilityPerformPress));
  });
  gReactPerformPress = (BOOL (*)(id, SEL))method_setImplementation(method, recording);
}

static NSTimeInterval TakeControlPress(double clickMs, NSInteger target, NSWindow *window) {
  if (!window || (!(clickMs > 0) && target <= 0)) return 0;
  const NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
  NSMutableArray<NSDictionary *> *presses = ControlPresses();
  for (NSDictionary *press in presses) {
    const NSTimeInterval at = [press[@"at"] doubleValue];
    if ([press[@"window"] integerValue] != window.windowNumber) continue;
    const BOOL matches = clickMs > 0 ? !press[@"target"] && fabs(at * 1000 - clickMs) <= kControlClickMatchMs && now - at <= kControlClickLifetime
                                     : [press[@"target"] integerValue] == target && now - at <= kControlKeyLifetime;
    if (!matches) continue;
    [presses removeObject:press];
    return at;
  }
  return 0;
}

namespace ardia_web_view {

void InstallControlPressMonitor() {
  static id monitor;
  if (monitor) return;
  InstallAccessibilityPressRecord();
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseUp | NSEventMaskKeyDown
                                                  handler:^NSEvent *(NSEvent *event) {
                                                    if (!event.window) return event;
                                                    if (event.type == NSEventTypeKeyDown) {
                                                      if (NSNumber *target = ControlKeyTarget(event)) RecordControlPress(event.timestamp, event.windowNumber, target);
                                                    } else if (!LandsInWebContent(event)) {
                                                      RecordControlPress(event.timestamp, event.windowNumber, nil);
                                                    }
                                                    return event;
                                                  }];
}

BOOL TracingPictureInPicture() {
  static const BOOL tracing = [ArdiaLaunchConfig.shared traced:@"pip"];
  return tracing;
}
}

@implementation ArdiaWebView (PictureInPicture)

- (void)traceManualPictureInPicture:(NSString *)what {
  if (TracingPictureInPicture()) [_tab tracePictureInPicture:[@"app: manual PiP " stringByAppendingString:what] withInputs:NO];
}

- (void)traceAutoPictureInPicture:(NSString *)what {
  if (!TracingPictureInPicture() || !_tab) return;
  NSDictionary *np = _nowPlaying[_nowPlayingFrame ?: @""];
  [_tab tracePictureInPicture:[NSString stringWithFormat:@"%@ (%@): autoPictureInPicture=%d capturing=%d nowPlaying=%@ actions=%@",
                                                         what, _tab.url, _autoPictureInPicture, _capturing,
                                                         np[@"playbackState"] ?: @"none", JSONString(np[@"actions"] ?: @[])]
                   withInputs:YES];
  ArdiaCoreTab *tab = _tab;
  [_tab evaluate:@"post('result', JSON.stringify({ documentPictureInPicture: 'documentPictureInPicture' in window, "
                  "window: !!window.documentPictureInPicture?.window, videoPip: !!document.pictureInPictureElement, "
                  "brands: navigator.userAgentData?.brands?.map((b) => b.brand + '/' + b.version), visibility: document.visibilityState }))"
      completion:^(NSString *json) { [tab tracePictureInPicture:[@"page: " stringByAppendingString:json ?: @"(no answer)"] withInputs:NO]; }];
}

+ (void)setAutoPictureInPictureEnabled:(BOOL)enabled {
  [ArdiaCoreEngine setAutoPictureInPicture:enabled];
}

+ (void)setVideoUpscalingEnabled:(BOOL)enabled {
  [ArdiaCoreEngine setVideoUpscaling:enabled];
}

+ (void)setVideoUpscalingTestConditions:(NSDictionary<NSString *, NSNumber *> *)conditions {
  [ArdiaCoreEngine setVideoUpscalingTestConditions:conditions];
}

+ (NSDictionary<NSString *, id> *)videoUpscalingState {
  return ArdiaCoreEngine.videoUpscalingState;
}

- (BOOL)takeControlPressAt:(double)clickMs control:(NSInteger)target {
  const BOOL taken = TakeControlPress(clickMs, target, self.window) > 0;
  [self traceManualPictureInPicture:[NSString stringWithFormat:@"exit press %@ (control %ld)", taken ? @"verified" : @"not verified", (long)target]];
  return taken;
}

- (void)requestPictureInPictureForClickAt:(double)clickMs control:(NSInteger)target completion:(void (^)(BOOL))completion {
  if (_inPictureInPicture) return completion(YES);
  if (!_tab) return completion(NO);
  const NSTimeInterval clickAt = TakeControlPress(clickMs, target, self.window);
  [self traceManualPictureInPicture:[NSString stringWithFormat:@"%@ %@ (control %ld)", clickMs > 0 ? @"click" : @"key or accessibility press", clickAt > 0 ? @"verified" : @"not verified", (long)target]];
  if (clickAt <= 0) return completion(NO);
  [self thawHiddenPage];
  __weak ArdiaWebView *weakSelf = self;
  [_tab enterPictureInPictureForClickAt:clickAt
                             completion:^(NSString *route, BOOL opened) {
                               ArdiaWebView *view = weakSelf;
                               if (!view) return completion(NO);
                               [view traceManualPictureInPicture:[NSString stringWithFormat:@"route %@ opened=%d", route, opened]];
                               if (![route isEqualToString:@"session"]) return completion(opened || view->_inPictureInPicture);
                               [view awaitPictureInPicture:8 completion:completion];
                             }];
}

- (void)awaitPictureInPicture:(int)tries completion:(void (^)(BOOL))completion {
  if (_inPictureInPicture || tries <= 0) return completion(_inPictureInPicture);
  __weak ArdiaWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    ArdiaWebView *view = weakSelf;
    if (!view) return completion(NO);
    [view awaitPictureInPicture:tries - 1 completion:completion];
  });
}

- (void)updateAutoPictureInPicture {
  if (!_tab) return;
  NSDictionary *np = _nowPlaying[_nowPlayingFrame ?: @""];
  const BOOL playing = [np[@"playbackState"] isEqual:@"playing"] || _capturing;
  if (!_seenByUser && _autoPictureInPicture && playing) {
    [self traceAutoPictureInPicture:@"app: auto PiP left to Chrome"];
  } else if (_seenByUser && (_autoPictureInPictureActive || _inPictureInPicture)) {
    _autoPictureInPictureActive = NO;
    [self exitPictureInPicture];
  }
}

- (void)exitPictureInPicture {
  [_tab exitPictureInPicture];
}

- (void)tab:(ArdiaCoreTab *)tab didChangePictureInPicture:(NSDictionary<NSString *, id> *)state {
  if (![state[@"kind"] isEqual:@"document"]) {
    const BOOL active = [state[@"active"] boolValue];
    if (!active && !_inPictureInPicture) return;
    _inPictureInPicture = active;
    [self emit:@"pictureInPicture" payload:@{@"kind" : @"video", @"active" : @(active)}];
    if (!active) return;
    ardia_pip::WatchZoom();
    ardia_pip::VideoEntered(self, [NSURL URLWithString:tab.url ?: @""].host ?: @"");
    return;
  }
  _inPictureInPicture = [state[@"active"] boolValue];
  [self emit:@"pictureInPicture" payload:@{@"kind" : @"document", @"active" : @([state[@"active"] boolValue])}];
}

- (void)tab:(ArdiaCoreTab *)tab requestsActivation:(NSString *)reason {
  ardia_pip::TabRequestedActivation(self);
  [self emit:@"activateRequest" payload:@{@"reason" : reason ?: @"page"}];
}

@end
