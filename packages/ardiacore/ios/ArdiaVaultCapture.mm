#import "ArdiaVaultCapture.h"

static const NSTimeInterval kLoginLifetime = 180;
static const NSTimeInterval kGeneratedLifetime = 1800;
static const NSTimeInterval kRepeatWindow = 2;
static const NSTimeInterval kFillTimeout = 4;
static const NSUInteger kMaxFrames = 64;
static const NSUInteger kMaxLogins = 16;
static const NSUInteger kMaxFills = 8;

static NSTimeInterval Now() { return NSProcessInfo.processInfo.systemUptime; }

static NSHashTable<ArdiaVaultCapture *> *LiveCaptures() {
  static NSHashTable<ArdiaVaultCapture *> *captures;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    captures = [NSHashTable weakObjectsHashTable];
  });
  return captures;
}

@implementation ArdiaVaultCapture {
  NSMutableDictionary<NSString *, NSString *> *_frameOrigins;
  NSMutableDictionary<NSString *, NSDictionary *> *_logins;
  NSMutableDictionary<NSString *, NSDictionary *> *_fills;
  NSMutableDictionary<NSString *, NSDictionary *> *_generated;
}

- (instancetype)init {
  if ((self = [super init])) {
    _frameOrigins = [NSMutableDictionary dictionary];
    _logins = [NSMutableDictionary dictionary];
    _fills = [NSMutableDictionary dictionary];
    _generated = [NSMutableDictionary dictionary];
    [LiveCaptures() addObject:self];
  }
  return self;
}

- (void)dealloc {
  [_logins removeAllObjects];
  [_generated removeAllObjects];
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
  if (previous && ![previous[@"generated"] boolValue] && [previous[@"username"] isEqualToString:username] &&
      [previous[@"password"] isEqualToString:password] && now - [previous[@"at"] doubleValue] < kRepeatWindow)
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
  if (!origin.length) return;
  [_logins removeObjectForKey:origin];
  [_generated removeObjectForKey:origin];
}

- (void)keepGeneratedPassword:(NSString *)password origin:(NSString *)origin {
  if (!origin.length || !password.length) return;
  if (!_generated[origin] && _generated.count >= kMaxLogins) [_generated removeAllObjects];
  _generated[origin] = @{@"password" : [password copy], @"at" : @(Now())};
  if (![self keepLogin:@"" password:password origin:origin]) return;
  NSMutableDictionary *login = [_logins[origin] mutableCopy];
  login[@"generated"] = @YES;
  _logins[origin] = login;
}

- (BOOL)isGeneratedPassword:(NSString *)password origin:(NSString *)origin {
  NSDictionary *generated = origin.length ? _generated[origin] : nil;
  if (!generated) return NO;
  if (Now() - [generated[@"at"] doubleValue] >= kGeneratedLifetime) {
    [_generated removeObjectForKey:origin];
    return NO;
  }
  NSString *kept = generated[@"password"];
  return kept.length && password.length && [kept isEqualToString:password];
}

- (NSString *)generatedPasswordFor:(NSString *)origin {
  NSString *kept = origin.length ? _generated[origin][@"password"] : nil;
  return kept.length ? kept : nil;
}

- (NSDictionary<NSString *, NSString *> *)peekLogin:(NSString *)origin {
  [self dropExpiredLogins];
  NSDictionary *login = origin.length ? _logins[origin] : nil;
  if (!login) return nil;
  return @{@"username" : login[@"username"], @"password" : login[@"password"]};
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
  [_generated removeAllObjects];
  [_frameOrigins removeAllObjects];
  for (NSString *fillId in _fills.allKeys) [self finishFill:fillId frame:_fills[fillId][@"frame"] filled:@[]];
}

+ (void)wipeAll {
  for (ArdiaVaultCapture *capture in LiveCaptures().allObjects) [capture wipe];
}

@end
