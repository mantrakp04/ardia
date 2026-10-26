#import "ArdiaWebViewInternal.h"
#import "ArdiaServices.h"

using namespace ardia_web_view;

@implementation ArdiaWebView (Site)

- (void)tabDidChangeSecurity:(ArdiaCoreTab *)tab {
  if (NSDictionary *info = tab.securityInfo) [self emit:@"security" payload:info];
}

- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *))completion {
  if (_tab.securityInfo) return completion(_tab.securityInfo);
  NSString *url = _tab.url ?: @"";
  NSString *scheme = [NSURL URLWithString:url].scheme.lowercaseString;
  NSString *level = [scheme isEqualToString:@"https"] ? @"secure" : [scheme isEqualToString:@"http"] ? @"insecure" : @"local";
  completion(@{@"level" : level, @"url" : url, @"origin" : NSNull.null});
}

- (void)pageCookies:(NSArray<NSString *> *)urls completion:(void (^)(NSArray<NSDictionary<NSString *, id> *> *))completion {
  if (!_tab || _tab.closed || !urls.count) return completion(nil);
  __block BOOL answered = NO;
  void (^answer)(NSArray *) = ^(NSArray *cookies) {
    if (answered) return;
    answered = YES;
    completion(cookies);
  };
  void (^done)(NSDictionary *, NSString *) = ^(NSDictionary *result, NSString *error) {
    NSArray *cookies = result[@"cookies"];
    answer([cookies isKindOfClass:NSArray.class] ? cookies : nil);
  };
  [_tab devToolsCall:@"Network.getCookies" params:@{@"urls" : urls} timeout:1.0 completion:done];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1200 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ answer(nil); });
}

- (void)tab:(ArdiaCoreTab *)tab preferredSizeDidChange:(NSSize)size {
  [self emit:@"preferredSize" payload:@{@"width" : @(size.width), @"height" : @(size.height)}];
}

- (void)clearSiteData:(ArdiaServiceReply)reply {
  NSString *origin = OriginOf(_tab.url);
  if (!origin) return reply(@{@"cookies" : @NO, @"storage" : @NO}, nil);
  [ArdiaServices clearSiteData:_profile origin:origin reply:reply];
}

- (void)resolvePasswordPrompt:(NSString *)action username:(NSString *)username password:(NSString *)password {
  [ardia_host::PasswordPromptTab(self, _tab) resolvePasswordPrompt:action username:username password:password];
}

- (void)resolveAutofillPrompt:(NSInteger)promptId action:(NSString *)action {
  [_tab resolveAutofillPrompt:promptId action:action];
}

- (NSString *)executeExtensionAction:(NSString *)extensionId {
  return [_tab executeExtensionAction:extensionId];
}

- (void)notificationAction:(NSString *)notificationId action:(NSString *)action {
  NSString *frame = notificationId ? _notificationFrames[notificationId] : nil;
  if (!frame) return;
  if (![action isEqualToString:@"click"]) [_notificationFrames removeObjectForKey:notificationId];
  [self callFrame:frame kind:@"notification" json:JSONString(@{@"id" : notificationId, @"action" : action ?: @""})];
}

- (void)tab:(ArdiaCoreTab *)tab didChangeMediaAccess:(NSDictionary<NSString *, NSNumber *> *)access {
  _capturing = [access[@"camera"] boolValue] || [access[@"microphone"] boolValue] || [access[@"screen"] boolValue];
  [self emit:@"mediaAccess" payload:access ?: @{}];
}

- (void)tab:(ArdiaCoreTab *)tab externalAppRequest:(NSDictionary<NSString *, id> *)request {
  [self emit:@"externalApp" payload:request ?: @{}];
}

@end
