#import "ArdiaSwipeInternal.h"
#import "ArdiaChromeWindowHost.h"

#import <objc/message.h>
#import <objc/runtime.h>

using namespace ardia_swipe;

namespace ardia_swipe {

BOOL IsRenderWidgetView(NSView *view) {
  static Class cls = NSClassFromString(@"RenderWidgetHostViewCocoa");
  return cls && [view isKindOfClass:cls];
}

ArdiaRendererScrollObserver *ObserverFor(NSView *hit) {
  static Ivar ivar = class_getInstanceVariable(NSClassFromString(@"RenderWidgetHostViewCocoa"), "_responderDelegate");
  for (NSView *v = hit; v; v = v.superview) {
    if (!IsRenderWidgetView(v)) continue;
    static const void *kKey = &kKey;
    ArdiaRendererScrollObserver *observer = objc_getAssociatedObject(v, kKey);
    if (!observer) {
      if (!ivar) return nil;
      NSObject *original = object_getIvar(v, ivar);
      observer = [[ArdiaRendererScrollObserver alloc] initWithOriginal:original];
      objc_setAssociatedObject(v, kKey, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      object_setIvar(v, ivar, observer);
    }
    return observer;
  }
  return nil;
}

BOOL InRenderer(NSView *hit) {
  for (NSView *v = hit; v; v = v.superview)
    if (IsRenderWidgetView(v)) return YES;
  return NO;
}

NSView *HitView(NSWindow *window, NSPoint locationInWindow) {
  NSView *frame = window.contentView.superview ?: window.contentView;
  return [frame hitTest:locationInWindow];
}

NSView<ArdiaSwipeTarget> *TargetAt(NSWindow *window, NSPoint locationInWindow, NSView *hit, NSMutableArray *why) {
  if (!hit) return nil;
  NSView<ArdiaSwipeTarget> *best = nil;
  for (NSView<ArdiaSwipeTarget> *target in Targets()) {
    NSView *container = target.superview;
    NSString *miss = target.window != window                    ? @"otherWindow"
                     : !container                                ? @"noSuperview"
                     : target.isHiddenOrHasHiddenAncestor        ? @"hidden"
                     : ![hit isDescendantOf:container]           ? @"hitOutsideContainer"
                     : !NSPointInRect([target convertPoint:locationInWindow fromView:nil], target.bounds) ? @"pointOutside"
                                                                 : nil;
    if (why) [why addObject:@{
      @"target" : [NSString stringWithFormat:@"%p", target],
      @"window" : @(target.window.windowNumber),
      @"inWindow" : RectValue([target convertRect:target.bounds toView:nil]),
      @"pager" : @(target.isPager),
      @"miss" : miss ?: @"",
    }];
    if (miss) continue;
    if (!best || [container isDescendantOf:best.superview]) best = target;
  }
  return best;
}

NSArray *HitChain(NSView *hit) {
  NSMutableArray *chain = [NSMutableArray array];
  for (NSView *v = hit; v; v = v.superview) {
    [chain addObject:@{
      @"class" : NSStringFromClass(v.class),
      @"frame" : RectValue(v.frame),
      @"inWindow" : RectValue([v convertRect:v.bounds toView:nil]),
      @"hidden" : @(v.isHidden),
    }];
  }
  return chain;
}

BOOL IsPager(NSView<ArdiaSwipeTarget> *target) {
  return target.isPager;
}

BOOL HasNativePager(NSView<ArdiaSwipeTarget> *target) {
  return IsPager(target) && target.hasNativePager;
}

NSView *FirstRenderer(NSView *view) {
  if (IsRenderWidgetView(view)) return view;
  for (NSView *sub in view.subviews)
    if (NSView *found = FirstRenderer(sub)) return found;
  return nil;
}

NSView *ReactRoot(NSView *view, NSWindow *window) {
  NSView *root = [ArdiaChromeWindowHost rootViewOfWindow:window];
  if (root && [view isDescendantOf:root]) return root;
  while (view.superview && view.superview != window.contentView) view = view.superview;
  return view;
}

NSView<ArdiaSwipeTarget> *MisroutedRendererTarget(NSWindow *window, NSPoint location, NSView *hit) {
  if (!IsRenderWidgetView(hit) || NSPointInRect([hit convertPoint:location fromView:nil], hit.bounds)) return nil;
  NSView *root = ReactRoot(hit, window);
  NSView<ArdiaSwipeTarget> *best = nil;
  for (NSView<ArdiaSwipeTarget> *target in Targets()) {
    NSView *container = target.superview;
    if (target.window != window || !container || target.isHiddenOrHasHiddenAncestor || !IsPager(target)) continue;
    if (!NSPointInRect([target convertPoint:location fromView:nil], target.bounds)) continue;
    if (ReactRoot(target, window) != root) continue;
    if (!best || [container isDescendantOf:best.superview]) best = target;
  }
  return best;
}

NSView *ResolveHit(NSWindow *window, NSPoint location, NSView<ArdiaSwipeTarget> *__strong *target, BOOL *fallback) {
  NSView *hit = HitView(window, location);
  if (gTrace && gWrongRendererHit) hit = FirstRenderer(window.contentView) ?: hit;
  *target = TargetAt(window, location, hit);
  *fallback = NO;
  if (*target || (gTrace && gLegacyHitRouting)) return hit;
  NSView<ArdiaSwipeTarget> *pager = MisroutedRendererTarget(window, location, hit);
  if (!pager) return hit;
  NSView *container = pager.superview;
  NSView *inner = [container hitTest:[container.superview convertPoint:location fromView:nil]];
  if (!inner || IsRenderWidgetView(inner) || inner.window != window || ![inner isDescendantOf:container]) return hit;
  if (!NSPointInRect([inner convertPoint:location fromView:nil], inner.bounds)) return hit;
  if (TargetAt(window, location, inner) != pager) return hit;
  *target = pager;
  *fallback = YES;
  return inner;
}

BOOL NativeContentScrolls(NSView *hit, NSView *container, int direction) {
  for (NSView *v = hit; v && v != container; v = v.superview) {
    if (![v isKindOfClass:NSScrollView.class]) continue;
    NSScrollView *scroll = (NSScrollView *)v;
    NSRect visible = scroll.contentView.bounds;
    CGFloat width = NSWidth(scroll.documentView.frame);
    if (width <= NSWidth(visible) + 0.5) continue;
    if (direction > 0 ? NSMinX(visible) > 0.5 : NSMaxX(visible) < width - 0.5) return YES;
  }
  return NO;
}

NSArray *NativeScrollReport(NSView *hit, NSView *container) {
  NSMutableArray *out = [NSMutableArray array];
  for (NSView *v = hit; v && v != container; v = v.superview) {
    if (![v isKindOfClass:NSScrollView.class]) continue;
    NSScrollView *scroll = (NSScrollView *)v;
    NSRect visible = scroll.contentView.bounds;
    CGFloat width = NSWidth(scroll.documentView.frame);
    BOOL fits = width <= NSWidth(visible) + 0.5;
    NSView *wrapper = scroll.superview;
    [out addObject:@{
      @"class" : NSStringFromClass(scroll.class),
      @"frame" : RectValue(scroll.frame),
      @"inWindow" : RectValue([scroll convertRect:scroll.bounds toView:nil]),
      @"clipBounds" : RectValue(visible),
      @"clipFrame" : RectValue(scroll.contentView.frame),
      @"document" : RectValue(scroll.documentView.frame),
      @"documentClass" : scroll.documentView ? NSStringFromClass(scroll.documentView.class) : @"",
      @"wrapper" : wrapper ? NSStringFromClass(wrapper.class) : @"",
      @"wrapperFrame" : RectValue(wrapper.frame),
      @"wrapperHorizontal" : @(width > NSWidth(wrapper.frame)),
      @"hasHorizontalScroller" : @(scroll.hasHorizontalScroller),
      @"hasVerticalScroller" : @(scroll.hasVerticalScroller),
      @"scrollerStyle" : @(scroll.scrollerStyle),
      @"horizontalElasticity" : @(scroll.horizontalScrollElasticity),
      @"verticalElasticity" : @(scroll.verticalScrollElasticity),
      @"fits" : @(fits),
      @"blocksBack" : @(!fits && NSMinX(visible) > 0.5),
      @"blocksForward" : @(!fits && NSMaxX(visible) < width - 0.5),
    }];
  }
  return out;
}

}
