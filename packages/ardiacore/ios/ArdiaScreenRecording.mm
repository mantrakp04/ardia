#import "ArdiaHostInternal.h"
#import "ArdiaEvents.h"
#import "ArdiaLaunchConfig.h"

#import <CoreGraphics/CoreGraphics.h>
#import <objc/runtime.h>

@interface NSWindow (ChromeOcclusion)
- (BOOL)isOccluded;
- (void)setOccluded:(BOOL)occluded;
@end

namespace {

const void *kCoveredPerChromeKey = &kCoveredPerChromeKey;
const NSTimeInterval kRecordingCheckInterval = 3;

void (*gChromeSetOccluded)(id, SEL, BOOL);
bool gScreenRecorded = false;
NSTimer *gRecordingCheck;

bool ScreenIsRecorded() {
  NSArray<NSDictionary *> *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID));
  const int indicatorLevel = CGWindowLevelForKey(kCGCursorWindowLevelKey);
  NSInteger unnamed = 0;
  for (NSDictionary *w in windows) {
    if ([w[(id)kCGWindowLayer] intValue] != indicatorLevel || ![w[(id)kCGWindowOwnerName] isEqual:@"Window Server"]) continue;
    NSString *name = w[(id)kCGWindowName];
    if ([name isEqualToString:@"StatusIndicator"]) return true;
    if (!name) unnamed++;
  }
  return unnamed > 1;
}

bool CoveredPerChrome(NSWindow *window) {
  return [objc_getAssociatedObject(window, kCoveredPerChromeKey) boolValue];
}

void NoteKeptDrawing() {
  if ([ArdiaEvents listens:@"media"]) [ArdiaEvents emit:@"media.coveredWhileRecorded" data:@{}];
}

void ApplyOcclusion(NSWindow *window) {
  gChromeSetOccluded(window, @selector(setOccluded:), CoveredPerChrome(window) && !gScreenRecorded);
}

void StopRecordingChecksUnlessNeeded();

void CheckRecording() {
  const bool recorded = ScreenIsRecorded();
  if (recorded != gScreenRecorded) {
    gScreenRecorded = recorded;
    if ([ArdiaLaunchConfig.shared traced:@"visibility"]) NSLog(@"[ardiacore-vis] screen recording %d", recorded);
    for (NSWindow *window in NSApp.windows) {
      if (!CoveredPerChrome(window)) continue;
      if (recorded) NoteKeptDrawing();
      ApplyOcclusion(window);
    }
  }
  StopRecordingChecksUnlessNeeded();
}

void StartRecordingChecks() {
  if (gRecordingCheck) return;
  gRecordingCheck = [NSTimer scheduledTimerWithTimeInterval:kRecordingCheckInterval repeats:YES block:^(NSTimer *) { CheckRecording(); }];
  gRecordingCheck.tolerance = kRecordingCheckInterval / 2;
}

void StopRecordingChecksUnlessNeeded() {
  if (gScreenRecorded) return;
  for (NSWindow *window in NSApp.windows)
    if (CoveredPerChrome(window)) return;
  [gRecordingCheck invalidate];
  gRecordingCheck = nil;
}

}

namespace ardia_host {

void KeepRecordedWindowsDrawing() {
  Method method = class_getInstanceMethod(NSWindow.class, @selector(setOccluded:));
  if (!method || ![NSWindow instancesRespondToSelector:@selector(isOccluded)]) return;
  gChromeSetOccluded = (void (*)(id, SEL, BOOL))method_getImplementation(method);
  method_setImplementation(method, imp_implementationWithBlock(^(NSWindow *window, BOOL covered) {
    if (covered != CoveredPerChrome(window)) {
      objc_setAssociatedObject(window, kCoveredPerChromeKey, covered ? @YES : nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
      if (covered && !gRecordingCheck) {
        gScreenRecorded = ScreenIsRecorded();
        StartRecordingChecks();
      }
      if (covered && gScreenRecorded) NoteKeptDrawing();
    }
    ApplyOcclusion(window);
  }));
}

}
