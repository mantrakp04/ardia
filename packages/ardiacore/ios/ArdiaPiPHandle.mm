#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaChromeWindowHost.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

using namespace ardia_pip;

namespace {

constexpr CGFloat kRestFill = 0.5, kLitFill = 0.7;

}

@implementation ArdiaPiPHandle {
  NSImageView *_chevron;
  NSView *_glass;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    _chevron = [[NSImageView alloc] init];
    _chevron.contentTintColor = [NSColor colorWithWhite:1 alpha:0.95];
    _chevron.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:15 weight:NSFontWeightSemibold];
    [self addSubview:_chevron];
    if (@available(macOS 26.0, *)) {
      _glass = NewGlass(NO);
      [self addSubview:_glass positioned:NSWindowBelow relativeTo:_chevron];
    }
    self.toolTip = @"Show Picture in Picture";
    [self setHovered:NO];
  }
  return self;
}

- (void)setEdge:(ArdiaPiPEdge)edge {
  _edge = edge;
  NSString *name = edge == ArdiaPiPEdgeLeft ? @"chevron.compact.right" : @"chevron.compact.left";
  _chevron.image = [NSImage imageWithSystemSymbolName:name accessibilityDescription:@"Show Picture in Picture"];
  self.needsLayout = YES;
}

- (void)setHovered:(BOOL)hovered {
  [super setHovered:hovered];
  const CGFloat fill = hovered ? kLitFill : kRestFill;
  if (@available(macOS 26.0, *)) {
    if (_glass) return LightGlass((NSGlassEffectView *)_glass, [NSColor colorWithWhite:0 alpha:fill * kGlassPanelTintShare], hovered);
  }
  self.layer.backgroundColor = [NSColor colorWithWhite:0 alpha:fill].CGColor;
}

- (void)layout {
  [super layout];
  if (@available(macOS 26.0, *)) {
    if (_glass) {
      NSRect frame = NSMakeRect(_edge == ArdiaPiPEdgeLeft ? -kCornerRadius : 0, 0, NSWidth(self.bounds) + kCornerRadius, NSHeight(self.bounds));
      PlaceGlass((NSGlassEffectView *)_glass, frame);
      self.hovered = self.hovered;
    }
  }
  NSSize size = NSMakeSize(16, 28);
  _chevron.frame = NSMakeRect(floor((NSWidth(self.bounds) - size.width) / 2), floor((NSHeight(self.bounds) - size.height) / 2),
                              size.width, size.height);
}

@end
