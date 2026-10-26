#import "ArdiaSwipeInternal.h"
#import "ArdiaChromeWindowHost.h"

#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>

using namespace ardia_swipe;

@implementation ArdiaRendererScrollObserver

- (instancetype)initWithOriginal:(NSObject *)original {
  if ((self = [super init])) _original = original;
  return self;
}

- (BOOL)respondsToSelector:(SEL)selector {
  return [super respondsToSelector:selector] || [_original respondsToSelector:selector];
}

- (id)forwardingTargetForSelector:(SEL)selector {
  return [_original respondsToSelector:selector] ? _original : [super forwardingTargetForSelector:selector];
}

- (void)reset {
  _scroll = RendererScroll::AwaitingBegin;
  _overscrolled = NO;
  _overscrollAllowed = NO;
}

- (void)rendererHandledGestureScrollEvent:(const void *)event consumed:(BOOL)consumed {
  if ([_original respondsToSelector:_cmd])
    ((void (*)(id, SEL, const void *, BOOL))objc_msgSend)(_original, _cmd, event, consumed);
  int type = *reinterpret_cast<const int32_t *>(static_cast<const char *>(event) + kInputEventTypeOffset);
  if (gTrace) [gTrace addObject:@{@"ack" : @"gesture", @"raw" : [self words:event count:12], @"consumed" : @(consumed)}];
  if (type == kGestureScrollBegin) {
    if (_scroll == RendererScroll::AwaitingBegin) _scroll = RendererScroll::AwaitingFirstUpdate;
  } else if (type == kGestureScrollUpdate) {
    if (_scroll == RendererScroll::AwaitingFirstUpdate)
      _scroll = consumed ? RendererScroll::FirstUpdateConsumed : RendererScroll::FirstUpdateUnconsumed;
  }
}

- (void)rendererHandledOverscrollEvent:(const void *)params {
  if ([_original respondsToSelector:_cmd]) ((void (*)(id, SEL, const void *))objc_msgSend)(_original, _cmd, params);
  const char *p = static_cast<const char *>(params);
  int behaviorX = *reinterpret_cast<const int32_t *>(p + kOverscrollBehaviorOffset);
  if (gTrace) [gTrace addObject:@{@"ack" : @"overscroll", @"raw" : [self words:params count:10]}];
  _overscrolled = YES;
  _overscrollAllowed = behaviorX == kOverscrollBehaviorAuto;
}

- (BOOL)handleEvent:(NSEvent *)event {
  if (event.type == NSEventTypeScrollWheel || ![_original respondsToSelector:_cmd]) return NO;
  return ((BOOL (*)(id, SEL, NSEvent *))objc_msgSend)(_original, _cmd, event);
}

- (void)touchesBeganWithEvent:(NSEvent *)event {
  if ([_original respondsToSelector:_cmd]) [(id)_original touchesBeganWithEvent:event];
}
- (void)touchesMovedWithEvent:(NSEvent *)event {
  if ([_original respondsToSelector:_cmd]) [(id)_original touchesMovedWithEvent:event];
}
- (void)touchesCancelledWithEvent:(NSEvent *)event {
  if ([_original respondsToSelector:_cmd]) [(id)_original touchesCancelledWithEvent:event];
}
- (void)touchesEndedWithEvent:(NSEvent *)event {
  if ([_original respondsToSelector:_cmd]) [(id)_original touchesEndedWithEvent:event];
}

- (NSArray *)words:(const void *)p count:(int)count {
  NSMutableArray *out = [NSMutableArray array];
  for (int i = 0; i < count; i++) [out addObject:@(reinterpret_cast<const int32_t *>(p)[i])];
  return out;
}

@end
