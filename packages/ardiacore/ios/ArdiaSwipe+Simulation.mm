#import "ArdiaSwipeInternal.h"
#import "ArdiaChromeWindowHost.h"

#import <dlfcn.h>

using namespace ardia_swipe;

namespace {

NSDictionary *ResponderReport(NSView *hit) {
  NSView *page = PageViewOf(hit);
  if (!page) return @{};
  NSMutableDictionary *valid = [NSMutableDictionary dictionary];
  for (NSString *action in @[ @"checkSpelling:", @"showGuessPanel:", @"toggleContinuousSpellChecking:", @"toggleGrammarChecking:",
                              @"startSpeaking:", @"stopSpeaking:" ]) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:action action:NSSelectorFromString(action) keyEquivalent:@""];
    valid[action] = @([(id<NSUserInterfaceValidations>)page validateUserInterfaceItem:item]);
  }
  return @{@"takesSwipes" : @([ArdiaCorePageView takesSwipes:page]), @"valid" : valid};
}

NSPoint LocalPoint(NSWindow *window, NSPoint point) {
  NSView *content = window.contentView;
  return content.isFlipped ? point : NSMakePoint(point.x, NSHeight(content.bounds) - point.y);
}

CGScrollPhase ScrollPhaseOf(NSString *phase) {
  if ([phase isEqualToString:@"began"]) return kCGScrollPhaseBegan;
  if ([phase isEqualToString:@"changed"]) return kCGScrollPhaseChanged;
  if ([phase isEqualToString:@"ended"]) return kCGScrollPhaseEnded;
  if ([phase isEqualToString:@"cancelled"]) return kCGScrollPhaseCancelled;
  if ([phase isEqualToString:@"mayBegin"]) return kCGScrollPhaseMayBegin;
  return (CGScrollPhase)0;
}

NSEvent *SyntheticScroll(NSWindow *window, NSPoint point, NSDictionary *step, uint64_t startNs) {
  NSString *phase = step[@"phase"];
  double dx = [step[@"dx"] doubleValue], dy = [step[@"dy"] doubleValue];
  BOOL wheel = [phase isEqualToString:@"wheel"];
  CGEventRef cg = CGEventCreateScrollWheelEvent2(NULL, wheel ? kCGScrollEventUnitLine : kCGScrollEventUnitPixel, 2, (int32_t)lround(dy), (int32_t)lround(dx), 0);
  if (!cg) return nil;
  CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, wheel ? 0 : 1);
  if ([step[@"shift"] boolValue]) CGEventSetFlags(cg, kCGEventFlagMaskShift);
  CGEventSetTimestamp(cg, step[@"timestampMs"] ? startNs + (uint64_t)llround([step[@"timestampMs"] doubleValue] * 1e6)
                                               : clock_gettime_nsec_np(CLOCK_UPTIME_RAW));
  if (step[@"dyLine"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventDeltaAxis1, [step[@"dyLine"] longLongValue]);
  if (step[@"dxLine"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventDeltaAxis2, [step[@"dxLine"] longLongValue]);
  if (!wheel) {
    CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis1, step[@"dyFixed"] ? [step[@"dyFixed"] doubleValue] : dy);
    CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis2, step[@"dxFixed"] ? [step[@"dxFixed"] doubleValue] : dx);
  }
  if (step[@"dyPoint"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventPointDeltaAxis1, [step[@"dyPoint"] longLongValue]);
  if (step[@"dxPoint"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventPointDeltaAxis2, [step[@"dxPoint"] longLongValue]);
  if ([phase hasPrefix:@"momentum"]) {
    CGMomentumScrollPhase momentum = [phase isEqualToString:@"momentumBegan"] ? kCGMomentumScrollPhaseBegin
                                     : [phase isEqualToString:@"momentumEnded"] ? kCGMomentumScrollPhaseEnd
                                                                                : kCGMomentumScrollPhaseContinue;
    CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, momentum);
  } else if (!wheel) {
    CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase, ScrollPhaseOf(phase));
  }
  if (step[@"rawPhase"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase, [step[@"rawPhase"] longLongValue]);
  if (step[@"rawMomentumPhase"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, [step[@"rawMomentumPhase"] longLongValue]);
  NSPoint local = LocalPoint(window, point);
  NSPoint screen = [window convertPointToScreen:[window.contentView convertPoint:local toView:nil]];
  CGFloat mainHeight = NSHeight(NSScreen.screens.firstObject.frame);
  CGEventSetLocation(cg, CGPointMake(screen.x, mainHeight - screen.y));
  CGEventSetIntegerValueField(cg, (CGEventField)51, window.windowNumber);
  static auto setWindowLocation = (void (*)(CGEventRef, CGPoint))dlsym(RTLD_DEFAULT, "CGEventSetWindowLocation");
  NSPoint inWindow = [window.contentView convertPoint:local toView:nil];
  if (setWindowLocation) setWindowLocation(cg, CGPointMake(inWindow.x, NSHeight(window.frame) - inWindow.y));
  NSEvent *event = [NSEvent eventWithCGEvent:cg];
  CFRelease(cg);
  return event;
}

}

@implementation ArdiaSwipe (Simulation)

+ (void)simulateInWindow:(NSWindow *)window
                   point:(NSPoint)point
                   steps:(NSArray<NSDictionary<NSString *, id> *> *)steps
  ignoreSystemPreference:(BOOL)ignoreSystemPreference
              completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  gTrace = [NSMutableArray array];
  NSMutableArray *log = [NSMutableArray array];
  const uint64_t startNs = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
  NSPoint local = LocalPoint(window, point);
  NSPoint inWindow = [window.contentView convertPoint:local toView:nil];
  NSView *hit = HitView(window, inWindow);
  NSDictionary *where = @{
    @"hit" : hit ? NSStringFromClass(hit.class) : @"",
    @"target" : TargetAt(window, inWindow, hit) ? @YES : @NO,
    @"window" : @(window.windowNumber),
    @"systemSwipeEnabled" : @(NSEvent.isSwipeTrackingFromScrollEventsEnabled),
  };
  __block NSUInteger index = 0;
  __block void (^next)(void);
  void (^step)(void) = ^{
    if (index >= steps.count) {
      NSDictionary *result = @{@"where" : where, @"startNs" : @(startNs), @"events" : log, @"acks" : gTrace ?: @[], @"responder" : ResponderReport(hit)};
      gTrace = nil;
      next = nil;
      completion(result);
      return;
    }
    NSDictionary *s = steps[index++];
    NSString *phase = s[@"phase"];
    const double atMs = (clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - startNs) / 1e6;
    if ([phase isEqualToString:@"swipe"]) {
      BOOL handled = HandleDiscreteSwipe(window, inWindow, [s[@"dx"] doubleValue]);
      [log addObject:@{@"phase" : phase, @"swallowed" : @(handled)}];
    } else {
      NSEvent *event = SyntheticScroll(window, point, s, startNs);
      if (event.window != window || fabs(event.locationInWindow.x - inWindow.x) > 1 || fabs(event.locationInWindow.y - inWindow.y) > 1) {
        [log addObject:@{@"phase" : phase, @"error" : [NSString stringWithFormat:@"event window %@ at %@, expected %@",
                                                                  event.window, NSStringFromPoint(event.locationInWindow), NSStringFromPoint(inWindow)]}];
      }
      gWrongRendererHit = [s[@"wrongRendererHit"] boolValue];
      gLegacyHitRouting = [s[@"legacyHitRouting"] boolValue];
      if ([s[@"dispatch"] isEqualToString:@"app"]) {
        const NSUInteger mark = gTrace.count;
        [NSApp sendEvent:event];
        NSArray *during = [gTrace subarrayWithRange:NSMakeRange(mark, gTrace.count - mark)];
        NSDictionary *exit = nil;
        BOOL entered = NO;
        for (NSDictionary *entry in during) {
          if ([entry[@"diag"] isEqual:@"monitorEntry"]) entered = YES;
          if ([entry[@"diag"] isEqual:@"monitorExit"]) exit = entry;
        }
        [log addObject:@{
          @"phase" : phase,
          @"dispatch" : @"app",
          @"time" : @(event.timestamp),
          @"atMs" : @(atMs),
          @"lateMs" : s[@"atMs"] ? @(atMs - [s[@"atMs"] doubleValue]) : @0,
          @"nsPhase" : @(event.phase),
          @"nsMomentumPhase" : @(event.momentumPhase),
          @"scrollingDeltaX" : @(event.scrollingDeltaX),
          @"scrollingDeltaY" : @(event.scrollingDeltaY),
          @"monitorEntered" : @(entered),
          @"monitorSwallowed" : exit ? exit[@"swallowed"] : NSNull.null,
          @"seq" : @(gGesture.seq),
          @"state" : @((int)gGesture.state),
          @"targetWindow" : @(gGesture.target.window.windowNumber),
        }];
      } else {
        NSEvent *out = HandleScroll(event, event.window, event.locationInWindow, ignoreSystemPreference);
        [log addObject:@{
          @"phase" : phase,
          @"time" : @(event.timestamp),
          @"atMs" : @(atMs),
          @"lateMs" : s[@"atMs"] ? @(atMs - [s[@"atMs"] doubleValue]) : @0,
          @"nsPhase" : @(event.phase),
          @"nsMomentumPhase" : @(event.momentumPhase),
          @"scrollingDeltaX" : @(event.scrollingDeltaX),
          @"scrollingDeltaY" : @(event.scrollingDeltaY),
          @"seq" : @(gGesture.seq),
          @"state" : @((int)gGesture.state),
          @"swallowed" : @(out == nil),
          @"renderer" : gGesture.renderer ? @((int)gGesture.renderer.scroll) : @(-1),
          @"targetWindow" : @(gGesture.target.window.windowNumber),
        }];
        if (out) [window sendEvent:out];
      }
      gWrongRendererHit = NO;
      gLegacyHitRouting = NO;
    }
    NSDictionary *following = index < steps.count ? steps[index] : nil;
    int64_t delayNs = following[@"atMs"]
                          ? (int64_t)(startNs + llround([following[@"atMs"] doubleValue] * 1e6)) - (int64_t)clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
                          : (int64_t)llround((s[@"delayMs"] ? [s[@"delayMs"] doubleValue] : 16) * 1e6);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, MAX(delayNs, (int64_t)0)), dispatch_get_main_queue(), next);
  };
  next = step;
  step();
}

@end
