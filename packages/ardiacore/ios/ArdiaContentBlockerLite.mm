#import "ArdiaContentBlockerInternal.h"

#include <utility>

using namespace ardia_content_blocker;

namespace {

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

}

namespace ardia_content_blocker {

bool LiteSettingsPending(ArdiaCoreProfile *p) {
  NSString *marker = LiteMarker(p);
  if (!marker || [NSFileManager.defaultManager fileExistsAtPath:marker]) return false;
  NSString *store = [p.path stringByAppendingPathComponent:[@"Local Extension Settings" stringByAppendingPathComponent:kLiteId]];
  return [NSFileManager.defaultManager fileExistsAtPath:store];
}

}

namespace {

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
  ArdiaContentBlockerPage *page = HiddenPage(key, profile, p, kLiteId, @"read.html");
  __block bool answered = false;
  void (^finish)(NSDictionary *, NSString *) = ^(NSDictionary *lite, NSString *error) {
    if (answered) return;
    answered = true;
    [page fail:@"read"];
    [Pages() removeObjectForKey:key];
    [p unloadComponentExtension:kLiteId];
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

}

namespace ardia_content_blocker {

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

}
