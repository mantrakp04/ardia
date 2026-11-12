#import "ArdiaInternal.h"
#import "ArdiaContentBlockerInternal.h"
#import "ArdiaWindowController.h"

#import <objc/message.h>

namespace ardia_host {

NSString *DescribeFocusWindow(NSWindow *window) {
  if (!window) return @"none";
  NSMutableArray<NSString *> *flags = [NSMutableArray array];
  if (window.isVisible) [flags addObject:@"visible"];
  if (window.alphaValue < 0.01) [flags addObject:@"transparent"];
  if (window.ignoresMouseEvents) [flags addObject:@"ignoresMouse"];
  if (window.isMiniaturized) [flags addObject:@"minimized"];
  if (window.isKeyWindow) [flags addObject:@"key"];
  if (window.isMainWindow) [flags addObject:@"main"];
  if (window.canBecomeKeyWindow) [flags addObject:@"canKey"];
  if (window.canBecomeMainWindow) [flags addObject:@"canMain"];
  if (window.parentWindow) [flags addObject:[NSString stringWithFormat:@"parent#%ld", (long)window.parentWindow.windowNumber]];
  if (window.attachedSheet) [flags addObject:@"sheet"];
  ArdiaWindowController *controller = [ArdiaWindowController forNSWindow:window];
  NSString *role = ardia_content_blocker::IsHiddenPageWindow(window) ? @" blocker-page"
                   : !controller                                     ? @""
                   : controller.standalone || controller.stray || controller.coreWindow.internal ? @" internal"
                   : controller.root                                 ? @" browser"
                                                                     : @" ardia";
  NSNumber *preventsKey = [window respondsToSelector:NSSelectorFromString(@"preventKeyWindow")] ? [window valueForKey:@"preventKeyWindow"] : nil;
  if (preventsKey.boolValue) [flags addObject:@"preventKey"];
  if (window.isVisible && !window.isOnActiveSpace) [flags addObject:@"otherSpace"];
  if (NSScreen *screen = window.screen) [flags addObject:[NSString stringWithFormat:@"screen%lu", (unsigned long)[NSScreen.screens indexOfObject:screen]]];
  return [NSString stringWithFormat:@"%@#%ld%@ level %ld [%@]", window.className, (long)window.windowNumber, role, (long)window.level,
                                    [flags componentsJoinedByString:@" "]];
}

namespace {

NSString *DescribeFocusResponder(NSResponder *responder) {
  if (!responder) return @"none";
  NSMutableArray<NSString *> *chain = [NSMutableArray array];
  for (NSResponder *r = responder; r && chain.count < 4; r = r.nextResponder) [chain addObject:r.className];
  return [chain componentsJoinedByString:@" > "];
}

constexpr NSUInteger kFocusHistoryLength = 16;

NSMutableArray<NSString *> *FocusHistory() {
  static NSMutableArray<NSString *> *history = [NSMutableArray array];
  return history;
}

}

void NoteFocusChange(NSString *what, NSWindow *window) {
  static NSDateFormatter *clock = [] {
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    formatter.dateFormat = @"HH:mm:ss.SSS";
    return formatter;
  }();
  NSMutableArray<NSString *> *history = FocusHistory();
  [history addObject:[NSString stringWithFormat:@"%@ %@ %@", [clock stringFromDate:NSDate.date], what,
                                                window ? DescribeFocusWindow(window) : @""]];
  if (history.count > kFocusHistoryLength) [history removeObjectAtIndex:0];
}

void WatchFocusChanges() {
  static bool watching = false;
  if (watching) return;
  watching = true;
  NSDictionary<NSNotificationName, NSString *> *windowChanges = @{
    NSWindowDidBecomeKeyNotification : @"became key",
    NSWindowDidResignKeyNotification : @"resigned key",
    NSWindowDidBecomeMainNotification : @"became main",
    NSWindowDidResignMainNotification : @"resigned main",
  };
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  for (NSNotificationName name in windowChanges) {
    NSString *what = windowChanges[name];
    [center addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification *note) {
      NoteFocusChange(what, [note.object isKindOfClass:NSWindow.class] ? note.object : nil);
    }];
  }
  [center addObserverForName:NSApplicationDidBecomeActiveNotification object:nil queue:nil usingBlock:^(NSNotification *) {
    NoteFocusChange(@"app active", nil);
  }];
  [center addObserverForName:NSApplicationDidResignActiveNotification object:nil queue:nil usingBlock:^(NSNotification *) {
    NoteFocusChange(@"app inactive", nil);
  }];
  WatchHover();
}

NSString *FocusState() {
  NSWindow *key = NSApp.keyWindow, *main = NSApp.mainWindow;
  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  [lines addObject:[NSString stringWithFormat:@"app %@, modal %@", NSApp.isActive ? @"active" : @"inactive",
                                              NSApp.modalWindow ? DescribeFocusWindow(NSApp.modalWindow) : @"none"]];
  [lines addObject:[NSString stringWithFormat:@"key %@, responder %@", DescribeFocusWindow(key), DescribeFocusResponder(key.firstResponder)]];
  [lines addObject:[NSString stringWithFormat:@"main %@%@", DescribeFocusWindow(main),
                                              main && main != key ? [@", responder " stringByAppendingString:DescribeFocusResponder(main.firstResponder)] : @""]];
  for (NSWindow *window in NSApp.windows) {
    if (window == key || window == main || !(window.isVisible || window.canBecomeKeyWindow)) continue;
    NSString *line = [@"window " stringByAppendingString:DescribeFocusWindow(window)];
    if ([ArdiaWindowController forNSWindow:window].root)
      line = [line stringByAppendingFormat:@", responder %@", DescribeFocusResponder(window.firstResponder)];
    [lines addObject:line];
  }
  [lines addObject:HoverProbeLine()];
  for (NSString *change in FocusHistory()) [lines addObject:[@"was " stringByAppendingString:change]];
  return [lines componentsJoinedByString:@"\n"];
}

NSString *PageMoveAt(NSWindow *window, NSPoint point) {
  Class pageClass = NSClassFromString(@"RenderWidgetHostViewCocoa");
  SEL ignores = NSSelectorFromString(@"shouldIgnoreMouseEvent:");
  NSEvent *event = [NSEvent mouseEventWithType:NSEventTypeMouseMoved location:point modifierFlags:0
                                     timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:window.windowNumber
                                       context:nil eventNumber:0 clickCount:0 pressure:0];
  NSMutableArray<NSString *> *results = [NSMutableArray array];
  NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:window.contentView.superview ?: [NSView new]];
  while (queue.count) {
    NSView *v = queue.lastObject;
    [queue removeLastObject];
    [queue addObjectsFromArray:v.subviews];
    if (!pageClass || ![v isKindOfClass:pageClass] || v.isHiddenOrHasHiddenAncestor) continue;
    if (!NSPointInRect(point, [v convertRect:v.bounds toView:nil])) continue;
    const BOOL ignored = [v respondsToSelector:ignores] && ((BOOL(*)(id, SEL, NSEvent *))objc_msgSend)(v, ignores, event);
    [v mouseMoved:event];
    [results addObject:ignored ? @"ignored" : @"accepted"];
  }
  return [results componentsJoinedByString:@","];
}

}
