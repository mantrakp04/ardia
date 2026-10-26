#import "ArdiaStartup.h"

#import <AppKit/AppKit.h>

#import "ArdiaNativeMessaging.h"

namespace ardia_host {

namespace {

std::string AcceptLanguages() {
  NSMutableOrderedSet<NSString *> *list = [NSMutableOrderedSet orderedSet];
  for (NSString *identifier in NSLocale.preferredLanguages) {
    NSLocale *locale = [NSLocale localeWithLocaleIdentifier:identifier];
    NSString *language = locale.languageCode, *region = locale.regionCode, *script = locale.scriptCode;
    if (!language.length) continue;
    if ([language isEqualToString:@"zh"] && !region.length) region = [script isEqualToString:@"Hant"] ? @"TW" : @"CN";
    if (region.length) [list addObject:[NSString stringWithFormat:@"%@-%@", language, region]];
    [list addObject:language];
  }
  return [list.array componentsJoinedByString:@","].UTF8String;
}

}

void PrepareStartup(NSString *userDataDir, std::vector<std::string> &switches) {
  ardia_native_messaging::SyncHosts(userDataDir);
  static dispatch_queue_t syncQueue = dispatch_queue_create("ardia.native-messaging", DISPATCH_QUEUE_SERIAL);
  NSString *dir = [userDataDir copy];
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                dispatch_async(syncQueue, ^{ ardia_native_messaging::SyncHosts(dir); });
                                              }];

  const std::string languages = AcceptLanguages();
  if (!languages.empty()) switches.push_back("--accept-lang=" + languages);
}

}
