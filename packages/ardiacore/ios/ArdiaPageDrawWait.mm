#import "ArdiaChromeWindowInternal.h"
#import "ArdiaLaunchConfig.h"

static const NSTimeInterval kPageDrawWait = 0.4;

@implementation ArdiaPageDrawWait {
  __weak ArdiaCoreTab *_tab;
  NSInteger (^_test)(BOOL fullScreen, BOOL fills);
  void (^_done)(void);
}

+ (void)tab:(ArdiaCoreTab *)tab draws:(NSInteger (^)(BOOL fullScreen, BOOL fills))test then:(void (^)(void))done {
  NSView *page = tab.view;
  if (!page.window || page.isHiddenOrHasHiddenAncestor) return done();
  ArdiaPageDrawWait *wait = [ArdiaPageDrawWait new];
  wait->_tab = tab;
  wait->_test = test;
  wait->_done = done;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPageDrawWait * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    if (wait->_done && [ArdiaLaunchConfig.shared traced:@"visibility"]) NSLog(@"[ardiacore-vis] full screen: the page didn't draw in time");
    [wait finish];
  });
  [wait ask];
}

- (void)finish {
  void (^done)(void) = _done;
  _done = nil;
  if (done) done();
}

- (void)ask {
  ArdiaCoreTab *tab = _tab;
  NSView *page = tab.view;
  if (!_done) return;
  if (!page.window) return [self finish];
  const NSSize asked = [page convertRect:page.bounds toView:nil].size;
  __weak ArdiaPageDrawWait *weakSelf = self;
  [tab evaluate:@"requestAnimationFrame(() => requestAnimationFrame(() => post('result', JSON.stringify("
                @"[innerWidth * devicePixelRatio, innerHeight * devicePixelRatio, !!document.fullscreenElement]))))"
     completion:^(NSString *json) {
       [weakSelf answered:json asked:asked];
     }];
}

- (void)answered:(NSString *)json asked:(NSSize)asked {
  if (!_done) return;
  NSView *page = _tab.view;
  NSWindow *window = page.window;
  if (!window || !json) return [self finish];
  NSArray *drawn = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![drawn isKindOfClass:NSArray.class] || drawn.count != 3 || ![drawn[0] isKindOfClass:NSNumber.class] ||
      ![drawn[1] isKindOfClass:NSNumber.class] || ![drawn[2] isKindOfClass:NSNumber.class])
    return [self finish];
  const NSSize now = [page convertRect:page.bounds toView:nil].size, pixels = [page convertSizeToBacking:page.bounds.size];
  const NSSize content = window.contentView.bounds.size;
  const BOOL fills = fabs(now.width - content.width) < 1 && fabs(now.height - content.height) < 1;
  const BOOL sized = NSEqualSizes(asked, now) && fabs([drawn[0] doubleValue] - pixels.width) <= 2 &&
                     fabs([drawn[1] doubleValue] - pixels.height) <= 2;
  const NSInteger drew = sized ? _test([drawn[2] boolValue], fills) : 0;
  if ([ArdiaLaunchConfig.shared traced:@"visibility"])
    NSLog(@"[ardiacore-vis] full screen: page drew %@, its view %@ (fills=%d) -> %ld", json, NSStringFromSize(pixels), fills, (long)drew);
  if (drew) return [self finish];
  [self ask];
}

@end
