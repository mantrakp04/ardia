#import "ArdiaChromeWindowHost.h"
#import "ArdiaLittleFitMath.h"

#import <CoreGraphics/CoreGraphics.h>

namespace {

using ardia_little_fit::Rect;

Rect FromNSRect(NSRect rect) { return {rect.origin.x, rect.origin.y, rect.size.width, rect.size.height}; }

NSRect ToNSRect(Rect rect) { return NSMakeRect(rect.x, rect.y, rect.w, rect.h); }

}

@implementation ArdiaChromeWindowHost (LittleFit)

+ (NSRect)littleFrameFittingVisible:(NSRect)visible size:(NSSize)size minimumSize:(NSSize)minimum {
  return ToNSRect(ardia_little_fit::Fit(FromNSRect(visible), {size.width, size.height}, {minimum.width, minimum.height}));
}

+ (NSValue *)littleFrameFittingLandingOf:(NSWindow *)window minimumSize:(NSSize)minimum {
  NSArray<NSScreen *> *screens = NSScreen.screens;
  if (window.windowNumber <= 0 || screens.count == 0) return nil;
  NSArray *list = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, (CGWindowID)window.windowNumber));
  NSDictionary *info = list.firstObject;
  if (![info[(id)kCGWindowIsOnscreen] boolValue]) return nil;
  CGRect bounds = CGRectZero;
  if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds], &bounds)) return nil;
  const Rect landed = ardia_little_fit::FlipFromTopLeft(FromNSRect(bounds), NSHeight(screens.firstObject.frame));
  std::vector<ardia_little_fit::Display> displays;
  for (NSScreen *screen in screens) displays.push_back({FromNSRect(screen.frame), FromNSRect(screen.visibleFrame)});
  Rect fitted;
  if (!ardia_little_fit::FitLanding(landed, displays, {minimum.width, minimum.height}, &fitted)) return nil;
  return [NSValue valueWithRect:ToNSRect(fitted)];
}

@end
