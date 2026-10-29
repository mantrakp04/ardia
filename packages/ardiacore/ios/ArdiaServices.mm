#import "ArdiaServices.h"

#import "ArdiaEarlyWindow.h"
#import "ArdiaEngineBridge.h"
#import "ArdiaInternal.h"
#import "ArdiaExtensionPackage.h"
#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"

#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <string.h>

#include <cmath>

using namespace ardia_runtime;

namespace {

NSDictionary *Parse(NSString *json) {
  id value = JSONObject(json);
  return [value isKindOfClass:NSDictionary.class] ? value : @{@"error" : @"bad reply from the engine"};
}


char *AppendHex(char *out, NSString *text) {
  const NSUInteger capacity = [text maximumLengthOfBytesUsingEncoding:NSUTF8StringEncoding];
  NSMutableData *raw = [NSMutableData dataWithLength:capacity];
  NSUInteger used = 0;
  [text getBytes:raw.mutableBytes maxLength:capacity usedLength:&used encoding:NSUTF8StringEncoding
         options:0 range:NSMakeRange(0, text.length) remainingRange:nullptr];
  const unsigned char *bytes = (const unsigned char *)raw.bytes;
  static const char hex[] = "0123456789abcdef";
  for (NSUInteger i = 0; i < used; i++) {
    *out++ = hex[bytes[i] >> 4];
    *out++ = hex[bytes[i] & 15];
  }
  WipeSecret(raw);
  return out;
}

NSMutableData *WithSecrets(NSDictionary *plain, NSDictionary<NSString *, NSString *> *secrets) {
  NSData *open = plain.count ? [NSJSONSerialization dataWithJSONObject:plain options:0 error:nil] : [NSData dataWithBytes:"{}" length:2];
  if (open.length < 2) return [NSMutableData data];
  NSUInteger capacity = open.length + 1;
  for (NSString *key in secrets)
    capacity += key.length + 3 + 2 * [secrets[key] maximumLengthOfBytesUsingEncoding:NSUTF8StringEncoding] + 6;
  NSMutableData *data = [NSMutableData dataWithLength:capacity];
  char *start = (char *)data.mutableBytes;
  char *out = start;
  memcpy(out, open.bytes, open.length - 1);
  out += open.length - 1;
  bool first = !plain.count;
  for (NSString *key in secrets) {
    if (!first) *out++ = ',';
    first = false;
    NSString *name = [NSString stringWithFormat:@"\"%@Hex\":\"", key];
    memcpy(out, name.UTF8String, strlen(name.UTF8String));
    out += strlen(name.UTF8String);
    out = AppendHex(out, secrets[key]);
    *out++ = '"';
  }
  *out++ = '}';
  *out++ = 0;
  data.length = (NSUInteger)(out - start);
  return data;
}

NSString *LoginOrigin(NSString *url) { return ardia_web_view::OriginOf(url) ?: url ?: @""; }

NSDictionary *Login(NSString *origin, NSString *username) {
  return @{@"origin" : LoginOrigin(origin), @"username" : username ?: @""};
}

void Answer(NSDictionary *result, ArdiaServiceReply reply) {
  if (id error = result[@"error"]) return reply(nil, [error description]);
  reply(result, nil);
}

ArdiaCoreResult Answering(ArdiaServiceReply reply, id (^shape)(NSDictionary *result)) {
  return ^(NSDictionary *result) {
    if (id error = result[@"error"]) return reply(nil, [error description]);
    reply(shape(result), nil);
  };
}

ArdiaCoreResult Dated(NSString *key, ArdiaServiceReply reply) {
  return Answering(reply, ^id(NSDictionary *result) {
    NSArray *list = result[key];
    if (![list isKindOfClass:NSArray.class]) return result;
    NSMutableArray *dated = [NSMutableArray array];
    for (NSDictionary *entry in list) {
      if (![entry isKindOfClass:NSDictionary.class]) continue;
      NSMutableDictionary *item = [entry mutableCopy];
      item[@"created"] = @0;
      item[@"modified"] = @0;
      [dated addObject:item];
    }
    return @{key : dated};
  });
}

void Changed(NSString *profile, NSString *extensionId, NSString *event) {
  if (extensionId.length)
    [ArdiaEvents emit:@"extensions.changed" data:@{@"profile" : ardia_host::OriginalProfileName(profile), @"id" : extensionId, @"event" : event}];
}

NSString *ProfileDirectory(NSString *profile) {
  NSString *name = ardia_host::OriginalProfileName(profile);
  NSString *dir = ardia_host::ProfileDirectoryName(name);
  return [ArdiaHost.dataDirectory stringByAppendingPathComponent:dir];
}

NSString *StoreFolder(NSString *profile, NSString *extensionId, id version) {
  if (!ardia_extensions::IsExtensionId(extensionId) || ![version isKindOfClass:NSString.class] || ![version length]) return nil;
  NSString *dir = [[ProfileDirectory(profile) stringByAppendingPathComponent:@"Extensions"] stringByAppendingPathComponent:extensionId];
  NSString *prefix = [version stringByAppendingString:@"_"];
  for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:dir error:nil])
    if ([name hasPrefix:prefix]) return [dir stringByAppendingPathComponent:name];
  return nil;
}

}

@implementation ArdiaServices

+ (void)call:(NSString *)name profile:(NSString *)profile args:(NSDictionary *)args completion:(ArdiaCoreResult)completion {
  [ArdiaEngineBridge call:name profile:profile args:args ? JSONText(args) : nil completion:^(NSString *json) { completion(Parse(json)); }];
}

+ (void)callBase:(NSString *)name profile:(NSString *)profile args:(NSDictionary *)args completion:(ArdiaCoreResult)completion {
  [self call:name profile:ardia_host::OriginalProfileName(profile) args:args completion:completion];
}

+ (void)call:(NSString *)name profile:(NSString *)profile args:(NSDictionary *)args secrets:(NSDictionary<NSString *, NSString *> *)secrets
    completion:(ArdiaCoreResult)completion {
  [ArdiaEngineBridge callWithSecret:name
                                profile:ardia_host::OriginalProfileName(profile)
                                   args:WithSecrets(args, secrets)
                             completion:^(NSString *json) { completion(Parse(json)); }];
}

+ (void)listPasswords:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_passwords_list" profile:profile args:nil completion:Answering(reply, ^id(NSDictionary *result) {
    NSArray *list = result[@"passwords"];
    if (![list isKindOfClass:NSArray.class]) return result;
    NSMutableArray *passwords = [NSMutableArray array];
    for (NSDictionary *entry in list)
      [passwords addObject:@{@"origin" : entry[@"origin"] ?: @"", @"username" : entry[@"username"] ?: @"", @"created" : @0, @"modified" : @0}];
    return @{@"passwords" : passwords};
  })];
}

+ (void)unlockPasswords:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_passwords_unlock" profile:profile args:nil completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)password:(NSString *)profile origin:(NSString *)origin username:(NSString *)username reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_passwords_reveal" profile:profile args:Login(origin, username) completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)savePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username password:(NSString *)password
               reply:(ArdiaServiceReply)reply {
  [self call:@"ac_passwords_add" profile:profile args:Login(origin, username) secrets:@{@"password" : password ?: @""}
      completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)updatePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username
           newUsername:(NSString *)newUsername newPassword:(NSString *)newPassword reply:(ArdiaServiceReply)reply {
  NSMutableDictionary *args = [Login(origin, username) mutableCopy];
  if (newUsername) args[@"newUsername"] = newUsername;
  [self call:@"ac_passwords_update" profile:profile args:args secrets:newPassword ? @{@"newPassword" : newPassword} : @{}
      completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)deletePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_passwords_remove" profile:profile args:Login(origin, username) completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)neverSaveOrigins:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_passwords_exceptions" profile:profile args:nil completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)allowSaving:(NSString *)profile origin:(NSString *)origin reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_passwords_allow" profile:profile args:@{@"origin" : LoginOrigin(origin)} completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)exportPasswords:(NSString *)profile path:(NSString *)path reply:(ArdiaServiceReply)reply {
  void (^run)(NSString *) = ^(NSString *target) {
    if (!target) return reply(@{@"status" : @"cancelled"}, nil);
    [self callBase:@"ac_passwords_export" profile:profile args:@{@"path" : target} completion:Answering(reply, ^id(NSDictionary *result) {
      NSMutableDictionary *answer = [result mutableCopy];
      if ([result[@"status"] isEqual:@"succeeded"]) answer[@"path"] = target;
      return answer;
    })];
  };
  if (path.length) return run(path);
  NSSavePanel *panel = [NSSavePanel savePanel];
  panel.nameFieldStringValue = @"Ardia Passwords.csv";
  panel.allowedContentTypes = @[ UTTypeCommaSeparatedText ];
  panel.canCreateDirectories = YES;
  panel.message = @"Anyone who can open this file can read your passwords.";
  [panel beginWithCompletionHandler:^(NSModalResponse response) { run(response == NSModalResponseOK ? panel.URL.path : nil); }];
}

+ (BOOL)profileToggle:(ArdiaProfileToggle)toggle profile:(NSString *)profile {
  ArdiaCoreProfile *p = ardia_host::LoadedProfile(ardia_host::OriginalProfileName(profile));
  if (!p) return YES;
  switch (toggle) {
    case ArdiaProfileTogglePasswordsOffered: return p.passwordsOffered;
    case ArdiaProfileToggleAddressesAutofilled: return p.addressesAutofilled;
    case ArdiaProfileToggleCardsAutofilled: return p.cardsAutofilled;
  }
}

+ (void)setProfileToggle:(ArdiaProfileToggle)toggle value:(BOOL)value profile:(NSString *)profile {
  ArdiaCoreProfile *p = ardia_host::LoadedProfile(ardia_host::OriginalProfileName(profile));
  switch (toggle) {
    case ArdiaProfileTogglePasswordsOffered: p.passwordsOffered = value; break;
    case ArdiaProfileToggleAddressesAutofilled: p.addressesAutofilled = value; break;
    case ArdiaProfileToggleCardsAutofilled: p.cardsAutofilled = value; break;
  }
}

+ (void)addresses:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_autofill_addresses" profile:profile args:nil completion:Dated(@"addresses", reply)];
}

+ (void)saveAddress:(NSDictionary *)address profile:(NSString *)profile reply:(ArdiaServiceReply)reply {
  NSMutableDictionary *fields = [NSMutableDictionary dictionary];
  for (NSString *key in address)
    if ([address[key] isKindOfClass:NSString.class] || [address[key] isKindOfClass:NSNumber.class]) fields[key] = [address[key] description];
  [self callBase:@"ac_autofill_save_address" profile:profile args:@{@"address" : fields} completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)cards:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_autofill_cards" profile:profile args:nil completion:Dated(@"cards", reply)];
}

+ (void)saveCard:(NSDictionary *)card number:(NSString *)number profile:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self call:@"ac_autofill_save_card" profile:profile args:@{@"card" : card ?: @{}} secrets:number ? @{@"number" : number} : @{}
      completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)deleteAutofillEntry:(NSString *)entryId profile:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_autofill_remove" profile:profile args:@{@"id" : entryId ?: @""} completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)revealCardNumber:(NSString *)cardId profile:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_autofill_card_number" profile:profile args:@{@"id" : cardId ?: @""} completion:Answering(reply, ^id(NSDictionary *result) {
    return [result[@"number"] isKindOfClass:NSString.class] ? @{@"number" : result[@"number"]} : @{};
  })];
}

+ (void)zoomLevels:(NSString *)profile reply:(ArdiaServiceReply)reply {
  if (ardia_host::IsPrivateProfile(profile)) return reply(@{}, nil);
  [self call:@"ac_zoom_list" profile:profile args:nil completion:Answering(reply, ^id(NSDictionary *result) {
    NSMutableDictionary *levels = [NSMutableDictionary dictionary];
    NSDictionary *hosts = [result[@"levels"] isKindOfClass:NSDictionary.class] ? result[@"levels"] : @{};
    for (NSString *host in hosts) levels[host] = @(round(pow(1.2, [hosts[host] doubleValue]) * 100) / 100);
    return levels;
  })];
}

+ (void)setZoom:(double)zoom profile:(NSString *)profile host:(NSString *)host {
  host = host.lowercaseString;
  if (!host.length || zoom <= 0) return;
  const double level = fabs(zoom - 1) < 1e-6 ? 0 : log(zoom) / log(1.2);
  [self call:@"ac_zoom_set" profile:profile args:@{@"host" : host, @"level" : @(level)} completion:^(NSDictionary *) {}];
}

+ (void)listExtensions:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_extensions_list" profile:profile args:nil completion:^(NSDictionary *result) {
    if (id error = result[@"error"]) return reply(nil, [error description]);
    NSArray *infos = result[@"extensions"];
    if (![infos isKindOfClass:NSArray.class]) return reply(nil, @"Unexpected extension list");
    NSMutableArray *list = [NSMutableArray array];
    for (NSDictionary *info in infos) {
      if (![info isKindOfClass:NSDictionary.class]) continue;
      NSMutableDictionary *item = [info mutableCopy];
      for (NSString *key in item.allKeys)
        if (item[key] == NSNull.null) item[key] = nil;
      NSString *path = [info[@"path"] isKindOfClass:NSString.class] ? info[@"path"] : nil;
      NSString *folder = path ?: StoreFolder(profile, info[@"id"], info[@"version"]);
      NSDictionary *manifest = folder ? ardia_extensions::ReadManifest(folder) : nil;
      for (NSString *key in @[ @"popup", @"actionTitle", @"actionIcon", @"sidePanel", @"hasAction" ])
        if (manifest[key]) item[key] = manifest[key];
      item[@"incognitoSplit"] = @([manifest[@"incognitoSplit"] boolValue]);
      for (NSString *key in @[ @"siteAccess", @"optionsUrl", @"path", @"homepageUrl" ])
        if (!item[key]) item[key] = NSNull.null;
      const BOOL fromStore = [info[@"location"] isEqual:@"FROM_STORE"];
      item[@"fromWebStore"] = @(fromStore);
      item[@"webStoreUrl"] = fromStore ? [@"https://chromewebstore.google.com/detail/" stringByAppendingString:info[@"id"]] : NSNull.null;
      [list addObject:item];
    }
    reply(@{@"extensions" : list}, nil);
  }];
}

+ (NSDictionary *)inspectUnpacked:(NSString *)path {
  NSMutableDictionary *info = [ardia_extensions::ReadManifest(path) mutableCopy];
  if (!info[@"error"]) info[@"path"] = path;
  return info;
}

+ (void)run:(NSString *)name profile:(NSString *)profile args:(NSDictionary *)args event:(NSString *)event reply:(ArdiaServiceReply)reply {
  NSString *extensionId = args[@"id"];
  [self callBase:name profile:profile args:args completion:^(NSDictionary *result) {
    if (event && !result[@"error"]) Changed(profile, extensionId, event);
    Answer(result, reply);
  }];
}

+ (void)installExtension:(NSString *)path profile:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_extensions_install" profile:profile args:@{@"path" : path ?: @""} completion:^(NSDictionary *result) {
    if ([result[@"id"] isKindOfClass:NSString.class]) Changed(profile, result[@"id"], @"installed");
    Answer(result, reply);
  }];
}

+ (void)installCrx:(NSString *)path profile:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_extensions_install_crx" profile:profile args:@{@"path" : path ?: @""} completion:^(NSDictionary *result) {
    if ([result[@"id"] isKindOfClass:NSString.class]) Changed(profile, result[@"id"], @"installed");
    Answer(result, reply);
  }];
}

+ (void)setExtension:(NSString *)extensionId enabled:(BOOL)enabled profile:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self run:@"ac_extensions_set_enabled" profile:profile args:@{@"id" : extensionId, @"enabled" : @(enabled)}
      event:enabled ? @"enabled" : @"disabled" reply:reply];
}

+ (void)uninstallExtension:(NSString *)extensionId profile:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self run:@"ac_extensions_uninstall" profile:profile args:@{@"id" : extensionId} event:@"uninstalled" reply:reply];
}

+ (void)reloadExtension:(NSString *)extensionId profile:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self run:@"ac_extensions_reload" profile:profile args:@{@"id" : extensionId} event:@"reloaded" reply:reply];
}

+ (void)configureExtension:(NSString *)extensionId profile:(NSString *)profile options:(NSDictionary *)options reply:(ArdiaServiceReply)reply {
  NSMutableDictionary *args = [NSMutableDictionary dictionaryWithObject:extensionId forKey:@"id"];
  for (NSString *key in @[ @"pinned", @"incognito", @"fileAccess", @"userScripts", @"siteAccess" ])
    if (options[key]) args[key] = options[key];
  [self run:@"ac_extensions_configure" profile:profile args:args event:@"configured" reply:reply];
}

+ (void)searchEngineList:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_search_engines_list" profile:profile args:nil completion:Answering(reply, ^id(NSDictionary *result) {
    return @{@"list" : @{@"engines" : result[@"engines"] ?: @[]}};
  })];
}

NSMutableDictionary<NSString *, NSString *> *DownloadProfiles() {
  static NSMutableDictionary *profiles = [NSMutableDictionary dictionary];
  return profiles;
}

+ (void)watchDownloadEvents {
  static bool observing = false;
  if (observing) return;
  observing = true;
  [ArdiaEngineBridge observe:@"downloads.changed"
                      handler:^(NSDictionary *payload) {
                        NSDictionary *download = [payload[@"download"] isKindOfClass:NSDictionary.class] ? payload[@"download"] : nil;
                        if (!download) return;
                        NSMutableDictionary *d = [download mutableCopy];
                        d[@"profile"] = payload[@"profile"] ?: @"";
                        if ([d[@"id"] isKindOfClass:NSString.class]) DownloadProfiles()[d[@"id"]] = d[@"profile"];
                        [ArdiaEvents emit:@"downloads.changed" data:d];
                      }];
}

+ (void)watchDownloads:(NSString *)profile {
  [self callBase:@"ac_downloads_list" profile:profile args:nil completion:^(NSDictionary *result) {
    for (NSDictionary *download in [result[@"downloads"] isKindOfClass:NSArray.class] ? result[@"downloads"] : @[]) {
      if (![download isKindOfClass:NSDictionary.class]) continue;
      NSMutableDictionary *d = [download mutableCopy];
      d[@"profile"] = profile ?: @"";
      if ([d[@"id"] isKindOfClass:NSString.class]) DownloadProfiles()[d[@"id"]] = d[@"profile"];
      [ArdiaEvents emit:@"downloads.changed" data:d];
    }
  }];
}

+ (void)downloadCommand:(NSString *)command id:(NSString *)downloadId {
  NSString *profile = DownloadProfiles()[downloadId ?: @""] ?: @"";
  [self callBase:@"ac_downloads_command" profile:profile args:@{@"id" : downloadId ?: @"", @"command" : command ?: @""}
      completion:^(NSDictionary *) {}];
}

+ (void)siteSettings:(NSString *)profile origin:(NSString *)origin reply:(ArdiaServiceReply)reply {
  [self call:@"ac_site_settings_get" profile:profile args:@{@"origin" : origin ?: @""} completion:Answering(reply, ^id(NSDictionary *result) {
    return [result[@"settings"] isKindOfClass:NSDictionary.class] ? result[@"settings"] : @{};
  })];
}

+ (void)setSiteSetting:(NSString *)value profile:(NSString *)profile origin:(NSString *)origin type:(NSString *)type {
  [self call:@"ac_site_settings_set" profile:profile args:@{@"origin" : origin ?: @"", @"type" : type ?: @"", @"value" : value ?: @""}
      completion:^(NSDictionary *) {}];
}

+ (void)siteSettingsOrigins:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self call:@"ac_site_settings_origins" profile:profile args:nil completion:Answering(reply, ^id(NSDictionary *result) {
    return [result[@"origins"] isKindOfClass:NSArray.class] ? result[@"origins"] : @[];
  })];
}

+ (void)resetSiteSettings:(NSString *)profile origin:(NSString *)origin {
  [self call:@"ac_site_settings_reset" profile:profile args:@{@"origin" : origin ?: @""} completion:^(NSDictionary *) {}];
}

+ (void)clearSiteData:(NSString *)profile origin:(NSString *)origin reply:(ArdiaServiceReply)reply {
  [self call:@"ac_site_data_clear" profile:profile args:@{@"origin" : origin ?: @""} completion:^(NSDictionary *result) { Answer(result, reply); }];
}

+ (void)externalAppAllowances:(NSString *)profile reply:(ArdiaServiceReply)reply {
  [self callBase:@"ac_external_apps_allowances" profile:profile args:nil completion:Answering(reply, ^id(NSDictionary *result) {
    return [result[@"allowances"] isKindOfClass:NSArray.class] ? result[@"allowances"] : @[];
  })];
}

+ (void)removeExternalAppAllowance:(NSString *)profile origin:(NSString *)origin scheme:(NSString *)scheme {
  [self call:@"ac_external_apps_remove" profile:profile args:@{@"origin" : origin ?: @"", @"scheme" : scheme ?: @""}
      completion:^(NSDictionary *) {}];
}

+ (void)tasks:(ArdiaServiceReply)reply {
  [self call:@"ac_tasks_list" profile:@"" args:nil completion:Answering(reply, ^id(NSDictionary *result) {
    NSMutableArray *tasks = [NSMutableArray array];
    for (NSDictionary *task in [result[@"tasks"] isKindOfClass:NSArray.class] ? result[@"tasks"] : @[]) {
      if (![task isKindOfClass:NSDictionary.class]) continue;
      NSMutableDictionary *t = [task mutableCopy];
      NSMutableArray *tabIds = [NSMutableArray array];
      for (NSNumber *chromeTabId in [task[@"tabIds"] isKindOfClass:NSArray.class] ? task[@"tabIds"] : @[])
        for (ArdiaWindowController *c in ArdiaWindowController.all)
          for (ArdiaCoreProfile *p in ardia_host::LoadedProfiles())
            for (ArdiaCoreTab *tab in [c.coreWindow tabsForProfile:p])
              if (tab.tabId == chromeTabId.intValue) [tabIds addObject:ardia_host::AppTabIdValue(tab)];
      t[@"tabIds"] = tabIds;
      [tasks addObject:t];
    }
    return tasks;
  })];
}

+ (void)components:(ArdiaServiceReply)reply {
  [self call:@"ac_components_list" profile:@"" args:nil completion:Answering(reply, ^id(NSDictionary *result) {
    return [result[@"components"] isKindOfClass:NSArray.class] ? result[@"components"] : @[];
  })];
}

+ (void)clearBrowsingData:(NSString *)profile types:(NSArray<NSString *> *)types since:(double)sinceMs completion:(void (^)(void))completion {
  if ([types containsObject:@"history"]) [ArdiaEarlyWindow forgetPictures];
  ArdiaCoreProfile *p = ardia_host::LoadedProfile(profile);
  if (!p) return completion();
  [p clearBrowsingData:types since:[NSDate dateWithTimeIntervalSince1970:sinceMs / 1000] completion:completion];
}

@end
