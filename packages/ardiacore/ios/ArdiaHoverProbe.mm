#import "ArdiaInternal.h"
#import "ArdiaContentBlockerInternal.h"
#import "ArdiaWindowController.h"
#import "ArdiaEvents.h"

#import <objc/message.h>
#import <objc/runtime.h>

namespace ardia_host {

namespace {

enum class HoverReason { fine, halfActive, staleMenu, notKeyOrMain, coveredByView, responderLost };
enum class FocusWindowKind { none, hidden, blockerPage, internal, ardiaPanel, popup, browser, other };
enum class PageCover { none, reactNative, chromium, other };
enum class HoverTrigger { move, click, recheck };

NSString *ReasonName(HoverReason reason) {
  return @[ @"fine", @"halfActive", @"staleMenu", @"notKeyOrMain", @"coveredByView", @"responderLost" ][(NSUInteger)reason];
}

NSString *KindName(FocusWindowKind kind) {
  return @[ @"none", @"hidden", @"blockerPage", @"internal", @"ardiaPanel", @"popup", @"browser", @"other" ][(NSUInteger)kind];
}

NSString *CoverName(PageCover cover) {
  return @[ @"none", @"reactNative", @"chromium", @"other" ][(NSUInteger)cover];
}

NSString *TriggerName(HoverTrigger trigger) {
  return @[ @"move", @"click", @"recheck" ][(NSUInteger)trigger];
}

bool gDevHalfActive = false;
bool gDevMenuActive = false;

struct Activation {
  bool appActive = false;
  bool runningActive = false;
  bool frontmost = false;
  bool inFront() const { return appActive || runningActive || frontmost; }
  bool half() const { return appActive != runningActive || runningActive != frontmost; }
};

Activation CurrentActivation() {
  Activation activation;
  activation.appActive = NSApp.isActive;
  if (gDevHalfActive) {
    activation.runningActive = activation.frontmost = true;
  } else if (Background()) {
    activation.runningActive = activation.frontmost = activation.appActive;
  } else {
    NSRunningApplication *me = NSRunningApplication.currentApplication;
    activation.runningActive = me.isActive;
    activation.frontmost = [NSWorkspace.sharedWorkspace.frontmostApplication isEqual:me];
  }
  return activation;
}

bool WindowFlag(NSWindow *window, NSString *name) {
  if (![window respondsToSelector:NSSelectorFromString(name)]) return false;
  return [[window valueForKey:name] boolValue];
}

bool PreventsKey(NSWindow *window) {
  return WindowFlag(window, @"preventKeyWindow");
}

bool MenuActive(NSWindow *window) {
  return gDevMenuActive || WindowFlag(window, @"hasViewsMenuActive");
}

bool MenuShown(NSWindow *browser) {
  for (NSWindow *window in NSApp.windows) {
    if (window == browser || !window.isVisible) continue;
    if (window.parentWindow == browser || window.level >= NSPopUpMenuWindowLevel || [window.className containsString:@"Menu"]) return true;
  }
  return false;
}

bool IsBrowserWindow(NSWindow *window) {
  if (!window || ardia_content_blocker::IsHiddenPageWindow(window)) return false;
  ArdiaWindowController *controller = [ArdiaWindowController forNSWindow:window];
  return controller.root && !controller.standalone && !controller.stray && !controller.coreWindow.internal;
}

FocusWindowKind KindOf(NSWindow *window) {
  if (!window) return FocusWindowKind::none;
  if (ardia_content_blocker::IsHiddenPageWindow(window)) return FocusWindowKind::blockerPage;
  if (!window.isVisible || window.alphaValue < 0.01 || window.isMiniaturized || !window.isOnActiveSpace) return FocusWindowKind::hidden;
  if (ArdiaWindowController *controller = [ArdiaWindowController forNSWindow:window]) {
    if (controller.standalone || controller.stray || controller.coreWindow.internal) return FocusWindowKind::internal;
    return controller.root ? FocusWindowKind::browser : FocusWindowKind::ardiaPanel;
  }
  if ([window isKindOfClass:NSPanel.class] || window.isSheet || window.parentWindow || window.level > NSNormalWindowLevel ||
      [window.className containsString:@"Menu"])
    return FocusWindowKind::popup;
  return FocusWindowKind::other;
}

bool Unseen(FocusWindowKind kind) {
  return kind == FocusWindowKind::none || kind == FocusWindowKind::hidden || kind == FocusWindowKind::blockerPage;
}

Class PageClass() {
  static Class page = NSClassFromString(@"RenderWidgetHostViewCocoa");
  return page;
}

NSView *PageAt(NSWindow *window, NSPoint point) {
  Class pageClass = PageClass();
  if (!pageClass) return nil;
  NSView *found = nil;
  NSMutableArray<NSView *> *stack = [NSMutableArray arrayWithObject:window.contentView.superview ?: [NSView new]];
  while (stack.count) {
    NSView *v = stack.lastObject;
    [stack removeLastObject];
    if (v.isHidden) continue;
    if ([v isKindOfClass:pageClass]) {
      if (NSPointInRect(point, [v convertRect:v.bounds toView:nil])) found = v;
      continue;
    }
    for (NSView *child in v.subviews.reverseObjectEnumerator) [stack addObject:child];
  }
  return found;
}

NSView *EnclosingPage(NSView *view) {
  for (NSView *v = view; v; v = v.superview)
    if ([v isKindOfClass:PageClass()]) return v;
  return nil;
}

bool PageIgnoresMove(NSView *page, NSWindow *window, NSPoint point) {
  SEL ignores = NSSelectorFromString(@"shouldIgnoreMouseEvent:");
  if (![page respondsToSelector:ignores]) return false;
  NSEvent *event = [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:point modifierFlags:0
                                     timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber
                                       context:nil eventNumber:0 clickCount:0 pressure:0];
  return ((BOOL(*)(id, SEL, NSEvent *))objc_msgSend)(page, ignores, event);
}

NSView *HitAt(NSWindow *window, NSPoint point) {
  NSView *content = window.contentView;
  return [content hitTest:[content.superview convertPoint:point fromView:nil]];
}

PageCover CoverOf(NSView *hit) {
  if (!hit) return PageCover::none;
  NSBundle *bundle = [NSBundle bundleForClass:hit.class];
  if (PageClass() && bundle == [NSBundle bundleForClass:PageClass()]) return PageCover::chromium;
  return bundle == NSBundle.mainBundle ? PageCover::reactNative : PageCover::other;
}

bool SeeThrough(NSView *hit) {
  for (NSView *v = hit; v; v = v.superview)
    if (v.alphaValue < 0.01 || (v.layer && v.layer.opacity < 0.01)) return true;
  return false;
}

bool ResponderLost(NSWindow *window, bool clickedPage) {
  NSResponder *responder = window.firstResponder;
  if (!responder) return true;
  if ([responder isKindOfClass:NSView.class] && ((NSView *)responder).window != window) return true;
  return clickedPage && responder == window;
}

struct HoverCheck {
  HoverReason reason = HoverReason::fine;
  Activation activation;
  FocusWindowKind key = FocusWindowKind::none;
  FocusWindowKind main = FocusWindowKind::none;
  PageCover cover = PageCover::none;
  bool coverClear = false;
  bool preventKey = false;
  bool canKey = false;
  bool menuActive = false;
  bool windowKey = false;
  bool windowMain = false;
  bool overPage = false;
};

HoverReason PageReason(HoverCheck &check, NSWindow *window, NSPoint point, NSView *page, bool click) {
  const bool active = check.windowKey || check.windowMain;
  if ((check.activation.frontmost || check.activation.runningActive) && !check.activation.appActive) return HoverReason::halfActive;
  if (click && page && check.menuActive && !MenuShown(window)) return HoverReason::staleMenu;
  if (page && PageIgnoresMove(page, window, point)) {
    if (!active) return HoverReason::notKeyOrMain;
    NSView *hit = HitAt(window, point);
    if (EnclosingPage(hit)) return HoverReason::fine;
    check.cover = CoverOf(hit);
    check.coverClear = SeeThrough(hit);
    return HoverReason::coveredByView;
  }
  if (check.windowKey && ResponderLost(window, click && page)) return HoverReason::responderLost;
  return HoverReason::fine;
}

HoverCheck Probe(NSWindow *window, NSPoint point, bool click) {
  HoverCheck check;
  check.activation = CurrentActivation();
  check.key = KindOf(NSApp.keyWindow);
  check.main = KindOf(NSApp.mainWindow);
  check.preventKey = PreventsKey(window);
  check.canKey = window.canBecomeKeyWindow;
  check.menuActive = MenuActive(window);
  check.windowKey = window.isKeyWindow;
  check.windowMain = window.isMainWindow;
  NSView *page = PageAt(window, point);
  check.overPage = page != nil;
  check.reason = PageReason(check, window, point, page, click);
  return check;
}

bool IsProblem(const HoverCheck &check, HoverTrigger trigger) {
  switch (check.reason) {
    case HoverReason::fine: return false;
    case HoverReason::notKeyOrMain:
      if (trigger == HoverTrigger::click)
        return check.key != FocusWindowKind::popup && check.key != FocusWindowKind::ardiaPanel && check.key != FocusWindowKind::internal &&
               !NSApp.modalWindow;
      return Unseen(check.key) && Unseen(check.main);
    case HoverReason::coveredByView: return check.cover != PageCover::reactNative || check.coverClear;
    case HoverReason::halfActive:
    case HoverReason::staleMenu:
    case HoverReason::responderLost: return true;
  }
}

bool PanelOrSheetOpen() {
  if (NSApp.modalWindow) return true;
  for (NSWindow *window in NSApp.windows) {
    if (window.attachedSheet) return true;
    if (window.isVisible && [window isKindOfClass:NSSavePanel.class]) return true;
  }
  return false;
}

constexpr double kFullScreenMoveLongest = 5;

NSMapTable<NSWindow *, NSNumber *> *FullScreenMoves() {
  static NSMapTable<NSWindow *, NSNumber *> *moving = [NSMapTable weakToStrongObjectsMapTable];
  return moving;
}

bool FullScreenMoving() {
  for (NSNumber *since in FullScreenMoves().objectEnumerator)
    if (NSProcessInfo.processInfo.systemUptime - since.doubleValue < kFullScreenMoveLongest) return true;
  return false;
}

bool OtherArdiaWindowActive(NSWindow *window) {
  for (NSWindow *other in NSApp.windows) {
    if (other == window || !(other.isKeyWindow || other.isMainWindow)) continue;
    if (KindOf(other) != FocusWindowKind::hidden && KindOf(other) != FocusWindowKind::blockerPage && [ArdiaWindowController forNSWindow:other])
      return true;
  }
  return false;
}

bool SafeToHeal(NSWindow *window, const HoverCheck &check, HoverTrigger trigger) {
  if (!window.isVisible || !window.isOnActiveSpace || !check.activation.inFront() || PanelOrSheetOpen()) return false;
  if (check.menuActive || MenuShown(window) || FullScreenMoving()) return false;
  if (check.reason == HoverReason::halfActive) return trigger == HoverTrigger::click && check.key != FocusWindowKind::popup;
  return check.reason == HoverReason::notKeyOrMain && check.activation.appActive && Unseen(check.key) && !OtherArdiaWindowActive(window);
}

struct HoverEpisode {
  bool open = false;
  __weak NSWindow *owner = nil;
  NSUInteger serial = 0;
  HoverCheck first;
  HoverTrigger trigger = HoverTrigger::move;
  double startedAt = 0;
  bool healed = false;
  int healWorked = -1;
};

HoverEpisode gEpisode;
HoverReason gPendingReason = HoverReason::fine;
__weak NSWindow *gPendingWindow;
NSUInteger gEpisodeCount = 0;
NSString *gLastHoverVerdict;
double gLastMoveCheck = 0;
id gHoverMonitor;
bool gHoverWatchInBackground = false;
NSMutableArray<NSDictionary *> *gDevHoverEvents;
constexpr double kMoveCheckEvery = 2;
constexpr double kHealRecheckAfter = 0.3;
constexpr NSUInteger kDevHoverEventsKept = 16;

double Uptime() {
  return NSProcessInfo.processInfo.systemUptime;
}

NSString *DescribeCheck(const HoverCheck &check, HoverTrigger trigger) {
  static NSDateFormatter *clock = [] {
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    formatter.dateFormat = @"HH:mm:ss";
    return formatter;
  }();
  NSMutableArray<NSString *> *facts = [NSMutableArray arrayWithObjects:ReasonName(check.reason), TriggerName(trigger),
                                                                       [@"key=" stringByAppendingString:KindName(check.key)],
                                                                       [@"main=" stringByAppendingString:KindName(check.main)], nil];
  const Activation &a = check.activation;
  [facts addObject:[NSString stringWithFormat:@"active=%d/%d/%d", a.appActive, a.runningActive, a.frontmost]];
  if (a.half()) [facts addObject:@"halfActive"];
  if (check.windowKey) [facts addObject:@"windowKey"];
  if (check.windowMain) [facts addObject:@"windowMain"];
  if (check.preventKey) [facts addObject:@"preventKey"];
  if (check.canKey) [facts addObject:@"canKey"];
  if (check.menuActive) [facts addObject:@"menuActive"];
  if (check.overPage) [facts addObject:@"overPage"];
  if (check.cover != PageCover::none) [facts addObject:[@"cover=" stringByAppendingString:CoverName(check.cover)]];
  if (check.coverClear) [facts addObject:@"coverClear"];
  return [NSString stringWithFormat:@"%@ at %@", [facts componentsJoinedByString:@" "], [clock stringFromDate:NSDate.date]];
}

void CloseEpisode(NSString *endedBy) {
  if (!gEpisode.open) return;
  const HoverCheck &first = gEpisode.first;
  NSDictionary *payload = @{
    @"reason" : ReasonName(first.reason),
    @"trigger" : TriggerName(gEpisode.trigger),
    @"keyWindow" : KindName(first.key),
    @"mainWindow" : KindName(first.main),
    @"preventKey" : @(first.preventKey),
    @"canKey" : @(first.canKey),
    @"windowMain" : @(first.windowMain),
    @"halfActive" : @(first.activation.half()),
    @"appActive" : @(first.activation.appActive),
    @"runningActive" : @(first.activation.runningActive),
    @"frontmost" : @(first.activation.frontmost),
    @"menuActive" : @(first.menuActive),
    @"overPage" : @(first.overPage),
    @"cover" : CoverName(first.cover),
    @"coverClear" : @(first.coverClear),
    @"healed" : @(gEpisode.healed),
    @"healWorked" : gEpisode.healWorked < 0 ? NSNull.null : @(gEpisode.healWorked == 1),
    @"endedBy" : endedBy,
    @"seconds" : @(lround(MAX(0, Uptime() - gEpisode.startedAt))),
    @"episode" : @(gEpisodeCount),
  };
  gEpisode = HoverEpisode{};
  gPendingReason = HoverReason::fine;
  NoteFocusChange([@"hover episode ended by " stringByAppendingString:endedBy], nil);
  if (!gDevHoverEvents) gDevHoverEvents = [NSMutableArray array];
  [gDevHoverEvents addObject:payload];
  if (gDevHoverEvents.count > kDevHoverEventsKept) [gDevHoverEvents removeObjectAtIndex:0];
  [ArdiaEvents emit:@"engine.hoverLost" data:payload];
}

bool Recovered(const HoverCheck &check) {
  return check.reason == HoverReason::fine && !check.activation.half() && check.windowKey;
}

void Heal(NSWindow *window, NSPoint point, HoverReason reason) {
  gEpisode.healed = true;
  NoteFocusChange([@"hover heal " stringByAppendingString:ReasonName(reason)], window);
  if (PreventsKey(window)) [window setValue:@NO forKey:@"preventKeyWindow"];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  if (reason == HoverReason::halfActive) [NSApp activateIgnoringOtherApps:YES];
#pragma clang diagnostic pop
  [window makeKeyAndOrderFront:nil];
  const NSUInteger serial = gEpisode.serial;
  __weak NSWindow *weakWindow = window;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kHealRecheckAfter * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSWindow *healedWindow = weakWindow;
    if (!gEpisode.open || gEpisode.serial != serial) return;
    if (!healedWindow) return CloseEpisode(@"windowClosed");
    const HoverCheck after = Probe(healedWindow, point, false);
    gLastHoverVerdict = DescribeCheck(after, HoverTrigger::recheck);
    gEpisode.healWorked = Recovered(after) ? 1 : 0;
    if (gEpisode.healWorked == 1) CloseEpisode(@"heal");
  });
}

bool EndsEpisode(const HoverCheck &check) {
  if (check.reason != HoverReason::fine) return false;
  switch (gEpisode.first.reason) {
    case HoverReason::coveredByView: return check.overPage;
    case HoverReason::halfActive: return !check.activation.half() && (check.windowKey || check.windowMain);
    case HoverReason::notKeyOrMain: return check.windowKey || (check.windowMain && gEpisode.trigger == HoverTrigger::move);
    default: return true;
  }
}

void HandleHoverCheck(NSWindow *window, NSPoint point, HoverTrigger trigger) {
  if (gEpisode.open && !gEpisode.owner) CloseEpisode(@"windowClosed");
  if (!window || (gEpisode.open && gEpisode.owner != window)) return;
  const HoverCheck check = Probe(window, point, trigger == HoverTrigger::click);
  if (trigger == HoverTrigger::move && !check.overPage) return;
  gLastHoverVerdict = DescribeCheck(check, trigger);
  if (!IsProblem(check, trigger)) {
    gPendingReason = HoverReason::fine;
    if (gEpisode.open && EndsEpisode(check)) CloseEpisode(gEpisode.healed && gEpisode.healWorked != 0 ? @"heal" : @"hover");
    return;
  }
  if (!gEpisode.open) {
    if (trigger == HoverTrigger::move && (gPendingReason != check.reason || gPendingWindow != window)) {
      gPendingReason = check.reason;
      gPendingWindow = window;
      return;
    }
    gEpisode = HoverEpisode{};
    gEpisode.open = true;
    gEpisode.owner = window;
    gEpisode.serial = ++gEpisodeCount;
    gEpisode.first = check;
    gEpisode.trigger = trigger;
    gEpisode.startedAt = Uptime();
    NoteFocusChange([@"hover lost: " stringByAppendingString:ReasonName(check.reason)], window);
  }
  if (!gEpisode.healed && SafeToHeal(window, check, trigger)) Heal(window, point, check.reason);
}

NSWindow *BrowserWindowFor(NSEvent *event) {
  NSWindow *under = [NSApp windowWithWindowNumber:[NSWindow windowNumberAtPoint:NSEvent.mouseLocation belowWindowWithWindowNumber:0]];
  if (IsBrowserWindow(under)) return under;
  if (under || !gHoverWatchInBackground) return nil;
  return IsBrowserWindow(event.window) ? event.window : nil;
}

NSPoint PointIn(NSWindow *window, NSEvent *event) {
  if (event.window == window) return event.locationInWindow;
  return [window convertPointFromScreen:NSEvent.mouseLocation];
}

void StopHoverWatch() {
  if (gHoverMonitor) [NSEvent removeMonitor:gHoverMonitor];
  gHoverMonitor = nil;
}

void StartHoverWatch() {
  if (gHoverMonitor || (Background() && !gHoverWatchInBackground)) return;
  gHoverMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMouseMoved | NSEventMaskLeftMouseDown
                                                        handler:^NSEvent *(NSEvent *event) {
    const bool move = event.type == NSEventTypeMouseMoved;
    if (move && Uptime() - gLastMoveCheck < kMoveCheckEvery) return event;
    if (move) gLastMoveCheck = Uptime();
    if (!move && (event.modifierFlags & NSEventModifierFlagCommand)) return event;
    if (!CurrentActivation().inFront()) return event;
    NSWindow *window = BrowserWindowFor(event);
    if (!window) return event;
    const NSPoint point = PointIn(window, event);
    __weak NSWindow *weakWindow = window;
    dispatch_async(dispatch_get_main_queue(), ^{ HandleHoverCheck(weakWindow, point, move ? HoverTrigger::move : HoverTrigger::click); });
    return event;
  }];
}

void EndEpisodeIfInactive() {
  if (!CurrentActivation().inFront()) CloseEpisode(@"appInactive");
}

NSPoint TopLeftPoint(NSWindow *window, NSString *spec) {
  NSArray<NSString *> *n = [spec componentsSeparatedByString:@","];
  if (n.count < 2) return NSMakePoint(-1, -1);
  return NSMakePoint(n[0].doubleValue, window.contentView.superview.bounds.size.height - n[1].doubleValue);
}

NSMutableArray<NSView *> *gDevCovers = [NSMutableArray array];

NSString *DevCover(NSWindow *window, NSString *how, NSString *at) {
  for (NSView *cover in gDevCovers) [cover removeFromSuperview];
  [gDevCovers removeAllObjects];
  if ([how isEqualToString:@"off"]) return @"uncovered";
  NSView *page = PageAt(window, TopLeftPoint(window, at));
  if (!page) return @"no page there";
  NSView *host = [how isEqualToString:@"rn"] ? [ArdiaWindowController forNSWindow:window].root : page.superview;
  if (!host) return @"no host";
  NSView *cover = [[([how isEqualToString:@"rn"] ? NSClassFromString(@"RCTView") : NSView.class) alloc]
      initWithFrame:[host convertRect:[page convertRect:page.bounds toView:nil] fromView:nil]];
  if ([how isEqualToString:@"rn"]) cover.alphaValue = 0;
  [host addSubview:cover];
  [gDevCovers addObject:cover];
  return NSStringFromClass(HitAt(window, TopLeftPoint(window, at)).class);
}

NSString *DevHoverState() {
  NSData *json = [NSJSONSerialization dataWithJSONObject:@{
    @"verdict" : gLastHoverVerdict ?: @"",
    @"open" : @(gEpisode.open),
    @"episodeReason" : gEpisode.open ? ReasonName(gEpisode.first.reason) : @"",
    @"healed" : @(gEpisode.healed),
    @"healWorked" : @(gEpisode.healWorked),
    @"pending" : ReasonName(gPendingReason),
    @"watching" : @(gHoverMonitor != nil),
    @"emitted" : gDevHoverEvents ?: @[],
  } options:0 error:nil];
  return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
}

NSString *DevMakeKey(NSWindow *browser, NSString *command, NSString *mode) {
  const bool panel = [command isEqualToString:@"panelKey"];
  static NSMutableDictionary<NSString *, NSWindow *> *made = [NSMutableDictionary dictionary];
  NSWindow *other = made[command] ?: (made[command] = [[(panel ? NSPanel.class : NSWindow.class) alloc]
      initWithContentRect:NSMakeRect(0, 0, 40, 40) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES]);
  other.releasedWhenClosed = NO;
  if (panel) [other orderFront:nil];
  if ([mode isEqualToString:@"main"]) {
    other.alphaValue = 0;
    other.ignoresMouseEvents = YES;
    [other orderBack:nil];
    [other makeMainWindow];
  }
  [other makeKeyWindow];
  return [NSString stringWithFormat:@"key %@, main %@, browser %@", DescribeFocusWindow(NSApp.keyWindow),
                                    DescribeFocusWindow(NSApp.mainWindow), DescribeFocusWindow(browser)];
}

__weak NSWindow *gDevNotMainWindow;

NSString *DevNotMain(NSWindow *window, bool on) {
  static IMP original;
  Class cls = window.class;
  SEL selector = @selector(isMainWindow);
  if (!original) {
    original = method_getImplementation(class_getInstanceMethod(cls, selector));
    IMP fake = imp_implementationWithBlock(^BOOL(NSWindow *w) {
      return w != gDevNotMainWindow && ((BOOL(*)(id, SEL))original)(w, selector);
    });
    class_replaceMethod(cls, selector, fake, method_getTypeEncoding(class_getInstanceMethod(cls, selector)));
  }
  gDevNotMainWindow = on ? window : nil;
  return DescribeFocusWindow(window);
}

NSString *DevBlockerKey() {
  for (NSWindow *w in NSApp.windows)
    if (ardia_content_blocker::IsHiddenPageWindow(w)) {
      [w makeKeyWindow];
      return [NSString stringWithFormat:@"blocker %@, key %@", DescribeFocusWindow(w), DescribeFocusWindow(NSApp.keyWindow)];
    }
  return @"no blocker-page window";
}

}

NSString *HoverProbeLine() {
  const Activation a = CurrentActivation();
  return [NSString stringWithFormat:@"activation app %d running %d frontmost %d%@\nhover %@, episodes %lu%@", a.appActive, a.runningActive,
                                    a.frontmost, a.half() ? @" (half active)" : @"", gLastHoverVerdict ?: @"not checked",
                                    (unsigned long)gEpisodeCount,
                                    gEpisode.open ? [@", lost now: " stringByAppendingString:ReasonName(gEpisode.first.reason)] : @""];
}

void WatchHover() {
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [center addObserverForName:NSApplicationDidResignActiveNotification object:nil queue:nil usingBlock:^(NSNotification *) {
    EndEpisodeIfInactive();
  }];
  [center addObserverForName:NSWindowWillCloseNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
    if (gEpisode.open && note.object == gEpisode.owner) CloseEpisode(@"windowClosed");
  }];
  for (NSNotificationName name in @[ NSWindowWillEnterFullScreenNotification, NSWindowWillExitFullScreenNotification ])
    [center addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *note) {
      [FullScreenMoves() setObject:@(NSProcessInfo.processInfo.systemUptime) forKey:note.object];
    }];
  for (NSNotificationName name in @[ NSWindowDidEnterFullScreenNotification, NSWindowDidExitFullScreenNotification ])
    [center addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *note) { [FullScreenMoves() removeObjectForKey:note.object]; }];
  [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil queue:nil
                                                          usingBlock:^(NSNotification *) { EndEpisodeIfInactive(); }];
  StartHoverWatch();
}

NSString *HoverProbeDev(NSWindow *window, NSString *argument) {
  NSArray<NSString *> *parts = [argument ?: @"" componentsSeparatedByString:@":"];
  NSString *command = parts[0], *rest = parts.count > 1 ? parts[1] : @"";
  if ([command isEqualToString:@"watch"]) {
    gHoverWatchInBackground = [rest isEqualToString:@"1"];
    if (gHoverWatchInBackground) StartHoverWatch();
    else if (Background()) StopHoverWatch();
  } else if ([command isEqualToString:@"check"]) {
    HandleHoverCheck(window, TopLeftPoint(window, rest), [rest hasSuffix:@",click"] ? HoverTrigger::click : HoverTrigger::move);
  } else if ([command isEqualToString:@"preventKey"]) {
    [window setValue:@([rest isEqualToString:@"1"]) forKey:@"preventKeyWindow"];
    return DescribeFocusWindow(window);
  } else if ([command isEqualToString:@"halfActive"]) {
    gDevHalfActive = [rest isEqualToString:@"1"];
    return HoverProbeLine();
  } else if ([command isEqualToString:@"menuActive"]) {
    gDevMenuActive = [rest isEqualToString:@"1"];
    return [NSString stringWithFormat:@"menuActive %d, real %d, menu shown %d", MenuActive(window),
                                      WindowFlag(window, @"hasViewsMenuActive"), MenuShown(window)];
  } else if ([command isEqualToString:@"hiddenKey"] || [command isEqualToString:@"panelKey"]) {
    return DevMakeKey(window, command, rest);
  } else if ([command isEqualToString:@"notMain"]) {
    return DevNotMain(window, [rest isEqualToString:@"1"]);
  } else if ([command isEqualToString:@"blockerKey"]) {
    return DevBlockerKey();
  } else if ([command isEqualToString:@"cover"]) {
    return DevCover(window, rest, parts.count > 2 ? parts[2] : @"");
  }
  return DevHoverState();
}

}
