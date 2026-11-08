#import "ArdiaDisplayIdentity.h"

#import <ApplicationServices/ApplicationServices.h>

#include <vector>

#include "ArdiaDisplayPlacementMath.h"

static ardia_display::Rect RectOf(NSRect rect) {
  return {rect.origin.x, rect.origin.y, rect.size.width, rect.size.height};
}

@implementation ArdiaDisplayIdentity

+ (NSString *)identifierOfScreen:(NSScreen *)screen {
  NSNumber *number = screen.deviceDescription[@"NSScreenNumber"];
  if (![number isKindOfClass:NSNumber.class]) return nil;
  CFUUIDRef uuid = CGDisplayCreateUUIDFromDisplayID(number.unsignedIntValue);
  if (!uuid) return nil;
  NSString *identifier = CFBridgingRelease(CFUUIDCreateString(kCFAllocatorDefault, uuid));
  CFRelease(uuid);
  return identifier;
}

+ (NSScreen *)screenWithIdentifier:(NSString *)identifier {
  if (!identifier.length) return nil;
  for (NSScreen *screen in NSScreen.screens) {
    NSString *each = [self identifierOfScreen:screen];
    if (each && [each caseInsensitiveCompare:identifier] == NSOrderedSame) return screen;
  }
  return nil;
}

+ (NSRect)frame:(NSRect)frame onScreen:(NSScreen *)screen {
  NSArray<NSScreen *> *screens = NSScreen.screens;
  const NSUInteger target = [screens indexOfObject:screen];
  if (target == NSNotFound) return frame;
  std::vector<ardia_display::Rect> frames;
  for (NSScreen *each in screens) frames.push_back(RectOf(each.frame));
  const ardia_display::Rect fitted = ardia_display::OnScreen(RectOf(frame), frames.data(), frames.size(), target, RectOf(screen.visibleFrame));
  return NSMakeRect(fitted.x, fitted.y, fitted.w, fitted.h);
}

@end
