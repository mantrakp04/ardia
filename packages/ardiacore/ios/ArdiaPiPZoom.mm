#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaLaunchConfig.h"
#import "ArdiaChromeWindowHost.h"
#import "ArdiaPiPZoomMath.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

using namespace ardia_pip;

@implementation ArdiaPiPZoom {
  __weak NSWindow *_window;
  NSRect _last;
  double _width;
  double _aspect;
  double _target;
  NSPoint _pointer;
  NSTimer *_ease;
}

+ (BOOL)zooms:(NSWindow *)window {
  if (!window.visible || !(window.styleMask & NSWindowStyleMaskResizable)) return NO;
  ArdiaPiPController *controller = [ArdiaPiPController forWindow:window];
  if (controller) return controller.stashedEdge == ArdiaPiPEdgeNone;
  return IsChromeDocumentPictureInPicture(window) && IsChromeFloatingWindow(window);
}

+ (instancetype)forWindow:(NSWindow *)window {
  ArdiaPiPZoom *zoom = objc_getAssociatedObject(window, kZoomKey);
  if (!zoom) {
    zoom = [[ArdiaPiPZoom alloc] init];
    zoom->_window = window;
    objc_setAssociatedObject(window, kZoomKey, zoom, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return zoom;
}

static __weak NSWindow *gZoomGesture;

+ (BOOL)handle:(NSEvent *)event {
  BOOL handled = [self route:event];
  static BOOL trace = [ArdiaLaunchConfig.shared traced:@"pipZoom"];
  if (trace)
    NSLog(@"[pip-zoom] type %lu window %ld (%@) cmd %d phase %lu/%lu dy %.2f precise %d mag %.3f -> %@ %@", (unsigned long)event.type,
          (long)event.windowNumber, event.window.className, (event.modifierFlags & NSEventModifierFlagCommand) != 0,
          (unsigned long)(event.type == NSEventTypeScrollWheel ? event.phase : 0),
          (unsigned long)(event.type == NSEventTypeScrollWheel ? event.momentumPhase : 0),
          event.type == NSEventTypeScrollWheel ? event.scrollingDeltaY : 0,
          event.type == NSEventTypeScrollWheel ? event.hasPreciseScrollingDeltas : 0,
          event.type == NSEventTypeMagnify ? event.magnification : 0, handled ? @"zoomed" : @"passed",
          NSStringFromRect(event.window.frame));
  return handled;
}

+ (NSWindow *)windowFor:(NSEvent *)event {
  if (event.window) return event.window;
  NSPoint point = event.locationInWindow;
  for (NSWindow *window in NSApp.orderedWindows)
    if (NSPointInRect(point, window.frame) && [self zooms:window]) return window;
  return nil;
}

+ (BOOL)route:(NSEvent *)event {
  NSWindow *window = [self windowFor:event];
  BOOL command = (event.modifierFlags & NSEventModifierFlagCommand) != 0;
  BOOL scroll = event.type == NSEventTypeScrollWheel;
  if (scroll) {
    NSEventPhase phase = event.phase, momentum = event.momentumPhase;
    BOOL wheel = phase == NSEventPhaseNone && momentum == NSEventPhaseNone;
    if (wheel || (phase & (NSEventPhaseBegan | NSEventPhaseMayBegin))) gZoomGesture = nil;
    if (gZoomGesture) window = gZoomGesture;
    if (!window || (!command && gZoomGesture != window)) return NO;
    if (![self zooms:window] || ![self enabled]) return NO;
    if (!wheel) gZoomGesture = window;
    if (momentum & (NSEventPhaseEnded | NSEventPhaseCancelled)) gZoomGesture = nil;
    double dy = event.scrollingDeltaY;
    if (dy == 0) return YES;
    [[self forWindow:window] zoomBy:ardia_pip_zoom::ScrollFactor(dy, event.hasPreciseScrollingDeltas)
                                 at:[self screenPoint:event]
                               ease:!event.hasPreciseScrollingDeltas];
    return YES;
  }
  if (!window || ![self zooms:window] || ![self enabled]) return NO;
  [[self forWindow:window] zoomBy:ardia_pip_zoom::MagnifyFactor(event.magnification)
                               at:[self screenPoint:event]
                             ease:NO];
  return YES;
}

+ (NSPoint)screenPoint:(NSEvent *)event {
  return event.window ? [event.window convertPointToScreen:event.locationInWindow] : event.locationInWindow;
}

+ (BOOL)enabled {
  id value = [NSUserDefaults.standardUserDefaults objectForKey:kZoomDefault];
  return value ? [value boolValue] : YES;
}

- (void)zoomBy:(double)factor at:(NSPoint)pointer ease:(BOOL)ease {
  NSWindow *window = _window;
  [[ArdiaPiPController forWindow:window] stopMotion];
  NSRect frame = window.frame;
  if (!NSEqualRects(frame, _last) || _width <= 0) {
    double aspect = NSWidth(frame) / MAX(NSHeight(frame), 1);
    if (!(_aspect > 0 && fabs(NSWidth(frame) / _aspect - NSHeight(frame)) <= 1)) _aspect = aspect;
    _width = NSWidth(frame), _target = 0;
    [_ease invalidate], _ease = nil;
  }
  _pointer = pointer;
  if (!ease) {
    [_ease invalidate], _ease = nil, _target = 0;
    return [self step:factor];
  }
  double low, high;
  ardia_pip_zoom::WidthLimits(_aspect, [self minSize], [self maxSize], [self visible], &low, &high);
  _target = MIN(MAX((_target > 0 ? _target : _width) * factor, low), high);
  if (_ease) return;
  __weak ArdiaPiPZoom *weakSelf = self;
  _ease = [NSTimer timerWithTimeInterval:1.0 / 120 repeats:YES block:^(NSTimer *timer) {
    ArdiaPiPZoom *strongSelf = weakSelf;
    if (!strongSelf || !strongSelf->_window.visible || !NSEqualRects(strongSelf->_window.frame, strongSelf->_last)) {
      if (strongSelf) strongSelf->_ease = nil, strongSelf->_target = 0;
      return [timer invalidate];
    }
    double width = strongSelf->_width, target = strongSelf->_target;
    BOOL done = fabs(target - width) < 0.25;
    [strongSelf step:(done ? target : width + (target - width) * 0.25) / width];
    if (!done) return;
    strongSelf->_ease = nil, strongSelf->_target = 0;
    [timer invalidate];
  }];
  [NSRunLoop.currentRunLoop addTimer:_ease forMode:NSRunLoopCommonModes];
  _last = frame;
}

- (ardia_pip_zoom::Size)minSize {
  NSSize size = _window.contentMinSize;
  return {size.width, size.height};
}

- (ardia_pip_zoom::Size)maxSize {
  NSSize size = _window.contentMaxSize;
  return {size.width > 0 ? size.width : CGFLOAT_MAX, size.height > 0 ? size.height : CGFLOAT_MAX};
}

- (ardia_pip_zoom::Rect)visible {
  NSRect visible = ScreenFor(_window.frame).visibleFrame;
  return {NSMinX(visible), NSMinY(visible), NSWidth(visible), NSHeight(visible)};
}

- (void)step:(double)factor {
  NSWindow *window = _window;
  NSRect frame = window.frame;
  ardia_pip_zoom::Result result = ardia_pip_zoom::Zoom(
      {NSMinX(frame), NSMinY(frame), NSWidth(frame), NSHeight(frame)}, _width, _aspect, factor, {_pointer.x, _pointer.y},
      [self visible], [self minSize], [self maxSize]);
  _width = result.width;
  NSRect next = NSMakeRect(result.frame.x, result.frame.y, result.frame.w, result.frame.h);
  if (!NSEqualRects(next, frame)) [window setFrame:next display:YES];
  _last = window.frame;
}

@end
