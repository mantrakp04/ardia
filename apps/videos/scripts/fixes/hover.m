#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import <objc/message.h>

static BOOL gHasPointer = NO;
static NSPoint gPointer;
static IMP gMouseLocation;
static IMP gWindowNumberAtPoint;

static NSPoint FakeMouseLocation(id self, SEL _cmd) {
  if (gHasPointer) return gPointer;
  return ((NSPoint (*)(id, SEL))gMouseLocation)(self, _cmd);
}

static NSInteger FakeWindowNumberAtPoint(id self, SEL _cmd, NSPoint point, NSInteger below) {
  if (gHasPointer && below == 0) {
    for (NSWindow *w in NSApp.orderedWindows) {
      if (w.isVisible && !w.ignoresMouseEvents && NSPointInRect(point, w.frame)) return w.windowNumber;
    }
    return 0;
  }
  return ((NSInteger (*)(id, SEL, NSPoint, NSInteger))gWindowNumberAtPoint)(self, _cmd, point, below);
}

static void MarkHover(void) {
  Class view = NSClassFromString(@"RCTView");
  SEL mark = NSSelectorFromString(@"ardia_markHoverDirty");
  if (view && [view respondsToSelector:mark]) ((void (*)(id, SEL))objc_msgSend)(view, mark);
}

__attribute__((constructor)) static void HoverInit(void) {
  NSString *exe = NSProcessInfo.processInfo.arguments.firstObject.lastPathComponent;
  if (![exe isEqualToString:@"Ardia"]) return;
  Method m1 = class_getClassMethod([NSEvent class], @selector(mouseLocation));
  gMouseLocation = method_setImplementation(m1, (IMP)FakeMouseLocation);
  Method m2 = class_getClassMethod([NSWindow class], @selector(windowNumberAtPoint:belowWindowWithWindowNumber:));
  gWindowNumberAtPoint = method_setImplementation(m2, (IMP)FakeWindowNumberAtPoint);
  dispatch_async(dispatch_get_main_queue(), ^{
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp
                                          handler:^NSEvent *(NSEvent *event) {
      if (event.window) {
        gPointer = [event.window convertPointToScreen:event.locationInWindow];
        gHasPointer = YES;
        MarkHover();
      }
      return event;
    }];
  });
}
