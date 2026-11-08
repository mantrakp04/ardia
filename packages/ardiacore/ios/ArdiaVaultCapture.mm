#import "ArdiaVaultCapture.h"

static const NSTimeInterval kLoginLifetime = 180;
static const NSTimeInterval kRepeatWindow = 2;
static const NSTimeInterval kFillTimeout = 4;
static const NSUInteger kMaxFrames = 64;
static const NSUInteger kMaxLogins = 16;
static const NSUInteger kMaxFills = 8;

static NSTimeInterval Now() { return NSProcessInfo.processInfo.systemUptime; }

@implementation ArdiaVaultCapture {
  NSMutableDictionary<NSString *, NSString *> *_frameOrigins;
  NSMutableDictionary<NSString *, NSDictionary *> *_logins;
  NSMutableDictionary<NSString *, NSDictionary *> *_fills;
}

- (instancetype)init {
  if ((self = [super init])) {
    _frameOrigins = [NSMutableDictionary dictionary];
    _logins = [NSMutableDictionary dictionary];
    _fills = [NSMutableDictionary dictionary];
  }
  return self;
}

- (void)dealloc {
  [_logins removeAllObjects];
}

- (void)noteFieldInFrame:(NSString *)frameId origin:(NSString *)origin {
  if (!origin.length) return;
  if (!_frameOrigins[frameId] && _frameOrigins.count >= kMaxFrames) [_frameOrigins removeAllObjects];
  _frameOrigins[frameId] = origin;
}

- (NSString *)originOfFrame:(NSString *)frameId {
  return _frameOrigins[frameId];
}

- (void)forgetFrame:(NSString *)frameId {
  [_frameOrigins removeObjectForKey:frameId];
}

- (void)dropExpiredLogins {
  const NSTimeInterval now = Now();
  for (NSString *origin in _logins.allKeys) {
    NSNumber *at = _logins[origin][@"at"];
    if (now - at.doubleValue >= kLoginLifetime) [_logins removeObjectForKey:origin];
  }
}

- (BOOL)keepLogin:(NSString *)username password:(NSString *)password origin:(NSString *)origin {
  if (!origin.length || !password.length) return NO;
  [self dropExpiredLogins];
  NSDictionary *previous = _logins[origin];
  const NSTimeInterval now = Now();
  if (previous && [previous[@"username"] isEqualToString:username] && [previous[@"password"] isEqualToString:password] &&
      now - [previous[@"at"] doubleValue] < kRepeatWindow)
    return NO;
  if (!previous && _logins.count >= kMaxLogins) [_logins removeAllObjects];
  _logins[origin] = @{@"username" : username ?: @"", @"password" : password, @"at" : @(now)};
  __weak ArdiaVaultCapture *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((kLoginLifetime + 1) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [weakSelf dropExpiredLogins];
  });
  return YES;
}

- (NSDictionary<NSString *, NSString *> *)takeLogin:(NSString *)origin {
  [self dropExpiredLogins];
  NSDictionary *login = origin.length ? _logins[origin] : nil;
  if (!login) return nil;
  [_logins removeObjectForKey:origin];
  return @{@"username" : login[@"username"], @"password" : login[@"password"]};
}

- (void)discardLogin:(NSString *)origin {
  if (origin.length) [_logins removeObjectForKey:origin];
}

- (NSString *)awaitFillInFrame:(NSString *)frameId reply:(void (^)(NSArray<NSString *> *filled))reply {
  if (_fills.count >= kMaxFills)
    for (NSString *stale in _fills.allKeys) [self finishFill:stale frame:_fills[stale][@"frame"] filled:@[]];
  NSString *fillId = NSUUID.UUID.UUIDString;
  _fills[fillId] = @{@"frame" : frameId, @"reply" : [reply copy]};
  __weak ArdiaVaultCapture *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kFillTimeout * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [weakSelf finishFill:fillId frame:frameId filled:@[]];
  });
  return fillId;
}

- (void)finishFill:(NSString *)fillId frame:(NSString *)frameId filled:(NSArray<NSString *> *)filled {
  NSDictionary *fill = fillId.length ? _fills[fillId] : nil;
  if (!fill || ![fill[@"frame"] isEqualToString:frameId]) return;
  [_fills removeObjectForKey:fillId];
  void (^reply)(NSArray<NSString *> *) = (void (^)(NSArray<NSString *> *))fill[@"reply"];
  if (reply) reply(filled);
}

- (void)wipe {
  [_logins removeAllObjects];
  [_frameOrigins removeAllObjects];
  for (NSString *fillId in _fills.allKeys) [self finishFill:fillId frame:_fills[fillId][@"frame"] filled:@[]];
}

@end
