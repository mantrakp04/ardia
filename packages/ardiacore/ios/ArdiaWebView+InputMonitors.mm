#import "ArdiaWebViewInternal.h"

#import <IOKit/IOKitLib.h>
#import <dlfcn.h>

using namespace ardia_web_view;

namespace {

int gDevTrackpad = -1;
NSUInteger gZoomScrolls = 0;
constexpr NSTimeInterval kSwitchPrewarmGapSeconds = 0.1;

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
    while (hit && ![hit isKindOfClass:ArdiaWebView.class]) hit = hit.superview;
    ArdiaWebView *view = (ArdiaWebView *)hit;
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
