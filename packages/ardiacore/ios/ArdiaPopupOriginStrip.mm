#import "ArdiaChromeWindowInternal.h"
#import "ArdiaRuntime.h"
#import <QuartzCore/QuartzCore.h>

using namespace ardia_window;

namespace {

NSString *HostAndPort(NSURLComponents *parts) {
  NSString *host = parts.encodedHost.lowercaseString ?: @"";
  return parts.port ? [NSString stringWithFormat:@"%@:%@", host, parts.port] : host;
}

}

namespace ardia_window {

NSString *PopupOriginText(NSString *url) {
  if (!url.length) return @"about:blank";
  NSURLComponents *parts = [NSURLComponents componentsWithString:url];
  NSString *scheme = parts.scheme.lowercaseString;
  if (!scheme.length) {
    const NSRange colon = [url rangeOfString:@":"];
    return colon.location == NSNotFound ? url : [url substringToIndex:colon.location + 1];
  }
  if ([scheme isEqualToString:@"blob"] || [scheme isEqualToString:@"filesystem"]) {
    NSURLComponents *inner = [NSURLComponents componentsWithString:parts.percentEncodedPath ?: @""];
    NSString *origin = inner.scheme.length && inner.encodedHost.length
                           ? [NSString stringWithFormat:@"%@://%@", inner.scheme.lowercaseString, HostAndPort(inner)]
                           : @"";
    return [NSString stringWithFormat:@"%@:%@", scheme, origin];
  }
  if (parts.encodedHost.length) {
    NSString *hostAndPort = HostAndPort(parts);
    return [scheme isEqualToString:@"https"] ? hostAndPort : [NSString stringWithFormat:@"%@://%@", scheme, hostAndPort];
  }
  if ([scheme isEqualToString:@"about"]) return [@"about:" stringByAppendingString:parts.path ?: @""];
  if ([scheme isEqualToString:@"file"]) return [@"file://" stringByAppendingString:parts.path ?: @""];
  return [scheme stringByAppendingString:@":"];
}

}

@implementation ArdiaPopupOriginStrip {
  NSImageView *_glyph;
  NSTextField *_origin;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if (!(self = [super initWithFrame:frame])) return nil;
  self.clipsToBounds = YES;
  _glyph = [[NSImageView alloc] initWithFrame:NSZeroRect];
  _glyph.symbolConfiguration = [NSImageSymbolConfiguration configurationWithPointSize:11 weight:NSFontWeightMedium];
  _origin = [NSTextField labelWithString:@""];
  _origin.font = [NSFont systemFontOfSize:12];
  _origin.textColor = NSColor.labelColor;
  _origin.lineBreakMode = NSLineBreakByTruncatingHead;
  [self addSubview:_glyph];
  [self addSubview:_origin];
  [self setFrameSize:frame.size];
  return self;
}

- (BOOL)isOpaque {
  return YES;
}

- (BOOL)mouseDownCanMoveWindow {
  return YES;
}

- (void)setFrameSize:(NSSize)size {
  [super setFrameSize:size];
  const CGFloat inset = 10, glyph = 16, gap = 5;
  const CGFloat text = ceil(_origin.intrinsicContentSize.height);
  _glyph.frame = NSMakeRect(inset, floor((size.height - glyph) / 2), glyph, glyph);
  const CGFloat left = inset + glyph + gap;
  _origin.frame = NSMakeRect(left, floor((size.height - text) / 2), MAX(size.width - left - inset, 0), text);
}

- (void)drawRect:(NSRect)dirtyRect {
  [NSColor.windowBackgroundColor setFill];
  NSRectFill(NSIntersectionRect(dirtyRect, self.bounds));
  [NSColor.separatorColor setFill];
  NSRectFillUsingOperation(NSMakeRect(0, 0, NSWidth(self.bounds), 1 / MAX(self.window.backingScaleFactor, 1)),
                           NSCompositingOperationSourceOver);
}

- (void)showURL:(NSString *)url security:(NSString *)level {
  _origin.stringValue = PopupOriginText(url);
  NSString *scheme = [NSURLComponents componentsWithString:url].scheme.lowercaseString;
  if (!level) level = [scheme isEqualToString:@"http"] || [scheme isEqualToString:@"ws"] ? @"insecure" : @"none";
  const bool secureScheme = [scheme isEqualToString:@"https"] || [scheme isEqualToString:@"wss"];
  NSString *symbol = @"info.circle", *description = secureScheme ? @"Connection security unknown" : @"Local or internal page";
  NSColor *tint = NSColor.secondaryLabelColor;
  if ([level isEqualToString:@"secure"]) {
    symbol = @"lock.fill";
    description = @"Connection is secure";
  } else if ([level isEqualToString:@"insecure"] || [level isEqualToString:@"mixed"] || [level isEqualToString:@"certificateError"]) {
    symbol = @"lock.open.trianglebadge.exclamationmark.fill";
    description = @"Connection is not secure";
    if ([level isEqualToString:@"certificateError"]) tint = [NSColor colorWithSRGBRed:1 green:0x5F / 255.0 blue:0x57 / 255.0 alpha:1];
  }
  _glyph.image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:description];
  _glyph.contentTintColor = tint;
}

@end

namespace ardia_window {

ArdiaPopupOriginStrip *PopupOriginStripIn(NSView *root) {
  NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:root];
  while (queue.count) {
    NSView *v = queue.lastObject;
    [queue removeLastObject];
    if ([v isKindOfClass:ArdiaPopupOriginStrip.class]) return (ArdiaPopupOriginStrip *)v;
    [queue addObjectsFromArray:v.subviews];
  }
  return nil;
}

NSString *PopupStrips() {
  NSMutableArray *out = [NSMutableArray array];
  for (NSWindow *window in NSApp.windows) {
    ArdiaPopupOriginStrip *strip = window.contentView ? PopupOriginStripIn(window.contentView) : nil;
    if (!strip || !strip.superview) continue;
    [window displayIfNeeded];
    CALayer *own = strip.layer;
    NSRect drawn = strip.bounds;
    NSMutableArray<CALayer *> *layers = [NSMutableArray arrayWithArray:own.sublayers ?: @[]];
    while (layers.count) {
      CALayer *layer = layers.lastObject;
      [layers removeLastObject];
      if (!layer.hidden) drawn = NSUnionRect(drawn, [own convertRect:layer.bounds fromLayer:layer]);
      [layers addObjectsFromArray:layer.sublayers ?: @[]];
    }
    const BOOL masked = strip.clipsToBounds || own.masksToBounds;
    const NSRect visible = masked ? strip.bounds : drawn;
    NSView *host = strip.superview;
    const NSRect stripFrame = strip.frame, visibleInHost = [strip convertRect:visible toView:host];
    NSMutableArray *covered = [NSMutableArray array];
    for (NSView *sibling in host.subviews) {
      if (sibling == strip || sibling.hidden) continue;
      const NSRect overlap = NSIntersectionRect(visibleInHost, sibling.frame);
      if (NSIsEmptyRect(overlap)) continue;
      [covered addObject:@{@"class" : NSStringFromClass(sibling.class), @"frame" : NSStringFromRect(sibling.frame),
                           @"overlap" : NSStringFromRect(overlap)}];
    }
    [out addObject:@{@"window" : @(window.windowNumber), @"strip" : NSStringFromRect(stripFrame),
                     @"clipsToBounds" : @(strip.clipsToBounds), @"masksToBounds" : @(own.masksToBounds),
                     @"drawn" : NSStringFromRect([strip convertRect:drawn toView:host]),
                     @"visible" : NSStringFromRect(visibleInHost), @"covers" : covered}];
  }
  return ardia_runtime::JSONText(out);
}

}
