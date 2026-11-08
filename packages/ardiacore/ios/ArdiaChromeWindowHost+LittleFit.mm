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
  std::vector<Rect> frames;
  for (NSScreen *screen in screens) frames.push_back(FromNSRect(screen.frame));
  const int held = ardia_little_fit::ScreenHolding(landed, frames);
  if (held < 0) return nil;
  const Rect visible = FromNSRect(screens[held].visibleFrame);
  if (ardia_little_fit::Contains(visible, landed)) return nil;
  return [NSValue valueWithRect:[self littleFrameFittingVisible:screens[held].visibleFrame
                                                           size:NSMakeSize(landed.w, landed.h)
                                                    minimumSize:minimum]];
}

@end
