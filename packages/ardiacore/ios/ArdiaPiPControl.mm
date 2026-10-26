#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaChromeWindowHost.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

using namespace ardia_pip;

@implementation ArdiaPiPControl {
  NSEvent *_down;
  NSTrackingArea *_tracking;
}

- (BOOL)isFlipped { return YES; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)mouseDownCanMoveWindow { return NO; }

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_tracking) [self removeTrackingArea:_tracking];
  _tracking = [[NSTrackingArea alloc]
      initWithRect:NSZeroRect
           options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect | NSTrackingCursorUpdate
             owner:self
          userInfo:nil];
  [self addTrackingArea:_tracking];
}

- (void)mouseEntered:(NSEvent *)event { self.hovered = YES; }
- (void)mouseExited:(NSEvent *)event { self.hovered = NO; }
- (void)cursorUpdate:(NSEvent *)event { [NSCursor.pointingHandCursor set]; }

- (void)mouseDown:(NSEvent *)event { _down = event; }

- (void)mouseDragged:(NSEvent *)event {
  if (!_down) return;
  NSPoint a = _down.locationInWindow, b = event.locationInWindow;
  if (hypot(b.x - a.x, b.y - a.y) < 3) return;
  NSEvent *down = _down;
  _down = nil;
  [self.window performWindowDragWithEvent:down];
}

- (void)mouseUp:(NSEvent *)event {
  if (!_down) return;
  _down = nil;
  if (self.onClick) self.onClick();
}

@end
