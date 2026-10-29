#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaChromeWindowHost.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

using namespace ardia_pip;

namespace {

constexpr CGFloat kRestTint = 0x17 / 255.0 * kGlassControlTintShare, kLitTint = 0.2, kPressedTint = 0.3;
constexpr CGFloat kRimRest = 0.2, kRimLit = 0.3;

CGPathRef GlyphPath(NSString *name) {
  CGMutablePathRef path = CGPathCreateMutable();
  const CGAffineTransform fromTop = CGAffineTransformMake(1, 0, 0, -1, 0, kButtonSize);
  auto line = [&](CGFloat x0, CGFloat y0, CGFloat x1, CGFloat y1) {
    CGPathMoveToPoint(path, &fromTop, x0, y0);
    CGPathAddLineToPoint(path, &fromTop, x1, y1);
  };
  if ([name isEqual:@"close"]) {
    line(9.85, 9.85, 18.65, 18.65);
    line(18.65, 9.85, 9.85, 18.65);
  } else {
    line(10.5, 11, 18.3, 11);
    line(11, 10.5, 11, 18.3);
    line(11, 11, 18.3, 18.3);
  }
  return path;
}

API_AVAILABLE(macos(26.0)) NSGlassEffectView *GlyphPlate(NSString *name) {
  NSGlassEffectView *plate = NewGlass(YES);
  CAShapeLayer *glyph = [CAShapeLayer layer];
  glyph.strokeColor = NSColor.whiteColor.CGColor;
  glyph.fillColor = nil;
  glyph.lineWidth = 1;
  CGPathRef path = GlyphPath(name);
  glyph.path = path;
  CGPathRelease(path);
  [plate.contentView.layer addSublayer:glyph];
  return plate;
}

}

namespace ardia_pip {

NSGlassEffectView *NewGlass(BOOL clear) {
  NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect];
  glass.style = clear ? NSGlassEffectViewStyleClear : NSGlassEffectViewStyleRegular;
  glass.cornerRadius = kCornerRadius;
  glass.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  NSView *content = [[NSView alloc] initWithFrame:NSZeroRect];
  content.wantsLayer = YES;
  content.layer.cornerRadius = kCornerRadius;
  content.layer.cornerCurve = kCACornerCurveContinuous;
  glass.contentView = content;
  return glass;
}

void PlaceGlass(NSGlassEffectView *glass, NSRect frame) {
  glass.frame = frame;
  glass.contentView.frame = glass.bounds;
  for (CALayer *layer in glass.contentView.layer.sublayers) {
    layer.frame = glass.bounds;
    layer.contentsScale = glass.window.backingScaleFactor ?: 2;
  }
}

void LightGlass(NSGlassEffectView *glass, NSColor *tint, BOOL lit) {
  glass.tintColor = tint;
  CALayer *rim = glass.contentView.layer;
  rim.borderWidth = 1 / (glass.window.backingScaleFactor ?: 2);
  rim.borderColor = [NSColor colorWithWhite:1 alpha:lit ? kRimLit : kRimRest].CGColor;
}

}

@implementation ArdiaPiPOverlay {
  NSMutableDictionary<NSString *, NSView *> *_plates;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    self.layer.zPosition = 100;
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    _plates = [NSMutableDictionary dictionary];
    _handle = [[ArdiaPiPHandle alloc] initWithFrame:NSZeroRect];
    _handle.hidden = YES;
    _handle.alphaValue = 0;
    [self addSubview:_handle];
  }
  return self;
}

- (BOOL)isFlipped { return YES; }

- (NSView *)hitTest:(NSPoint)point {
  NSPoint local = [self convertPoint:point fromView:self.superview];
  if (!_handle.hidden && NSPointInRect(local, _handle.frame)) return _handle;
  return nil;
}

- (void)presentArdiaPictureInPictureControls:(NSArray<NSDictionary<NSString *, id> *> *)controls {
  if (@available(macOS 26.0, *)) {
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    for (NSDictionary<NSString *, id> *control in controls) {
      NSString *name = control[@"name"];
      NSGlassEffectView *plate = (NSGlassEffectView *)_plates[name];
      if (!plate) {
        plate = GlyphPlate(name);
        _plates[name] = plate;
        [self addSubview:plate positioned:NSWindowBelow relativeTo:_handle];
      }
      const BOOL hovered = [control[@"hovered"] boolValue], pressed = [control[@"pressed"] boolValue];
      const CGFloat opacity = [control[@"opacity"] doubleValue];
      PlaceGlass(plate, [control[@"frame"] rectValue]);
      LightGlass(plate, [NSColor colorWithWhite:1 alpha:pressed ? kPressedTint : hovered ? kLitTint : kRestTint], hovered || pressed);
      plate.alphaValue = opacity;
      plate.hidden = opacity <= 0;
    }
    [CATransaction commit];
  }
}

- (NSArray<NSDictionary<NSString *, id> *> *)devControls {
  NSMutableArray *list = [NSMutableArray array];
  if (@available(macOS 26.0, *)) {
    for (NSString *name in _plates) {
      NSGlassEffectView *plate = (NSGlassEffectView *)_plates[name];
      CALayer *rim = plate.contentView.layer;
      [list addObject:@{
        @"name" : name,
        @"frame" : NSStringFromRect(plate.frame),
        @"alpha" : @(plate.alphaValue),
        @"hidden" : @(plate.hidden),
        @"tint" : @(plate.tintColor.alphaComponent),
        @"rim" : @(CGColorGetAlpha(rim.borderColor)),
        @"rimWidth" : @(rim.borderWidth),
      }];
    }
  }
  return list;
}

- (void)layout {
  [super layout];
  NSSize size = self.bounds.size;
  _handle.frame = _handle.edge == ArdiaPiPEdgeLeft ? NSMakeRect(size.width - kPeek, 0, kPeek, size.height)
                                                 : NSMakeRect(0, 0, kPeek, size.height);
}

@end
