#import "ardia/core/ac_page_view.h"

#import "ardia/core/public/ArdiaCore.h"

#include "cc/input/overscroll_behavior.h"
#import "chrome/browser/renderer_host/chrome_render_widget_host_view_mac_delegate.h"
#import "content/app_shim_remote_cocoa/render_widget_host_view_cocoa.h"  // nogncheck
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "third_party/blink/public/common/input/web_gesture_event.h"
#include "ui/base/ime/text_input_type.h"
#include "ui/events/blink/did_overscroll_params.h"

@interface ACPageViewDelegate : ChromeRenderWidgetHostViewMacDelegate
@property(nonatomic) BOOL takesSwipes;
- (instancetype)initWithView:(NSView*)view
                        host:(content::RenderWidgetHost*)host;
@end

namespace {

__weak id<ArdiaCorePageScrollObserver> g_scroll_observer;

NSMapTable<NSView*, ACPageViewDelegate*>* Delegates() {
  static NSMapTable* delegates = [NSMapTable weakToWeakObjectsMapTable];
  return delegates;
}

}

@implementation ACPageViewDelegate {
  __weak NSView* _view;
}

- (instancetype)initWithView:(NSView*)view
                        host:(content::RenderWidgetHost*)host {
  if ((self = [super initWithRenderWidgetHost:host])) {
    _view = view;
    if (view) {
      [Delegates() setObject:self forKey:view];
    }
  }
  return self;
}

- (void)rendererHandledGestureScrollEvent:(const blink::WebGestureEvent&)event
                                 consumed:(BOOL)consumed {
  [super rendererHandledGestureScrollEvent:event consumed:consumed];
  NSView* view = _view;
  id<ArdiaCorePageScrollObserver> observer = g_scroll_observer;
  if (!view || !observer) {
    return;
  }
  switch (event.GetType()) {
    case blink::WebInputEvent::Type::kGestureScrollBegin:
      [observer pageView:view
             ackedScroll:ArdiaCorePageScrollAckBegin
                consumed:consumed];
      break;
    case blink::WebInputEvent::Type::kGestureScrollUpdate:
      [observer pageView:view
             ackedScroll:ArdiaCorePageScrollAckUpdate
                consumed:consumed];
      break;
    default:
      break;
  }
}

- (void)rendererHandledOverscrollEvent:(const ui::DidOverscrollParams&)params {
  [super rendererHandledOverscrollEvent:params];
  NSView* view = _view;
  id<ArdiaCorePageScrollObserver> observer = g_scroll_observer;
  if (!view || !observer) {
    return;
  }
  [observer pageView:view
      overscrolledAllowingHorizontal:params.overscroll_behavior.x ==
                                     cc::OverscrollBehavior::Type::kAuto];
}

- (BOOL)handleEvent:(NSEvent*)event {
  if (_takesSwipes && event.type == NSEventTypeScrollWheel) {
    return NO;
  }
  return [super handleEvent:event];
}

@end

@implementation ArdiaCorePageView

+ (BOOL)isPageView:(NSView*)view {
  return [view isKindOfClass:[RenderWidgetHostViewCocoa class]];
}

+ (void)setScrollObserver:(id<ArdiaCorePageScrollObserver>)observer {
  g_scroll_observer = observer;
}

+ (BOOL)takeSwipes:(NSView*)view {
  ACPageViewDelegate* delegate = [Delegates() objectForKey:view];
  delegate.takesSwipes = YES;
  return delegate != nil;
}

+ (BOOL)takesSwipes:(NSView*)view {
  return [Delegates() objectForKey:view].takesSwipes;
}

+ (BOOL)isEditingText:(NSView*)view {
  return [self isPageView:view] &&
         static_cast<RenderWidgetHostViewCocoa*>(view).textInputType !=
             ui::TEXT_INPUT_TYPE_NONE;
}

@end

namespace ardiacore {

NSObject<RenderWidgetHostViewMacDelegate>* CreatePageViewDelegate(
    content::RenderWidgetHost* host) {
  content::RenderWidgetHostView* view = host->GetView();
  return [[ACPageViewDelegate alloc]
      initWithView:view ? view->GetNativeView().GetNativeNSView() : nil
              host:host];
}

}
