#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import <objc/message.h>

static BOOL gHasPointer = NO;
static NSPoint gPointer;
static IMP gMouseLocation;
static NSString *gInbox;
static NSString *gOutbox;
static NSMutableArray *gDone;

static NSPoint FakeMouseLocation(id self, SEL _cmd) {
  if (gHasPointer) return gPointer;
  return ((NSPoint (*)(id, SEL))gMouseLocation)(self, _cmd);
}

static void MarkHover(void) {
  Class view = NSClassFromString(@"RCTView");
  SEL mark = NSSelectorFromString(@"ardia_markHoverDirty");
  if (view && [view respondsToSelector:mark]) ((void (*)(id, SEL))objc_msgSend)(view, mark);
}

static NSWindow *WindowTitled(NSString *title) {
  for (NSWindow *w in NSApp.windows) {
    if (w.isVisible && [w.title isEqualToString:title]) return w;
  }
  return nil;
}

static NSPoint WindowPoint(NSWindow *window, NSDictionary *step) {
  return NSMakePoint([step[@"x"] doubleValue], window.frame.size.height - [step[@"y"] doubleValue]);
}

static NSEvent *MouseEvent(NSEventType type, NSWindow *window, NSPoint point) {
  return [NSEvent mouseEventWithType:type location:point modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                        windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:type == NSEventTypeLeftMouseDown ? 1 : 0];
}

static void PlacePointer(NSWindow *window, NSPoint point) {
  gPointer = [window convertPointToScreen:point];
  gHasPointer = YES;
}

static void KeyTo(NSWindow *window, NSString *chars, unsigned short code, NSEventModifierFlags flags, BOOL queued) {
  for (NSNumber *type in @[ @(NSEventTypeKeyDown), @(NSEventTypeKeyUp) ]) {
    NSEvent *event = [NSEvent keyEventWithType:type.unsignedIntegerValue location:NSZeroPoint modifierFlags:flags timestamp:NSProcessInfo.processInfo.systemUptime
                                  windowNumber:window.windowNumber context:nil characters:chars charactersIgnoringModifiers:chars isARepeat:NO keyCode:code];
    if (queued) [NSApp postEvent:event atStart:NO];
    else if (type.unsignedIntegerValue == NSEventTypeKeyDown) [window.firstResponder keyDown:event];
    else [window.firstResponder keyUp:event];
  }
}

static void RunStep(NSDictionary *step) {
  NSString *type = step[@"type"];
  NSWindow *window = WindowTitled(step[@"window"] ?: @"Settings");
  [gDone addObject:@{ @"i" : step[@"i"] ?: @0, @"t" : @((long long)(NSDate.date.timeIntervalSince1970 * 1000)), @"found" : @(window != nil) }];
  if (!window) return;
  BOOL queued = [step[@"queued"] boolValue];
  if ([type isEqualToString:@"move"]) {
    NSPoint p = WindowPoint(window, step);
    PlacePointer(window, p);
    NSEvent *event = MouseEvent(NSEventTypeMouseMoved, window, p);
    if (queued) [NSApp postEvent:event atStart:NO];
    else [window sendEvent:event];
    MarkHover();
  } else if ([type isEqualToString:@"click"]) {
    NSPoint p = WindowPoint(window, step);
    PlacePointer(window, p);
    if (!queued) [window makeKeyWindow];
    NSEvent *down = MouseEvent(NSEventTypeLeftMouseDown, window, p);
    NSEvent *up = MouseEvent(NSEventTypeLeftMouseUp, window, p);
    [NSApp postEvent:down atStart:NO];
    [NSApp postEvent:up atStart:NO];
    MarkHover();
  } else if ([type isEqualToString:@"text"]) {
    NSString *text = step[@"chars"];
    double gap = [step[@"gap"] doubleValue] ?: 0.12;
    for (NSUInteger i = 0; i < text.length; i++) {
      NSString *ch = [text substringWithRange:NSMakeRange(i, 1)];
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(gap * i * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        KeyTo(window, ch, 0, 0, NO);
      });
    }
  } else if ([type isEqualToString:@"key"]) {
    KeyTo(window, step[@"chars"], [step[@"code"] unsignedShortValue], 0, queued);
  } else if ([type isEqualToString:@"action"]) {
    [NSApp sendAction:NSSelectorFromString(step[@"selector"]) to:nil from:nil];
  }
}

static void Poll(void) {
  NSData *data = [NSData dataWithContentsOfFile:gInbox];
  if (!data) return;
  [NSFileManager.defaultManager removeItemAtPath:gInbox error:nil];
  NSArray *steps = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![steps isKindOfClass:NSArray.class]) return;
  gDone = [NSMutableArray array];
  double last = 0;
  NSUInteger i = 0;
  for (NSDictionary *raw in steps) {
    NSMutableDictionary *step = [raw mutableCopy];
    step[@"i"] = @(i++);
    double at = [step[@"at"] doubleValue] / 1000.0;
    last = MAX(last, at);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(at * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ RunStep(step); });
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((last + 0.3) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSData *out = [NSJSONSerialization dataWithJSONObject:gDone options:0 error:nil];
    [out writeToFile:gOutbox atomically:YES];
  });
}

__attribute__((constructor)) static void InputInit(void) {
  NSString *exe = NSProcessInfo.processInfo.arguments.firstObject.lastPathComponent;
  NSString *dir = NSProcessInfo.processInfo.environment[@"ARDIA_DATA_DIR"];
  if (![exe isEqualToString:@"Ardia"] || !dir) return;
  gInbox = [dir stringByAppendingPathComponent:@"film-input.json"];
  gOutbox = [dir stringByAppendingPathComponent:@"film-input-done.json"];
  Method m = class_getClassMethod([NSEvent class], @selector(mouseLocation));
  gMouseLocation = method_setImplementation(m, (IMP)FakeMouseLocation);
  dispatch_async(dispatch_get_main_queue(), ^{
    [[NSRunLoop mainRunLoop] addTimer:[NSTimer timerWithTimeInterval:0.02 repeats:YES block:^(NSTimer *timer) { Poll(); }] forMode:NSRunLoopCommonModes];
  });
}
