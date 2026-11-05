#import "ArdiaSwipeInternal.h"

using namespace ardia_swipe;

namespace {

constexpr CGFloat kStartDistance = 4;

constexpr CGFloat kStartDominance = 1.5;

constexpr CGFloat kCancelDominance = 2;

}

namespace ardia_swipe {

NSMutableArray *gTrace;

}

#define Diag(...)                                   \
  do {                                              \
    if (gTrace) [gTrace addObject:(__VA_ARGS__)];   \
  } while (0)

namespace ardia_swipe {

BOOL gWrongRendererHit;

BOOL gLegacyHitRouting;

}

namespace ardia_swipe {

NSArray *RectValue(NSRect r) {
  return @[ @(r.origin.x), @(r.origin.y), @(r.size.width), @(r.size.height) ];
}

NSHashTable<NSView<ArdiaSwipeTarget> *> *Targets() {
  static NSHashTable *targets = [NSHashTable weakObjectsHashTable];
  return targets;
}

}

namespace ardia_swipe {

Gesture gGesture;

}

namespace {

int gGestureSeq;

id gMonitor;

__weak NSView<ArdiaSwipeTarget> *gPrepared;

struct OwnedMomentum {
  __weak NSWindow *window;
  NSTimeInterval endedAt = 0;
  BOOL armed = NO, flowing = NO;
};

OwnedMomentum gMomentum;

constexpr NSTimeInterval kMomentumStartWait = 0.1;

}

namespace {

void ReleasePrepared(NSTimeInterval timestamp) {
  NSView<ArdiaSwipeTarget> *prepared = gPrepared;
  gPrepared = nil;
  if (!prepared) return;
  Diag(@{@"diag" : @"pagerAbandon", @"target" : [NSString stringWithFormat:@"%p", prepared]});
  [prepared pagerInput:@"abandon" distance:0 direction:0 timestamp:timestamp];
}

void Emit(NSString *phase, CGFloat velocity) {
  NSView<ArdiaSwipeTarget> *target = gGesture.target;
  if (!target) return;
  CGFloat distance = gGesture.dx * gGesture.direction;
  Diag(@{
    @"diag" : @"emit",
    @"seq" : @(gGesture.seq),
    @"n" : @(++gGesture.emitted),
    @"phase" : phase,
    @"direction" : gGesture.direction > 0 ? @"back" : @"forward",
    @"distance" : @(distance),
    @"dx" : @(gGesture.dx),
    @"dy" : @(gGesture.dy),
    @"velocity" : @(velocity * gGesture.direction),
    @"available" : @(gGesture.available),
    @"width" : @(NSWidth(target.bounds)),
    @"target" : [NSString stringWithFormat:@"%p", target],
  });
  if (HasNativePager(target)) {
    [target pagerInput:phase distance:distance direction:gGesture.direction timestamp:gGesture.time];
    return;
  }
  [target swipeEvent:@{
    @"phase" : phase,
    @"direction" : gGesture.direction > 0 ? @"back" : @"forward",
    @"distance" : @(distance),
    @"dy" : @(gGesture.dy),
    @"velocity" : @(velocity * gGesture.direction),
    @"available" : @(gGesture.available),
    @"width" : @(NSWidth(target.bounds)),
  }];
}

void Sample(NSEvent *event) {
  int i = gGesture.samples++ % 6;
  gGesture.times[i] = event.timestamp;
  gGesture.deltas[i] = event.scrollingDeltaX;
}

CGFloat ReleaseVelocity(NSTimeInterval now) {
  int n = MIN(gGesture.samples, 6);
  CGFloat sum = 0;
  NSTimeInterval oldest = now;
  for (int k = 0; k < n; k++) {
    if (now - gGesture.times[k] > 0.1) continue;
    sum += gGesture.deltas[k];
    oldest = MIN(oldest, gGesture.times[k]);
  }
  return now - oldest > 0.004 ? sum / (now - oldest) : 0;
}

NSEvent *HandleWheel(NSEvent *event, NSWindow *window, NSPoint location) {
  CGFloat dx = event.scrollingDeltaX;
  if (fabs(dx) <= fabs(event.scrollingDeltaY)) return event;
  NSView<ArdiaSwipeTarget> *target = nil;
  BOOL fallback = NO;
  NSView *hit = ResolveHit(window, location, &target, &fallback);
  if (!target || !IsPager(target)) {
    Diag(@{@"diag" : @"wheel", @"reject" : target ? @"notPager" : @"noTarget", @"hit" : HitChain(hit)});
    return event;
  }
  BOOL back = (dx > 0) == event.isDirectionInvertedFromDevice;
  if (NativeContentScrolls(hit, target.superview, back ? 1 : -1)) {
    Diag(@{@"diag" : @"wheel", @"reject" : @"nativeContentScrolls", @"scrollers" : NativeScrollReport(hit, target.superview)});
    return event;
  }
  [target swipeEvent:@{
    @"phase" : @"wheel",
    @"direction" : back ? @"back" : @"forward",
    @"distance" : @(fabs(dx)),
    @"dy" : @0,
    @"velocity" : @0,
    @"available" : @(back ? target.canSwipeBack : target.canSwipeForward),
    @"width" : @(NSWidth(target.bounds)),
  }];
  return nil;
}

void Prepare(NSWindow *window, NSPoint location, NSTimeInterval timestamp) {
  ReleasePrepared(timestamp);
  NSView<ArdiaSwipeTarget> *target = nil;
  BOOL fallback = NO;
  ResolveHit(window, location, &target, &fallback);
  if (!target || !HasNativePager(target)) return;
  Diag(@{@"diag" : @"pagerPrepare", @"target" : [NSString stringWithFormat:@"%p", target]});
  gPrepared = target;
  [target pagerInput:@"prepare" distance:0 direction:0 timestamp:timestamp];
}

void Begin(NSWindow *window, NSPoint location, BOOL ignoreSystemPreference, NSTimeInterval timestamp) {
  if (gGesture.state == State::Tracking && HasNativePager(gGesture.target))
    [gGesture.target pagerInput:@"abandon" distance:0 direction:0 timestamp:timestamp];
  gGesture = Gesture();
  gGesture.ignoreSystemPreference = ignoreSystemPreference;
  gGesture.seq = ++gGestureSeq;
  NSView<ArdiaSwipeTarget> *target = nil;
  BOOL fallback = NO;
  NSView *hit = ResolveHit(window, location, &target, &fallback);
  if (gTrace) {
    NSMutableArray *why = [NSMutableArray array];
    NSView *raw = HitView(window, location);
    if (gWrongRendererHit) raw = FirstRenderer(window.contentView) ?: raw;
    TargetAt(window, location, raw, why);
    Diag(@{@"diag" : @"hitRouting", @"seq" : @(gGesture.seq), @"raw" : HitChain(raw), @"fallback" : @(fallback),
           @"wrongRendererHit" : @(gWrongRendererHit), @"legacyHitRouting" : @(gLegacyHitRouting)});
    Diag(@{
      @"diag" : @"begin",
      @"seq" : @(gGesture.seq),
      @"window" : @(window.windowNumber),
      @"location" : @[ @(location.x), @(location.y) ],
      @"hit" : HitChain(hit),
      @"targets" : why,
      @"target" : target ? [NSString stringWithFormat:@"%p", target] : @"",
      @"canSwipeBack" : @(target.canSwipeBack),
      @"canSwipeForward" : @(target.canSwipeForward),
      @"scrollers" : NativeScrollReport(hit, target.superview),
      @"systemSwipe" : @(NSEvent.isSwipeTrackingFromScrollEventsEnabled),
      @"ignorePreference" : @(ignoreSystemPreference),
    });
  }
  if (!target || (!NSEvent.isSwipeTrackingFromScrollEventsEnabled && !ignoreSystemPreference && !IsPager(target))) {
    Diag(@{@"diag" : @"reject", @"seq" : @(gGesture.seq), @"reason" : target ? @"systemPreferenceOff" : (hit ? @"noTarget" : @"noHit")});
    gGesture.state = State::Ignored;
    ReleasePrepared(timestamp);
    return;
  }
  if (gPrepared != target) ReleasePrepared(timestamp);
  gGesture.state = State::Pending;
  gGesture.target = target;
  gGesture.hit = hit;
  ArdiaRendererScroll *renderer = RendererScrollFor(hit);
  [renderer reset];
  gGesture.renderer = renderer;
  gGesture.rendererHit = PageViewOf(hit) != nil;
}

BOOL Reject(NSString *reason, NSDictionary *extra = nil) {
  if (gTrace) {
    NSMutableDictionary *entry = [@{@"diag" : @"reject", @"seq" : @(gGesture.seq), @"reason" : reason, @"dx" : @(gGesture.dx), @"dy" : @(gGesture.dy)} mutableCopy];
    if (extra) [entry addEntriesFromDictionary:extra];
    [gTrace addObject:entry];
  }
  gGesture.state = State::Ignored;
  ReleasePrepared(gGesture.time);
  return NO;
}

BOOL Wait(NSString *reason) {
  Diag(@{@"diag" : @"wait", @"seq" : @(gGesture.seq), @"reason" : reason, @"dx" : @(gGesture.dx), @"dy" : @(gGesture.dy)});
  return NO;
}

BOOL ShouldTrack() {
  CGFloat dx = gGesture.dx, dy = gGesture.dy;
  NSView<ArdiaSwipeTarget> *target = gGesture.target;
  const CGFloat verticalIntent = IsPager(target) ? 3 * kStartDistance : kStartDistance;
  if (fabs(dy) >= verticalIntent && kCancelDominance * fabs(dx) < fabs(dy)) return Reject(@"verticalIntent");
  const BOOL below = HasNativePager(target) ? dx == 0 : fabs(dx) < kStartDistance;
  if (below || kStartDominance * fabs(dx) < fabs(dy)) return Wait(@"belowStart");
  int direction = dx > 0 ? 1 : -1;

  ArdiaRendererScroll *renderer = gGesture.renderer;
  if (renderer) {
    switch (renderer.scroll) {
      case RendererScroll::FirstUpdateConsumed:
        return Reject(@"rendererConsumed");
      case RendererScroll::FirstUpdateUnconsumed:
        break;
      default:
        return Wait(gTrace ? [NSString stringWithFormat:@"renderer%d", (int)renderer.scroll] : @"rendererAck");
    }
    if (!renderer.overscrolled) return Wait(@"rendererNoOverscroll");
    if (!renderer.overscrollAllowed) return Reject(@"overscrollBehavior");
  } else if (NativeContentScrolls(gGesture.hit, target.superview, direction)) {
    return Reject(@"nativeContentScrolls", gTrace ? @{@"direction" : @(direction), @"scrollers" : NativeScrollReport(gGesture.hit, target.superview)} : nil);
  }

  BOOL available = direction > 0 ? target.canSwipeBack : target.canSwipeForward;
  if (!available && !target.tracksUnavailableDirections) return Reject(@"unavailable", gTrace ? @{@"direction" : @(direction)} : nil);
  gGesture.direction = direction;
  gGesture.available = available;
  Diag(@{@"diag" : @"track", @"seq" : @(gGesture.seq), @"direction" : @(direction), @"available" : @(available), @"dx" : @(dx), @"dy" : @(dy),
         @"scrollers" : NativeScrollReport(gGesture.hit, target.superview)});
  return YES;
}

BOOL SwallowOwnedMomentum(NSEvent *event, NSWindow *window) {
  if (!gMomentum.armed) return NO;
  const NSEventPhase momentum = event.momentumPhase;
  if (!gMomentum.flowing) {
    gMomentum.flowing = window == gMomentum.window && (momentum & NSEventPhaseBegan) &&
                        event.timestamp - gMomentum.endedAt <= kMomentumStartWait;
    if (!gMomentum.flowing) {
      gMomentum = OwnedMomentum();
      return NO;
    }
  } else if (window != gMomentum.window) {
    return NO;
  }
  if (momentum & (NSEventPhaseEnded | NSEventPhaseCancelled)) gMomentum = OwnedMomentum();
  Diag(@{@"diag" : @"ownMomentum", @"seq" : @(gGesture.seq), @"momentum" : @(momentum)});
  return YES;
}

}

namespace ardia_swipe {

NSEvent *HandleScroll(NSEvent *event, NSWindow *window, NSPoint location, BOOL ignoreSystemPreference) {
  NSEventPhase phase = event.phase;
  if (phase == NSEventPhaseNone && event.momentumPhase == NSEventPhaseNone) return HandleWheel(event, window, location);
  if (!event.hasPreciseScrollingDeltas) {
    Diag(@{@"diag" : @"pass", @"reason" : @"notPrecise"});
    return event;
  }

  if (phase == NSEventPhaseNone) return SwallowOwnedMomentum(event, window) ? nil : event;
  gMomentum = OwnedMomentum();
  if (phase & NSEventPhaseMayBegin) {
    Prepare(window, location, event.timestamp);
    return event;
  }
  if (phase & NSEventPhaseBegan) Begin(window, location, ignoreSystemPreference, event.timestamp);

  switch (gGesture.state) {
    case State::Idle:
    case State::Ignored:
      if (phase & (NSEventPhaseEnded | NSEventPhaseCancelled)) ReleasePrepared(event.timestamp);
      return event;
    case State::Pending:
    case State::Tracking:
      break;
  }
  if (!gGesture.target) {
    Reject(@"targetGone");
    return event;
  }

  gGesture.dx += event.scrollingDeltaX;
  gGesture.dy += event.scrollingDeltaY;
  gGesture.time = event.timestamp;
  Sample(event);

  if (phase & (NSEventPhaseEnded | NSEventPhaseCancelled)) {
    if (gGesture.state != State::Tracking) {
      Diag(@{@"diag" : @"endUntracked", @"seq" : @(gGesture.seq), @"dx" : @(gGesture.dx), @"dy" : @(gGesture.dy)});
      gGesture.state = State::Idle;
      ReleasePrepared(event.timestamp);
      return event;
    }
    Emit(phase & NSEventPhaseEnded ? @"ended" : @"cancelled", ReleaseVelocity(event.timestamp));
    gGesture.state = State::Idle;
    if (!gGesture.rendererHit) gMomentum = {window, event.timestamp, YES, NO};
    return event;
  }

  if (gGesture.state == State::Pending) {
    if (!ShouldTrack()) return event;
    gGesture.state = State::Tracking;
    if (gPrepared == gGesture.target) gPrepared = nil;
    Emit(@"began", 0);
    return nil;
  }
  if (!IsPager(gGesture.target) && !gGesture.target.allowsVerticalMotion && kCancelDominance * fabs(gGesture.dx) < fabs(gGesture.dy)) {
    Emit(@"cancelled", 0);
    gGesture.state = State::Ignored;
    return event;
  }
  Emit(@"changed", ReleaseVelocity(event.timestamp));
  return nil;
}

BOOL HandleDiscreteSwipe(NSWindow *window, NSPoint location, CGFloat deltaX) {
  if (fabs(deltaX) < 0.5) return NO;
  NSView *hit = HitView(window, location);
  NSView<ArdiaSwipeTarget> *target = TargetAt(window, location, hit);
  if (!target) return NO;
  BOOL back = deltaX > 0;
  if (!(back ? target.canSwipeBack : target.canSwipeForward)) return NO;
  [target swipeEvent:@{
    @"phase" : @"swipe",
    @"direction" : back ? @"back" : @"forward",
    @"distance" : @0,
    @"dy" : @0,
    @"velocity" : @0,
    @"available" : @YES,
    @"width" : @(NSWidth(target.bounds)),
  }];
  return YES;
}

}

namespace {

void InstallMonitor() {
  if (gMonitor) return;
  gMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel | NSEventMaskSwipe
                                                   handler:^NSEvent *(NSEvent *event) {
                                                     Diag(@{
                                                       @"diag" : @"monitorEntry",
                                                       @"type" : @(event.type),
                                                       @"window" : @(event.window.windowNumber),
                                                       @"phase" : @(event.phase),
                                                       @"momentum" : event.type == NSEventTypeScrollWheel ? @(event.momentumPhase) : @(-1),
                                                       @"timestamp" : @(event.timestamp),
                                                     });
                                                     NSEvent *out = event.type == NSEventTypeSwipe
                                                                        ? (HandleDiscreteSwipe(event.window, event.locationInWindow, event.deltaX) ? nil : event)
                                                                        : HandleScroll(event, event.window, event.locationInWindow, NO);
                                                     Diag(@{@"diag" : @"monitorExit", @"resultWindow" : out ? @(out.window.windowNumber) : @(-1), @"swallowed" : @(out == nil)});
                                                     return out;
                                                   }];
}

}

@implementation ArdiaSwipe

+ (void)performHaptic:(NSString *)pattern {
  NSHapticFeedbackPattern p = [pattern isEqualToString:@"levelChange"] ? NSHapticFeedbackPatternLevelChange
                              : [pattern isEqualToString:@"alignment"]  ? NSHapticFeedbackPatternAlignment
                                                                         : NSHapticFeedbackPatternGeneric;
  NSHapticFeedbackPerformanceTime time = p == NSHapticFeedbackPatternLevelChange ? NSHapticFeedbackPerformanceTimeDefault
                                                                                  : NSHapticFeedbackPerformanceTimeNow;
  [NSHapticFeedbackManager.defaultPerformer performFeedbackPattern:p performanceTime:time];
}

+ (void)addTarget:(NSView<ArdiaSwipeTarget> *)target {
  [Targets() addObject:target];
  InstallMonitor();
}

+ (void)removeTarget:(NSView<ArdiaSwipeTarget> *)target {
  [Targets() removeObject:target];
}

@end
