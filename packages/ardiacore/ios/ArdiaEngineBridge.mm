#import "ArdiaEngineBridge.h"

#import "ArdiaInternal.h"

#import <dlfcn.h>
#include <stdlib.h>

#include "../../../engine/chromium/src/chrome/browser/ardia/public/ac_engine.h"

namespace {

bool gForwarding = false;
NSMutableArray<NSArray *> *gPendingForwards;

NSDictionary<NSString *, NSString *> *AppEventOfTopic() {
  static NSDictionary *events = @{
    @"history.changed" : @"history.changed",
    @"bookmarks.changed" : @"bookmarks.changed",
    @"extensions.action" : @"extensions.action",
    @"extensions.sync" : @"extensions.sync",
    @"cliControl" : @"engine.cliControl",
  };
  return events;
}

NSString *const kServesPrivateSession = @"session";
NSString *const kNoEngineData = @"no engine data for a private profile";

NSDictionary<NSString *, NSString *> *PrivateSessionPolicy() {
  static NSDictionary *policy = @{
    @"ac_site_settings_get" : kServesPrivateSession,
    @"ac_site_settings_origins" : kServesPrivateSession,
    @"ac_site_settings_set" : kServesPrivateSession,
    @"ac_site_settings_reset" : kServesPrivateSession,
    @"ac_site_data_clear" : kServesPrivateSession,
    @"ac_zoom_list" : kServesPrivateSession,
    @"ac_zoom_set" : kServesPrivateSession,
    @"ac_history_query" : kNoEngineData,
    @"ac_history_add" : kNoEngineData,
    @"ac_history_import" : kNoEngineData,
    @"ac_history_delete_urls" : kNoEngineData,
    @"ac_history_watch" : kNoEngineData,
    @"ac_favicons_get" : kNoEngineData,
    @"ac_favicons_set" : kNoEngineData,
    @"ac_bookmarks_tree" : kNoEngineData,
    @"ac_bookmarks_apply" : kNoEngineData,
    @"ac_bookmarks_watch" : kNoEngineData,
    @"ac_tabs_last_tab_policy" : kNoEngineData,
    @"ac_task_manager_open" : kNoEngineData,
    @"ac_battery_saver" : kNoEngineData,
    @"ac_memory_trim" : kNoEngineData,
    @"ac_cli_control" : kNoEngineData,
    @"ac_extensions_watch_actions" : kNoEngineData,
    @"ac_extensions_sync_state" : kNoEngineData,
    @"ac_extensions_sync_apply" : kNoEngineData,
    @"ac_downloads_settings" : kNoEngineData,
    @"ac_downloads_set_settings" : kNoEngineData,
  };
  return policy;
}

void *Symbol(const char *name) {
  return dlsym(RTLD_DEFAULT, name);
}

NSString *JSON(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

void Replied(void *context, const char *json) {
  void (^completion)(NSString *) = (__bridge_transfer void (^)(NSString *))context;
  completion(json ? @(json) : JSON(@{@"error" : @"bad reply from the engine"}));
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
  return gForwarding && AppEventOfTopic()[topic] != nil;
}

void FlushForwards() {
  NSArray<NSArray *> *events = gPendingForwards;
  gPendingForwards = nil;
  for (NSArray *event in events)
    [ArdiaEvents emit:AppEventOfTopic()[event[0]] data:event[1]];
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
  if (!call) return completion(JSON(@{@"error" : [NSString stringWithFormat:@"the engine has no %@", name]}));
  if (ardia_host::IsPrivateProfile(profile)) {
    NSString *policy = PrivateSessionPolicy()[name];
    if (![policy isEqualToString:kServesPrivateSession]) return completion(JSON(@{@"error" : policy ?: @"private profile"}));
    NSData *bytes = [(args.length ? args : @"{}") dataUsingEncoding:NSUTF8StringEncoding];
    NSMutableDictionary *parsed = [[NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil] mutableCopy];
    if (![parsed isKindOfClass:NSMutableDictionary.class]) return completion(JSON(@{@"error" : @"bad arguments"}));
    parsed[@"offTheRecord"] = @YES;
    args = JSON(parsed);
  }
  NSString *data = ardia_host::OriginalProfileName(profile);
  void (^done)(NSString *) = [completion copy];
  NSString *argsCopy = [args copy];
  ardia_host::WithProfile(data, ^(ArdiaCoreProfile *p) {
    if (!p || !ArdiaHost.isStarted) return done(JSON(@{@"error" : @"profile not loaded"}));
    call(p.path.UTF8String, argsCopy.UTF8String, Replied, (__bridge_retained void *)done);
  });
}

+ (void)callWithSecret:(NSString *)name profile:(NSString *)profile args:(NSMutableData *)args completion:(void (^)(NSString *))completion {
  NSMutableData *secret = args;
  void (^wipe)(void) = ^{
    volatile unsigned char *bytes = (volatile unsigned char *)secret.mutableBytes;
    for (NSUInteger i = 0; i < secret.length; i++) bytes[i] = 0;
  };
  auto call = (ac_engine_call_t)Symbol(name.UTF8String);
  const char *bytes = (const char *)secret.bytes;
  if (!call || ardia_host::IsPrivateProfile(profile) || !secret.length || bytes[secret.length - 1] != 0) {
    wipe();
    return completion(JSON(@{@"error" : !call ? [NSString stringWithFormat:@"the engine has no %@", name]
                                     : ardia_host::IsPrivateProfile(profile) ? @"private profile" : @"bad arguments"}));
  }
  void (^done)(NSString *) = [completion copy];
  ardia_host::WithProfile(profile ?: @"", ^(ArdiaCoreProfile *p) {
    if (!p || !ArdiaHost.isStarted || p.offTheRecord) {
      wipe();
      return done(JSON(@{@"error" : @"profile not loaded"}));
    }
    call(p.path.UTF8String, (const char *)secret.mutableBytes, Replied, (__bridge_retained void *)done);
    wipe();
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
