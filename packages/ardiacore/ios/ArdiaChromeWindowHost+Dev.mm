#import "ArdiaChromeWindowInternal.h"
#import "ArdiaWebView.h"

#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

#include <cmath>

using namespace ardia_window;

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

}

@implementation ArdiaChromeWindowHost (Dev)

+ (NSString *)devAction:(NSString *)action window:(NSWindow *)window {
  if (!window) return nil;
  if ([action hasPrefix:@"fakeFullScreenMs:"]) {
    if (!ardia_host::Background()) return @"test instances only";
    gActedTransition = MAX(0, [action substringFromIndex:17].doubleValue / 1000);
    return [NSString stringWithFormat:@"%.0f", gActedTransition * 1000];
  }
  if ([action hasPrefix:@"pageCover:"]) {
    if (!ardia_host::Background()) return @"test instances only";
    gPageCoverOff = ![[action substringFromIndex:10] isEqualToString:@"1"];
    return @(!gPageCoverOff).stringValue;
  }
  if ([action hasPrefix:@"fullScreenProbe"]) {
    static NSMutableArray *frames;
    static NSTimer *timer;
    if ([action isEqualToString:@"fullScreenProbe"]) {
      NSData *json = [NSJSONSerialization dataWithJSONObject:frames ?: @[] options:0 error:nil];
      return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]";
    }
    if (!ardia_host::Background()) return @"test instances only";
    ArdiaCoreWindow *coreWindow = [ArdiaWindowController forNSWindow:window].coreWindow;
    ArdiaWindowFullScreen *state = coreWindow ? [ArdiaWindowFullScreen ofWindow:coreWindow create:YES] : nil;
    if (!state) return @"not an ArdiaCore window";
    [timer invalidate];
    frames = [NSMutableArray array];
    const CFTimeInterval start = CACurrentMediaTime(), until = start + MAX(0, [action substringFromIndex:16].doubleValue) / 1000;
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
  if ([action hasPrefix:@"fakeFullScreenOcclusionMs:"]) {
    if (!ardia_host::Background()) return @"test instances only";
    const double ms = [action substringFromIndex:26].doubleValue;
    gActedOcclusionGap = ms == -1 ? NAN : ms / 1000;
    return [NSString stringWithFormat:@"%.0f", ms];
  }
  if ([action hasPrefix:@"fakeAppActive:"]) {
    if (!ardia_host::Background()) return @"test instances only";
    ardia_host::SetAppActive([[action substringFromIndex:14] isEqualToString:@"1"]);
    return @(NSApp.isActive).stringValue;
  }
  if ([action hasPrefix:@"postNotification:"]) {
    if (!ardia_host::Background()) return @"test instances only";
    NSArray<NSString *> *parts = [[action substringFromIndex:17] componentsSeparatedByString:@":"];
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
  if ([action hasPrefix:@"fakeOcclusion:"]) {
    if (!ardia_host::Background()) return @"test instances only";
    NSString *to = [action substringFromIndex:14];
    ActOcclusion(window, [to isEqualToString:@"off"] ? nil : @([to isEqualToString:@"visible"]));
    return @((window.occlusionState & NSWindowOcclusionStateVisible) != 0).stringValue;
  }
  if ([action hasPrefix:@"fakeFullScreen:"] || [action isEqualToString:@"fullScreen"]) {
    ArdiaCoreWindow *coreWindow = [ArdiaWindowController forNSWindow:window].coreWindow;
    if (!coreWindow) return @"not an ArdiaCore window";
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    if (parts.count > 1) {
      if (!ardia_host::Background()) return @"test instances only";
      const BOOL enter = [parts[1] isEqualToString:@"1"];
      if (enter != IsWindowFullScreen(window)) ActWindowFullScreen(coreWindow, enter, parts.count > 2 ? parts[2].doubleValue / 1000 : 0);
    }
    NSMutableDictionary *state = [@{
      @"fullScreen" : @(IsWindowFullScreen(window)),
      @"styleMask" : @((window.styleMask & NSWindowStyleMaskFullScreen) != 0),
      @"acted" : @(objc_getAssociatedObject(window, kActedFullScreenKey) != nil),
      @"chromeCounts" : @(coreWindow.actedFullScreen),
    } mutableCopy];
    if (ArdiaWindowFullScreen *page = [ArdiaWindowFullScreen ofWindow:coreWindow create:NO]) state[@"pageFullScreen"] = [page state];
    NSData *json = [NSJSONSerialization dataWithJSONObject:state options:0 error:nil];
    return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"{}";
  }
  if ([action hasPrefix:@"fullScreenReveal:"] || [action isEqualToString:@"fullScreenReveal"]) {
    if (action.length > 17) {
      if (!ardia_host::Background()) return @"test instances only";
      SetFullScreenRevealAmount(window, [action substringFromIndex:17].doubleValue);
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:FullScreenRevealState(window) options:0 error:nil];
    return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"{}";
  }
  NSView *frameView = window.contentView.superview;
  if ([action isEqualToString:@"children"]) {
    NSMutableArray *children = [NSMutableArray array];
    for (NSWindow *child in window.childWindows)
      [children addObject:@{@"class" : NSStringFromClass(child.class), @"frame" : NSStringFromRect(child.frame),
                            @"visible" : @(child.visible), @"title" : child.title ?: @""}];
    NSData *json = [NSJSONSerialization dataWithJSONObject:children options:0 error:nil];
    return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]";
  }
  if ([action hasPrefix:@"hit:"]) {
    NSPoint p = WindowPoint(window, [action substringFromIndex:4]);
    return Describe([frameView hitTest:p]);
  }
  if ([action isEqualToString:@"windowDrags"]) {
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
    NSString *out = [NSString stringWithFormat:@"%lu\n%@", (unsigned long)drags.count, [drags componentsJoinedByString:@"\n---\n"]];
    [drags removeAllObjects];
    return out;
  }
  if ([action isEqualToString:@"responderChanges"]) {
    if (!ardia_host::Background()) return @"test instances only";
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
    NSString *out = [NSString stringWithFormat:@"%lu\n%@", (unsigned long)changes.count, [changes componentsJoinedByString:@"\n---\n"]];
    [changes removeAllObjects];
    return out;
  }
  if ([action isEqualToString:@"fakeActiveClicks"]) {
    if (!ardia_host::Background()) return @"test instances only";
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      NSMutableSet<Class> *classes = [NSMutableSet setWithObject:NSTextView.class];
      if (Class page = NSClassFromString(@"RenderWidgetHostViewCocoa")) [classes addObject:page];
      for (Class cls in classes) {
        SEL sel = @selector(acceptsFirstMouse:);
        Method m = class_getInstanceMethod(cls, sel);
        IMP original = method_getImplementation(m);
        IMP takes = imp_implementationWithBlock(^BOOL(NSView *v, NSEvent *e) {
          return v.window.isKeyWindow || ((BOOL(*)(id, SEL, NSEvent *))original)(v, sel, e);
        });
        if (!class_addMethod(cls, sel, takes, method_getTypeEncoding(m))) method_setImplementation(m, takes);
      }
    });
    return @"1";
  }
  if ([action hasPrefix:@"click:"]) {
    NSString *spec = [action substringFromIndex:6];
    bool right = [spec hasSuffix:@",right"];
    NSPoint p = WindowPoint(window, spec);
    NSView *target = [frameView hitTest:p];
    NSString *hit = Describe(target);
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
    return hit;
  }
  if ([action hasPrefix:@"mouse:"]) {
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    if (parts.count < 3) return @"mouse:<down|up|dragged|moved|otherdown|otherup>:<x>,<y>[,<clickCount>[,<flags>]]";
    NSDictionary<NSString *, NSNumber *> *types = @{
      @"down" : @(NSEventTypeLeftMouseDown), @"up" : @(NSEventTypeLeftMouseUp),
      @"dragged" : @(NSEventTypeLeftMouseDragged), @"moved" : @(NSEventTypeMouseMoved),
      @"otherdown" : @(NSEventTypeOtherMouseDown), @"otherup" : @(NSEventTypeOtherMouseUp),
    };
    NSNumber *type = types[parts[1]];
    if (!type) return @"unknown mouse event";
    NSArray<NSString *> *n = [parts[2] componentsSeparatedByString:@","];
    NSPoint p = WindowPoint(window, parts[2]);
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
    return Describe([frameView hitTest:p]);
  }
  if ([action hasPrefix:@"drag:"]) {
    NSMutableArray<NSValue *> *points = [NSMutableArray array];
    for (NSString *spec in [[action substringFromIndex:5] componentsSeparatedByString:@";"])
      [points addObject:[NSValue valueWithPoint:WindowPoint(window, spec)]];
    if (points.count < 2) return @"drag needs two points";
    NSMutableArray<NSEvent *> *events = [NSMutableArray arrayWithObject:Mouse(window, NSEventTypeLeftMouseDown, points[0].pointValue)];
    for (NSUInteger i = 1; i < points.count; i++) {
      NSPoint a = points[i - 1].pointValue, b = points[i].pointValue;
      for (int k = 1; k <= 12; k++)
        [events addObject:Mouse(window, NSEventTypeLeftMouseDragged, NSMakePoint(a.x + (b.x - a.x) * k / 12, a.y + (b.y - a.y) * k / 12))];
    }
    [events addObject:Mouse(window, NSEventTypeLeftMouseUp, points.lastObject.pointValue)];
    NSString *hit = Describe([frameView hitTest:points[0].pointValue]);
    for (NSUInteger i = 0; i < events.count; i++)
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((i ? 150 + i * 16 : 0) * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
        [window sendEvent:events[i]];
      });
    return [NSString stringWithFormat:@"%@ (%lu events)", hit, (unsigned long)events.count];
  }
  if ([action hasPrefix:@"type:"]) {
    NSString *text = [action substringFromIndex:5];
    for (NSUInteger i = 0; i < text.length; i++) {
      NSString *c = [text substringWithRange:NSMakeRange(i, 1)];
      [window.firstResponder keyDown:Key(window, NSEventTypeKeyDown, 0, c, 0)];
      [window.firstResponder keyUp:Key(window, NSEventTypeKeyUp, 0, c, 0)];
    }
    return Describe((NSView *)window.firstResponder);
  }
  if ([action hasPrefix:@"keys:"]) {
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    if (parts.count < 3) return @"keys:<flags>:<characters>[:<keyCode>]";
    NSEventModifierFlags flags = (NSEventModifierFlags)parts[1].longLongValue;
    unsigned short code = parts.count > 3 ? (unsigned short)parts[3].intValue : 0;
    [NSApp postEvent:Key(window, NSEventTypeKeyDown, flags, parts[2], code) atStart:YES];
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
  if ([action isEqualToString:@"ax"]) {
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
  if ([action isEqualToString:@"winfo"]) {
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
    NSData *json = [NSJSONSerialization dataWithJSONObject:info options:0 error:nil];
    return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  }
  if ([action hasPrefix:@"ns:"]) {
    if ([action hasSuffix:@"out"]) [window orderOut:nil];
    else [window orderFront:nil];
    return [NSString stringWithFormat:@"visible=%d", window.visible];
  }
  if ([action isEqualToString:@"performClose"]) {
    dispatch_async(dispatch_get_main_queue(), ^{ [window performClose:nil]; });
    return @"ok";
  }
  if ([action hasPrefix:@"style:"]) {
    window.styleMask = (NSWindowStyleMask)[action substringFromIndex:6].longLongValue;
    return @"ok";
  }
  if ([action hasPrefix:@"shadow:"]) {
    window.hasShadow = [action hasSuffix:@"1"];
    return @"ok";
  }
  if ([action hasPrefix:@"root:"]) {
    [ArdiaChromeWindowHost rootViewOfWindow:window].hidden = [action hasSuffix:@"hide"];
    return @"ok";
  }
  if ([action hasPrefix:@"opaque:"]) {
    window.opaque = [action hasSuffix:@"1"];
    if (!window.opaque) window.backgroundColor = NSColor.clearColor;
    return [NSString stringWithFormat:@"opaque=%d", window.opaque];
  }
  if ([action hasPrefix:@"ime:"]) {
    NSArray<NSString *> *parts = [[action substringFromIndex:4] componentsSeparatedByString:@"|"];
    id<NSTextInputClient> client = (id<NSTextInputClient>)window.firstResponder;
    if (![(id)client conformsToProtocol:@protocol(NSTextInputClient)]) return @"first responder isn't a text input client";
    [client setMarkedText:parts[0] selectedRange:NSMakeRange(parts[0].length, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
    const BOOL marked = client.hasMarkedText;
    const NSRange range = client.markedRange;
    if (parts.count > 1) [client insertText:parts[1] replacementRange:NSMakeRange(NSNotFound, 0)];
    return [NSString stringWithFormat:@"%@ marked=%d range=%@ after commit marked=%d", Describe((NSView *)client), marked,
                                      NSStringFromRange(range), client.hasMarkedText];
  }
  if ([action isEqualToString:@"tabviews"]) {
    NSMutableArray *out = [NSMutableArray array];
    Class tabClass = ArdiaWebView.class;
    NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:window.contentView];
    while (queue.count) {
      NSView *v = queue.lastObject;
      [queue removeLastObject];
      if ([v isKindOfClass:tabClass]) {
        if (v.hiddenOrHasHiddenAncestor) continue;
        NSMutableArray *subs = [NSMutableArray array];
        for (NSView *sub in v.subviews)
          [subs addObject:[NSString stringWithFormat:@"%@ %@%@", NSStringFromClass(sub.class), NSStringFromRect(sub.frame),
                                                     sub.hidden ? @" hidden" : @""]];
        [out addObject:@{@"frame" : NSStringFromRect(v.frame), @"subviews" : subs}];
        continue;
      }
      [queue addObjectsFromArray:v.subviews];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
    return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  }
  if ([action isEqualToString:@"responder"]) {
    id r = window.firstResponder;
    return [r isKindOfClass:NSView.class] ? Describe(r) : NSStringFromClass([r class]);
  }
  if ([action isEqualToString:@"lights"]) {
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    if (!close) return nil;
    NSRect r = [close convertRect:close.bounds toView:nil];
    return [NSString stringWithFormat:@"%.1f,%.1f,%.1f,%.1f", r.origin.x, r.origin.y, r.size.width, r.size.height];
  }
  if ([action isEqualToString:@"cover"] || [action isEqualToString:@"uncover"]) {
    static NSMapTable<NSWindow *, NSWindow *> *covers = [NSMapTable weakToStrongObjectsMapTable];
    NSWindow *cover = [covers objectForKey:window];
    if ([action isEqualToString:@"cover"]) {
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
    [cover orderOut:nil];
    [covers removeObjectForKey:window];
    return @"uncovered";
  }
  if ([action isEqualToString:@"close-button"]) {
    [[window standardWindowButton:NSWindowCloseButton] performClick:nil];
    return @"clicked";
  }
  return nil;
}

@end
