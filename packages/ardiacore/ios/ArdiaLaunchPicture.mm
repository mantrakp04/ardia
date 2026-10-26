#import "ArdiaEarlyWindowInternal.h"
#import "ArdiaChromeWindowHost.h"
#import "ArdiaEngineBridge.h"
#import "ArdiaTabParking.h"
#import "ArdiaWebViewInternal.h"

#import <ImageIO/ImageIO.h>
#import <objc/message.h>
#import <CommonCrypto/CommonDigest.h>
#import <QuartzCore/QuartzCore.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <cmath>
#include <initializer_list>
#include <mach/mach.h>

using namespace ardia_early_window;

namespace {

constexpr CGFloat kGlassVeilDark = 0.128;

constexpr CGFloat kGlassVeilLight = 0.3;

NSString *PictureName(NSString *windowId) {
  NSMutableString *safe = [NSMutableString string];
  for (NSUInteger i = 0; i < windowId.length && i < 80; i++) {
    const unichar c = [windowId characterAtIndex:i];
    [safe appendString:(isalnum(c) || c == '-' || c == '_') ? [NSString stringWithCharacters:&c length:1] : @"_"];
  }
  return [NSString stringWithFormat:@"launch-picture-%@.png", safe];
}

NSData *EncodePNG(CGImageRef image) {
  NSMutableData *png = [NSMutableData data];
  CGImageDestinationRef dest = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)png, (__bridge CFStringRef)UTTypePNG.identifier, 1, nullptr);
  if (!dest) return nil;
  CGImageDestinationAddImage(dest, image, nullptr);
  const bool ok = CGImageDestinationFinalize(dest);
  CFRelease(dest);
  return ok ? png : nil;
}

}

namespace ardia_early_window {

NSString *PicturePath(NSString *windowId) {
  return [gDirectory stringByAppendingPathComponent:PictureName(windowId)];
}

}

namespace {

NSView *DrawnContent(NSView *root) {
  NSMutableArray<NSView *> *pending = [NSMutableArray arrayWithObject:root];
  for (NSUInteger i = 0; i < pending.count && i < 64; i++) {
    NSView *view = pending[i];
    if (![NSStringFromClass(view.class) hasPrefix:@"RCT"]) {
      [pending addObjectsFromArray:view.subviews];
      continue;
    }
    for (NSView *child in view.subviews)
      if (child.layer && NSEqualRects([child convertRect:child.bounds toView:root], root.bounds)) return child;
    return root;
  }
  return root;
}

Class GlassClass() {
  static Class glass = NSClassFromString(@"NSGlassEffectView");
  return glass;
}

id GlassValue(NSView *glass, NSString *key) {
  return [glass respondsToSelector:NSSelectorFromString(key)] ? [glass valueForKey:key] : nil;
}

NSColor *GlassStandInColor(NSView *glass) {
  NSString *appearance = [glass.effectiveAppearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameDarkAqua, NSAppearanceNameAqua ]];
  const BOOL clear = [GlassValue(glass, @"style") integerValue] != 0;
  const CGFloat veil = clear ? 0 : [appearance isEqualToString:NSAppearanceNameDarkAqua] ? kGlassVeilDark : kGlassVeilLight;
  id tintValue = GlassValue(glass, @"tintColor");
  NSColor *tint = [tintValue isKindOfClass:NSColor.class] ? [tintValue colorUsingColorSpace:NSColorSpace.sRGBColorSpace] : nil;
  const CGFloat tintAlpha = tint ? tint.alphaComponent : 0;
  const CGFloat alpha = 1 - (1 - veil) * (1 - tintAlpha);
  if (alpha <= 0) return NSColor.clearColor;
  auto channel = [&](CGFloat c) { return (veil * (1 - tintAlpha) + c * tintAlpha) / alpha; };
  return [NSColor colorWithSRGBRed:channel(tint.redComponent) green:channel(tint.greenComponent) blue:channel(tint.blueComponent) alpha:alpha];
}

CALayer *GlassStandIn(NSView *glass) {
  CALayer *glassLayer = glass.layer;
  if (!glassLayer.superlayer) return nil;
  CALayer *standIn = [CALayer layer];
  standIn.frame = glassLayer.frame;
  const CGFloat radius = [GlassValue(glass, @"cornerRadius") doubleValue];
  standIn.cornerRadius = std::isfinite(radius) && radius > 0 ? MIN(radius, MIN(NSWidth(standIn.bounds), NSHeight(standIn.bounds)) / 2) : 0;
  standIn.cornerCurve = kCACornerCurveContinuous;
  standIn.backgroundColor = GlassStandInColor(glass).CGColor;
  [glassLayer.superlayer insertSublayer:standIn above:glassLayer];
  return standIn;
}

CGFloat ShownAlpha(NSView *view, NSView *root) {
  CGFloat alpha = 1;
  for (NSView *v = view; v && v != root.superview; v = v.superview) alpha *= v.alphaValue;
  return alpha;
}

NSDictionary *GlassRecord(NSView *glass, NSView *root, NSView *host) {
  const CGFloat alpha = ShownAlpha(glass, root);
  if (glass.isHiddenOrHasHiddenAncestor || alpha < 0.01 || !NSEqualRects(glass.visibleRect, glass.bounds)) return nil;
  const NSRect rect = [glass convertRect:glass.bounds toView:host];
  if (!NSContainsRect(host.bounds, rect)) return nil;
  NSString *appearance = [glass.effectiveAppearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameDarkAqua, NSAppearanceNameAqua ]];
  NSMutableDictionary *record = [@{
    @"frame" : @[ @(NSMinX(rect)), @(NSMinY(rect)), @(NSWidth(rect)), @(NSHeight(rect)) ],
    @"radius" : @([GlassValue(glass, @"cornerRadius") doubleValue]),
    @"style" : @([GlassValue(glass, @"style") integerValue]),
    @"alpha" : @(alpha),
    @"appearance" : appearance ?: NSAppearanceNameAqua,
  } mutableCopy];
  id tintValue = GlassValue(glass, @"tintColor");
  if (NSColor *tint = [tintValue isKindOfClass:NSColor.class] ? [tintValue colorUsingColorSpace:NSColorSpace.sRGBColorSpace] : nil)
    record[@"tint"] = @[ @(tint.redComponent), @(tint.greenComponent), @(tint.blueComponent), @(tint.alphaComponent) ];
  return record;
}

BOOL ReadNumbers(id list, NSUInteger count, CGFloat *out) {
  if (![list isKindOfClass:NSArray.class] || [list count] != count) return NO;
  for (NSUInteger i = 0; i < count; i++) {
    if (![list[i] isKindOfClass:NSNumber.class] || !std::isfinite([list[i] doubleValue])) return NO;
    out[i] = [list[i] doubleValue];
  }
  return YES;
}

void SetGlassValue(NSView *glass, NSString *key, id value) {
  NSString *setter = [NSString stringWithFormat:@"set%@%@:", [key substringToIndex:1].uppercaseString, [key substringFromIndex:1]];
  if (value && [glass respondsToSelector:NSSelectorFromString(setter)]) [glass setValue:value forKey:key];
}

}

namespace ardia_early_window {

BOOL AddLiveGlass(NSArray *records, NSView *host, NSView *parent) {
  Class glassClass = GlassClass();
  if (!glassClass || ![records isKindOfClass:NSArray.class] || !records.count || !parent) return NO;
  NSView *layer = [[NSView alloc] initWithFrame:parent.bounds];
  layer.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [parent addSubview:layer];
  for (NSDictionary *record in records) {
    CGFloat frame[4], tint[4];
    if (![record isKindOfClass:NSDictionary.class] || !ReadNumbers(record[@"frame"], 4, frame)) {
      [layer removeFromSuperview];
      return NO;
    }
    NSView *glass = [[glassClass alloc] initWithFrame:[layer convertRect:NSMakeRect(frame[0], frame[1], frame[2], frame[3]) fromView:host]];
    SetGlassValue(glass, @"cornerRadius", [record[@"radius"] isKindOfClass:NSNumber.class] ? record[@"radius"] : nil);
    SetGlassValue(glass, @"style", [record[@"style"] isKindOfClass:NSNumber.class] ? record[@"style"] : nil);
    if (ReadNumbers(record[@"tint"], 4, tint)) SetGlassValue(glass, @"tintColor", [NSColor colorWithSRGBRed:tint[0] green:tint[1] blue:tint[2] alpha:tint[3]]);
    if ([record[@"appearance"] isKindOfClass:NSString.class]) glass.appearance = [NSAppearance appearanceNamed:record[@"appearance"]];
    if ([record[@"alpha"] isKindOfClass:NSNumber.class]) glass.alphaValue = MIN(MAX([record[@"alpha"] doubleValue], 0), 1);
    [layer addSubview:glass];
  }
  return YES;
}

}

namespace {

CGContextRef MakeBitmap(size_t w, size_t h) {
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(nullptr, w, h, 8, 0, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  return context;
}

BOOL CastsPathShadowOnly(CALayer *layer) {
  return layer.shadowPath && layer.shadowOpacity > 0 && layer.shadowColor && !layer.masksToBounds && !layer.backgroundColor && !layer.contents;
}

CGRect StandInExtent(CALayer *layer) {
  CALayer *mask = layer.mask;
  CGRect extent = layer.bounds;
  if (layer.shadowOpacity > 0 && layer.shadowColor && !layer.masksToBounds) {
    const CGFloat spread = 2 * layer.shadowRadius + MAX(fabs(layer.shadowOffset.width), fabs(layer.shadowOffset.height)) + 1;
    const CGRect caster = layer.shadowPath ? CGPathGetBoundingBox(layer.shadowPath) : layer.bounds;
    extent = CGRectUnion(extent, CGRectInset(caster, -spread, -spread));
  }
  if (mask) {
    CGRect shown = mask.frame;
    if ([mask isKindOfClass:CAShapeLayer.class] && ((CAShapeLayer *)mask).path)
      shown = CGRectUnion(shown, [mask convertRect:CGPathGetBoundingBox(((CAShapeLayer *)mask).path) toLayer:layer]);
    extent = CGRectIntersection(extent, shown);
  }
  return CGRectIntegral(extent);
}

void DrawPathShadow(CGContextRef context, CALayer *layer, CGFloat scale) {
  CGPathRef path = layer.shadowPath;
  const CGRect box = CGPathGetBoundingBox(path);
  const CGFloat far = box.size.width + 4 * layer.shadowRadius + fabs(layer.shadowOffset.width) + 64;
  const CGSize shift = CGSizeApplyAffineTransform(CGSizeMake(far, 0), CGContextGetCTM(context));
  const CGSize offset = CGSizeApplyAffineTransform(layer.shadowOffset, CGContextGetCTM(context));
  CGColorRef color = CGColorCreateCopyWithAlpha(layer.shadowColor, CGColorGetAlpha(layer.shadowColor) * layer.shadowOpacity);
  CGContextSaveGState(context);
  CGContextSetShadowWithColor(context, CGSizeMake(offset.width - shift.width, offset.height - shift.height), 2 * layer.shadowRadius * scale, color);
  CGContextTranslateCTM(context, far, 0);
  CGContextAddPath(context, path);
  CGContextSetFillColorWithColor(context, CGColorGetConstantColor(kCGColorBlack));
  CGContextFillPath(context);
  CGContextRestoreGState(context);
  CGColorRelease(color);
}

CALayer *StandIn(CALayer *layer, CGFloat scale) {
  CALayer *mask = layer.mask;
  if (layer.hidden || !layer.superlayer) return nil;
  const CGRect extent = StandInExtent(layer);
  const size_t w = (size_t)ceil(extent.size.width * scale), h = (size_t)ceil(extent.size.height * scale);
  if (w < 1 || h < 1 || w > 8192 || h > 8192) return nil;
  CGContextRef content = MakeBitmap(w, h), shape = mask ? MakeBitmap(w, h) : nullptr;
  if (!content || (mask && !shape)) {
    if (content) CGContextRelease(content);
    if (shape) CGContextRelease(shape);
    return nil;
  }
  for (CGContextRef each : {content, shape}) {
    if (!each) continue;
    CGContextScaleCTM(each, scale, scale);
    if (layer.contentsAreFlipped) {
      CGContextTranslateCTM(each, 0, extent.size.height);
      CGContextScaleCTM(each, 1, -1);
    }
    CGContextTranslateCTM(each, -extent.origin.x, -extent.origin.y);
  }
  if (CastsPathShadowOnly(layer)) DrawPathShadow(content, layer, scale);
  layer.mask = nil;
  [layer renderInContext:content];
  layer.mask = mask;
  if (shape) {
    CGContextTranslateCTM(shape, mask.frame.origin.x - mask.bounds.origin.x, mask.frame.origin.y - mask.bounds.origin.y);
    [mask renderInContext:shape];
    CGImageRef shapeImage = CGBitmapContextCreateImage(shape);
    CGContextRelease(shape);
    CGContextSaveGState(content);
    CGContextConcatCTM(content, CGAffineTransformInvert(CGContextGetCTM(content)));
    CGContextSetBlendMode(content, kCGBlendModeDestinationIn);
    if (shapeImage) CGContextDrawImage(content, CGRectMake(0, 0, w, h), shapeImage);
    CGContextRestoreGState(content);
    CGImageRelease(shapeImage);
  }
  CGImageRef composed = CGBitmapContextCreateImage(content);
  CGContextRelease(content);
  if (!composed) return nil;
  CALayer *standIn = [CALayer layer];
  standIn.anchorPoint = layer.anchorPoint;
  standIn.bounds = layer.bounds;
  standIn.position = layer.position;
  standIn.transform = layer.transform;
  standIn.geometryFlipped = layer.geometryFlipped;
  CALayer *drawing = [CALayer layer];
  drawing.frame = extent;
  drawing.contents = (__bridge id)composed;
  drawing.contentsScale = scale;
  drawing.contentsGravity = kCAGravityResize;
  [standIn addSublayer:drawing];
  CGImageRelease(composed);
  [layer.superlayer insertSublayer:standIn above:layer];
  return standIn;
}

}

namespace ardia_early_window {

BOOL CapturePicture(ArdiaWindowController *controller, NSString *windowId, NSMutableDictionary *layout) {
  NSWindow *window = controller.coreWindow.window;
  NSView *host = controller.coreWindow.hostView;
  NSView *root = controller.root;
  CALayer *layer = root.layer;
  NSArray<NSNumber *> *page = layout[@"page"];
  if (!gLayoutPath || !layer || !window.visible || window.miniaturized || ![page isKindOfClass:NSArray.class] || page.count != 4) return NO;
  const NSSize size = root.bounds.size;
  const CGFloat scale = window.backingScaleFactor ?: 2;
  const size_t w = (size_t)ceil(size.width * scale), h = (size_t)ceil(size.height * scale);
  if (w < 64 || h < 64) return NO;
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(nullptr, w, h, 8, 0, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(space);
  if (!context) return NO;
  CGContextSaveGState(context);
  CGContextScaleCTM(context, scale, scale);
  NSView *source = DrawnContent(root);
  CALayer *drawnLayer = source.layer ?: layer;
  if (source.isFlipped || drawnLayer.geometryFlipped) {
    CGContextTranslateCTM(context, 0, size.height);
    CGContextScaleCTM(context, 1, -1);
  }
  NSMutableArray<NSView *> *pending = [NSMutableArray arrayWithObject:source];
  NSMutableArray<CALayer *> *backdrops = [NSMutableArray array];
  NSMutableArray<NSView *> *glasses = [NSMutableArray array];
  NSMutableArray<CALayer *> *fills = [NSMutableArray array];
  NSMutableArray *fillColors = [NSMutableArray array];
  const NSRect whole = root.bounds;
  for (NSUInteger i = 0; i < pending.count && i < 4000; i++) {
    NSView *view = pending[i];
    if ([NSStringFromClass(view.class) hasSuffix:@"WindowBackdropView"] || [view isKindOfClass:NSVisualEffectView.class]) {
      if (view.layer && !view.layer.hidden) [backdrops addObject:view.layer];
      continue;
    }
    if (GlassClass() && [view isKindOfClass:GlassClass()]) {
      if (view.layer && !view.layer.hidden) [glasses addObject:view];
      continue;
    }
    if (NSEqualSizes([view convertRect:view.bounds toView:root].size, whole.size)) {
      if (view.layer.backgroundColor) {
        [fills addObject:view.layer];
        [fillColors addObject:(__bridge id)view.layer.backgroundColor];
      }
    }
    [pending addObjectsFromArray:view.subviews];
  }
  NSMutableSet<CALayer *> *glassLayers = [NSMutableSet set];
  for (NSView *glass in glasses) [glassLayers addObject:glass.layer];
  NSMutableArray<CALayer *> *layers = [NSMutableArray arrayWithObject:drawnLayer];
  NSMutableArray<CALayer *> *effected = [NSMutableArray array];
  NSMutableArray<NSArray *> *effects = [NSMutableArray array];
  for (NSUInteger i = 0; i < layers.count && i < 20000; i++) {
    CALayer *each = layers[i];
    if ([backdrops containsObject:each] || [glassLayers containsObject:each]) continue;
    if (each.mask || each.filters.count || each.compositingFilter || each.backgroundFilters.count || CastsPathShadowOnly(each)) {
      [effected addObject:each];
      [effects addObject:@[ each.mask ?: NSNull.null, each.filters ?: @[], each.compositingFilter ?: NSNull.null, each.backgroundFilters ?: @[] ]];
    }
    if (each.sublayers) [layers addObjectsFromArray:each.sublayers];
  }
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  for (CALayer *backdrop in backdrops) backdrop.hidden = YES;
  NSMutableArray<CALayer *> *standIns = [NSMutableArray array];
  NSMutableArray<NSDictionary *> *liveGlass = [NSMutableArray array];
  for (NSView *glass in glasses) {
    if (NSDictionary *record = host ? GlassRecord(glass, root, host) : nil) [liveGlass addObject:record];
    else if (CALayer *standIn = GlassStandIn(glass)) [standIns addObject:standIn];
  }
  for (CALayer *glass in glassLayers) glass.hidden = YES;
  for (CALayer *fill in fills) fill.backgroundColor = nil;
  for (CALayer *each in effected) {
    each.filters = nil;
    each.compositingFilter = nil;
    each.backgroundFilters = nil;
  }
  NSMutableArray<CALayer *> *replacedHidden = [NSMutableArray array];
  for (CALayer *each in effected.reverseObjectEnumerator) {
    if (!each.mask && !CastsPathShadowOnly(each)) continue;
    if (CALayer *standIn = each == drawnLayer ? nil : StandIn(each, scale)) {
      [standIns addObject:standIn];
      [replacedHidden addObject:each];
      each.hidden = YES;
    }
    each.mask = nil;
  }
  [drawnLayer renderInContext:context];
  for (CALayer *each in replacedHidden) each.hidden = NO;
  for (NSUInteger i = 0; i < effected.count; i++) {
    NSArray *saved = effects[i];
    effected[i].mask = saved[0] == NSNull.null ? nil : saved[0];
    effected[i].filters = [saved[1] count] ? saved[1] : nil;
    effected[i].compositingFilter = saved[2] == NSNull.null ? nil : saved[2];
    effected[i].backgroundFilters = [saved[3] count] ? saved[3] : nil;
  }
  for (CALayer *backdrop in backdrops) backdrop.hidden = NO;
  for (CALayer *standIn in standIns) [standIn removeFromSuperlayer];
  for (CALayer *glass in glassLayers) glass.hidden = NO;
  for (NSUInteger i = 0; i < fills.count; i++) fills[i].backgroundColor = (__bridge CGColorRef)fillColors[i];
  [CATransaction commit];
  CGContextRestoreGState(context);
  const CGRect hole = CGRectMake(page[0].doubleValue * scale, page[3].doubleValue * scale,
                                 w - (page[0].doubleValue + page[2].doubleValue) * scale, h - (page[1].doubleValue + page[3].doubleValue) * scale);
  if (hole.size.width > 0 && hole.size.height > 0) CGContextClearRect(context, hole);
  CGImageRef image = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  if (!image) return NO;
  NSString *path = PicturePath(windowId);
  __block BOOL written = NO;
  dispatch_sync(Writer(), ^{
    NSData *png = EncodePNG(image);
    written = png && [png writeToFile:path atomically:YES];
    CGImageRelease(image);
  });
  if (written && liveGlass.count) layout[@"glass"] = liveGlass;
  return written;
}

void DropPictureFile(NSString *windowId) {
  NSString *path = PicturePath(windowId);
  dispatch_async(Writer(), ^{ [NSFileManager.defaultManager removeItemAtPath:path error:nil]; });
}

}

namespace {

void FreePages(void *, const void *data, size_t size) {
  vm_deallocate(mach_task_self(), (vm_address_t)data, size);
}

}

namespace ardia_early_window {

CGImageRef DecodeOutsideHeap(CGImageRef encoded) {
  const size_t w = CGImageGetWidth(encoded), h = CGImageGetHeight(encoded), stride = w * 4;
  if (!w || !h || w > 16384 || h > 16384) return nullptr;
  const size_t size = round_page(stride * h);
  vm_address_t pages = 0;
  if (vm_allocate(mach_task_self(), &pages, size, VM_FLAGS_ANYWHERE) != KERN_SUCCESS) return nullptr;
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  const CGBitmapInfo info = (CGBitmapInfo)kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little;
  CGContextRef context = CGBitmapContextCreate((void *)pages, w, h, 8, stride, space, info);
  if (!context) {
    CGColorSpaceRelease(space);
    vm_deallocate(mach_task_self(), pages, size);
    return nullptr;
  }
  CGContextDrawImage(context, CGRectMake(0, 0, w, h), encoded);
  CGContextRelease(context);
  CGDataProviderRef provider = CGDataProviderCreateWithData(nullptr, (const void *)pages, size, FreePages);
  if (!provider) {
    CGColorSpaceRelease(space);
    vm_deallocate(mach_task_self(), pages, size);
    return nullptr;
  }
  CGImageRef image = CGImageCreate(w, h, 8, 32, stride, space, info, provider, nullptr, false, kCGRenderingIntentDefault);
  CGDataProviderRelease(provider);
  CGColorSpaceRelease(space);
  return image;
}

CGImageRef TakePrefetched(NSString *windowId) {
  CGImageRef picture = nullptr;
  if (gPrefetch && [gPrefetchedWindow isEqualToString:windowId] &&
      dispatch_group_wait(gPrefetch, dispatch_time(DISPATCH_TIME_NOW, 40 * NSEC_PER_MSEC)) == 0) {
    os_unfair_lock_lock(&gPrefetchLock);
    picture = gPrefetched;
    gPrefetched = nullptr;
    os_unfair_lock_unlock(&gPrefetchLock);
  }
  [ArdiaEarlyWindow discardPrefetch];
  return picture;
}

}
