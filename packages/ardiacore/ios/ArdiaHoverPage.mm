#import "ArdiaHoverPage.h"

#import <objc/message.h>

namespace ardia_host {

Class PageClass() {
  static Class page = NSClassFromString(@"RenderWidgetHostViewCocoa");
  return page;
}

NSView *PageAt(NSWindow *window, NSPoint point) {
  Class pageClass = PageClass();
  if (!pageClass) return nil;
  NSView *found = nil;
  NSMutableArray<NSView *> *stack = [NSMutableArray arrayWithObject:window.contentView.superview ?: [NSView new]];
  while (stack.count) {
    NSView *v = stack.lastObject;
    [stack removeLastObject];
    if (v.isHidden) continue;
    if ([v isKindOfClass:pageClass]) {
      if (NSPointInRect(point, [v convertRect:v.bounds toView:nil])) found = v;
      continue;
    }
    for (NSView *child in v.subviews.reverseObjectEnumerator) [stack addObject:child];
  }
  return found;
}

NSView *EnclosingPage(NSView *view) {
  for (NSView *v = view; v; v = v.superview)
    if ([v isKindOfClass:PageClass()]) return v;
  return nil;
}

bool PageIgnoresMove(NSView *page, NSWindow *window, NSPoint point) {
  SEL ignores = NSSelectorFromString(@"shouldIgnoreMouseEvent:");
  if (![page respondsToSelector:ignores]) return false;
  NSEvent *event = [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:point modifierFlags:0
                                     timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber
                                       context:nil eventNumber:0 clickCount:0 pressure:0];
  return ((BOOL(*)(id, SEL, NSEvent *))objc_msgSend)(page, ignores, event);
}

NSView *HitAt(NSWindow *window, NSPoint point) {
  NSView *content = window.contentView;
  return [content hitTest:[content.superview convertPoint:point fromView:nil]];
}

PageCover CoverOf(NSView *hit) {
  if (!hit) return PageCover::none;
  NSBundle *bundle = [NSBundle bundleForClass:hit.class];
  if (PageClass() && bundle == [NSBundle bundleForClass:PageClass()]) return PageCover::chromium;
  return bundle == NSBundle.mainBundle ? PageCover::reactNative : PageCover::other;
}

bool SeeThrough(NSView *hit) {
  for (NSView *v = hit; v; v = v.superview)
    if (v.alphaValue < 0.01 || (v.layer && v.layer.opacity < 0.01)) return true;
  return false;
}

bool ResponderLost(NSWindow *window, bool clickedPage) {
  NSResponder *responder = window.firstResponder;
  if (!responder) return true;
  if ([responder isKindOfClass:NSView.class] && ((NSView *)responder).window != window) return true;
  return clickedPage && responder == window;
}

}
