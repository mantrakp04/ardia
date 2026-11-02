#import "ArdiaChromeWindowInternal.h"
#import "ArdiaLaunchConfig.h"
#import "ArdiaWebView.h"

#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

#include <cmath>

using namespace ardia_window;

namespace ardia_window {

const void *kActedFullScreenKey = &kActedFullScreenKey;

const void *kWindowFullScreenKey = &kWindowFullScreenKey;

BOOL IsWindowFullScreen(NSWindow *window) {
  return window && ((window.styleMask & NSWindowStyleMaskFullScreen) || objc_getAssociatedObject(window, kActedFullScreenKey));
}

}

namespace {

const void *kActingKey = &kActingKey;

const void *kActedOcclusionKey = &kActedOcclusionKey;

}

namespace ardia_window {

void ActOcclusion(NSWindow *window, NSNumber *visible) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Method m = class_getInstanceMethod(NSWindow.class, @selector(occlusionState));
    auto original = (NSWindowOcclusionState(*)(id, SEL))method_getImplementation(m);
    method_setImplementation(m, imp_implementationWithBlock(^NSWindowOcclusionState(NSWindow *w) {
      NSNumber *acted = objc_getAssociatedObject(w, kActedOcclusionKey);
      return acted ? (acted.boolValue ? NSWindowOcclusionStateVisible : 0) : original(w, @selector(occlusionState));
    }));
  });
  objc_setAssociatedObject(window, kActedOcclusionKey, visible, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  if ([ArdiaLaunchConfig.shared traced:@"visibility"]) NSLog(@"[ardiacore-vis] window %ld acted occlusion %@", (long)window.windowNumber, visible ?: @"off");
  [NSNotificationCenter.defaultCenter postNotificationName:NSWindowDidChangeOcclusionStateNotification object:window];
}

NSTimeInterval gActedOcclusionGap = NAN;

}

namespace {

const void *kActedOcclusionTurnKey = &kActedOcclusionTurnKey;

const void *kActedRestoreFrameKey = &kActedRestoreFrameKey;

}

namespace ardia_window {

void ActWindowFullScreen(ArdiaCoreWindow *coreWindow, BOOL enter, NSTimeInterval seconds) {
  NSWindow *window = coreWindow.window;
  if (!window || objc_getAssociatedObject(window, kActingKey)) return;
  __weak NSWindow *weakWindow = window;
  __weak ArdiaCoreWindow *weakCore = coreWindow;
  void (^set)(BOOL) = ^(BOOL on) {
    if (NSWindow *w = weakWindow) objc_setAssociatedObject(w, kActedFullScreenKey, on ? @YES : nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    ArdiaCoreWindow *c = weakCore;
    c.actedFullScreen = on;
  };
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  const BOOL trace = [ArdiaLaunchConfig.shared traced:@"visibility"];
  if (trace) NSLog(@"[ardiacore-vis] window %ld acted %@", (long)window.windowNumber, enter ? @"willEnterFullScreen" : @"willExitFullScreen");
  [center postNotificationName:enter ? NSWindowWillEnterFullScreenNotification : NSWindowWillExitFullScreenNotification object:window];
  if (enter) set(YES);
  if (enter) {
    objc_setAssociatedObject(window, kActedRestoreFrameKey, [NSValue valueWithRect:window.frame], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (NSScreen *screen = window.screen ?: NSScreen.mainScreen) [window setFrame:screen.frame display:YES];
  } else if (NSValue *restore = objc_getAssociatedObject(window, kActedRestoreFrameKey)) {
    objc_setAssociatedObject(window, kActedRestoreFrameKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [window setFrame:restore.rectValue display:YES];
  }
  objc_setAssociatedObject(window, kActingKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  const NSTimeInterval gap = gActedOcclusionGap;
  if (!isnan(gap)) {
    NSObject *turn = [NSObject new];
    objc_setAssociatedObject(window, kActedOcclusionTurnKey, turn, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    ActOcclusion(window, @NO);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(MAX(0, seconds + gap) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      NSWindow *w = weakWindow;
      if (w && objc_getAssociatedObject(w, kActedOcclusionTurnKey) == turn) ActOcclusion(w, @YES);
    });
  }
  void (^finish)(void) = ^{
    NSWindow *w = weakWindow;
    if (!w) return;
    objc_setAssociatedObject(w, kActingKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (!enter) set(NO);
    if (trace) NSLog(@"[ardiacore-vis] window %ld acted %@", (long)w.windowNumber, enter ? @"didEnterFullScreen" : @"didExitFullScreen");
    [center postNotificationName:enter ? NSWindowDidEnterFullScreenNotification : NSWindowDidExitFullScreenNotification object:w];
  };
  if (seconds > 0) dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), finish);
  else finish();
}

NSTimeInterval gActedTransition = [ArdiaLaunchConfig.shared testValue:@"fakeFullScreenMs"].doubleValue / 1000;

}

namespace {

void ToggleWindowFullScreen(ArdiaCoreWindow *coreWindow) {
  NSWindow *window = coreWindow.window;
  if (!ardia_host::Background()) return [window toggleFullScreen:nil];
  const BOOL enter = !IsWindowFullScreen(window);
  ardia_host::LogActivation(enter ? @"toggleFullScreen: (page full screen; acted out)" : @"toggleFullScreen: (page left full screen; acted out)");
  ActWindowFullScreen(coreWindow, enter, gActedTransition);
}
}

NSNotificationName const ArdiaWindowSeenDidChange = @"ArdiaWindowSeenDidChange";

namespace ardia_window {

NSMapTable<ArdiaCoreTab *, NSNumber *> *FullScreenChanges() {
  static NSMapTable *changes = [NSMapTable weakToStrongObjectsMapTable];
  return changes;
}
}

@implementation ArdiaWindowFullScreen {
  __weak ArdiaCoreWindow *_coreWindow;
  __weak ArdiaCoreTab *_tab;
  BOOL _entered;
  NSInteger _asked;
  BOOL _transitioning;
  BOOL _ours;
  BOOL _settling;
  BOOL _seen;
  BOOL _closed;
  NSArray *_observers;
  __weak ArdiaCoreTab *_leftTab;
  NSInteger _waitingFor;
  NSUInteger _wait;
  BOOL _askedWait;
  BOOL _drew;
  NSInteger _telling;
  NSArray<ArdiaPageCover *> *_covers;
  __weak ArdiaCoreTab *_lastTab;
  NSUInteger _coverTurn;
  BOOL _picturing;
}

+ (instancetype)ofWindow:(ArdiaCoreWindow *)coreWindow create:(BOOL)create {
  NSWindow *window = coreWindow.window;
  if (!window) return nil;
  ArdiaWindowFullScreen *state = objc_getAssociatedObject(window, kWindowFullScreenKey);
  if (state || !create) return state;
  state = [[ArdiaWindowFullScreen alloc] initWithCoreWindow:coreWindow];
  objc_setAssociatedObject(window, kWindowFullScreenKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  return state;
}

- (instancetype)initWithCoreWindow:(ArdiaCoreWindow *)coreWindow {
  if ((self = [super init])) {
    _coreWindow = coreWindow;
    _seen = YES;
    __weak ArdiaWindowFullScreen *weakSelf = self;
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    NSMutableArray *observers = [NSMutableArray array];
    for (NSNotificationName name in @[
           NSWindowWillEnterFullScreenNotification, NSWindowWillExitFullScreenNotification, NSWindowDidEnterFullScreenNotification,
           NSWindowDidExitFullScreenNotification, NSWindowDidChangeOcclusionStateNotification, NSWindowWillCloseNotification
         ]) {
      [observers addObject:[center addObserverForName:name
                                               object:coreWindow.window
                                                queue:nil
                                           usingBlock:^(NSNotification *note) {
                                             [weakSelf windowDid:note.name];
                                           }]];
    }
    _observers = observers;
  }
  return self;
}

- (void)dealloc {
  for (id observer in _observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
}

- (BOOL)occlusionActed {
  return ardia_host::Background() && (![ArdiaLaunchConfig.shared instanceFlag:@"allowOcclusion"] || objc_getAssociatedObject(_coreWindow.window, kActedOcclusionKey));
}

- (BOOL)windowVisible {
  NSWindow *window = _coreWindow.window;
  if (!window) return NO;
  if ([self occlusionActed] && !objc_getAssociatedObject(window, kActedOcclusionKey)) return YES;
  return (window.occlusionState & NSWindowOcclusionStateVisible) != 0;
}

- (void)windowDid:(NSNotificationName)name {
  if ([name isEqualToString:NSWindowWillCloseNotification]) {
    _closed = YES;
    for (ArdiaPageCover *cover in _covers) [cover uncover:NO];
    _covers = nil;
    return;
  }
  const BOOL will = [name isEqualToString:NSWindowWillEnterFullScreenNotification] || [name isEqualToString:NSWindowWillExitFullScreenNotification];
  const BOOL did = [name isEqualToString:NSWindowDidEnterFullScreenNotification] || [name isEqualToString:NSWindowDidExitFullScreenNotification];
  const BOOL entering = [name isEqualToString:NSWindowWillEnterFullScreenNotification] || [name isEqualToString:NSWindowDidEnterFullScreenNotification];
  if (will) {
    _transitioning = _settling = YES;
    _ours = _asked == (entering ? 1 : -1);
    _asked = 0;
    for (ArdiaPageCover *cover in _covers) [cover repicture];
  }
  if (did) _transitioning = NO;
  if (!_transitioning && [self windowVisible]) _settling = NO;
  [self updateSeen];
  if (!did) return;
  [self uncoverWhenDrawn];
  const BOOL ours = _ours;
  _ours = NO;
  __weak ArdiaWindowFullScreen *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf settled:entering ours:ours]; });
}

- (void)updateSeen {
  if (![self occlusionActed] && [CFBridgingRelease(CGSessionCopyCurrentDictionary())[@"CGSSessionScreenIsLocked"] boolValue]) return;
  const BOOL seen = _settling || [self windowVisible] || IsWindowFullScreen(_coreWindow.window);
  if ([ArdiaLaunchConfig.shared traced:@"visibility"])
    NSLog(@"[ardiacore-vis] window %ld seen=%d (transitioning=%d settling=%d)", (long)_coreWindow.window.windowNumber, seen, _transitioning, _settling);
  if (seen == _seen) return;
  _seen = seen;
  if (NSWindow *window = _coreWindow.window) [NSNotificationCenter.defaultCenter postNotificationName:ArdiaWindowSeenDidChange object:window];
}

- (BOOL)seen {
  return _seen;
}

- (void)settled:(BOOL)entered ours:(BOOL)ours {
  if (!entered && !ours) {
    _entered = NO;
    ArdiaCoreTab *tab = _tab;
    if (tab) return [tab exitFullscreen];
  }
  [self sync];
}

- (void)tab:(ArdiaCoreTab *)tab fullScreen:(BOOL)fullScreen tell:(void (^)(void))tell {
  const NSUInteger change = [FullScreenChanges() objectForKey:tab].unsignedIntegerValue;
  _waitingFor = 0;
  _coverTurn++;
  _picturing = NO;
  if (fullScreen) {
    _tab = _lastTab = tab;
  } else if (_tab == tab || !_tab) {
    if (_tab) _leftTab = _tab;
    _tab = nil;
  }
  ApplyFullScreenReveal(_coreWindow.window);
  _telling++;
  __weak ArdiaWindowFullScreen *weakSelf = self;
  __weak ArdiaCoreTab *weakTab = tab;
  [ArdiaPageDrawWait tab:tab
                draws:^NSInteger(BOOL drawnFullScreen, BOOL) {
                  if (fullScreen) return drawnFullScreen ? 1 : 0;
                  return drawnFullScreen ? -1 : 1;
                }
                 then:^{
                   ArdiaWindowFullScreen *me = weakSelf;
                   if (me) me->_telling--;
                   ArdiaCoreTab *t = weakTab;
                   if (t && [FullScreenChanges() objectForKey:t].unsignedIntegerValue == change) tell();
                   [me sync];
                 }];
}

- (void)sync {
  ArdiaCoreWindow *coreWindow = _coreWindow;
  NSWindow *window = coreWindow.window;
  if (!window || _closed || _transitioning) return;
  const BOOL full = IsWindowFullScreen(window), page = _tab != nil;
  const NSInteger toggle = page && !full && !_entered ? 1 : !page && full && _entered ? -1 : 0;
  if (toggle != _waitingFor) {
    _waitingFor = toggle;
    _drew = _askedWait = NO;
    _wait++;
  }
  if (toggle == 1) {
    if (_telling > 0 || _picturing || ![self pageDrew:_tab entering:YES]) return;
    [self coverThenToggle:_tab entering:YES];
  } else if (toggle == -1) {
    if (_telling > 0 || _picturing || ![self pageDrew:_leftTab entering:NO]) return;
    [self coverThenToggle:_leftTab entering:NO];
  } else if (!page) {
    _entered = NO;
  }
}

- (NSArray<ArdiaCoreTab *> *)shownTabs:(ArdiaCoreTab *)tab entering:(BOOL)entering {
  ArdiaCoreWindow *coreWindow = _coreWindow;
  NSWindow *window = coreWindow.window;
  NSMutableArray<ArdiaCoreTab *> *tabs = [NSMutableArray array];
  if (tab) [tabs addObject:tab];
  if (entering || !coreWindow.activeProfile) return tabs;
  for (ArdiaCoreTab *other in [coreWindow tabsForProfile:coreWindow.activeProfile]) {
    NSView *page = other.view;
    ArdiaWebView *view = [ArdiaTabRegistry viewForTab:other];
    if (other == tab || page.window != window || page.isHiddenOrHasHiddenAncestor || !view || view.alphaValue < 0.5) continue;
    [tabs addObject:other];
  }
  return tabs;
}

- (void)coverThenToggle:(ArdiaCoreTab *)tab entering:(BOOL)entering {
  _picturing = YES;
  const NSUInteger turn = ++_coverTurn;
  __weak ArdiaWindowFullScreen *weakSelf = self;
  [ArdiaPageCover coverTabs:[self shownTabs:tab entering:entering]
                    then:^(NSArray<ArdiaPageCover *> *covers) {
                      ArdiaWindowFullScreen *me = weakSelf;
                      if (!me || me->_coverTurn != turn) {
                        for (ArdiaPageCover *cover in covers) [cover uncover:NO];
                        return;
                      }
                      me->_picturing = NO;
                      for (ArdiaPageCover *cover in me->_covers) [cover uncover:NO];
                      me->_covers = covers;
                      [me toggle:entering];
                    }];
}

- (void)toggle:(BOOL)entering {
  ArdiaCoreWindow *coreWindow = _coreWindow;
  NSWindow *window = coreWindow.window;
  const BOOL wanted = window && !_closed && !_transitioning && IsWindowFullScreen(window) != entering &&
                      (entering ? _tab && !_entered : !_tab && _entered);
  if (!wanted) {
    for (ArdiaPageCover *cover in _covers) [cover uncover:NO];
    _covers = nil;
    return [self sync];
  }
  _entered = entering;
  _asked = entering ? 1 : -1;
  if (!entering) _leftTab = nil;
  [CATransaction flush];
  ToggleWindowFullScreen(coreWindow);
  NSArray *covers = _covers;
  if (!covers.count) return;
  __weak ArdiaWindowFullScreen *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaWindowFullScreen *me = weakSelf;
    if (me && me->_covers == covers && !me->_transitioning) [me uncoverWhenDrawn];
  });
}

- (ArdiaCoreTab *)probedTab {
  return _tab ?: _leftTab ?: _lastTab;
}

- (NSInteger)covers {
  NSInteger covers = 0;
  NSMutableArray<NSView *> *views = [NSMutableArray arrayWithObject:_coreWindow.window.contentView ?: [NSView new]];
  while (views.count) {
    NSView *view = views.lastObject;
    [views removeLastObject];
    if ([view isKindOfClass:ArdiaPageCover.class]) covers++;
    [views addObjectsFromArray:view.subviews];
  }
  return covers;
}

- (BOOL)covered {
  return self.covers > 0;
}

- (BOOL)transitioning {
  return _transitioning;
}

- (BOOL)pageFullScreen {
  return _tab != nil;
}

- (BOOL)enteredForPage {
  return _entered;
}

- (void)uncoverWhenDrawn {
  NSArray<ArdiaPageCover *> *covers = _covers;
  _covers = nil;
  for (ArdiaPageCover *cover in covers) {
    ArdiaCoreTab *tab = cover.tab;
    if (!tab) {
      [cover uncover:NO];
      continue;
    }
    [ArdiaPageDrawWait tab:tab
                  draws:^NSInteger(BOOL, BOOL) { return 1; }
                   then:^{
                     dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.034 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                       [cover uncover:YES];
                     });
                   }];
  }
}

- (BOOL)pageDrew:(ArdiaCoreTab *)tab entering:(BOOL)entering {
  if (_drew) {
    _drew = _askedWait = NO;
    _waitingFor = 0;
    _wait++;
    return YES;
  }
  if (_askedWait) return NO;
  _askedWait = YES;
  const NSUInteger wait = _wait;
  __weak ArdiaWindowFullScreen *weakSelf = self;
  __block BOOL now = YES;
  [ArdiaPageDrawWait tab:tab
                draws:^NSInteger(BOOL fullScreen, BOOL fills) { return fullScreen == entering && fills == entering; }
                 then:^{
                   ArdiaWindowFullScreen *me = weakSelf;
                   if (!me || me->_wait != wait) return;
                   me->_drew = YES;
                   if (!now) [me sync];
                 }];
  now = NO;
  if (!_drew) return NO;
  _drew = _askedWait = NO;
  _waitingFor = 0;
  _wait++;
  return YES;
}

- (NSDictionary *)state {
  NSWindow *window = _coreWindow.window;
  ArdiaCoreTab *tab = _tab;
  return @{
    @"page" : tab ? @(ardia_host::BrowserId(tab)) : NSNull.null,
    @"entered" : @(_entered),
    @"asked" : @(_asked),
    @"waitingForPage" : @(_waitingFor),
    @"telling" : @(_telling),
    @"picturing" : @(_picturing),
    @"covered" : @([self covered]),
    @"transitioning" : @(_transitioning),
    @"ours" : @(_ours),
    @"settling" : @(_settling),
    @"seen" : @(_seen),
    @"fullScreen" : @(IsWindowFullScreen(window)),
  };
}

@end

namespace ardia_host {

void ActToggleFullScreen(NSWindow *window) {
  LogActivation(@"toggleFullScreen: (acted out)");
  if (ArdiaCoreWindow *coreWindow = [ArdiaWindowController forNSWindow:window].coreWindow)
    ActWindowFullScreen(coreWindow, !IsWindowFullScreen(window), gActedTransition);
}
}
