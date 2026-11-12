#import "ArdiaWebViewInternal.h"

#import <React/RCTTouchHandler.h>

@implementation RCTTouchHandler (Pages)

- (BOOL)gestureRecognizer:(NSGestureRecognizer *)recognizer shouldAttemptToRecognizeWithEvent:(NSEvent *)event {
  if (event.type != NSEventTypeLeftMouseDown) return YES;
  for (NSView *view = [event.window.contentView.superview hitTest:event.locationInWindow]; view && view != recognizer.view; view = view.superview)
    if ([view isKindOfClass:ArdiaWebView.class]) {
      [(ArdiaWebView *)view emit:@"pagePress" payload:@{}];
      return NO;
    }
  return YES;
}

@end
