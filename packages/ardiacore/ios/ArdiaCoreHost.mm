#import <Security/Security.h>
#import <objc/runtime.h>

#import "ArdiaCoreEarlyWindow.h"
#import "ArdiaCoreInternal.h"
#import "ArdiaCoreServices.h"
#import "ArdiaCoreNavigationDownloads.h"
#import "ArdiaCoreStartup.h"
#import "ArdiaCoreWebView.h"
#import "ArdiaCoreWebViewInternal.h"

#include <cctype>
#include <cstring>
#include <set>
#include <string>
#include <vector>

namespace {

id<NSApplicationDelegate> (^gMakeDelegate)(void);
id<NSApplicationDelegate> gAppDelegate;
BOOL gStarted;
NSString *gDataDirectory;

BOOL gMenuShortcutsReady;

void SendReservedShortcuts() {
  if (!gStarted || !gMenuShortcutsReady || ![ArdiaCoreEngine respondsToSelector:@selector(reservedShortcutsChanged)]) return;
  [ArdiaCoreEngine reservedShortcutsChanged];
}

void WatchReservedShortcuts() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserverForName:@"ArdiaMenuShortcutsChanged" object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *) {
      gMenuShortcutsReady = YES;
      SendReservedShortcuts();
    }];
    [center addObserverForName:NSTextInputContextKeyboardSelectionDidChangeNotification object:nil queue:NSOperationQueue.mainQueue
                    usingBlock:^(NSNotification *) { SendReservedShortcuts(); }];
  });
  SendReservedShortcuts();
}

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

NSString *DirectoryName(NSString *name) {
  if (!name.length) return @"Default";
  if ([name isEqualToString:@"Default"] || [name hasPrefix:@"Profile "]) return nil;
  return [@"Profile " stringByAppendingString:name];
}

NSString *InstalledDataDirectory() {
  NSString *support = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
  NSString *bundleId = NSBundle.mainBundle.bundleIdentifier ?: @"com.ardia.browser";
  return [[support stringByAppendingPathComponent:bundleId] stringByAppendingPathComponent:@"Chromium"];
}

bool IsTeamSigned() {
  SecCodeRef code = nullptr;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess) return false;
  CFDictionaryRef info = nullptr;
  OSStatus status = SecCodeCopySigningInformation((SecStaticCodeRef)code, kSecCSSigningInformation, &info);
  CFRelease(code);
  if (status != errSecSuccess || !info) return false;
  bool team = CFDictionaryGetValue(info, kSecCodeInfoTeamIdentifier) != nullptr;
  CFRelease(info);
  return team;
}

}

@interface ArdiaCoreBootstrapDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, readonly) NSMutableArray<NSURL *> *urls;
@end

static void TryEarlyLittleWindow();

@implementation ArdiaCoreBootstrapDelegate
- (instancetype)init {
  if ((self = [super init])) _urls = [NSMutableArray array];
  return self;
}
- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
  [_urls addObjectsFromArray:urls];
  TryEarlyLittleWindow();
}
@end

namespace {
ArdiaCoreBootstrapDelegate *gBootstrap;
bool gScratchDataDir = false;
bool gAppKitWillFinish = false;
bool gAppKitDidFinish = false;
NSArray<NSURL *> *gPendingLaunchURLs;
NSArray<NSURL *> *gLaunchLinks;
bool gLinksHandled = false;
bool gJSStarted = false;
void (^gEventHandler)(NSString *, NSDictionary *);
void (^gChromeUIHandler)(NSString *, NSDictionary *);
void (^gExtensionsEventHandler)(NSString *, NSDictionary *);
NSMutableDictionary<NSString *, NSDictionary *> *gInstallPrompts = [NSMutableDictionary dictionary];
}

static bool LaunchTabSwitchedOff(NSString *dir) {
  if (const char *env = getenv("ARDIA_SWITCHES")) {
    NSNumber *said = nil;
    for (NSString *part in [@(env) componentsSeparatedByString:@","]) {
      NSArray<NSString *> *pair = [part componentsSeparatedByString:@"="];
      if (pair.count != 2) continue;
      NSString *name = [pair[0] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
      NSString *value = [pair[1] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
      if (![name isEqualToString:@"launchTab"]) continue;
      if ([@[ @"off", @"0", @"false" ] containsObject:value]) said = @NO;
      else if ([@[ @"on", @"1", @"true" ] containsObject:value]) said = @YES;
    }
    if (said) return !said.boolValue;
  }
  NSData *data = [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"switches-cache.json"]];
  NSDictionary *cache = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  NSDictionary *switches = [cache isKindOfClass:NSDictionary.class] && [cache[@"switches"] isKindOfClass:NSDictionary.class] ? cache[@"switches"] : nil;
  return [switches[@"launchTab"] isEqual:@NO];
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

static NSDictionary *SessionDefaultDestination(NSDictionary *settings, NSDictionary *routing) {
  if ([routing[@"defaultDestination"] isKindOfClass:NSDictionary.class]) return routing[@"defaultDestination"];
  return [settings[@"openLinksInLittleArdia"] isEqual:@NO] ? @{@"kind" : @"recent"} : @{@"kind" : @"little"};
}

static NSDictionary *SessionLinkRouting(NSDictionary *session) {
  NSDictionary *settings = [session[@"settings"] isKindOfClass:NSDictionary.class] ? session[@"settings"] : @{};
  NSDictionary *routing = [settings[@"linkRouting"] isKindOfClass:NSDictionary.class] ? settings[@"linkRouting"] : @{};
  NSMutableDictionary<NSString *, NSString *> *profiles = [NSMutableDictionary dictionary];
  NSDictionary *saved = [session[@"profiles"] isKindOfClass:NSDictionary.class] ? session[@"profiles"] : @{};
  for (NSString *sidebar in saved) {
    NSDictionary *profile = [saved[sidebar] isKindOfClass:NSDictionary.class] ? saved[sidebar] : nil;
    if (!profile || ![sidebar isKindOfClass:NSString.class]) continue;
    NSString *data = [profile[@"dataId"] isKindOfClass:NSString.class] ? profile[@"dataId"] : sidebar;
    profiles[sidebar] = [data isEqualToString:@"default"] ? @"" : data;
  }
  return @{
    @"rules" : [routing[@"rules"] isKindOfClass:NSArray.class] ? routing[@"rules"] : @[],
    @"defaultDestination" : SessionDefaultDestination(settings, routing),
    @"profiles" : profiles,
    @"recent" : [session[@"linkProfileId"] isKindOfClass:NSString.class] ? session[@"linkProfileId"] : @"",
  };
}

static NSString *SessionTabSidebar(NSDictionary *session, NSString *tabId) {
  for (NSDictionary *tab in [session[@"tabs"] isKindOfClass:NSArray.class] ? session[@"tabs"] : @[])
    if ([tab isKindOfClass:NSDictionary.class] && [tab[@"id"] isEqual:tabId] && [tab[@"profileId"] isKindOfClass:NSString.class])
      return tab[@"profileId"];
  return @"";
}

static void InstallSessionLinkRouting(NSDictionary *session) {
  if ([ArdiaCoreEngine respondsToSelector:@selector(setLinkRouting:live:)]) [ArdiaCoreEngine setLinkRouting:SessionLinkRouting(session) live:NO];
}

static void ParkLaunchLinks(NSArray<NSURL *> *links, NSString *dir, NSDictionary *session) {
  if (!links.count) return;
  InstallSessionLinkRouting(session);
  if (LaunchTabSwitchedOff(dir)) return;
  NSMutableArray<NSString *> *urls = [NSMutableArray array];
  for (NSURL *link in links)
    if (!link.isFileURL && link.absoluteString.length) [urls addObject:link.absoluteString];
  [ArdiaCoreWebView startLinkTabs:urls];
}

static void LinksArrived(NSArray<NSURL *> *urls) {
  if (gLinksHandled || !urls.count) return;
  gLinksHandled = true;
  if (!gJSStarted) {
    gLaunchLinks = [urls copy];
    return;
  }
  NSString *dir = AppDataDirectory();
  ParkLaunchLinks(urls, dir, SavedSession(dir));
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

static void StartLaunchTab() {
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
  [ArdiaCoreWebView startLaunchTab:key url:url profile:profile sidebar:SessionTabSidebar(session, key)];
  if (ArdiaCoreTab *tab = ArdiaCoreWebView.launchTab) [ArdiaCoreEarlyWindow attachPage:tab key:key];
}

static bool gLaunchedHidden;
static bool gEarlyWindowPending;
static bool gLaunchedForDocuments;

static bool OnboardingPending(NSString *dir) {
  NSData *data = [NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"onboarding.json"]];
  NSDictionary *saved = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![saved isKindOfClass:NSDictionary.class]) return false;
  const bool completed = [saved[@"completedAt"] isKindOfClass:NSNumber.class] && [saved[@"completedAt"] doubleValue] > 0;
  return !completed && [saved[@"startedAt"] isKindOfClass:NSNumber.class];
}

static void TryEarlyWindow() {
  if (ArdiaCoreEarlyWindow.switchedOff) return;
  NSString *dir = AppDataDirectory();
  if (gLaunchedHidden || gLaunchedForDocuments || NSApp.isHidden || gBootstrap.urls.count || LaunchTabSwitchedOff(dir) || OnboardingPending(dir)) return;
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
  if (![ArdiaCoreEarlyWindow canShowWindow:focused session:session]) return;
  ArdiaCoreProfile *loaded = ardiacore_host::LoadedProfile(profile);
  if (!loaded) return;
  const char *spare = getenv("ARDIA_LAUNCH_SPARE_RENDERER");
  if (!(spare && !strcmp(spare, "off")) && [loaded respondsToSelector:@selector(warmSpareRenderer)]) [loaded warmSpareRenderer];
  const char *windowFirst = getenv("ARDIA_EARLY_WINDOW_FIRST");
  if (windowFirst && !strcmp(windowFirst, "off")) {
    [ArdiaCoreWebView startLaunchTab:key url:url profile:profile sidebar:SessionTabSidebar(session, key)];
    if (![ArdiaCoreEarlyWindow showWindow:focused frame:window[@"frame"] key:key profile:profile backdrop:backdrop]) return;
  } else {
    const BOOL shown = [ArdiaCoreEarlyWindow showWindow:focused frame:window[@"frame"] key:key profile:profile backdrop:backdrop];
    [ArdiaCoreWebView startLaunchTab:key url:url profile:profile sidebar:SessionTabSidebar(session, key)];
    if (!shown) return;
  }
  if (ArdiaCoreTab *tab = ArdiaCoreWebView.launchTab) [ArdiaCoreEarlyWindow attachPage:tab key:key];
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

static bool EarlyLittleWindowOff() {
  const char *env = getenv("ARDIA_EARLY_LINK_WINDOW");
  return env && (!strcmp(env, "off") || !strcmp(env, "0") || !strcmp(env, "false"));
}

static bool gEarlyLittleTried;

static void TryEarlyLittleWindow() {
  if (gEarlyLittleTried || !gStarted || gJSStarted || gBootstrap.urls.count != 1) return;
  gEarlyLittleTried = true;
  if (EarlyLittleWindowOff() || ArdiaCoreEarlyWindow.switchedOff) return;
  NSURL *link = gBootstrap.urls.firstObject;
  NSString *scheme = link.scheme.lowercaseString;
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) return;
  NSString *dir = AppDataDirectory();
  if (gLaunchedHidden || NSApp.isHidden || LaunchTabSwitchedOff(dir) || OnboardingPending(dir)) return;
  NSDictionary *session = SavedSession(dir);
  NSDictionary *settings = [session[@"settings"] isKindOfClass:NSDictionary.class] ? session[@"settings"] : @{};
  InstallSessionLinkRouting(session);
  if (![ArdiaCoreEngine respondsToSelector:@selector(routeLink:origin:profile:)]) return;
  NSDictionary *decision = [ArdiaCoreEngine routeLink:link.absoluteString origin:@"external" profile:@""];
  if (![decision[@"action"] isEqual:@"little"]) return;
  NSString *profile = [decision[@"engine"] isKindOfClass:NSString.class] ? decision[@"engine"] : nil;
  NSDictionary *backdrop = [session[@"launchBackdrop"] isKindOfClass:NSDictionary.class] ? session[@"launchBackdrop"] : nil;
  const bool dark = [[NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameDarkAqua, NSAppearanceNameAqua ]]
      isEqualToString:NSAppearanceNameDarkAqua];
  if (!profile || !backdrop || ![backdrop[@"dark"] isKindOfClass:NSNumber.class] || [backdrop[@"dark"] boolValue] != dark) return;
  if (!ardiacore_host::LoadedProfile(profile)) return;
  NSArray<NSNumber *> *frame = LittleArdiaFrame(settings[@"littleArdiaSize"]);
  if (!frame) return;
  NSString *url = link.absoluteString;
  [ArdiaCoreWebView startLinkTabs:@[ url ]];
  ArdiaCoreTab *tab = ArdiaCoreWebView.firstLinkTab;
  NSString *mark = tab && [[ArdiaCoreWebView linkDecisionForTab:tab][@"action"] isEqual:@"little"] ? [ArdiaCoreWebView linkMarkForTab:tab] : nil;
  NSString *focused = [session[@"focusedWindowId"] isKindOfClass:NSString.class] ? session[@"focusedWindowId"] : nil;
  if (mark) [ArdiaCoreEarlyWindow showLittleWindowForLink:tab mark:mark url:url frame:frame profile:profile backdrop:backdrop like:focused];
}

static void StartEarlyWindow() {
  @autoreleasepool {
    TryEarlyWindow();
    TryEarlyLittleWindow();
    [ArdiaCoreEarlyWindow discardPrefetch];
  }
}

@interface ArdiaCoreHostEngineDelegate : NSObject <ArdiaCoreEngineDelegate>
@end

@implementation ArdiaCoreHostEngineDelegate

- (void)engineDidStart {
  NSLog(@"[ardiacore] engine started (Chromium %@)", ArdiaCoreEngine.sharedEngine.chromiumVersion);
  gStarted = YES;
  WatchReservedShortcuts();
  ardiacore_host::InstallActivationGuardsLate();
  if (gScratchDataDir && ardiacore_host::Background())
    ardiacore_host::InstallTestCrashGuard([gDataDirectory stringByDeletingLastPathComponent]);
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  if (ArdiaCoreProfile *profile = ardiacore_host::PersonalIfLoaded(engine)) Profiles()[@""] = profile;
  ardiacore_host::LoadContentBlocker(@"");
  [ArdiaCoreWebView installScrollZoom];
  [ArdiaCoreWebView installSwitchPrewarm];
  [ArdiaCoreWebView installOutgoingFocusSnapshots];
  [ArdiaCoreServices watchDownloads:@""];

  NSBundle *bundle = [NSBundle bundleForClass:ArdiaCoreHostEngineDelegate.class];
  NSString *path = [bundle pathForResource:@"page_script" ofType:@"js"];
  NSString *script = path ? [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] : nil;
  if (script && [engine respondsToSelector:@selector(setPageScript:)]) engine.pageScript = script;
  if (gAppKitDidFinish) StartEarlyWindow();
  else gEarlyWindowPending = true;

  CFRunLoopObserverRef idle = CFRunLoopObserverCreateWithHandler(
      nullptr, kCFRunLoopBeforeWaiting, false, 0, ^(CFRunLoopObserverRef observer, CFRunLoopActivity) {
        CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
        __block id started = [NSNotificationCenter.defaultCenter
            addObserverForName:@"RCTJavaScriptWillStartExecutingNotification"
                        object:nil
                         queue:nil
                    usingBlock:^(NSNotification *) {
                      [NSNotificationCenter.defaultCenter removeObserver:started];
                      started = nil;
                      dispatch_async(dispatch_get_main_queue(), ^{ StartLaunchTab(); });
                    }];
        [self launchApp];
      });
  CFRunLoopAddObserver(CFRunLoopGetMain(), idle, kCFRunLoopCommonModes);
  CFRelease(idle);
}

- (void)launchApp {
  NSArray<NSURL *> *launchURLs = gBootstrap.urls.copy;
  LinksArrived(launchURLs);
  gAppDelegate = gMakeDelegate();
  const SEL openURLs = @selector(application:openURLs:);
  if (Method open = class_getInstanceMethod([gAppDelegate class], openURLs)) {
    IMP original = method_getImplementation(open);
    method_setImplementation(open, imp_implementationWithBlock(^(id delegate, NSApplication *app, NSArray<NSURL *> *urls) {
      LinksArrived(urls);
      ((void (*)(id, SEL, NSApplication *, NSArray<NSURL *> *))original)(delegate, openURLs, app, urls);
    }));
  }
  NSApp.delegate = gAppDelegate;
  gBootstrap = nil;
  NSNotification *note = [NSNotification notificationWithName:NSApplicationWillFinishLaunchingNotification object:NSApp];
  if (gAppKitWillFinish && [gAppDelegate respondsToSelector:@selector(applicationWillFinishLaunching:)])
    [gAppDelegate applicationWillFinishLaunching:note];
  if (!gAppKitDidFinish) {
    NSLog(@"[ardiacore] app delegate %@ set before AppKit finished launching", NSStringFromClass([gAppDelegate class]));
    gPendingLaunchURLs = launchURLs;
    return;
  }
  note = [NSNotification notificationWithName:NSApplicationDidFinishLaunchingNotification object:NSApp];
  if ([gAppDelegate respondsToSelector:@selector(applicationDidFinishLaunching:)])
    [gAppDelegate applicationDidFinishLaunching:note];
  NSLog(@"[ardiacore] app delegate %@ launched", NSStringFromClass([gAppDelegate class]));
  if (launchURLs.count && [gAppDelegate respondsToSelector:@selector(application:openURLs:)])
    [gAppDelegate application:NSApp openURLs:launchURLs];
}

- (void)engineWillShutDown {
  gStarted = NO;
}

- (void)engineQuitCancelled {
  NSLog(@"[ardiacore] quit cancelled");
  [NSNotificationCenter.defaultCenter postNotificationName:@"ArdiaCoreQuitCancelled" object:nil];
}

- (void)engine:(ArdiaCoreEngine *)engine loadLinkProfile:(NSString *)name completion:(void (^)(ArdiaCoreProfile *))completion {
  if (ardiacore_host::IsIncognito(name) || ardiacore_host::IsDeletedProfile(name)) return completion(nil);
  ardiacore_host::WithProfile(name, completion);
}

- (void)engine:(ArdiaCoreEngine *)engine permissionRequest:(NSDictionary *)request tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [request mutableCopy];
  payload[@"browserId"] = @(tab ? ardiacore_host::BrowserId(tab) : 0);
  if (gEventHandler) gEventHandler(@"permission", payload);
}

- (void)engine:(ArdiaCoreEngine *)engine deviceChooser:(NSDictionary *)chooser tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [chooser mutableCopy];
  payload[@"browserId"] = @(tab ? ardiacore_host::BrowserId(tab) : 0);
  if (auto handler = ArdiaCoreHost.chromeUIHandler) handler(@"deviceChooser", payload);
  else if ([payload[@"open"] boolValue] && [ArdiaCoreEngine respondsToSelector:@selector(cancelDeviceChooser:)])
    [ArdiaCoreEngine cancelDeviceChooser:[payload[@"id"] intValue]];
}

- (void)engine:(ArdiaCoreEngine *)engine castDialog:(NSDictionary *)dialog tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [dialog mutableCopy];
  payload[@"browserId"] = @(tab ? ardiacore_host::BrowserId(tab) : 0);
  if (gChromeUIHandler) gChromeUIHandler(@"castDialog", payload);
  else if ([payload[@"open"] boolValue] && [ArdiaCoreEngine respondsToSelector:@selector(closeCastDialog:)])
    [ArdiaCoreEngine closeCastDialog:[payload[@"id"] intValue]];
}

- (void)engine:(ArdiaCoreEngine *)engine castRoutes:(NSArray *)routes profile:(ArdiaCoreProfile *)profile {
  if (!gChromeUIHandler) return;
  NSMutableArray<NSString *> *names = [NSMutableArray array];
  if (profile.offTheRecord)
    for (NSString *name in ardiacore_host::LoadedProfileNames())
      if (ardiacore_host::LoadedProfile(name) == profile) [names addObject:name];
  if (!names.count) [names addObject:ardiacore_host::ProfileName(profile)];
  for (NSString *name in names) gChromeUIHandler(@"castRoutes", @{@"profile" : name, @"routes" : routes ?: @[]});
}

- (void)engine:(ArdiaCoreEngine *)engine extensionSidePanel:(NSDictionary *)panel tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [panel mutableCopy];
  payload[@"browserId"] = @(tab ? ardiacore_host::BrowserId(tab) : 0);
  if (gChromeUIHandler) gChromeUIHandler(@"sidePanel", payload);
}

- (BOOL)engine:(ArdiaCoreEngine *)engine extensionActionPopup:(NSDictionary *)popup tab:(ArdiaCoreTab *)tab {
  if (!gChromeUIHandler || !tab) {
    NSLog(@"[ardiacore] action.openPopup for %@: %@", popup[@"extensionId"], tab ? @"the app isn't listening yet" : @"no tab");
    return NO;
  }
  NSMutableDictionary *payload = [popup mutableCopy];
  payload[@"browserId"] = @(ardiacore_host::BrowserId(tab));
  gChromeUIHandler(@"actionPopup", payload);
  return YES;
}

- (BOOL)engineIsReservedKey:(NSString *)key unshiftedKey:(NSString *)unshiftedKey modifiers:(NSEventModifierFlags)modifiers {
  return ardiacore_host::IsReservedBinding(key, unshiftedKey, modifiers);
}

- (BOOL)engineIsReservedKeyEvent:(NSEvent *)event {
  return event.type == NSEventTypeKeyDown && ardiacore_host::IsReservedKeyEvent(event);
}

- (BOOL)engine:(ArdiaCoreEngine *)engine extensionActionShortcut:(NSDictionary *)shortcut tab:(ArdiaCoreTab *)tab {
  if (!gChromeUIHandler || !tab) return NO;
  NSMutableDictionary *payload = [shortcut mutableCopy];
  payload[@"browserId"] = @(ardiacore_host::BrowserId(tab));
  gChromeUIHandler(@"actionShortcut", payload);
  return YES;
}

- (void)engine:(ArdiaCoreEngine *)engine extensionInstallPrompt:(NSDictionary *)prompt tab:(ArdiaCoreTab *)tab {
  NSMutableDictionary *payload = [prompt mutableCopy];
  payload[@"browserId"] = @(tab ? ardiacore_host::BrowserId(tab) : 0);
  if ([prompt[@"profile"] isKindOfClass:NSString.class]) payload[@"profile"] = ardiacore_host::ProfileNameOfDirectory(prompt[@"profile"]);
  gInstallPrompts[payload[@"requestId"] ?: @""] = payload;
  if (gExtensionsEventHandler) gExtensionsEventHandler(@"installPrompt", payload);
}

- (void)engine:(ArdiaCoreEngine *)engine permissionRequestDismissed:(NSString *)requestId {
  if (gEventHandler) gEventHandler(@"permissionDismissed", @{@"id" : requestId ?: @""});
}

- (ArdiaCoreWindow *)engineWindowForNewBrowserOfProfile:(ArdiaCoreProfile *)profile type:(NSString *)type {
  if (![type isEqualToString:@"normal"] && ![type isEqualToString:@"popup"]) return nil;
  if ([type isEqualToString:@"normal"] && !profile.offTheRecord)
    if (ArdiaCoreWindowController *made = [ArdiaCoreWindowController chromeMadeWindowForProfile:profile]) return made.coreWindow;
  return [ArdiaCoreWindowController strayWindowForProfile:profile].coreWindow;
}

@end

@implementation ArdiaCoreHost

+ (int)runWithArgc:(int)argc argv:(char **)argv delegate:(id<NSApplicationDelegate> (^)(void))makeDelegate {
  const char *dataDir = getenv("ARDIA_DATA_DIR");
  gScratchDataDir = dataDir && *dataDir;
#if DEBUG
  if (!gScratchDataDir) {
    fprintf(stderr, "[ardiacore] set ARDIA_DATA_DIR to a scratch directory\n");
    return 1;
  }
#endif
  gMakeDelegate = [makeDelegate copy];
  NSString *scratch = gScratchDataDir ? @(dataDir) : nil;
  if (scratch && !scratch.absolutePath)
    scratch = [NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:scratch];
  gDataDirectory = scratch ? [scratch.stringByStandardizingPath stringByAppendingPathComponent:@"Chromium"] : InstalledDataDirectory();
  NSError *dirError;
  if (![NSFileManager.defaultManager createDirectoryAtPath:gDataDirectory withIntermediateDirectories:YES attributes:nil error:&dirError]) {
    fprintf(stderr, "[ardiacore] can't use the data dir %s: %s\n", gDataDirectory.fileSystemRepresentation,
            dirError.localizedDescription.UTF8String ?: "");
    return 1;
  }
  ardiacore_host::InstallTestCrashGuard(scratch && ardiacore_host::Background() ? scratch.stringByStandardizingPath : nil);
  ardiacore_host::InstallActivationGuardsEarly();
  ardiacore_host::PrepareContentBlocker();
  Method finishLaunching = class_getInstanceMethod(NSApplication.class, @selector(finishLaunching));
  IMP appKitFinishLaunching = method_getImplementation(finishLaunching);
  method_setImplementation(finishLaunching, imp_implementationWithBlock(^(NSApplication *app) {
    if (!gAppDelegate && !app.delegate) {
      gBootstrap = [ArdiaCoreBootstrapDelegate new];
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
  if (getenv("ARDIA_TRACE_VISIBILITY")) {
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

  const char *tabFreezing = getenv("ARDIA_TAB_FREEZING");
  const bool freezeLeastRecentTabs = !(tabFreezing && !strcmp(tabFreezing, "off"));
  const char *slowTabThaw = getenv("ARDIA_SLOW_TAB_THAW");
  const bool thawFrozenTabsRarely = !(slowTabThaw && !strcmp(slowTabThaw, "off"));
  const char *mainFrameThrottle = getenv("ARDIA_MAIN_FRAME_THROTTLE");
  const bool throttleMainFramesTo60Hz = !(mainFrameThrottle && !strcmp(mainFrameThrottle, "off"));
  const char *scrollFullRate = getenv("ARDIA_SCROLL_FULL_RATE");
  const bool fullRateAfterInput = !(scrollFullRate && !strcmp(scrollFullRate, "off"));
  const char *walletPasses = getenv("ARDIA_WALLET_PASSES");
  const bool biometricsCheckPerTab = walletPasses && !strcmp(walletPasses, "on");
  std::vector<std::string> extra = {
      "--user-data-dir=" + std::string(gDataDirectory.UTF8String),
      "--enable-smooth-scrolling",
      "--disable-stack-profiler",
      std::string("--disable-features=MacAppCodeSignClone,DevToolsAcceptDebuggingConnections") +
          (biometricsCheckPerTab ? "" : ",AutofillAiWalletPrivatePasses") +
          (freezeLeastRecentTabs ? "" : ",InfiniteTabsFreezing"),
      std::string("--enable-features=WebContentsDiscard,BrowserInitiatedAutomaticPictureInPicture,ImprovedStartupBestEffortDelay:StartupDelayStopOnLoadingTimedOut/true,"
                  "CPUMeasurementInFreezingPolicy:freezing_visible_protection_time/0s") +
          (freezeLeastRecentTabs ? (thawFrozenTabsRarely ? ",InfiniteTabsFreezing:ardia_unconnected_unfreeze_interval/600s" : ",InfiniteTabsFreezing") : "") + (throttleMainFramesTo60Hz ? (fullRateAfterInput ? ",ThrottleMainFrameTo60Hz,UrgentMainFrameForInput" : ",ThrottleMainFrameTo60Hz:ardia_full_rate_after_input/0s,UrgentMainFrameForInput") : ""),
      "--profile-directory=Default",
      "--js-flags=--no-memory-reducer",
  };
  const bool mockKeychain = gScratchDataDir || !IsTeamSigned();
  if (mockKeychain) extra.push_back("--use-mock-keychain");
  ardiacore_host::PrepareStartup(gDataDirectory, extra);
  @autoreleasepool {
    [ArdiaCoreEarlyWindow setDataDirectory:AppDataDirectory()];
    [ArdiaCoreEarlyWindow prefetchForSession:SavedSession(AppDataDirectory()) ?: @{}];
  }
  if (getenv("ARDIA_BACKGROUND") && !getenv("ARDIA_ALLOW_OCCLUSION")) {
    extra.push_back("--disable-backgrounding-occluded-windows");
    if (Method occluded = class_getInstanceMethod(NSWindow.class, NSSelectorFromString(@"isOccluded")))
      method_setImplementation(occluded, imp_implementationWithBlock(^BOOL(id) { return NO; }));
  }
  if (getenv("ARDIA_BACKGROUND") && getenv("ARDIA_ALLOW_OCCLUSION")) ReportLoweredWindowOcclusion();
  if (getenv("ARDIA_BACKGROUND") && !getenv("ARDIA_ALLOW_AUDIO")) extra.push_back("--mute-audio");
  if (getenv("ARDIA_BACKGROUND")) extra.push_back("--use-fake-device-for-media-stream");
  if (getenv("ARDIA_BACKGROUND")) extra.push_back("--disable-modal-animations");
  auto autoAccepts = [](const char *sw) {
    return getenv("ARDIA_BACKGROUND") && (!strncmp(sw, "--use-fake-ui-for-media-stream", 30) ||
                                              !strncmp(sw, "--auto-accept-camera-and-microphone-capture", 43));
  };
  if (const char *port = getenv("ARDIA_REMOTE_DEBUGGING_PORT"); port && mockKeychain) {
    extra.push_back(std::string("--remote-debugging-port=") + port);
    extra.push_back("--remote-allow-origins=*");
  }
  if (const char *switches = getenv("ARDIA_CHROMIUM_SWITCHES"); switches && mockKeychain) {
    NSString *all = [@" " stringByAppendingString:@(switches)];
    for (NSString *item in [all componentsSeparatedByString:@" --"]) {
      NSString *sw = [item stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
      std::string full = std::string("--") + sw.UTF8String;
      if (sw.length && !autoAccepts(full.c_str())) extra.push_back(full);
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
    if (autoAccepts(arg)) continue;
    args.push_back(arg);
  }
  static std::vector<std::string> merged;
  merged = MergeFeatureLists(args);
  args.resize(1);
  for (const std::string &s : merged) args.push_back(s.c_str());
  static ArdiaCoreHostEngineDelegate *engineDelegate = [ArdiaCoreHostEngineDelegate new];
  return [ArdiaCoreEngine runWithArgc:(int)args.size() argv:args.data() delegate:engineDelegate];
}

+ (void (^)(NSString *, NSDictionary *))eventHandler {
  return gEventHandler;
}

+ (void)setEventHandler:(void (^)(NSString *, NSDictionary *))handler {
  gEventHandler = [handler copy];
}

+ (void (^)(NSString *, NSDictionary *))extensionsEventHandler {
  return gExtensionsEventHandler;
}

+ (void)setExtensionsEventHandler:(void (^)(NSString *, NSDictionary *))handler {
  gExtensionsEventHandler = [handler copy];
  if (handler)
    for (NSDictionary *prompt in gInstallPrompts.allValues) handler(@"installPrompt", prompt);
}

+ (void)resolveExtensionInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted {
  [gInstallPrompts removeObjectForKey:requestId ?: @""];
  if ([ArdiaCoreEngine respondsToSelector:@selector(resolveExtensionInstallPrompt:accepted:)])
    [ArdiaCoreEngine resolveExtensionInstallPrompt:requestId accepted:accepted];
}

+ (void)beginTracing:(void (^)(BOOL))completion {
  if (![ArdiaCoreEngine respondsToSelector:@selector(beginTracing:)]) return completion(NO);
  [ArdiaCoreEngine beginTracing:completion];
}

+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *))completion {
  if (![ArdiaCoreEngine respondsToSelector:@selector(endTracing:completion:)]) return completion(nil);
  [ArdiaCoreEngine endTracing:keep completion:completion];
}

+ (BOOL)isTracing {
  return [ArdiaCoreEngine respondsToSelector:@selector(isTracing)] && ArdiaCoreEngine.isTracing;
}

+ (void)deleteProfileData:(NSString *)profile completion:(void (^)(NSArray<NSString *> *))completion {
  if (ardiacore_host::IsIncognito(profile)) return completion(@[]);
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  if (!profile.length || ![engine respondsToSelector:@selector(deleteProfile:completion:)]) return completion(@[ @"data" ]);
  [DeletedProfiles() addObject:profile];
  void (^remove)(ArdiaCoreProfile *) = ^(ArdiaCoreProfile *loaded) {
    if (!loaded) {
      NSString *path = [gDataDirectory stringByAppendingPathComponent:[@"Profile " stringByAppendingString:profile]];
      [NSFileManager.defaultManager removeItemAtPath:path error:nil];
      return completion([NSFileManager.defaultManager fileExistsAtPath:path] ? @[ @"files" ] : @[]);
    }
    [engine deleteProfile:loaded completion:^(BOOL deleted) {
      if (deleted) [Profiles() removeObjectForKey:profile];
      else [DeletedProfiles() removeObject:profile];
      completion(deleted ? @[] : @[ @"data" ]);
    }];
  };
  if (!p && ProfileWaiters()[profile]) {
    DeletionsAfterLoad()[profile] = [remove copy];
    return;
  }
  remove(p);
}

+ (void)releaseProfile:(NSString *)profile {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  ArdiaCoreProfile *p = ardiacore_host::LoadedProfile(profile);
  if (ardiacore_host::IsIncognito(profile)) {
    if (profile) [ReleasedPrivateNames() addObject:profile];
    [Profiles() removeObjectForKey:profile];
    NSArray *waiting = ProfileWaiters()[profile];
    [ProfileWaiters() removeObjectForKey:profile];
    for (void (^waiter)(ArdiaCoreProfile *) in waiting) waiter(nil);
    ardiacore_host::ForgetPrivateNavigationDownloads(profile);
    if ([Profiles().allValues containsObject:p]) return;
  }
  if (p && [engine respondsToSelector:@selector(releaseProfile:)]) [engine releaseProfile:p];
}

+ (BOOL)stopCapture:(int)browserId {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(stopCapture)] && [tab stopCapture];
}

+ (BOOL)showAutofillSuggestions:(int)browserId passwords:(BOOL)passwords {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(showAutofillSuggestions:)] && [tab showAutofillSuggestions:passwords];
}

+ (void (^)(NSString *, NSDictionary *))chromeUIHandler {
  return gChromeUIHandler;
}

+ (void)setChromeUIHandler:(void (^)(NSString *, NSDictionary *))handler {
  gChromeUIHandler = [handler copy];
}

+ (void)deviceChooser:(int)chooserId select:(int)index {
  if ([ArdiaCoreEngine respondsToSelector:@selector(selectDevice:index:)]) [ArdiaCoreEngine selectDevice:chooserId index:index];
}

+ (void)deviceChooser:(int)chooserId action:(NSString *)action {
  if ([action isEqualToString:@"cancel"] && [ArdiaCoreEngine respondsToSelector:@selector(cancelDeviceChooser:)])
    [ArdiaCoreEngine cancelDeviceChooser:chooserId];
  else if ([action isEqualToString:@"refresh"] && [ArdiaCoreEngine respondsToSelector:@selector(refreshDeviceChooser:)])
    [ArdiaCoreEngine refreshDeviceChooser:chooserId];
  else if ([action isEqualToString:@"settings"] && [ArdiaCoreEngine respondsToSelector:@selector(openDeviceChooserSettings:)])
    [ArdiaCoreEngine openDeviceChooserSettings:chooserId];
}

+ (NSArray<NSDictionary *> *)testExternalLaunches {
  return ArdiaCoreEngine.testExternalLaunches ?: @[];
}

+ (BOOL)devShowBluetoothChooser:(int)browserId unauthorized:(BOOL)unauthorized {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(devShowBluetoothChooser:)] && [tab devShowBluetoothChooser:unauthorized];
}

+ (NSArray<NSDictionary *> *)testChooserEvents {
  return [ArdiaCoreEngine respondsToSelector:@selector(testChooserEvents)] ? ArdiaCoreEngine.testChooserEvents ?: @[] : @[];
}

+ (BOOL)shareTabInstead:(int)capturerBrowserId target:(int)targetBrowserId {
  ArdiaCoreTab *capturer = ardiacore_host::TabWithBrowserId(capturerBrowserId);
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(targetBrowserId);
  return capturer && [tab respondsToSelector:@selector(shareThisTabInsteadFor:)] && [tab shareThisTabInsteadFor:capturer];
}

+ (BOOL)showCastDialog:(int)browserId {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(showCastDialog)] && [tab showCastDialog];
}

+ (void)castDialog:(int)dialogId start:(NSString *)sink mode:(int)mode {
  if ([ArdiaCoreEngine respondsToSelector:@selector(startCasting:sink:mode:)]) [ArdiaCoreEngine startCasting:dialogId sink:sink mode:mode];
}

+ (void)castDialog:(int)dialogId stop:(NSString *)route {
  if ([ArdiaCoreEngine respondsToSelector:@selector(stopCasting:route:)]) [ArdiaCoreEngine stopCasting:dialogId route:route];
}

+ (void)closeCastDialog:(int)dialogId {
  if ([ArdiaCoreEngine respondsToSelector:@selector(closeCastDialog:)]) [ArdiaCoreEngine closeCastDialog:dialogId];
}

+ (void)watchCastRoutes:(NSString *)profileName {
  ardiacore_host::WithProfile(profileName, ^(ArdiaCoreProfile *profile) {
    if ([profile respondsToSelector:@selector(watchCastRoutes)]) [profile watchCastRoutes];
  });
}

+ (void)terminateCastRoute:(NSString *)route {
  if ([ArdiaCoreEngine respondsToSelector:@selector(terminateCastRoute:)]) [ArdiaCoreEngine terminateCastRoute:route];
}

+ (void)resolveExternalApp:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember {
  if ([ArdiaCoreEngine respondsToSelector:@selector(resolveExternalApp:open:remember:)])
    [ArdiaCoreEngine resolveExternalApp:requestId open:open remember:remember];
}

+ (NSDictionary *)actionStates:(int)browserId extensions:(NSArray<NSString *> *)ids {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(actionStatesForExtensions:)] ? [tab actionStatesForExtensions:ids] ?: @{} : @{};
}

+ (NSString *)sidePanelURL:(int)browserId extension:(NSString *)extensionId {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  return [tab respondsToSelector:@selector(sidePanelURLForExtension:)] ? [tab sidePanelURLForExtension:extensionId] : nil;
}

+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  if ([engine respondsToSelector:@selector(resolvePermission:result:remember:)])
    [engine resolvePermission:requestId result:result remember:remember];
}

+ (NSArray<NSDictionary<NSString *, id> *> *)displayMediaSources {
  NSMutableArray *sources = [NSMutableArray array];
  NSUInteger index = 0;
  for (NSScreen *screen in NSScreen.screens) {
    NSNumber *display = screen.deviceDescription[@"NSScreenNumber"];
    index++;
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"screen:%u:0", display.unsignedIntValue],
      @"kind" : @"screen",
      @"name" : screen.localizedName ?: [NSString stringWithFormat:@"Screen %lu", (unsigned long)index],
      @"width" : @(screen.frame.size.width),
      @"height" : @(screen.frame.size.height),
    }];
  }
  NSArray *windows = CFBridgingRelease(
      CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
  const pid_t me = getpid();
  for (NSDictionary *w in windows) {
    if ([w[(id)kCGWindowLayer] intValue] != 0 || [w[(id)kCGWindowOwnerPID] intValue] == me) continue;
    NSDictionary *bounds = w[(id)kCGWindowBounds];
    const CGFloat width = [bounds[@"Width"] doubleValue], height = [bounds[@"Height"] doubleValue];
    if (width < 50 || height < 50) continue;
    NSString *app = w[(id)kCGWindowOwnerName] ?: @"";
    NSString *title = w[(id)kCGWindowName];
    [sources addObject:@{
      @"id" : [NSString stringWithFormat:@"window:%u:0", [w[(id)kCGWindowNumber] unsignedIntValue]],
      @"kind" : @"window",
      @"name" : title.length ? title : app,
      @"app" : app,
      @"pid" : w[(id)kCGWindowOwnerPID] ?: @0,
      @"width" : @(width),
      @"height" : @(height),
    }];
  }
  return sources;
}

+ (BOOL)isStarted {
  return gStarted;
}

+ (NSString *)dataDirectory {
  return gDataDirectory ?: @"";
}

+ (NSDictionary<NSString *, id> *)engineInfo {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  NSInteger chromeWindows = 0;
  for (ArdiaCoreWindowController *c in ArdiaCoreWindowController.all) chromeWindows += c.coreWindow ? 1 : 0;
  return @{
    @"pid" : @(NSProcessInfo.processInfo.processIdentifier),
    @"dataDirectory" : gDataDirectory ?: @"",
    @"engine" : @"ardiacore",
    @"chromiumVersion" : engine.chromiumVersion ?: @"",
    @"liveBrowsers" : @0,
    @"popupWindows" : @(ardiacore_host::PopupWindowCount()),
    @"chromeWindows" : @(chromeWindows),
    @"keepAlive" : engine.keepAliveState ?: @"",
    @"lastUsedProfile" : engine.defaultProfile.name ?: @"",
  };
}

+ (NSArray<NSDictionary<NSString *, id> *> *)chromeWindows {
  NSMutableArray *list = [NSMutableArray array];
  for (ArdiaCoreWindowController *c in ArdiaCoreWindowController.all) {
    NSWindow *w = c.coreWindow.window;
    if (!w) continue;
    ArdiaCoreProfile *active = c.coreWindow.activeProfile;
    [list addObject:@{
      @"profile" : ardiacore_host::ProfileName(active),
      @"window" : @(w.windowNumber),
      @"frame" : NSStringFromRect(w.frame),
      @"alpha" : @(w.alphaValue),
      @"key" : @(w.isKeyWindow),
      @"canBecomeKey" : @(w.canBecomeKeyWindow),
      @"visible" : @(w.isVisible),
      @"occlusionVisible" : @((w.occlusionState & NSWindowOcclusionStateVisible) != 0),
      @"chromeOccluded" : [w respondsToSelector:NSSelectorFromString(@"isOccluded")] ? [w valueForKey:@"occluded"] : NSNull.null,
      @"parentWindow" : @(w.parentWindow.windowNumber),
      @"chromeWindows" : @1,
      @"anchorBrowserId" : @0,
      @"anyTabBrowserId" : @0,
      @"ready" : @YES,
      @"active" : @(w.isMainWindow),
      @"pageInsets" : @[ @0, @0, @0, @0 ],
      @"hosting" : @(c.root != nil),
      @"group" : @"",
      @"hasRoot" : @(c.root != nil),
      @"translucent" : @(!w.opaque),
    }];
  }
  return list;
}

@end

namespace ardiacore_host {

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

bool IsIncognito(NSString *name) {
  return [name hasPrefix:@"incognito"];
}

NSString *OriginalProfileName(NSString *name) {
  if (!IsIncognito(name)) return name ?: @"";
  NSRange at = [name rangeOfString:@"@"];
  return at.location == NSNotFound ? @"" : [name substringFromIndex:NSMaxRange(at)];
}

NSString *OriginalProfileNameOf(ArdiaCoreProfile *profile) {
  if (!profile.offTheRecord) return ProfileName(profile);
  NSString *dir = profile.name;
  return [dir hasPrefix:@"Profile "] ? [dir substringFromIndex:8] : @"";
}

bool IsOffTheRecordOf(ArdiaCoreProfile *profile, NSString *name) {
  return profile.offTheRecord && IsIncognito(name) &&
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
    if (![engine respondsToSelector:@selector(offTheRecordProfileFor:completion:)]) return answer(nil, @"the engine is too old");
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
  if (IsIncognito(name)) return WithPrivateProfile(name, [completion copy]);
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
             if (profile) ardiacore_host::LoadContentBlocker(name);
             if (profile) [ArdiaCoreServices watchDownloads:name];
             for (void (^waiter)(ArdiaCoreProfile *) in pending) waiter(profile);
           }];
}

ArdiaCoreProfile *PersonalIfLoaded(ArdiaCoreEngine *engine) {
  ArdiaCoreProfile *profile = engine.defaultProfile;
  return [profile.name isEqualToString:@"Default"] ? profile : nil;
}

NSString *ProfileNameOfDirectory(NSString *directory) {
  for (ArdiaCoreProfile *profile in LoadedProfiles())
    if (!([profile respondsToSelector:@selector(offTheRecord)] && profile.offTheRecord) && [profile.name isEqualToString:directory])
      return ProfileName(profile);
  return [directory hasPrefix:@"Profile "] ? [directory substringFromIndex:8] : @"";
}

NSString *ProfileName(ArdiaCoreProfile *profile) {
  if (!profile) return @"";
  for (NSString *name in Profiles())
    if (Profiles()[name] == profile) return name;
  NSString *dir = profile.name;
  if ([dir hasPrefix:@"Profile "]) return [dir substringFromIndex:8];
  return @"";
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
