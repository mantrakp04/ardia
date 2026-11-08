#import "../ios/ArdiaWindowSight.h"

#include <cstdio>
#include <cstdlib>

using namespace ardia_window;

static int failures = 0;

static void Check(bool passed, const char *name) {
  if (passed) return;
  std::fprintf(stderr, "FAIL %s\n", name);
  failures++;
}

static void DrainMainQueue() {
  __block bool drained = false;
  dispatch_async(dispatch_get_main_queue(), ^{ drained = true; });
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:1];
  while (!drained && deadline.timeIntervalSinceNow > 0)
    [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:deadline];
  Check(drained, "attention notifications drain without waiting for another event");
}

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication].activationPolicy = NSApplicationActivationPolicyProhibited;
    WindowSight source{.visible = true, .applicationActive = true, .mainWindow = true, .keyWindow = true};
    Check(WindowSeen(source), "the playing source starts in front");
    source.applicationActive = false;
    Check(!WindowSeen(source), "switching apps leaves a partially visible source");
    source.applicationActive = true;
    Check(WindowSeen(source), "returning to the source marks it seen again");
    source.mainWindow = source.keyWindow = false;
    Check(!WindowSeen(source), "another browser window leaves the source even without occlusion");
    source.mainWindow = true;
    Check(WindowSeen(source), "an app panel can be key while the source remains main");
    source.mainWindow = false;
    source.keyWindow = true;
    Check(WindowSeen(source), "a source made key before main stays in front");
    source.visible = false;
    Check(!WindowSeen(source), "an occluded hidden or minimized source is left");
    source.settling = true;
    Check(WindowSeen(source), "a foreground fullscreen transition ignores transient occlusion");
    source.transitioning = true;
    source.keyWindow = false;
    Check(WindowSeen(source), "a native fullscreen transition can temporarily have no main or key window");
    source.transitioning = false;
    Check(!WindowSeen(source), "settling after a transition cannot retain focus given to another window");
    source.keyWindow = true;
    source.transitioning = true;
    source.applicationActive = false;
    Check(!WindowSeen(source), "a fullscreen transition does not hide an app switch");
    source.transitioning = false;
    source.settling = false;
    Check(!WindowSeen(source), "an inline video in a fullscreen window follows an app or Space switch");
    source.pageFullScreen = true;
    Check(WindowSeen(source), "page fullscreen retains its seen guard while the app is inactive");
    source.pageFullScreen = false;
    Check(!WindowSeen(source), "leaving page fullscreen recomputes visibility");
    source.visible = source.ignoresFocus = true;
    Check(WindowSeen(source), "default hidden harness retains acted visibility");
    source.visible = false;
    Check(!WindowSeen(source), "default hidden harness still follows acted occlusion");
    source.visible = true;
    source.ignoresFocus = false;
    Check(!WindowSeen(source), "focused harness opts into fake application activity");

    NSObject *sourceObject = [NSObject new];
    NSObject *otherObject = [NSObject new];
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    __block WindowSight observed{.visible = true, .applicationActive = true, .mainWindow = true, .keyWindow = true};
    __block int callbacks = 0;
    __block int left = 0;
    NSArray *tokens = ObserveWindowAttention((NSWindow *)sourceObject, ^{
      callbacks++;
      if (!WindowSeen(observed)) left++;
    });
    [center postNotificationName:NSWindowDidResignMainNotification object:otherObject];
    [center postNotificationName:NSApplicationDidResignActiveNotification object:otherObject];
    DrainMainQueue();
    Check(callbacks == 0, "unrelated windows and application objects cannot update this source's attention");
    observed.applicationActive = false;
    [center postNotificationName:NSApplicationDidResignActiveNotification object:NSApp];
    Check(callbacks == 0, "AppKit finishes the focus change before visibility is evaluated");
    DrainMainQueue();
    Check(callbacks == 1 && left == 1, "app deactivation reaches the policy while the source is visible");
    observed.applicationActive = true;
    [center postNotificationName:NSApplicationDidBecomeActiveNotification object:NSApp];
    DrainMainQueue();
    Check(callbacks == 2 && left == 1, "app activation returns to the source");
    observed.mainWindow = observed.keyWindow = false;
    [center postNotificationName:NSWindowDidResignMainNotification object:sourceObject];
    [center postNotificationName:NSWindowDidResignKeyNotification object:sourceObject];
    observed.mainWindow = observed.keyWindow = true;
    [center postNotificationName:NSWindowDidBecomeMainNotification object:sourceObject];
    [center postNotificationName:NSWindowDidBecomeKeyNotification object:sourceObject];
    DrainMainQueue();
    Check(callbacks == 6 && left == 1, "an intermediate focus handoff does not report the source left");
    for (id token in tokens) [center removeObserver:token];
    [center postNotificationName:NSApplicationDidResignActiveNotification object:NSApp];
    [center postNotificationName:NSWindowDidResignMainNotification object:sourceObject];
    DrainMainQueue();
    Check(callbacks == 6, "detached attention observers stop delivering changes");
  }
  std::printf("window sight: %s\n", failures ? "FAIL" : "PASS");
  return failures ? EXIT_FAILURE : EXIT_SUCCESS;
}
