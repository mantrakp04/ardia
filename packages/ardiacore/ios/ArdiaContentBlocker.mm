#import "ArdiaContentBlockerInternal.h"

#include <utility>

using namespace ardia_content_blocker;

namespace ardia_content_blocker {

NSString *ExtensionId() { return @"fajbdaomknpkicfjcpipdmcpoamdmilh"; }

NSString *const kLiteId = @"bnjeokpoejhioagiokhkhmdogkhbnbki";

}

namespace {

NSString *const kBundledName = @"ublock";

}

namespace ardia_content_blocker {

NSString *const kLiteReaderName = @"ublock-lite-settings";

NSString *const kLiteMovedMarker = @"uBlock Origin Lite settings moved";

bool gFailNextMessage = false;

}

namespace {

double gDelayNextLoadMs = 0;

NSString *BundledExtension() {
  NSString *bundled = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:[@"Extensions" stringByAppendingPathComponent:kBundledName]];
  return [NSFileManager.defaultManager fileExistsAtPath:[bundled stringByAppendingPathComponent:@"manifest.json"]] ? bundled : nil;
}

NSString *gExtensionPath;

void StartPreparing() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    gExtensionPath = BundledExtension();
    NSString *oldCopies = [[ArdiaHost.dataDirectory stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"Built-in Extensions"];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
      if ([NSFileManager.defaultManager fileExistsAtPath:oldCopies]) [NSFileManager.defaultManager removeItemAtPath:oldCopies error:nil];
    });
  });
}

NSString *ExtensionPath() {
  StartPreparing();
  return gExtensionPath;
}

void FollowDefault(NSArray<NSString *> *profiles, void (^done)(NSString *error));

void WhenDefaultSettled(void (^then)(void));

}

namespace ardia_content_blocker {

void LoadIntoProfile(NSString *profile, void (^then)(NSString *error)) {
  then = [then copy];
  StartPreparing();
  void (^load)(void) = ^{
    if ([LoadedProfiles() containsObject:profile]) return then(nil);
    ardia_host::WithProfile(profile, ^(ArdiaCoreProfile *p) {
      if ([LoadedProfiles() containsObject:profile]) return then(nil);
      NSString *path = gExtensionPath;
      if (!p || !path) return then(@"not loaded");
      NSString *loaded = [p loadComponentExtension:path];
      if (![loaded isEqualToString:ExtensionId()]) {
        NSLog(@"[blocker] component load failed (%@)", loaded);
        return then(@"not loaded");
      }
      [LoadedProfiles() addObject:profile];
      then(nil);
    });
  };
  if (NSThread.isMainThread) load();
  else dispatch_async(dispatch_get_main_queue(), load);
}

NSString *const kOffDirective = @"/^(?:ardia-blocking-off|)/";

}

namespace {

bool gDefaultSettled = false;

bool gLaunching = true;

constexpr double kSettleAfterLaunchSeconds = 1.5;

constexpr double kDownloadSeconds = 75;

NSString *const kRead =
    @"Promise.all([lists(), trusted(), userFilters()]).then(([l, t, u]) => ({lists: selected(l).sort(), imported: custom(l).sort(),"
     "  userFilters: u.text, whitelist: [...t.whitelist].sort(), autoUpdate: l.autoUpdate !== false}))";

NSString *const kFollow =
    @"Promise.all([lists(), trusted(), userFilters()]).then(([l, t, u]) => {"
     "  const want = %@;"
     "  if (!Array.isArray(want.lists) || !Array.isArray(want.whitelist)) throw new Error('no settings to copy');"
     "  let written = Promise.resolve(null);"
     "  const have = custom(l);"
     "  const toImport = Array.isArray(want.imported) ? want.imported.filter((k) => !have.includes(k)) : [];"
     "  const toRemove = Array.isArray(want.imported) ? have.filter((k) => !want.imported.includes(k)) : [];"
     "  const rewrite = typeof want.userFilters === 'string' && want.userFilters.trim() !== u.text.trim();"
     "  if (toImport.length || toRemove.length)"
     "    written = written.then(askReload)"
     "      .then(() => send({what: 'applyFilterListSelection', toImport: toImport.join('\\n'), toRemove}));"
     "  if (rewrite)"
     "    written = written.then(askReload)"
     "      .then(() => send({what: 'writeUserFilters', content: want.userFilters, enabled: u.enabled, trusted: u.trusted}));"
     "  if (toImport.length || toRemove.length || rewrite || !sameSet(selected(l), want.lists))"
     "    written = written.then(() => applyLists(want.lists));"
     "  if (!sameSet(t.whitelist, want.whitelist))"
     "    written = written.then(() => send({what: 'setWhitelist', whitelist: want.whitelist.join('\\n')}));"
     "  if ((l.autoUpdate !== false) !== (want.autoUpdate !== false))"
     "    written = written.then(() => send({what: 'userSettings', name: 'autoUpdate', value: want.autoUpdate !== false}));"
     "  return written.then(() => null);"
     "})";

void ForgetGoneProfiles() {
  for (NSString *profile in LoadedProfiles().array) {
    if (ardia_host::LoadedProfile(profile) && !ardia_host::IsDeletedProfile(profile)) continue;
    [LoadedProfiles() removeObject:profile];
    [Pages()[profile] fail:@"profile gone"];
    [Pages() removeObjectForKey:profile];
  }
}

void FollowDefault(NSArray<NSString *> *profiles, void (^done)(NSString *error)) {
  done = [done copy];
  if (!gDefaultSettled && ArdiaHost.isStarted) return WhenDefaultSettled(^{ FollowDefault(profiles, done); });
  if (!profiles) ForgetGoneProfiles();
  profiles = [(profiles ?: LoadedProfiles().array) filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]];
  if (!profiles.count) return done(nil);
  Call(kProfile, kRead, ^(NSDictionary *settings, NSString *error) {
    if (error) return done(error);
    if (![settings isKindOfClass:NSDictionary.class]) return done(@"no settings to copy");
    dispatch_group_t group = dispatch_group_create();
    __block NSString *failed;
    for (NSString *profile in profiles) {
      dispatch_group_enter(group);
      CallWithin(profile, ScriptWith(kFollow, @[ settings ]), kDownloadSeconds, ^(id, NSString *error) {
        const bool gone = !ardia_host::LoadedProfile(profile) || ardia_host::IsDeletedProfile(profile);
        if (!gone) failed = failed ?: error;
        dispatch_group_leave(group);
      });
    }
    dispatch_group_notify(group, dispatch_get_main_queue(), ^{ done(failed); });
  });
}

NSMutableArray<void (^)(void)> *SettledWaiters() {
  static NSMutableArray *waiters = [NSMutableArray array];
  return waiters;
}

void WhenDefaultSettled(void (^then)(void)) {
  if (gDefaultSettled) return then();
  [SettledWaiters() addObject:[then copy]];
}

void DefaultSettled() {
  gDefaultSettled = true;
  gLaunching = false;
  NSArray<void (^)(void)> *waiters = [SettledWaiters() copy];
  [SettledWaiters() removeAllObjects];
  for (void (^waiter)(void) in waiters) waiter();
}

constexpr int kInheritAttempts = 6;

void Inherit(NSString *profile, int attempt, void (^first)(NSString *error)) {
  first = [first copy];
  FollowDefault(@[ profile ], ^(NSString *error) {
    if (first) first(error);
    const bool gone = !ardia_host::LoadedProfile(profile) || ardia_host::IsDeletedProfile(profile) ||
                      ![LoadedProfiles() containsObject:profile];
    if (!error || gone || attempt + 1 >= kInheritAttempts) {
      if (error && !gone) NSLog(@"[blocker] profile \"%@\" didn't take the default profile's settings: %@", profile, error);
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((1 << attempt) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      Inherit(profile, attempt + 1, nil);
    });
  });
}

void LoadHeld(NSString *profile) {
  ArdiaCoreProfile *p = ardia_host::LoadedProfile(profile);
  const bool isDefault = profile.length == 0;
  const bool firstLoad = p && ![LoadedProfiles() containsObject:profile];
  const bool hold = firstLoad && (isDefault ? LiteSettingsPending(p) : !gLaunching);
  if (hold) [p holdNavigationsUntilRulesetsOf:ExtensionId()];
  void (^release)(NSString *) = ^(NSString *why) {
    if (!hold) return;
    if (!why) [p releaseNavigationHoldReady];
    else [p releaseNavigationHold:why ?: @"uBlock Origin is ready"];
  };
  void (^load)(void) = ^{
    LoadIntoProfile(profile, ^(NSString *error) {
      if (error) {
        if (isDefault) DefaultSettled();
        return release([@"the content blocker didn't load: " stringByAppendingString:error]);
      }
      if (!isDefault) {
        return WhenDefaultSettled(^{
          Inherit(profile, 0, ^(NSString *followError) {
            release(followError ? [@"the default profile's settings didn't apply: " stringByAppendingString:followError] : nil);
          });
        });
      }
      void (^settle)(void) = ^{
        ArdiaCoreProfile *current = ardia_host::LoadedProfile(profile);
        if (!hold && current && !LiteSettingsPending(current)) return DefaultSettled();
        Call(profile, @"null", ^(id, NSString *readyError) {
          ArdiaCoreProfile *loaded = ardia_host::LoadedProfile(profile);
          if (readyError || !loaded) {
            DefaultSettled();
            return release(readyError ? [@"uBlock Origin isn't ready: " stringByAppendingString:readyError] : nil);
          }
          MoveLiteSettings(profile, loaded, ^{
            DefaultSettled();
            release(nil);
          });
        });
      };
      if (hold || !gLaunching) return settle();
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kSettleAfterLaunchSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), settle);
    });
  };
  const double delay = std::exchange(gDelayNextLoadMs, 0);
  if (delay > 0) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_MSEC)), dispatch_get_main_queue(), load);
  else load();
}

NSString *Category(NSString *listId, NSString *group) {
  if ([group isEqual:@"regions"]) return @"regional";
  if ([listId containsString:@"cookie"]) return @"cookies";
  if ([group isEqual:@"privacy"] || [listId isEqual:@"ublock-privacy"]) return @"trackers";
  if ([group isEqual:@"malware"] || [listId isEqual:@"ublock-badware"]) return @"security";
  if ([group isEqual:@"annoyances"] || [group isEqual:@"social"]) return @"annoyances";
  return @"ads";
}

double Count(id value) { return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : 0; }

NSString *BundledVersion() {
  NSString *path = [ExtensionPath() stringByAppendingPathComponent:@"manifest.json"];
  NSData *data = path ? [NSData dataWithContentsOfFile:path] : nil;
  NSDictionary *manifest = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![manifest isKindOfClass:NSDictionary.class]) return @"";
  for (NSString *key in @[ @"version_name", @"version" ])
    if ([manifest[key] isKindOfClass:NSString.class]) return manifest[key];
  return @"";
}

NSString *const kState =
    @"Promise.all([lists(), trusted(), fetch('/assets/assets.json').then((r) => r.json())]).then(([l, t, assets]) => {"
     "  const langs = new Set([chrome.i18n.getUILanguage(), ...(navigator.languages || [])].map((x) => (/^[a-z]+/.exec(x) || [])[0]).filter(Boolean));"
     "  const forLanguages = (lang) => typeof lang === 'string' && lang.split(/\\s+/).some((x) => langs.has(x));"
     "  const onByDefault = (id) => !!assets[id] && (assets[id].off !== true || forLanguages(assets[id].lang));"
     "  return {"
     "    lists: Object.entries(l.available)"
     "      .filter(([id, list]) => list && list.content === 'filters' && list.group !== 'user' && list.group !== 'custom')"
     "      .map(([id, list]) => ({id, title: list.title || id, group: list.group || '', enabled: list.off !== true,"
     "        defaultOn: onByDefault(id), filters: list.entryCount || 0})),"
     "    customLists: custom(l).map((id) => {"
     "      const list = l.available[id];"
     "      const cache = (l.cache || {})[id] || {};"
     "      return {id, title: list.title || '', enabled: list.off !== true, filters: list.entryCount || 0,"
     "        downloaded: cache.cached === true, updatedAt: cache.cached === true ? cache.writeTime || 0 : 0,"
     "        error: cache.lastError || cache.error || ''};"
     "    }),"
     "    userFilters: ((l.available[l.userFiltersPath] || {}).off !== true && (l.available[l.userFiltersPath] || {}).entryCount) || 0,"
     "    updating: l.isUpdating === true,"
     "    networkFilters: l.netFilterCount || 0,"
     "    cosmeticFilters: l.cosmeticFilterCount || 0,"
     "    enabled: !t.whitelist.includes(offDirective),"
     "    allowedHosts: t.whitelist.filter((d) => !d.includes('/') && !d.startsWith('#') && !(t.whitelistDefault || []).includes(d)),"
     "  };"
     "})";

void Publish(NSDictionary *change) {
  [NSNotificationCenter.defaultCenter postNotificationName:@"ArdiaContentBlockerDidChange" object:nil userInfo:change];
}

void State(void (^completion)(NSDictionary *state)) {
  completion = [completion copy];
  if (!gDefaultSettled && ArdiaHost.isStarted) return WhenDefaultSettled(^{ State(completion); });
  Call(kProfile, kState, ^(NSDictionary *read, NSString *error) {
    if (![read isKindOfClass:NSDictionary.class] || ![read[@"lists"] isKindOfClass:NSArray.class]) {
      return completion(@{
        @"enabled" : @NO, @"lists" : @[], @"customLists" : @[], @"userFilters" : @0, @"updating" : @NO, @"allowedHosts" : @[],
        @"version" : BundledVersion(),
        @"stats" : @{@"ready" : @NO, @"enabled" : @NO, @"parseMs" : @0, @"lookups" : @0, @"averageLookupMicros" : @0,
                     @"maxLookupMicros" : @0, @"error" : error ?: @"unavailable"},
      });
    }
    NSMutableArray *lists = [NSMutableArray array];
    for (NSDictionary *l in read[@"lists"]) {
      if (![l isKindOfClass:NSDictionary.class] || ![l[@"id"] isKindOfClass:NSString.class]) continue;
      [lists addObject:@{
        @"id" : l[@"id"],
        @"title" : [l[@"title"] isKindOfClass:NSString.class] ? l[@"title"] : l[@"id"],
        @"category" : Category(l[@"id"], [l[@"group"] isKindOfClass:NSString.class] ? l[@"group"] : @""),
        @"enabled" : @([l[@"enabled"] boolValue]),
        @"defaultOn" : @([l[@"defaultOn"] boolValue]),
        @"filters" : @(Count(l[@"filters"])),
      }];
    }
    NSMutableArray *customLists = [NSMutableArray array];
    for (NSDictionary *l in [read[@"customLists"] isKindOfClass:NSArray.class] ? read[@"customLists"] : @[]) {
      if (![l isKindOfClass:NSDictionary.class] || ![l[@"id"] isKindOfClass:NSString.class]) continue;
      [customLists addObject:@{
        @"id" : l[@"id"],
        @"title" : [l[@"title"] isKindOfClass:NSString.class] ? l[@"title"] : @"",
        @"enabled" : @([l[@"enabled"] boolValue]),
        @"filters" : @(Count(l[@"filters"])),
        @"downloaded" : @([l[@"downloaded"] boolValue]),
        @"updatedAt" : @(Count(l[@"updatedAt"])),
        @"error" : [l[@"error"] isKindOfClass:NSString.class] ? l[@"error"] : @"",
      }];
    }
    NSMutableArray *allowed = [NSMutableArray array];
    for (NSString *host in [read[@"allowedHosts"] isKindOfClass:NSArray.class] ? read[@"allowedHosts"] : @[])
      if ([host isKindOfClass:NSString.class]) [allowed addObject:host];
    const BOOL on = [read[@"enabled"] boolValue];
    NSMutableArray *chosen = [NSMutableArray array];
    for (NSDictionary *l in lists)
      if ([l[@"enabled"] boolValue]) [chosen addObject:l[@"id"]];
    Publish(@{@"enabled" : @(on), @"lists" : chosen, @"allowedHosts" : allowed});
    completion(@{
      @"enabled" : @(on),
      @"version" : BundledVersion(),
      @"lists" : lists,
      @"customLists" : customLists,
      @"userFilters" : @(Count(read[@"userFilters"])),
      @"updating" : @([read[@"updating"] boolValue]),
      @"allowedHosts" : allowed,
      @"stats" : @{
        @"ready" : @YES, @"enabled" : @(on), @"networkFilters" : @(Count(read[@"networkFilters"])),
        @"cosmeticFilters" : @(Count(read[@"cosmeticFilters"])), @"parseMs" : @0, @"lookups" : @0,
        @"averageLookupMicros" : @0, @"maxLookupMicros" : @0,
      },
    });
  });
}

void Changed(NSString *error, void (^completion)(NSString *error)) {
  if (error) return completion(error);
  completion = [completion copy];
  FollowDefault(nil, ^(NSString *followError) {
    State(^(NSDictionary *state) { [ArdiaEvents emit:@"contentBlocker.changed" data:state[@"stats"]]; });
    completion(followError);
  });
}

void ListsChanged(NSString *error, void (^completion)(NSString *error)) {
  if (error) return completion(error);
  completion(nil);
  State(^(NSDictionary *state) { [ArdiaEvents emit:@"contentBlocker.changed" data:state[@"stats"]]; });
  FollowDefault(nil, ^(NSString *followError) {
    if (followError) NSLog(@"[blocker] the other profiles didn't take the list change: %@", followError);
  });
}

}

namespace ardia_host {

void PrepareContentBlocker() {
  StartPreparing();
}

void LoadContentBlocker(NSString *profile) {
  if (!IsPrivateProfile(profile)) LoadHeld(profile ?: @"");
}

}

@implementation ArdiaContentBlocker

+ (void)state:(void (^)(NSDictionary<NSString *, id> *))completion {
  State(completion);
}

+ (void)setEnabled:(BOOL)enabled completion:(void (^)(NSString *))completion {
  NSString *script = @"trusted().then((t) => {"
                      "  const on = %@;"
                      "  const kept = t.whitelist.filter((d) => d !== offDirective);"
                      "  return send({what: 'setWhitelist', whitelist: (on ? kept : kept.concat([offDirective])).join('\\n')});"
                      "}).then(() => send({what: 'userSettings', name: 'autoUpdate', value: %@}))";
  Call(kProfile, ScriptWith(script, @[ @(enabled), @(enabled) ]), ^(id, NSString *error) {
    if (!error) Publish(@{@"enabled" : @(enabled)});
    Changed(error, completion);
  });
}

+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(NSString *))completion {
  NSString *script = @"lists().then((l) => {"
                      "  const [id, on] = [%@, %@];"
                      "  if (!l.available[id]) throw new Error(`no list ${id}`);"
                      "  const keep = selected(l).filter((x) => x !== id);"
                      "  return applyLists(on ? keep.concat([id]) : keep);"
                      "})";
  Call(kProfile, ScriptWith(script, @[ listId, @(enabled) ]), ^(id, NSString *error) {
    if (!error) Publish(@{@"list" : listId, @"listEnabled" : @(enabled)});
    ListsChanged(error, completion);
  });
}

+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL))completion {
  NSString *script = @"trusted().then((t) => t.whitelist.some((d) => covers(d, %@)))";
  Call(kProfile, ScriptWith(script, @[ host.lowercaseString ]), ^(id allowed, NSString *error) {
    completion(!error && [allowed isKindOfClass:NSNumber.class] && [allowed boolValue]);
  });
}

+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(NSString *))completion {
  NSString *script = @"trusted().then((t) => {"
                      "  const [allowed, host] = [%@, %@];"
                      "  const kept = t.whitelist.filter((d) => allowed ? d !== host : !covers(d, host));"
                      "  return send({what: 'setWhitelist', whitelist: (allowed ? kept.concat([host]) : kept).join('\\n')});"
                      "})";
  Call(kProfile, ScriptWith(script, @[ @(allowed), host.lowercaseString ]), ^(id, NSString *error) {
    if (!error) Publish(@{@"host" : host.lowercaseString, @"allowed" : @(allowed)});
    Changed(error, completion);
  });
}

+ (void)addList:(NSString *)url completion:(void (^)(NSDictionary<NSString *, id> *, NSString *))completion {
  NSString *script = @"lists().then((l) => {"
                      "  const url = %@;"
                      "  const stockBefore = new Set(selected(l));"
                      "  const done = (after) => {"
                      "    const entry = after.available[url];"
                      "    if (!entry || entry.group !== 'custom') {"
                      "      const stock = selected(after).find((k) => !stockBefore.has(k) && !k.includes('://') && fromAddress(after, k, url));"
                      "      if (stock && (((after.cache || {})[stock] || {}).cached !== true || !after.available[stock].entryCount))"
                      "        throw new Error(`Couldn't download ${after.available[stock].title || stock}, the built-in list at that address.`);"
                      "      if (stock) return {id: stock, title: after.available[stock].title || stock, builtIn: true, filters: after.available[stock].entryCount || 0};"
                      "      const already = selected(after).find((k) => !k.includes('://') && fromAddress(after, k, url));"
                      "      if (already && (((after.cache || {})[already] || {}).cached !== true || !after.available[already].entryCount))"
                      "        throw new Error(`${after.available[already].title || already}, the built-in list at that address, hasn't downloaded yet.`);"
                      "      if (already) return {id: already, title: after.available[already].title || already, builtIn: true, filters: after.available[already].entryCount || 0};"
                      "      throw new Error('uBlock Origin refused this list.');"
                      "    }"
                      "    const cache = (after.cache || {})[url] || {};"
                      "    if (cache.cached !== true || !entry.entryCount) {"
                      "      const why = cache.cached !== true ? `Couldn't download the list${cache.lastError ? ` (${cache.lastError})` : ''}.`"
                      "        : 'No filters found at that address.';"
                      "      throw new Error(why);"
                      "    }"
                      "    return {id: url, title: entry.title || '', builtIn: false, filters: entry.entryCount || 0};"
                      "  };"
                      "  const fetched = (tries) => reloadLists().then(lists).then((after) => {"
                      "    const cache = (after.cache || {})[url] || {};"
                      "    return cache.cached === true || cache.lastError || tries <= 1 ? after : fetched(tries - 1);"
                      "  });"
                      "  return local.set({ardiaPendingFilterImport: {url, selectedBefore: [...stockBefore]}}).then(askReload)"
                      "    .then(() => send({what: 'applyFilterListSelection', toImport: url}))"
                      "    .then(() => fetched(3)).then(done).then((added) => local.remove('ardiaPendingFilterImport').then(() => added));"
                      "})";
  CallWithin(kProfile, ScriptWith(script, @[ url ]), kDownloadSeconds, ^(NSDictionary *added, NSString *error) {
    if (!error && ![added isKindOfClass:NSDictionary.class]) error = @"no answer";
    if (!error) return Changed(nil, ^(NSString *changeError) { completion(added, changeError); });
    CallWithin(kProfile, @"null", kDownloadSeconds, ^(id, NSString *cleanupError) {
      if (cleanupError) return completion(nil, [NSString stringWithFormat:@"%@ List cleanup failed: %@", error, cleanupError]);
      Changed(nil, ^(NSString *changeError) {
        completion(nil, changeError ? [NSString stringWithFormat:@"%@ Profile synchronization failed: %@", error, changeError] : error);
      });
    });
  });
}

+ (void)removeList:(NSString *)listId completion:(void (^)(NSString *))completion {
  NSString *script = @"lists().then((l) => {"
                      "  const id = %@;"
                      "  if (!custom(l).includes(id)) return null;"
                      "  return askReload()"
                      "    .then(() => send({what: 'applyFilterListSelection', toRemove: [id]})).then(reloadLists);"
                      "})";
  Call(kProfile, ScriptWith(script, @[ listId ]), ^(id, NSString *error) {
    Changed(error, completion);
  });
}

+ (void)updateList:(NSString *)listId completion:(void (^)(NSString *))completion {
  NSString *script = @"lists().then((l) => {"
                      "  const [id, follower] = [%@, %@];"
                      "  if (!custom(l).includes(id)) { if (follower) return null; throw new Error('That list is gone.'); }"
                      "  if (l.available[id].off === true) { if (follower) return null; throw new Error('Turn the list on to update it.'); }"
                      "  const started = Date.now();"
                      "  const ask = () => send({what: 'listsUpdateNow', assetKeys: [id], preferOrigin: true});"
                      "  const settled = (again) => new Promise((resolve) => setTimeout(resolve, 250)).then(lists).then((now) => {"
                      "    if (now.isUpdating === true) return settled(again);"
                      "    const cache = (now.cache || {})[id] || {};"
                      "    if (cache.cached === true && (cache.writeTime || 0) >= started) return reloadLists().then(() => null);"
                      "    if (again && !cache.lastError) return ask().then(() => settled(false));"
                      "    throw new Error(`Couldn't update the list${cache.lastError ? ` (${cache.lastError})` : ''}.`);"
                      "  });"
                      "  return ask().then(() => settled(true));"
                      "})";
  CallWithin(kProfile, ScriptWith(script, @[ listId, @NO ]), kDownloadSeconds, ^(id, NSString *error) {
    if (error) return completion(error);
    ForgetGoneProfiles();
    dispatch_group_t group = dispatch_group_create();
    __block NSString *failed;
    for (NSString *profile in LoadedProfiles().array) {
      if (!profile.length) continue;
      dispatch_group_enter(group);
      CallWithin(profile, ScriptWith(script, @[ listId, @YES ]), kDownloadSeconds, ^(id, NSString *updateError) {
        const bool gone = !ardia_host::LoadedProfile(profile) || ardia_host::IsDeletedProfile(profile);
        if (!gone && updateError) failed = failed ?: [NSString stringWithFormat:@"Profile %@: %@", profile, updateError];
        dispatch_group_leave(group);
      });
    }
    dispatch_group_notify(group, dispatch_get_main_queue(), ^{
      Changed(nil, ^(NSString *changeError) {
        completion(failed && changeError ? [NSString stringWithFormat:@"%@ Profile synchronization failed: %@", failed, changeError] : failed ?: changeError);
      });
    });
  });
}

+ (void)userFilters:(void (^)(NSString *, NSString *))completion {
  Call(kProfile, @"userFilters().then((u) => u.text)", ^(NSString *text, NSString *error) {
    completion([text isKindOfClass:NSString.class] ? text : @"", error);
  });
}

+ (void)setUserFilters:(NSString *)text completion:(void (^)(NSString *))completion {
  NSString *script = @"userFilters().then((u) => askReload()"
                      "  .then(() => send({what: 'writeUserFilters', content: %@, enabled: true, trusted: u.trusted})))"
                      "  .then(reloadLists)";
  Call(kProfile, ScriptWith(script, @[ text ]), ^(id, NSString *error) {
    Changed(error, completion);
  });
}

+ (void)devFailNextMessage {
  gFailNextMessage = true;
}

+ (void)devDelayNextLoad:(double)ms {
  gDelayNextLoadMs = ms;
}

@end
