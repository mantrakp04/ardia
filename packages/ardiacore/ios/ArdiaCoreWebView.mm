#import "ArdiaCoreWebView.h"
#import "ArdiaCoreWebViewInternal.h"
#import "ArdiaCoreEarlyWindow.h"
#import "ArdiaCorePictureInPicture.h"
#import "ArdiaCoreServices.h"

#import <IOKit/IOKitLib.h>
#import <QuartzCore/QuartzCore.h>
#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>

#import "ArdiaCoreFieldTiming.h"
#import "ArdiaCoreNavigationDownloads.h"

#include <climits>
#include <cmath>

namespace {

bool TraceVisibility() {
  static const bool on = getenv("ARDIA_TRACE_VISIBILITY") != nullptr;
  return on;
}

constexpr CFTimeInterval kLeaveScreenDelay = 0.1;
constexpr CFTimeInterval kRevealBackstopSeconds = 5;
constexpr CFTimeInterval kNeighbourPagesAwakeSeconds = 10;

bool NeighbourPagesAlwaysLive() {
  static const bool on = [@(getenv("ARDIA_WARM_NEIGHBOURS") ?: "") isEqualToString:@"1"];
  return on;
}

}

@interface ACNeighbourWake : NSObject
@property(nonatomic) CFTimeInterval committedUntil;
@property(nonatomic) CFTimeInterval speculativeUntil;
@property(nonatomic, readonly) CFTimeInterval until;
@end

@implementation ACNeighbourWake
- (CFTimeInterval)until {
  return MAX(_committedUntil, _speculativeUntil);
}
@end

namespace {

NSMapTable<NSWindow *, ACNeighbourWake *> *NeighbourPagesAwake() {
  static NSMapTable *windows = [NSMapTable weakToStrongObjectsMapTable];
  return windows;
}

NSHashTable<ArdiaCoreWebView *> *LiveViews() {
  static NSHashTable *views = [NSHashTable weakObjectsHashTable];
  return views;
}

enum class ACPageFocus { Unknown, Page, DevTools, Elsewhere };

constexpr CFTimeInterval kFocusRestoreWindow = 1;

NSHashTable<ArdiaCoreWebView *> *PendingPainting() {
  static NSHashTable *views = [NSHashTable weakObjectsHashTable];
  return views;
}
bool gPaintingScheduled = false;

NSMutableDictionary<NSString *, ArdiaCoreTab *> *Parked() {
  static NSMutableDictionary *parked = [NSMutableDictionary dictionary];
  return parked;
}

NSMutableDictionary<NSString *, NSNumber *> *ReloadParked() {
  static NSMutableDictionary *parked = [NSMutableDictionary dictionary];
  return parked;
}

ArdiaCoreTab *gLaunchTab;
NSString *gLaunchKey;
NSString *gLaunchURL;
NSString *gLaunchProfile;
BOOL gLaunchClaimed;
const char kLaunchHolderKey = 0;
NSMutableSet<NSString *> *ClosedLaunch() {
  static NSMutableSet<NSString *> *keys = [NSMutableSet set];
  return keys;
}

void DropHeldRoutedTabs(ArdiaCoreTab *source);

void CloseTab(ArdiaCoreTab *tab) {
  if (!tab || tab.closed) return;
  DropHeldRoutedTabs(tab);
  if ([tab respondsToSelector:@selector(closeNow)]) [tab closeNow];
  else [tab close];
}

void OnMain(void (^block)(void)) {
  if (NSThread.isMainThread) block();
  else dispatch_async(dispatch_get_main_queue(), block);
}

NSView *ParkingView() {
  static NSView *view = [[NSView alloc] initWithFrame:NSZeroRect];
  return view;
}

bool SamePage(NSString *a, NSString *b) {
  auto strip = [](NSString *url) {
    NSRange hash = [url rangeOfString:@"#"];
    return hash.location == NSNotFound ? url : [url substringToIndex:hash.location];
  };
  return a && b && [strip(a) isEqualToString:strip(b)];
}

bool IsRendererDebugURL(NSString *url) {
  NSURLComponents *c = [NSURLComponents componentsWithString:url];
  if (![@[ @"chrome", @"ardia" ] containsObject:c.scheme.lowercaseString ?: @""]) return false;
  static NSSet *hosts = [NSSet setWithArray:@[
    @"badcastcrash", @"crash", @"crashdump", @"kill", @"hang", @"shorthang", @"memory-exhaust", @"memory-pressure-critical",
    @"memory-pressure-moderate", @"gpuclean", @"gpucrash", @"gpuhang", @"inducebrowsercrashforrealz",
    @"inducebrowserdcheckforrealz", @"cfi-crash", @"heap-corruption-crash"
  ]];
  return [hosts containsObject:c.host.lowercaseString ?: @""];
}

NSString *ReportedTitle(NSString *title, NSString *url, BOOL loading) {
  if (!loading || !title.length) return title ?: @"";
  NSURLComponents *c = [NSURLComponents componentsWithString:url];
  NSString *scheme = c.scheme.lowercaseString;
  if ((![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) || ![[url substringWithRange:NSMakeRange(scheme.length, MIN(3, url.length - scheme.length))] isEqualToString:@"://"])
    return title;
  NSString *shown = [url substringFromIndex:scheme.length + 3];
  if ([shown.lowercaseString hasPrefix:@"www."]) shown = [shown substringFromIndex:4];
  if ([c.path isEqualToString:@"/"] && !c.query && !c.fragment && [shown hasSuffix:@"/"]) shown = [shown substringToIndex:shown.length - 1];
  shown = [shown stringByReplacingOccurrencesOfString:@"%20" withString:@" "];
  return [title isEqualToString:shown] ? @"" : title;
}

NSString *PNGDataURL(NSImage *image) {
  CGImageRef cg = [image CGImageForProposedRect:nil context:nil hints:nil];
  if (!cg) return nil;
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:cg];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  return png.length ? [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]] : nil;
}

id JSONValue(NSString *json) {
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  return data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil] : nil;
}

template <typename T>
T *Field(NSDictionary *d, NSString *key) {
  id value = d[key];
  return [value isKindOfClass:[T class]] ? value : nil;
}

NSString *Text(NSDictionary *d, NSString *key, NSUInteger max) {
  NSString *s = Field<NSString>(d, key);
  if (s.length <= max) return s;
  return [s substringToIndex:[s rangeOfComposedCharacterSequenceAtIndex:max].location];
}

bool Flag(NSDictionary *d, NSString *key) {
  return Field<NSNumber>(d, key).boolValue;
}

bool Finite(NSDictionary *d, NSString *key, double *out) {
  NSNumber *n = Field<NSNumber>(d, key);
  if (!n || !std::isfinite(n.doubleValue)) return false;
  *out = n.doubleValue;
  return true;
}

NSString *OriginOf(NSString *url) {
  NSURLComponents *c = [NSURLComponents componentsWithString:url ?: @""];
  if (!c.scheme.length || !c.host.length) return nil;
  return c.port ? [NSString stringWithFormat:@"%@://%@:%@", c.scheme, c.host, c.port] : [NSString stringWithFormat:@"%@://%@", c.scheme, c.host];
}

NSDictionary *NowPlayingState(NSDictionary *d) {
  NSString *state = Field<NSString>(d, @"playbackState");
  if (![@[ @"none", @"paused", @"playing" ] containsObject:state]) state = @"none";
  NSMutableArray *actions = [NSMutableArray array];
  for (id action in Field<NSArray>(d, @"actions"))
    if ([action isKindOfClass:NSString.class] && [action length] <= 64 && actions.count < 32) [actions addObject:action];
  double position = 0, duration = 0, rate = 1, timestamp = 0;
  Finite(d, @"position", &position);
  const bool hasDuration = Finite(d, @"duration", &duration) && duration >= 0;
  Finite(d, @"playbackRate", &rate);
  Finite(d, @"timestamp", &timestamp);
  return @{
    @"frame" : Text(d, @"frame", 64) ?: @"",
    @"title" : Text(d, @"title", 1024) ?: @"",
    @"artist" : Text(d, @"artist", 1024) ?: @"",
    @"album" : Text(d, @"album", 1024) ?: @"",
    @"artwork" : Text(d, @"artwork", 1 << 20) ?: NSNull.null,
    @"playbackState" : state,
    @"position" : @(MAX(position, 0)),
    @"duration" : hasDuration ? @(duration) : NSNull.null,
    @"playbackRate" : @(rate),
    @"timestamp" : @(timestamp),
    @"hasVideo" : @(Flag(d, @"hasVideo")),
    @"actions" : actions,
    @"controllable" : @(Flag(d, @"controllable")),
  };
}

NSDictionary *SelectionState(NSDictionary *d) {
  NSString *text = Text(d, @"text", 4000);
  NSDictionary *rect = Field<NSDictionary>(d, @"rect");
  double x, y, width, height;
  if (!text || !Finite(rect, @"x", &x) || !Finite(rect, @"y", &y) || !Finite(rect, @"width", &width) ||
      !Finite(rect, @"height", &height))
    return nil;
  return @{@"text" : text, @"rect" : @{@"x" : @(x), @"y" : @(y), @"width" : @(width), @"height" : @(height)}};
}

NSMutableDictionary<NSNumber *, NSMutableArray *> *RecentEvents() {
  static NSMutableDictionary *events = [NSMutableDictionary dictionary];
  return events;
}

void NoteEvent(int browserId, NSString *name, NSDictionary *payload) {
#if DEBUG
  NSMutableArray *list = RecentEvents()[@(browserId)];
  if (!list) RecentEvents()[@(browserId)] = list = [NSMutableArray array];
  NSMutableDictionary *brief = [NSMutableDictionary dictionary];
  for (NSString *key in payload) {
    id value = payload[key];
    brief[key] = [value isKindOfClass:NSString.class] && [value length] > 200 ? [value substringToIndex:200] : value;
  }
  [list addObject:@{@"name" : name, @"payload" : brief, @"t" : @(round(CACurrentMediaTime() * 1000))}];
  if (list.count > 80) [list removeObjectAtIndex:0];
#endif
}

NSString *gSearchEngineName = @"Google";
BOOL gDisplayMediaPicker = NO;
BOOL TracingPictureInPicture() {
  static const BOOL tracing = getenv("ARDIA_TRACE_PIP") != nullptr;
  return tracing;
}

NSString *SelectionLabel(NSString *text) {
  NSArray *words = [text componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSString *collapsed = [[words filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]]
      componentsJoinedByString:@" "];
  if (collapsed.length <= 50) return collapsed;
  NSRange space = [collapsed rangeOfString:@" " options:NSBackwardsSearch range:NSMakeRange(0, 50)];
  NSUInteger end = space.location != NSNotFound && space.location > 25 ? space.location : 50;
  end = [collapsed rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, end)].length;
  return [[collapsed substringToIndex:end] stringByAppendingString:@"…"];
}

constexpr int kMenuSeparator = 3;

int MenuItemType(NSDictionary *item) {
  if (NSNumber *type = Field<NSNumber>(item, @"type")) return type.intValue;
  return Flag(item, @"separator") ? kMenuSeparator : 0;
}

NSString *MenuTitle(NSString *label);

NSArray *DescribeMenu(NSArray *items) {
  NSMutableArray *out = [NSMutableArray array];
  for (NSDictionary *item in items) {
    if (![item isKindOfClass:NSDictionary.class]) continue;
    static const int kCefTypes[] = {1, 2, 3, 4, 0, 5, 5};
    const int type = MenuItemType(item);
    NSMutableDictionary *described = [@{
      @"id" : Field<NSNumber>(item, @"id") ?: @0,
      @"label" : MenuTitle(Field<NSString>(item, @"label") ?: @""),
      @"type" : @(type >= 0 && type < 7 ? kCefTypes[type] : 0),
      @"enabled" : @(Flag(item, @"enabled")),
      @"visible" : @(Field<NSNumber>(item, @"visible") ? Flag(item, @"visible") : YES),
    } mutableCopy];
    if (NSArray *submenu = Field<NSArray>(item, @"submenu")) described[@"submenu"] = DescribeMenu(submenu);
    [out addObject:described];
  }
  return out;
}

NSString *MenuTitle(NSString *label) {
  NSMutableString *title = [NSMutableString stringWithCapacity:label.length];
  for (NSUInteger i = 0; i < label.length; i++) {
    const unichar c = [label characterAtIndex:i];
    if (c != '&') {
      [title appendFormat:@"%C", c];
    } else if (i + 1 < label.length && [label characterAtIndex:i + 1] == '&') {
      [title appendString:@"&"];
      i++;
    }
  }
  return title;
}

NSDictionary *FindMenuItem(NSArray *items, NSString *label) {
  for (NSUInteger i = 0; i < items.count; i++) {
    NSDictionary *item = items[i];
    if (![item isKindOfClass:NSDictionary.class]) continue;
    if ([MenuTitle(Field<NSString>(item, @"label") ?: @"") isEqualToString:label]) {
      NSNumber *command = Field<NSNumber>(item, @"id");
      return command ? @{@"command" : command, @"path" : @[ @(i) ]} : nil;
    }
    if (NSDictionary *found = FindMenuItem(Field<NSArray>(item, @"submenu"), label))
      return @{@"command" : found[@"command"], @"path" : [@[ @(i) ] arrayByAddingObjectsFromArray:found[@"path"]]};
  }
  return nil;
}

NSString *JSONString(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value ?: NSNull.null options:NSJSONWritingFragmentsAllowed error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"null";
}

const char kPageReportsKey = 0;

const char kDropTypesKey = 0;

void AcceptDrops(NSView *root, BOOL accept) {
  if (!root) return;
  NSArray<NSPasteboardType> *held = objc_getAssociatedObject(root, &kDropTypesKey);
  if (accept && held) {
    objc_setAssociatedObject(root, &kDropTypesKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [root registerForDraggedTypes:held];
  } else if (!accept && !held && root.registeredDraggedTypes.count) {
    objc_setAssociatedObject(root, &kDropTypesKey, root.registeredDraggedTypes, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [root unregisterDraggedTypes];
  }
  for (NSView *sub in root.subviews) AcceptDrops(sub, accept);
}

}

@interface ArdiaCoreWebView () <ArdiaCoreTabDelegate>
@end

static void AnswerHello(ArdiaCoreTab *tab, NSString *profile, NSDictionary *hello, NSString *frameId, BOOL main) {
  NSString *frameURL = Text(hello, @"url", 8192) ?: tab.url;
  NSString *origin = OriginOf(main ? frameURL : tab.url);
  __weak ArdiaCoreTab *weakTab = tab;
  void (^answer)(BOOL) = ^(BOOL blockAutoplay) {
    ArdiaCoreTab *to = weakTab;
    if (!frameId.length || ![to respondsToSelector:@selector(callFrame:kind:json:)]) return;
    NSMutableDictionary *config = [NSMutableDictionary dictionary];
    if (blockAutoplay) config[@"blockAutoplay"] = @YES;
    if (gDisplayMediaPicker && [ArdiaCoreEngine respondsToSelector:@selector(allowDesktopCapture:tab:frame:origin:)])
      config[@"displayMediaPicker"] = @YES;
    if (main && ACFieldTimingEnabled()) config[@"fieldTiming"] = @YES;
    static const BOOL fixedAudioPoll = [@(getenv("ARDIA_WEB_AUDIO_POLL") ?: "") isEqualToString:@"fixed"];
    if (fixedAudioPoll) config[@"fixedAudioPoll"] = @YES;
    static const BOOL broadThemeObserver = [@(getenv("ARDIA_THEME_OBSERVER") ?: "") isEqualToString:@"broad"];
    if (broadThemeObserver) config[@"broadThemeObserver"] = @YES;
    [to callFrame:frameId kind:@"config" json:JSONString(config)];
  };
  if (origin && [origin hasPrefix:@"http"])
    [ArdiaCoreServices siteSettings:profile ?: @"" origin:origin completion:^(NSDictionary *settings) {
      NSDictionary *autoplay = [settings[@"autoplay"] isKindOfClass:NSDictionary.class] ? settings[@"autoplay"] : nil;
      answer([autoplay[@"value"] isEqual:@"block"]);
    }];
  else
    answer(NO);
}

@interface ArdiaCoreLaunchTabHolder : NSObject <ArdiaCoreTabDelegate>
@property (nonatomic, copy) NSString *url;
@property (nonatomic, copy) NSString *profile;
@property (nonatomic, readonly) BOOL closedByChrome;
- (void)replayTo:(ArdiaCoreWebView *)view tab:(ArdiaCoreTab *)tab;
- (BOOL)holdRoutedTab:(ArdiaCoreTab *)tab placement:(NSDictionary *)placement;
- (NSArray *)takeHeldRoutedTab;
- (void)dropRoutedTabs;
@end

constexpr NSUInteger kMaxHeldRoutedTabs = 8;
constexpr int64_t kHeldRoutedTabSeconds = 30;

@implementation ArdiaCoreLaunchTabHolder {
  NSMutableArray<NSInvocation *> *_calls;
  NSMutableArray<NSArray *> *_routed;
}

- (void)dealloc {
  [self dropRoutedTabs];
}

- (BOOL)holdRoutedTab:(ArdiaCoreTab *)tab placement:(NSDictionary *)placement {
  if (_closedByChrome || _routed.count >= kMaxHeldRoutedTabs) return NO;
  if (!_routed) _routed = [NSMutableArray array];
  NSArray *entry = @[ tab, [placement copy] ];
  [_routed addObject:entry];
  __weak ArdiaCoreLaunchTabHolder *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kHeldRoutedTabSeconds * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    [weakSelf expireHeldRoutedTab:entry];
  });
  return YES;
}

- (void)expireHeldRoutedTab:(NSArray *)entry {
  if (!_routed || [_routed indexOfObjectIdenticalTo:entry] == NSNotFound) return;
  [_routed removeObjectIdenticalTo:entry];
  CloseTab(entry[0]);
}

- (NSArray *)takeHeldRoutedTab {
  NSArray *entry = _routed.firstObject;
  if (entry) [_routed removeObjectAtIndex:0];
  return entry;
}

- (void)dropRoutedTabs {
  NSArray<NSArray *> *routed = _routed;
  _routed = nil;
  for (NSArray *held in routed) CloseTab(held[0]);
}

static BOOL HeldSelector(SEL selector) {
  struct objc_method_description d = protocol_getMethodDescription(@protocol(ArdiaCoreTabDelegate), selector, NO, YES);
  if (!d.name || ![ArdiaCoreWebView instancesRespondToSelector:selector]) return NO;
  NSMethodSignature *signature = [ArdiaCoreWebView instanceMethodSignatureForSelector:selector];
  return signature && strcmp(signature.methodReturnType, @encode(void)) == 0;
}

- (BOOL)respondsToSelector:(SEL)selector {
  return [super respondsToSelector:selector] || HeldSelector(selector);
}

- (NSMethodSignature *)methodSignatureForSelector:(SEL)selector {
  return HeldSelector(selector) ? [ArdiaCoreWebView instanceMethodSignatureForSelector:selector] : [super methodSignatureForSelector:selector];
}

- (void)forwardInvocation:(NSInvocation *)invocation {
  if (!HeldSelector(invocation.selector) || invocation.methodSignature.numberOfArguments < 3) return [super forwardInvocation:invocation];
  if (invocation.selector == @selector(tab:didReceivePageMessage:json:frame:main:)) {
    __unsafe_unretained ArdiaCoreTab *tab = nil;
    __unsafe_unretained NSString *kind = nil;
    __unsafe_unretained NSString *json = nil;
    __unsafe_unretained NSString *frame = nil;
    BOOL main = NO;
    [invocation getArgument:&tab atIndex:2];
    [invocation getArgument:&kind atIndex:3];
    [invocation getArgument:&json atIndex:4];
    [invocation getArgument:&frame atIndex:5];
    [invocation getArgument:&main atIndex:6];
    if ([kind isEqualToString:@"hello"]) {
      id hello = JSONValue(json);
      AnswerHello(tab, _profile, [hello isKindOfClass:NSDictionary.class] ? hello : nil, frame ?: @"", main);
    }
  }
  if (invocation.selector == @selector(tab:navigationBecameDownload:)) {
    __unsafe_unretained NSString *url = nil;
    [invocation getArgument:&url atIndex:3];
    if (url.length) ardiacore_host::NoteNavigationDownload(url, _profile ?: @"");
    if (_url.length && ![_url isEqualToString:url ?: @""]) ardiacore_host::NoteNavigationDownload(_url, _profile ?: @"");
  }
  if (invocation.selector == @selector(tabDidChangeURL:) || invocation.selector == @selector(tabDidCommitDocument:) ||
      invocation.selector == @selector(tabDidChangeSecurity:)) {
    __unsafe_unretained ArdiaCoreTab *tab = nil;
    [invocation getArgument:&tab atIndex:2];
    [ArdiaCoreEarlyWindow pageNavigated:tab launchURL:_url];
  }
  if (!_calls) _calls = [NSMutableArray array];
  if (_calls.count >= 2000) return;
  __unsafe_unretained id none = nil;
  [invocation setArgument:&none atIndex:2];
  invocation.target = nil;
  [invocation retainArguments];
  [_calls addObject:invocation];
}

- (void)tabWillClose:(ArdiaCoreTab *)tab {
  _closedByChrome = YES;
  [ArdiaCoreEarlyWindow dropPage:tab];
  [self dropRoutedTabs];
}

- (void)replayTo:(ArdiaCoreWebView *)view tab:(ArdiaCoreTab *)tab {
  NSArray<NSInvocation *> *calls = _calls;
  _calls = nil;
  __unsafe_unretained ArdiaCoreTab *named = tab;
  for (NSInvocation *call in calls) {
    [call setArgument:&named atIndex:2];
    [call invokeWithTarget:view];
  }
}

@end

namespace {

void DropHeldRoutedTabs(ArdiaCoreTab *source) {
  ArdiaCoreLaunchTabHolder *held = source ? objc_getAssociatedObject(source, &kLaunchHolderKey) : nil;
  [held dropRoutedTabs];
}

}

@implementation ArdiaCoreWebView {
  ArdiaCoreTab *_tab;
  BOOL _loadedOnce;
  BOOL _pendingUserInitiated;
  NSString *_requestedURL;
  BOOL _creating;
  BOOL _closing;
  BOOL _launchCloseSent;
  BOOL _offerClosed;
  BOOL _moving;
  NSString *_pendingURL;
  NSString *_creatingURL;
  CFTimeInterval _creatingAt;
  NSString *_transferredURL;
  BOOL _muted;
  NSInteger _tabIndex;
  BOOL _pinned;
  NSView *_devtoolsView;
  BOOL _navigationQueued;
  NSString *_pageTheme;
  NSString *_pageThemeSource;
  NSUInteger _createGeneration;
  NSUInteger _blockedGeneration;
  NSInteger _blockedCount;
  NSString *_lastBlocked;
  BOOL _blockedEmitQueued;
  NSDictionary *_sentNavigation;
  NSString *_lastFavicon;
  CFTimeInterval _sentProgressAt;
  double _sentProgress;
  BOOL _progressQueued;
  CFTimeInterval _linkDropAt;
  NSMutableDictionary<NSString *, NSNumber *> *_mediaFrames;
  NSMutableDictionary<NSString *, NSDictionary *> *_nowPlaying;
  NSString *_nowPlayingFrame;
  NSMutableDictionary<NSString *, NSString *> *_notificationFrames;
  NSMutableDictionary<NSString *, NSDictionary *> *_displayRequests;
  double _pinchScale;
  BOOL _autoPictureInPictureActive;
  BOOL _inPictureInPicture;
  BOOL _seenByUser;
  id _sightObserver;
  BOOL _capturing;
  BOOL _crashed;
  BOOL _leaving;
  NSUInteger _leaveGeneration;
  BOOL _handingOff;
  BOOL _revealed;
  NSUInteger _revealGeneration;
  __weak NSView *_loweredPane;
  CGFloat _loweredPaneZ;
  __weak NSView *_frontedPage;
  NSUInteger _frontGeneration;
  ACPageFocus _pageFocus;
  __weak NSView *_focusedDevTools;
  BOOL _focusOnActivate;
  BOOL _keepsOutgoingFocus;
  CFTimeInterval _focusActivatedAt;
  __weak NSWindow *_focusActivatedIn;
  BOOL _ownershipPending;
  BOOL _ownershipDeferred;
}

+ (void)prepareTransfer:(NSString *)transferKey {
  if (!transferKey.length) return;
  NSString *key = [transferKey copy];
  dispatch_async(dispatch_get_main_queue(), ^{
    for (ArdiaCoreWebView *view in LiveViews().allObjects)
      if (view->_tab && [view->_transferKey isEqualToString:key]) view->_handingOff = YES;
  });
}

+ (void)releaseTransfer:(NSString *)transferKey {
  if (!transferKey.length) return;
  NSString *key = [transferKey copy];
  dispatch_async(dispatch_get_main_queue(), ^{
    for (ArdiaCoreWebView *view in LiveViews().allObjects)
      if ([view->_transferKey isEqualToString:key]) view->_handingOff = NO;
    [ClosedLaunch() removeObject:key];
    ArdiaCoreTab *tab = Parked()[key];
    if (!tab) return;
    [Parked() removeObjectForKey:key];
    CloseTab(tab);
  });
}

static ArdiaCoreTab *StartParkedPage(NSString *url, NSString *profileName, NSString *sidebar) {
  if (!url.length || !ArdiaCoreHost.isStarted) return nil;
  NSString *scheme = [NSURLComponents componentsWithString:url].scheme.lowercaseString;
  if (![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) return nil;
  profileName = profileName ?: @"";
  if (ardiacore_host::IsIncognito(profileName) || ardiacore_host::IsDeletedProfile(profileName)) return nil;
  ArdiaCoreProfile *profile = ardiacore_host::LoadedProfile(profileName);
  if (!profile || ardiacore_host::WasNavigationDownload(url, profileName)) return nil;
  ArdiaCoreWindowController *keeper = [ArdiaCoreWindowController strayWindowForProfile:profile];
  if (!keeper) return nil;
  keeper.hostChanges++;
  ArdiaCoreTab *tab = [keeper.coreWindow openTab:url profile:profile foreground:NO sidebar:sidebar ?: @""];
  keeper.hostChanges--;
  if (!tab) {
    [keeper.coreWindow close];
    return nil;
  }
  [ParkingView() addSubview:tab.view];
  ArdiaCoreLaunchTabHolder *holder = [ArdiaCoreLaunchTabHolder new];
  holder.url = url;
  holder.profile = profileName;
  objc_setAssociatedObject(tab, &kLaunchHolderKey, holder, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  tab.delegate = holder;
  return tab;
}

static NSMutableDictionary<NSNumber *, ArdiaCoreTab *> *LinkTabs() {
  static NSMutableDictionary *tabs = [NSMutableDictionary dictionary];
  return tabs;
}
static NSMutableDictionary<NSNumber *, NSDictionary *> *LinkStarts() {
  static NSMutableDictionary *starts = [NSMutableDictionary dictionary];
  return starts;
}
static NSMutableArray<NSString *> *DismissedLinks() {
  static NSMutableArray *urls = [NSMutableArray array];
  return urls;
}
static NSMutableSet<NSString *> *DismissedLinkMarks() {
  static NSMutableSet *marks = [NSMutableSet set];
  return marks;
}
static BOOL gLinkTabsStarted;
constexpr NSUInteger kMaxLinkTabs = 4;
constexpr int64_t kLinkTabsBackstopSeconds = 300;

static void CloseLinkTabs() {
  NSArray<ArdiaCoreTab *> *left = LinkTabs().allValues;
  [LinkTabs() removeAllObjects];
  for (ArdiaCoreTab *tab in left) {
    [ArdiaCoreEarlyWindow dropPage:tab];
    CloseTab(tab);
  }
}

static void ExpireLaunchTab(ArdiaCoreTab *tab) {
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (gLaunchTab != tab) return;
    if ([ArdiaCoreEarlyWindow holdsPage:tab]) return ExpireLaunchTab(tab);
    [ArdiaCoreWebView claimLaunchTab:@"" url:@"" profile:@""];
  });
}

+ (void)startLaunchTab:(NSString *)transferKey url:(NSString *)url profile:(NSString *)profileName sidebar:(NSString *)sidebar {
  if (gLaunchTab || gLaunchClaimed || !transferKey.length) return;
  ArdiaCoreTab *tab = StartParkedPage(url, profileName, sidebar);
  if (!tab) return;
  profileName = profileName ?: @"";
  gLaunchTab = tab;
  gLaunchKey = [transferKey copy];
  gLaunchURL = [url copy];
  gLaunchProfile = [profileName copy];
  ExpireLaunchTab(tab);
}

+ (ArdiaCoreTab *)launchTab {
  return gLaunchTab;
}

+ (void)claimLaunchTab:(NSString *)transferKey url:(NSString *)url profile:(NSString *)profile {
  NSString *key = [transferKey copy], *claimed = [url copy], *name = [profile copy];
  void (^claim)(void) = ^{
    ArdiaCoreTab *tab = gLaunchTab;
    gLaunchClaimed = YES;
    const BOOL same = tab && key.length && [gLaunchKey isEqualToString:key] && [gLaunchURL isEqualToString:claimed] &&
                      [gLaunchProfile isEqualToString:name ?: @""] && !Parked()[key];
    gLaunchTab = nil;
    gLaunchKey = gLaunchURL = gLaunchProfile = nil;
    if (!same) [ArdiaCoreEarlyWindow dropPage:tab];
    if (!same) return CloseTab(tab);
    Parked()[key] = tab;
  };
  if (NSThread.isMainThread) claim();
  else dispatch_async(dispatch_get_main_queue(), claim);
}

static NSDictionary *ExternalLinkDecision(NSString *url) {
  if (![ArdiaCoreEngine respondsToSelector:@selector(routeLink:origin:profile:)]) return nil;
  NSDictionary *decision = [ArdiaCoreEngine routeLink:url origin:@"external" profile:@""];
  NSString *action = decision[@"action"];
  const BOOL opens = [action isEqualToString:@"tab"] || [action isEqualToString:@"little"];
  return opens && [decision[@"profileId"] isKindOfClass:NSString.class] && [decision[@"engine"] isKindOfClass:NSString.class] ? decision : nil;
}

+ (void)setLinkRouting:(NSDictionary<NSString *, id> *)config {
  if ([ArdiaCoreEngine respondsToSelector:@selector(setLinkRouting:live:)]) [ArdiaCoreEngine setLinkRouting:config live:YES];
}

+ (NSDictionary<NSString *, id> *)routeTypedLink:(NSString *)url profile:(NSString *)profileId {
  if (![ArdiaCoreEngine respondsToSelector:@selector(routeLink:origin:profile:)]) return nil;
  return [ArdiaCoreEngine routeLink:url origin:@"typed" profile:profileId ?: @""];
}

+ (void)startLinkTabs:(NSArray<NSString *> *)urls {
  if (gLinkTabsStarted) return;
  gLinkTabsStarted = YES;
  NSUInteger index = 0;
  for (NSString *url in urls) {
    if (index >= kMaxLinkTabs) break;
    NSDictionary *decision = ExternalLinkDecision(url);
    if (ArdiaCoreTab *tab = decision ? StartParkedPage(url, decision[@"engine"], decision[@"profileId"]) : nil) {
      LinkTabs()[@(index)] = tab;
      LinkStarts()[@(index)] = @{@"url" : [url copy], @"decision" : decision};
    }
    index++;
  }
  if (!LinkTabs().count) return;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kLinkTabsBackstopSeconds * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    CloseLinkTabs();
  });
}

+ (ArdiaCoreTab *)firstLinkTab {
  return LinkTabs()[@0];
}

+ (NSString *)linkMarkForTab:(ArdiaCoreTab *)tab {
  for (NSNumber *index in LinkTabs())
    if (LinkTabs()[index] == tab && LinkStarts()[index]) return [NSString stringWithFormat:@"link:%@", index];
  return nil;
}

+ (void)dismissLinkTab:(ArdiaCoreTab *)tab {
  for (NSNumber *index in LinkTabs().allKeys) {
    if (LinkTabs()[index] != tab) continue;
    [LinkTabs() removeObjectForKey:index];
    if (NSString *url = LinkStarts()[index][@"url"]) [DismissedLinks() addObject:url];
    [DismissedLinkMarks() addObject:[NSString stringWithFormat:@"link:%@", index]];
    [LinkStarts() removeObjectForKey:index];
    [ArdiaCoreEarlyWindow dropPage:tab];
    CloseTab(tab);
    return;
  }
}

+ (BOOL)holdRoutedTab:(ArdiaCoreTab *)tab placement:(NSDictionary *)placement source:(ArdiaCoreTab *)source {
  ArdiaCoreLaunchTabHolder *held = source && !source.closed ? objc_getAssociatedObject(source, &kLaunchHolderKey) : nil;
  return [held holdRoutedTab:tab placement:placement];
}

+ (NSDictionary *)linkDecisionForTab:(ArdiaCoreTab *)tab {
  for (NSNumber *index in LinkTabs())
    if (LinkTabs()[index] == tab) return LinkStarts()[index][@"decision"];
  return nil;
}

+ (NSArray *)routeExternalLinks:(NSArray<NSString *> *)urls {
  NSMutableArray *links = [NSMutableArray array];
  NSMutableSet<NSNumber *> *used = [NSMutableSet set];
  for (NSString *url in urls) {
    if (const NSUInteger at = [DismissedLinks() indexOfObject:url]; at != NSNotFound) {
      [DismissedLinks() removeObjectAtIndex:at];
      [links addObject:@{@"dismissed" : @YES}];
      continue;
    }
    NSDictionary *started = nil;
    for (NSNumber *index in [LinkStarts().allKeys sortedArrayUsingSelector:@selector(compare:)]) {
      if ([used containsObject:index] || ![LinkStarts()[index][@"url"] isEqualToString:url]) continue;
      [used addObject:index];
      NSMutableDictionary *link = [LinkStarts()[index][@"decision"] mutableCopy];
      link[@"adoptId"] = [NSString stringWithFormat:@"link:%@", index];
      link[@"requiresAdoption"] = @YES;
      started = link;
      break;
    }
    [links addObject:started ?: ExternalLinkDecision(url) ?: NSNull.null];
  }
  for (NSNumber *index in used) [LinkStarts() removeObjectForKey:index];
  return links;
}

- (BOOL)takeLinkTab:(NSString *)adoptId {
  NSNumber *index = @([[adoptId substringFromIndex:5] integerValue]);
  ArdiaCoreTab *tab = LinkTabs()[index];
  if (!tab || !_transferKey.length || Parked()[_transferKey]) return NO;
  [LinkTabs() removeObjectForKey:index];
  Parked()[_transferKey] = tab;
  if ([self takeTransferredTab]) return YES;
  if (Parked()[_transferKey] == tab) [Parked() removeObjectForKey:_transferKey];
  [ArdiaCoreEarlyWindow dropPage:tab];
  CloseTab(tab);
  return NO;
}

+ (void)initialize {
  if (self != ArdiaCoreWebView.class) return;
  [NSNotificationCenter.defaultCenter addObserverForName:@"ArdiaPagerActivity"
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *note) {
                                                if (![note.object isKindOfClass:NSWindow.class]) return;
                                                if ([note.userInfo[@"release"] boolValue]) return [ArdiaCoreWebView releaseNeighbourPagesIn:note.object];
                                                const double seconds = [note.userInfo[@"seconds"] doubleValue];
                                                [ArdiaCoreWebView wakeNeighbourPagesIn:note.object
                                                                               seconds:seconds > 0 ? seconds : kNeighbourPagesAwakeSeconds
                                                                             committed:![note.userInfo[@"speculative"] boolValue]];
                                              }];
  static NSUInteger reloads = 0;
  [NSNotificationCenter.defaultCenter addObserverForName:@"RCTBridgeWillReloadNotification"
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                void (^park)(void) = ^{
                                                  NSNumber *reload = @(++reloads);
                                                  NSMapTable<NSString *, ArdiaCoreWebView *> *views = [NSMapTable strongToWeakObjectsMapTable];
                                                  NSMutableDictionary<NSString *, ArdiaCoreTab *> *handed = [NSMutableDictionary dictionary];
                                                  for (ArdiaCoreWebView *view in LiveViews().allObjects) {
                                                    if (!view->_tab || view->_tab.closed || !view->_transferKey.length) continue;
                                                    view->_handingOff = YES;
                                                    [views setObject:view forKey:view->_transferKey];
                                                    handed[view->_transferKey] = view->_tab;
                                                    ReloadParked()[view->_transferKey] = reload;
                                                  }
                                                  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
                                                    [handed enumerateKeysAndObjectsUsingBlock:^(NSString *key, ArdiaCoreTab *tab, BOOL *) {
                                                      if (![ReloadParked()[key] isEqual:reload]) return;
                                                      [ReloadParked() removeObjectForKey:key];
                                                      if (ArdiaCoreWebView *view = [views objectForKey:key]; view && view->_tab == tab) view->_handingOff = NO;
                                                      if (Parked()[key] != tab) return;
                                                      [Parked() removeObjectForKey:key];
                                                      if ([tab respondsToSelector:@selector(closeNow)]) [tab closeNow];
                                                      else [tab close];
                                                    }];
                                                  });
                                                };
                                                if (NSThread.isMainThread) park();
                                                else dispatch_async(dispatch_get_main_queue(), park);
                                              }];
}

- (instancetype)initWithFrame:(NSRect)frameRect {
  if ((self = [super initWithFrame:frameRect])) {
    _profile = @"";
    _visible = YES;
    _seenByUser = YES;
    _tabIndex = -1;
    self.wantsLayer = YES;
  }
  return self;
}

- (void)dealloc {
  if (_sightObserver) [NSNotificationCenter.defaultCenter removeObserver:_sightObserver];
  [self closeBrowser];
}

- (BOOL)isFlipped {
  return YES;
}

- (int)browserId {
  return _tab ? ardiacore_host::BrowserId(_tab) : 0;
}

- (ArdiaCoreWindowController *)controller {
  return [ArdiaCoreWindowController forNSWindow:self.window];
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ window=%ld tab=%d", _transferKey, (long)self.window.windowNumber, _tab ? (int)_tab.tabId : -1);
  if (_sightObserver) [NSNotificationCenter.defaultCenter removeObserver:_sightObserver];
  _sightObserver = nil;
  if (!self.window) return;
  if (_visible) [ArdiaCoreEarlyWindow noteLayoutChangeIn:self.window];
  __weak ArdiaCoreWebView *weakSelf = self;
  _sightObserver = [NSNotificationCenter.defaultCenter addObserverForName:ArdiaCoreWindowSeenDidChange object:self.window queue:nil
                                                               usingBlock:^(NSNotification *) { [weakSelf userSightChanged]; }];
  [self userSightChanged];
  if (_ownershipPending) {
    _ownershipDeferred = YES;
    return;
  }
  if (_tab) [self adoptIntoWindow];
  else [self ensureTab];
}

- (void)beginOwnershipChange {
  _ownershipPending = YES;
}

- (void)commitOwnership:(NSDictionary<NSString *, id> *)changes {
  id (^value)(NSString *) = ^id(NSString *key) {
    id given = changes[key];
    return given == NSNull.null ? nil : given;
  };
  if (changes[@"url"]) _initialURL = [value(@"url") copy];
  if (changes[@"profile"]) _profile = [value(@"profile") copy] ?: @"";
  if (changes[@"sidebarProfile"]) _sidebarProfile = [value(@"sidebarProfile") copy] ?: @"";
  if (changes[@"adoptId"]) _adoptId = [value(@"adoptId") copy];
  if (changes[@"requiresAdoption"]) _requiresAdoption = [value(@"requiresAdoption") boolValue];
  if (changes[@"transferKey"]) _transferKey = [value(@"transferKey") copy];
  if (changes[@"standalone"]) _standalone = [value(@"standalone") boolValue];
  if (changes[@"extensionHost"]) {
    _extensionHost = [value(@"extensionHost") copy];
    if (_extensionHost.length) _standalone = YES;
  }
  const BOOL restarted = _creating && changes.count > 0;
  if (restarted) {
    _creating = NO;
    _createGeneration++;
  }
  if (_tab && changes[@"sidebarProfile"] && [_tab respondsToSelector:@selector(setSidebarProfile:)]) _tab.sidebarProfile = _sidebarProfile ?: @"";
  const BOOL resume = _ownershipDeferred || restarted || changes[@"adoptId"] || changes[@"requiresAdoption"];
  _ownershipPending = _ownershipDeferred = NO;
  if (!resume || !self.window) return;
  if (_tab) [self adoptIntoWindow];
  else [self ensureTab];
}

- (void)setExtensionHost:(NSString *)extensionHost {
  _extensionHost = [extensionHost copy];
  if (_extensionHost.length) _standalone = YES;
}

- (void)setAdoptId:(NSString *)adoptId {
  _adoptId = [adoptId copy];
  if (self.window) [self ensureTab];
}

- (void)failRequiredAdoption {
  _adoptId = nil;
  _offerClosed = YES;
  __weak ArdiaCoreWebView *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    [weakSelf emit:@"windowClose" payload:@{}];
  });
}

- (BOOL)takesRoutedTab:(ArdiaCoreTab *)tab {
  if (![self canTake:tab]) return NO;
  if (!_requiresAdoption) return YES;
  NSString *seeded = [tab respondsToSelector:@selector(sidebarProfile)] ? tab.sidebarProfile : nil;
  return seeded.length && [seeded isEqualToString:_sidebarProfile ?: @""];
}

- (void)ensureTab {
  if (_ownershipPending) {
    _ownershipDeferred = YES;
    return;
  }
  if (_tab || _creating || _offerClosed || !self.window || !ArdiaCoreHost.isStarted || !self.controller) return;
  if ([self takeTransferredTab]) return;
  if ([_adoptId hasPrefix:@"link:"]) {
    NSString *link = _adoptId;
    _adoptId = nil;
    if ([DismissedLinkMarks() containsObject:link]) {
      [DismissedLinkMarks() removeObject:link];
      _offerClosed = YES;
      __weak ArdiaCoreWebView *weakSelf = self;
      dispatch_async(dispatch_get_main_queue(), ^{
        [weakSelf emit:@"windowClose" payload:@{}];
      });
      return;
    }
    if (!_standalone && !_extensionHost.length && [self takeLinkTab:link]) return;
  }
  if ([_adoptId hasPrefix:@"ardiacore:"] || [_adoptId hasPrefix:@"tab:"]) {
    ArdiaCoreTab *offered = [ArdiaCoreTabs takeOffered:_adoptId];
    _adoptId = nil;
    if (offered.closed) {
      _offerClosed = YES;
      __weak ArdiaCoreWebView *weakSelf = self;
      dispatch_async(dispatch_get_main_queue(), ^{
        [weakSelf emit:@"windowClose" payload:@{}];
      });
      return;
    }
    if (offered && ![self takesRoutedTab:offered]) {
      if (!offered.closed) [offered closeNow];
      offered = nil;
    }
    if (offered && !offered.closed) return [self attach:offered];
  }
  if (_requiresAdoption) return [self failRequiredAdoption];
  NSString *kind = nil, *key = nil;
  NSRange colon = _adoptId ? [_adoptId rangeOfString:@":"] : NSMakeRange(NSNotFound, 0);
  if (colon.location != NSNotFound) {
    kind = [_adoptId substringToIndex:colon.location];
    key = [_adoptId substringFromIndex:NSMaxRange(colon)];
  }
  _adoptId = nil;
  _creating = YES;
  const NSUInteger generation = ++_createGeneration;
  __weak ArdiaCoreWebView *weakSelf = self;
  ardiacore_host::WithProfile(_profile, ^(ArdiaCoreProfile *profile) {
    ArdiaCoreWebView *view = weakSelf;
    if (!view || view->_createGeneration != generation) return;
    view->_creating = NO;
    ArdiaCoreWindowController *controller = view.controller;
    if (view->_requiresAdoption) return [view failRequiredAdoption];
    if (!profile || view->_tab || !controller) return;
    const BOOL standalone = view->_standalone;
    NSString *url = view->_pendingURL ?: view->_initialURL;
    view->_pendingURL = nil;
    view->_creatingURL = url;
    view->_creatingAt = CACurrentMediaTime();
    if (view->_extensionHost.length && url.length &&
        [controller.coreWindow respondsToSelector:@selector(openExtensionView:profile:kind:)]) {
      if (ArdiaCoreTab *tab = [controller.coreWindow openExtensionView:url profile:profile kind:view->_extensionHost])
        return [view attach:tab];
    }
    if (standalone) controller = [ArdiaCoreWindowController standaloneWindowForProfile:profile] ?: controller;
    if (!standalone && [kind isEqualToString:@"clone"] && [view cloneTab:key profile:profile]) return;
    if (!standalone && [kind isEqualToString:@"restore"] && url.length && !ardiacore_host::IsIncognito(view->_profile) &&
        [controller.coreWindow respondsToSelector:@selector(restoreTab:profile:foreground:sidebar:)]) {
      view->_creating = YES;
      [ArdiaCoreServices call:@"ac_tab_restore_take" profile:view->_profile args:@{@"key" : key}
                completion:^(NSDictionary *result) {
                  ArdiaCoreWebView *later = weakSelf;
                  if (!later || later->_createGeneration != generation) return;
                  later->_creating = NO;
                  ArdiaCoreWindowController *now = later.controller;
                  if (later->_tab || !now) return;
                  NSString *state = [result[@"state"] isKindOfClass:NSString.class] ? result[@"state"] : nil;
                  ArdiaCoreTab *tab = nil;
                  now.hostChanges++;
                  NSString *sidebar = later->_sidebarProfile ?: @"";
                  if (state.length) tab = [now.coreWindow restoreTab:state profile:profile foreground:NO sidebar:sidebar];
                  if (!tab) tab = [now.coreWindow openTab:url profile:profile foreground:NO sidebar:sidebar];
                  now.hostChanges--;
                  if (tab) [later attach:tab];
                }];
      return;
    }
    if (url.length && [view skipsNavigationDownload:url userInitiated:view->_pendingUserInitiated]) url = nil;
    if (url.length) ACFieldMarkNow(view->_transferKey, @"request");
    controller.hostChanges++;
    ArdiaCoreTab *tab = [controller.coreWindow openTab:url.length ? url : @"" profile:profile foreground:NO
                                               sidebar:view->_sidebarProfile ?: @""];
    controller.hostChanges--;
    if (url.length && tab.loading) ACFieldMarkNow(view->_transferKey, @"start");
    if (tab) [view attach:tab];
    if (tab && url.length) [view focusAfterLoad];
  });
}

- (BOOL)cloneTab:(NSString *)sourceKey profile:(ArdiaCoreProfile *)profile {
  ArdiaCoreWindowController *controller = self.controller;
  if (![controller.coreWindow respondsToSelector:@selector(duplicateTab:profile:foreground:)]) return NO;
  ArdiaCoreTab *source = nil;
  for (ArdiaCoreWebView *other in LiveViews())
    if (other != self && [other.transferKey isEqualToString:sourceKey] && other->_tab && !other->_tab.closed) source = other->_tab;
  if (!source || source.profile != profile) return NO;
  ArdiaCoreWindowController *holder = [ArdiaCoreWindowController holding:source];
  _pendingURL = nil;
  controller.hostChanges++;
  holder.hostChanges++;
  ArdiaCoreTab *tab = [controller.coreWindow duplicateTab:source profile:profile foreground:NO];
  holder.hostChanges--;
  controller.hostChanges--;
  if (!tab) return NO;
  [self attach:tab];
  return YES;
}

+ (void)keepTransfersOfWindow:(NSWindow *)window {
  ArdiaCoreWindowController *closing = [ArdiaCoreWindowController forNSWindow:window];
  if (!closing || ![closing.coreWindow respondsToSelector:@selector(adoptTab:)]) return;
  for (ArdiaCoreWebView *view in LiveViews().allObjects)
    if (view->_handingOff && view->_tab && !view->_tab.closed && [ArdiaCoreWindowController holding:view->_tab] == closing)
      [view closeBrowser];
  for (ArdiaCoreTab *tab in Parked().allValues) {
    if (tab.closed || [ArdiaCoreWindowController holding:tab] != closing || !tab.profile) continue;
    ArdiaCoreWindowController *keeper = [ArdiaCoreWindowController strayWindowForProfile:tab.profile];
    keeper.hostChanges++;
    closing.hostChanges++;
    [keeper.coreWindow adoptTab:tab];
    closing.hostChanges--;
    keeper.hostChanges--;
  }
}

- (BOOL)canTake:(ArdiaCoreTab *)tab {
  ArdiaCoreProfile *profile = tab.profile;
  if (!profile || tab.closed || profile.offTheRecord != ardiacore_host::IsIncognito(_profile)) return NO;
  if (profile.offTheRecord) return ardiacore_host::IsOffTheRecordOf(profile, _profile);
  return [ardiacore_host::ProfileName(profile) isEqualToString:_profile ?: @""];
}

- (BOOL)takeTransferredTab {
  if (!_transferKey.length) return NO;
  ArdiaCoreTab *tab = Parked()[_transferKey];
  ArdiaCoreLaunchTabHolder *held = tab ? objc_getAssociatedObject(tab, &kLaunchHolderKey) : nil;
  if (held && (tab.closed || held.closedByChrome)) {
    [Parked() removeObjectForKey:_transferKey];
    [ClosedLaunch() addObject:_transferKey];
  }
  if ([ClosedLaunch() containsObject:_transferKey]) {
    if (!_launchCloseSent) {
      _launchCloseSent = YES;
      __weak ArdiaCoreWebView *weakSelf = self;
      dispatch_async(dispatch_get_main_queue(), ^{
        ArdiaCoreWebView *view = weakSelf;
        if (view && !view->_tab) [view emit:@"windowClose" payload:@{}];
      });
    }
    return YES;
  }
  if (tab && ![self takesRoutedTab:tab]) return NO;
  if (tab) [Parked() removeObjectForKey:_transferKey];
  if (!tab) {
    for (ArdiaCoreWebView *other in LiveViews().allObjects) {
      if (other == self || ![other.transferKey isEqualToString:_transferKey] || !other->_tab) continue;
      if (![self takesRoutedTab:other->_tab]) return NO;
      tab = other->_tab;
      [other detach];
      break;
    }
  }
  if (!tab || tab.closed) return NO;
  [ReloadParked() removeObjectForKey:_transferKey];
  _adoptId = nil;
  ArdiaCoreLaunchTabHolder *launch = objc_getAssociatedObject(tab, &kLaunchHolderKey);
  objc_setAssociatedObject(tab, &kLaunchHolderKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  _transferredURL = launch.url ?: tab.url;
  if (SamePage(_pendingURL, _transferredURL)) _pendingURL = nil;
  [self attach:tab];
  if (launch) {
    _loadedOnce = YES;
    _requestedURL = launch.url;
    [launch replayTo:self tab:tab];
    [self focusAfterLoad];
    while (NSArray *held = [launch takeHeldRoutedTab]) {
      ArdiaCoreTab *destination = held[0];
      if (_tab != tab || tab.closed) {
        CloseTab(destination);
        [launch dropRoutedTabs];
        break;
      }
      if (!destination.closed) ardiacore_host::AnnounceRoutedTab(destination, self, held[1]);
    }
  }
  return YES;
}

- (void)adoptIntoWindow {
  if (_ownershipPending) {
    _ownershipDeferred = YES;
    return;
  }
  if (_standalone) return;
  ArdiaCoreWindowController *controller = self.controller;
  if (!controller || ![controller.coreWindow respondsToSelector:@selector(adoptTab:)]) return;
  if ([[controller.coreWindow tabsForProfile:_tab.profile] containsObject:_tab]) return;
  ArdiaCoreWindowController *source = [ArdiaCoreWindowController holding:_tab];
  _moving = YES;
  controller.hostChanges++;
  source.hostChanges++;
  [controller.coreWindow adoptTab:_tab];
  source.hostChanges--;
  controller.hostChanges--;
  _moving = NO;
  if (_tabIndex >= 0) [self placeTab];
}

- (void)attach:(ArdiaCoreTab *)tab {
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ attach tab=%d visible=%d", _transferKey, (int)tab.tabId, _visible);
  [LiveViews() addObject:self];
  _tab = tab;
  _requiresAdoption = NO;
  if ([tab respondsToSelector:@selector(setSidebarProfile:)]) tab.sidebarProfile = _sidebarProfile ?: @"";
  tab.delegate = self;
  [ArdiaCoreTabs setView:self forTab:tab];
  [self bindRestoreKey];
  [self takePageReports];
  [self userSightChanged];
  [self adoptIntoWindow];
  NSView *page = tab.view;
  if (page.superview != self) {
    if (!page.window || page.window != self.window) [page removeFromSuperview];
    [self addSubview:page];
    [ArdiaCoreEarlyWindow pageMoved:tab];
  }
  if (NSView *devtools = tab.devToolsView) [self devToolsChanged:devtools];
  [self layoutPage];
  [self applyPainting];
  if (_muted && [tab respondsToSelector:@selector(setMuted:)]) tab.muted = YES;
  if (_pageBackgroundColor && [tab respondsToSelector:@selector(setPageBackgroundColor:)]) tab.pageBackgroundColor = _pageBackgroundColor;
  if (_pageColor && [tab respondsToSelector:@selector(setPageColor:)]) tab.pageColor = _pageColor;
  if (_pendingURL) {
    [self loadNow:_pendingURL userInitiated:_pendingUserInitiated];
    _pendingURL = nil;
  }
  [self emit:@"ready" payload:@{@"browserId" : @(ardiacore_host::BrowserId(tab)), @"tabId" : @(tab.tabId)}];
  [self emitNavigation];
  if (_extensionHost.length && [tab respondsToSelector:@selector(preferredSize)] && tab.preferredSize.width > 0)
    [self tab:tab preferredSizeDidChange:tab.preferredSize];
  if (_mediaFrames.count) [self emitMedia];
  [self tabDidChangeFavicon:tab];
  if (_tabIndex >= 0) [self placeTab];
  if (ArdiaCoreWindowController *controller = self.controller)
    [ArdiaCoreTabStrip changedInWindow:controller profile:tab.profile cause:NSNull.null];
}

- (void)bindRestoreKey {
  if (_tab && _transferKey.length && !ardiacore_host::IsIncognito(_profile) && ArdiaCoreHost.isStarted)
    [ArdiaCoreServices call:@"ac_tab_restore_tag" profile:_profile args:@{@"tab" : @(_tab.tabId), @"key" : _transferKey}
              completion:^(NSDictionary *) {}];
}

- (void)detach {
  if (!_tab) return;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ detach tab=%d", _transferKey, (int)_tab.tabId);
  if (_tab.delegate == self) _tab.delegate = nil;
  [ArdiaCoreTabs setView:nil forTab:_tab];
  [ArdiaCoreWebView noteShown:_tab];
  [self stashPageReports];
  AcceptDrops(_tab.view, YES);
  if (_tab.view.superview == self) [_tab.view removeFromSuperview];
  [self dropDevTools];
  [self resetBlocked:NO];
  [self endReveal];
  [self dropFront];
  _tab = nil;
  _focusOnActivate = NO;
  _pageFocus = ACPageFocus::Unknown;
  _focusedDevTools = nil;
  _handingOff = NO;
  _leaving = NO;
  _leaveGeneration++;
}

- (void)stashPageReports {
  NSMutableDictionary *reports = [NSMutableDictionary dictionary];
  reports[@"url"] = _tab.url ?: @"";
  reports[@"theme"] = _pageTheme;
  reports[@"themeSource"] = _pageThemeSource;
  reports[@"blocked"] = @(_blockedCount);
  reports[@"lastBlocked"] = _lastBlocked;
  reports[@"media"] = _mediaFrames;
  reports[@"nowPlaying"] = _nowPlaying;
  reports[@"nowPlayingFrame"] = _nowPlayingFrame;
  reports[@"notifications"] = _notificationFrames;
  reports[@"displayRequests"] = _displayRequests;
  reports[@"pinch"] = @(_pinchScale);
  reports[@"capturing"] = @(_capturing);
  reports[@"crashed"] = @(_crashed);
  reports[@"seen"] = @(_seenByUser);
  reports[@"pip"] = @(_inPictureInPicture);
  reports[@"autoPip"] = @(_autoPictureInPictureActive);
  if (!_tab.closed) objc_setAssociatedObject(_tab, &kPageReportsKey, reports, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [self takeReports:nil];
}

- (void)takePageReports {
  NSDictionary *reports = objc_getAssociatedObject(_tab, &kPageReportsKey);
  objc_setAssociatedObject(_tab, &kPageReportsKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [self takeReports:[reports[@"url"] isEqual:_tab.url ?: @""] ? reports : nil];
}

- (void)takeReports:(NSDictionary *)reports {
  _pageTheme = reports[@"theme"];
  _pageThemeSource = reports[@"themeSource"];
  _blockedCount = [reports[@"blocked"] integerValue];
  _lastBlocked = reports[@"lastBlocked"];
  _mediaFrames = reports[@"media"];
  _nowPlaying = reports[@"nowPlaying"];
  _nowPlayingFrame = reports[@"nowPlayingFrame"];
  _notificationFrames = reports[@"notifications"];
  _displayRequests = reports[@"displayRequests"];
  _pinchScale = [reports[@"pinch"] doubleValue];
  _capturing = [reports[@"capturing"] boolValue];
  _crashed = [reports[@"crashed"] boolValue];
  if (reports[@"seen"]) _seenByUser = [reports[@"seen"] boolValue];
  _inPictureInPicture = [reports[@"pip"] boolValue];
  _autoPictureInPictureActive = [reports[@"autoPip"] boolValue];
}

- (void)closeBrowser {
  _createGeneration++;
  _creating = NO;
  if (!_tab) return;
  ArdiaCoreTab *tab = _tab;
  if (_handingOff && _transferKey.length && !tab.closed) {
    [self detach];
    [ParkingView() addSubview:tab.view];
    Parked()[_transferKey] = tab;
    return;
  }
  _closing = YES;
  if (_transferKey.length && !ardiacore_host::IsIncognito(_profile) && ArdiaCoreHost.isStarted)
    [ArdiaCoreServices call:@"ac_tab_restore_tag" profile:_profile args:@{@"tab" : @(tab.tabId), @"key" : _transferKey}
              completion:^(NSDictionary *) {}];
  [[ArdiaCoreWindowController holding:tab] noteClosing:tab];
  [self detach];
  if ([tab respondsToSelector:@selector(closeNow)]) [tab closeNow];
  else [tab close];
}

- (void)placeTab {
  ArdiaCoreWindowController *controller = self.controller;
  if (!_tab || !controller || ![controller.coreWindow respondsToSelector:@selector(placeTab:index:pinned:)]) return;
  controller.hostChanges++;
  [controller.coreWindow placeTab:_tab index:(int)_tabIndex pinned:_pinned];
  controller.hostChanges--;
}

- (void)openedTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition {
  [self announceOpenedTab:tab adoptId:adoptId disposition:disposition tries:0];
}

- (void)openedRoutedTab:(ArdiaCoreTab *)tab placement:(NSDictionary<NSString *, id> *)placement {
  if (tab.closed) return;
  NSString *url = [placement[@"url"] isKindOfClass:NSString.class] ? placement[@"url"] : tab.url;
  [self emit:@"openWindow"
      payload:@{
        @"url" : url ?: @"",
        @"disposition" : placement[@"disposition"] ?: @"foreground",
        @"adoptId" : [ArdiaCoreTabs offerTab:tab],
        @"requiresAdoption" : @YES,
        @"placement" : @{@"profileId" : placement[@"profileId"] ?: @"", @"engine" : placement[@"engine"] ?: @"", @"action" : placement[@"action"] ?: @"tab"},
      }];
}

- (void)announceOpenedTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition tries:(int)tries {
  if (tab.closed) return;
  NSString *url = tab.url;
  if ((!url.length || [url isEqualToString:@"about:blank"]) && tries < 20) {
    __weak ArdiaCoreWebView *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [weakSelf announceOpenedTab:tab adoptId:adoptId disposition:disposition tries:tries + 1];
    });
    return;
  }
  NSMutableDictionary *payload = [@{
    @"url" : url ?: @"",
    @"disposition" : disposition,
    @"adoptId" : adoptId,
    @"userGesture" : @YES,
    @"postBody" : @NO,
  } mutableCopy];
  if (tab.profile.offTheRecord) payload[@"profile"] = ardiacore_host::OriginalProfileNameOf(tab.profile);
  [self emit:@"openWindow" payload:payload];
}

- (void)tabRemovedFromWindow:(ArdiaCoreWindow *)window {
  if (_moving || _closing || !_tab) return;
  {
    ArdiaCoreTab *removed = _tab;
    __weak ArdiaCoreWebView *weakSelf = self;
    dispatch_async(dispatch_get_main_queue(), ^{
      ArdiaCoreWebView *view = weakSelf;
      if (view && view->_tab == removed && removed.closed) [view detach];
    });
  }
  if (ardiacore_host::EngineHasTabModel()) return;
  [self detach];
  [self emit:@"windowClose" payload:@{}];
}

- (void)tabActivatedByChrome:(BOOL)chromes {
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ chrome-activated tab=%d byChrome=%d", _transferKey, _tab ? (int)_tab.tabId : -1, chromes);
  if (_standalone) return;
  [self requestFocusRestore];
  [self emit:@"tabStrip"
      payload:@{
        @"index" : @(MAX(_tabIndex, 0)),
        @"active" : @YES,
        @"pinned" : @(_pinned),
        @"activated" : @YES,
        @"byApp" : @(!chromes),
      }];
}

- (void)devToolsChanged:(NSView *)devToolsView {
  if (_devtoolsView && _devtoolsView != devToolsView && _devtoolsView.superview == self) {
    AcceptDrops(_devtoolsView, YES);
    [_devtoolsView removeFromSuperview];
  }
  _devtoolsView = devToolsView;
  if (devToolsView && devToolsView.superview != self) {
    [devToolsView removeFromSuperview];
    NSView *page = _tab.view;
    if (page.superview == self) [self addSubview:devToolsView positioned:NSWindowBelow relativeTo:page];
    else [self addSubview:devToolsView];
    AcceptDrops(devToolsView, _visible);
  }
  [self layoutPage];
}

- (void)dropDevTools {
  AcceptDrops(_devtoolsView, YES);
  if (_devtoolsView.superview == self) [_devtoolsView removeFromSuperview];
  _devtoolsView = nil;
}

- (void)setFrameSize:(NSSize)newSize {
  [super setFrameSize:newSize];
  [self layoutPage];
  if (_visible) [ArdiaCoreEarlyWindow noteLayoutChangeIn:self.window];
}

- (void)setFrameOrigin:(NSPoint)newOrigin {
  [super setFrameOrigin:newOrigin];
  if (_visible) [ArdiaCoreEarlyWindow noteLayoutChangeIn:self.window];
}

- (void)layoutPage {
  if (NSView *fronted = _frontedPage; fronted.superview == self) fronted.frame = self.bounds;
  NSView *page = _tab.view;
  if (!page || page.superview != self) return;
  if (_devtoolsView) {
    NSRect devtools = NSZeroRect, pageFrame = self.bounds;
    [_tab devToolsLayoutForSize:self.bounds.size devTools:&devtools page:&pageFrame];
    _devtoolsView.frame = devtools;
    page.frame = pageFrame;
  } else {
    page.frame = self.bounds;
  }
}

- (BOOL)paints {
  return _visible || (_warm && !self.neighbourPageAsleep) || _leaving || _revealed;
}

- (BOOL)neighbourPageAsleep {
  if (!_warm || !_neighbour || _visible || NeighbourPagesAlwaysLive()) return NO;
  NSWindow *window = self.window;
  if (!window) return NO;
  return [NeighbourPagesAwake() objectForKey:window].until <= CACurrentMediaTime();
}

- (void)setNeighbour:(BOOL)neighbour {
  if (_neighbour == neighbour) return;
  _neighbour = neighbour;
  [self schedulePainting];
}

+ (void)wakeNeighbourPagesIn:(NSWindow *)window seconds:(CFTimeInterval)seconds committed:(BOOL)committed {
  const CFTimeInterval now = CACurrentMediaTime();
  ACNeighbourWake *wake = [NeighbourPagesAwake() objectForKey:window];
  const BOOL wasAwake = wake.until > now;
  if (!wake) [NeighbourPagesAwake() setObject:(wake = [ACNeighbourWake new]) forKey:window];
  if (committed) wake.committedUntil = MAX(wake.committedUntil, now + seconds);
  else wake.speculativeUntil = MAX(wake.speculativeUntil, now + seconds);
  if (wasAwake) return;
  [self repaintWarmPagesIn:window];
  [self sleepNeighbourPagesIn:window after:seconds];
}

+ (void)releaseNeighbourPagesIn:(NSWindow *)window {
  ACNeighbourWake *wake = [NeighbourPagesAwake() objectForKey:window];
  const CFTimeInterval now = CACurrentMediaTime();
  if (!wake || wake.speculativeUntil <= now) return;
  wake.speculativeUntil = 0;
  if (wake.committedUntil <= now) [self repaintWarmPagesIn:window];
}

+ (void)sleepNeighbourPagesIn:(NSWindow *)window after:(CFTimeInterval)delay {
  __weak NSWindow *weakWindow = window;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSWindow *window = weakWindow;
    ACNeighbourWake *wake = window ? [NeighbourPagesAwake() objectForKey:window] : nil;
    if (!wake) return;
    const CFTimeInterval left = wake.until - CACurrentMediaTime();
    if (left > 0) return [self sleepNeighbourPagesIn:window after:left];
    [NeighbourPagesAwake() removeObjectForKey:window];
    [self repaintWarmPagesIn:window];
  });
}

+ (void)repaintWarmPagesIn:(NSWindow *)window {
  for (ArdiaCoreWebView *view in LiveViews().allObjects)
    if (view->_warm && view.window == window) [view schedulePainting];
}

- (void)applyPainting {
  self.alphaValue = _visible || _revealed || !(_warm || _leaving) ? 1 : 0;
  const BOOL shown = self.paints;
  for (NSView *sub in self.subviews) {
    sub.hidden = !shown;
    AcceptDrops(sub, _visible);
  }
  if (TraceVisibility())
    NSLog(@"[ardiacore-vis] %@ paint visible=%d warm=%d tab=%d page=%@ inWindow=%ld hiddenAncestor=%d", _transferKey,
          _visible, _warm, _tab ? (int)_tab.tabId : -1, _tab.view.superview == self ? @"here" : @"elsewhere",
          (long)self.window.windowNumber, _tab.view.isHiddenOrHasHiddenAncestor);
}

- (void)setWarm:(BOOL)warm {
  if (_warm == warm) return;
  _warm = warm;
  [self schedulePainting];
}

+ (void)noteShown:(ArdiaCoreTab *)tab {
  if (![tab respondsToSelector:@selector(noteShownByHost:)]) return;
  static NSMapTable<ArdiaCoreTab *, NSNumber *> *changes = [NSMapTable weakToStrongObjectsMapTable];
  const NSUInteger change = [changes objectForKey:tab].unsignedIntegerValue + 1;
  [changes setObject:@(change) forKey:tab];
  ArdiaCoreWebView *view = [ArdiaCoreTabs viewForTab:tab];
  if (view.seenByUser) return [tab noteShownByHost:YES];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    if ([changes objectForKey:tab].unsignedIntegerValue != change) return;
    ArdiaCoreWebView *now = [ArdiaCoreTabs viewForTab:tab];
    if (!now.seenByUser) [tab noteShownByHost:NO];
  });
}

- (void)setVisible:(BOOL)visible {
  if (_visible == visible) return;
  if (!visible) [self storePageFocus];
  _visible = visible;
  if (visible) [self settleRevealsInWindow];
  if (!visible && [_tab respondsToSelector:@selector(exitExclusiveAccess)]) [_tab exitExclusiveAccess];
  if (visible && self.alphaValue < 1 && _tab.view.superview == self && !_tab.view.hidden) self.alphaValue = 1;
  [self schedulePainting];
  if (visible) ACFieldMarkAtCommit(_transferKey, @"view");
  if (visible) [ArdiaCoreEarlyWindow noteLayoutChangeIn:self.window];
  [self userSightChanged];
}

- (BOOL)seenByUser {
  return _visible && [ArdiaCoreWindowController userSees:self.window];
}

- (void)userSightChanged {
  if (_tab) [ArdiaCoreWebView noteShown:_tab];
  const BOOL seen = self.seenByUser;
  if (seen == _seenByUser) return;
  _seenByUser = seen;
  [self traceAutoPictureInPicture:seen ? @"app: the user sees the tab" : @"app: the user left the tab"];
  [self updateAutoPictureInPicture];
}

- (void)traceAutoPictureInPicture:(NSString *)what {
  if (!TracingPictureInPicture() || ![_tab respondsToSelector:@selector(tracePictureInPicture:withInputs:)]) return;
  NSDictionary *np = _nowPlaying[_nowPlayingFrame ?: @""];
  [_tab tracePictureInPicture:[NSString stringWithFormat:@"%@ (%@): autoPictureInPicture=%d capturing=%d nowPlaying=%@ actions=%@",
                                                         what, _tab.url, _autoPictureInPicture, _capturing,
                                                         np[@"playbackState"] ?: @"none", JSONString(np[@"actions"] ?: @[])]
                   withInputs:YES];
  ArdiaCoreTab *tab = _tab;
  [_tab evaluate:@"post('result', JSON.stringify({ documentPictureInPicture: 'documentPictureInPicture' in window, "
                  "window: !!window.documentPictureInPicture?.window, videoPip: !!document.pictureInPictureElement, "
                  "brands: navigator.userAgentData?.brands?.map((b) => b.brand + '/' + b.version), visibility: document.visibilityState }))"
      completion:^(NSString *json) { [tab tracePictureInPicture:[@"page: " stringByAppendingString:json ?: @"(no answer)"] withInputs:NO]; }];
}

- (void)schedulePainting {
  [PendingPainting() addObject:self];
  if (gPaintingScheduled) return;
  gPaintingScheduled = true;
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(nil, kCFRunLoopBeforeWaiting | kCFRunLoopExit, false, 0, ^(CFRunLoopObserverRef, CFRunLoopActivity) {
    [ArdiaCoreWebView drainPainting];
  });
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  CFRelease(observer);
}

+ (void)drainPainting {
  gPaintingScheduled = false;
  NSArray<ArdiaCoreWebView *> *views = PendingPainting().allObjects;
  [PendingPainting() removeAllObjects];
  for (ArdiaCoreWebView *view in views) {
    if (view->_visible) continue;
    [view leaveScreen];
    [view applyPainting];
  }
  for (ArdiaCoreWebView *view in views)
    if (view->_visible) [view applyPainting];
  for (ArdiaCoreWebView *view in views)
    if (view->_visible) [view restoreFocusIfDue];
}

static BOOL InTabPage(NSView *view) {
  for (NSView *v = view; v; v = v.superview)
    if ([v isKindOfClass:ArdiaCoreWebView.class]) return !((ArdiaCoreWebView *)v)->_standalone;
  return NO;
}

+ (void)installOutgoingFocusSnapshots {
  static id snapshots, ends;
  if (snapshots) return;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  snapshots = [center addObserverForName:@"ArdiaOutgoingFocus" object:nil queue:nil usingBlock:^(NSNotification *note) {
    if (ArdiaCoreWebView *view = [ArdiaCoreWebView holding:note.object]) {
      [view storePageFocusFrom:note.object];
      view->_keepsOutgoingFocus = YES;
    }
  }];
  ends = [center addObserverForName:@"ArdiaFocusHandoffEnded" object:nil queue:nil usingBlock:^(NSNotification *note) {
    if (ArdiaCoreWebView *view = [ArdiaCoreWebView holding:note.object]) view->_keepsOutgoingFocus = NO;
  }];
}

+ (ArdiaCoreWebView *)holding:(id)responder {
  NSView *outgoing = [responder isKindOfClass:NSView.class] ? responder : nil;
  for (ArdiaCoreWebView *view in LiveViews().allObjects)
    if (outgoing && view.window == outgoing.window && [outgoing isDescendantOf:view]) return view;
  return nil;
}

- (void)storePageFocus {
  NSResponder *responder = self.window.firstResponder;
  const BOOL unfocused = !responder || responder == self.window;
  const BOOL snapshotted = _keepsOutgoingFocus;
  _keepsOutgoingFocus = NO;
  if (snapshotted && unfocused) {
    _focusOnActivate = NO;
    return;
  }
  [self storePageFocusFrom:responder];
}

- (void)storePageFocusFrom:(NSResponder *)responder {
  _focusOnActivate = NO;
  _focusedDevTools = nil;
  NSWindow *window = self.window;
  if (!window || !_tab) return;
  NSView *view = [responder isKindOfClass:NSView.class] ? (NSView *)responder : nil;
  if (view && _tab.view && [view isDescendantOf:_tab.view]) {
    _pageFocus = ACPageFocus::Page;
  } else if (view && _devtoolsView && [view isDescendantOf:_devtoolsView]) {
    _pageFocus = ACPageFocus::DevTools;
    _focusedDevTools = view;
  } else if (!responder || responder == window || (view && InTabPage(view))) {
    _pageFocus = ACPageFocus::Unknown;
  } else {
    _pageFocus = ACPageFocus::Elsewhere;
  }
}

- (void)requestFocusRestore {
  [self requestFocusRestoreIn:self.window];
}

- (void)requestFocusRestoreIn:(NSWindow *)window {
  if (_standalone || !_tab || !window) return;
  _focusOnActivate = YES;
  _focusActivatedAt = CACurrentMediaTime();
  _focusActivatedIn = window;
  [self restoreFocusIfDue];
  if (_focusOnActivate) [self schedulePainting];
}

- (void)restoreFocusIfDue {
  if (!_focusOnActivate) return;
  NSWindow *window = self.window;
  NSView *page = _tab.view;
  if (!window || window != _focusActivatedIn || !page || _standalone || page.superview != self ||
      CACurrentMediaTime() - _focusActivatedAt > kFocusRestoreWindow) {
    _focusOnActivate = NO;
    return;
  }
  if (!_visible || page.isHiddenOrHasHiddenAncestor) return;
  _focusOnActivate = NO;
  NSResponder *responder = window.firstResponder;
  NSView *view = [responder isKindOfClass:NSView.class] ? (NSView *)responder : nil;
  if (view && [view isDescendantOf:self]) return;
  if (responder && responder != window && !(view && InTabPage(view))) return;
  NSView *devTools = _focusedDevTools;
  if (_pageFocus == ACPageFocus::DevTools && devTools.window == window && _devtoolsView && [devTools isDescendantOf:_devtoolsView]) {
    [window makeFirstResponder:devTools];
  } else if (_pageFocus != ACPageFocus::Elsewhere) {
    [self focusPage];
  }
}

static ArdiaCoreWebView *ViewForKey(NSString *key) {
  for (ArdiaCoreWebView *view in LiveViews().allObjects)
    if (view->_tab && [view->_transferKey isEqualToString:key]) return view;
  return nil;
}

+ (void)revealTab:(NSString *)transferKey {
  if (!transferKey.length) return;
  NSString *key = [transferKey copy];
  OnMain(^{
    ArdiaCoreWebView *view = ViewForKey(key);
    if (!view.window) return;
    [ArdiaCoreWebView dropRevealsInWindow:view.window except:view];
    [view revealAhead];
  });
}

+ (void)dropTabReveals:(NSString *)transferKey {
  if (!transferKey.length) return;
  NSString *key = [transferKey copy];
  OnMain(^{
    ArdiaCoreWebView *view = ViewForKey(key);
    if (view.window) [ArdiaCoreWebView dropRevealsInWindow:view.window except:nil];
  });
}

+ (void)dropRevealsInWindow:(NSWindow *)window except:(ArdiaCoreWebView *)keep {
  for (ArdiaCoreWebView *other in LiveViews().allObjects) {
    if (other.window != window) continue;
    [other dropFront];
    if (other != keep) [other dropReveal];
  }
}

static NSView *PaneUnder(NSView *view, NSView *ancestor) {
  for (NSView *v = view; v; v = v.superview)
    if (v.superview == ancestor) return v;
  return nil;
}

static NSView *SharedAncestor(NSView *a, NSView *b) {
  NSHashTable<NSView *> *chain = [NSHashTable weakObjectsHashTable];
  for (NSView *v = a.superview; v; v = v.superview) [chain addObject:v];
  for (NSView *v = b.superview; v; v = v.superview)
    if ([chain containsObject:v]) return v;
  return nil;
}

+ (void)revealOffered:(NSString *)adoptId over:(NSString *)transferKey {
  if (!adoptId.length || !transferKey.length) return;
  NSString *offer = [adoptId copy], *key = [transferKey copy];
  OnMain(^{
    ArdiaCoreWebView *view = ViewForKey(key);
    if (!view.window) return;
    [ArdiaCoreWebView dropRevealsInWindow:view.window except:nil];
    ArdiaCoreTab *tab = [ArdiaCoreTabs offeredTab:offer];
    NSView *page = tab.view;
    if (TraceVisibility())
      NSLog(@"[ardiacore-vis] %@ front %@ offered=%d closed=%d superview=%@ adopted=%d", key, offer, tab != nil, tab.closed,
            page.superview.className, [ArdiaCoreTabs viewForTab:tab] != nil);
    if (!tab || tab.closed || !page || page.superview || [ArdiaCoreTabs viewForTab:tab]) return;
    [view frontPage:page profile:tab.profile];
  });
}

- (BOOL)onlyShownInWindow {
  NSWindow *window = self.window;
  if (!_visible || _warm || _revealed || _standalone || _closing || !window || self.alphaValue < 1 || self.isHiddenOrHasHiddenAncestor) return NO;
  for (ArdiaCoreWebView *other in LiveViews().allObjects)
    if (other != self && other.window == window && (other->_visible || other->_warm || other->_revealed)) return NO;
  return YES;
}

- (void)frontPage:(NSView *)page profile:(ArdiaCoreProfile *)profile {
  NSView *mine = _tab.view;
  if (_frontedPage || _devtoolsView || !mine || mine.superview != self || mine.hidden || _tab.profile != profile || ![self onlyShownInWindow]) return;
  page.frame = self.bounds;
  page.hidden = NO;
  [self addSubview:page positioned:NSWindowAbove relativeTo:mine];
  _frontedPage = page;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ fronts a new tab's page", _transferKey);
  const NSUInteger generation = ++_frontGeneration;
  __weak ArdiaCoreWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRevealBackstopSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaCoreWebView *view = weakSelf;
    if (view && view->_frontGeneration == generation) [view dropFront];
  });
}

- (void)dropFront {
  NSView *fronted = _frontedPage;
  _frontedPage = nil;
  _frontGeneration++;
  if (fronted.superview == self) [fronted removeFromSuperview];
}

- (void)revealAhead {
  NSWindow *window = self.window;
  NSView *page = _tab.view;
  if (_visible || _revealed || _warm || _standalone || _closing || !window || !page || page.superview != self) return;
  ArdiaCoreWebView *shown = nil;
  for (ArdiaCoreWebView *other in LiveViews().allObjects) {
    if (other == self || other.window != window) continue;
    if (other->_warm || other->_revealed) return;
    if (!other->_visible) continue;
    if (shown) return;
    shown = other;
  }
  if (!shown || shown.alphaValue < 1 || shown->_frontedPage) return;
  const NSRect mine = [self convertRect:self.bounds toView:nil];
  if (NSIsEmptyRect(mine) || !NSEqualRects(mine, [shown convertRect:shown.bounds toView:nil])) return;
  NSView *shared = SharedAncestor(self, shown);
  NSView *pane = PaneUnder(self, shared);
  NSView *shownPane = PaneUnder(shown, shared);
  if (!shared || !pane || !shownPane || !shownPane.layer || pane == shownPane || pane.isHiddenOrHasHiddenAncestor || pane.alphaValue < 1) return;
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ revealed over %@", _transferKey, shown->_transferKey);
  _revealed = YES;
  _loweredPane = shownPane;
  _loweredPaneZ = shownPane.layer.zPosition;
  shownPane.layer.zPosition = _loweredPaneZ - 1;
  [self applyPainting];
  const NSUInteger generation = ++_revealGeneration;
  __weak ArdiaCoreWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRevealBackstopSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaCoreWebView *view = weakSelf;
    if (view && view->_revealGeneration == generation && view->_revealed) [view dropReveal];
  });
}

- (void)endReveal {
  if (!_revealed) return;
  _revealed = NO;
  _revealGeneration++;
  if (NSView *pane = _loweredPane) pane.layer.zPosition = _loweredPaneZ;
  _loweredPane = nil;
}

- (void)dropReveal {
  if (!_revealed) return;
  [self endReveal];
  [self schedulePainting];
}

- (void)settleRevealsInWindow {
  [self endReveal];
  NSWindow *window = self.window;
  if (window) [ArdiaCoreWebView dropRevealsInWindow:window except:self];
}

- (void)leaveScreen {
  const NSUInteger generation = ++_leaveGeneration;
  NSView *page = _tab.view;
  _leaving = !_visible && !_warm && !_revealed && page.superview == self && !page.hidden && self.alphaValue > 0;
  if (!_leaving) return;
  __weak ArdiaCoreWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLeaveScreenDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaCoreWebView *view = weakSelf;
    if (!view || view->_leaveGeneration != generation) return;
    view->_leaving = NO;
    [view schedulePainting];
  });
}

- (void)setFrozen:(BOOL)frozen {
  _frozen = frozen;
  if ([_tab respondsToSelector:@selector(setFrozen:)]) _tab.frozen = frozen;
}

- (void)setPageBackgroundColor:(NSColor *)color {
  _pageBackgroundColor = color;
  if ([_tab respondsToSelector:@selector(setPageBackgroundColor:)]) _tab.pageBackgroundColor = color;
}

- (void)setPageColor:(NSString *)color {
  _pageColor = [color copy];
  if ([_tab respondsToSelector:@selector(setPageColor:)]) _tab.pageColor = color;
}

- (void)emit:(NSString *)name payload:(NSDictionary *)payload {
  if (_navigationQueued && ![name isEqualToString:@"navigation"]) [self emitNavigation];
  if (_tab) NoteEvent(ardiacore_host::BrowserId(_tab), name, payload);
  [self.delegate webView:self event:name payload:payload];
}

void ArdiaCoreWebViewsSetFieldTiming(BOOL on) {
  for (ArdiaCoreWebView *view in LiveViews().allObjects)
    if (view->_tab) [view callFrame:@"" kind:@"fieldTiming" json:on ? @"{\"on\":true}" : @"{\"on\":false}"];
}

+ (NSArray<NSDictionary<NSString *, id> *> *)devEventsForBrowser:(int)browserId {
  return RecentEvents()[@(browserId)] ?: @[];
}

+ (void)setDisplayMediaPicker:(BOOL)enabled {
  gDisplayMediaPicker = enabled;
}

+ (void)setAutoPictureInPictureEnabled:(BOOL)enabled {
  if ([ArdiaCoreEngine respondsToSelector:@selector(setAutoPictureInPicture:)]) [ArdiaCoreEngine setAutoPictureInPicture:enabled];
}

+ (void)setVideoUpscalingEnabled:(BOOL)enabled {
  if ([ArdiaCoreEngine respondsToSelector:@selector(setVideoUpscaling:)]) [ArdiaCoreEngine setVideoUpscaling:enabled];
}

+ (void)setVideoUpscalingTestConditions:(NSDictionary<NSString *, NSNumber *> *)conditions {
  if ([ArdiaCoreEngine respondsToSelector:@selector(setVideoUpscalingTestConditions:)]) [ArdiaCoreEngine setVideoUpscalingTestConditions:conditions];
}

+ (NSDictionary<NSString *, id> *)videoUpscalingState {
  return [ArdiaCoreEngine respondsToSelector:@selector(videoUpscalingState)] ? ArdiaCoreEngine.videoUpscalingState : nil;
}

+ (void)setSearchEngineName:(NSString *)name {
  gSearchEngineName = name.length ? [name copy] : @"Google";
}

+ (NSInteger)devWindowNumberForBrowser:(int)browserId {
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  ArdiaCoreWebView *view = tab ? [ArdiaCoreTabs viewForTab:tab] : nil;
  return view.window.windowNumber;
}

+ (BOOL)devFocusPageOfBrowser:(int)browserId {
#if DEBUG
  ArdiaCoreTab *tab = ardiacore_host::TabWithBrowserId(browserId);
  NSWindow *window = tab.view.window;
  NSView *page = nil;
  for (NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:tab.view ?: [NSView new]]; queue.count && !page;) {
    NSView *v = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if ([NSStringFromClass(v.class) isEqual:@"RenderWidgetHostViewCocoa"]) page = v;
    [queue addObjectsFromArray:v.subviews];
  }
  if (!window || !page) return NO;
  [window makeKeyWindow];
  [window makeFirstResponder:nil];
  return [window makeFirstResponder:page];
#else
  return NO;
#endif
}

- (void)emitNavigation {
  _navigationQueued = NO;
  if (!_tab) return;
  NSString *theme = _pageTheme ?: ([_tab respondsToSelector:@selector(themeColor)] ? _tab.themeColor : nil);
  NSString *themeSource = _pageTheme ? _pageThemeSource : (theme ? @"meta" : nil);
  NSString *url = _tab.url ?: @"";
  if (IsRendererDebugURL(url)) url = _sentNavigation[@"url"] ?: @"";
  [ArdiaCoreEarlyWindow page:_tab emitted:url];
  NSDictionary *navigation = @{
        @"url" : url,
        @"title" : ReportedTitle(_tab.title, url, _tab.loading),
        @"canGoBack" : @(_tab.canGoBack),
        @"canGoForward" : @(_tab.canGoForward),
        @"isLoading" : @(_tab.loading),
        @"themeColor" : theme ?: NSNull.null,
        @"themeColorSource" : themeSource ?: NSNull.null,
  };
  if ([_tab respondsToSelector:@selector(initialDocumentAccessed)] && [_tab respondsToSelector:@selector(committedInitial)]) {
    NSMutableDictionary *withInitial = [navigation mutableCopy];
    withInitial[@"initialDocumentAccessed"] = @(_tab.initialDocumentAccessed);
    withInitial[@"committedInitial"] = @(_tab.committedInitial);
    navigation = withInitial;
  }
  if (_crashed && _tab.loading) {
    _crashed = NO;
    NSMutableDictionary *gone = [navigation mutableCopy];
    gone[@"url"] = @"";
    _sentNavigation = gone;
    [self emit:@"navigation" payload:gone];
  }
  if ([navigation isEqualToDictionary:_sentNavigation]) return;
  _sentNavigation = navigation;
  [self emit:@"navigation" payload:navigation];
}

- (void)queueNavigation {
  if (_navigationQueued) return;
  _navigationQueued = YES;
  __weak ArdiaCoreWebView *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    ArdiaCoreWebView *view = weakSelf;
    if (view && view->_navigationQueued) [view emitNavigation];
  });
}

- (void)tabDidChangeTitle:(ArdiaCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeURL:(ArdiaCoreTab *)tab {
  [self queueNavigation];
  [ArdiaCoreEarlyWindow page:tab shownURL:_shownURL];
}

- (void)setShownURL:(NSString *)shownURL {
  _shownURL = [shownURL copy];
  [ArdiaCoreEarlyWindow page:_tab shownURL:_shownURL];
}

- (void)tabDidChangeLoading:(ArdiaCoreTab *)tab {
  if (tab.loading) [self resetBlocked:YES];
  if (tab.loading) ACFieldMarkNow(_transferKey, @"start");
  [self queueNavigation];
}

- (void)resetBlocked:(BOOL)report {
  _blockedGeneration++;
  _blockedEmitQueued = NO;
  const BOOL had = _blockedCount || _lastBlocked;
  _blockedCount = 0;
  _lastBlocked = nil;
  if (report && had) [self emit:@"contentBlocked" payload:@{@"count" : @0, @"url" : @""}];
}

- (void)tabDidChangeNavigationState:(ArdiaCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeThemeColor:(ArdiaCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidCommitDocument:(ArdiaCoreTab *)tab {
  ACFieldMarkNow(_transferKey, @"commit");
  [ArdiaCoreEarlyWindow pageCommitted:tab shownURL:_shownURL];
  _pageTheme = nil;
  _pageThemeSource = nil;
  [self queueNavigation];
}

- (void)tabDidChangeProgress:(ArdiaCoreTab *)tab {
  const double progress = tab.progress;
  const CFTimeInterval wait = _sentProgressAt + 0.1 - CACurrentMediaTime();
  if (progress <= 0.1 || progress >= 1 || wait <= 0) return [self sendProgress];
  if (_progressQueued) return;
  _progressQueued = YES;
  __weak ArdiaCoreWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(wait * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaCoreWebView *view = weakSelf;
    if (view && view->_progressQueued) [view sendProgress];
  });
}

- (void)sendProgress {
  _progressQueued = NO;
  if (!_tab || _tab.progress == _sentProgress) return;
  _sentProgress = _tab.progress;
  _sentProgressAt = CACurrentMediaTime();
  [self emit:@"progress" payload:@{@"progress" : @(_sentProgress)}];
}

- (void)tab:(ArdiaCoreTab *)tab didRequestAppURL:(NSString *)url userGesture:(BOOL)userGesture {
  [self emit:@"openWindow" payload:@{@"url" : url ?: @"", @"disposition" : @"current", @"userGesture" : @(userGesture)}];
}

- (void)tabDidChangeFavicon:(ArdiaCoreTab *)tab {
  NSImage *image = tab.favicon;
  if (!image) return;
  NSString *url = [tab respondsToSelector:@selector(faviconURL)] ? tab.faviconURL : nil;
  if (url.length) [ArdiaCoreFavicons noteImage:image forURL:url profile:_profile];
  else url = PNGDataURL(image);
  if (!url.length || [url isEqualToString:_lastFavicon]) return;
  _lastFavicon = url;
  [self emit:@"favicon" payload:@{@"url" : url, @"urls" : @[ url ]}];
}

- (void)tab:(ArdiaCoreTab *)tab didFindMatches:(int)count active:(int)active final:(BOOL)final {
  [self emit:@"find" payload:@{@"count" : @(count), @"active" : @(active), @"final" : @(final)}];
}

- (void)tab:(ArdiaCoreTab *)tab didReceivePageMessage:(NSString *)kind json:(NSString *)json frame:(NSString *)frameId main:(BOOL)main {
  id data = JSONValue(json);
  NSDictionary *dict = [data isKindOfClass:NSDictionary.class] ? data : nil;
  frameId = frameId ?: @"";
  if ([kind isEqualToString:@"hello"]) {
    if (main) [self resetPageMedia];
    if (main && ![(Text(dict, @"url", 8192) ?: @"about:") hasPrefix:@"about:"]) _requestedURL = nil;
    AnswerHello(tab, _profile, dict, frameId, main);
  } else if ([kind isEqualToString:@"selection"] && main) {
    [self emit:@"pageMessage" payload:@{@"kind" : @"selection", @"data" : SelectionState(dict) ?: NSNull.null}];
  } else if ([kind isEqualToString:@"linkDrop"] && main) {
    NSString *url = Text(dict, @"url", 8192);
    NSString *scheme = (url.length ? [NSURL URLWithString:url].scheme.lowercaseString : nil) ?: @"";
    const CFTimeInterval now = CACurrentMediaTime();
    const CGEventSourceStateID state = kCGEventSourceStateCombinedSessionState;
    const double sinceUp = CGEventSourceSecondsSinceLastEventType(state, kCGEventLeftMouseUp);
    const BOOL released = !(NSEvent.pressedMouseButtons & 1) && sinceUp < 1 &&
                          sinceUp <= CGEventSourceSecondsSinceLastEventType(state, kCGEventLeftMouseDragged);
    const NSPoint mouse = NSEvent.mouseLocation;
    NSWindow *window = self.window;
    const BOOL over = window && [NSWindow windowNumberAtPoint:mouse belowWindowWithWindowNumber:0] == window.windowNumber &&
                      NSPointInRect([self convertPoint:[window convertPointFromScreen:mouse] fromView:nil], self.bounds);
    if (_visible && [@[ @"http", @"https" ] containsObject:scheme] && released && over && now - _linkDropAt > 1) {
      _linkDropAt = now;
      [self emit:@"openWindow" payload:@{@"url" : url, @"disposition" : @"foreground", @"userGesture" : @YES}];
    }
  } else if ([kind isEqualToString:@"perf"] && main && ACFieldTimingEnabled()) {
    for (NSString *what in @[ @"fcp", @"shown" ]) {
      NSNumber *at = [dict[what] isKindOfClass:NSNumber.class] ? dict[what] : nil;
      if (at && fabs(at.doubleValue - ACFieldNow()) < 600000) ACFieldMark(_transferKey, what, at.doubleValue);
    }
  } else if ([kind isEqualToString:@"scroll"] && main) {
    NSString *state = Text(dict, @"state", 8);
    if ([@[ @"down", @"up", @"top" ] containsObject:state ?: @""])
      [self emit:@"pageMessage" payload:@{@"kind" : @"scroll", @"data" : @{@"state" : state}}];
  } else if ([kind isEqualToString:@"media"] && dict) {
    NSString *mediaFrame = Text(dict, @"frame", 64);
    if (!mediaFrame) return;
    if (!_mediaFrames) _mediaFrames = [NSMutableDictionary dictionary];
    NSString *key = [NSString stringWithFormat:@"%@:%@", frameId, mediaFrame];
    if (_mediaFrames.count >= 256 && !_mediaFrames[key]) return;
    _mediaFrames[key] = @(Flag(dict, @"playing"));
    [self emitMedia];
  } else if ([kind isEqualToString:@"nowPlaying"]) {
    if (!_nowPlaying) _nowPlaying = [NSMutableDictionary dictionary];
    if (dict) _nowPlaying[frameId] = NowPlayingState(dict);
    else [_nowPlaying removeObjectForKey:frameId];
    _nowPlayingFrame = dict ? frameId : _nowPlaying.allKeys.firstObject;
    NSDictionary<NSString *, NSDictionary *> *frames = _nowPlaying;
    NSInteger (^rank)(NSString *) = ^NSInteger(NSString *f) {
      NSDictionary *np = f ? frames[f] : nil;
      return ([np[@"controllable"] boolValue] ? 2 : 0) + ([np[@"playbackState"] isEqual:@"playing"] ? 1 : 0);
    };
    for (NSString *f in _nowPlaying)
      if (rank(f) > rank(_nowPlayingFrame)) _nowPlayingFrame = f;
    NSMutableDictionary *state = [_nowPlaying[_nowPlayingFrame ?: @""] mutableCopy];
    [state removeObjectForKey:@"frame"];
    [self emit:@"nowPlaying" payload:@{@"state" : state ?: NSNull.null}];
  } else if ([kind isEqualToString:@"theme"]) {
    if (!main || !dict) return;
    NSString *color = [dict[@"color"] isKindOfClass:NSString.class] ? Text(dict, @"color", 64) : nil;
    NSString *source = [dict[@"source"] isKindOfClass:NSString.class] ? Text(dict, @"source", 32) : nil;
    _pageTheme = color;
    _pageThemeSource = source;
    [self queueNavigation];
  } else if ([kind isEqualToString:@"pinch"] && main && dict) {
    double scale;
    if (!Finite(dict, @"scale", &scale) || scale <= 0) return;
    _pinchScale = MIN(scale, 100);
    [self emitZoom];
  } else if ([kind isEqualToString:@"pipTrace"]) {
    if (TracingPictureInPicture() && [_tab respondsToSelector:@selector(tracePictureInPicture:withInputs:)])
      [_tab tracePictureInPicture:[NSString stringWithFormat:@"page (%@): %@", main ? @"main frame" : @"subframe", JSONString(dict ?: @{})]
                       withInputs:NO];
  } else if ([kind isEqualToString:@"pip"] && dict) {
    NSNumber *active = [dict[@"active"] isKindOfClass:NSNumber.class] ? dict[@"active"] : nil;
    NSString *pipKind = [dict[@"kind"] isEqual:@"document"] ? @"document" : @"video";
    if (!active) return;
    _inPictureInPicture = active.boolValue;
    [self emit:@"pictureInPicture" payload:@{@"kind" : pipKind, @"active" : active}];
    if (active.boolValue) ardiacore_pip::WatchZoom();
    if ([pipKind isEqual:@"video"]) ardiacore_pip::VideoChanged(self, [NSURL URLWithString:tab.url ?: @""].host ?: @"", frameId, active.boolValue);
  } else if ([kind isEqualToString:@"notification"] && dict) {
    NSString *nid = Text(dict, @"id", 128);
    NSString *origin = OriginOf(tab.url);
    if (!nid.length || !Text(dict, @"title", 1024) || !origin) return;
    if (!_notificationFrames || _notificationFrames.count > 500) _notificationFrames = [NSMutableDictionary dictionary];
    _notificationFrames[nid] = frameId;
    [self emit:@"notification"
        payload:@{
          @"id" : nid,
          @"title" : Text(dict, @"title", 1024),
          @"body" : Text(dict, @"body", 4096) ?: @"",
          @"icon" : Text(dict, @"icon", 1 << 20) ?: NSNull.null,
          @"tag" : Text(dict, @"tag", 1024) ?: @"",
          @"silent" : @(Flag(dict, @"silent")),
          @"requireInteraction" : @(Flag(dict, @"requireInteraction")),
          @"origin" : origin,
          @"browserId" : @(ardiacore_host::BrowserId(tab)),
          @"isMainFrame" : @(main),
        }];
  } else if ([kind isEqualToString:@"notificationClose"] && dict) {
    NSString *nid = Text(dict, @"id", 128);
    if (!nid.length) return;
    [_notificationFrames removeObjectForKey:nid];
    [self emit:@"notificationClose" payload:@{@"id" : nid}];
  } else if ([kind isEqualToString:@"displayMedia"] && dict) {
    double pageId;
    if (!Finite(dict, @"id", &pageId) || pageId < 1 || pageId > INT_MAX || pageId != floor(pageId)) return;
    if (!_displayRequests) _displayRequests = [NSMutableDictionary dictionary];
    if (_displayRequests.count >= 16) return;
    NSString *requestId = NSUUID.UUID.UUIDString;
    _displayRequests[requestId] = @{@"frame" : frameId, @"id" : @((int)pageId), @"audio" : @(Flag(dict, @"audio"))};
    [self emit:@"displayMediaRequest"
        payload:@{@"id" : requestId, @"origin" : OriginOf(tab.url) ?: @"", @"audio" : @(Flag(dict, @"audio")), @"sources" : ArdiaCoreHost.displayMediaSources}];
  }
}

- (void)tab:(ArdiaCoreTab *)tab didReceivePageMessage:(NSString *)kind json:(NSString *)json {
  [self tab:tab didReceivePageMessage:kind json:json frame:@"" main:YES];
}

- (void)callFrame:(NSString *)frameId kind:(NSString *)kind json:(NSString *)json {
  if (frameId.length && [_tab respondsToSelector:@selector(callFrame:kind:json:)]) [_tab callFrame:frameId kind:kind json:json];
  else if ([_tab respondsToSelector:@selector(callPage:json:)]) [_tab callPage:kind json:json];
}

- (void)emitMedia {
  BOOL playing = NO;
  for (NSNumber *p in _mediaFrames.allValues) playing |= p.boolValue;
  const BOOL muted = [_tab respondsToSelector:@selector(muted)] ? _tab.muted : _muted;
  [self emit:@"media" payload:@{@"playing" : @(playing), @"muted" : @(muted)}];
}

- (void)emitZoom {
  const double zoom = [_tab respondsToSelector:@selector(zoomFactor)] ? _tab.zoomFactor : 1;
  [self emit:@"zoom"
      payload:@{
        @"zoom" : @(round(zoom * 100) / 100),
        @"host" : [NSURL URLWithString:_tab.url ?: @""].host.lowercaseString ?: @"",
        @"isDefault" : @(fabs(zoom - 1) < 0.001),
        @"pinchScale" : @(_pinchScale ?: 1),
      }];
}

- (void)tabDidChangeZoom:(ArdiaCoreTab *)tab {
  [self emitZoom];
}

- (void)tabDidChangeSecurity:(ArdiaCoreTab *)tab {
  if (NSDictionary *info = tab.securityInfo) [self emit:@"security" payload:info];
}

- (void)tabWillClose:(ArdiaCoreTab *)tab {
  [ArdiaCoreEarlyWindow dropPage:tab];
  if (_closing || tab != _tab) return;
  [self detach];
  [self emit:@"windowClose" payload:@{}];
}

- (void)resetPageMedia {
  const BOOL hadMedia = _mediaFrames.count > 0, hadNowPlaying = _nowPlaying.count > 0;
  [_mediaFrames removeAllObjects];
  [_nowPlaying removeAllObjects];
  _nowPlayingFrame = nil;
  if (hadMedia) [self emitMedia];
  if (hadNowPlaying) [self emit:@"nowPlaying" payload:@{@"state" : NSNull.null}];
}

- (void)tab:(ArdiaCoreTab *)tab rendererGone:(NSString *)status code:(int)code {
  _crashed = YES;
  [self resetPageMedia];
  [self emit:@"crashed" payload:@{@"status" : @(code), @"reason" : status ?: @"unknown", @"code" : @(code)}];
}

- (void)tab:(ArdiaCoreTab *)tab didFailLoad:(NSString *)url code:(int)code description:(NSString *)text {
  [self emit:@"loadError" payload:@{@"url" : url ?: @"", @"code" : @(code), @"text" : text ?: @""}];
}

- (void)tab:(ArdiaCoreTab *)tab didChangeStatusText:(NSString *)text {
  [self emit:@"status" payload:@{@"text" : text ?: @""}];
}

- (void)tabDidGainFocus:(ArdiaCoreTab *)tab {
  [self emit:@"focus" payload:@{}];
}

- (void)tabDidChangeAudio:(ArdiaCoreTab *)tab {
  [self emitMedia];
}

- (void)loadURL:(NSString *)url {
  [self loadURL:url userInitiated:NO];
}

- (void)loadURL:(NSString *)url userInitiated:(BOOL)userInitiated {
  if (!url.length) return;
  NSString *transferred = _transferredURL;
  _transferredURL = nil;
  NSString *creating = _creatingURL;
  _creatingURL = nil;
  if (_tab && SamePage(url, transferred)) return;
  if ((_tab || _creating) && [url isEqualToString:creating] && CACurrentMediaTime() - _creatingAt < 2) return;
  if (_tab) return [self loadNow:url userInitiated:userInitiated];
  _pendingURL = url;
  _pendingUserInitiated = userInitiated;
  if (self.window) [self ensureTab];
}

- (void)loadNow:(NSString *)url userInitiated:(BOOL)userInitiated {
  if ([self skipsNavigationDownload:url userInitiated:userInitiated]) return;
  ACFieldMarkNow(_transferKey, @"request");
  if ([_tab respondsToSelector:@selector(loadURL:userInitiated:)]) [_tab loadURL:url userInitiated:userInitiated];
  else [_tab loadURL:url];
  [self focusAfterLoad];
}

- (void)focusAfterLoad {
  if (_visible && _tab) [self focusPage];
}

- (BOOL)skipsNavigationDownload:(NSString *)url userInitiated:(BOOL)userInitiated {
  const BOOL first = !_loadedOnce;
  _loadedOnce = YES;
  _pendingUserInitiated = NO;
  if (first && !userInitiated && ardiacore_host::WasNavigationDownload(url, _profile)) {
    __weak ArdiaCoreWebView *weakSelf = self;
    NSDictionary *payload = @{@"url" : url ?: @"", @"committedUrl" : @"", @"skipped" : @YES};
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf emit:@"downloadNavigation" payload:payload]; });
    return YES;
  }
  _requestedURL = url;
  return NO;
}

- (void)goBack {
  [_tab goBack];
}

- (void)goForward {
  [_tab goForward];
}

- (void)goToHistoryOffset:(NSInteger)offset {
  if ([_tab respondsToSelector:@selector(goToOffset:)]) [_tab goToOffset:(int)offset];
  else if (offset == -1) [_tab goBack];
  else if (offset == 1) [_tab goForward];
}

- (void)reload {
  [_tab reload];
}

- (void)reloadIgnoringCache {
  if ([_tab respondsToSelector:@selector(reloadIgnoringCache)]) [_tab reloadIgnoringCache];
  else [_tab reload];
}

- (void)stopLoading {
  [_tab stop];
}

- (void)focusPage {
  if ([ArdiaCoreEarlyWindow veils:_tab]) return [ArdiaCoreEarlyWindow requestFocus:_tab];
  [_tab focus];
}

- (void)setMuted:(BOOL)muted {
  _muted = muted;
  if ([_tab respondsToSelector:@selector(setMuted:)]) _tab.muted = muted;
}

- (void)setZoomFactor:(double)factor {
  if ([_tab respondsToSelector:@selector(setZoomFactor:)]) _tab.zoomFactor = factor;
}

- (void)zoomStep:(NSInteger)direction {
  if ([_tab respondsToSelector:@selector(zoomStep:)]) [_tab zoomStep:(int)direction];
}

- (void)find:(NSString *)text forward:(BOOL)forward findNext:(BOOL)findNext {
  [_tab find:text forward:forward];
}

- (void)stopFinding:(BOOL)clearSelection {
  [_tab stopFinding];
}

- (void)print {
  [self runChromeCommand:35003];
}

- (void)runChromeCommand:(int)command {
  if ([_tab respondsToSelector:@selector(executeChromeCommand:)]) [_tab executeChromeCommand:command];
}

- (void)showDevTools {
  [_tab showDevTools];
}

- (void)showDevToolsPanel:(NSString *)panel {
  const int command = [panel isEqualToString:@"console"]   ? 40005
                      : [panel isEqualToString:@"inspect"] ? 40023
                      : [panel isEqualToString:@"toggle"]  ? 40237
                                                           : 0;
  if (command && [_tab respondsToSelector:@selector(executeChromeCommand:)]) [self runChromeCommand:command];
  else [_tab showDevTools];
}

- (void)runPageCommand:(NSString *)name {
  const int command = [name isEqualToString:@"savePage"]        ? 35004
                      : [name isEqualToString:@"systemPrint"]   ? 35007
                      : [name isEqualToString:@"caretBrowsing"] ? 40260
                                                                : 0;
  if (command) [self runChromeCommand:command];
}

- (void)executeJavaScript:(NSString *)code {
  if ([_tab respondsToSelector:@selector(executeJavaScript:)]) [_tab executeJavaScript:code];
}

- (void)thawHiddenPage {
  if (!_visible && !_frozen && [_tab respondsToSelector:@selector(setFrozen:)]) _tab.frozen = NO;
}

- (void)evaluate:(NSString *)code completion:(void (^)(NSString *))completion {
  if (![_tab respondsToSelector:@selector(evaluate:completion:)]) return completion(nil);
  [self thawHiddenPage];
  [_tab evaluate:code completion:completion];
}

- (void)capturePicture:(double)scale completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  NSWindow *window = self.window;
  if (!_tab || !window || self.hidden || ![_tab respondsToSelector:@selector(devToolsCall:params:completion:)]) return completion(nil);
  NSRect inWindow = [self convertRect:self.bounds toView:nil];
  CGFloat top = NSHeight(window.contentView.frame);
  NSArray *frame = @[ @(NSMinX(inWindow)), @(top - NSMaxY(inWindow)), @(NSWidth(inWindow)), @(NSHeight(inWindow)) ];
  __block BOOL answered = NO;
  void (^answer)(NSDictionary *) = ^(NSDictionary *result) {
    if (answered) return;
    answered = YES;
    completion(result);
  };
  NSDictionary *params = @{@"format" : @"jpeg", @"quality" : @(scale < 0.5 ? 55 : 75), @"optimizeForSpeed" : @YES};
  void (^done)(NSDictionary *, NSString *) = ^(NSDictionary *shot, NSString *error) {
    NSString *data = shot[@"data"];
    answer([data isKindOfClass:NSString.class] ? @{@"data" : data, @"frame" : frame} : nil);
  };
  SEL timed = NSSelectorFromString(@"devToolsCall:params:timeout:completion:");
  if ([_tab respondsToSelector:timed])
    ((void (*)(id, SEL, NSString *, NSDictionary *, NSTimeInterval, id))objc_msgSend)(_tab, timed, @"Page.captureScreenshot", params, 1.0, done);
  else
    [_tab devToolsCall:@"Page.captureScreenshot" params:params completion:done];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{ answer(nil); });
}

- (void)navigationEntries:(void (^)(NSArray<NSDictionary<NSString *, id> *> *))completion {
  completion([_tab respondsToSelector:@selector(navigationEntries)] ? _tab.navigationEntries : @[]);
}

- (void)downloadFavicon:(NSString *)url name:(NSString *)name completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  [ArdiaCoreFavicons fetch:url profile:_profile name:name completion:completion];
}

- (void)downloadImage:(NSString *)url maxPixels:(NSInteger)maxPixels completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  [ArdiaCoreFavicons fetch:url profile:_profile name:nil completion:completion];
}

- (void)mediaCommand:(NSString *)action seconds:(double)seconds {
  [self thawHiddenPage];
  [self callFrame:_nowPlayingFrame ?: @"" kind:@"media" json:JSONString(@{@"action" : action ?: @"", @"seconds" : @(seconds)})];
}

- (void)requestPictureInPicture:(void (^)(BOOL))completion {
  if (![_tab respondsToSelector:@selector(evaluate:completion:)]) return completion(NO);
  [self evaluateWithGesture:@"(async () => {"
                  "  const videos = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 && !v.disablePictureInPicture);"
                  "  videos.sort((a, b) => (b.paused ? 0 : 1) - (a.paused ? 0 : 1) || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);"
                  "  if (!videos.length) return post('result', 'false');"
                  "  if (document.pictureInPictureElement === videos[0]) return post('result', 'true');"
                  "  try { await videos[0].requestPictureInPicture(); post('result', 'true'); } catch (e) { post('result', 'false'); }"
                  "})()"
      completion:^(NSString *json) { completion([json isEqualToString:@"true"]); }];
}

- (void)evaluateWithGesture:(NSString *)code completion:(void (^)(NSString *))completion {
  [self thawHiddenPage];
  if ([_tab respondsToSelector:@selector(evaluate:userGesture:completion:)]) return [_tab evaluate:code userGesture:YES completion:completion];
  [_tab evaluate:code completion:completion];
}

- (void)updateAutoPictureInPicture {
  if (!_tab) return;
  NSDictionary *np = _nowPlaying[_nowPlayingFrame ?: @""];
  const BOOL playingVideo = [np[@"hasVideo"] boolValue] && [np[@"playbackState"] isEqual:@"playing"];
  const BOOL handles = [np[@"actions"] isKindOfClass:NSArray.class] && [np[@"actions"] containsObject:@"enterpictureinpicture"];
  const BOOL wantsDocument = handles && (_capturing || [np[@"playbackState"] isEqual:@"playing"]);
  if (!_seenByUser && _autoPictureInPicture && wantsDocument) {
    __weak ArdiaCoreWebView *weakSelf = self;
    ArdiaCoreTab *tab = _tab;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 450 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      ArdiaCoreWebView *view = weakSelf;
      if (!view || view->_seenByUser || view->_tab != tab || !view->_autoPictureInPicture) return;
      if ([tab respondsToSelector:@selector(autoPictureInPictureIsChromes)] && tab.autoPictureInPictureIsChromes) {
        [view traceAutoPictureInPicture:@"app: auto PiP left to Chrome"];
        return;
      }
      [view traceAutoPictureInPicture:@"app: auto PiP by the app (the page's handler)"];
      view->_autoPictureInPictureActive = YES;
      [view evaluateWithGesture:@"post('result', '0')" completion:^(NSString *) {
        ArdiaCoreWebView *now = weakSelf;
        if (now && !now->_seenByUser && now->_autoPictureInPictureActive) [now mediaCommand:@"enterpictureinpicture" seconds:0];
      }];
    });
  } else if (!_seenByUser && _autoPictureInPicture && playingVideo) {
    [self traceAutoPictureInPicture:@"app: auto PiP by the app (the video)"];
    _autoPictureInPictureActive = YES;
    __weak ArdiaCoreWebView *weakSelf = self;
    [self requestPictureInPicture:^(BOOL ok) {
      ArdiaCoreWebView *view = weakSelf;
      if (ok && view && view->_seenByUser) [view exitPictureInPicture];
    }];
  } else if (_seenByUser && (_autoPictureInPictureActive || _inPictureInPicture)) {
    _autoPictureInPictureActive = NO;
    [self exitPictureInPicture];
  }
}

- (void)exitPictureInPictureInFrame:(NSString *)frameId {
  if (frameId.length && [_tab respondsToSelector:@selector(executeJavaScript:frame:)])
    [_tab executeJavaScript:@"document.pictureInPictureElement && document.exitPictureInPicture()" frame:frameId];
  else
    [self exitPictureInPicture];
}

- (void)exitPictureInPicture {
  [self executeJavaScript:@"document.pictureInPictureElement && document.exitPictureInPicture();"
                           "window.documentPictureInPicture && documentPictureInPicture.window && documentPictureInPicture.window.close()"];
}

- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *))completion {
  if ([_tab respondsToSelector:@selector(securityInfo)] && _tab.securityInfo) return completion(_tab.securityInfo);
  NSString *url = _tab.url ?: @"";
  NSString *scheme = [NSURL URLWithString:url].scheme.lowercaseString;
  NSString *level = [scheme isEqualToString:@"https"] ? @"secure" : [scheme isEqualToString:@"http"] ? @"insecure" : @"local";
  completion(@{@"level" : level, @"url" : url, @"origin" : NSNull.null});
}

- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always {
  if ([_tab respondsToSelector:@selector(openBlockedPopup:always:)]) [_tab openBlockedPopup:popupId always:always];
}

- (void)tab:(ArdiaCoreTab *)tab didBlockRequests:(int)count lastURL:(NSString *)url {
  if (tab != _tab) return;
  _blockedCount += count;
  _lastBlocked = url;
  if (_blockedEmitQueued) return;
  _blockedEmitQueued = YES;
  __weak ArdiaCoreWebView *weakSelf = self;
  const NSUInteger generation = _blockedGeneration;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 150 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    ArdiaCoreWebView *view = weakSelf;
    if (!view || view->_blockedGeneration != generation || !view->_tab) return;
    view->_blockedEmitQueued = NO;
    [view emit:@"contentBlocked" payload:@{@"count" : @(view->_blockedCount), @"url" : view->_lastBlocked ?: @""}];
  });
}

- (void)tab:(ArdiaCoreTab *)tab didBlockPopup:(NSDictionary<NSString *, NSString *> *)popup {
  [self emit:@"popupBlocked" payload:popup];
}

- (void)tab:(ArdiaCoreTab *)tab preferredSizeDidChange:(NSSize)size {
  [self emit:@"preferredSize" payload:@{@"width" : @(size.width), @"height" : @(size.height)}];
}

- (void)clearSiteData:(void (^)(NSDictionary<NSString *, id> *))completion {
  NSString *origin = OriginOf(_tab.url);
  if (!origin) return completion(@{@"cookies" : @NO, @"storage" : @NO});
  [ArdiaCoreServices clearSiteData:_profile origin:origin completion:completion];
}

- (void)resolvePasswordPrompt:(NSString *)action username:(NSString *)username password:(NSString *)password {
  [_tab resolvePasswordPrompt:action username:username password:password];
}

- (void)resolveAutofillPrompt:(NSInteger)promptId action:(NSString *)action {
  if ([_tab respondsToSelector:@selector(resolveAutofillPrompt:action:)]) [_tab resolveAutofillPrompt:promptId action:action];
}

- (NSString *)executeExtensionAction:(NSString *)extensionId {
  return [_tab respondsToSelector:@selector(executeExtensionAction:)] ? [_tab executeExtensionAction:extensionId] : nil;
}

- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(NSString *)sourceId {
  NSDictionary *request = requestId ? _displayRequests[requestId] : nil;
  if (!request) return;
  [_displayRequests removeObjectForKey:requestId];
  if (sourceId.length && _tab && [ArdiaCoreEngine respondsToSelector:@selector(allowDesktopCapture:tab:frame:origin:)])
    [ArdiaCoreEngine allowDesktopCapture:sourceId
                                  tab:_tab
                                frame:[request[@"frame"] length] ? request[@"frame"] : nil
                               origin:nil];
  [self callFrame:request[@"frame"] kind:@"displayMedia"
             json:JSONString(@{@"id" : request[@"id"], @"sourceId" : sourceId.length ? sourceId : NSNull.null})];
}

- (NSString *)mediaCaptureSourceId {
  return [_tab respondsToSelector:@selector(mediaCaptureSourceId)] ? _tab.mediaCaptureSourceId : nil;
}

- (void)tab:(ArdiaCoreTab *)tab navigationBecameDownload:(NSString *)url {
  ardiacore_host::NoteNavigationDownload(url, _profile);
  if (_requestedURL && ![_requestedURL isEqualToString:url]) ardiacore_host::NoteNavigationDownload(_requestedURL, _profile);
  _requestedURL = nil;
  [self emit:@"downloadNavigation" payload:@{@"url" : url ?: @"", @"committedUrl" : tab.url ?: @"", @"skipped" : @NO}];
}

- (NSArray<NSDictionary<NSString *, NSString *> *> *)tab:(ArdiaCoreTab *)tab
                           contextMenuItemsForSelection:(NSString *)text {
  return @[ @{
    @"id" : @"search",
    @"title" : [NSString stringWithFormat:@"Search %@ for “%@”", gSearchEngineName, SelectionLabel(text)],
    @"replaces" : @"search",
  } ];
}

- (void)tab:(ArdiaCoreTab *)tab
    contextMenuCommand:(NSString *)itemId
                  text:(NSString *)selection
             modifiers:(NSDictionary<NSString *, NSNumber *> *)modifiers {
  if ([itemId isEqualToString:@"search"])
    [self emit:@"command" payload:@{@"command" : @"search", @"text" : selection ?: @"", @"modifiers" : modifiers ?: @{}}];
}

- (void)tab:(ArdiaCoreTab *)tab didShowAutofillSuggestions:(NSArray<NSDictionary<NSString *, NSString *> *> *)items {
  NoteEvent(ardiacore_host::BrowserId(tab), @"autofillSuggestions", @{@"items" : items ?: @[]});
}

- (void)tab:(ArdiaCoreTab *)tab didShowContextMenu:(NSArray<NSDictionary *> *)items {
  [self tab:tab runContextMenu:@{@"items" : items ?: @[]}];
}

- (NSDictionary<NSString *, id> *)tab:(ArdiaCoreTab *)tab runContextMenu:(NSDictionary<NSString *, id> *)menu {
  NSArray *items = Field<NSArray>(menu, @"items") ?: @[];
  NoteEvent(ardiacore_host::BrowserId(tab), @"contextMenu", @{@"items" : items});
  static const char *log = getenv("ARDIA_CONTEXT_MENU_LOG");
  if (!log) {
    if (ardiacore_host::Background()) {
      NSMutableArray<NSString *> *titles = [NSMutableArray array];
      for (NSDictionary *item in items)
        if (MenuItemType(item) != kMenuSeparator && Field<NSString>(item, @"label").length) [titles addObject:MenuTitle(item[@"label"])];
      ardiacore_host::LogActivation([NSString stringWithFormat:@"context menu (not shown): %@", [titles componentsJoinedByString:@" | "]]);
    }
    return nil;
  }
  NSString *path = @(log), *pickPath = [path stringByAppendingString:@".pick"];
  NSDictionary *dump = @{
    @"url" : Field<NSString>(menu, @"url") ?: tab.url ?: @"",
    @"link" : Field<NSString>(menu, @"link") ?: @"",
    @"items" : DescribeMenu(items),
  };
  [JSONString(dump) writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];
  NSString *pick = [NSString stringWithContentsOfFile:pickPath encoding:NSUTF8StringEncoding error:nil];
  [NSFileManager.defaultManager removeItemAtPath:pickPath error:nil];
  pick = [pick stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSArray<NSString *> *parts = [pick componentsSeparatedByString:@"\t"];
  NSDictionary *found = pick.length ? FindMenuItem(items, parts[0]) : nil;
  if (!found) return nil;
  return @{@"command" : found[@"command"], @"path" : found[@"path"], @"flags" : @(parts.count > 1 ? parts[1].intValue : 0)};
}

- (void)tab:(ArdiaCoreTab *)tab didChangePictureInPicture:(NSDictionary<NSString *, id> *)state {
  if (![state[@"kind"] isEqual:@"document"]) return;
  _inPictureInPicture = [state[@"active"] boolValue];
  [self emit:@"pictureInPicture" payload:@{@"kind" : @"document", @"active" : @([state[@"active"] boolValue])}];
}

- (void)tab:(ArdiaCoreTab *)tab requestsActivation:(NSString *)reason {
  ardiacore_pip::TabRequestedActivation(self);
  [self emit:@"activateRequest" payload:@{@"reason" : reason ?: @"page"}];
}

- (void)notificationAction:(NSString *)notificationId action:(NSString *)action {
  NSString *frame = notificationId ? _notificationFrames[notificationId] : nil;
  if (!frame) return;
  if (![action isEqualToString:@"click"]) [_notificationFrames removeObjectForKey:notificationId];
  [self callFrame:frame kind:@"notification" json:JSONString(@{@"id" : notificationId, @"action" : action ?: @""})];
}

- (void)resolveUnresponsive:(BOOL)terminate {
  if ([_tab respondsToSelector:@selector(resolveUnresponsive:)]) [_tab resolveUnresponsive:terminate];
}

- (NSString *)discard:(BOOL)unload {
  if (unload) return @"unsupported";
  if (![_tab respondsToSelector:@selector(discard)]) return @"refused";
  if (_tab.discarded) return @"already";
  return [_tab discard] && _tab.discarded ? @"discarded" : @"refused";
}

- (BOOL)discarded {
  return [_tab respondsToSelector:@selector(discarded)] && _tab.discarded;
}

- (void)tabDidChangeDiscarded:(ArdiaCoreTab *)tab {
  if (tab.discarded) [self emit:@"discarded" payload:@{@"url" : tab.url ?: @""}];
  else [self emit:@"ready" payload:@{@"browserId" : @(ardiacore_host::BrowserId(tab)), @"tabId" : @(tab.tabId)}];
}

- (void)tabBecameUnresponsive:(ArdiaCoreTab *)tab {
  [self emit:@"unresponsive" payload:@{}];
}

- (void)tabBecameResponsive:(ArdiaCoreTab *)tab {
  [self emit:@"responsive" payload:@{}];
}

- (void)tab:(ArdiaCoreTab *)tab didChangeMediaAccess:(NSDictionary<NSString *, NSNumber *> *)access {
  _capturing = [access[@"camera"] boolValue] || [access[@"microphone"] boolValue] || [access[@"screen"] boolValue];
  [self emit:@"mediaAccess" payload:access ?: @{}];
}

- (void)tab:(ArdiaCoreTab *)tab externalAppRequest:(NSDictionary<NSString *, id> *)request {
  [self emit:@"externalApp" payload:request ?: @{}];
}

namespace {

int gDevTrackpad = -1;
NSUInteger gZoomScrolls = 0;
constexpr NSTimeInterval kSwitchPrewarmGapSeconds = 0.1;

bool SwitchPrewarmOff() {
  const char *value = getenv("ARDIA_SWITCH_PREWARM");
  return value && (!strcmp(value, "off") || !strcmp(value, "0") || !strcmp(value, "false"));
}
NSString *gDevZoomMiss = nil;
bool gGestureTrackpad = false;

BOOL FromTrackpad(NSEvent *event) {
  if (gDevTrackpad >= 0) return gDevTrackpad;
  static auto copyHIDEvent = (CFTypeRef (*)(CGEventRef))dlsym(RTLD_DEFAULT, "CGEventCopyIOHIDEvent");
  static auto senderOf = (uint64_t (*)(CFTypeRef))dlsym(RTLD_DEFAULT, "IOHIDEventGetSenderID");
  CGEventRef cg = event.CGEvent;
  CFTypeRef hid = copyHIDEvent && senderOf && cg ? copyHIDEvent(cg) : nullptr;
  if (!hid) return NO;
  uint64_t sender = senderOf(hid);
  CFRelease(hid);
  if (!sender) return NO;
  static NSMutableDictionary<NSNumber *, NSNumber *> *trackpads = [NSMutableDictionary dictionary];
  if (NSNumber *known = trackpads[@(sender)]) return known.boolValue;
  BOOL trackpad = NO;
  io_registry_entry_t entry = IOServiceGetMatchingService(kIOMainPortDefault, IORegistryEntryIDMatching(sender));
  for (int depth = 0; entry && depth < 4; depth++) {
    io_name_t name;
    if (IOObjectGetClass(entry, name) == KERN_SUCCESS) {
      if (strstr(name, "Trackpad")) trackpad = YES;
      if (trackpad || strstr(name, "EventDriver")) break;
    }
    io_registry_entry_t parent = 0;
    if (IORegistryEntryGetParentEntry(entry, kIOServicePlane, &parent) != KERN_SUCCESS) parent = 0;
    IOObjectRelease(entry);
    entry = parent;
  }
  if (entry) IOObjectRelease(entry);
  trackpads[@(sender)] = @(trackpad);
  return trackpad;
}

bool CommandScrollZooms(NSEvent *event, bool trackpad) {
  if (event.phase & (NSEventPhaseBegan | NSEventPhaseMayBegin)) gGestureTrackpad = trackpad;
  else if (event.phase == NSEventPhaseNone && event.momentumPhase == NSEventPhaseNone) gGestureTrackpad = false;
  else gGestureTrackpad = gGestureTrackpad || trackpad;
  return (event.modifierFlags & NSEventModifierFlagCommand) && !gGestureTrackpad;
}

}

- (BOOL)canWakeFrames {
  if (!_tab || !_visible || _frozen || _tab.closed || _tab.discarded || self.isHiddenOrHasHiddenAncestor) return NO;
  NSString *url = _tab.url;
  return [url hasPrefix:@"https:"] || [url hasPrefix:@"http:"] || [url hasPrefix:@"file:"];
}

+ (BOOL)prewarmForMouseEvent:(NSEvent *)event {
  static NSMapTable<id, NSNumber *> *lastByDisplay = [NSMapTable weakToStrongObjectsMapTable];
  NSWindow *window = event.window;
  if (!window) return NO;
  id display = window.screen ?: NSNull.null;
  if (event.timestamp - [lastByDisplay objectForKey:display].doubleValue < kSwitchPrewarmGapSeconds) return NO;
  const NSPoint point = event.locationInWindow;
  ArdiaCoreWebView *target = nil;
  for (ArdiaCoreWebView *view in LiveViews()) {
    if (view.window != window || view.isHiddenOrHasHiddenAncestor) continue;
    if (NSPointInRect(point, [view convertRect:view.bounds toView:nil])) return NO;
    if (!target && view.canWakeFrames) target = view;
  }
  if (target) {
    [target callFrame:@"" kind:@"wakeFrames" json:@"{}"];
    [lastByDisplay setObject:@(event.timestamp) forKey:display];
    return YES;
  }
  return NO;
}

+ (void)installSwitchPrewarm {
  static id monitor;
  if (monitor || SwitchPrewarmOff()) return;
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp handler:^NSEvent *(NSEvent *event) {
    [ArdiaCoreWebView prewarmForMouseEvent:event];
    return event;
  }];
}

+ (void)installScrollZoom {
  static id monitor, touchMonitor;
  if (monitor) return;
  static double accumulated = 0;
  static NSUInteger touching = 0;
  static NSTimeInterval touchedAt = 0;
  touchMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskGesture handler:^NSEvent *(NSEvent *event) {
    touching = [event touchesMatchingPhase:NSTouchPhaseTouching inView:nil].count;
    touchedAt = event.timestamp;
    return event;
  }];
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    BOOL fingers = (event.phase & (NSEventPhaseBegan | NSEventPhaseMayBegin)) && touching >= 2 && event.timestamp - touchedAt < 0.5;
    BOOL trackpad = event.phase != NSEventPhaseNone && (fingers || FromTrackpad(event));
    if (gDevTrackpad >= 0) gDevZoomMiss = @"not a zoom (a trackpad gesture, or no ⌘)";
    if (!CommandScrollZooms(event, trackpad)) return event;
    NSWindow *window = event.window;
    NSPoint point = event.locationInWindow;
    if (!window) {
      NSPoint screen = event.locationInWindow;
      for (NSWindow *w in NSApp.orderedWindows)
        if (w.isVisible && !w.ignoresMouseEvents && NSPointInRect(screen, w.frame)) {
          window = w;
          break;
        }
      point = [window convertPointFromScreen:screen];
    }
    NSView *content = window.contentView;
    NSView *hit = content ? [content hitTest:[content.superview convertPoint:point fromView:nil]] : nil;
    while (hit && ![hit isKindOfClass:ArdiaCoreWebView.class]) hit = hit.superview;
    ArdiaCoreWebView *view = (ArdiaCoreWebView *)hit;
    if (gDevTrackpad >= 0 && (!view || !view->_tab))
      gDevZoomMiss = [NSString stringWithFormat:@"not over a page: window %ld %@, hit %@", (long)window.windowNumber,
                                                NSStringFromPoint(point), [content hitTest:[content.superview convertPoint:point fromView:nil]]];
    if (!view || !view->_tab) return event;
    if (event.phase == NSEventPhaseBegan) accumulated = 0;
    accumulated += event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 30;
    gZoomScrolls++;
    if (fabs(accumulated) >= 30) {
      [view zoomStep:accumulated > 0 ? 1 : -1];
      accumulated = 0;
    }
    return nil;
  }];
}

+ (NSArray<NSNumber *> *)devScrollZoom:(NSArray<NSDictionary<NSString *, id> *> *)steps browser:(int)browserId {
  ArdiaCoreWebView *view = nil;
  for (ArdiaCoreWebView *v in LiveViews())
    if (v.window.isVisible && !v.isHiddenOrHasHiddenAncestor && v->_tab && v->_visible &&
        (!browserId || ardiacore_host::BrowserId(v->_tab) == browserId))
      view = v;
  if (!view) return @[];
  NSWindow *window = view.window;
  const NSRect b = view.bounds;
  NSView *content = window.contentView;
  NSPoint inWindow = [view convertPoint:NSMakePoint(NSMidX(b), NSMidY(b)) toView:nil];
  BOOL uncovered = NO;
  for (int i = 1; i < 8; i++)
    for (int j = 1; j < 8; j++) {
      const NSPoint candidate = [view convertPoint:NSMakePoint(NSMinX(b) + NSWidth(b) * j / 8, NSMinY(b) + NSHeight(b) * i / 8) toView:nil];
      NSView *hit = [content hitTest:[content.superview convertPoint:candidate fromView:nil]];
      while (hit && hit != view) hit = hit.superview;
      if (hit) {
        inWindow = candidate;
        uncovered = YES;
        i = j = 8;
      }
    }
  if (!uncovered)
    NSLog(@"[scroll-zoom] the page is covered everywhere: %@ over its centre",
          [content hitTest:[content.superview convertPoint:inWindow fromView:nil]]);
  NSPoint screen = [window convertPointToScreen:inWindow];
  static auto setWindowLocation = (void (*)(CGEventRef, CGPoint))dlsym(RTLD_DEFAULT, "CGEventSetWindowLocation");
  NSMutableArray *zoomed = [NSMutableArray array];
  for (NSDictionary *step in steps) {
    NSString *phase = step[@"phase"];
    BOOL wheel = [phase isEqualToString:@"wheel"];
    int32_t dy = (int32_t)[step[@"dy"] intValue];
    CGEventRef cg = CGEventCreateScrollWheelEvent2(NULL, wheel ? kCGScrollEventUnitLine : kCGScrollEventUnitPixel, 1, dy, 0, 0);
    CGEventSetFlags(cg, kCGEventFlagMaskCommand);
    CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, !wheel);
    if (!wheel) CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis1, dy);
    if ([phase isEqualToString:@"momentum"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, kCGMomentumScrollPhaseContinue);
    else if (!wheel)
      CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase,
                                  [phase isEqualToString:@"mayBegin"] ? kCGScrollPhaseMayBegin
                                  : [phase isEqualToString:@"began"]  ? kCGScrollPhaseBegan
                                  : [phase isEqualToString:@"ended"]  ? kCGScrollPhaseEnded
                                                                      : kCGScrollPhaseChanged);
    CGEventSetLocation(cg, CGPointMake(screen.x, NSHeight(NSScreen.screens.firstObject.frame) - screen.y));
    CGEventSetIntegerValueField(cg, (CGEventField)51, window.windowNumber);
    if (setWindowLocation) setWindowLocation(cg, CGPointMake(inWindow.x, NSHeight(window.frame) - inWindow.y));
    NSEvent *event = [NSEvent eventWithCGEvent:cg];
    CFRelease(cg);
    gDevTrackpad = [step[@"trackpad"] boolValue];
    NSUInteger before = gZoomScrolls;
    gDevZoomMiss = nil;
    [NSApp sendEvent:event];
    gDevTrackpad = -1;
    [zoomed addObject:@(gZoomScrolls > before)];
    if (wheel && gZoomScrolls == before)
      NSLog(@"[scroll-zoom] a ⌘-wheel step didn't zoom: %@", gDevZoomMiss ?: @"the zoom monitor never saw it");
  }
  return zoomed;
}

@end

namespace {

NSMapTable<ArdiaCoreTab *, ArdiaCoreWebView *> *Views() {
  static NSMapTable *views = [NSMapTable weakToWeakObjectsMapTable];
  return views;
}

NSMutableDictionary<NSString *, ArdiaCoreTab *> *Offered() {
  static NSMutableDictionary *offered = [NSMutableDictionary dictionary];
  return offered;
}

constexpr int64_t kOfferSeconds = 30;

}

@implementation ArdiaCoreTabs

+ (void)setView:(ArdiaCoreWebView *)view forTab:(ArdiaCoreTab *)tab {
  if (view) [Views() setObject:view forKey:tab];
  else [Views() removeObjectForKey:tab];
}

+ (ArdiaCoreWebView *)viewForTab:(ArdiaCoreTab *)tab {
  return [Views() objectForKey:tab];
}

+ (NSString *)offerTab:(ArdiaCoreTab *)tab {
  return [self offerTab:tab prefix:@"ardiacore"];
}

+ (NSString *)offerTab:(ArdiaCoreTab *)tab prefix:(NSString *)prefix {
  NSString *adoptId = [NSString stringWithFormat:@"%@:%d", prefix, ardiacore_host::BrowserId(tab)];
  Offered()[adoptId] = tab;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kOfferSeconds * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (Offered()[adoptId] != tab) return;
    [Offered() removeObjectForKey:adoptId];
    if (![ArdiaCoreTabs viewForTab:tab]) [tab close];
  });
  return adoptId;
}

+ (ArdiaCoreTab *)offeredTab:(NSString *)adoptId {
  return adoptId.length ? Offered()[adoptId] : nil;
}

+ (ArdiaCoreTab *)takeOffered:(NSString *)adoptId {
  ArdiaCoreTab *tab = Offered()[adoptId];
  if (tab) [Offered() removeObjectForKey:adoptId];
  return tab;
}

+ (void)forget:(ArdiaCoreTab *)tab {
  [Views() removeObjectForKey:tab];
  for (NSString *key in [Offered() allKeysForObject:tab]) [Offered() removeObjectForKey:key];
}

@end

namespace ardiacore_host {

bool EngineHasTabModel() {
  static const bool has = [ArdiaCoreWindow instancesRespondToSelector:@selector(adoptTab:)];
  return has;
}

namespace {
const void *kBrowserIdKey = &kBrowserIdKey;
NSMapTable<NSNumber *, ArdiaCoreTab *> *TabsById() {
  static NSMapTable *tabs = [NSMapTable strongToWeakObjectsMapTable];
  return tabs;
}
}

int BrowserId(ArdiaCoreTab *tab) {
  static int next = 0;
  NSNumber *id_ = objc_getAssociatedObject(tab, kBrowserIdKey);
  if (!id_) {
    id_ = @(++next);
    objc_setAssociatedObject(tab, kBrowserIdKey, id_, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [TabsById() setObject:tab forKey:id_];
  }
  return id_.intValue;
}

ArdiaCoreTab *TabWithBrowserId(int browserId) {
  return [TabsById() objectForKey:@(browserId)];
}

}
