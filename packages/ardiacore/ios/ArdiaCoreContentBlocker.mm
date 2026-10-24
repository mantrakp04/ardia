#import "ArdiaCoreServices.h"
#import "ArdiaCoreInternal.h"

#include <utility>

namespace {
NSString *const kUBlock = @"ublock";
NSString *const kAdNauseam = @"adnauseam";
NSString *const kUBlockId = @"fajbdaomknpkicfjcpipdmcpoamdmilh";
NSString *const kAdNauseamId = @"kmggppiioddbnikpjfodfabgmboeihij";
NSString *const kLiteId = @"bnjeokpoejhioagiokhkhmdogkhbnbki";
NSString *const kLiteReaderName = @"ublock-lite-settings";
NSString *const kLiteMovedMarker = @"uBlock Origin Lite settings moved";
bool gFailNextMessage = false;
double gDelayNextLoadMs = 0;

NSString *PreferencesPath() { return [ArdiaCoreHost.dataDirectory stringByAppendingPathComponent:@"Content Blocker.json"]; }

NSDictionary *Preferences() {
  NSData *data = [NSData dataWithContentsOfFile:PreferencesPath()];
  id saved = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [saved isKindOfClass:NSDictionary.class] ? saved : @{};
}

NSString *gSelectedProviderOverride;

NSString *SelectedProvider() {
  if (gSelectedProviderOverride) return gSelectedProviderOverride;
  NSDictionary *saved = Preferences();
  return [saved[@"provider"] isEqual:kAdNauseam] && [saved[@"clickAds"] isEqual:@YES] ? kAdNauseam : kUBlock;
}

NSNumber *gClickConsent;
NSUInteger gClickIntent = 0;
bool gBlockingOffIntent = false;

bool ClickConsent() {
  if (!gClickConsent) gClickConsent = @([SelectedProvider() isEqual:kAdNauseam]);
  return gClickConsent.boolValue;
}

NSString *SavePreferences(NSString *provider, bool clickAds) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"provider" : provider, @"clickAds" : @(clickAds)} options:0 error:nil];
  if (![data writeToFile:PreferencesPath() atomically:YES]) return @"couldn't save the content blocker's settings";
  gSelectedProviderOverride = nil;
  return nil;
}

NSString *gProvider = kUBlock;
bool gSwitching = false;
NSUInteger gProviderGeneration = 1;
NSString *gSwitchFailure;
NSString *const kProviderChanged = @"the content blocker changed";

NSMutableArray<void (^)(void)> *SwitchWaiters() {
  static NSMutableArray *waiters = [NSMutableArray array];
  return waiters;
}

NSMutableOrderedSet<NSString *> *DeferredProfiles() {
  static NSMutableOrderedSet *profiles = [NSMutableOrderedSet orderedSet];
  return profiles;
}

bool UsesAdNauseam() { return [gProvider isEqual:kAdNauseam]; }
NSString *ExtensionId() { return UsesAdNauseam() ? kAdNauseamId : kUBlockId; }
NSString *ProviderTitle() { return UsesAdNauseam() ? @"AdNauseam" : @"uBlock Origin"; }
}

@interface ACContentBlockerPage : NSObject <ArdiaCoreTabDelegate>
@property(readonly) ArdiaCoreTab *tab;
@property(readonly) NSString *origin;
@property(readonly) BOOL dead;
@end

@implementation ACContentBlockerPage {
  NSMutableArray<NSArray *> *_calls;
  void (^_inflight)(id value, NSString *error);
  BOOL _started;
  BOOL _loaded;
  BOOL _busy;
}

- (instancetype)initWithTab:(ArdiaCoreTab *)tab origin:(NSString *)origin {
  if ((self = [super init])) {
    _tab = tab;
    _origin = origin;
    _calls = [NSMutableArray array];
    _started = tab.loading;
    tab.delegate = self;
  }
  return self;
}

- (BOOL)onOwnPage {
  return !_dead && [_tab.url hasPrefix:_origin];
}

- (void)run:(NSString *)script completion:(void (^)(id value, NSString *error))completion {
  if (_dead) return completion(nil, @"closed");
  [_calls addObject:@[ script, [completion copy] ]];
  [self next];
}

- (void)leftOwnPage {
  [self fail:[@"not the extension page: " stringByAppendingString:_tab.url ?: @""]];
}

- (void)next {
  if (_dead || !_loaded || _busy || !_calls.count) return;
  if (!self.onOwnPage) return [self leftOwnPage];
  NSArray *call = _calls.firstObject;
  [_calls removeObjectAtIndex:0];
  _inflight = call[1];
  _busy = YES;
  [_tab evaluate:call[0]
      completion:^(NSString *json) {
        void (^completion)(id, NSString *) = self->_inflight;
        if (!completion) return;
        if (!self.onOwnPage) return [self leftOwnPage];
        self->_inflight = nil;
        self->_busy = NO;
        NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *answer = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        NSString *error = ![answer isKindOfClass:NSDictionary.class] ? @"no answer"
                          : [answer[@"error"] isKindOfClass:NSString.class] ? answer[@"error"]
                                                                              : nil;
        id value = error || answer[@"value"] == NSNull.null ? nil : answer[@"value"];
        completion(value, error);
        [self next];
      }];
}

- (void)fail:(NSString *)error {
  if (_dead) return;
  _dead = YES;
  NSArray<NSArray *> *calls = _calls;
  _calls = nil;
  void (^inflight)(id, NSString *) = _inflight;
  _inflight = nil;
  ArdiaCoreTab *tab = _tab;
  dispatch_async(dispatch_get_main_queue(), ^{
    [tab closeNow];
    if (inflight) inflight(nil, error);
    for (NSArray *call in calls) ((void (^)(id, NSString *))call[1])(nil, error);
  });
}

- (void)tabDidChangeLoading:(ArdiaCoreTab *)tab {
  _started = _started || tab.loading;
  _loaded = _started && !tab.loading;
  [self next];
}

- (void)tabDidChangeURL:(ArdiaCoreTab *)tab {
  if (tab.url.length && !self.onOwnPage) [self leftOwnPage];
}

- (void)tabDidCommitDocument:(ArdiaCoreTab *)tab {
  if (!self.onOwnPage) [self leftOwnPage];
}

- (void)tabWillClose:(ArdiaCoreTab *)tab {
  [self fail:@"closed"];
}

- (void)tab:(ArdiaCoreTab *)tab rendererGone:(NSString *)status code:(int)code {
  [self fail:[@"renderer " stringByAppendingString:status]];
}

- (void)tab:(ArdiaCoreTab *)tab didFailLoad:(NSString *)url code:(int)code description:(NSString *)text {
  if (code != -3) [self fail:text];
}

@end

@interface ACContentBlockerOp : NSObject
@property(copy) NSString *profile;
@property(copy) NSString *expression;
@property(copy) void (^completion)(id value, NSString *error);
@property int attemptsLeft;
@property(copy) NSNumber *clickIntent;
@property BOOL failNext;
@property NSTimeInterval deadline;
@property NSUInteger attempt;
@property NSUInteger generation;
@end

@implementation ACContentBlockerOp
@end

namespace {

NSString *ScriptWith(NSString *format, NSArray *args) {
  NSMutableString *out = [NSMutableString string];
  NSArray<NSString *> *parts = [format componentsSeparatedByString:@"%@"];
  for (NSUInteger i = 0; i < parts.count; i++) {
    [out appendString:parts[i]];
    if (i < args.count) {
      NSData *json = [NSJSONSerialization dataWithJSONObject:args[i] options:NSJSONWritingFragmentsAllowed error:nil];
      [out appendString:json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"null"];
    }
  }
  return out;
}

NSString *const kProfile = @"";

NSMutableOrderedSet<NSString *> *LoadedProfiles() {
  static NSMutableOrderedSet<NSString *> *profiles = [NSMutableOrderedSet orderedSet];
  return profiles;
}

NSMutableDictionary<NSString *, ArdiaCoreWindow *> *PageWindows() {
  static NSMutableDictionary *windows = [NSMutableDictionary dictionary];
  return windows;
}

NSMutableDictionary<NSString *, ACContentBlockerPage *> *Pages() {
  static NSMutableDictionary *pages = [NSMutableDictionary dictionary];
  return pages;
}

NSString *OriginOf(NSString *extensionId) { return [NSString stringWithFormat:@"chrome-extension://%@/", extensionId]; }

ACContentBlockerPage *HiddenPage(NSString *key, NSString *profile, ArdiaCoreProfile *p, NSString *extensionId, NSString *file) {
  ACContentBlockerPage *page = Pages()[key];
  if (page.tab.closed) [page fail:@"closed"];
  if (page && !page.dead) return page;
  ArdiaCoreWindow *window = PageWindows()[profile];
  if (!window) {
    PageWindows()[profile] = window = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 400, 300)];
    if ([window respondsToSelector:@selector(setInternal:)]) window.internal = YES;
  }
  ArdiaCoreTab *tab = [window openTab:[OriginOf(extensionId) stringByAppendingString:file] profile:p foreground:YES];
  return Pages()[key] = tab ? [[ACContentBlockerPage alloc] initWithTab:tab origin:OriginOf(extensionId)] : nil;
}

ACContentBlockerPage *PageFor(NSString *profile, ArdiaCoreProfile *p) {
  return HiddenPage(profile, profile, p, ExtensionId(), @"blank.html");
}

NSString *BundledExtension(NSString *provider) {
  NSString *bundled = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:[@"Extensions" stringByAppendingPathComponent:provider]];
  return [NSFileManager.defaultManager fileExistsAtPath:[bundled stringByAppendingPathComponent:@"manifest.json"]] ? bundled : nil;
}

NSString *gExtensionPath;

void StartPreparing() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSString *selected = SelectedProvider();
    gExtensionPath = BundledExtension(selected);
    if (gExtensionPath) gProvider = selected;
    else if (![selected isEqual:kUBlock]) {
      gExtensionPath = BundledExtension(kUBlock);
      gSelectedProviderOverride = kUBlock;
      gClickConsent = @NO;
      if (NSString *error = SavePreferences(kUBlock, false)) NSLog(@"[blocker] unavailable provider fallback: %@", error);
    }
    NSString *oldCopies = [[ArdiaCoreHost.dataDirectory stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"Built-in Extensions"];
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
void RestoreClicksAfterBackgroundLoad(NSString *profile, NSUInteger generation);

void LoadIntoProfile(NSString *profile, void (^then)(NSString *error)) {
  then = [then copy];
  const NSUInteger generation = gProviderGeneration;
  StartPreparing();
  void (^load)(void) = ^{
    if ([LoadedProfiles() containsObject:profile]) return then(nil);
    ardiacore_host::WithProfile(profile, ^(ArdiaCoreProfile *p) {
      if (generation != gProviderGeneration) return then(kProviderChanged);
      if ([LoadedProfiles() containsObject:profile]) return then(nil);
      NSString *path = gExtensionPath;
      if (!p || !path || ![p respondsToSelector:@selector(loadComponentExtension:)]) return then(@"not loaded");
      if ([p respondsToSelector:@selector(watchComponentExtensionBackground:onLoad:)]) {
        void (^onLoad)(void) = nil;
        if (UsesAdNauseam()) onLoad = ^{ RestoreClicksAfterBackgroundLoad(profile, generation); };
        [p watchComponentExtensionBackground:kAdNauseamId onLoad:onLoad];
      }
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

bool gDefaultSettled = false;
bool gLaunching = true;
constexpr double kSettleAfterLaunchSeconds = 1.5;

bool SettleWithoutPage() {
  const char *pagelessSettle = getenv("ARDIA_BLOCKER_PAGELESS_SETTLE");
  return !(pagelessSettle && !strcmp(pagelessSettle, "off"));
}

constexpr int kAttempts = 40;
constexpr double kRetryMs = 250;
constexpr double kOpSeconds = 20;

NSString *const kPrelude =
    @"let failing = %@;"
     "const offDirective = %@;"
     "const extensionOrigin = %@;"
     "const blockerName = %@;"
     "const backgroundDocument = chrome.extension.getBackgroundPage()?.document;"
     "const deadline = Date.now() + %@;"
     "const left = () => Math.max(0, deadline - Date.now());"
     "let expired = false;"
     "const withDeadline = (promise, what) => new Promise((resolve, reject) => {"
     "  const timer = setTimeout(() => { expired = true; reject(new Error(`${what}: timed out`)); }, left());"
     "  promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });"
     "});"
     "const ready = () => new Promise((resolve, reject) => {"
     "  const look = () => {"
     "    const ublock = chrome.extension.getBackgroundPage()?.µBlock;"
     "    if (ublock?.isReadyPromise) return ublock.isReadyPromise.then(resolve, reject);"
     "    if (left() === 0) return reject(new Error(`${blockerName} never started`));"
     "    setTimeout(look, 10);"
     "  };"
     "  look();"
     "});"
     "const loadScript = (src) => new Promise((resolve, reject) => {"
     "  const element = document.createElement('script');"
     "  element.src = src;"
     "  element.onload = resolve;"
     "  element.onerror = () => reject(new Error(`${src} didn't load`));"
     "  document.head.append(element);"
     "});"
     "const client = () => self.vAPI?.messaging ? Promise.resolve()"
     "  : ['js/vapi.js', 'js/vapi-common.js', 'js/vapi-client.js'].reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve());"
     "const send = (message) => {"
     "  if (expired) return Promise.reject(new Error(`${message.what}: timed out`));"
     "  if (failing) { failing = false; return Promise.reject(new Error(`${message.what}: failed (dev)`)); }"
     "  return client().then(() => {"
     "    if (expired) throw new Error(`${message.what}: timed out`);"
     "    return vAPI.messaging.send('dashboard', message);"
     "  }).then((reply) => {"
     "    if (reply === undefined) throw new Error(`${message.what}: no reply`);"
     "    return reply;"
     "  });"
     "};"
     "const trusted = () => send({what: 'getWhitelist'}).then((t) => {"
     "  if (!t || !Array.isArray(t.whitelist)) throw new Error('getWhitelist: no answer');"
     "  return {...t, whitelistDefault: t.whitelistDefault || chrome.extension.getBackgroundPage()?.µBlock?.netWhitelistDefault || []};"
     "});"
     "const lists = () => send({what: 'getLists'}).then((l) => {"
     "  if (!l || !l.available || typeof l.available !== 'object') throw new Error('getLists: no answer');"
     "  return l;"
     "});"
     "const selected = (l) => Object.keys(l.available).filter((k) => l.available[k] && l.available[k].off !== true);"
     "const covers = (directive, host) => !directive.includes('/') && (host === directive || host.endsWith('.' + directive));"
     "const sameSet = (a, b) => [...a].sort().join('\\n') === [...b].sort().join('\\n');"
     "const storageCall = (name, arg) => expired ? Promise.reject(new Error(`storage ${name}: timed out`))"
     "  : new Promise((resolve, reject) => chrome.storage.local[name](arg, (v) =>"
     "    chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(v || {})));"
     "const local = {get: (k) => storageCall('get', k), set: (v) => storageCall('set', v), remove: (k) => storageCall('remove', k)};"
     "const reloadLists = () => send({what: 'reloadAllFilters'}).then(() => local.remove('ardiaReloadPending'));"
     "const applyLists = (toSelect) => local.set({ardiaReloadPending: true})"
     "  .then(() => send({what: 'applyFilterListSelection', toSelect})).then(reloadLists);"
     "const settlePending = () => local.get('ardiaReloadPending').then((b) => b.ardiaReloadPending ? reloadLists() : null);"
     "const stopClicks = () => {"
     "  const background = chrome.extension.getBackgroundPage();"
     "  if (typeof background?.ardiaStopClicks !== 'function') return;"
     "  background.ardiaClickConsent = false;"
     "  background.ardiaStopClicks();"
     "};"
     "Promise.resolve().then(() => { if (location.origin !== extensionOrigin) throw new Error(`not the extension page: ${location.href}`); })"
     ".then(() => withDeadline(ready(), blockerName))"
     ".then(() => withDeadline(settlePending().then(() => (%@)), 'the call'))"
     ".then((v) => post('result', JSON.stringify({value: v === undefined ? null : v})),"
     "(e) => post('result', JSON.stringify({error: String(e && e.message || e)})))";

NSMutableDictionary<NSString *, NSMutableArray<ACContentBlockerOp *> *> *Queues() {
  static NSMutableDictionary *queues = [NSMutableDictionary dictionary];
  return queues;
}

NSMutableSet<NSString *> *BusyProfiles() {
  static NSMutableSet *busy = [NSMutableSet set];
  return busy;
}

void Pump(NSString *profile);

constexpr double kPageIdleSeconds = 30;

NSMutableDictionary<NSString *, NSNumber *> *Uses() {
  static NSMutableDictionary *uses = [NSMutableDictionary dictionary];
  return uses;
}

void CloseWhenIdle(NSString *profile) {
  const NSUInteger use = Uses()[profile].unsignedIntegerValue + 1;
  Uses()[profile] = @(use);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPageIdleSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (Uses()[profile].unsignedIntegerValue != use || [BusyProfiles() containsObject:profile] || Queues()[profile].count) return;
    [Pages()[profile] fail:@"idle"];
    [Pages() removeObjectForKey:profile];
  });
}

void Finish(ACContentBlockerOp *op, id value, NSString *error) {
  if (op.generation != gProviderGeneration) return;
  NSMutableArray *queue = Queues()[op.profile];
  if (queue.firstObject == op) [queue removeObjectAtIndex:0];
  [BusyProfiles() removeObject:op.profile];
  if (error) NSLog(@"[blocker] profile \"%@\": %@", op.profile, error);
  op.completion(value, error);
  Pump(op.profile);
  if (!Queues()[op.profile].count) CloseWhenIdle(op.profile);
}

bool Retriable(NSString *error, ACContentBlockerPage *page) {
  if (!page.onOwnPage) return true;
  for (NSString *sign in @[ @"no reply", @"no answer", @"context invalidated", @"not the extension page", @"background restarted", @"renderer ", @"closed" ])
    if ([error containsString:sign]) return true;
  return false;
}

void Attempt(ACContentBlockerOp *op) {
  if (op.generation != gProviderGeneration) return;
  NSString *profile = op.profile;
  if (op.clickIntent && op.clickIntent.unsignedIntegerValue != gClickIntent) return Finish(op, nil, nil);
  if (!ArdiaCoreHost.isStarted) return Finish(op, nil, @"unavailable");
  if (![LoadedProfiles() containsObject:profile]) {
    return LoadIntoProfile(profile, ^(NSString *error) {
      if (error) Finish(op, nil, error);
      else Attempt(op);
    });
  }
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  ACContentBlockerPage *page = p ? PageFor(profile, p) : nil;
  if (!page) return Finish(op, nil, @"not loaded");
  const double leftMs = MAX(0, (op.deadline - NSDate.timeIntervalSinceReferenceDate) * 1000);
  NSString *script = [NSString stringWithFormat:kPrelude, op.failNext ? @"true" : @"false", ScriptWith(@"%@", @[ kOffDirective ]),
                                                ScriptWith(@"%@", @[ [@"chrome-extension://" stringByAppendingString:ExtensionId()] ]),
                                                ScriptWith(@"%@", @[ ProviderTitle() ]), @((long long)leftMs), op.expression];
  const NSUInteger attempt = ++op.attempt;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((leftMs + 2000) * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
    if (op.attempt == attempt && Queues()[profile].firstObject == op) [page fail:@"the call timed out"];
  });
  [page run:script
      completion:^(id value, NSString *error) {
        if (op.attempt != attempt || op.generation != gProviderGeneration) return;
        if ([error hasSuffix:@"failed (dev)"]) op.failNext = NO;
        if ([error containsString:@"timed out"]) [page fail:error];
        const bool inTime = NSDate.timeIntervalSinceReferenceDate < op.deadline;
        if (error && op.attemptsLeft > 0 && inTime && Retriable(error, page) && [LoadedProfiles() containsObject:profile] &&
            !ardiacore_host::IsDeletedProfile(profile)) {
          op.attemptsLeft--;
          [page fail:[ProviderTitle() stringByAppendingString:@" restarted"]];
          dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRetryMs * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
            Attempt(op);
          });
          return;
        }
        Finish(op, value, error);
      }];
}

void Pump(NSString *profile) {
  if ([BusyProfiles() containsObject:profile]) return;
  ACContentBlockerOp *op = Queues()[profile].firstObject;
  if (!op) return;
  [BusyProfiles() addObject:profile];
  Attempt(op);
}

void Call(NSString *profile, NSString *expression, void (^completion)(id value, NSString *error), NSNumber *clickIntent = nil) {
  ACContentBlockerOp *op = [ACContentBlockerOp new];
  op.profile = profile;
  op.generation = gProviderGeneration;
  op.clickIntent = clickIntent;
  op.expression = expression;
  op.completion = completion;
  op.attemptsLeft = kAttempts;
  op.deadline = NSDate.timeIntervalSinceReferenceDate + kOpSeconds;
  if (gFailNextMessage && ![expression isEqualToString:@"null"]) {
    op.failNext = YES;
    gFailNextMessage = false;
  }
  NSMutableArray *queue = Queues()[profile] ?: (Queues()[profile] = [NSMutableArray array]);
  [queue addObject:op];
  Pump(profile);
}

NSString *const kRead =
    @"Promise.all([lists(), trusted()]).then(([l, t]) => ({lists: selected(l).sort(), whitelist: [...t.whitelist].sort(), autoUpdate: l.autoUpdate !== false}))";

NSString *const kSetEnabled =
    @"trusted().then((t) => {"
     "  const on = %@;"
     "  const kept = t.whitelist.filter((d) => d !== offDirective);"
     "  if (!on) stopClicks();"
     "  return send({what: 'setWhitelist', whitelist: (on ? kept : kept.concat([offDirective])).join('\\n')});"
     "}).then(() => send({what: 'userSettings', name: 'autoUpdate', value: %@}))";

NSString *const kFollow =
    @"Promise.all([lists(), trusted()]).then(([l, t]) => {"
     "  const want = %@;"
     "  if (!Array.isArray(want.lists) || !Array.isArray(want.whitelist)) throw new Error('no settings to copy');"
     "  if (want.whitelist.includes(offDirective)) stopClicks();"
     "  let written = Promise.resolve(null);"
     "  if (!sameSet(selected(l), want.lists))"
     "    written = written.then(() => applyLists(want.lists));"
     "  if (!sameSet(t.whitelist, want.whitelist))"
     "    written = written.then(() => send({what: 'setWhitelist', whitelist: want.whitelist.join('\\n')}));"
     "  if ((l.autoUpdate !== false) !== (want.autoUpdate !== false))"
     "    written = written.then(() => send({what: 'userSettings', name: 'autoUpdate', value: want.autoUpdate !== false}));"
     "  return written.then(() => null);"
     "})";

NSString *const kClicks =
    @"trusted().then((t) => {"
     "  const [consent, token] = [%@, %@];"
     "  const background = chrome.extension.getBackgroundPage();"
     "  if (typeof background?.ardiaStopClicks !== 'function') throw new Error('AdNauseam has no click switch');"
     "  const current = () => {"
     "    if (chrome.extension.getBackgroundPage()?.document !== backgroundDocument) throw new Error('AdNauseam background restarted');"
     "    return token >= (background.ardiaClickToken ?? 0);"
     "  };"
     "  if (!current()) return null;"
     "  const allowed = consent && !t.whitelist.includes(offDirective);"
     "  if (!allowed) {"
     "    background.ardiaClickToken = token;"
     "    stopClicks();"
     "  }"
     "  return send({what: 'userSettings', name: 'clickingAds', value: consent}).then(() => {"
     "    if (!current()) return null;"
     "    background.ardiaClickToken = token;"
     "    if (allowed) background.ardiaClickConsent = true;"
     "    return null;"
     "  });"
     "})";

NSString *const kRevokeClicks =
    @"(() => {"
     "  const background = chrome.extension.getBackgroundPage();"
     "  if (!background) return null;"
     "  const token = %@;"
     "  if (token < (background.ardiaClickToken ?? 0)) return null;"
     "  background.ardiaClickToken = token;"
     "  background.ardiaClickConsent = false;"
     "  if (typeof background.ardiaStopClicks === 'function') background.ardiaStopClicks();"
     "  return null;"
     "})()";

NSString *const kOwnPageCall =
    @"Promise.resolve().then(() => %@)"
     ".then((v) => post('result', JSON.stringify({value: v === undefined ? null : v})),"
     "(e) => post('result', JSON.stringify({error: String(e && e.message || e)})))";

constexpr double kRevokeSeconds = 5;
NSUInteger gRevokePages = 0;

void RevokeOnOwnPage(NSString *profile, NSString *expression, void (^done)(NSString *error)) {
  done = [done copy];
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  if (!p || ardiacore_host::IsDeletedProfile(profile)) return done(nil);
  NSString *key = [NSString stringWithFormat:@"revoke:%lu:%@", (unsigned long)++gRevokePages, profile];
  ACContentBlockerPage *page = HiddenPage(key, profile, p, ExtensionId(), @"blank.html");
  if (!page) return done(@"couldn't reach AdNauseam to stop ad clicking");
  __block bool answered = false;
  void (^finish)(NSString *) = ^(NSString *error) {
    if (answered) return;
    answered = true;
    [page fail:@"done"];
    [Pages() removeObjectForKey:key];
    done(error);
  };
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRevokeSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    finish(@"AdNauseam didn't confirm that ad clicking stopped");
  });
  [page run:[NSString stringWithFormat:kOwnPageCall, expression] completion:^(id, NSString *error) { finish(error); }];
}

void StopClicksNow(NSArray<NSString *> *profiles, NSUInteger token, void (^done)(NSString *error)) {
  done = [done copy];
  if (!UsesAdNauseam()) return done(nil);
  NSString *script = ScriptWith(kRevokeClicks, @[ @(token) ]);
  dispatch_group_t group = dispatch_group_create();
  __block NSString *failed;
  for (NSString *profile in profiles) {
    ACContentBlockerOp *pending = Queues()[profile].firstObject;
    if (pending.clickIntent && pending.clickIntent.unsignedIntegerValue != token) {
      [Pages()[profile] fail:@"ad clicking intent changed; closed"];
      [Pages() removeObjectForKey:profile];
    }
    dispatch_group_enter(group);
    RevokeOnOwnPage(profile, script, ^(NSString *error) {
      failed = failed ?: error;
      dispatch_group_leave(group);
    });
  }
  dispatch_group_notify(group, dispatch_get_main_queue(), ^{ done(failed); });
}

void ApplyClicks(NSArray<NSString *> *profiles, bool consent, NSUInteger token, void (^done)(NSString *error)) {
  done = [done copy];
  if (!UsesAdNauseam() || !profiles.count) return done(nil);
  NSString *script = ScriptWith(kClicks, @[ @(consent), @(token) ]);
  dispatch_group_t group = dispatch_group_create();
  __block NSString *failed;
  for (NSString *profile in profiles) {
    dispatch_group_enter(group);
    Call(profile, script, ^(id, NSString *error) {
      const bool gone = !ardiacore_host::LoadedProfile(profile) || ardiacore_host::IsDeletedProfile(profile);
      if (!gone) failed = failed ?: error;
      dispatch_group_leave(group);
    }, @(token));
  }
  dispatch_group_notify(group, dispatch_get_main_queue(), ^{ done(failed); });
}

void LogClicksError(NSString *error) {
  if (error) NSLog(@"[blocker] AdNauseam's ad clicking setting didn't apply: %@", error);
}

void ApplyConsentedClicks(NSArray<NSString *> *profiles) {
  if (!UsesAdNauseam() || !ClickConsent() || gBlockingOffIntent) return;
  ApplyClicks(profiles, true, gClickIntent, ^(NSString *error) { LogClicksError(error); });
}

void RestoreClicksAfterBackgroundLoad(NSString *profile, NSUInteger generation) {
  const NSUInteger token = gClickIntent;
  bool (^current)(void) = ^{
    return generation == gProviderGeneration && token == gClickIntent && !gSwitching &&
           UsesAdNauseam() && ClickConsent() && !gBlockingOffIntent &&
           [LoadedProfiles() containsObject:profile] && ardiacore_host::LoadedProfile(profile) &&
           !ardiacore_host::IsDeletedProfile(profile);
  };
  if (!current()) return;
  WhenDefaultSettled(^{
    if (!current()) return;
    if (!profile.length) return ApplyConsentedClicks(@[ profile ]);
    FollowDefault(@[ profile ], ^(NSString *error) {
      if (error) return LogClicksError(error);
      if (current()) ApplyConsentedClicks(@[ profile ]);
    });
  });
}

void RevokeClicks(NSUInteger token, void (^done)(NSString *error)) {
  NSArray<NSString *> *profiles = LoadedProfiles().array;
  ApplyClicks(profiles, false, token, ^(NSString *syncError) { LogClicksError(syncError); });
  StopClicksNow(profiles, token, done);
}

void ForgetGoneProfiles() {
  for (NSString *profile in LoadedProfiles().array) {
    if (ardiacore_host::LoadedProfile(profile) && !ardiacore_host::IsDeletedProfile(profile)) continue;
    [LoadedProfiles() removeObject:profile];
    [Pages()[profile] fail:@"profile gone"];
    [Pages() removeObjectForKey:profile];
  }
}

void FollowDefault(NSArray<NSString *> *profiles, void (^done)(NSString *error)) {
  done = [done copy];
  const NSUInteger generation = gProviderGeneration;
  if (!gDefaultSettled && ArdiaCoreHost.isStarted) return WhenDefaultSettled(^{
    if (generation != gProviderGeneration) return done(kProviderChanged);
    FollowDefault(profiles, done);
  });
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
      Call(profile, ScriptWith(kFollow, @[ settings ]), ^(id, NSString *error) {
        const bool gone = !ardiacore_host::LoadedProfile(profile) || ardiacore_host::IsDeletedProfile(profile);
        if (!gone) failed = failed ?: error;
        dispatch_group_leave(group);
      });
    }
    dispatch_group_notify(group, dispatch_get_main_queue(), ^{ done(failed); });
  });
}

NSDictionary<NSString *, NSArray<NSString *> *> *LiteListMap() {
  return @{
    @"ublock-filters" : @[ @"ublock-filters", @"ublock-unbreak", @"ublock-quick-fixes" ],
    @"pgl" : @[ @"plowe-0" ],
    @"urlhaus-full" : @[ @"urlhaus-1" ],
    @"annoyances-ai" : @[ @"fanboy-ai-suggestions" ],
    @"annoyances-cookies" : @[ @"fanboy-cookiemonster", @"ublock-cookies-easylist" ],
    @"annoyances-overlays" : @[ @"easylist-newsletters", @"ublock-annoyances" ],
    @"annoyances-social" : @[ @"fanboy-social" ],
    @"annoyances-widgets" : @[ @"easylist-chat" ],
    @"annoyances-others" : @[ @"easylist-annoyances" ],
    @"annoyances-notifications" : @[ @"easylist-notifications" ],
  };
}

NSString *const kMoveLite =
    @"Promise.all([lists(), trusted()]).then(([l, t]) => {"
     "  const lite = %@;"
     "  const map = %@;"
     "  const none = Array.isArray(lite.filteringModeDetails?.none) ? lite.filteringModeDetails.none : [];"
     "  const off = none.includes('all-urls');"
     "  const hosts = none.filter((h) => typeof h === 'string' && h !== 'all-urls' && /^[a-z0-9.\\-_[\\]:]+$/.test(h));"
     "  const enabled = Array.isArray(lite.rulesetConfig?.enabledRulesets) ? lite.rulesetConfig.enabledRulesets : null;"
     "  const defaults = Array.isArray(lite.defaultRulesetIds) ? lite.defaultRulesetIds : [];"
     "  const keys = Object.keys(l.available);"
     "  const lookup = (id) => (map[id] || keys.filter((k) => k.toLowerCase() === String(id).toLowerCase())).filter((k) => l.available[k]);"
     "  const pick = new Set(selected(l));"
     "  if (enabled) {"
     "    for (const id of defaults) if (!enabled.includes(id)) for (const k of lookup(id)) pick.delete(k);"
     "    for (const id of enabled) if (!defaults.includes(id)) for (const k of lookup(id)) pick.add(k);"
     "  }"
     "  const whitelist = [...new Set(t.whitelist.filter((d) => d !== offDirective).concat(hosts, off ? [offDirective] : []))];"
     "  let written = Promise.resolve(null);"
     "  if (!sameSet(pick, selected(l)))"
     "    written = written.then(() => applyLists([...pick]));"
     "  if (!sameSet(whitelist, t.whitelist))"
     "    written = written.then(() => send({what: 'setWhitelist', whitelist: whitelist.join('\\n')}));"
     "  if (off) written = written.then(() => send({what: 'userSettings', name: 'autoUpdate', value: false}));"
     "  return written.then(() => ({off, hosts: hosts.length, lists: pick.size}));"
     "})";

NSString *LiteReaderPath() {
  NSString *path = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:[@"Extensions" stringByAppendingPathComponent:kLiteReaderName]];
  return [NSFileManager.defaultManager fileExistsAtPath:[path stringByAppendingPathComponent:@"manifest.json"]] ? path : nil;
}

NSString *LiteMarker(ArdiaCoreProfile *p) {
  return p.path.length ? [p.path stringByAppendingPathComponent:kLiteMovedMarker] : nil;
}

bool LiteSettingsPending(ArdiaCoreProfile *p) {
  if (UsesAdNauseam()) return false;
  NSString *marker = LiteMarker(p);
  if (!marker || [NSFileManager.defaultManager fileExistsAtPath:marker]) return false;
  NSString *store = [p.path stringByAppendingPathComponent:[@"Local Extension Settings" stringByAppendingPathComponent:kLiteId]];
  return [NSFileManager.defaultManager fileExistsAtPath:store];
}

void MarkLiteSettingsMoved(ArdiaCoreProfile *p, NSString *summary) {
  NSLog(@"[blocker] uBlock Origin Lite's settings: %@", summary);
  [summary writeToFile:LiteMarker(p) atomically:YES encoding:NSUTF8StringEncoding error:nil];
}

constexpr double kLiteReadSeconds = 10;

void ReadLiteSettings(NSString *profile, ArdiaCoreProfile *p, void (^done)(NSDictionary *lite, NSString *error)) {
  done = [done copy];
  NSString *reader = LiteReaderPath();
  if (!reader) return done(nil, @"the reader isn't in the app");
  if (![[p loadComponentExtension:reader] isEqualToString:kLiteId]) return done(nil, @"the reader didn't load");
  NSString *key = [@"lite:" stringByAppendingString:profile];
  ACContentBlockerPage *page = HiddenPage(key, profile, p, kLiteId, @"read.html");
  __block bool answered = false;
  void (^finish)(NSDictionary *, NSString *) = ^(NSDictionary *lite, NSString *error) {
    if (answered) return;
    answered = true;
    [page fail:@"read"];
    [Pages() removeObjectForKey:key];
    if ([p respondsToSelector:@selector(unloadComponentExtension:)]) [p unloadComponentExtension:kLiteId];
    done(lite, error);
  };
  if (!page) return finish(nil, @"no reader page");
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLiteReadSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    finish(nil, @"the reader timed out");
  });
  [page run:@"chrome.storage.local.get(['filteringModeDetails', 'rulesetConfig', 'defaultRulesetIds'])"
             ".then((v) => post('result', JSON.stringify({value: v})), (e) => post('result', JSON.stringify({error: String(e && e.message || e)})))"
      completion:^(NSDictionary *lite, NSString *error) {
        finish([lite isKindOfClass:NSDictionary.class] ? lite : nil, error ?: ([lite isKindOfClass:NSDictionary.class] ? nil : @"unreadable"));
      }];
}

bool LiteSettingsUsable(NSDictionary *lite) {
  NSDictionary *modes = lite[@"filteringModeDetails"], *config = lite[@"rulesetConfig"];
  const bool modesOk = [modes isKindOfClass:NSDictionary.class] && (!modes[@"none"] || [modes[@"none"] isKindOfClass:NSArray.class]);
  const bool configOk = [config isKindOfClass:NSDictionary.class] && (!config[@"enabledRulesets"] || [config[@"enabledRulesets"] isKindOfClass:NSArray.class]);
  return modesOk || configOk;
}

void MoveLiteSettings(NSString *profile, ArdiaCoreProfile *p, void (^done)(void)) {
  done = [done copy];
  if (!LiteSettingsPending(p)) return done();
  ReadLiteSettings(profile, p, ^(NSDictionary *lite, NSString *error) {
    if (error) {
      NSLog(@"[blocker] uBlock Origin Lite's settings weren't read (%@); trying again next launch", error);
      return done();
    }
    if (!LiteSettingsUsable(lite)) {
      NSLog(@"[blocker] uBlock Origin Lite's settings aren't in a shape we know (%@); trying again next launch", lite.allKeys);
      return done();
    }
    Call(profile, ScriptWith(kMoveLite, @[ lite, LiteListMap() ]), ^(NSDictionary *result, NSString *moveError) {
      if (moveError) {
        NSLog(@"[blocker] uBlock Origin Lite's settings didn't move (%@); trying again next launch", moveError);
        return done();
      }
      MarkLiteSettingsMoved(p, [NSString stringWithFormat:@"moved (%@)", result]);
      done();
    });
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
  const NSUInteger generation = gProviderGeneration;
  FollowDefault(@[ profile ], ^(NSString *error) {
    if (first) first(error);
    if (generation != gProviderGeneration) return;
    const bool gone = !ardiacore_host::LoadedProfile(profile) || ardiacore_host::IsDeletedProfile(profile) ||
                      ![LoadedProfiles() containsObject:profile];
    if (!error || gone || attempt + 1 >= kInheritAttempts) {
      if (error && !gone) NSLog(@"[blocker] profile \"%@\" didn't take the default profile's settings: %@", profile, error);
      return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((1 << attempt) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (generation != gProviderGeneration) return;
      Inherit(profile, attempt + 1, nil);
    });
  });
}

void LoadHeld(NSString *profile) {
  if (gSwitching) {
    [DeferredProfiles() addObject:profile];
    ArdiaCoreProfile *pending = ardiacore_host::LoadedProfile(profile);
    if ([pending respondsToSelector:@selector(holdNavigationsUntilRulesetsOf:)]) [pending holdNavigationsUntilRulesetsOf:ExtensionId()];
    return;
  }
  const NSUInteger generation = gProviderGeneration;
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  const bool isDefault = profile.length == 0;
  const bool firstLoad = p && ![LoadedProfiles() containsObject:profile];
  const bool hold = firstLoad && [p respondsToSelector:@selector(holdNavigationsUntilRulesetsOf:)] &&
                    (isDefault ? LiteSettingsPending(p) : !gLaunching);
  if (hold) [p holdNavigationsUntilRulesetsOf:ExtensionId()];
  void (^release)(NSString *) = ^(NSString *why) {
    if (!hold || generation != gProviderGeneration) return;
    if (!why && [p respondsToSelector:@selector(releaseNavigationHoldReady)]) [p releaseNavigationHoldReady];
    else [p releaseNavigationHold:why ?: [ProviderTitle() stringByAppendingString:@" is ready"]];
  };
  void (^load)(void) = ^{
    if (generation != gProviderGeneration) return;
    LoadIntoProfile(profile, ^(NSString *error) {
      if (generation != gProviderGeneration) return;
      if (error) {
        if (isDefault) DefaultSettled();
        return release([@"the content blocker didn't load: " stringByAppendingString:error]);
      }
      if (!isDefault) {
        return WhenDefaultSettled(^{
          if (generation != gProviderGeneration) return;
          Inherit(profile, 0, ^(NSString *followError) {
            release(followError ? [@"the default profile's settings didn't apply: " stringByAppendingString:followError] : nil);
            if (!followError && generation == gProviderGeneration) ApplyConsentedClicks(@[ profile ]);
          });
        });
      }
      ApplyConsentedClicks(@[ profile ]);
      void (^settle)(void) = ^{
        if (generation != gProviderGeneration) return;
        ArdiaCoreProfile *current = ardiacore_host::LoadedProfile(profile);
        if (!hold && current && SettleWithoutPage() && !LiteSettingsPending(current)) return DefaultSettled();
        Call(profile, @"null", ^(id, NSString *readyError) {
          if (generation != gProviderGeneration) return;
          ArdiaCoreProfile *loaded = ardiacore_host::LoadedProfile(profile);
          if (readyError || !loaded) {
            DefaultSettled();
            return release(readyError ? [NSString stringWithFormat:@"%@ isn't ready: %@", ProviderTitle(), readyError] : nil);
          }
          MoveLiteSettings(profile, loaded, ^{
            if (generation != gProviderGeneration) return;
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

NSString *BundledVersion(NSString *extension) {
  NSString *path = [extension stringByAppendingPathComponent:@"manifest.json"];
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
     "    networkFilters: l.netFilterCount || 0,"
     "    cosmeticFilters: l.cosmeticFilterCount || 0,"
     "    enabled: !t.whitelist.includes(offDirective),"
     "    allowedHosts: t.whitelist.filter((d) => !d.includes('/') && !d.startsWith('#') && !(t.whitelistDefault || []).includes(d)),"
     "  };"
     "})";

NSDictionary *ProviderState() {
  StartPreparing();
  NSMutableArray *available = [NSMutableArray array];
  for (NSString *provider in @[ kUBlock, kAdNauseam ])
    if (BundledExtension(provider)) [available addObject:provider];
  return @{
    @"provider" : gProvider,
    @"selectedProvider" : SelectedProvider(),
    @"availableProviders" : available,
    @"clickAds" : @(ClickConsent()),
    @"version" : BundledVersion(ExtensionPath()),
  };
}

NSDictionary *UnavailableState(NSString *error) {
  NSMutableDictionary *state = [ProviderState() mutableCopy];
  [state addEntriesFromDictionary:@{
    @"enabled" : @NO, @"lists" : @[], @"allowedHosts" : @[],
    @"stats" : @{@"ready" : @NO, @"enabled" : @NO, @"parseMs" : @0, @"lookups" : @0, @"averageLookupMicros" : @0,
                 @"maxLookupMicros" : @0, @"error" : error ?: @"unavailable"},
  }];
  return state;
}

void State(void (^completion)(NSDictionary *state)) {
  completion = [completion copy];
  if (gSwitching) {
    [SwitchWaiters() addObject:^{ State(completion); }];
    return;
  }
  if (!gDefaultSettled && ArdiaCoreHost.isStarted) return WhenDefaultSettled(^{ State(completion); });
  if (gSwitchFailure) return completion(UnavailableState(gSwitchFailure));
  Call(kProfile, kState, ^(NSDictionary *read, NSString *error) {
    if ([error isEqual:kProviderChanged]) return State(completion);
    if (![read isKindOfClass:NSDictionary.class] || ![read[@"lists"] isKindOfClass:NSArray.class]) return completion(UnavailableState(error));
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
    NSMutableArray *allowed = [NSMutableArray array];
    for (NSString *host in [read[@"allowedHosts"] isKindOfClass:NSArray.class] ? read[@"allowedHosts"] : @[])
      if ([host isKindOfClass:NSString.class]) [allowed addObject:host];
    const BOOL on = [read[@"enabled"] boolValue];
    NSMutableDictionary *state = [ProviderState() mutableCopy];
    [state addEntriesFromDictionary:@{
      @"enabled" : @(on),
      @"lists" : lists,
      @"allowedHosts" : allowed,
      @"stats" : @{
        @"ready" : @YES, @"enabled" : @(on), @"networkFilters" : @(Count(read[@"networkFilters"])),
        @"cosmeticFilters" : @(Count(read[@"cosmeticFilters"])), @"parseMs" : @0, @"lookups" : @0,
        @"averageLookupMicros" : @0, @"maxLookupMicros" : @0,
      },
    }];
    completion(state);
  });
}

void Changed(NSString *error, void (^completion)(NSString *error)) {
  if (error) return completion(error);
  completion = [completion copy];
  FollowDefault(nil, ^(NSString *followError) {
    ApplyConsentedClicks(LoadedProfiles().array);
    State(^(NSDictionary *state) { if (ArdiaCoreHost.eventHandler) ArdiaCoreHost.eventHandler(@"contentBlocker", state[@"stats"]); });
    completion(followError);
  });
}

void ResetProviderOperations() {
  ++gProviderGeneration;
  NSMutableArray<ACContentBlockerOp *> *cancelled = [NSMutableArray array];
  for (NSArray *queue in Queues().allValues) [cancelled addObjectsFromArray:queue];
  [Queues() removeAllObjects];
  [BusyProfiles() removeAllObjects];
  for (NSString *profile in Uses().allKeys) Uses()[profile] = @(Uses()[profile].unsignedIntegerValue + 1);
  for (ACContentBlockerPage *page in Pages().allValues) [page fail:kProviderChanged];
  [Pages() removeAllObjects];
  for (ACContentBlockerOp *op in cancelled) op.completion(nil, kProviderChanged);
}

void ActivateProvider(NSString *provider, NSArray<NSString *> *profiles, void (^done)(NSString *error)) {
  done = [done copy];
  ResetProviderOperations();
  dispatch_async(dispatch_get_main_queue(), ^{
    for (NSString *profile in profiles) {
      ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
      [p unloadComponentExtension:kUBlockId];
      [p unloadComponentExtension:kAdNauseamId];
    }
    [LoadedProfiles() removeAllObjects];
    gProvider = provider;
    gExtensionPath = BundledExtension(provider);
    dispatch_group_t group = dispatch_group_create();
    __block NSString *failed;
    for (NSString *profile in profiles) {
      if (!ardiacore_host::LoadedProfile(profile) || ardiacore_host::IsDeletedProfile(profile)) continue;
      dispatch_group_enter(group);
      LoadIntoProfile(profile, ^(NSString *loadError) {
        if (loadError) {
          failed = failed ?: loadError;
          dispatch_group_leave(group);
          return;
        }
        Call(profile, @"null", ^(id, NSString *readyError) {
          if (ardiacore_host::LoadedProfile(profile) && !ardiacore_host::IsDeletedProfile(profile)) failed = failed ?: readyError;
          dispatch_group_leave(group);
        });
      });
    }
    dispatch_group_notify(group, dispatch_get_main_queue(), ^{
      if (failed) return done(failed);
      Call(kProfile, ScriptWith(kSetEnabled, @[ @(!gBlockingOffIntent), @(!gBlockingOffIntent) ]), ^(id, NSString *enabledError) {
        if (enabledError) return done(enabledError);
        FollowDefault(profiles, ^(NSString *followError) {
          if (followError) return done(followError);
          ApplyClicks(LoadedProfiles().array, false, gClickIntent, done);
        });
      });
    });
  });
}

void FinishProviderSwitch(NSArray<NSString *> *profiles, NSString *error, void (^done)(NSString *error)) {
  gSwitching = false;
  for (NSString *profile in profiles) {
    ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
    if (gSwitchFailure) [p releaseNavigationHold:gSwitchFailure];
    else if ([p respondsToSelector:@selector(releaseNavigationHoldReady)]) [p releaseNavigationHoldReady];
    else [p releaseNavigationHold:@"the content blocker is ready"];
  }
  NSArray *deferred = [DeferredProfiles().array copy];
  [DeferredProfiles() removeAllObjects];
  for (NSString *profile in deferred) {
    if (!ardiacore_host::LoadedProfile(profile) || ardiacore_host::IsDeletedProfile(profile)) continue;
    LoadHeld(profile);
  }
  NSArray<void (^)(void)> *waiters = [SwitchWaiters() copy];
  [SwitchWaiters() removeAllObjects];
  for (void (^waiter)(void) in waiters) waiter();
  State(^(NSDictionary *state) { if (ArdiaCoreHost.eventHandler) ArdiaCoreHost.eventHandler(@"contentBlocker", state[@"stats"]); });
  done(error);
}

void SwitchProvider(NSString *provider, void (^done)(NSString *error)) {
  if (gSwitching) return done(@"another content blocker is activating; try again when it finishes");
  if (!ArdiaCoreHost.isStarted) return done(@"the browser is still starting");
  if (!gDefaultSettled) return WhenDefaultSettled(^{ SwitchProvider(provider, done); });
  const bool clicking = [provider isEqual:kAdNauseam];
  if ([provider isEqual:gProvider] && [provider isEqual:SelectedProvider()] && ClickConsent() == clicking && !gSwitchFailure) return done(nil);
  const bool recovering = gSwitchFailure != nil;
  ForgetGoneProfiles();
  NSMutableOrderedSet<NSString *> *candidates = [LoadedProfiles() mutableCopy];
  if (recovering) {
    for (NSString *profile in ardiacore_host::LoadedProfileNames())
      if (!ardiacore_host::IsIncognito(profile) && !ardiacore_host::IsDeletedProfile(profile)) [candidates addObject:profile];
  }
  NSArray<NSString *> *profiles = candidates.array;
  if (![profiles containsObject:kProfile]) return done(@"the current content blocker isn't loaded; try again");
  for (NSString *profile in profiles) {
    if (![ardiacore_host::LoadedProfile(profile) respondsToSelector:@selector(unloadComponentExtension:)])
      return done(@"this engine cannot switch content blockers while running");
  }
  done = [done copy];
  gSwitching = true;
  gClickConsent = @NO;
  const NSUInteger token = ++gClickIntent;
  if (NSString *error = SavePreferences(kUBlock, false)) {
    return RevokeClicks(token, ^(NSString *stopError) {
      if (stopError) LogClicksError(stopError);
      FinishProviderSwitch(@[], [error stringByAppendingString:@". Background ad clicking is paused for this session; try switching again."], done);
    });
  }
  ResetProviderOperations();
  for (NSString *profile in profiles) {
    ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
    if ([p respondsToSelector:@selector(holdNavigationsUntilRulesetsOf:)])
      [p holdNavigationsUntilRulesetsOf:[provider isEqual:kAdNauseam] ? kAdNauseamId : kUBlockId];
  }
  StopClicksNow(profiles, token, ^(NSString *stopError) {
    if (stopError) LogClicksError(stopError);
    void (^restore)(NSString *) = ^(NSString *error) {
      gClickConsent = @NO;
      const NSUInteger revokeToken = ++gClickIntent;
      NSString *saveError = SavePreferences(kUBlock, false);
      StopClicksNow(profiles, revokeToken, ^(NSString *revokeError) {
        if (revokeError) LogClicksError(revokeError);
        ActivateProvider(kUBlock, profiles, ^(NSString *restoreError) {
          gSwitchFailure = restoreError;
          NSString *message = [NSString stringWithFormat:@"Couldn't activate %@: %@. %@%@", clicking ? @"AdNauseam" : @"uBlock Origin", error,
                                restoreError ? [@"uBlock Origin could not be restored: " stringByAppendingString:restoreError]
                                             : gBlockingOffIntent ? @"uBlock Origin is loaded with protection paused. Ad clicking is off."
                                                                  : @"uBlock Origin is active. Ad clicking is off.",
                                saveError ? [@" The fallback could not be saved: " stringByAppendingString:saveError] : @""];
          FinishProviderSwitch(profiles, message, done);
        });
      });
    };
    void (^activate)(void) = ^{
      ActivateProvider(provider, profiles, ^(NSString *activationError) {
        NSString *error = activationError ?: SavePreferences(provider, clicking);
        if (error) return restore(error);
        gClickConsent = @(clicking);
        ApplyClicks(LoadedProfiles().array, clicking, token, ^(NSString *clickError) {
          if (clickError) return restore(clickError);
          gSwitchFailure = nil;
          FinishProviderSwitch(profiles, nil, done);
        });
      });
    };
    if (recovering) return activate();
    Call(kProfile, kRead, ^(NSDictionary *settings, NSString *readError) {
      if (readError) return FinishProviderSwitch(profiles, [@"Couldn't read the current blocker's protection setting: " stringByAppendingString:readError], done);
      gBlockingOffIntent = gBlockingOffIntent || [settings[@"whitelist"] containsObject:kOffDirective];
      activate();
    });
  });
}

}

namespace ardiacore_host {
void PrepareContentBlocker() {
  StartPreparing();
}

void LoadContentBlocker(NSString *profile) {
  if (!IsIncognito(profile)) LoadHeld(profile ?: @"");
}
}

@implementation ArdiaCoreContentBlocker

+ (void)state:(void (^)(NSDictionary<NSString *, id> *))completion {
  State(completion);
}

+ (void)setEnabled:(BOOL)enabled completion:(void (^)(NSString *))completion {
  if (gSwitching) return completion(@"the content blocker is activating");
  completion = [completion copy];
  const NSUInteger token = ++gClickIntent;
  gBlockingOffIntent = !enabled;
  __block int pending = 2;
  __block NSString *failed;
  void (^settled)(NSString *) = ^(NSString *error) {
    failed = failed ?: error;
    if (--pending == 0) completion(failed);
  };
  Call(kProfile, ScriptWith(kSetEnabled, @[ @(enabled), @(enabled) ]), ^(id, NSString *error) { Changed(error, settled); });
  if (enabled) return settled(nil);
  StopClicksNow(LoadedProfiles().array, token, settled);
}

+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(NSString *))completion {
  if (gSwitching) return completion(@"the content blocker is activating");
  NSString *script = @"lists().then((l) => {"
                      "  const [id, on] = [%@, %@];"
                      "  if (!l.available[id]) throw new Error(`no list ${id}`);"
                      "  const keep = selected(l).filter((x) => x !== id);"
                      "  return applyLists(on ? keep.concat([id]) : keep);"
                      "})";
  Call(kProfile, ScriptWith(script, @[ listId, @(enabled) ]), ^(id, NSString *error) {
    Changed(error, completion);
  });
}

+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL))completion {
  if (gSwitching) {
    [SwitchWaiters() addObject:^{ [self isAllowedOnHost:host completion:completion]; }];
    return;
  }
  NSString *script = @"trusted().then((t) => t.whitelist.some((d) => covers(d, %@)))";
  Call(kProfile, ScriptWith(script, @[ host.lowercaseString ]), ^(id allowed, NSString *error) {
    completion(!error && [allowed isKindOfClass:NSNumber.class] && [allowed boolValue]);
  });
}

+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(NSString *))completion {
  if (gSwitching) return completion(@"the content blocker is activating");
  NSString *script = @"trusted().then((t) => {"
                      "  const [allowed, host] = [%@, %@];"
                      "  const kept = t.whitelist.filter((d) => allowed ? d !== host : !covers(d, host));"
                      "  return send({what: 'setWhitelist', whitelist: (allowed ? kept.concat([host]) : kept).join('\\n')});"
                      "})";
  Call(kProfile, ScriptWith(script, @[ @(allowed), host.lowercaseString ]), ^(id, NSString *error) {
    Changed(error, completion);
  });
}

+ (void)setProvider:(NSString *)provider clickConsent:(BOOL)clickConsent completion:(void (^)(NSString *))completion {
  StartPreparing();
  if (![provider isEqual:kUBlock] && ![provider isEqual:kAdNauseam]) return completion([@"no such content blocker: " stringByAppendingString:provider]);
  if (!BundledExtension(provider)) return completion([@"not in this build: " stringByAppendingString:provider]);
  if ([provider isEqual:kAdNauseam] && !clickConsent) return completion(@"choosing AdNauseam requires consent to background ad clicking");
  SwitchProvider(provider, completion);
}

+ (void)devFailNextMessage {
  gFailNextMessage = true;
}

+ (void)devDelayNextLoad:(double)ms {
  gDelayNextLoadMs = ms;
}

@end
