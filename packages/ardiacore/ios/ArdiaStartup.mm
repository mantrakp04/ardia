#import "ArdiaStartup.h"

#import <AppKit/AppKit.h>

#include <signal.h>

#include <atomic>

#import "ArdiaNativeMessaging.h"

namespace ardia_host {

namespace {

constexpr int64_t kActivationResyncDelay = 2 * NSEC_PER_SEC;
NSString *const kSecureOriginsDoc = @"secure-origins.json";
NSString *const kSecureOriginsPref = @"unsafely_treat_insecure_origin_as_secure";

bool ChromeRunsOn(NSString *userDataDir) {
  NSString *lock = [NSFileManager.defaultManager destinationOfSymbolicLinkAtPath:[userDataDir stringByAppendingPathComponent:@"SingletonLock"] error:nil];
  const pid_t pid = (pid_t)[lock componentsSeparatedByString:@"-"].lastObject.intValue;
  return pid > 0 && (kill(pid, 0) == 0 || errno == EPERM);
}

NSString *AppDataBesideChromium(NSString *userDataDir) {
  NSString *parent = userDataDir.stringByDeletingLastPathComponent;
  if ([userDataDir.lastPathComponent isEqualToString:@"Chromium"] &&
      [NSFileManager.defaultManager fileExistsAtPath:[parent stringByAppendingPathComponent:@"session.json"]]) {
    return parent;
  }
  NSURL *support = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
  return [support URLByAppendingPathComponent:NSBundle.mainBundle.bundleIdentifier ?: @"Ardia"].path;
}

NSArray<NSString *> *SecureOriginsFromDoc(NSString *appData) {
  NSData *data = [NSData dataWithContentsOfFile:[appData stringByAppendingPathComponent:kSecureOriginsDoc]];
  if (!data) return @[];
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![parsed isKindOfClass:NSArray.class]) return @[];
  NSMutableArray<NSString *> *origins = [NSMutableArray array];
  for (id item in (NSArray *)parsed) {
    if (![item isKindOfClass:NSString.class]) continue;
    NSString *origin = [(NSString *)item stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (origin.length) [origins addObject:origin];
  }
  return origins;
}

void ApplySecureOrigins(NSString *userDataDir) {
  if (ChromeRunsOn(userDataDir)) return;
  NSString *joined = [SecureOriginsFromDoc(AppDataBesideChromium(userDataDir)) componentsJoinedByString:@","];
  NSString *path = [userDataDir stringByAppendingPathComponent:@"Local State"];
  NSMutableDictionary *state = nil;
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (data) {
    id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil];
    if ([parsed isKindOfClass:NSMutableDictionary.class]) state = parsed;
    else if ([parsed isKindOfClass:NSDictionary.class]) state = [parsed mutableCopy];
  }
  if (!state) state = [NSMutableDictionary dictionary];
  NSString *current = [state[kSecureOriginsPref] isKindOfClass:NSString.class] ? state[kSecureOriginsPref] : @"";
  if ([current isEqualToString:joined]) return;
  if (joined.length) state[kSecureOriginsPref] = joined;
  else [state removeObjectForKey:kSecureOriginsPref];
  NSData *out = [NSJSONSerialization dataWithJSONObject:state options:NSJSONWritingSortedKeys error:nil];
  if (out) [out writeToFile:path atomically:YES];
}

void KeepWebsiteLanguages(NSString *userDataDir) {
  NSFileManager *files = NSFileManager.defaultManager;
  NSString *marker = [userDataDir stringByAppendingPathComponent:@".ardia-website-languages-kept"];
  if ([files fileExistsAtPath:marker] || ChromeRunsOn(userDataDir)) return;
  for (NSString *name in [files contentsOfDirectoryAtPath:userDataDir error:nil]) {
    NSString *path = [[userDataDir stringByAppendingPathComponent:name] stringByAppendingPathComponent:@"Preferences"];
    NSData *data = [NSData dataWithContentsOfFile:path];
    if (!data) continue;
    NSDictionary *prefs = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    NSDictionary *intl = [prefs isKindOfClass:NSDictionary.class] ? prefs[@"intl"] : nil;
    if (![intl isKindOfClass:NSDictionary.class]) continue;
    NSString *accept = intl[@"accept_languages"], *selected = intl[@"selected_languages"];
    if (![accept isKindOfClass:NSString.class] || ![selected isKindOfClass:NSString.class] || [accept isEqualToString:selected]) continue;
    NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    NSString *from = [NSString stringWithFormat:@"\"selected_languages\":\"%@\"", selected];
    if ([text componentsSeparatedByString:from].count != 2) continue;
    NSString *to = [NSString stringWithFormat:@"\"selected_languages\":\"%@\"", accept];
    [[text stringByReplacingOccurrencesOfString:from withString:to] writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];
  }
  [NSData.data writeToFile:marker atomically:YES];
}

}

void PrepareStartup(NSString *userDataDir) {
  KeepWebsiteLanguages(userDataDir);
  ApplySecureOrigins(userDataDir);
  static dispatch_queue_t syncQueue = dispatch_queue_create("ardia.native-messaging", DISPATCH_QUEUE_SERIAL);
  static std::atomic<bool> resyncQueued{false};
  NSString *dir = [userDataDir copy];
  dispatch_sync(syncQueue, ^{ ardia_native_messaging::SyncHosts(dir); });
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                if (resyncQueued.exchange(true)) return;
                                                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kActivationResyncDelay), syncQueue, ^{
                                                  resyncQueued = false;
                                                  ardia_native_messaging::SyncHosts(dir);
                                                });
                                              }];
}

}
