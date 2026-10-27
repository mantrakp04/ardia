#import "ArdiaLaunchTabHolder.h"
#import "ArdiaWebViewInternal.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaNavigationDownloads.h"

#import <objc/runtime.h>

using namespace ardia_web_view;

@implementation ArdiaLaunchTabHolder {
  NSMutableArray<NSInvocation *> *_calls;
  NSMutableArray<NSNumber *> *_callOrder;
  NSMutableDictionary<NSString *, NSDictionary *> *_pageState;
  NSUInteger _pageStateBytes;
  NSUInteger _pageStateOrder;
}

static const NSUInteger kHeldPageStateEntries = 64;
static const NSUInteger kHeldPageStateBytes = 16 * 1024;
static const NSUInteger kHeldPageStateTotalBytes = 256 * 1024;

- (void)forgetHeldPageStateWhere:(BOOL (^)(NSDictionary *held))matches {
  for (NSString *key in _pageState.allKeys)
    if (matches(_pageState[key])) {
      _pageStateBytes -= [_pageState[key][@"bytes"] unsignedIntegerValue];
      [_pageState removeObjectForKey:key];
    }
}

- (void)holdPageMessage:(NSString *)kind json:(NSString *)json frame:(NSString *)frame main:(BOOL)main origin:(NSString *)origin {
  if (![@[ @"hello", @"theme", @"media", @"nowPlaying" ] containsObject:kind ?: @""]) return;
  if ([kind isEqualToString:@"hello"]) {
    NSString *from = frame ?: @"";
    [self forgetHeldPageStateWhere:^BOOL(NSDictionary *held) { return main || [held[@"frame"] isEqualToString:from]; }];
  }
  const NSUInteger bytes = [json lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
  if (bytes > kHeldPageStateBytes) return;
  NSString *key = [NSString stringWithFormat:@"%@|%@", frame ?: @"", kind];
  if ([kind isEqualToString:@"media"]) {
    id value = JSONValue(json);
    NSString *mediaFrame = [value isKindOfClass:NSDictionary.class] ? Text(value, @"frame", 64) : nil;
    if (!mediaFrame) return;
    key = [key stringByAppendingFormat:@"|%@", mediaFrame];
  }
  if ([kind isEqualToString:@"nowPlaying"] && [json isEqualToString:@"null"]) {
    _pageStateBytes -= [_pageState[key][@"bytes"] unsignedIntegerValue];
    [_pageState removeObjectForKey:key];
    return;
  }
  const NSUInteger replaced = [_pageState[key][@"bytes"] unsignedIntegerValue];
  if (!_pageState[key] && _pageState.count >= kHeldPageStateEntries) return;
  if (_pageStateBytes - replaced + bytes > kHeldPageStateTotalBytes) return;
  if (!_pageState) _pageState = [NSMutableDictionary dictionary];
  _pageStateBytes = _pageStateBytes - replaced + bytes;
  _pageState[key] = @{
    @"kind" : kind,
    @"json" : json ?: @"null",
    @"frame" : frame ?: @"",
    @"main" : @(main),
    @"origin" : origin ?: @"",
    @"bytes" : @(bytes),
    @"order" : @(++_pageStateOrder)
  };
}

static BOOL HeldSelector(SEL selector) {
  struct objc_method_description d = protocol_getMethodDescription(@protocol(ArdiaCoreTabDelegate), selector, NO, YES);
  if (!d.name || ![ArdiaWebView instancesRespondToSelector:selector]) return NO;
  NSMethodSignature *signature = [ArdiaWebView instanceMethodSignatureForSelector:selector];
  return signature && strcmp(signature.methodReturnType, @encode(void)) == 0;
}

- (BOOL)respondsToSelector:(SEL)selector {
  return [super respondsToSelector:selector] || HeldSelector(selector);
}

- (NSMethodSignature *)methodSignatureForSelector:(SEL)selector {
  return HeldSelector(selector) ? [ArdiaWebView instanceMethodSignatureForSelector:selector] : [super methodSignatureForSelector:selector];
}

- (void)forwardInvocation:(NSInvocation *)invocation {
  if (!HeldSelector(invocation.selector) || invocation.methodSignature.numberOfArguments < 3) return [super forwardInvocation:invocation];
  if (invocation.selector == @selector(tab:didReceivePageMessage:json:frame:main:origin:)) {
    __unsafe_unretained ArdiaCoreTab *tab = nil;
    __unsafe_unretained NSString *kind = nil;
    __unsafe_unretained NSString *json = nil;
    __unsafe_unretained NSString *frame = nil;
    BOOL main = NO;
    [invocation getArgument:&tab atIndex:2];
    [invocation getArgument:&kind atIndex:3];
    [invocation getArgument:&json atIndex:4];
    [invocation getArgument:&frame atIndex:5];
    [invocation getArgument:&main atIndex:6];
    __unsafe_unretained NSString *origin = nil;
    [invocation getArgument:&origin atIndex:7];
    if ([kind isEqualToString:@"hello"]) AnswerHello(tab, _profile, frame ?: @"", main, origin);
    [self holdPageMessage:kind json:json frame:frame main:main origin:origin];
    return;
  }
  if (invocation.selector == @selector(tab:navigationBecameDownload:)) {
    __unsafe_unretained NSString *url = nil;
    [invocation getArgument:&url atIndex:3];
    if (url.length) ardia_host::NoteNavigationDownload(url, _profile ?: @"");
    if (_url.length && ![_url isEqualToString:url ?: @""]) ardia_host::NoteNavigationDownload(_url, _profile ?: @"");
  }
  if (invocation.selector == @selector(tabDidCommitDocument:) || invocation.selector == @selector(tab:rendererGone:code:))
    [self forgetHeldPageStateWhere:^BOOL(NSDictionary *held) { return YES; }];
  if (invocation.selector == @selector(tabDidChangeURL:) || invocation.selector == @selector(tabDidCommitDocument:) ||
      invocation.selector == @selector(tabDidChangeSecurity:)) {
    __unsafe_unretained ArdiaCoreTab *tab = nil;
    [invocation getArgument:&tab atIndex:2];
    [ArdiaEarlyWindow pageNavigated:tab launchURL:_url];
  }
  if (!_calls) _calls = [NSMutableArray array];
  if (!_callOrder) _callOrder = [NSMutableArray array];
  if (_calls.count >= 2000) return;
  __unsafe_unretained id none = nil;
  [invocation setArgument:&none atIndex:2];
  invocation.target = nil;
  [invocation retainArguments];
  [_calls addObject:invocation];
  [_callOrder addObject:@(++_pageStateOrder)];
}

- (void)tabWillClose:(ArdiaCoreTab *)tab {
  _closedByChrome = YES;
  [ArdiaEarlyWindow dropPage:tab];
}

- (void)replayTo:(ArdiaWebView *)view tab:(ArdiaCoreTab *)tab {
  NSArray<NSInvocation *> *calls = _calls;
  NSArray<NSNumber *> *callOrder = _callOrder;
  _calls = nil;
  _callOrder = nil;
  NSDictionary<NSString *, NSDictionary *> *state = _pageState;
  _pageState = nil;
  _pageStateBytes = 0;
  NSArray<NSDictionary *> *ordered = [state.allValues sortedArrayUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
    return [a[@"order"] compare:b[@"order"]];
  }];
  __unsafe_unretained ArdiaCoreTab *named = tab;
  NSUInteger next = 0;
  auto replayHeldBefore = [&](NSUInteger order) {
    for (; next < ordered.count && [ordered[next][@"order"] unsignedIntegerValue] < order; next++) {
      NSDictionary *held = ordered[next];
      NSString *frame = held[@"frame"];
      if (frame.length && ![tab hasLiveFrame:frame]) continue;
      [view tab:tab
          didReceivePageMessage:held[@"kind"]
                           json:held[@"json"]
                          frame:frame
                           main:[held[@"main"] boolValue]
                         origin:[held[@"origin"] length] ? held[@"origin"] : nil];
    }
  };
  for (NSUInteger i = 0; i < calls.count; i++) {
    replayHeldBefore(callOrder[i].unsignedIntegerValue);
    [calls[i] setArgument:&named atIndex:2];
    [calls[i] invokeWithTarget:view];
  }
  replayHeldBefore(NSUIntegerMax);
}

@end
