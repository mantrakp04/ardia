#import "ArdiaChromeWindowInternal.h"
#import "ArdiaLaunchConfig.h"
#import "ArdiaWebView.h"
#import "ArdiaRuntime.h"

#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

#include <cmath>

using namespace ardia_window;
using namespace ardia_runtime;

namespace {

NSString *Describe(NSView *view) {
  if (view && ![view isKindOfClass:NSView.class]) return NSStringFromClass([(id)view class]);
  NSMutableArray *chain = [NSMutableArray array];
  for (NSView *v = view; v && chain.count < 6; v = v.superview) [chain addObject:NSStringFromClass(v.class)];
  return [chain componentsJoinedByString:@" < "];
}

NSPoint WindowPoint(NSWindow *window, NSString *spec) {
  NSArray<NSString *> *n = [spec componentsSeparatedByString:@","];
  if (n.count < 2) return NSMakePoint(-1, -1);
  CGFloat height = window.contentView.superview.bounds.size.height;
  return NSMakePoint(n[0].doubleValue, height - n[1].doubleValue);
}

NSEvent *Mouse(NSWindow *window, NSEventType type, NSPoint at) {
  return [NSEvent mouseEventWithType:type location:at modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                        windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
}

NSEvent *Key(NSWindow *window, NSEventType type, NSEventModifierFlags flags, NSString *chars, unsigned short code) {
  return [NSEvent keyEventWithType:type location:NSZeroPoint modifierFlags:flags timestamp:NSProcessInfo.processInfo.systemUptime
                      windowNumber:window.windowNumber context:nil characters:chars charactersIgnoringModifiers:chars
                         isARepeat:NO keyCode:code];
}

}

namespace {

NSDictionary *ProbeFrame(NSWindow *window, ArdiaWindowFullScreen *state, CFTimeInterval start, NSSize before) {
  NSView *content = window.contentView;
  CALayer *layer = content.layer;
  if (!layer) return nil;
  const CGFloat scale = 0.125;
  const NSSize size = content.bounds.size;
  const size_t w = MAX(1, (size_t)ceil(size.width * scale)), h = MAX(1, (size_t)ceil(size.height * scale));
  NSMutableData *pixels = [NSMutableData dataWithLength:w * h * 4];
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels.mutableBytes, w, h, 8, w * 4, space,
                                               (CGBitmapInfo)kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!context) return nil;
  CGContextScaleCTM(context, scale, scale);
  if (content.isFlipped || layer.geometryFlipped) {
    CGContextTranslateCTM(context, 0, size.height);
    CGContextScaleCTM(context, 1, -1);
  }
  [layer renderInContext:context];
  CGContextRelease(context);
  NSMutableDictionary *frame = [@{
    @"t" : @(round((CACurrentMediaTime() - start) * 1000)),
    @"size" : @[ @(size.width), @(size.height) ],
    @"cover" : @(state.covered),
    @"covers" : @(state.covers),
    @"transitioning" : @(state.transitioning),
  } mutableCopy];
  if (!NSEqualSizes(before, NSZeroSize) && !NSEqualSizes(before, size)) {
    NSMutableArray<NSView *> *views = [NSMutableArray arrayWithArray:content.subviews];
    for (NSUInteger i = 0; i < views.count && i < 64; i++) {
      if (NSEqualSizes(views[i].frame.size, before)) {
        frame[@"relayout"] = @YES;
        break;
      }
      [views addObjectsFromArray:views[i].subviews];
    }
  }
  NSView *page = state.probedTab.view;
  if (!page.window || page.window != window) return frame;
  const NSRect r = [page convertRect:page.bounds toView:content];
  const CGFloat top = content.isFlipped ? NSMinY(r) : size.height - NSMaxY(r);
  frame[@"page"] = @[ @(NSMinX(r)), @(top), @(NSWidth(r)), @(NSHeight(r)) ];
  const long x0 = lround(NSMinX(r) * scale), y0 = lround(top * scale);
  const long x1 = MIN((long)w, lround(NSMaxX(r) * scale)), y1 = MIN((long)h, lround((top + NSHeight(r)) * scale));
  if (x1 - x0 < 8 || y1 - y0 < 6) return frame;
  const uint8_t *p = (const uint8_t *)pixels.bytes;
  NSMutableDictionary<NSNumber *, NSNumber *> *counts = [NSMutableDictionary dictionary];
  double sums[6][8][3] = {};
  long cells[6][8] = {}, n = 0, most = 0;
  for (long y = y0; y < y1; y++) {
    for (long x = x0; x < x1; x++) {
      const uint8_t *px = p + (y * w + x) * 4;
      NSNumber *key = @(((px[0] >> 3) << 10) | ((px[1] >> 3) << 5) | (px[2] >> 3));
      const long c = counts[key].longValue + 1;
      counts[key] = @(c);
      most = MAX(most, c);
      const long gy = (y - y0) * 6 / (y1 - y0), gx = (x - x0) * 8 / (x1 - x0);
      for (int k = 0; k < 3; k++) sums[gy][gx][k] += px[k];
      cells[gy][gx]++;
      n++;
    }
  }
  NSMutableArray *grid = [NSMutableArray array];
  for (int gy = 0; gy < 6; gy++)
    for (int gx = 0; gx < 8; gx++) {
      const long c = MAX(1, cells[gy][gx]);
      [grid addObject:[NSString stringWithFormat:@"%02x%02x%02x", (int)(sums[gy][gx][0] / c), (int)(sums[gy][gx][1] / c),
                                                 (int)(sums[gy][gx][2] / c)]];
    }
  frame[@"uniform"] = @(round((double)most / n * 1000) / 1000);
  frame[@"grid"] = grid;
  return frame;
}

NSString *JSONText(id object, NSString *fallback) {
  NSData *json = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : fallback;
}

NSArray<NSString *> *Fields(NSString *argument) { return [argument ?: @"" componentsSeparatedByString:@":"]; }

NSString *Recorder(NSMutableArray<NSString *> *log) {
  NSString *out = [NSString stringWithFormat:@"%lu\n%@", (unsigned long)log.count, [log componentsJoinedByString:@"\n---\n"]];
  [log removeAllObjects];
  return out;
}

using DevHandler = NSString * (^)(NSWindow *window, NSString *argument);

NSString *FullScreenProbe(NSWindow *window, NSString *argument) {
  static NSMutableArray *frames;
  static NSTimer *timer;
  if (!argument) return JSONText(frames ?: @[], @"[]");
  ArdiaCoreWindow *coreWindow = [ArdiaWindowController forNSWindow:window].coreWindow;
  ArdiaWindowFullScreen *state = coreWindow ? [ArdiaWindowFullScreen ofWindow:coreWindow create:YES] : nil;
  if (!state) return @"not an ArdiaCore window";
  [timer invalidate];
  frames = [NSMutableArray array];
  const CFTimeInterval start = CACurrentMediaTime(), until = start + MAX(0, argument.doubleValue) / 1000;
  __weak NSWindow *weakWindow = window;
  timer = [NSTimer timerWithTimeInterval:1.0 / 60
                                 repeats:YES
                                   block:^(NSTimer *t) {
                                     NSWindow *w = weakWindow;
                                     if (!w || CACurrentMediaTime() > until) return [t invalidate];
                                     NSArray *last = [frames.lastObject objectForKey:@"size"];
                                     const NSSize before = last ? NSMakeSize([last[0] doubleValue], [last[1] doubleValue]) : NSZeroSize;
                                     if (NSDictionary *frame = ProbeFrame(w, state, start, before)) [frames addObject:frame];
                                   }];
  [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
  return @"started";
}

NSString *FullScreen(NSWindow *window, NSString *argument) {
  ArdiaCoreWindow *coreWindow = [ArdiaWindowController forNSWindow:window].coreWindow;
  if (!coreWindow) return @"not an ArdiaCore window";
  if (argument) {
    NSArray<NSString *> *parts = Fields(argument);
    const BOOL enter = [parts[0] isEqualToString:@"1"];
    if (enter != IsWindowFullScreen(window)) ActWindowFullScreen(coreWindow, enter, parts.count > 1 ? parts[1].doubleValue / 1000 : 0);
  }
  NSMutableDictionary *state = [@{
    @"fullScreen" : @(IsWindowFullScreen(window)),
    @"styleMask" : @((window.styleMask & NSWindowStyleMaskFullScreen) != 0),
    @"acted" : @(objc_getAssociatedObject(window, kActedFullScreenKey) != nil),
    @"chromeCounts" : @(coreWindow.actedFullScreen),
  } mutableCopy];
  if (ArdiaWindowFullScreen *page = [ArdiaWindowFullScreen ofWindow:coreWindow create:NO]) state[@"pageFullScreen"] = [page state];
  return JSONText(state, @"{}");
}

NSString *PostNotification(NSWindow *window, NSString *argument) {
  NSArray<NSString *> *parts = Fields(argument);
  if (parts.count != 2) return @"postNotification:<workspace|app|window|windows>:<name>";
  NSString *center = parts[0], *name = parts[1];
  if ([center isEqualToString:@"workspace"]) [NSWorkspace.sharedWorkspace.notificationCenter postNotificationName:name object:NSWorkspace.sharedWorkspace];
  else if ([center isEqualToString:@"app"]) [NSNotificationCenter.defaultCenter postNotificationName:name object:NSApp];
  else if ([center isEqualToString:@"window"]) [NSNotificationCenter.defaultCenter postNotificationName:name object:window];
  else if ([center isEqualToString:@"windows"])
    for (NSWindow *each in NSApp.windows) [NSNotificationCenter.defaultCenter postNotificationName:name object:each];
  else return @"unknown center";
  return @"posted";
}

NSString *WindowDrags(NSWindow *, NSString *) {
  static NSMutableArray<NSString *> *drags;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    drags = [NSMutableArray array];
    for (NSString *name in @[ @"performWindowDragWithEvent:", @"performWindowDragWithEvent:completionHandler:" ]) {
      Method m = class_getInstanceMethod(NSWindow.class, NSSelectorFromString(name));
      if (!m) continue;
      IMP original = method_getImplementation(m);
      bool handler = [name hasSuffix:@"Handler:"];
      method_setImplementation(m, handler ? imp_implementationWithBlock(^(NSWindow *w, NSEvent *e, id done) {
        [drags addObject:[[NSThread callStackSymbols] componentsJoinedByString:@"\n"]];
        ((void (*)(id, SEL, NSEvent *, id))original)(w, NSSelectorFromString(name), e, done);
      }) : imp_implementationWithBlock(^(NSWindow *w, NSEvent *e) {
        [drags addObject:[[NSThread callStackSymbols] componentsJoinedByString:@"\n"]];
        ((void (*)(id, SEL, NSEvent *))original)(w, NSSelectorFromString(name), e);
      }));
    }
  });
  return Recorder(drags);
}

NSString *ResponderChanges(NSWindow *, NSString *) {
  static NSMutableArray<NSString *> *changes;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    changes = [NSMutableArray array];
    SEL sel = @selector(makeFirstResponder:);
    Method m = class_getInstanceMethod(NSWindow.class, sel);
    IMP original = method_getImplementation(m);
    method_setImplementation(m, imp_implementationWithBlock(^BOOL(NSWindow *w, NSResponder *r) {
      [changes addObject:[NSString stringWithFormat:@"-> %@\n%@", Describe((NSView *)r),
                                                     [[NSThread callStackSymbols] componentsJoinedByString:@"\n"]]];
      return ((BOOL(*)(id, SEL, NSResponder *))original)(w, sel, r);
    }));
  });
  return Recorder(changes);
}

NSString *FakeActiveClicks(NSWindow *, NSString *) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSMutableSet<Class> *classes = [NSMutableSet setWithObject:NSTextView.class];
    if (Class page = NSClassFromString(@"RenderWidgetHostViewCocoa")) [classes addObject:page];
    for (Class cls in classes) {
      SEL sel = @selector(acceptsFirstMouse:);
      ReplaceMethod(cls, sel, ^id(IMP original) {
        return ^BOOL(NSView *v, NSEvent *e) {
          return v.window.isKeyWindow || ((BOOL(*)(id, SEL, NSEvent *))original)(v, sel, e);
        };
      });
    }
  });
  return @"1";
}

NSString *Click(NSWindow *window, NSString *argument) {
  bool right = [argument hasSuffix:@",right"];
  NSPoint p = WindowPoint(window, argument);
  NSView *target = [window.contentView.superview hitTest:p];
  bool page = [target isKindOfClass:NSClassFromString(@"RenderWidgetHostViewCocoa")];
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!page) {
      [window sendEvent:Mouse(window, right ? NSEventTypeRightMouseDown : NSEventTypeLeftMouseDown, p)];
      [window sendEvent:Mouse(window, right ? NSEventTypeRightMouseUp : NSEventTypeLeftMouseUp, p)];
    } else if (right) {
      [target rightMouseDown:Mouse(window, NSEventTypeRightMouseDown, p)];
      [target rightMouseUp:Mouse(window, NSEventTypeRightMouseUp, p)];
    } else {
      [target mouseDown:Mouse(window, NSEventTypeLeftMouseDown, p)];
      [target mouseUp:Mouse(window, NSEventTypeLeftMouseUp, p)];
    }
  });
  return Describe(target);
}

NSString *MouseEvent(NSWindow *window, NSString *argument) {
  NSArray<NSString *> *parts = Fields(argument);
  if (parts.count < 2) return @"mouse:<down|up|dragged|moved|otherdown|otherup>:<x>,<y>[,<clickCount>[,<flags>]]";
  NSDictionary<NSString *, NSNumber *> *types = @{
    @"down" : @(NSEventTypeLeftMouseDown), @"up" : @(NSEventTypeLeftMouseUp),
    @"dragged" : @(NSEventTypeLeftMouseDragged), @"moved" : @(NSEventTypeMouseMoved),
    @"otherdown" : @(NSEventTypeOtherMouseDown), @"otherup" : @(NSEventTypeOtherMouseUp),
  };
  NSNumber *type = types[parts[0]];
  if (!type) return @"unknown mouse event";
  NSArray<NSString *> *n = [parts[1] componentsSeparatedByString:@","];
  NSPoint p = WindowPoint(window, parts[1]);
  const NSEventType t = (NSEventType)type.unsignedIntegerValue;
  NSEvent *event = [NSEvent mouseEventWithType:t location:p modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                                  windowNumber:window.windowNumber context:nil eventNumber:0
                                    clickCount:n.count > 2 ? n[2].integerValue : (t == NSEventTypeMouseMoved ? 0 : 1)
                                      pressure:t == NSEventTypeLeftMouseUp || t == NSEventTypeMouseMoved ? 0 : 1];
  const bool other = t == NSEventTypeOtherMouseDown || t == NSEventTypeOtherMouseUp;
  if (other || n.count > 3) {
    CGEventRef cg = event.CGEvent;
    if (n.count > 3) CGEventSetFlags(cg, (CGEventFlags)n[3].longLongValue);
    if (other) CGEventSetIntegerValueField(cg, kCGMouseEventButtonNumber, kCGMouseButtonCenter);
    event = [NSEvent eventWithCGEvent:cg];
  }
  [NSApp postEvent:event atStart:NO];
  return Describe([window.contentView.superview hitTest:p]);
}

NSString *Drag(NSWindow *window, NSString *argument) {
  NSMutableArray<NSValue *> *points = [NSMutableArray array];
  for (NSString *spec in [argument componentsSeparatedByString:@";"]) [points addObject:[NSValue valueWithPoint:WindowPoint(window, spec)]];
  if (points.count < 2) return @"drag needs two points";
  NSMutableArray<NSEvent *> *events = [NSMutableArray arrayWithObject:Mouse(window, NSEventTypeLeftMouseDown, points[0].pointValue)];
  for (NSUInteger i = 1; i < points.count; i++) {
    NSPoint a = points[i - 1].pointValue, b = points[i].pointValue;
    for (int k = 1; k <= 12; k++)
      [events addObject:Mouse(window, NSEventTypeLeftMouseDragged, NSMakePoint(a.x + (b.x - a.x) * k / 12, a.y + (b.y - a.y) * k / 12))];
  }
  [events addObject:Mouse(window, NSEventTypeLeftMouseUp, points.lastObject.pointValue)];
  NSString *hit = Describe([window.contentView.superview hitTest:points[0].pointValue]);
  for (NSUInteger i = 0; i < events.count; i++)
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((i ? 150 + i * 16 : 0) * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
      [window sendEvent:events[i]];
    });
  return [NSString stringWithFormat:@"%@ (%lu events)", hit, (unsigned long)events.count];
}

NSString *TypeText(NSWindow *window, NSString *argument) {
  for (NSUInteger i = 0; i < argument.length; i++) {
    NSString *c = [argument substringWithRange:NSMakeRange(i, 1)];
    [window.firstResponder keyDown:Key(window, NSEventTypeKeyDown, 0, c, 0)];
    [window.firstResponder keyUp:Key(window, NSEventTypeKeyUp, 0, c, 0)];
  }
  return Describe((NSView *)window.firstResponder);
}

NSEvent *KeyDownOf(NSWindow *window, NSArray<NSString *> *parts) {
  NSEventModifierFlags flags = (NSEventModifierFlags)parts[0].longLongValue;
  unsigned short code = parts.count > 2 ? (unsigned short)parts[2].intValue : 0;
  return Key(window, NSEventTypeKeyDown, flags, parts[1], code);
}

NSString *Reserved(NSWindow *window, NSString *argument) {
  NSArray<NSString *> *parts = Fields(argument);
  if (parts.count < 2) return @"reserved:<flags>:<characters>[:<keyCode>]";
  return ReservedMenuItemForEvent(KeyDownOf(window, parts)).identifier ?: @"";
}

NSString *Keys(NSWindow *window, NSString *argument) {
  NSArray<NSString *> *parts = Fields(argument);
  if (parts.count < 2) return @"keys:<flags>:<characters>[:<keyCode>]";
  [NSApp postEvent:KeyDownOf(window, parts) atStart:YES];
  NSEvent *down = [NSApp nextEventMatchingMask:NSEventMaskKeyDown untilDate:NSDate.distantPast inMode:NSDefaultRunLoopMode dequeue:YES];
  if (!down) return @"keys: the key event didn't come back";
  NSString *handler = @"none";
  if ([window performKeyEquivalent:down]) handler = @"window";
  else if ([NSApp.mainMenu performKeyEquivalent:down]) handler = @"mainMenu";
  else {
    [window.firstResponder keyDown:down];
    handler = @"keyDown";
  }
  return [NSString stringWithFormat:@"%@ (first responder %@)", handler, Describe((NSView *)window.firstResponder)];
}

NSString *AccessibilityTree(NSWindow *window, NSString *) {
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  __block void (^walk)(id, NSUInteger);
  __block __weak void (^weakWalk)(id, NSUInteger);
  weakWalk = walk = ^(id element, NSUInteger depth) {
    if (lines.count > 400 || depth > 40) return;
    NSString *role = [element respondsToSelector:@selector(accessibilityRole)] ? [element accessibilityRole] : @"?";
    NSMutableArray *text = [NSMutableArray array];
    for (NSString *key in @[ @"accessibilityTitle", @"accessibilityLabel", @"accessibilityValue" ]) {
      SEL sel = NSSelectorFromString(key);
      id value = [element respondsToSelector:sel] ? [element valueForKey:key] : nil;
      if ([value isKindOfClass:NSString.class] && [value length]) [text addObject:value];
    }
    [lines addObject:[NSString stringWithFormat:@"%@%@%@", [@"" stringByPaddingToLength:depth withString:@" " startingAtIndex:0],
                                               role ?: @"", text.count ? [@": " stringByAppendingString:[text componentsJoinedByString:@" | "]] : @""]];
    NSArray *children = [element respondsToSelector:@selector(accessibilityChildren)] ? [element accessibilityChildren] : nil;
    for (id child in children) weakWalk(child, depth + 1);
  };
  walk(window, 0);
  return [lines componentsJoinedByString:@"\n"];
}

NSString *WindowInfo(NSWindow *window, NSString *) {
  NSMutableDictionary *info = [NSMutableDictionary dictionary];
  info[@"frame"] = NSStringFromRect(window.frame);
  info[@"contentView"] = [NSString stringWithFormat:@"%@ %@", window.contentView.className, NSStringFromRect(window.contentView.frame)];
  info[@"frameView"] = [NSString stringWithFormat:@"%@ %@", window.contentView.superview.className, NSStringFromRect(window.contentView.superview.frame)];
  info[@"root"] = NSStringFromRect([ArdiaChromeWindowHost rootViewOfWindow:window].frame);
  info[@"styleMask"] = @(window.styleMask);
  info[@"opaque"] = @(window.opaque);
  info[@"hasShadow"] = @(window.hasShadow);
  info[@"alpha"] = @(window.alphaValue);
  info[@"level"] = @(window.level);
  info[@"background"] = window.backgroundColor.description ?: @"";
  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  info[@"closeButton"] = close ? NSStringFromRect([close convertRect:close.bounds toView:nil]) : @"";
  info[@"appearance"] = window.appearance.name ?: @"";
  NSWindow *sheet = window.attachedSheet;
  info[@"sheet"] = sheet ? [NSString stringWithFormat:@"%@ %@", sheet.className, NSStringFromRect(sheet.frame)] : @"";
  if (sheet) {
    NSMutableArray *texts = [NSMutableArray array];
    NSMutableArray *stack = [NSMutableArray arrayWithObject:sheet.contentView ?: [NSView new]];
    while (stack.count) {
      NSView *v = stack.lastObject;
      [stack removeLastObject];
      if ([v isKindOfClass:NSTextField.class] && [(NSTextField *)v stringValue].length) [texts addObject:[(NSTextField *)v stringValue]];
      if ([v isKindOfClass:NSButton.class] && [(NSButton *)v title].length) [texts addObject:[(NSButton *)v title]];
      [stack addObjectsFromArray:v.subviews];
    }
    info[@"sheetText"] = texts;
  }
  NSMutableArray *effects = [NSMutableArray array];
  NSMutableArray *walk = [NSMutableArray arrayWithObject:[ArdiaChromeWindowHost rootViewOfWindow:window] ?: window.contentView];
  while (walk.count) {
    NSView *v = walk.lastObject;
    [walk removeLastObject];
    if ([v isKindOfClass:NSVisualEffectView.class]) {
      NSVisualEffectView *e = (NSVisualEffectView *)v;
      [effects addObject:[NSString stringWithFormat:@"material %ld blending %ld state %ld emphasized %d %@ hidden %d alpha %.2f",
                                                    (long)e.material, (long)e.blendingMode, (long)e.state, e.emphasized,
                                                    NSStringFromSize(e.frame.size), e.isHiddenOrHasHiddenAncestor, e.alphaValue]];
    }
    [walk addObjectsFromArray:v.subviews];
  }
  info[@"effects"] = effects;
  NSArray *list = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, (CGWindowID)window.windowNumber));
  info[@"cgBounds"] = [list.firstObject objectForKey:(id)kCGWindowBounds] ?: @{};
  return JSONText(info, @"{}");
}

NSString *InputMethod(NSWindow *window, NSString *argument) {
  NSArray<NSString *> *parts = [argument componentsSeparatedByString:@"|"];
  id<NSTextInputClient> client = (id<NSTextInputClient>)window.firstResponder;
  if (![(id)client conformsToProtocol:@protocol(NSTextInputClient)]) return @"first responder isn't a text input client";
  [client setMarkedText:parts[0] selectedRange:NSMakeRange(parts[0].length, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
  const BOOL marked = client.hasMarkedText;
  const NSRange range = client.markedRange;
  if (parts.count > 1) [client insertText:parts[1] replacementRange:NSMakeRange(NSNotFound, 0)];
  return [NSString stringWithFormat:@"%@ marked=%d range=%@ after commit marked=%d", Describe((NSView *)client), marked,
                                    NSStringFromRange(range), client.hasMarkedText];
}

NSString *TabViews(NSWindow *window, NSString *) {
  NSMutableArray *out = [NSMutableArray array];
  NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:window.contentView];
  while (queue.count) {
    NSView *v = queue.lastObject;
    [queue removeLastObject];
    if ([v isKindOfClass:ArdiaWebView.class]) {
      if (v.hiddenOrHasHiddenAncestor) continue;
      NSMutableArray *subs = [NSMutableArray array];
      for (NSView *sub in v.subviews)
        [subs addObject:[NSString stringWithFormat:@"%@ %@%@", NSStringFromClass(sub.class), NSStringFromRect(sub.frame), sub.hidden ? @" hidden" : @""]];
      [out addObject:@{@"frame" : NSStringFromRect(v.frame), @"subviews" : subs}];
      continue;
    }
    [queue addObjectsFromArray:v.subviews];
  }
  return JSONText(out, @"[]");
}

NSString *Cover(NSWindow *window, bool covered) {
  static NSMapTable<NSWindow *, NSWindow *> *covers = [NSMapTable weakToStrongObjectsMapTable];
  NSWindow *cover = [covers objectForKey:window];
  if (!covered) {
    [cover orderOut:nil];
    [covers removeObjectForKey:window];
    return @"uncovered";
  }
  if (!cover) {
    cover = [[NSWindow alloc] initWithContentRect:NSInsetRect(window.frame, -4, -4)
                                        styleMask:NSWindowStyleMaskBorderless
                                          backing:NSBackingStoreBuffered
                                            defer:NO];
    cover.releasedWhenClosed = NO;
    cover.opaque = YES;
    cover.backgroundColor = NSColor.windowBackgroundColor;
    cover.ignoresMouseEvents = YES;
    [covers setObject:cover forKey:window];
  }
  [cover orderWindow:NSWindowAbove relativeTo:window.windowNumber];
  return NSStringFromRect(cover.frame);
}

NSDictionary<NSString *, DevHandler> *DevHandlers() {
  static NSDictionary<NSString *, DevHandler> *handlers = @{
    @"fakeFullScreenMs" : ^NSString *(NSWindow *, NSString *ms) {
      gActedTransition = MAX(0, ms.doubleValue / 1000);
      return [NSString stringWithFormat:@"%.0f", gActedTransition * 1000];
    },
    @"pageCover" : ^NSString *(NSWindow *, NSString *on) {
      gPageCoverOff = ![on isEqualToString:@"1"];
      return @(!gPageCoverOff).stringValue;
    },
    @"fullScreenProbe" : ^NSString *(NSWindow *w, NSString *ms) { return FullScreenProbe(w, ms); },
    @"fakeFullScreenOcclusionMs" : ^NSString *(NSWindow *, NSString *ms) {
      gActedOcclusionGap = ms.doubleValue == -1 ? NAN : ms.doubleValue / 1000;
      return [NSString stringWithFormat:@"%.0f", ms.doubleValue];
    },
    @"fakeAppActive" : ^NSString *(NSWindow *, NSString *on) {
      ardia_host::SetAppActive([on isEqualToString:@"1"]);
      return @(NSApp.isActive).stringValue;
    },
    @"postNotification" : ^NSString *(NSWindow *w, NSString *a) { return PostNotification(w, a); },
    @"fakeOcclusion" : ^NSString *(NSWindow *w, NSString *to) {
      ActOcclusion(w, [to isEqualToString:@"off"] ? nil : @([to isEqualToString:@"visible"]));
      return @((w.occlusionState & NSWindowOcclusionStateVisible) != 0).stringValue;
    },
    @"fullScreen" : ^NSString *(NSWindow *w, NSString *) { return FullScreen(w, nil); },
    @"fakeFullScreen" : ^NSString *(NSWindow *w, NSString *a) { return FullScreen(w, a); },
    @"fullScreenReveal" : ^NSString *(NSWindow *w, NSString *amount) {
      if (amount.length) SetFullScreenRevealAmount(w, amount.doubleValue);
      return JSONText(FullScreenRevealState(w), @"{}");
    },
    @"children" : ^NSString *(NSWindow *w, NSString *) {
      NSMutableArray *children = [NSMutableArray array];
      for (NSWindow *child in w.childWindows)
        [children addObject:@{@"class" : NSStringFromClass(child.class), @"frame" : NSStringFromRect(child.frame),
                              @"visible" : @(child.visible), @"title" : child.title ?: @""}];
      return JSONText(children, @"[]");
    },
    @"hit" : ^NSString *(NSWindow *w, NSString *at) { return Describe([w.contentView.superview hitTest:WindowPoint(w, at)]); },
    @"windowDrags" : ^NSString *(NSWindow *w, NSString *a) { return WindowDrags(w, a); },
    @"responderChanges" : ^NSString *(NSWindow *w, NSString *a) { return ResponderChanges(w, a); },
    @"fakeActiveClicks" : ^NSString *(NSWindow *w, NSString *a) { return FakeActiveClicks(w, a); },
    @"click" : ^NSString *(NSWindow *w, NSString *a) { return Click(w, a); },
    @"mouse" : ^NSString *(NSWindow *w, NSString *a) { return MouseEvent(w, a); },
    @"drag" : ^NSString *(NSWindow *w, NSString *a) { return Drag(w, a); },
    @"type" : ^NSString *(NSWindow *w, NSString *a) { return TypeText(w, a); },
    @"reserved" : ^NSString *(NSWindow *w, NSString *a) { return Reserved(w, a); },
    @"keys" : ^NSString *(NSWindow *w, NSString *a) { return Keys(w, a); },
    @"ax" : ^NSString *(NSWindow *w, NSString *a) { return AccessibilityTree(w, a); },
    @"winfo" : ^NSString *(NSWindow *w, NSString *a) { return WindowInfo(w, a); },
    @"ns" : ^NSString *(NSWindow *w, NSString *to) {
      if ([to isEqualToString:@"out"]) [w orderOut:nil];
      else [w orderFront:nil];
      return [NSString stringWithFormat:@"visible=%d", w.visible];
    },
    @"performClose" : ^NSString *(NSWindow *w, NSString *) {
      dispatch_async(dispatch_get_main_queue(), ^{ [w performClose:nil]; });
      return @"ok";
    },
    @"style" : ^NSString *(NSWindow *w, NSString *mask) {
      w.styleMask = (NSWindowStyleMask)mask.longLongValue;
      return @"ok";
    },
    @"shadow" : ^NSString *(NSWindow *w, NSString *on) {
      w.hasShadow = [on isEqualToString:@"1"];
      return @"ok";
    },
    @"root" : ^NSString *(NSWindow *w, NSString *to) {
      [ArdiaChromeWindowHost rootViewOfWindow:w].hidden = [to isEqualToString:@"hide"];
      return @"ok";
    },
    @"opaque" : ^NSString *(NSWindow *w, NSString *on) {
      w.opaque = [on isEqualToString:@"1"];
      if (!w.opaque) w.backgroundColor = NSColor.clearColor;
      return [NSString stringWithFormat:@"opaque=%d", w.opaque];
    },
    @"ime" : ^NSString *(NSWindow *w, NSString *a) { return InputMethod(w, a); },
    @"tabviews" : ^NSString *(NSWindow *w, NSString *a) { return TabViews(w, a); },
    @"responder" : ^NSString *(NSWindow *w, NSString *) {
      id r = w.firstResponder;
      return [r isKindOfClass:NSView.class] ? Describe(r) : NSStringFromClass([r class]);
    },
    @"lights" : ^NSString *(NSWindow *w, NSString *) {
      NSButton *close = [w standardWindowButton:NSWindowCloseButton];
      if (!close) return (NSString *)nil;
      NSRect r = [close convertRect:close.bounds toView:nil];
      return [NSString stringWithFormat:@"%.1f,%.1f,%.1f,%.1f", r.origin.x, r.origin.y, r.size.width, r.size.height];
    },
    @"cover" : ^NSString *(NSWindow *w, NSString *) { return Cover(w, true); },
    @"uncover" : ^NSString *(NSWindow *w, NSString *) { return Cover(w, false); },
    @"close-button" : ^NSString *(NSWindow *w, NSString *) {
      [[w standardWindowButton:NSWindowCloseButton] performClick:nil];
      return @"clicked";
    },
  };
  return handlers;
}

}

@implementation ArdiaChromeWindowHost (Dev)

+ (NSString *)devAction:(NSString *)action window:(NSWindow *)window {
  if (!window) return nil;
  if (!ArdiaLaunchConfig.shared.testInstance) return @"test instances only";
  const NSRange colon = [action rangeOfString:@":"];
  NSString *name = colon.location == NSNotFound ? action : [action substringToIndex:colon.location];
  NSString *argument = colon.location == NSNotFound ? nil : [action substringFromIndex:NSMaxRange(colon)];
  DevHandler handler = DevHandlers()[name];
  return handler ? handler(window, argument) : nil;
}

@end
