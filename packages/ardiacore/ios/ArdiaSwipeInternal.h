#import "ArdiaSwipe.h"

namespace ardia_swipe {

enum class RendererScroll { Idle, AwaitingBegin, AwaitingFirstUpdate, FirstUpdateUnconsumed, FirstUpdateConsumed };

}

@interface ArdiaRendererScrollObserver : NSObject {
 @public
  NSObject *_original;
}
- (instancetype)initWithOriginal:(NSObject *)original;
- (void)reset;
@property (nonatomic) ardia_swipe::RendererScroll scroll;
@property (nonatomic) BOOL overscrolled;
@property (nonatomic) BOOL overscrollAllowed;
@end

namespace ardia_swipe {

enum class State { Idle, Pending, Tracking, Ignored };

struct Gesture {
  State state = State::Idle;
  __weak NSView<ArdiaSwipeTarget> *target;
  __weak ArdiaRendererScrollObserver *renderer;
  __weak NSView *hit;
  BOOL rendererHit = NO;
  CGFloat dx = 0, dy = 0;
  int direction = 0;
  BOOL available = NO;
  NSTimeInterval times[6] = {};
  CGFloat deltas[6] = {};
  int samples = 0;
  BOOL ignoreSystemPreference = NO;
  int seq = 0;
  int emitted = 0;
  NSTimeInterval time = 0;
};

}

namespace ardia_swipe {

constexpr size_t kInputEventTypeOffset = 40;
constexpr int kGestureScrollBegin = 11;
constexpr int kGestureScrollUpdate = 13;
constexpr size_t kOverscrollBehaviorOffset = 32;
constexpr int kOverscrollBehaviorAuto = 1;
extern NSMutableArray *gTrace;
extern BOOL gWrongRendererHit;
extern BOOL gLegacyHitRouting;
extern Gesture gGesture;
NSEvent *HandleScroll(NSEvent *event, NSWindow *window, NSPoint location, BOOL ignoreSystemPreference);
BOOL HandleDiscreteSwipe(NSWindow *window, NSPoint location, CGFloat deltaX);

NSArray *RectValue(NSRect r);
NSHashTable<NSView<ArdiaSwipeTarget> *> *Targets();
BOOL IsRenderWidgetView(NSView *view);
ArdiaRendererScrollObserver *ObserverFor(NSView *hit);
BOOL InRenderer(NSView *hit);
NSView *HitView(NSWindow *window, NSPoint locationInWindow);
NSView<ArdiaSwipeTarget> *TargetAt(NSWindow *window, NSPoint locationInWindow, NSView *hit, NSMutableArray *why = nil);
NSArray *HitChain(NSView *hit);
BOOL IsPager(NSView<ArdiaSwipeTarget> *target);
BOOL HasNativePager(NSView<ArdiaSwipeTarget> *target);
NSView *FirstRenderer(NSView *view);
NSView *ReactRoot(NSView *view, NSWindow *window);
NSView<ArdiaSwipeTarget> *MisroutedRendererTarget(NSWindow *window, NSPoint location, NSView *hit);
NSView *ResolveHit(NSWindow *window, NSPoint location, NSView<ArdiaSwipeTarget> *__strong *target, BOOL *fallback);
BOOL NativeContentScrolls(NSView *hit, NSView *container, int direction);
NSArray *NativeScrollReport(NSView *hit, NSView *container);

}
