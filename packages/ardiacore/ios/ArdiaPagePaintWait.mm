#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"

using namespace ardia_web_view;
using namespace ardia_runtime;

namespace {

constexpr NSTimeInterval kAskAgainSeconds = 0.008;
constexpr CGFloat kUnpaintedPageZ = -1;

NSString *const kAnswerSizeOncePainted =
    @"const answer = () => post('result', JSON.stringify([innerWidth * devicePixelRatio, innerHeight * devicePixelRatio, devicePixelRatio]));"
    @"const content = 'first-contentful-paint';"
    @"if (performance.getEntriesByName(content).length) return requestAnimationFrame(() => requestAnimationFrame(answer));"
    @"new PerformanceObserver((entries, observer) => {"
    @"  if (!entries.getEntriesByName(content).length) return;"
    @"  observer.disconnect();"
    @"  answer();"
    @"}).observe({ type: 'paint', buffered: true });";

NSMapTable<ArdiaCoreTab *, ArdiaPagePaintWait *> *Waits() {
  static NSMapTable *waits = [NSMapTable weakToStrongObjectsMapTable];
  return waits;
}

NSSize PixelsOf(NSView *page) {
  return [page convertSizeToBacking:page.bounds.size];
}
}

@implementation ArdiaPagePaintWait {
  __weak ArdiaCoreTab *_tab;
  NSMutableArray<void (^)(ArdiaPagePaint paint)> *_then;
  NSUInteger _question;
  int _askedDocument;
  CFTimeInterval _began;
}

+ (BOOL)awaits:(ArdiaCoreTab *)tab {
  return tab && [Waits() objectForKey:tab];
}

+ (void)keepUnderUntilPainted:(ArdiaCoreTab *)tab {
  NSView *page = tab.view;
  if (!page.layer || [self awaits:tab]) return;
  WithoutActions(^{
    page.layer.zPosition = kUnpaintedPageZ;
  });
  __weak NSView *weakPage = page;
  [self tab:tab paints:^(ArdiaPagePaint paint) {
    WithoutActions(^{
      weakPage.layer.zPosition = 0;
    });
  }];
}

+ (void)tab:(ArdiaCoreTab *)tab paints:(void (^)(ArdiaPagePaint paint))then {
  if (ArdiaPagePaintWait *running = [Waits() objectForKey:tab]) return [running->_then addObject:then];
  ArdiaPagePaintWait *wait = [ArdiaPagePaintWait new];
  wait->_tab = tab;
  wait->_then = [NSMutableArray arrayWithObject:then];
  wait->_began = CACurrentMediaTime();
  [Waits() setObject:wait forKey:tab];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPagePaintWaitSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [wait finish:wait.onScreen ? ArdiaPagePaintLate : ArdiaPagePaintNeverShown];
  });
  [wait ask];
}

- (BOOL)onScreen {
  ArdiaCoreTab *tab = _tab;
  NSView *page = tab.view;
  return tab && !tab.closed && page.window && !page.isHiddenOrHasHiddenAncestor;
}

- (void)finish:(ArdiaPagePaint)paint {
  NSArray<void (^)(ArdiaPagePaint paint)> *then = _then;
  if (!then) return;
  _then = nil;
  ArdiaCoreTab *tab = _tab;
  if (tab) [Waits() removeObjectForKey:tab];
  if (TraceVisibility())
    NSLog(@"[ardiacore-vis] tab=%d new page %@ after %.0f ms", tab ? (int)tab.tabId : -1,
          paint == ArdiaPagePaintDrawn ? @"painted" : paint == ArdiaPagePaintLate ? @"shown unpainted" : @"left before it painted",
          (CACurrentMediaTime() - _began) * 1000);
  for (void (^block)(ArdiaPagePaint paint) in then) block(paint);
}

- (void)askSoon {
  __weak ArdiaPagePaintWait *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kAskAgainSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [weakSelf ask];
  });
}

- (void)ask {
  if (!_then) return;
  ArdiaCoreTab *tab = _tab;
  NSView *page = tab.view;
  if (!tab || tab.closed || !page.window) return [self finish:ArdiaPagePaintNeverShown];
  if (tab.committedInitial) return [self askSoon];
  const NSSize asked = PixelsOf(page);
  const NSUInteger question = ++_question;
  _askedDocument = tab.committedDocumentCount;
  __weak ArdiaPagePaintWait *weakSelf = self;
  [tab evaluate:kAnswerSizeOncePainted
     completion:^(NSString *json) {
       [weakSelf answered:json to:question askedAt:asked];
     }];
}

- (void)answered:(NSString *)json to:(NSUInteger)question askedAt:(NSSize)asked {
  if (!_then || question != _question) return;
  if (_tab.committedDocumentCount != _askedDocument) return [self ask];
  NSArray<NSNumber *> *painted = json ? JSONObject(json) : nil;
  if (![painted isKindOfClass:NSArray.class] || painted.count != 3 || ![painted[0] isKindOfClass:NSNumber.class] ||
      ![painted[1] isKindOfClass:NSNumber.class] || ![painted[2] isKindOfClass:NSNumber.class])
    return [self askSoon];
  const NSSize now = PixelsOf(_tab.view);
  const CGFloat slack = MAX(2, painted[2].doubleValue);
  if (NSEqualSizes(asked, now) && fabs(painted[0].doubleValue - now.width) <= slack && fabs(painted[1].doubleValue - now.height) <= slack)
    return [self finish:ArdiaPagePaintDrawn];
  [self ask];
}

@end
