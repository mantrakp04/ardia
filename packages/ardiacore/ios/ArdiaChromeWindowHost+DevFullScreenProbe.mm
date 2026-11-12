#import "ArdiaChromeWindowInternal.h"

#import <QuartzCore/QuartzCore.h>

#include <cmath>

using namespace ardia_window;

namespace {

NSDictionary *ProbeFrame(NSWindow *window, ArdiaWindowFullScreen *state, CFTimeInterval start, NSSize before) {
  NSView *content = window.contentView;
  CALayer *layer = content.layer;
  if (!layer) return nil;
  const CGFloat scale = 0.125;
  const NSSize size = content.bounds.size;
  const size_t w = MAX(1, (size_t)ceil(size.width * scale)), h = MAX(1, (size_t)ceil(size.height * scale));
  NSMutableData *pixels = [NSMutableData dataWithLength:w * h * 4];
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels.mutableBytes, w, h, 8, w * 4, space,
                                               (CGBitmapInfo)kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!context) return nil;
  CGContextScaleCTM(context, scale, scale);
  if (content.isFlipped || layer.geometryFlipped) {
    CGContextTranslateCTM(context, 0, size.height);
    CGContextScaleCTM(context, 1, -1);
  }
  [layer renderInContext:context];
  CGContextRelease(context);
  NSMutableDictionary *frame = [@{
    @"t" : @(round((CACurrentMediaTime() - start) * 1000)),
    @"size" : @[ @(size.width), @(size.height) ],
    @"cover" : @(state.covered),
    @"covers" : @(state.covers),
    @"transitioning" : @(state.transitioning),
  } mutableCopy];
  if (!NSEqualSizes(before, NSZeroSize) && !NSEqualSizes(before, size)) {
    NSMutableArray<NSView *> *views = [NSMutableArray arrayWithArray:content.subviews];
    for (NSUInteger i = 0; i < views.count && i < 64; i++) {
      if (NSEqualSizes(views[i].frame.size, before)) {
        frame[@"relayout"] = @YES;
        break;
      }
      [views addObjectsFromArray:views[i].subviews];
    }
  }
  NSView *page = state.probedTab.view;
  if (!page.window || page.window != window) return frame;
  const NSRect r = [page convertRect:page.bounds toView:content];
  const CGFloat top = content.isFlipped ? NSMinY(r) : size.height - NSMaxY(r);
  frame[@"page"] = @[ @(NSMinX(r)), @(top), @(NSWidth(r)), @(NSHeight(r)) ];
  const long x0 = lround(NSMinX(r) * scale), y0 = lround(top * scale);
  const long x1 = MIN((long)w, lround(NSMaxX(r) * scale)), y1 = MIN((long)h, lround((top + NSHeight(r)) * scale));
  if (x1 - x0 < 8 || y1 - y0 < 6) return frame;
  const uint8_t *p = (const uint8_t *)pixels.bytes;
  NSMutableDictionary<NSNumber *, NSNumber *> *counts = [NSMutableDictionary dictionary];
  double sums[6][8][3] = {};
  long cells[6][8] = {}, n = 0, most = 0;
  for (long y = y0; y < y1; y++) {
    for (long x = x0; x < x1; x++) {
      const uint8_t *px = p + (y * w + x) * 4;
      NSNumber *key = @(((px[0] >> 3) << 10) | ((px[1] >> 3) << 5) | (px[2] >> 3));
      const long c = counts[key].longValue + 1;
      counts[key] = @(c);
      most = MAX(most, c);
      const long gy = (y - y0) * 6 / (y1 - y0), gx = (x - x0) * 8 / (x1 - x0);
      for (int k = 0; k < 3; k++) sums[gy][gx][k] += px[k];
      cells[gy][gx]++;
      n++;
    }
  }
  NSMutableArray *grid = [NSMutableArray array];
  for (int gy = 0; gy < 6; gy++)
    for (int gx = 0; gx < 8; gx++) {
      const long c = MAX(1, cells[gy][gx]);
      [grid addObject:[NSString stringWithFormat:@"%02x%02x%02x", (int)(sums[gy][gx][0] / c), (int)(sums[gy][gx][1] / c),
                                                 (int)(sums[gy][gx][2] / c)]];
    }
  frame[@"uniform"] = @(round((double)most / n * 1000) / 1000);
  frame[@"grid"] = grid;
  return frame;
}

}

@implementation ArdiaChromeWindowHost (DevFullScreenProbe)

+ (NSString *)devFullScreenProbe:(NSString *)argument window:(NSWindow *)window {
  static NSMutableArray *frames;
  static NSTimer *timer;
  if (!argument) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:frames ?: @[] options:0 error:nil];
    return json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]";
  }
  ArdiaCoreWindow *coreWindow = [ArdiaWindowController forNSWindow:window].coreWindow;
  ArdiaWindowFullScreen *state = coreWindow ? [ArdiaWindowFullScreen ofWindow:coreWindow create:YES] : nil;
  if (!state) return @"not an ArdiaCore window";
  [timer invalidate];
  frames = [NSMutableArray array];
  const CFTimeInterval start = CACurrentMediaTime(), until = start + MAX(0, argument.doubleValue) / 1000;
  __weak NSWindow *weakWindow = window;
  timer = [NSTimer timerWithTimeInterval:1.0 / 60
                                 repeats:YES
                                   block:^(NSTimer *t) {
                                     NSWindow *w = weakWindow;
                                     if (!w || CACurrentMediaTime() > until) return [t invalidate];
                                     NSArray *last = [frames.lastObject objectForKey:@"size"];
                                     const NSSize before = last ? NSMakeSize([last[0] doubleValue], [last[1] doubleValue]) : NSZeroSize;
                                     if (NSDictionary *frame = ProbeFrame(w, state, start, before)) [frames addObject:frame];
                                   }];
  [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
  return @"started";
}

@end
