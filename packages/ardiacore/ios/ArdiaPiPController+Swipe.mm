#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaChromeWindowHost.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

using namespace ardia_pip;

@implementation ArdiaPiPController (Swipe)

static __weak NSWindow *gSwipeWindow;
static __weak NSWindow *gSwipeMomentum;

+ (void)abandonSwipeOn:(NSWindow *)window {
  if (!window) return;
  if (gSwipeWindow == window) gSwipeWindow = nil;
  [[self forWindow:window] abandonSwipe];
}

+ (ArdiaPiPController *)swipeTargetFor:(NSEvent *)event {
  NSWindow *window = event.window;
  if (!window) {
    const NSPoint point = PointerOf(event);
    for (NSWindow *candidate in NSApp.orderedWindows)
      if (candidate.visible && NSPointInRect(point, candidate.frame)) {
        window = candidate;
        break;
      }
  }
  ArdiaPiPController *controller = window ? [self forWindow:window] : nil;
  return controller && window.visible ? controller : nil;
}

+ (BOOL)handleSwipe:(NSEvent *)event {
  if (event.type != NSEventTypeScrollWheel) return NO;
  const NSEventPhase phase = event.phase, momentum = event.momentumPhase;
  if (momentum != NSEventPhaseNone) {
    const BOOL ours = gSwipeMomentum != nil;
    if (momentum & (NSEventPhaseEnded | NSEventPhaseCancelled)) gSwipeMomentum = nil;
    return ours;
  }
  if (phase == NSEventPhaseNone) return NO;
  if (phase & (NSEventPhaseBegan | NSEventPhaseMayBegin)) {
    gSwipeMomentum = nil;
    [self abandonSwipeOn:gSwipeWindow];
    if (phase != NSEventPhaseBegan || !ThrowEnabled() || !event.hasPreciseScrollingDeltas ||
        (event.modifierFlags & NSEventModifierFlagCommand))
      return NO;
    ArdiaPiPController *controller = [self swipeTargetFor:event];
    if (!controller) return NO;
    gSwipeWindow = controller.window;
    [controller swipeBegan:event];
    return YES;
  }
  NSWindow *window = gSwipeWindow;
  ArdiaPiPController *controller = window ? [self forWindow:window] : nil;
  if (!controller) return NO;
  if (phase & (NSEventPhaseEnded | NSEventPhaseCancelled)) {
    gSwipeWindow = nil;
    gSwipeMomentum = window;
    [controller swipeEnded:event cancelled:(phase & NSEventPhaseCancelled) != 0];
  } else {
    [controller swipeMoved:event];
  }
  return YES;
}

- (void)devSwipe:(NSArray<NSString *> *)args {
  const double fx = args.count > 0 ? args[0].doubleValue : 0, fy = args.count > 1 ? args[1].doubleValue : 0;
  const int steps = MAX(1, args.count > 2 ? args[2].intValue : 10);
  NSString *mode = args.count > 3 ? args[3] : @"trackpad";
  const BOOL wheel = [mode isEqual:@"wheel"], command = [mode isEqual:@"command"];
  const double pause = [mode isEqual:@"pause"] ? 0.3 : 0;
  NSWindow *window = _window;
  NSEvent * (^make)(CGScrollPhase, CGMomentumScrollPhase, double, double) =
      ^NSEvent *(CGScrollPhase phase, CGMomentumScrollPhase momentum, double fdx, double fdy) {
        CGEventRef cg = CGEventCreateScrollWheelEvent2(nullptr, kCGScrollEventUnitPixel, 2, 0, 0, 0);
        const NSRect f = window.frame;
        CGEventSetLocation(cg, CGPointMake(NSMidX(f), NSMaxY(NSScreen.screens.firstObject.frame) - NSMidY(f)));
        CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, wheel ? 0 : 1);
        CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase, wheel ? 0 : phase);
        CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, momentum);
        CGEventSetFlags(cg, command ? kCGEventFlagMaskCommand : 0);
        const BOOL inverted = [NSEvent eventWithCGEvent:cg].isDirectionInvertedFromDevice;
        const double sdx = inverted ? fdx : -fdx, sdy = inverted ? -fdy : fdy;
        if (wheel) {
          CGEventSetIntegerValueField(cg, kCGScrollWheelEventDeltaAxis1, lround(sdy / 10));
          CGEventSetIntegerValueField(cg, kCGScrollWheelEventDeltaAxis2, lround(sdx / 10));
        } else {
          CGEventSetIntegerValueField(cg, kCGScrollWheelEventPointDeltaAxis1, lround(sdy));
          CGEventSetIntegerValueField(cg, kCGScrollWheelEventPointDeltaAxis2, lround(sdx));
          CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis1, sdy);
          CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis2, sdx);
        }
        NSEvent *event = [NSEvent eventWithCGEvent:cg];
        CFRelease(cg);
        return event;
      };
  auto post = [=](double seconds, CGScrollPhase phase, CGMomentumScrollPhase momentum, double fdx, double fdy) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [NSApp postEvent:make(phase, momentum, fdx, fdy) atStart:NO];
    });
  };
  const double interval = 1.0 / 120;
  post(0, kCGScrollPhaseBegan, kCGMomentumScrollPhaseNone, 0, 0);
  for (int i = 1; i <= steps; i++) post(i * interval, kCGScrollPhaseChanged, kCGMomentumScrollPhaseNone, fx / steps, fy / steps);
  const double end = (steps + 1) * interval + pause;
  post(end, kCGScrollPhaseEnded, kCGMomentumScrollPhaseNone, 0, 0);
  if ([mode isEqual:@"momentum"]) {
    post(end + interval, (CGScrollPhase)0, kCGMomentumScrollPhaseBegin, fx / steps, fy / steps);
    for (int i = 2; i <= 6; i++) post(end + i * interval, (CGScrollPhase)0, kCGMomentumScrollPhaseContinue, fx / steps / i, fy / steps / i);
    post(end + 7 * interval, (CGScrollPhase)0, kCGMomentumScrollPhaseEnd, 0, 0);
  }
}

- (void)devDrag:(NSArray<NSString *> *)args {
  const double fx = args.count > 0 ? args[0].doubleValue : 0, fy = args.count > 1 ? args[1].doubleValue : 0;
  const int steps = MAX(1, args.count > 2 ? args[2].intValue : 10);
  const double interval = (args.count > 3 ? args[3].doubleValue : 8) / 1000, pause = (args.count > 4 ? args[4].doubleValue : 0) / 1000;
  NSWindow *window = _window;
  const NSRect frame = window.frame;
  const NSPoint grab = NSMakePoint(NSWidth(frame) * 0.5, NSHeight(frame) * 0.3);
  const NSPoint start = NSMakePoint(NSMinX(frame) + grab.x, NSMinY(frame) + grab.y);
  auto post = [=](double seconds, NSEventType type, NSPoint screen) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      const NSPoint local = NSMakePoint(screen.x - NSMinX(window.frame), screen.y - NSMinY(window.frame));
      [NSApp postEvent:[NSEvent mouseEventWithType:type location:local modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                                      windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1
                                          pressure:type == NSEventTypeLeftMouseUp ? 0 : 1]
               atStart:NO];
    });
  };
  post(0, NSEventTypeLeftMouseDown, start);
  for (int i = 1; i <= steps; i++)
    post(i * interval, NSEventTypeLeftMouseDragged, NSMakePoint(start.x + fx * i / steps, start.y + fy * i / steps));
  post(steps * interval + pause + 0.004, NSEventTypeLeftMouseUp, NSMakePoint(start.x + fx, start.y + fy));
}

@end
