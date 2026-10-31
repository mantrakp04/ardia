#import "ArdiaHostInternal.h"
#import "ArdiaLaunchConfig.h"
#import "ArdiaSavedSession.h"
#import "ArdiaSavedDocument.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaServices.h"
#import "ArdiaNavigationDownloads.h"
#import "ArdiaStartup.h"
#import "ArdiaTabParking.h"
#import "ArdiaWebViewInternal.h"

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

static NSDictionary *SavedLinkRouting(NSDictionary *settings) {
  return [settings[@"linkRouting"] isKindOfClass:NSDictionary.class] ? settings[@"linkRouting"] : nil;
}

static NSString *ComparableLinkText(NSString *text) {
  NSString *lower = [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].lowercaseString;
  if ([lower hasPrefix:@"https://"]) lower = [lower substringFromIndex:8];
  else if ([lower hasPrefix:@"http://"]) lower = [lower substringFromIndex:7];
  const NSRange cut = [lower rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"?#"]];
  if (cut.location != NSNotFound) lower = [lower substringToIndex:cut.location];
  while ([lower hasSuffix:@"/"]) lower = [lower substringToIndex:lower.length - 1];
  return lower;
}

static BOOL LinkMayRoute(NSDictionary *settings, NSString *url) {
  NSArray *routes = [SavedLinkRouting(settings)[@"routes"] isKindOfClass:NSArray.class] ? SavedLinkRouting(settings)[@"routes"] : @[];
  NSString *lower = url.lowercaseString;
  NSString *comparableURL = ComparableLinkText(url);
  for (id route in routes) {
    if (![route isKindOfClass:NSDictionary.class] || ![route[@"pattern"] isKindOfClass:NSString.class]) continue;
    NSString *pattern = route[@"pattern"];
    if ([route[@"match"] isEqual:@"equals"]) {
      NSString *comparable = ComparableLinkText(pattern);
      if (comparable.length && [comparableURL isEqualToString:comparable]) return YES;
      continue;
    }
    NSString *trimmed = [pattern stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].lowercaseString;
    if (trimmed.length && [lower containsString:trimmed]) return YES;
  }
  return NO;
}

static BOOL OtherAppsOpenInRecentProfile(NSDictionary *settings) {
  NSDictionary *routing = SavedLinkRouting(settings);
  if (!routing) return YES;
  NSDictionary *destination = [routing[@"defaultDestination"] isKindOfClass:NSDictionary.class] ? routing[@"defaultDestination"] : nil;
  return [destination[@"kind"] isEqual:@"little"] || [destination[@"kind"] isEqual:@"recent"];
}

static BOOL OtherAppsOpenInLittleWindow(NSDictionary *settings) {
  NSDictionary *routing = SavedLinkRouting(settings);
  if (!routing) return ![settings[@"openLinksInLittleArdia"] isEqual:@NO];
  NSDictionary *destination = [routing[@"defaultDestination"] isKindOfClass:NSDictionary.class] ? routing[@"defaultDestination"] : nil;
  return [destination[@"kind"] isEqual:@"little"];
}

static void ParkLaunchLinks(NSArray<NSURL *> *links, ArdiaSavedSession *session) {
  NSString *linkProfile = session.linkProfile;
  NSDictionary *settings = session.settings ?: @{};
  if (!links.count || !linkProfile || LaunchTabSwitchedOff()) return;
  if (!OtherAppsOpenInRecentProfile(settings)) return;
  NSMutableArray<NSString *> *urls = [NSMutableArray array];
  for (NSURL *link in links)
    if (!link.isFileURL && link.absoluteString.length && !LinkMayRoute(settings, link.absoluteString)) [urls addObject:link.absoluteString];
  if (urls.count) [ArdiaWebView startLinkTabs:urls profile:linkProfile];
}

namespace ardia_host {

void LinksArrived(NSArray<NSURL *> *urls) {
  static bool handled;
  if (handled || !urls.count) return;
  handled = true;
  NSArray<NSURL *> *links = [urls copy];
  [ArdiaLaunchSequence.shared after:ArdiaLaunchJSStarted
                                 do:^{
                                   ParkLaunchLinks(links, [ArdiaSavedSession readFrom:AppDataDirectory()]);
                                 }];
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
  [ArdiaLaunchSequence.shared reach:ArdiaLaunchJSStarted];
  ArdiaSavedSession *session = [ArdiaSavedSession readFrom:AppDataDirectory()];
  NSString *key = session.launchTabId;
  if (!key) return;
  [ArdiaWebView startLaunchTab:key url:session.launchTabURL profile:session.launchTabProfile];
  if (ArdiaCoreTab *tab = ArdiaTabParking.launchTab) [ArdiaEarlyWindow attachPage:tab key:key];
}

}

static constexpr NSInteger kOnboardingVersion = 1;

static bool OnboardingPending(NSString *dir) {
  NSDictionary *saved = [ArdiaSavedDocument read:@"onboarding.json" in:dir oldest:0 newest:kOnboardingVersion];
  if (!saved) return false;
  const bool completed = [saved[@"completedAt"] isKindOfClass:NSNumber.class] && [saved[@"completedAt"] doubleValue] > 0;
  return !completed && [saved[@"startedAt"] isKindOfClass:NSNumber.class];
}

static void TryEarlyWindow() {
  NSString *dir = AppDataDirectory();
  ArdiaLaunchSequence *launch = ArdiaLaunchSequence.shared;
  if (launch.launchedHidden || launch.launchedForDocuments || NSApp.isHidden || gBootstrap.urls.count || LaunchTabSwitchedOff() || OnboardingPending(dir)) return;
  ArdiaSavedSession *session = [ArdiaSavedSession atLaunch:dir];
  NSString *focused = session.focusedWindowId, *key = session.launchTabId, *url = session.launchTabURL, *profile = session.launchTabProfile;
  if (!focused || !key) return;
  NSDictionary *window = [session windowWithId:focused];
  if (!window || [window[@"incognito"] boolValue] || window[@"kind"] || ![window[@"frame"] isKindOfClass:NSArray.class]) return;
  if (![window[@"tabIds"] isKindOfClass:NSArray.class] || ![window[@"tabIds"] containsObject:key]) return;
  for (NSDictionary *split in session.splits)
    if ([[session tabIdsOfSplit:split] containsObject:key]) return;
  NSDictionary *backdrop = session.launchBackdrop;
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
  ArdiaLaunchSequence *launch = ArdiaLaunchSequence.shared;
  if (gEarlyLittleTried || !launch.engineRunning || [launch reached:ArdiaLaunchJSStarted] || gBootstrap.urls.count != 1) return;
  gEarlyLittleTried = true;
  NSURL *link = gBootstrap.urls.firstObject;
  NSString *scheme = link.scheme.lowercaseString;
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) return;
  NSString *dir = AppDataDirectory();
  if (launch.launchedHidden || NSApp.isHidden || LaunchTabSwitchedOff() || OnboardingPending(dir)) return;
  ArdiaSavedSession *session = [ArdiaSavedSession atLaunch:dir];
  NSDictionary *settings = session.settings ?: @{};
  if (!OtherAppsOpenInLittleWindow(settings) || LinkMayRoute(settings, link.absoluteString)) return;
  NSString *profile = session.linkProfile;
  NSDictionary *backdrop = session.launchBackdrop;
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
  NSString *focused = session.focusedWindowId;
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
                                                [ArdiaLaunchSequence.shared reach:ArdiaLaunchAppKitWillFinish];
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
  [ArdiaLaunchSequence.shared after:ArdiaLaunchEngineStarted | ArdiaLaunchAppKitDidFinish do:^{ StartEarlyWindow(); }];
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidFinishLaunchingNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                NSAppleEventDescriptor *event = NSAppleEventManager.sharedAppleEventManager.currentAppleEvent;
                                                const BOOL hidden = event.eventID == kAEOpenApplication &&
                                                                    [event paramDescriptorForKeyword:keyAEPropData].enumCodeValue == keyAELaunchedAsLogInItem;
                                                const BOOL documents = event && !(event.eventClass == kCoreEventClass && event.eventID == kAEOpenApplication);
                                                [ArdiaLaunchSequence.shared appKitFinishedHidden:hidden forDocuments:documents];
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
  ardia_host::PrepareStartup(gDataDirectory);
  @autoreleasepool {
    [ArdiaEarlyWindow setDataDirectory:AppDataDirectory()];
    [ArdiaEarlyWindow prefetchForSession:[ArdiaSavedSession atLaunch:AppDataDirectory()]];
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
