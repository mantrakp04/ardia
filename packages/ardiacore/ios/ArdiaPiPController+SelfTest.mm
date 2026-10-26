#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaLaunchConfig.h"
#import "ArdiaChromeWindowHost.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

using namespace ardia_pip;

@implementation ArdiaPiPController (SelfTest)

- (NSString *)snapshot:(NSString *)name {
  NSWindow *window = _window;
  NSString *dir = ArdiaLaunchConfig.shared.dataDirectory ?: @"/tmp";
  NSView *content = ArdiaWindowRootView(window);
  NSSize size = content.bounds.size;
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nil pixelsWide:size.width * 2 pixelsHigh:size.height * 2
                                                                bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
                                                               colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  CGContextRef cg = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep].CGContext;
  CGContextSetRGBFillColor(cg, 0.36, 0.42, 0.5, 1);
  CGContextFillRect(cg, CGRectMake(0, 0, size.width * 2, size.height * 2));
  CGContextScaleCTM(cg, 2, 2);
  if (content.isFlipped) CGContextTranslateCTM(cg, 0, size.height), CGContextScaleCTM(cg, 1, -1);
  [content.layer renderInContext:cg];
  NSString *path = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@"pip-%@.png", name]];
  [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path atomically:YES];
  return path;
}

- (void)runSelfTest {
  NSMutableArray *steps = [NSMutableArray array];
  NSWindow *window = _window;
  NSRect start = window.frame;
  auto outermost = [=](BOOL right) {
    NSScreen *pick = ScreenFor(start);
    for (NSScreen *screen in NSScreen.screens) {
      const NSRect f = screen.frame;
      if (NSMidY(start) < NSMinY(f) || NSMidY(start) >= NSMaxY(f)) continue;
      if (right ? NSMaxX(f) > NSMaxX(pick.frame) : NSMinX(f) < NSMinX(pick.frame)) pick = screen;
    }
    return pick.visibleFrame;
  };
  const NSRect visibleRight = outermost(YES), visibleLeft = outermost(NO);
  auto record = [=](NSString *name, BOOL pass, NSDictionary *extra) {
    NSMutableDictionary *step = [@{@"step" : name, @"pass" : @(pass), @"frame" : NSStringFromRect(window.frame)} mutableCopy];
    [step addEntriesFromDictionary:extra ?: @{}];
    [steps addObject:step];
    NSLog(@"[pip-selftest] %@ %@ %@", name, pass ? @"PASS" : @"FAIL", step);
  };
  NSString *dir = ArdiaLaunchConfig.shared.dataDirectory ?: @"/tmp";
  auto snapshot = [=](NSString *name) { [self snapshot:name]; };
  auto write = [=] {
    NSString *path = [dir stringByAppendingPathComponent:@"pip-selftest.json"];
    NSDictionary *result = @{@"windowNumber" : @(window.windowNumber), @"host" : self.host ?: @"", @"steps" : steps};
    [[NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil] writeToFile:path atomically:YES];
  };
  auto after = [](double seconds, dispatch_block_t block) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
  };
  auto rounded = [=] {
    CALayer *layer = window.contentView.layer;
    return layer.cornerRadius == kCornerRadius && layer.masksToBounds && !window.opaque && window.hasShadow &&
           self.overlay.layer.borderWidth == 1;
  };
  auto dragTo = [=](CGFloat x) {
    self->_sawDrag = YES;
    [window setFrameOrigin:NSMakePoint(x, NSMinY(window.frame))];
    [NSObject cancelPreviousPerformRequestsWithTarget:self selector:@selector(settle) object:nil];
    [self settle];
  };

  record(@"attached", self.overlay.superview == ArdiaWindowRootView(window) && [ArdiaWindowRootView(window).subviews.lastObject isEqual:self.overlay],
         @{@"level" : @(window.level), @"keepOnTop" : @(self.keepOnTop), @"shadow" : @(window.hasShadow)});
  after(0.6, ^{
    record(@"nothing of ours at rest", self.overlay.handle.hidden && [self.overlay hitTest:NSMakePoint(20, 20)] == nil, nil);
    record(@"rounded corners", rounded(), @{
      @"cornerRadius" : @(window.contentView.layer.cornerRadius),
      @"masksToBounds" : @(window.contentView.layer.masksToBounds),
      @"opaque" : @(window.opaque),
      @"shadow" : @(window.hasShadow),
      @"rim" : @(self.overlay.layer.borderWidth),
    });
    snapshot(@"rest");
    dragTo(NSMaxX(visibleRight) - NSWidth(window.frame) * 0.3);
  });
  after(2.2, ^{
    record(@"drag past right edge stashes", self.stashedEdge == ArdiaPiPEdgeRight &&
                                                 fabs(NSMinX(window.frame) - (NSMaxX(visibleRight) - kPeek)) < 0.5 &&
                                                 !self.overlay.handle.hidden && self.overlay.handle.alphaValue > 0.99,
           @{@"handle" : NSStringFromRect(self.overlay.handle.frame)});
    snapshot(@"stashed-right");
    [window setFrameOrigin:NSMakePoint(NSMaxX(visibleRight) - NSWidth(window.frame) - 40, NSMinY(window.frame))];
  });
  after(3.4, ^{
    record(@"Chrome's move re-stashes", self.stashedEdge == ArdiaPiPEdgeRight && fabs(NSMinX(window.frame) - (NSMaxX(visibleRight) - kPeek)) < 0.5, nil);
    self.overlay.handle.onClick();
  });
  after(4.6, ^{
    record(@"handle click brings it back", self.stashedEdge == ArdiaPiPEdgeNone && self.overlay.handle.hidden &&
                                                fabs(NSMaxX(window.frame) - (NSMaxX(visibleRight) - kReturnMargin)) < 0.5,
           nil);
    dragTo(NSMinX(visibleLeft) - NSWidth(window.frame) * 0.7);
  });
  after(5.8, ^{
    record(@"drag past left edge stashes", self.stashedEdge == ArdiaPiPEdgeLeft &&
                                                fabs(NSMaxX(window.frame) - (NSMinX(visibleLeft) + kPeek)) < 0.5 &&
                                                NSMinX(self.overlay.handle.frame) == NSWidth(self.overlay.bounds) - kPeek,
           @{@"handle" : NSStringFromRect(self.overlay.handle.frame)});
    snapshot(@"stashed-left");
    dragTo(NSMinX(visibleLeft) + 100);
  });
  after(7.0, ^{
    record(@"drag out of the stash", self.stashedEdge == ArdiaPiPEdgeNone && fabs(NSMinX(window.frame) - (NSMinX(visibleLeft) + 100)) < 0.5, nil);
    NSArray *saved = [NSArray arrayWithContentsOfFile:[dir stringByAppendingPathComponent:@"Chromium/ArdiaPictureInPicture.plist"]];
    NSRect frame = window.frame;
    CGFloat top = NSMaxY(NSScreen.screens.firstObject.frame) - NSMaxY(frame);
    record(@"Chrome remembers where it was left",
           saved.count == 4 && [saved[0] intValue] == (int)NSMinX(frame) && [saved[1] intValue] == (int)top &&
               [saved[2] intValue] == (int)NSWidth(frame) && [saved[3] intValue] == (int)NSHeight(frame),
           @{@"saved" : saved ?: @[]});
    NSMenu *menu = [self menu];
    BOOL onBefore = [menu itemWithTitle:@"Keep Window on Top"].state == NSControlStateValueOn;
    [self toggleKeepOnTop:nil];
    BOOL off = window.level == NSNormalWindowLevel && [[self menu] itemWithTitle:@"Keep Window on Top"].state == NSControlStateValueOff;
    [self toggleKeepOnTop:nil];
    record(@"Keep Window on Top toggles", onBefore && off && window.level == NSFloatingWindowLevel,
           @{@"menu" : [[self menu].itemArray valueForKey:@"title"]});
    [window setFrame:NSInsetRect(start, 40, 22.5) display:YES];
  });
  after(7.6, ^{
    record(@"still rounded after a resize", rounded(), nil);
    [window setFrame:start display:YES];
  });
  after(8.2, ^{
    record(@"menu: Back to Tab", self.view != nil, nil);
    [self backToTab];
  });
  after(9.7, ^{
    record(@"PiP closed after Back to Tab", !window.visible, nil);
    write();
  });
}

- (void)runButtonSelfTest:(NSString *)button {
  NSWindow *window = _window;
  NSString *dir = ArdiaLaunchConfig.shared.dataDirectory ?: @"/tmp";
  CGFloat center = kButtonMargin + kButtonSize / 2;
  NSPoint point = NSMakePoint([button isEqual:@"close"] ? NSWidth(window.frame) - center : center, NSHeight(window.frame) - center);
  auto event = [=](NSEventType type) {
    return [NSEvent mouseEventWithType:type location:point modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                          windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:type == NSEventTypeLeftMouseDown];
  };
  auto after = [](double seconds, dispatch_block_t block) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
  };
  after(1.5, ^{ [window.contentView mouseMoved:event(NSEventTypeMouseMoved)]; });
  after(2.1, ^{
    const BOOL prevents = PreventsActivation(window);
    const NSInteger activations = gActivations;
    [NSApp postEvent:event(NSEventTypeLeftMouseDown) atStart:NO];
    [NSApp postEvent:event(NSEventTypeLeftMouseUp) atStart:NO];
    after(1, ^{
      NSDictionary *result = @{
        @"button" : button,
        @"closed" : @(!window.visible),
        @"point" : NSStringFromPoint(point),
        @"preventsActivation" : @(prevents),
        @"activations" : @(gActivations - activations),
        @"appActive" : @(NSApp.isActive),
      };
      NSLog(@"[pip-selftest] %@", result);
      [[NSJSONSerialization dataWithJSONObject:result options:0 error:nil]
          writeToFile:[dir stringByAppendingPathComponent:@"pip-button-selftest.json"]
           atomically:YES];
    });
  });
}

- (void)runHoverSelfTest {
  NSWindow *window = _window;
  NSString *dir = ArdiaLaunchConfig.shared.dataDirectory ?: @"/tmp";
  NSString *where = [ArdiaLaunchConfig.shared testValue:@"pipHover"];
  CGFloat center = kButtonMargin + kButtonSize / 2;
  NSSize size = window.frame.size;
  NSPoint point = [where isEqual:@"close"]  ? NSMakePoint(size.width - center, size.height - center)
                  : [where isEqual:@"back"] ? NSMakePoint(center, size.height - center)
                                            : NSMakePoint(size.width / 2, size.height * 0.7);
  __weak NSWindow *weakWindow = window;
  NSTimer *timer = [NSTimer timerWithTimeInterval:1 repeats:YES block:^(NSTimer *t) {
    NSWindow *strongWindow = weakWindow;
    if (!strongWindow.visible) return [t invalidate];
    NSEvent *move = [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:point modifierFlags:0
                                      timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:strongWindow.windowNumber
                                        context:nil eventNumber:0 clickCount:0 pressure:0];
    [strongWindow.contentView mouseMoved:move];
  }];
  [NSRunLoop.currentRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
  NSDictionary *result = @{
    @"windowNumber" : @(window.windowNumber),
    @"frame" : NSStringFromRect(window.frame),
    @"hover" : where ?: @"video",
    @"cornerRadius" : @(window.contentView.layer.cornerRadius),
    @"masksToBounds" : @(window.contentView.layer.masksToBounds),
    @"opaque" : @(window.opaque),
  };
  [[NSJSONSerialization dataWithJSONObject:result options:0 error:nil] writeToFile:[dir stringByAppendingPathComponent:@"pip-hover.json"]
                                                                       atomically:YES];
}

@end
