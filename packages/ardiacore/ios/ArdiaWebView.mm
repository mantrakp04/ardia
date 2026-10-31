#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"
#import "ArdiaLaunchConfig.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaFieldTiming.h"
#import "ArdiaTabParking.h"

#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

#include <cmath>

using namespace ardia_web_view;
using namespace ardia_runtime;

namespace {

NSMutableDictionary<NSNumber *, NSMutableArray *> *RecentEvents() {
  static NSMutableDictionary *events = [NSMutableDictionary dictionary];
  return events;
}

const char kDropTypesKey = 0;
}

namespace ardia_web_view {

bool TraceVisibility() {
  static const bool on = [ArdiaLaunchConfig.shared traced:@"visibility"];
  return on;
}

NSHashTable<ArdiaWebView *> *LiveViews() {
  static NSHashTable *views = [NSHashTable weakObjectsHashTable];
  return views;
}

bool SamePage(NSString *a, NSString *b) {
  auto strip = [](NSString *url) {
    NSRange hash = [url rangeOfString:@"#"];
    return hash.location == NSNotFound ? url : [url substringToIndex:hash.location];
  };
  return a && b && [strip(a) isEqualToString:strip(b)];
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
  NSString *origin = [ArdiaCoreTab originForURL:url ?: @""];
  return origin.length ? origin : nil;
}

NSString *VerifiedOrigin(NSString *origin) { return origin.length && ![origin isEqualToString:@"null"] ? origin : nil; }

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

@implementation ArdiaWebView

+ (void)initialize {
  if (self != ArdiaWebView.class) return;
  [NSNotificationCenter.defaultCenter addObserverForName:@"RCTBridgeWillReloadNotification"
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                void (^park)(void) = ^{
                                                  NSMapTable<NSString *, ArdiaWebView *> *views = [NSMapTable strongToWeakObjectsMapTable];
                                                  NSMutableDictionary<NSString *, ArdiaCoreTab *> *handed = [NSMutableDictionary dictionary];
                                                  for (ArdiaWebView *view in LiveViews().allObjects) {
                                                    if (!view->_tab || view->_tab.closed || !view->_transferKey.length) continue;
                                                    view->_life.handingOff = YES;
                                                    [views setObject:view forKey:view->_transferKey];
                                                    handed[view->_transferKey] = view->_tab;
                                                  }
                                                  [ArdiaTabParking holdAcrossReload:handed
                                                                                expired:^(NSString *key, ArdiaCoreTab *tab) {
                                                                                  if (ArdiaWebView *view = [views objectForKey:key]; view && view->_tab == tab)
                                                                                    view->_life.handingOff = NO;
                                                                                }];
                                                };
                                                if (NSThread.isMainThread) park();
                                                else dispatch_async(dispatch_get_main_queue(), park);
                                              }];
}

- (instancetype)initWithFrame:(NSRect)frameRect {
  if ((self = [super initWithFrame:frameRect])) {
    _profile = @"";
    _visible = YES;
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
  return _tab ? ardia_host::BrowserId(_tab) : 0;
}

- (ArdiaWindowController *)controller {
  return [ArdiaWindowController forNSWindow:self.window];
}

- (void)viewWillMoveToWindow:(NSWindow *)newWindow {
  if (!newWindow) [self lendPageToSuccessor];
  [super viewWillMoveToWindow:newWindow];
}

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (TraceVisibility()) NSLog(@"[ardiacore-vis] %@ window=%ld tab=%d", _transferKey, (long)self.window.windowNumber, _tab ? (int)_tab.tabId : -1);
  if (_sightObserver) [NSNotificationCenter.defaultCenter removeObserver:_sightObserver];
  _sightObserver = nil;
  if (!self.window) return;
  if (_visible) [ArdiaEarlyWindow noteLayoutChangeIn:self.window];
  __weak ArdiaWebView *weakSelf = self;
  _sightObserver = [NSNotificationCenter.defaultCenter addObserverForName:ArdiaWindowSeenDidChange object:self.window queue:nil
                                                               usingBlock:^(NSNotification *) { [weakSelf userSightChanged]; }];
  [self userSightChanged];
  if (_tab) [self reclaimLentPage];
  if (_tab) [self adoptIntoWindow];
  else [self ensureTab];
}

- (void)setSidebarProfile:(NSString *)sidebarProfile {
  NSString *next = [sidebarProfile copy] ?: @"";
  if ([next isEqualToString:_sidebarProfile ?: @""]) return;
  _sidebarProfile = next;
  [self pushLinkRoutes];
}

- (void)setExtensionHost:(NSString *)extensionHost {
  _extensionHost = [extensionHost copy];
  if (_extensionHost.length) _standalone = YES;
}

- (void)setAdoptId:(NSString *)adoptId {
  _adoptId = [adoptId copy];
  if (self.window) [self ensureTab];
}

- (void)setNeighbour:(BOOL)neighbour {
  if (_neighbour == neighbour) return;
  _neighbour = neighbour;
  [self schedulePainting];
}

- (void)setWarm:(BOOL)warm {
  if (_warm == warm) return;
  _warm = warm;
  [self schedulePainting];
}

- (void)setTemporary:(BOOL)temporary {
  _temporary = temporary;
  [self markTemporary];
}

- (void)setTemporarySource:(NSString *)temporarySource {
  _temporarySource = [temporarySource copy];
  [self markTemporary];
}

- (void)setVisible:(BOOL)visible {
  if (_visible == visible) return;
  if (!visible) [self storePageFocus];
  _visible = visible;
  if (visible) [self stopHolding];
  if (visible) [self settleRevealsInWindow];
  if (!visible) [_tab exitExclusiveAccess];
  if (visible && !_frameHold.awaiting && self.alphaValue < 1 && _tab.view.superview == self && !_tab.view.hidden) {
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    self.alphaValue = 1;
    [CATransaction commit];
  }
  [self schedulePainting];
  if (visible) ArdiaFieldMarkAtCommit(_transferKey, @"view");
  if (visible) [ArdiaEarlyWindow noteLayoutChangeIn:self.window];
  [self userSightChanged];
}

- (void)setFrozen:(BOOL)frozen {
  _frozen = frozen;
  _tab.frozen = frozen;
}

- (void)setPageBackgroundColor:(NSColor *)color {
  _pageBackgroundColor = color;
  _tab.pageBackgroundColor = color;
}

- (void)setContentsBackgroundColor:(NSColor *)color {
  _contentsBackgroundColor = color;
  _tab.contentsBackgroundColor = color;
}

- (void)setPageColor:(NSString *)color {
  _pageColor = [color copy];
  _tab.pageColor = color;
}

- (void)setShownURL:(NSString *)shownURL {
  _shownURL = [shownURL copy];
  [ArdiaEarlyWindow page:_tab shownURL:_shownURL];
}

- (BOOL)discarded {
  return _tab.discarded;
}

- (NSString *)mediaCaptureSourceId {
  return _tab.mediaCaptureSourceId;
}

- (void)emit:(NSString *)name payload:(NSDictionary *)payload {
  if (_sent.navigationQueued && ![name isEqualToString:@"navigation"]) [self emitNavigation];
  if (_tab) NoteEvent(ardia_host::BrowserId(_tab), name, payload);
  [self.delegate webView:self event:name payload:payload];
}

void ArdiaWebViewsSetFieldTiming(BOOL on) {
  for (ArdiaWebView *view in LiveViews().allObjects)
    if (view->_tab) [view callFrame:@"" kind:@"fieldTiming" json:on ? @"{\"on\":true}" : @"{\"on\":false}"];
}

+ (NSArray<NSDictionary<NSString *, id> *> *)devEventsForBrowser:(int)browserId {
  return RecentEvents()[@(browserId)] ?: @[];
}

+ (int)browserIdOfTab:(NSString *)tabId {
  ArdiaCoreTab *tab = ardia_host::TabWithAppTabId(tabId);
  return tab ? ardia_host::BrowserId(tab) : 0;
}

+ (NSInteger)devWindowNumberForBrowser:(int)browserId {
  ArdiaCoreTab *tab = ardia_host::TabWithBrowserId(browserId);
  ArdiaWebView *view = tab ? [ArdiaTabRegistry viewForTab:tab] : nil;
  return view.window.windowNumber;
}

+ (ArdiaWebView *)devViewOf:(NSString *)transferKey {
  for (ArdiaWebView *view in LiveViews().allObjects)
    if ([view->_transferKey isEqualToString:transferKey]) return view;
  return nil;
}

+ (NSString *)devPagePhaseOf:(NSString *)transferKey {
  ArdiaWebView *view = [self devViewOf:transferKey];
  if (!view) return nil;
  switch (view->_life.phase) {
    case ArdiaTabPhase::Waiting: return @"waiting";
    case ArdiaTabPhase::Creating: return @"creating";
    case ArdiaTabPhase::Attached: return @"attached";
    case ArdiaTabPhase::Closing: return @"closing";
  }
}

+ (BOOL)devClosePageOf:(NSString *)transferKey {
  ArdiaWebView *view = [self devViewOf:transferKey];
  [view closeBrowser];
  return view != nil;
}

+ (BOOL)devFocusPageOfBrowser:(int)browserId {
#if DEBUG
  ArdiaCoreTab *tab = ardia_host::TabWithBrowserId(browserId);
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

@end
