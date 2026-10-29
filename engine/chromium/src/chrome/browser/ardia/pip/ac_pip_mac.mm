// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/pip/ac_pip_mac.h"

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>

#include "base/apple/foundation_util.h"
#include "base/files/file_path.h"
#include "base/path_service.h"
#include "chrome/common/chrome_paths.h"

@protocol ArdiaPictureInPictureControlsPresenter <NSObject>
- (void)presentArdiaPictureInPictureControls:
    (NSArray<NSDictionary<NSString*, id>*>*)controls;
@end

namespace {

NSURL* BoundsFile() {
  base::FilePath dir;
  if (!base::PathService::Get(chrome::DIR_USER_DATA, &dir)) {
    return nil;
  }
  return base::apple::FilePathToNSURL(
      dir.Append("ArdiaPictureInPicture.plist"));
}

NSString* const kFadeKey = @"ardiaFadeOut";

CALayer* FadeLayer(NSWindow* window) {
  return window.contentView.superview.layer ?: window.contentView.layer;
}

}

std::optional<gfx::Rect> LoadArdiaPictureInPictureBounds() {
  NSURL* file = BoundsFile();
  NSArray* values = file ? [NSArray arrayWithContentsOfURL:file] : nil;
  if (values.count != 4) {
    return std::nullopt;
  }
  for (id value in values) {
    if (![value isKindOfClass:NSNumber.class]) {
      return std::nullopt;
    }
  }
  gfx::Rect bounds([values[0] intValue], [values[1] intValue],
                   [values[2] intValue], [values[3] intValue]);
  if (bounds.IsEmpty()) {
    return std::nullopt;
  }
  return bounds;
}

void SaveArdiaPictureInPictureBounds(const gfx::Rect& bounds) {
  static gfx::Rect last;
  NSURL* file = BoundsFile();
  if (!file || bounds.IsEmpty() || bounds == last) {
    return;
  }
  last = bounds;
  [@[ @(bounds.x()), @(bounds.y()), @(bounds.width()), @(bounds.height()) ]
      writeToURL:file
           error:nil];
}

void FadeOutArdiaPictureInPicture(gfx::NativeWindow window,
                                      base::TimeDelta duration) {
  NSWindow* ns_window = window.GetNativeNSWindow();
  CALayer* layer = FadeLayer(ns_window);
  if (!layer) {
    return;
  }
  CABasicAnimation* fade = [CABasicAnimation animationWithKeyPath:@"opacity"];
  fade.fromValue = @1;
  fade.toValue = @0;
  fade.duration = duration.InSecondsF();
  fade.timingFunction =
      [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  layer.opacity = 0;
  [layer addAnimation:fade forKey:kFadeKey];
  [CATransaction commit];
  [CATransaction flush];
  ns_window.hasShadow = NO;
}

void ResetArdiaPictureInPictureFade(gfx::NativeWindow window) {
  NSWindow* ns_window = window.GetNativeNSWindow();
  CALayer* layer = FadeLayer(ns_window);
  if (!layer || layer.opacity == 1) {
    return;
  }
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [layer removeAnimationForKey:kFadeKey];
  layer.opacity = 1;
  [CATransaction commit];
  ns_window.hasShadow = YES;
}

bool PresentArdiaPictureInPictureControls(
    gfx::NativeWindow window,
    const std::vector<ArdiaPipNativeControl>& controls) {
  SEL present = @selector(presentArdiaPictureInPictureControls:);
  id<ArdiaPictureInPictureControlsPresenter> presenter =
      objc_getAssociatedObject(window.GetNativeNSWindow(), present);
  if (![presenter respondsToSelector:present]) {
    return false;
  }
  NSMutableArray* list = [NSMutableArray arrayWithCapacity:controls.size()];
  for (const ArdiaPipNativeControl& control : controls) {
    const gfx::Rect& b = control.bounds;
    [list addObject:@{
      @"name" : @(control.name),
      @"frame" : [NSValue
          valueWithRect:NSMakeRect(b.x(), b.y(), b.width(), b.height())],
      @"hovered" : @(control.hovered),
      @"pressed" : @(control.pressed),
      @"opacity" : @(control.opacity),
    }];
  }
  [presenter presentArdiaPictureInPictureControls:list];
  return true;
}
