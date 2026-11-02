#import "ArdiaStartup.h"

#import <AppKit/AppKit.h>

#include <signal.h>

#import "ArdiaNativeMessaging.h"

namespace ardia_host {

namespace {

bool ChromeRunsOn(NSString *userDataDir) {
  NSString *lock = [NSFileManager.defaultManager destinationOfSymbolicLinkAtPath:[userDataDir stringByAppendingPathComponent:@"SingletonLock"] error:nil];
  const pid_t pid = (pid_t)[lock componentsSeparatedByString:@"-"].lastObject.intValue;
  return pid > 0 && (kill(pid, 0) == 0 || errno == EPERM);
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
  ardia_native_messaging::SyncHosts(userDataDir);
  static dispatch_queue_t syncQueue = dispatch_queue_create("ardia.native-messaging", DISPATCH_QUEUE_SERIAL);
  NSString *dir = [userDataDir copy];
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                dispatch_async(syncQueue, ^{ ardia_native_messaging::SyncHosts(dir); });
                                              }];
}

}
