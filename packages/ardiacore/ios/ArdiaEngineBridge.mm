#import "ArdiaEngineBridge.h"

#import "ArdiaInternal.h"
#import "ArdiaRuntime.h"

#import <dlfcn.h>
#include <stdlib.h>

#include "../../../engine/chromium/src/chrome/browser/ardia/public/ac_engine.h"

using namespace ardia_runtime;

@interface ArdiaSecretReply : NSObject
- (instancetype)initWithCompletion:(void (^)(NSDictionary *))completion;
- (void)settle:(NSDictionary *)reply;
@end

@implementation ArdiaSecretReply {
  void (^_completion)(NSDictionary *);
}

- (instancetype)initWithCompletion:(void (^)(NSDictionary *))completion {
  if ((self = [super init])) _completion = [completion copy];
  return self;
}

- (void)settle:(NSDictionary *)reply {
  void (^completion)(NSDictionary *) = _completion;
  _completion = nil;
  if (completion) completion(reply);
}

@end

namespace {

bool gForwarding = false;
NSMutableArray<NSArray *> *gPendingForwards;

NSSet<NSString *> *ForwardedTopics() {
  static NSSet *topics = [NSSet setWithArray:@[ @"history.changed", @"bookmarks.changed", @"extensions.action", @"extensions.sync", @"cliControl" ]];
  return topics;
}

NSString *AppEventOfTopic(NSString *topic) {
  return [topic isEqualToString:@"cliControl"] ? @"engine.cliControl" : topic;
}

void *Symbol(const char *name) {
  return dlsym(RTLD_DEFAULT, name);
}

void Replied(void *context, const char *json) {
  void (^completion)(NSString *) = (__bridge_transfer void (^)(NSString *))context;
  completion(json ? @(json) : JSONText(@{@"error" : @"bad reply from the engine"}));
}

void RepliedSecret(void *context, const char *json) {
  ArdiaSecretReply *reply = (__bridge_transfer ArdiaSecretReply *)context;
  if (!json) return [reply settle:nil];
  NSMutableData *bytes = [NSMutableData dataWithBytes:json length:strlen(json)];
  id parsed = [NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
  WipeSecret(bytes);
  [reply settle:[parsed isKindOfClass:NSDictionary.class] ? parsed : nil];
}

NSString *RealPath(NSString *path) {
  char resolved[PATH_MAX];
  return realpath(path.fileSystemRepresentation, resolved) ? @(resolved) : path;
}

NSString *ProfileNamed(NSString *dir) {
  NSString *real = RealPath(dir);
  for (ArdiaCoreProfile *profile in ardia_host::LoadedProfiles())
    if (!profile.offTheRecord && [RealPath(profile.path) isEqualToString:real]) return ardia_host::ProfileName(profile);
  return ardia_host::ProfileNameOfDirectoryName(real.lastPathComponent);
}

NSMutableDictionary<NSString *, NSMutableArray *> *Observers() {
  static NSMutableDictionary *observers = [NSMutableDictionary dictionary];
  return observers;
}

bool Forwarded(NSString *topic) {
  return gForwarding && [ForwardedTopics() containsObject:topic];
}

void FlushForwards() {
  NSArray<NSArray *> *events = gPendingForwards;
  gPendingForwards = nil;
  for (NSArray *event in events)
    [ArdiaEvents emit:AppEventOfTopic(event[0]) data:event[1]];
}

void Forward(NSString *topic, NSDictionary *payload) {
  NSArray *event = @[ topic, [payload copy] ];
  if (gPendingForwards) {
    if (![gPendingForwards.lastObject isEqualToArray:event]) [gPendingForwards addObject:event];
    return;
  }
  gPendingForwards = [NSMutableArray arrayWithObject:event];
  dispatch_async(dispatch_get_main_queue(), ^{
    FlushForwards();
  });
}

void Dispatch(void *, const char *topic, const char *json) {
  if (!topic) return;
  NSString *name = @(topic);
  NSArray *observers = [Observers()[name] copy];
  bool forwarded = Forwarded(name);
  if (!observers.count && !forwarded) return;
  NSData *data = [@(json ?: "{}") dataUsingEncoding:NSUTF8StringEncoding];
  NSMutableDictionary *payload = [[NSJSONSerialization JSONObjectWithData:data options:0 error:nil] mutableCopy] ?: [NSMutableDictionary dictionary];
  if ([payload[@"profile"] isKindOfClass:NSString.class]) payload[@"profile"] = ProfileNamed(payload[@"profile"]);
  for (void (^observer)(NSDictionary *) in observers) observer(payload);
  if (forwarded) Forward(name, payload);
}

void InstallSink() {
  static bool installed = false;
  if (installed) return;
  auto sink = (ac_engine_set_event_sink_t)Symbol("ac_engine_set_event_sink");
  if (!sink) return;
  installed = true;
  sink(Dispatch, nullptr);
}

}

@implementation ArdiaEngineBridge

+ (void)call:(NSString *)name profile:(NSString *)profile args:(NSString *)args completion:(void (^)(NSString *))completion {
  auto call = (ac_engine_call_t)Symbol(name.UTF8String);
  if (!call) return completion(JSONText(@{@"error" : [NSString stringWithFormat:@"the engine has no %@", name]}));
  if (ardia_host::IsPrivateProfile(profile)) {
    NSData *bytes = [(args.length ? args : @"{}") dataUsingEncoding:NSUTF8StringEncoding];
    NSMutableDictionary *parsed = [[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil] mutableCopy];
    if (![parsed isKindOfClass:NSMutableDictionary.class]) return completion(JSONText(@{@"error" : @"bad arguments"}));
    parsed[@"offTheRecord"] = @YES;
    args = JSONText(parsed);
  }
  NSString *data = ardia_host::OriginalProfileName(profile);
  void (^done)(NSString *) = [completion copy];
  NSString *argsCopy = [args copy];
  ardia_host::WithProfile(data, ^(ArdiaCoreProfile *p) {
    if (!p || !ArdiaHost.isStarted) return done(JSONText(@{@"error" : @"profile not loaded"}));
    call(p.path.UTF8String, argsCopy.UTF8String, Replied, (__bridge_retained void *)done);
  });
}

+ (void)callWithSecret:(NSString *)name profile:(NSString *)profile args:(NSMutableData *)args completion:(void (^)(NSString *))completion {
  NSMutableData *secret = args;
  void (^wipe)(void) = ^{ WipeSecret(secret); };
  auto call = (ac_engine_call_t)Symbol(name.UTF8String);
  const char *bytes = (const char *)secret.bytes;
  if (!call || ardia_host::IsPrivateProfile(profile) || !secret.length || bytes[secret.length - 1] != 0) {
    wipe();
    return completion(JSONText(@{@"error" : !call ? [NSString stringWithFormat:@"the engine has no %@", name]
                                     : ardia_host::IsPrivateProfile(profile) ? @"private profile" : @"bad arguments"}));
  }
  void (^done)(NSString *) = [completion copy];
  ardia_host::WithProfile(profile ?: @"", ^(ArdiaCoreProfile *p) {
    if (!p || !ArdiaHost.isStarted || p.offTheRecord) {
      wipe();
      return done(JSONText(@{@"error" : @"profile not loaded"}));
    }
    call(p.path.UTF8String, (const char *)secret.mutableBytes, Replied, (__bridge_retained void *)done);
    wipe();
  });
}

+ (void)callForSecretReply:(NSString *)name
                   profile:(NSString *)profile
                   timeout:(NSTimeInterval)timeout
                completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  ArdiaSecretReply *reply = [[ArdiaSecretReply alloc] initWithCompletion:completion];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [reply settle:nil];
  });
  auto call = (ac_engine_call_t)Symbol(name.UTF8String);
  if (!call || ardia_host::IsPrivateProfile(profile)) return [reply settle:nil];
  ardia_host::WithProfile(profile ?: @"", ^(ArdiaCoreProfile *p) {
    if (!p || !ArdiaHost.isStarted || p.offTheRecord) return [reply settle:nil];
    call(p.path.UTF8String, "{}", RepliedSecret, (__bridge_retained void *)reply);
  });
}

+ (void)forwardEngineEvents {
  gForwarding = true;
  InstallSink();
}

+ (void)observe:(NSString *)topic handler:(void (^)(NSDictionary<NSString *, id> *))handler {
  if (!Observers()[topic]) Observers()[topic] = [NSMutableArray array];
  [Observers()[topic] addObject:[handler copy]];
  InstallSink();
}


@end
