#import "ArdiaHostInternal.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaServices.h"
#import "ArdiaNavigationDownloads.h"
#import "ArdiaStartup.h"
#import "ArdiaTabParking.h"
#import "ArdiaWebViewInternal.h"
#import "ArdiaNotifications.h"

#import <Security/Security.h>
#import <objc/runtime.h>

#include <cctype>
#include <cstring>
#include <set>
#include <string>
#include <vector>

using namespace ardia_host;

namespace ardia_host {

NSMutableDictionary<NSString *, ArdiaCoreProfile *> *Profiles() {
  static NSMutableDictionary *profiles = [NSMutableDictionary dictionary];
  return profiles;
}

NSMutableDictionary<NSString *, NSMutableArray *> *ProfileWaiters() {
  static NSMutableDictionary *waiters = [NSMutableDictionary dictionary];
  return waiters;
}

NSMutableSet<NSString *> *DeletedProfiles() {
  static NSMutableSet *deleted = [NSMutableSet set];
  return deleted;
}

NSMutableSet<NSString *> *ReleasedPrivateNames() {
  static NSMutableSet *released = [NSMutableSet set];
  return released;
}

NSMutableDictionary<NSString *, void (^)(ArdiaCoreProfile *)> *DeletionsAfterLoad() {
  static NSMutableDictionary *deletions = [NSMutableDictionary dictionary];
  return deletions;
}

}

namespace {

NSString *DirectoryName(NSString *name) {
  if (name.length && ([name isEqualToString:@"Default"] || [name hasPrefix:@"Profile "])) return nil;
  return ardia_host::ProfileDirectoryName(name);
}

}

namespace ardia_host {

NSString *InstalledDataDirectory() {
  NSString *support = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
  NSString *bundleId = NSBundle.mainBundle.bundleIdentifier ?: @"com.ardia.browser";
  return [[support stringByAppendingPathComponent:bundleId] stringByAppendingPathComponent:@"Chromium"];
}

}

namespace ardia_host {

void ForgetDestroyedProfiles() {
  for (NSString *name in Profiles().allKeys)
    if (Profiles()[name].destroyed) [Profiles() removeObjectForKey:name];
}

NSArray<NSString *> *LoadedProfileNames() {
  ForgetDestroyedProfiles();
  return Profiles().allKeys;
}

NSArray<ArdiaCoreProfile *> *LoadedProfiles() {
  ForgetDestroyedProfiles();
  NSMutableArray *profiles = [NSMutableArray array];
  for (ArdiaCoreProfile *profile in Profiles().allValues)
    if (![profiles containsObject:profile]) [profiles addObject:profile];
  return profiles;
}

NSString *ProfileDirectoryName(NSString *name) {
  return name.length ? [@"Profile " stringByAppendingString:name] : @"Default";
}

NSString *ProfileNameOfDirectoryName(NSString *directory) {
  return [directory hasPrefix:@"Profile "] ? [directory substringFromIndex:8] : @"";
}

bool IsPrivateSessionId(NSString *name) {
  return [name hasPrefix:@"incognito"];
}

bool IsPrivateProfile(NSString *name) {
  ArdiaCoreProfile *loaded = name.length ? LoadedProfile(name) : nil;
  return loaded ? loaded.offTheRecord : IsPrivateSessionId(name);
}

NSString *OriginalProfileName(NSString *name) {
  if (!IsPrivateSessionId(name)) return name ?: @"";
  NSRange at = [name rangeOfString:@"@"];
  return at.location == NSNotFound ? @"" : [name substringFromIndex:NSMaxRange(at)];
}

NSString *OriginalProfileNameOf(ArdiaCoreProfile *profile) {
  if (!profile.offTheRecord) return ProfileName(profile);
  return ProfileNameOfDirectoryName(profile.name);
}

bool IsOffTheRecordOf(ArdiaCoreProfile *profile, NSString *name) {
  return profile.offTheRecord && IsPrivateSessionId(name) &&
         [profile.name isEqualToString:DirectoryName(OriginalProfileName(name))];
}

bool IsDeletedProfile(NSString *name) {
  return [DeletedProfiles() containsObject:name ?: @""];
}

ArdiaCoreProfile *LoadedProfile(NSString *name) {
  ArdiaCoreProfile *profile = Profiles()[name ?: @""];
  if (!profile.destroyed) return profile;
  [Profiles() removeObjectForKey:name ?: @""];
  return nil;
}

namespace {

void WithPrivateProfile(NSString *name, void (^completion)(ArdiaCoreProfile *)) {
  if ([ReleasedPrivateNames() containsObject:name]) return completion(nil);
  if (NSMutableArray *waiters = ProfileWaiters()[name]) return (void)[waiters addObject:completion];
  ProfileWaiters()[name] = [NSMutableArray arrayWithObject:completion];
  NSString *original = OriginalProfileName(name);
  WithProfile(original, ^(ArdiaCoreProfile *base) {
    ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
    void (^answer)(ArdiaCoreProfile *, NSString *) = ^(ArdiaCoreProfile *otr, NSString *error) {
      NSArray *pending = ProfileWaiters()[name];
      [ProfileWaiters() removeObjectForKey:name];
      if (IsDeletedProfile(original)) {
        if (otr && ![Profiles().allValues containsObject:otr]) [engine releaseProfile:otr];
        if (pending) NSLog(@"[ardiacore] no private profile for %@: its profile was deleted", name);
        for (void (^waiter)(ArdiaCoreProfile *) in pending) waiter(nil);
        return;
      }
      if (!pending) {
        if (otr && ![Profiles().allValues containsObject:otr]) [engine releaseProfile:otr];
        return;
      }
      if (otr && !otr.destroyed) Profiles()[name] = otr;
      else NSLog(@"[ardiacore] no private profile for %@: %@", name, error ?: @"it went");
      for (void (^waiter)(ArdiaCoreProfile *) in pending) waiter(Profiles()[name]);
    };
    if (!base) return answer(nil, [NSString stringWithFormat:@"profile \"%@\" isn't loaded", original]);
    [engine offTheRecordProfileFor:base completion:answer];
  });
}

}

void WithProfile(NSString *name, void (^completion)(ArdiaCoreProfile *)) {
  name = name ?: @"";
  if ([DeletedProfiles() containsObject:name]) return completion(nil);
  if (ArdiaCoreProfile *profile = LoadedProfile(name)) return completion(profile);
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  if (!engine) return completion(nil);
  if (IsPrivateSessionId(name)) return WithPrivateProfile(name, [completion copy]);
  if (name.length == 0) {
    if (ArdiaCoreProfile *personal = PersonalIfLoaded(engine)) {
      Profiles()[@""] = personal;
      return completion(personal);
    }
  }
  NSString *directory = DirectoryName(name);
  if (!directory) {
    NSLog(@"[ardiacore] no profile named \"%@\": that's a Chromium folder name, not a profile", name);
    return completion(nil);
  }
  NSMutableArray *waiters = ProfileWaiters()[name];
  if (waiters) return (void)[waiters addObject:[completion copy]];
  ProfileWaiters()[name] = [NSMutableArray arrayWithObject:[completion copy]];
  [engine loadProfile:directory
           completion:^(ArdiaCoreProfile *loaded) {
             NSArray *pending = ProfileWaiters()[name];
             [ProfileWaiters() removeObjectForKey:name];
             if (void (^deletion)(ArdiaCoreProfile *) = DeletionsAfterLoad()[name]) {
               [DeletionsAfterLoad() removeObjectForKey:name];
               deletion(loaded);
             }
             ArdiaCoreProfile *profile = [DeletedProfiles() containsObject:name] ? nil : loaded;
             if (profile) Profiles()[name] = profile;
             if (profile) ardia_host::LoadContentBlocker(name);
             if (profile) [ArdiaServices watchDownloads:name];
             for (void (^waiter)(ArdiaCoreProfile *) in pending) waiter(profile);
           }];
}

ArdiaCoreProfile *PersonalIfLoaded(ArdiaCoreEngine *engine) {
  ArdiaCoreProfile *profile = engine.defaultProfile;
  return [profile.name isEqualToString:@"Default"] ? profile : nil;
}

NSString *ProfileNameOfDirectory(NSString *directory) {
  for (ArdiaCoreProfile *profile in LoadedProfiles())
    if (!profile.offTheRecord && [profile.name isEqualToString:directory])
      return ProfileName(profile);
  return ProfileNameOfDirectoryName(directory);
}

NSString *ProfileName(ArdiaCoreProfile *profile) {
  if (!profile) return @"";
  for (NSString *name in Profiles())
    if (Profiles()[name] == profile) return name;
  return ProfileNameOfDirectoryName(profile.name);
}

NSString *AppDisposition(NSString *chrome) {
  static NSDictionary *map = @{
    @"foreground_tab" : @"foreground",
    @"background_tab" : @"background",
    @"popup" : @"popup",
    @"window" : @"window",
    @"off_the_record" : @"incognito",
    @"current_tab" : @"current",
    @"split_view" : @"split",
    @"singleton_tab" : @"foreground",
  };
  return map[chrome] ?: @"foreground";
}

}
