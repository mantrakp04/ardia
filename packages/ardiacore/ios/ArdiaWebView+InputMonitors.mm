#import "ArdiaWebViewInternal.h"

#import <IOKit/IOKitLib.h>
#import <QuartzCore/QuartzCore.h>
#import <dlfcn.h>

using namespace ardia_web_view;

namespace {

int gDevTrackpad = -1;
NSValue *gDevPointer = nil;
NSUInteger gZoomScrolls = 0;
NSUInteger gZoomCandidates = 0;
constexpr NSTimeInterval kSwitchPrewarmGapSeconds = 0.1;
constexpr double kZoomStepDelta = 30;
constexpr double kWheelLineDelta = 30;
constexpr CFTimeInterval kCommandWheelCreditSeconds = 0.5;
constexpr CFTimeInterval kCommandWheelRearmSeconds = 1;
constexpr NSUInteger kCommandWheelCreditLimit = 64;
constexpr unsigned short kCommandKeyCode = 55;

NSString *gDevZoomMiss = nil;
bool gGestureTrackpad = false;
bool gCommandScrollZoom = true;
bool gCommandHeld = false;
double gZoomAccumulated = 0;

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

NSMapTable<ArdiaWebView *, NSNumber *> *ArmedViews() {
  static NSMapTable *armed = [NSMapTable weakToStrongObjectsMapTable];
  return armed;
}

NSMapTable<ArdiaWebView *, NSMutableArray<NSArray<NSNumber *> *> *> *WheelCredits() {
  static NSMapTable *credits = [NSMapTable weakToStrongObjectsMapTable];
  return credits;
}

void DropStaleCredits(NSMutableArray<NSArray<NSNumber *> *> *credits, CFTimeInterval now) {
  while (credits.count && now - credits.firstObject.firstObject.doubleValue > kCommandWheelCreditSeconds) [credits removeObjectAtIndex:0];
}

int DirectionOf(double delta) {
  return (delta > 0) - (delta < 0);
}

ArdiaWebView *PageViewAt(NSWindow *window, NSPoint inWindow) {
  NSView *content = window.contentView;
  NSView *hit = content ? [content hitTest:[content.superview convertPoint:inWindow fromView:nil]] : nil;
  while (hit && ![hit isKindOfClass:ArdiaWebView.class]) hit = hit.superview;
  return (ArdiaWebView *)hit;
}

NSWindow *AppWindowAt(NSPoint screen) {
  for (NSWindow *window in NSApp.orderedWindows)
    if (window.isVisible && !window.ignoresMouseEvents && NSPointInRect(screen, window.frame)) return window;
  return nil;
}

}

@implementation ArdiaWebView (InputMonitors)

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
  ArdiaWebView *target = nil;
  for (ArdiaWebView *view in LiveViews()) {
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
  if (monitor) return;
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp handler:^NSEvent *(NSEvent *event) {
    [ArdiaWebView prewarmForMouseEvent:event];
    return event;
  }];
}

+ (void)setCommandScrollZoomEnabled:(BOOL)enabled {
  gCommandScrollZoom = enabled;
  if (!enabled) [ArdiaWebView disarmCommandWheels];
}

+ (void)disarmCommandWheels {
  if (!ArmedViews().count) return;
  for (ArdiaWebView *view in [ArmedViews() keyEnumerator].allObjects) [view pushCommandWheelArmed:NO];
  [ArmedViews() removeAllObjects];
}

- (void)pushCommandWheelArmed:(BOOL)armed {
  if (!_tab) return;
  NSString *json = armed ? @"{\"armed\":true}" : @"{\"armed\":false}";
  [self callFrame:@"" kind:@"commandWheel" json:json];
  for (NSString *frameId in [ScriptFramesOf(_tab) copy]) [self callFrame:frameId kind:@"commandWheel" json:json];
}

- (void)armCommandWheel {
  const CFTimeInterval now = CACurrentMediaTime();
  NSNumber *armedAt = [ArmedViews() objectForKey:self];
  if (armedAt && now - armedAt.doubleValue <= kCommandWheelRearmSeconds) return;
  [ArmedViews() setObject:@(now) forKey:self];
  [self pushCommandWheelArmed:YES];
}

- (BOOL)runsPageScript {
  NSString *url = _tab.url;
  return [url hasPrefix:@"https:"] || [url hasPrefix:@"http:"] || [url hasPrefix:@"file:"];
}

- (void)offerCommandWheel:(double)delta {
  NSMutableArray<NSArray<NSNumber *> *> *credits = [WheelCredits() objectForKey:self];
  if (!credits) [WheelCredits() setObject:(credits = [NSMutableArray array]) forKey:self];
  const CFTimeInterval now = CACurrentMediaTime();
  DropStaleCredits(credits, now);
  if (credits.count >= kCommandWheelCreditLimit) [credits removeObjectAtIndex:0];
  [credits addObject:@[ @(now), @(delta) ]];
  [self armCommandWheel];
}

- (void)commandWheelFromPage:(NSDictionary *)reply {
  double pageDelta = 0;
  if (!Finite(reply, @"dy", &pageDelta)) return;
  NSMutableArray<NSArray<NSNumber *> *> *credits = [WheelCredits() objectForKey:self];
  DropStaleCredits(credits, CACurrentMediaTime());
  const int direction = DirectionOf(-pageDelta);
  while (credits.count && DirectionOf(credits.firstObject.lastObject.doubleValue) != direction) [credits removeObjectAtIndex:0];
  if (!credits.count) return;
  const double delta = credits.firstObject.lastObject.doubleValue;
  [credits removeObjectAtIndex:0];
  if (!Flag(reply, @"handled")) [self zoomByScroll:delta];
}

- (void)zoomByScroll:(double)delta {
  gZoomScrolls++;
  gZoomAccumulated += delta;
  if (fabs(gZoomAccumulated) < kZoomStepDelta) return;
  [self zoomStep:gZoomAccumulated > 0 ? 1 : -1];
  gZoomAccumulated = 0;
}

+ (void)installScrollZoom {
  static id monitor, touchMonitor, flagsMonitor;
  if (monitor) return;
  static NSUInteger touching = 0;
  static NSTimeInterval touchedAt = 0;
  touchMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskGesture handler:^NSEvent *(NSEvent *event) {
    touching = [event touchesMatchingPhase:NSTouchPhaseTouching inView:nil].count;
    touchedAt = event.timestamp;
    return event;
  }];
  flagsMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged handler:^NSEvent *(NSEvent *event) {
    gCommandHeld = event.modifierFlags & NSEventModifierFlagCommand;
    if (!gCommandHeld) {
      [ArdiaWebView disarmCommandWheels];
      return event;
    }
    if (!gCommandScrollZoom) return event;
    const NSPoint screen = gDevPointer ? gDevPointer.pointValue : NSEvent.mouseLocation;
    NSWindow *window = AppWindowAt(screen);
    ArdiaWebView *view = window ? PageViewAt(window, [window convertPointFromScreen:screen]) : nil;
    if (view && view->_tab && [view runsPageScript]) [view armCommandWheel];
    return event;
  }];
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    BOOL fingers = (event.phase & (NSEventPhaseBegan | NSEventPhaseMayBegin)) && touching >= 2 && event.timestamp - touchedAt < 0.5;
    BOOL trackpad = event.phase != NSEventPhaseNone && (fingers || FromTrackpad(event));
    if (gDevTrackpad >= 0) gDevZoomMiss = @"not a zoom (a trackpad gesture, or no ⌘)";
    if (!CommandScrollZooms(event, trackpad)) {
      [ArdiaWebView disarmCommandWheels];
      return event;
    }
    if (!gCommandScrollZoom) {
      if (gDevTrackpad >= 0) gDevZoomMiss = @"⌘-scroll zoom is off in Settings";
      return event;
    }
    NSWindow *window = event.window;
    NSPoint point = event.locationInWindow;
    if (!window) {
      window = AppWindowAt(point);
      point = [window convertPointFromScreen:point];
    }
    ArdiaWebView *view = PageViewAt(window, point);
    if (gDevTrackpad >= 0 && (!view || !view->_tab))
      gDevZoomMiss = [NSString stringWithFormat:@"not over a page: window %ld %@, hit %@", (long)window.windowNumber, NSStringFromPoint(point),
                                                [window.contentView hitTest:[window.contentView.superview convertPoint:point fromView:nil]]];
    if (!view || !view->_tab) return event;
    if (event.phase == NSEventPhaseBegan) gZoomAccumulated = 0;
    const double delta = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * kWheelLineDelta;
    gZoomCandidates++;
    if (![view runsPageScript]) {
      [view zoomByScroll:delta];
      return nil;
    }
    [view offerCommandWheel:delta];
    return event;
  }];
}

+ (NSArray<NSNumber *> *)devScrollZoom:(NSArray<NSDictionary<NSString *, id> *> *)steps browser:(int)browserId {
  ArdiaWebView *view = nil;
  for (ArdiaWebView *v in LiveViews())
    if (v.window.isVisible && !v.isHiddenOrHasHiddenAncestor && v->_tab && v->_visible &&
        (!browserId || ardia_host::BrowserId(v->_tab) == browserId))
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
    if ([phase isEqualToString:@"command"] || [phase isEqualToString:@"commandUp"]) {
      const BOOL down = [phase isEqualToString:@"command"];
      NSEvent *flags = [NSEvent keyEventWithType:NSEventTypeFlagsChanged
                                        location:inWindow
                                   modifierFlags:down ? NSEventModifierFlagCommand : 0
                                       timestamp:NSProcessInfo.processInfo.systemUptime
                                    windowNumber:window.windowNumber
                                         context:nil
                                      characters:@""
                     charactersIgnoringModifiers:@""
                                       isARepeat:NO
                                         keyCode:kCommandKeyCode];
      gDevPointer = [NSValue valueWithPoint:screen];
      [NSApp sendEvent:flags];
      gDevPointer = nil;
      [zoomed addObject:@(gCommandHeld == down)];
      continue;
    }
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
    NSUInteger before = gZoomCandidates;
    gDevZoomMiss = nil;
    [NSApp sendEvent:event];
    gDevTrackpad = -1;
    [zoomed addObject:@(gZoomCandidates > before)];
    if (wheel && gZoomCandidates == before)
      NSLog(@"[scroll-zoom] a ⌘-wheel step didn't zoom: %@", gDevZoomMiss ?: @"the zoom monitor never saw it");
  }
  return zoomed;
}

@end
