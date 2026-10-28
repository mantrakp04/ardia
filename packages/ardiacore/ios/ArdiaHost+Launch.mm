#import "ArdiaHostInternal.h"
#import "ArdiaLaunchConfig.h"
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

static void TryEarlyLittleWindow();

@implementation ArdiaBootstrapDelegate
- (instancetype)init {
  if ((self = [super init])) _urls = [NSMutableArray array];
  return self;
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
  [_urls addObjectsFromArray:urls];
  TryEarlyLittleWindow();
}
@end

static bool LaunchTabSwitchedOff() {
  return ![ArdiaLaunchConfig.shared switchOn:@"launchTab"];
}

static NSString *AppDataDirectory() {
  NSString *dir = gScratchDataDir ? [gDataDirectory stringByDeletingLastPathComponent] : nil;
  if (dir) return dir;
  NSURL *support = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
  return [support URLByAppendingPathComponent:NSBundle.mainBundle.bundleIdentifier ?: @"Ardia"].path;
}

static NSDictionary *SavedSession(NSString *dir) {
  NSData *data = dir ? [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"session.json"]] : nil;
  NSDictionary *session = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [session isKindOfClass:NSDictionary.class] ? session : nil;
}

static void ParkLaunchLinks(NSArray<NSURL *> *links, NSString *dir, NSDictionary *session) {
  NSString *linkProfile = [session[@"linkProfile"] isKindOfClass:NSString.class] ? session[@"linkProfile"] : nil;
  if (!links.count || !linkProfile || LaunchTabSwitchedOff()) return;
  NSMutableArray<NSString *> *urls = [NSMutableArray array];
  for (NSURL *link in links)
    if ([@[ @"http", @"https" ] containsObject:link.scheme.lowercaseString ?: @""]) [urls addObject:link.absoluteString];
  [ArdiaWebView startLinkTabs:urls profile:linkProfile];
}

namespace ardia_host {

void LinksArrived(NSArray<NSURL *> *urls) {
  if (gLinksHandled || !urls.count) return;
  gLinksHandled = true;
  if (!gJSStarted) {
    gLaunchLinks = [urls copy];
    return;
  }
  NSString *dir = AppDataDirectory();
  ParkLaunchLinks(urls, dir, SavedSession(dir));
}

}

static std::string FeatureEntryName(const std::string &entry) {
  const size_t start = !entry.empty() && entry[0] == '*' ? 1 : 0;
  const size_t end = entry.find_first_of("<:", start);
  return entry.substr(start, end == std::string::npos ? std::string::npos : end - start);
}

static std::vector<std::string> MergeFeatureLists(const std::vector<const char *> &args) {
  std::vector<std::string> switches, positional;
  std::vector<std::pair<bool, std::string>> entries;
  bool terminated = false;
  for (size_t i = 1; i < args.size(); i++) {
    const char *arg = args[i];
    if (terminated || !strcmp(arg, "--")) {
      terminated = true;
      positional.push_back(arg);
      continue;
    }
    const bool enable = !strncmp(arg, "--enable-features=", 18);
    if (!enable && strncmp(arg, "--disable-features=", 19)) {
      switches.push_back(arg);
      continue;
    }
    std::string list(arg + (enable ? 18 : 19));
    for (size_t from = 0; from <= list.size();) {
      size_t comma = list.find(',', from);
      if (comma == std::string::npos) comma = list.size();
      if (comma > from) entries.emplace_back(enable, list.substr(from, comma - from));
      from = comma + 1;
    }
  }
  std::set<std::string> decided;
  std::string enabled, disabled;
  for (auto entry = entries.rbegin(); entry != entries.rend(); ++entry) {
    if (!decided.insert(FeatureEntryName(entry->second)).second) continue;
    std::string &list = entry->first ? enabled : disabled;
    list = list.empty() ? entry->second : entry->second + "," + list;
  }
  if (!enabled.empty()) switches.push_back("--enable-features=" + enabled);
  if (!disabled.empty()) switches.push_back("--disable-features=" + disabled);
  switches.insert(switches.end(), positional.begin(), positional.end());
  return switches;
}

static void ReportLoweredWindowOcclusion() {
  void (^report)(NSWindow *) = ^(NSWindow *window) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [NSNotificationCenter.defaultCenter postNotificationName:NSWindowDidChangeOcclusionStateNotification object:window];
    });
  };
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  for (NSNotificationName name in @[ NSWindowDidMiniaturizeNotification, NSWindowDidDeminiaturizeNotification ])
    [center addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *note) { report(note.object); }];
}

namespace ardia_host {

void StartLaunchTab() {
  gJSStarted = true;
  NSString *dir = AppDataDirectory();
  NSDictionary *session = SavedSession(dir);
  NSArray<NSURL *> *links = gLaunchLinks;
  gLaunchLinks = nil;
  ParkLaunchLinks(links, dir, session);
  NSDictionary *hint = session[@"launchTab"];
  if (![hint isKindOfClass:NSDictionary.class]) return;
  NSString *key = hint[@"id"], *url = hint[@"url"], *profile = hint[@"profile"];
  if (![key isKindOfClass:NSString.class] || ![url isKindOfClass:NSString.class] || ![profile isKindOfClass:NSString.class]) return;
  [ArdiaWebView startLaunchTab:key url:url profile:profile];
  if (ArdiaCoreTab *tab = ArdiaTabParking.launchTab) [ArdiaEarlyWindow attachPage:tab key:key];
}

}

static bool gLaunchedHidden;

namespace ardia_host {

bool gEarlyWindowPending;

}

static bool gLaunchedForDocuments;

static bool OnboardingPending(NSString *dir) {
  NSData *data = [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"onboarding.json"]];
  NSDictionary *saved = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![saved isKindOfClass:NSDictionary.class]) return false;
  const bool completed = [saved[@"completedAt"] isKindOfClass:NSNumber.class] && [saved[@"completedAt"] doubleValue] > 0;
  return !completed && [saved[@"startedAt"] isKindOfClass:NSNumber.class];
}

static void TryEarlyWindow() {
  NSString *dir = AppDataDirectory();
  if (gLaunchedHidden || gLaunchedForDocuments || NSApp.isHidden || gBootstrap.urls.count || LaunchTabSwitchedOff() || OnboardingPending(dir)) return;
  NSDictionary *session = SavedSession(dir);
  NSDictionary *hint = session[@"launchTab"];
  NSString *focused = session[@"focusedWindowId"];
  if (![hint isKindOfClass:NSDictionary.class] || ![focused isKindOfClass:NSString.class]) return;
  NSString *key = hint[@"id"], *url = hint[@"url"], *profile = hint[@"profile"];
  if (![key isKindOfClass:NSString.class] || ![url isKindOfClass:NSString.class] || ![profile isKindOfClass:NSString.class]) return;
  NSDictionary *window = nil;
  for (NSDictionary *w in [session[@"windows"] isKindOfClass:NSArray.class] ? session[@"windows"] : @[])
    if ([w isKindOfClass:NSDictionary.class] && [w[@"id"] isEqual:focused]) window = w;
  if (!window || [window[@"incognito"] boolValue] || window[@"kind"] || ![window[@"frame"] isKindOfClass:NSArray.class]) return;
  if (![window[@"tabIds"] isKindOfClass:NSArray.class] || ![window[@"tabIds"] containsObject:key]) return;
  for (NSDictionary *split in [session[@"splits"] isKindOfClass:NSArray.class] ? session[@"splits"] : @[])
    if ([split isKindOfClass:NSDictionary.class] && [split[@"tabIds"] isKindOfClass:NSArray.class] && [split[@"tabIds"] containsObject:key]) return;
  NSDictionary *backdrop = [session[@"launchBackdrop"] isKindOfClass:NSDictionary.class] ? session[@"launchBackdrop"] : nil;
  const bool dark = [[NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameDarkAqua, NSAppearanceNameAqua ]]
      isEqualToString:NSAppearanceNameDarkAqua];
  if (!backdrop || ![backdrop[@"dark"] isKindOfClass:NSNumber.class] || [backdrop[@"dark"] boolValue] != dark) return;
  if (![ArdiaEarlyWindow canShowWindow:focused session:session]) return;
  ArdiaCoreProfile *loaded = ardia_host::LoadedProfile(profile);
  if (!loaded) return;
  [loaded warmSpareRenderer];
  const BOOL shown = [ArdiaEarlyWindow showWindow:focused frame:window[@"frame"] key:key profile:profile backdrop:backdrop];
  [ArdiaWebView startLaunchTab:key url:url profile:profile];
  if (!shown) return;
  if (ArdiaCoreTab *tab = ArdiaTabParking.launchTab) [ArdiaEarlyWindow attachPage:tab key:key];
}

static NSArray<NSNumber *> *LittleArdiaFrame(id size) {
  const NSPoint mouse = NSEvent.mouseLocation;
  NSScreen *screen = nil;
  for (NSScreen *each in NSScreen.screens)
    if (NSMouseInRect(mouse, each.frame, NO)) {
      screen = each;
      break;
    }
  screen = screen ?: NSScreen.mainScreen;
  if (!screen) return nil;
  const NSRect visible = screen.visibleFrame;
  double width = 900, height = 640;
  if ([size isKindOfClass:NSArray.class] && [size count] == 2 && [size[0] isKindOfClass:NSNumber.class] && [size[1] isKindOfClass:NSNumber.class]) {
    width = [size[0] doubleValue];
    height = [size[1] doubleValue];
  }
  width = MIN(MAX(width, 420), NSWidth(visible));
  height = MIN(MAX(height, 300), NSHeight(visible));
  const double lift = MIN(NSHeight(visible) * 0.05, (NSHeight(visible) - height) / 2);
  return @[ @(round(NSMidX(visible) - width / 2)), @(round(NSMidY(visible) - height / 2 + lift)), @(round(width)), @(round(height)) ];
}

static bool gEarlyLittleTried;

static void TryEarlyLittleWindow() {
  if (gEarlyLittleTried || !gStarted || gJSStarted || gBootstrap.urls.count != 1) return;
  gEarlyLittleTried = true;
  NSURL *link = gBootstrap.urls.firstObject;
  NSString *scheme = link.scheme.lowercaseString;
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) return;
  NSString *dir = AppDataDirectory();
  if (gLaunchedHidden || NSApp.isHidden || LaunchTabSwitchedOff() || OnboardingPending(dir)) return;
  NSDictionary *session = SavedSession(dir);
  NSDictionary *settings = [session[@"settings"] isKindOfClass:NSDictionary.class] ? session[@"settings"] : @{};
  if ([settings[@"openLinksInLittleArdia"] isEqual:@NO]) return;
  NSString *profile = [session[@"linkProfile"] isKindOfClass:NSString.class] ? session[@"linkProfile"] : nil;
  NSDictionary *backdrop = [session[@"launchBackdrop"] isKindOfClass:NSDictionary.class] ? session[@"launchBackdrop"] : nil;
  const bool dark = [[NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameDarkAqua, NSAppearanceNameAqua ]]
      isEqualToString:NSAppearanceNameDarkAqua];
  if (!profile || !backdrop || ![backdrop[@"dark"] isKindOfClass:NSNumber.class] || [backdrop[@"dark"] boolValue] != dark) return;
  if (!ardia_host::LoadedProfile(profile)) return;
  NSArray<NSNumber *> *frame = LittleArdiaFrame(settings[@"littleArdiaSize"]);
  if (!frame) return;
  NSString *url = link.absoluteString;
  [ArdiaWebView startLinkTabs:@[ url ] profile:profile];
  ArdiaCoreTab *tab = ArdiaTabParking.firstLinkTab;
  NSString *mark = tab ? [ArdiaTabParking linkMarkForTab:tab] : nil;
  NSString *focused = [session[@"focusedWindowId"] isKindOfClass:NSString.class] ? session[@"focusedWindowId"] : nil;
  if (mark) [ArdiaEarlyWindow showLittleWindowForLink:tab mark:mark url:url frame:frame profile:profile backdrop:backdrop like:focused];
}

namespace ardia_host {

void StartEarlyWindow() {
  @autoreleasepool {
    TryEarlyWindow();
    TryEarlyLittleWindow();
    [ArdiaEarlyWindow discardPrefetch];
  }
}

}

@implementation ArdiaHost (Launch)

+ (int)runWithArgc:(int)argc argv:(char **)argv delegate:(id<NSApplicationDelegate> (^)(void))makeDelegate {
  ArdiaLaunchConfig *config = ArdiaLaunchConfig.shared;
  gScratchDataDir = config.dataDirectory != nil;
#if DEBUG
  if (!gScratchDataDir) {
    fprintf(stderr, "[ardiacore] set ARDIA_DATA_DIR to a scratch directory\n");
    return 1;
  }
#endif
  gMakeDelegate = [makeDelegate copy];
  NSString *scratch = config.dataDirectory;
  gDataDirectory = scratch ? [scratch stringByAppendingPathComponent:@"Chromium"] : InstalledDataDirectory();
  NSError *dirError;
  if (![NSFileManager.defaultManager createDirectoryAtPath:gDataDirectory withIntermediateDirectories:YES attributes:nil error:&dirError]) {
    fprintf(stderr, "[ardiacore] can't use the data dir %s: %s\n", gDataDirectory.fileSystemRepresentation,
            dirError.localizedDescription.UTF8String ?: "");
    return 1;
  }
  ardia_host::InstallTestCrashGuard(scratch && config.background ? scratch : nil);
  ardia_host::InstallActivationGuardsEarly();
  ardia_host::PrepareContentBlocker();
  Method finishLaunching = class_getInstanceMethod(NSApplication.class, @selector(finishLaunching));
  IMP appKitFinishLaunching = method_getImplementation(finishLaunching);
  method_setImplementation(finishLaunching, imp_implementationWithBlock(^(NSApplication *app) {
    if (!gAppDelegate && !app.delegate) {
      gBootstrap = [ArdiaBootstrapDelegate new];
      app.delegate = gBootstrap;
    }
    ((void (*)(id, SEL))appKitFinishLaunching)(app, @selector(finishLaunching));
  }));
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationWillFinishLaunchingNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                gAppKitWillFinish = true;
                                              }];
  if ([config traced:@"visibility"]) {
    [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidChangeOcclusionStateNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(NSNotification *note) {
                                                  NSWindow *w = note.object;
                                                  id chrome = [w respondsToSelector:NSSelectorFromString(@"isOccluded")]
                                                                  ? [w valueForKey:@"occluded"] : nil;
                                                  NSLog(@"[ardiacore-vis] window %ld occlusion macOSVisible=%d chromeOccluded=%@ fromChecker=%d",
                                                        (long)w.windowNumber, (w.occlusionState & NSWindowOcclusionStateVisible) != 0,
                                                        chrome, note.userInfo.count > 0);
                                                }];
    NSNotificationCenter *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
    for (NSNotificationName name in @[ NSWorkspaceScreensDidSleepNotification, NSWorkspaceScreensDidWakeNotification,
                                        NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceSessionDidBecomeActiveNotification ])
      [workspace addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *note) {
        NSLog(@"[ardiacore-vis] workspace %@", note.name);
      }];
  }
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidFinishLaunchingNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                gAppKitDidFinish = true;
                                                NSAppleEventDescriptor *event = NSAppleEventManager.sharedAppleEventManager.currentAppleEvent;
                                                if (event.eventID == kAEOpenApplication &&
                                                    [event paramDescriptorForKeyword:keyAEPropData].enumCodeValue == keyAELaunchedAsLogInItem)
                                                  gLaunchedHidden = true;
                                                if (event && !(event.eventClass == kCoreEventClass && event.eventID == kAEOpenApplication))
                                                  gLaunchedForDocuments = true;
                                                if (gEarlyWindowPending) {
                                                  gEarlyWindowPending = false;
                                                  StartEarlyWindow();
                                                }
                                                if (!gPendingLaunchURLs.count) return;
                                                dispatch_async(dispatch_get_main_queue(), ^{
                                                  NSArray<NSURL *> *urls = gPendingLaunchURLs;
                                                  gPendingLaunchURLs = nil;
                                                  if (urls.count && [gAppDelegate respondsToSelector:@selector(application:openURLs:)])
                                                    [gAppDelegate application:NSApp openURLs:urls];
                                                });
                                              }];

  std::vector<std::string> extra = {
      "--user-data-dir=" + std::string(gDataDirectory.UTF8String),
      "--enable-smooth-scrolling",
      "--disable-stack-profiler",
      "--disable-features=MacAppCodeSignClone,DevToolsAcceptDebuggingConnections,AutofillAiWalletPrivatePasses",
      "--enable-features=WebContentsDiscard,BrowserInitiatedAutomaticPictureInPicture,ImprovedStartupBestEffortDelay:StartupDelayStopOnLoadingTimedOut/true,"
      "CPUMeasurementInFreezingPolicy:freezing_visible_protection_time/0s,InfiniteTabsFreezing:ardia_unconnected_unfreeze_interval/600s,"
      "ThrottleMainFrameTo60Hz,UrgentMainFrameForInput",
      "--profile-directory=Default",
      "--js-flags=--no-memory-reducer",
  };
  const bool mockKeychain = gScratchDataDir || !IsTeamSigned();
  if (mockKeychain) extra.push_back("--use-mock-keychain");
  ardia_host::PrepareStartup(gDataDirectory, extra);
  @autoreleasepool {
    [ArdiaEarlyWindow setDataDirectory:AppDataDirectory()];
    [ArdiaEarlyWindow prefetchForSession:SavedSession(AppDataDirectory()) ?: @{}];
  }
  const bool background = config.background;
  if (background && ![config instanceFlag:@"allowOcclusion"]) {
    extra.push_back("--disable-backgrounding-occluded-windows");
    if (Method occluded = class_getInstanceMethod(NSWindow.class, NSSelectorFromString(@"isOccluded")))
      method_setImplementation(occluded, imp_implementationWithBlock(^BOOL(id) { return NO; }));
  }
  if (background && [config instanceFlag:@"allowOcclusion"]) ReportLoweredWindowOcclusion();
  if (background && ![config instanceFlag:@"allowAudio"]) extra.push_back("--mute-audio");
  if (background) extra.push_back("--use-fake-device-for-media-stream");
  if (background) extra.push_back("--disable-modal-animations");
  auto autoAccepts = [background](const char *sw) {
    return background && (!strncmp(sw, "--use-fake-ui-for-media-stream", 30) ||
                          !strncmp(sw, "--auto-accept-camera-and-microphone-capture", 43));
  };
  for (NSString *sw in config.engineSwitches) extra.push_back(sw.UTF8String);
  if (NSNumber *port = config.remoteDebuggingPort; port && mockKeychain) {
    extra.push_back(std::string("--remote-debugging-port=") + port.stringValue.UTF8String);
    extra.push_back("--remote-allow-origins=*");
  }
  if (NSString *switches = [config instance:@"chromiumSwitches"]; switches && mockKeychain) {
    NSString *all = [@" " stringByAppendingString:switches];
    for (NSString *item in [all componentsSeparatedByString:@" --"]) {
      NSString *sw = [item stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
      std::string full = std::string("--") + sw.UTF8String;
      if (sw.length && !autoAccepts(full.c_str()) && ![sw hasPrefix:@"ardia-"]) extra.push_back(full);
    }
  }
  std::vector<const char *> args = {argc > 0 && argv[0] ? argv[0] : "Ardia"};
  for (const std::string &s : extra) args.push_back(s.c_str());
  for (int i = 1; mockKeychain && i < argc; i++) {
    const char *arg = argv[i];
    if (!arg) break;
    const bool cocoaDefault = arg[0] == '-' && arg[1] != '-' && isalpha((unsigned char)arg[1]) &&
                              strncmp(arg, "-psn_", 5) != 0 && i + 1 < argc;
    if (cocoaDefault) {
      i++;
      continue;
    }
    if (autoAccepts(arg) || !strncmp(arg, "--ardia-", 8)) continue;
    args.push_back(arg);
  }
  static std::vector<std::string> merged;
  merged = MergeFeatureLists(args);
  args.resize(1);
  for (const std::string &s : merged) args.push_back(s.c_str());
  static ArdiaHostEngineDelegate *engineDelegate = [ArdiaHostEngineDelegate new];
  return [ArdiaCoreEngine runWithArgc:(int)args.size() argv:args.data() delegate:engineDelegate];
}

@end
