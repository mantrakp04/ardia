#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaChromeWindowHost.h"

#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>

using namespace ardia_pip;

@implementation ArdiaPiPHandle {
  NSImageView *_chevron;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if ((self = [super initWithFrame:frame])) {
    self.wantsLayer = YES;
    _chevron = [[NSImageView alloc] init];
    _chevron.contentTintColor = [NSColor colorWithWhite:1 alpha:0.95];
    _chevron.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:15 weight:NSFontWeightSemibold];
    [self addSubview:_chevron];
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
  self.layer.backgroundColor = [NSColor colorWithWhite:0 alpha:hovered ? 0.7 : 0.5].CGColor;
}

- (void)layout {
  [super layout];
  NSSize size = NSMakeSize(16, 28);
  _chevron.frame = NSMakeRect(floor((NSWidth(self.bounds) - size.width) / 2), floor((NSHeight(self.bounds) - size.height) / 2),
                              size.width, size.height);
}

@end
