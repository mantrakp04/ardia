#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"
#import "ArdiaLaunchConfig.h"

#import <QuartzCore/QuartzCore.h>

using namespace ardia_web_view;
using namespace ardia_runtime;

namespace ardia_web_view {

NSString *gPeekModifier = @"shift";
}

namespace {

NSString *gSplitLinkModifier = @"altShift";
NSSet<NSString *> *gPeekOtherSiteTabs = [NSSet set];
}

static const NSEventModifierFlags kPeekKeyMask = NSEventModifierFlagOption | NSEventModifierFlagShift | NSEventModifierFlagCommand | NSEventModifierFlagControl;
static NSEventModifierFlags gPeekUpKeys = 0;
static CFTimeInterval gPeekUpAt = -1;
static __weak ArdiaWebView *gPeekUpView;
static NSUInteger gPeekUpSeq = 0;
static NSUInteger gPeekUsedSeq = 0;
static BOOL gPeekPressedSinceUp = NO;
static const CFTimeInterval kPeekGestureLifetime = 10;
static const CFTimeInterval kPeekFallbackLifetime = 60;

static ArdiaWebView *PageViewUnder(NSEvent *event) {
  NSView *content = event.window.contentView;
  NSView *root = content.superview ?: content;
  NSView *hit = root ? [root hitTest:[root convertPoint:event.locationInWindow fromView:nil]] : nil;
  for (NSView *view = hit; view; view = view.superview)
    if ([view isKindOfClass:ArdiaWebView.class]) return (ArdiaWebView *)view;
  return nil;
}

static BOOL PeekTestHooks() {
  static const BOOL on = ardia_host::Background() && ArdiaLaunchConfig.shared.testInstance;
  return on;
}

static NSString *PeekKeyNames(NSEventModifierFlags flags) {
  NSMutableString *names = [NSMutableString string];
  if (flags & NSEventModifierFlagControl) [names appendString:@"⌃"];
  if (flags & NSEventModifierFlagOption) [names appendString:@"⌥"];
  if (flags & NSEventModifierFlagShift) [names appendString:@"⇧"];
  if (flags & NSEventModifierFlagCommand) [names appendString:@"⌘"];
  return names;
}

namespace ardia_web_view {

void InstallPeekMonitor() {
  static id monitor;
  if (monitor) return;
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp
                                                  handler:^NSEvent *(NSEvent *event) {
                                                    if (event.type == NSEventTypeLeftMouseDown) {
                                                      gPeekPressedSinceUp = YES;
                                                      return event;
                                                    }
                                                    gPeekUpKeys = event.modifierFlags & kPeekKeyMask;
                                                    gPeekUpAt = CACurrentMediaTime();
                                                    gPeekUpView = PageViewUnder(event);
                                                    gPeekPressedSinceUp = NO;
                                                    gPeekUpSeq++;
                                                    return event;
                                                  }];
}

BOOL PeekTracing() {
#if DEBUG
  return YES;
#else
  return PeekTestHooks();
#endif
}

void PeekTrace(NSDictionary *entry) {
  NSString *dir = ArdiaLaunchConfig.shared.dataDirectory;
  if (!PeekTracing() || !dir) return;
  NSString *path = [dir stringByAppendingPathComponent:@"peek.log"];
  NSData *line = [[NSString stringWithFormat:@"%@ %@\n", NSDate.date, JSONText(entry)] dataUsingEncoding:NSUTF8StringEncoding];
  NSFileHandle *file = [NSFileHandle fileHandleForWritingAtPath:path];
  if (!file) return (void)[line writeToFile:path atomically:NO];
  if ([file seekToEndOfFile] < (2 << 20)) [file writeData:line];
  [file closeFile];
}

NSString *SplitLinkModifier() {
  return [gSplitLinkModifier isEqualToString:@"alt"] && ![gPeekModifier isEqualToString:@"alt"] ? @"alt" : @"altShift";
}

NSString *PeekConfigJSON(ArdiaWebView *view) {
  return JSONText(@{@"modifier" : gPeekModifier, @"split" : SplitLinkModifier(), @"trace" : @(PeekTracing()), @"otherSites" : @(view.peeksLinksToOtherSites)});
}
}

static NSString *const kOtherSiteKey = @"site";

static NSEventModifierFlags LinkKeyFlags(NSString *key) {
  static NSDictionary<NSString *, NSNumber *> *flags = @{
    @"alt" : @(NSEventModifierFlagOption),
    @"shift" : @(NSEventModifierFlagShift),
    @"altShift" : @(NSEventModifierFlagOption | NSEventModifierFlagShift),
    @"altMeta" : @(NSEventModifierFlagOption | NSEventModifierFlagCommand),
  };
  return key.length ? flags[key].unsignedIntegerValue : 0;
}

static NSString *LinkKeyAction(NSString *key) {
  if (!LinkKeyFlags(key)) return nil;
  if ([key isEqualToString:gPeekModifier]) return @"peek";
  if ([key isEqualToString:@"altShift"] || [key isEqualToString:@"altMeta"] || [key isEqualToString:SplitLinkModifier()]) return @"split";
  return nil;
}

@implementation ArdiaWebView (Peek)

+ (BOOL)devPostPeekMouseUp:(NSString *)keys over:(NSString *)transferKey {
  if (!PeekTestHooks()) return NO;
  ArdiaWebView *target = nil;
  for (ArdiaWebView *view in LiveViews().allObjects)
    if (view->_visible && view.window && (!transferKey.length || [view.transferKey isEqualToString:transferKey])) target = view;
  NSWindow *window = target.window;
  if (!window) return NO;
  NSEventModifierFlags flags = 0;
  if ([keys containsString:@"⌥"]) flags |= NSEventModifierFlagOption;
  if ([keys containsString:@"⇧"]) flags |= NSEventModifierFlagShift;
  if ([keys containsString:@"⌘"]) flags |= NSEventModifierFlagCommand;
  if ([keys containsString:@"⌃"]) flags |= NSEventModifierFlagControl;
  const NSPoint at = [target convertPoint:NSMakePoint(NSMidX(target.bounds), NSMidY(target.bounds)) toView:nil];
  NSEvent *up = [NSEvent mouseEventWithType:NSEventTypeLeftMouseUp location:at modifierFlags:flags
                                  timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber
                                    context:nil eventNumber:0 clickCount:1 pressure:0];
  [NSApp postEvent:up atStart:NO];
  if ([keys containsString:@"+press"]) {
    NSEvent *down = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDown location:at modifierFlags:0
                                      timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber
                                        context:nil eventNumber:0 clickCount:1 pressure:1];
    [NSApp postEvent:down atStart:NO];
  }
  return YES;
}

+ (void)setPeekModifier:(NSString *)modifier {
  InstallPeekMonitor();
  NSString *next = [@[ @"alt", @"shift" ] containsObject:modifier ?: @""] ? modifier : @"off";
  if ([next isEqualToString:gPeekModifier]) return;
  gPeekModifier = [next copy];
  for (ArdiaWebView *view in LiveViews().allObjects) [view pushPeekModifier];
}

+ (void)setPeekOtherSiteTabs:(NSArray<NSString *> *)tabIds {
  InstallPeekMonitor();
  NSSet<NSString *> *next = [NSSet setWithArray:tabIds ?: @[]];
  if ([next isEqualToSet:gPeekOtherSiteTabs]) return;
  NSMutableSet<NSString *> *changed = [next mutableCopy];
  [changed unionSet:gPeekOtherSiteTabs];
  NSMutableSet<NSString *> *kept = [next mutableCopy];
  [kept intersectSet:gPeekOtherSiteTabs];
  [changed minusSet:kept];
  gPeekOtherSiteTabs = next;
  for (ArdiaWebView *view in LiveViews().allObjects)
    if (view->_transferKey.length && [changed containsObject:view->_transferKey]) [view pushPeekModifier];
}

- (BOOL)peeksLinksToOtherSites {
  return _transferKey.length && [gPeekOtherSiteTabs containsObject:_transferKey];
}

+ (void)setSplitLinkModifier:(NSString *)modifier {
  InstallPeekMonitor();
  NSString *next = [modifier isEqualToString:@"alt"] ? @"alt" : @"altShift";
  if ([next isEqualToString:gSplitLinkModifier]) return;
  gSplitLinkModifier = [next copy];
  for (ArdiaWebView *view in LiveViews().allObjects) [view pushPeekModifier];
}

- (void)pushPeekModifier {
  if (!_tab) return;
  NSString *json = PeekConfigJSON(self);
  [self callFrame:@"" kind:@"peekConfig" json:json];
  for (NSString *frameId in [ScriptFramesOf(_tab) copy]) [self callFrame:frameId kind:@"peekConfig" json:json];
}

- (void)fallBackFromPeek:(NSDictionary *)dict url:(NSString *)url frame:(NSString *)frameId reason:(NSString *)reason test:(BOOL)test {
  NSString *key = Text(dict, @"key", 8) ?: @"";
  if ([key isEqualToString:kOtherSiteKey]) {
    PeekTrace(@{@"event" : @"fallback", @"url" : url ?: @"", @"key" : key, @"reason" : reason, @"action" : @"follow"});
    return [self callFrame:frameId kind:@"peekRefused" json:JSONText(@{@"url" : url ?: @"", @"reason" : reason, @"follow" : @YES})];
  }
  const NSEventModifierFlags pageFlag = LinkKeyFlags(key);
  const BOOL split = [LinkKeyAction(key) isEqualToString:@"split"];
  NSString *scheme = (url.length ? [NSURL URLWithString:url].scheme.lowercaseString : nil) ?: @"";
  const BOOL fresh = gPeekUpAt >= 0 && CACurrentMediaTime() - gPeekUpAt <= kPeekFallbackLifetime && !gPeekPressedSinceUp;
  const BOOL userClicked = test || (fresh && gPeekUpSeq != gPeekUsedSeq && gPeekUpView == self && gPeekUpKeys == pageFlag);
  const BOOL fallsBack = !split && pageFlag && [@[ @"http", @"https" ] containsObject:scheme] && userClicked;
  NSString *origin = Text(dict, @"origin", 1024).lowercaseString;
  const BOOL sameOrigin = origin.length && [OriginOf(url) isEqualToString:origin];
  NSString *action = !fallsBack ? @"none" : pageFlag == NSEventModifierFlagShift ? @"new window" : sameOrigin ? @"page download" : @"background tab";
  PeekTrace(@{@"event" : @"fallback", @"url" : url ?: @"", @"key" : key, @"reason" : reason, @"userClicked" : @(userClicked), @"split" : @(split), @"action" : action});
  if (split && userClicked && !test) gPeekUsedSeq = gPeekUpSeq;
  if (!fallsBack) return;
  if (!test) gPeekUsedSeq = gPeekUpSeq;
  if (pageFlag == NSEventModifierFlagShift) return [self emit:@"openWindow" payload:@{@"url" : url, @"disposition" : @"window", @"userGesture" : @YES}];
  if (sameOrigin) return [self callFrame:frameId kind:@"peekRefused" json:JSONText(@{@"url" : url, @"reason" : reason, @"download" : @YES})];
  [self emit:@"openWindow" payload:@{@"url" : url, @"disposition" : @"background", @"userGesture" : @YES}];
}

- (void)peekLink:(NSDictionary *)dict frame:(NSString *)frameId main:(BOOL)main {
  NSString *url = Text(dict, @"url", 8192);
  NSString *scheme = (url.length ? [NSURL URLWithString:url].scheme.lowercaseString : nil) ?: @"";
  NSWindow *window = self.window;
  NSString *key = Text(dict, @"key", 8);
  const NSEventModifierFlags flag = LinkKeyFlags(key);
  const BOOL otherSite = [key isEqualToString:kOtherSiteKey];
  NSString *action = otherSite ? (self.peeksLinksToOtherSites ? @"peek" : nil) : LinkKeyAction(key);
  const CFTimeInterval sinceUp = gPeekUpAt < 0 ? -1 : CACurrentMediaTime() - gPeekUpAt;
  static const BOOL strict = [ArdiaLaunchConfig.shared testFlag:@"peekStrict"];
  const BOOL test = PeekTestHooks() && !strict;
  NSString *refused = nil;
  if (!action) refused = @"that key opens nothing now";
  else if (otherSite && !main) refused = @"only the page itself peeks links to other sites";
  else if (!_visible || !window) refused = @"page not shown";
  else if (![@[ @"http", @"https" ] containsObject:scheme]) refused = @"not http(s)";
  else if (!test && gPeekUpAt < 0) refused = @"no left mouse-up yet";
  else if (!test && gPeekUpSeq == gPeekUsedSeq) refused = @"that mouse-up already opened a peek";
  else if (!test && gPeekPressedSinceUp) refused = @"the mouse was pressed again since that mouse-up";
  else if (!test && sinceUp > kPeekGestureLifetime) refused = @"the last mouse-up is too old";
  else if (!test && gPeekUpView != self) refused = @"the mouse-up wasn't over this page";
  else if (!test && gPeekUpKeys != flag) refused = @"the mouse-up's keys aren't the page's key alone";
  PeekTrace(@{
    @"event" : @"peek",
    @"url" : url ?: @"",
    @"main" : @(main),
    @"chosen" : gPeekModifier,
    @"split" : SplitLinkModifier(),
    @"key" : key ?: NSNull.null,
    @"action" : action ?: NSNull.null,
    @"refused" : refused ?: NSNull.null,
    @"mouseUpKeys" : PeekKeyNames(gPeekUpKeys),
    @"sinceMouseUp" : @(sinceUp),
    @"pressedSince" : @(gPeekPressedSinceUp),
    @"mouseUpOverThisPage" : @(gPeekUpView == self),
    @"mouseUpPage" : gPeekUpView.transferKey ?: NSNull.null,
    @"thisPage" : _transferKey ?: NSNull.null,
    @"keysNow" : PeekKeyNames(NSEvent.modifierFlags & kPeekKeyMask),
    @"buttonsNow" : @(NSEvent.pressedMouseButtons),
    @"moved" : [dict[@"moved"] isKindOfClass:NSNumber.class] ? dict[@"moved"] : NSNull.null,
    @"testInstance" : @(test),
  });
  if (refused) return [self fallBackFromPeek:dict url:url frame:frameId reason:refused test:test];
  if (!test) gPeekUsedSeq = gPeekUpSeq;
  if ([action isEqualToString:@"split"]) return [self emit:@"openWindow" payload:@{@"url" : url, @"disposition" : @"split", @"userGesture" : @YES}];
  double x, y;
  NSPoint point;
  if (main && Finite(dict, @"x", &x) && Finite(dict, @"y", &y)) {
    const CGFloat scale = window.backingScaleFactor > 0 ? window.backingScaleFactor : 1;
    point = NSMakePoint(x / scale, y / scale);
  } else {
    point = [self convertPoint:[window convertPointFromScreen:NSEvent.mouseLocation] fromView:nil];
  }
  point.x = MIN(MAX(point.x, 0), NSWidth(self.bounds));
  point.y = MIN(MAX(point.y, 0), NSHeight(self.bounds));
  const NSPoint inWindow = [self convertPoint:point toView:nil];
  const CGFloat top = window.contentView.frame.size.height - inWindow.y;
  [self emit:@"openWindow"
      payload:@{@"url" : url, @"disposition" : @"peek", @"userGesture" : @YES, @"point" : @{@"x" : @(inWindow.x), @"y" : @(top)}}];
}

@end
