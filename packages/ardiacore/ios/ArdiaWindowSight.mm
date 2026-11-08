#import "ArdiaWindowSight.h"

namespace ardia_window {

bool WindowSeen(const WindowSight &state) {
  if (state.pageFullScreen) return true;
  const bool foreground = state.ignoresFocus || (state.applicationActive && (state.mainWindow || state.keyWindow || state.transitioning));
  return foreground && (state.settling || state.visible);
}

NSArray *ObserveWindowAttention(NSWindow *window, dispatch_block_t changed) {
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  NSMutableArray *observers = [NSMutableArray array];
  void (^handler)(NSNotification *) = ^(NSNotification *) {
    dispatch_async(dispatch_get_main_queue(), changed);
  };
  for (NSNotificationName name in @[
         NSWindowDidBecomeMainNotification, NSWindowDidResignMainNotification,
         NSWindowDidBecomeKeyNotification, NSWindowDidResignKeyNotification
       ]) [observers addObject:[center addObserverForName:name object:window queue:nil usingBlock:handler]];
  for (NSNotificationName name in @[ NSApplicationDidBecomeActiveNotification, NSApplicationDidResignActiveNotification ])
    [observers addObject:[center addObserverForName:name object:NSApp queue:nil usingBlock:handler]];
  return observers;
}

}
