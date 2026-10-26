#import "ArdiaCoreEarlyWindow.h"

#import "ACChromeWindow.h"
#import "ArdiaCoreEngineBridge.h"
#import "ArdiaCoreInternal.h"
#import "ArdiaCoreTabParking.h"
#import "ArdiaCoreWebView.h"
#import "ArdiaCoreWebViewInternal.h"

#import <ImageIO/ImageIO.h>
#import <objc/message.h>
#import <CommonCrypto/CommonDigest.h>
#import <QuartzCore/QuartzCore.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <cmath>
#include <initializer_list>
#include <mach/mach.h>
#include <os/lock.h>

@interface ACEarlyShown : NSObject
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, copy) NSString *appWindow;
@property(nonatomic, copy) NSString *profile;
@property(nonatomic, strong) NSView *cover;
@property(nonatomic, strong) NSView *picture;
@property(nonatomic, strong) NSView *backdrop;
@property(nonatomic, weak) NSView *root;
@property(nonatomic, strong) NSColor *rootFill;
@property(nonatomic) BOOL rootFillCleared;
@property(nonatomic, strong) ArdiaCoreTab *tab;
@property(nonatomic, copy) NSString *key;
@property(nonatomic, copy) NSString *expectedURL;
@property(nonatomic) NSRect pageRect;
@property(nonatomic) BOOL claimed;
@property(nonatomic) BOOL expired;
@property(nonatomic) BOOL shielded;
@property(nonatomic, strong) id inputBlock;
@property(nonatomic, strong) id contentObserver;
@property(nonatomic, strong) id closeObserver;
@end

@implementation ACEarlyShown
@end

@interface ACEarlyVeil : NSObject
@property(nonatomic, strong) NSView *view;
@property(nonatomic, strong) id inputBlock;
@property(nonatomic) BOOL restoreFocus;
@property(nonatomic, copy) NSString *lastShown;
@property(nonatomic) CFTimeInterval changedAt;
@property(nonatomic) NSUInteger armedGeneration;
@property(nonatomic, copy) NSString *armedShown;
@end

@implementation ACEarlyVeil
@end

@interface ACPageEmits : NSObject
@property(nonatomic) NSUInteger generation;
@property(nonatomic, strong) NSMutableOrderedSet<NSString *> *current;
@property(nonatomic, strong) NSMutableOrderedSet<NSString *> *older;
@property(nonatomic) BOOL forgot;
@property(nonatomic) CFTimeInterval firstEmitAt;
@end

@implementation ACPageEmits
@end

namespace {

constexpr int kLayoutVersion = 3;
constexpr double kRecordDelay = 1.0;
constexpr double kUnclaimedSeconds = 15;
constexpr double kClaimedSeconds = 5;
constexpr double kUntakenAfterContentSeconds = 2;
constexpr double kCoverCheckSeconds = 0.016;
constexpr double kCoveredFailSafeSeconds = 1.5;
constexpr double kOnScreenAfterCoveredSeconds = 0.05;
constexpr CGFloat kGlassVeilDark = 0.128;
constexpr CGFloat kGlassVeilLight = 0.3;
constexpr CGFloat kMinPage = 100;
constexpr double kTrimAfterHandoffSeconds = 2;
constexpr double kWatchAfterAdoptionSeconds = 10;
constexpr double kVeilFailSafeSeconds = 2;
constexpr NSUInteger kOlderEmitsKept = 256;

NSString *gLayoutPath;
NSString *gDirectory;
BOOL gRecordQueued;
NSData *gScheduled;
NSMutableDictionary<NSString *, NSDictionary *> *gLayouts;
os_unfair_lock gPrefetchLock = OS_UNFAIR_LOCK_INIT;
CGImageRef gPrefetched;
BOOL gPrefetchDiscarded;
NSString *gPrefetchedWindow;
dispatch_group_t gPrefetch;
BOOL gPictureCurrent;
NSString *gLaunchURL;
NSDictionary *gLittleLayout;
NSString *const kLittleWindow = @"ardia.early.little-ardia";

NSMapTable<ArdiaCoreTab *, ACEarlyVeil *> *Veils() {
  static NSMapTable *veils = [NSMapTable weakToStrongObjectsMapTable];
  return veils;
}

NSMapTable<ArdiaCoreTab *, ACPageEmits *> *Emits() {
  static NSMapTable *emits = [NSMapTable weakToStrongObjectsMapTable];
  return emits;
}

ACPageEmits *EmitsOf(ArdiaCoreTab *tab) {
  ACPageEmits *emits = [Emits() objectForKey:tab];
  if (!emits && tab) {
    emits = [ACPageEmits new];
    emits.generation = 1;
    emits.current = [NSMutableOrderedSet orderedSet];
    emits.older = [NSMutableOrderedSet orderedSet];
    [Emits() setObject:emits forKey:tab];
  }
  return emits;
}

void Archive(ACPageEmits *emits, NSString *url) {
  [emits.older removeObject:url];
  [emits.older addObject:url];
  while (emits.older.count > kOlderEmitsKept) {
    [emits.older removeObjectAtIndex:0];
    emits.forgot = YES;
  }
}

NSHashTable<ArdiaCoreTab *> *Watched() {
  static NSHashTable *watched = [NSHashTable weakObjectsHashTable];
  return watched;
}

NSMutableSet<NSString *> *Dismissed() {
  static NSMutableSet *dismissed = [NSMutableSet set];
  return dismissed;
}

dispatch_queue_t Writer() {
  static dispatch_queue_t queue = dispatch_queue_create("ardia.early-window.writer", DISPATCH_QUEUE_SERIAL);
  return queue;
}

NSMutableArray<ACEarlyShown *> *Shown() {
  static NSMutableArray *shown = [NSMutableArray array];
  return shown;
}

ACEarlyShown *ShownForWindow(NSWindow *window) {
  if (!window) return nil;
  for (ACEarlyShown *s in Shown())
    if (s.window == window) return s;
  return nil;
}

bool SwitchedOffByEnvironment() {
  const char *env = getenv("ARDIA_EARLY_WINDOW");
  if (env && (!strcmp(env, "off") || !strcmp(env, "0") || !strcmp(env, "false"))) return true;
  const char *switches = getenv("ARDIA_SWITCHES");
  if (!switches) return false;
  for (NSString *part in [@(switches) componentsSeparatedByString:@","]) {
    NSArray<NSString *> *pair = [part componentsSeparatedByString:@"="];
    if (pair.count != 2) continue;
    NSString *name = [pair[0] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    NSString *value = [pair[1] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    if ([name isEqualToString:@"earlyWindow"] && [@[ @"off", @"0", @"false" ] containsObject:value]) return true;
  }
  return false;
}

NSDictionary *SessionAt(NSString *directory) {
  NSData *data = directory ? [NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:@"session.json"]] : nil;
  NSDictionary *session = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [session isKindOfClass:NSDictionary.class] ? session : nil;
}

NSString *StateOf(NSDictionary *session, NSString *windowId) {
  NSDictionary *settings = [session[@"settings"] isKindOfClass:NSDictionary.class] ? session[@"settings"] : @{};
  NSDictionary *window = nil;
  for (NSDictionary *w in [session[@"windows"] isKindOfClass:NSArray.class] ? session[@"windows"] : @[])
    if ([w isKindOfClass:NSDictionary.class] && [w[@"id"] isEqual:windowId]) window = w;
  if (!window) return nil;
  NSMutableDictionary *state = [NSMutableDictionary dictionary];
  for (NSString *key in @[ @"tabLayout", @"addressBar", @"sidebarWidth", @"bookmarksBar", @"appearance", @"hideToolbarWhileScrolling", @"showFullUrl" ])
    if (settings[key]) state[[@"s." stringByAppendingString:key]] = settings[key];
  for (NSString *key in @[ @"sidebarOpen", @"tabLayout", @"profileId", @"incognito" ])
    if (window[key]) state[[@"w." stringByAppendingString:key]] = window[key];
  NSData *data = [NSJSONSerialization dataWithJSONObject:state options:NSJSONWritingSortedKeys error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
}

NSString *ContentOf(NSDictionary *session, NSString *windowId) {
  NSDictionary *window = nil;
  for (NSDictionary *w in [session[@"windows"] isKindOfClass:NSArray.class] ? session[@"windows"] : @[])
    if ([w isKindOfClass:NSDictionary.class] && [w[@"id"] isEqual:windowId]) window = w;
  if (!window) return nil;
  NSMutableDictionary *tabs = [NSMutableDictionary dictionary];
  for (NSDictionary *t in [session[@"tabs"] isKindOfClass:NSArray.class] ? session[@"tabs"] : @[])
    if ([t isKindOfClass:NSDictionary.class] && [t[@"windowId"] isEqual:windowId] && [t[@"id"] isKindOfClass:NSString.class])
      tabs[t[@"id"]] = @[ t[@"title"] ?: NSNull.null, t[@"customTitle"] ?: NSNull.null, t[@"url"] ?: NSNull.null, t[@"favicon"] ?: NSNull.null,
                          t[@"customIcon"] ?: NSNull.null, t[@"pinned"] ?: NSNull.null, t[@"muted"] ?: NSNull.null ];
  NSMutableArray *groups = [NSMutableArray array];
  for (NSDictionary *g in [session[@"groups"] isKindOfClass:NSArray.class] ? session[@"groups"] : @[])
    if ([g isKindOfClass:NSDictionary.class] && [g[@"windowId"] isEqual:windowId]) [groups addObject:g];
  NSDictionary *content = @{
    @"window" : window,
    @"tabs" : tabs,
    @"groups" : groups,
    @"profiles" : session[@"profiles"] ?: NSNull.null,
    @"settings" : session[@"settings"] ?: NSNull.null,
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:content options:NSJSONWritingSortedKeys error:nil];
  if (!data) return nil;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  NSMutableString *hex = [NSMutableString string];
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [hex appendFormat:@"%02x", digest[i]];
  return hex;
}

NSArray<NSNumber *> *Insets(NSRect rect, NSView *host) {
  const NSRect bounds = host.bounds;
  const CGFloat top = host.isFlipped ? NSMinY(rect) : NSMaxY(bounds) - NSMaxY(rect);
  const CGFloat bottom = host.isFlipped ? NSMaxY(bounds) - NSMaxY(rect) : NSMinY(rect);
  return @[ @(round(NSMinX(rect) * 2) / 2), @(round(top * 2) / 2), @(round((NSMaxX(bounds) - NSMaxX(rect)) * 2) / 2), @(round(bottom * 2) / 2) ];
}

bool ReadInsets(id value, CGFloat out[4]) {
  if (![value isKindOfClass:NSArray.class] || [value count] != 4) return false;
  for (int i = 0; i < 4; i++) {
    id n = value[i];
    if (![n isKindOfClass:NSNumber.class] || !std::isfinite([n doubleValue]) || [n doubleValue] < 0) return false;
    out[i] = [n doubleValue];
  }
  return true;
}

bool Fits(const CGFloat insets[4], NSView *host) {
  return NSWidth(host.bounds) - insets[0] - insets[2] >= kMinPage && NSHeight(host.bounds) - insets[1] - insets[3] >= kMinPage;
}

NSRect RectFromInsets(const CGFloat insets[4], NSView *host) {
  const NSRect bounds = host.bounds;
  const CGFloat width = NSWidth(bounds) - insets[0] - insets[2], height = NSHeight(bounds) - insets[1] - insets[3];
  const CGFloat y = host.isFlipped ? insets[1] : insets[3];
  return NSMakeRect(insets[0], y, MAX(0, width), MAX(0, height));
}

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

NSString *PicturePath(NSString *windowId) {
  return [gDirectory stringByAppendingPathComponent:PictureName(windowId)];
}

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

BOOL CapturePicture(ArdiaCoreWindowController *controller, NSString *windowId, NSMutableDictionary *layout) {
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

NSDictionary *WindowLayout(ArdiaCoreWindowController *controller, NSDictionary *session) {
  NSWindow *window = controller.coreWindow.window;
  NSView *host = controller.coreWindow.hostView;
  if (!window.visible || !host || !controller.root || (window.styleMask & NSWindowStyleMaskFullScreen)) return nil;
  if ([window.identifier isEqualToString:@"ardia.window.small"] || ShownForWindow(window)) return nil;
  NSString *state = StateOf(session, controller.appWindowId);
  if (!state) return nil;
  NSMutableArray<NSView *> *pending = [NSMutableArray arrayWithObject:controller.root];
  NSMutableArray<ArdiaCoreWebView *> *shown = [NSMutableArray array];
  for (NSUInteger i = 0; i < pending.count && i < 4000; i++) {
    NSView *view = pending[i];
    if ([view isKindOfClass:ArdiaCoreWebView.class]) {
      ArdiaCoreWebView *web = (ArdiaCoreWebView *)view;
      if (web.visible && web.browserId && !web.hiddenOrHasHiddenAncestor && web.alphaValue > 0) [shown addObject:web];
      continue;
    }
    [pending addObjectsFromArray:view.subviews];
  }
  if (shown.count != 1) return nil;
  ArdiaCoreWebView *web = shown[0];
  if (NSWidth(web.bounds) < kMinPage || NSHeight(web.bounds) < kMinPage) return nil;
  NSView *clip = nil;
  for (NSView *v = web; v && v != host; v = v.superview)
    if (v.layer.masksToBounds && v.layer.cornerRadius > 0) {
      clip = v;
      break;
    }
  NSView *card = clip ?: web;
  NSMutableDictionary *layout = [@{
    @"page" : Insets([web convertRect:web.bounds toView:host], host),
    @"card" : Insets([card convertRect:card.bounds toView:host], host),
    @"radius" : @(clip ? clip.layer.cornerRadius : 0),
    @"curve" : clip.layer.cornerCurve ?: kCACornerCurveCircular,
    @"size" : @[ @(NSWidth(window.frame)), @(NSHeight(window.frame)) ],
    @"state" : state,
    @"content" : ContentOf(session, controller.appWindowId) ?: @"",
  } mutableCopy];
  if (web.transferKey.length) layout[@"tab"] = web.transferKey;
  if (NSValue *lights = ACTrafficLightsCenter(window)) layout[@"lights"] = @[ @(lights.pointValue.x), @(lights.pointValue.y) ];
  if (window.appearance.name) layout[@"appearance"] = window.appearance.name;
  if (NSColor *color = [web.pageBackgroundColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace])
    layout[@"pageColor"] = @[ @(color.redComponent), @(color.greenComponent), @(color.blueComponent), @(color.alphaComponent) ];
  return layout;
}

void LoadLayouts() {
  if (gLayouts || !gLayoutPath) return;
  gLayouts = [NSMutableDictionary dictionary];
  NSData *data = [NSData dataWithContentsOfFile:gLayoutPath];
  NSDictionary *file = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![file isKindOfClass:NSDictionary.class] || ![file[@"version"] isEqual:@(kLayoutVersion)]) return;
  if ([file[@"windows"] isKindOfClass:NSDictionary.class])
    for (NSString *key in file[@"windows"])
      if ([key isKindOfClass:NSString.class] && [file[@"windows"][key] isKindOfClass:NSDictionary.class]) gLayouts[key] = file[@"windows"][key];
  gScheduled = data;
}

void Write(NSData *data) {
  if (!data || [data isEqual:gScheduled]) return;
  gScheduled = data;
  NSString *path = gLayoutPath;
  dispatch_async(Writer(), ^{
    if ([data writeToFile:path atomically:YES]) return;
    dispatch_async(dispatch_get_main_queue(), ^{
      if (gScheduled == data) gScheduled = nil;
    });
  });
}

void RecordLayouts(NSDictionary *session, BOOL wait);
NSString *ActiveTabOf(NSDictionary *session, NSString *windowId);

void Record(BOOL wait) {
  gRecordQueued = NO;
  if (!gDirectory.length) return;
  NSDictionary *session = SessionAt(gDirectory);
  if ([session[@"settings"] isKindOfClass:NSDictionary.class] && [session[@"settings"][@"restoreSession"] isEqual:@NO])
    [ArdiaCoreEarlyWindow forgetPictures];
  else if (gLayoutPath && session)
    RecordLayouts(session, wait);
  if (wait) dispatch_sync(Writer(), ^{});
}

NSString *ActiveTabOf(NSDictionary *session, NSString *windowId) {
  for (NSDictionary *w in [session[@"windows"] isKindOfClass:NSArray.class] ? session[@"windows"] : @[]) {
    if (![w isKindOfClass:NSDictionary.class] || ![w[@"id"] isEqual:windowId]) continue;
    NSDictionary *active = [w[@"activeTabIds"] isKindOfClass:NSDictionary.class] ? w[@"activeTabIds"] : nil;
    id tab = [w[@"profileId"] isKindOfClass:NSString.class] ? active[w[@"profileId"]] : nil;
    return [tab isKindOfClass:NSString.class] ? tab : nil;
  }
  return nil;
}

void RecordLayouts(NSDictionary *session, BOOL wait) {
  LoadLayouts();
  NSMutableSet *saved = [NSMutableSet set];
  for (NSDictionary *w in [session[@"windows"] isKindOfClass:NSArray.class] ? session[@"windows"] : @[])
    if ([w isKindOfClass:NSDictionary.class] && [w[@"id"] isKindOfClass:NSString.class]) [saved addObject:w[@"id"]];
  NSMutableSet *live = [NSMutableSet set];
  for (ArdiaCoreWindowController *controller in ArdiaCoreWindowController.all) {
    NSString *windowId = controller.appWindowId;
    if (!windowId.length || controller.stray || controller.standalone) continue;
    [live addObject:windowId];
    NSMutableDictionary *layout = [WindowLayout(controller, session) mutableCopy];
    if (!layout) continue;
    if (wait) {
      NSString *active = ActiveTabOf(session, windowId);
      if (active && [layout[@"tab"] isEqual:active] && CapturePicture(controller, windowId, layout)) layout[@"pictureContent"] = layout[@"content"];
      else DropPictureFile(windowId);
    } else if ([gLayouts[windowId][@"pictureContent"] isKindOfClass:NSString.class]) {
      layout[@"pictureContent"] = gLayouts[windowId][@"pictureContent"];
      if (id glass = gLayouts[windowId][@"glass"]) layout[@"glass"] = glass;
    }
    gLayouts[windowId] = layout;
  }
  for (NSString *key in gLayouts.allKeys)
    if (![saved containsObject:key] && ![live containsObject:key]) {
      [gLayouts removeObjectForKey:key];
      DropPictureFile(key);
    }
  while (gLayouts.count > 16) {
    NSString *drop = nil;
    for (NSString *key in gLayouts)
      if (![live containsObject:key]) drop = key;
    if (!drop) break;
    [gLayouts removeObjectForKey:drop];
    DropPictureFile(drop);
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"version" : @(kLayoutVersion), @"windows" : gLayouts}
                                                 options:NSJSONWritingSortedKeys
                                                   error:nil];
  Write(data);
}

NSString *ParsedOrigin(NSString *url) {
  for (NSString *wrapper in @[ @"blob:", @"filesystem:" ])
    if ([url.lowercaseString hasPrefix:wrapper]) url = [url substringFromIndex:wrapper.length];
  const NSRange colon = [url rangeOfString:@":"];
  if (colon.location == NSNotFound || colon.location == 0) return nil;
  NSString *scheme = [url substringToIndex:colon.location].lowercaseString;
  NSCharacterSet *schemeChars = [NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyz0123456789+.-"];
  if ([scheme rangeOfCharacterFromSet:schemeChars.invertedSet].location != NSNotFound) return nil;
  NSString *rest = [url substringFromIndex:NSMaxRange(colon)];
  if (![rest hasPrefix:@"//"]) return @"";
  rest = [rest substringFromIndex:2];
  const NSRange end = [rest rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"/?#"]];
  NSString *authority = end.location == NSNotFound ? rest : [rest substringToIndex:end.location];
  const NSRange user = [authority rangeOfString:@"@" options:NSBackwardsSearch];
  if (user.location != NSNotFound) authority = [authority substringFromIndex:NSMaxRange(user)];
  return [NSString stringWithFormat:@"%@://%@", scheme, authority.lowercaseString];
}

NSString *EngineOrigin(NSString *url, BOOL *failed) {
  @try {
    id origin = ((id (*)(id, SEL, NSString *))objc_msgSend)(NSClassFromString(@"ArdiaCoreTab"), NSSelectorFromString(@"originForURL:"), url);
    if (!origin || [origin isKindOfClass:NSString.class]) return origin;
  } @catch (id) {
  }
  *failed = YES;
  return nil;
}

BOOL EngineOriginsWork() {
  static BOOL works;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    if (![NSClassFromString(@"ArdiaCoreTab") respondsToSelector:NSSelectorFromString(@"originForURL:")]) return;
    NSDictionary<NSString *, NSString *> *known = @{
      @"https://a.test/x" : @"https://a.test",
      @"http://EXAMPLE.com:80/" : @"http://example.com",
      @"http://[0:0:0:0:0:0:0:1]:8080/" : @"http://[::1]:8080",
      @"chrome://version/" : @"chrome://version",
      @"blob:https://a.test/id" : @"https://a.test",
      @"data:text/html,a://b" : @"",
    };
    works = YES;
    for (NSString *url in known) {
      BOOL failed = NO;
      if (![EngineOrigin(url, &failed) isEqual:known[url]] || failed) works = NO;
    }
    NSLog(works ? @"[ardiacore] page veil: the engine's originForURL: passed its self-check"
                : @"[ardiacore] page veil: the engine's originForURL: failed its self-check; origins are parsed instead");
  });
  return works;
}

NSString *OriginOfURL(NSString *url) {
  if (!url.length) return nil;
  if ([url.lowercaseString hasPrefix:@"view-source:"]) url = [url substringFromIndex:12];
  NSString *parsed = ParsedOrigin(url);
  if (!EngineOriginsWork()) return parsed;
  BOOL failed = NO;
  NSString *engine = EngineOrigin(url, &failed);
  if (failed) return parsed;
  static NSSet<NSString *> *const network = [NSSet setWithArray:@[ @"http", @"https", @"ws", @"wss" ]];
  NSString *scheme = parsed.length ? [parsed substringToIndex:[parsed rangeOfString:@":"].location] : nil;
  if (!engine || (!engine.length && scheme && [network containsObject:scheme])) return parsed;
  return engine;
}

id TabCall(ArdiaCoreTab *tab, NSString *name, BOOL *answered) {
  const SEL selector = NSSelectorFromString(name);
  *answered = [tab respondsToSelector:selector];
  return *answered ? ((id (*)(id, SEL))objc_msgSend)(tab, selector) : nil;
}

NSString *LiveOrigin(ArdiaCoreTab *tab) {
  BOOL answered = NO;
  NSString *committed = TabCall(tab, @"committedOrigin", &answered);
  return answered ? committed : OriginOfURL(tab.url);
}

BOOL Untitled(NSString *url) {
  return !url.length || [url isEqualToString:@"about:blank"];
}

BOOL IsFile(NSString *url) {
  if ([url.lowercaseString hasPrefix:@"view-source:"]) url = [url substringFromIndex:12];
  return [url.lowercaseString hasPrefix:@"file:"];
}

BOOL ShownMatches(NSString *shownURL, ArdiaCoreTab *tab) {
  if (shownURL.length && [[Emits() objectForKey:tab].current containsObject:shownURL]) return YES;
  NSString *shown = OriginOfURL(shownURL), *live = LiveOrigin(tab);
  if (shown.length && live.length && !IsFile(shownURL) && !IsFile(tab.url)) return [shown isEqualToString:live];
  NSString *url = tab.url;
  return Untitled(shownURL) ? Untitled(url) : [shownURL isEqualToString:url];
}

bool PageVeilOff() {
  static const bool off = [@(getenv("ARDIA_PAGE_VEIL") ?: "") isEqualToString:@"off"];
  return off;
}

BOOL ShowsLaunchOrigin(ArdiaCoreTab *tab, NSString *launchURL) {
  NSString *launch = OriginOfURL(launchURL);
  if (!launch) return NO;
  BOOL engineKnows = NO;
  NSString *committed = TabCall(tab, @"committedOrigin", &engineKnows);
  if (committed && ![committed isEqualToString:launch]) return NO;
  NSString *url = tab.url;
  if (!url.length) return YES;
  if ([url isEqualToString:@"about:blank"]) return engineKnows;
  NSString *live = OriginOfURL(url);
  if (![live isEqualToString:launch]) return NO;
  if (![live hasPrefix:@"https:"] || ![tab respondsToSelector:@selector(securityInfo)]) return YES;
  return ![tab.securityInfo[@"level"] isEqual:@"certificateError"];
}

BOOL ReleaseFocusFrom(NSView *page) {
  NSWindow *window = page.window;
  NSResponder *focused = window.firstResponder;
  if (!page || ![focused isKindOfClass:NSView.class] || ![(NSView *)focused isDescendantOf:page]) return NO;
  [window makeFirstResponder:nil];
  return YES;
}

void PlaceVeil(ArdiaCoreTab *tab, ACEarlyVeil *veil) {
  NSView *page = tab.view, *host = page.superview;
  if (!host || host == veil.view.superview) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  if (!veil.view) {
    veil.view = [[NSView alloc] initWithFrame:host.bounds];
    veil.view.wantsLayer = YES;
    veil.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  }
  NSColor *fill = [host isKindOfClass:ArdiaCoreWebView.class] ? ((ArdiaCoreWebView *)host).pageBackgroundColor : nil;
  veil.view.layer.backgroundColor = (fill ?: NSColor.windowBackgroundColor).CGColor;
  veil.view.frame = host.bounds;
  [host addSubview:veil.view positioned:NSWindowAbove relativeTo:page];
  [CATransaction commit];
  if (ReleaseFocusFrom(page)) veil.restoreFocus = YES;
}

void Unveil(ArdiaCoreTab *tab) {
  ACEarlyVeil *veil = [Veils() objectForKey:tab];
  if (!veil) return;
  [Veils() removeObjectForKey:tab];
  NSView *host = veil.view.superview;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [veil.view removeFromSuperview];
  [CATransaction commit];
  if (!veil.restoreFocus || tab.closed || tab.view.superview != host || ![host isKindOfClass:ArdiaCoreWebView.class]) return;
  ArdiaCoreWebView *web = (ArdiaCoreWebView *)host;
  NSWindow *window = web.window;
  NSResponder *focused = window.firstResponder;
  if (window.isVisible && !window.isMiniaturized && web.visible && !web.isHiddenOrHasHiddenAncestor && (!focused || focused == window)) [tab focus];
}

void Reconcile(ArdiaCoreTab *tab) {
  NSView *host = tab.view.superview;
  if ([host isKindOfClass:ArdiaCoreWebView.class]) [ArdiaCoreEarlyWindow page:tab shownURL:((ArdiaCoreWebView *)host).shownURL];
}

void WatchVeil(ArdiaCoreTab *tab, ACEarlyVeil *veil, double after) {
  __weak ArdiaCoreTab *weakTab = tab;
  __weak ACEarlyVeil *weakVeil = veil;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(after * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaCoreTab *page = weakTab;
    ACEarlyVeil *still = weakVeil;
    if (!page || !still || [Veils() objectForKey:page] != still) return;
    if (still.armedGeneration != EmitsOf(page).generation || ![still.armedShown ?: @"" isEqualToString:still.lastShown ?: @""]) return;
    const double left = still.changedAt + kVeilFailSafeSeconds - CACurrentMediaTime();
    if (left > 0.05) return WatchVeil(page, still, left);
    BOOL answered = NO;
    NSLog(@"[ardiacore] page veil lifted %.1f s after the bar showed a URL the engine never sent: shown origin %@, committed %@, visible %@", kVeilFailSafeSeconds,
          OriginOfURL(still.lastShown) ?: @"(none)", TabCall(page, @"committedOrigin", &answered) ?: @"(none)", OriginOfURL(page.url) ?: @"(none)");
    Unveil(page);
  });
}

void CarryShield(ArdiaCoreTab *tab, id inputBlock, NSString *shownAtPlacement) {
  if (!tab || tab.closed) return;
  ACEarlyVeil *veil = [Veils() objectForKey:tab];
  if (!veil) {
    veil = [ACEarlyVeil new];
    veil.lastShown = shownAtPlacement;
    veil.changedAt = CACurrentMediaTime();
    [Veils() setObject:veil forKey:tab];
  }
  if (!veil.inputBlock) {
    BOOL answered = NO;
    veil.inputBlock = inputBlock ?: TabCall(tab, @"suppressInput", &answered);
  }
  PlaceVeil(tab, veil);
  Reconcile(tab);
}

void DropCover(ACEarlyShown *s) {
  if (s.contentObserver) [NSNotificationCenter.defaultCenter removeObserver:s.contentObserver];
  s.contentObserver = nil;
  ArdiaCoreTab *tab = s.tab;
  NSView *cover = s.cover;
  id inputBlock = s.inputBlock;
  s.tab = nil;
  s.cover = nil;
  s.inputBlock = nil;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  if (tab && tab.view.superview == cover) [tab.view removeFromSuperview];
  [cover removeFromSuperview];
  [CATransaction commit];
  if (s.shielded || s.expectedURL) {
    NSView *host = tab.view.superview;
    NSString *shown = [host isKindOfClass:ArdiaCoreWebView.class] ? ((ArdiaCoreWebView *)host).shownURL : nil;
    CarryShield(tab, inputBlock, shown.length ? shown : (s.expectedURL ?: gLaunchURL));
  }
  else if (tab && !tab.closed && [tab.view.superview isKindOfClass:ArdiaCoreWebView.class]) {
    [Watched() addObject:tab];
    __weak ArdiaCoreTab *watched = tab;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kWatchAfterAdoptionSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (ArdiaCoreTab *still = watched) [Watched() removeObject:still];
    });
    [ArdiaCoreEarlyWindow page:tab shownURL:((ArdiaCoreWebView *)tab.view.superview).shownURL];
  }
}

bool EnvOff(const char *name) {
  const char *value = getenv(name);
  return value && (!strcmp(value, "off") || !strcmp(value, "0") || !strcmp(value, "false"));
}

void TrimAfterHandoff() {
  static bool trimmed;
  if (trimmed || EnvOff("ARDIA_MEMORY_TRIM") || EnvOff("ARDIA_MEMORY_TRIM_ENGINE")) return;
  trimmed = true;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kTrimAfterHandoffSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [ArdiaCoreEngineBridge call:@"ac_memory_trim" profile:@"" args:nil completion:^(NSString *) {}];
  });
}

void RemovePicture(NSView *picture) {
  picture.layer.contents = nil;
  [picture removeFromSuperview];
}

void ClearRootFill(ACEarlyShown *s, NSView *root) {
  if (s.rootFillCleared || (!s.picture && !s.backdrop) || ![root respondsToSelector:@selector(setBackgroundColor:)]) return;
  id fill = [root valueForKey:@"backgroundColor"];
  s.rootFill = [fill isKindOfClass:NSColor.class] ? fill : nil;
  s.rootFillCleared = YES;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [root setValue:nil forKey:@"backgroundColor"];
  if (s.picture) root.alphaValue = 0;
  [CATransaction commit];
}

void ReleasePictures(NSView *picture, NSView *backdrop, NSView *root, NSColor *fill) {
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  RemovePicture(picture);
  [backdrop removeFromSuperview];
  if (root) {
    [root setValue:fill forKey:@"backgroundColor"];
    root.alphaValue = 1;
  }
  [CATransaction commit];
}

BOOL Covered(NSView *root) {
  if (!root.window) return NO;
  const NSRect whole = NSInsetRect(root.bounds, 1, 1);
  NSMutableArray<NSView *> *pending = [NSMutableArray arrayWithObject:root];
  for (NSUInteger i = 0; i < pending.count && i < 4000; i++) {
    NSView *view = pending[i];
    if ([NSStringFromClass(view.class) hasSuffix:@"WindowBackdropView"])
      return !view.isHiddenOrHasHiddenAncestor && view.alphaValue > 0 && NSContainsRect([view convertRect:view.bounds toView:root], whole);
    [pending addObjectsFromArray:view.subviews];
  }
  return NO;
}

void ReleaseOnceCovered(NSView *picture, NSView *backdrop, NSView *root, NSColor *fill, BOOL restoreFill, CFTimeInterval deadline) {
  __weak NSView *weakRoot = root;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kCoverCheckSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSView *drawnRoot = weakRoot;
    const BOOL covered = drawnRoot && Covered(drawnRoot);
    if (drawnRoot && !covered && CACurrentMediaTime() < deadline) return ReleaseOnceCovered(picture, backdrop, drawnRoot, fill, restoreFill, deadline);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kOnScreenAfterCoveredSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      NSView *shownRoot = weakRoot;
      if (covered && shownRoot && !Covered(shownRoot))
        return ReleaseOnceCovered(picture, backdrop, shownRoot, fill, restoreFill, MAX(deadline, CACurrentMediaTime() + kCoveredFailSafeSeconds));
      ReleasePictures(picture, backdrop, restoreFill ? shownRoot : nil, fill);
    });
  });
}

void DropPictures(ACEarlyShown *s) {
  ReleasePictures(s.picture, s.backdrop, s.rootFillCleared ? s.root : nil, s.rootFill);
  s.picture = nil;
  s.backdrop = nil;
  s.rootFillCleared = NO;
  s.rootFill = nil;
}

void HandOffPictures(ACEarlyShown *s) {
  if (s.picture || s.backdrop)
    ReleaseOnceCovered(s.picture, s.backdrop, s.root, s.rootFill, s.rootFillCleared, CACurrentMediaTime() + kCoveredFailSafeSeconds);
  s.picture = nil;
  s.backdrop = nil;
  s.rootFillCleared = NO;
  s.rootFill = nil;
}

void Forget(ACEarlyShown *s) {
  DropCover(s);
  if (s.closeObserver) [NSNotificationCenter.defaultCenter removeObserver:s.closeObserver];
  s.closeObserver = nil;
  HandOffPictures(s);
  [Shown() removeObject:s];
  if (!Shown().count) TrimAfterHandoff();
}

void Abandon(ACEarlyShown *s) {
  NSWindow *window = s.window;
  const BOOL unclaimed = !s.claimed;
  DropPictures(s);
  Forget(s);
  if (!unclaimed || !window) return;
  [window orderOut:nil];
  [ACChromeWindowHost closeWindow:window];
}

NSView *Cover(NSView *host, NSDictionary *layout, NSRect *pageRect) {
  CGFloat page[4], card[4];
  if (!ReadInsets(layout[@"page"], page) || !ReadInsets(layout[@"card"], card) || !Fits(page, host) || !Fits(card, host)) return nil;
  NSView *cover = [[NSView alloc] initWithFrame:RectFromInsets(card, host)];
  cover.wantsLayer = YES;
  cover.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  const double radius = [layout[@"radius"] isKindOfClass:NSNumber.class] ? [layout[@"radius"] doubleValue] : 0;
  if (radius > 0 && std::isfinite(radius)) {
    cover.layer.cornerRadius = MIN(radius, 64);
    if ([layout[@"curve"] isKindOfClass:NSString.class]) cover.layer.cornerCurve = layout[@"curve"];
    cover.layer.masksToBounds = YES;
  }
  [host addSubview:cover];
  *pageRect = [cover convertRect:RectFromInsets(page, host) fromView:host];
  NSArray *color = layout[@"pageColor"];
  if ([color isKindOfClass:NSArray.class] && color.count == 4) {
    CALayer *fill = [CALayer layer];
    fill.frame = *pageRect;
    fill.backgroundColor = [NSColor colorWithSRGBRed:[color[0] doubleValue] green:[color[1] doubleValue] blue:[color[2] doubleValue] alpha:[color[3] doubleValue]].CGColor;
    [cover.layer addSublayer:fill];
  }
  return cover;
}

void Shield(ACEarlyShown *s) {
  s.shielded = YES;
  BOOL answered = NO;
  s.inputBlock = TabCall(s.tab, @"suppressInput", &answered);
  ReleaseFocusFrom(s.tab.view);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  s.cover.hidden = YES;
  [CATransaction commit];
}

void ApplyLights(NSWindow *window, NSDictionary *layout) {
  NSArray *lights = layout[@"lights"];
  if ([lights isKindOfClass:NSArray.class] && lights.count == 2 && [lights[0] isKindOfClass:NSNumber.class] && [lights[1] isKindOfClass:NSNumber.class])
    [ACChromeWindowHost setTrafficLightsCenter:[NSValue valueWithPoint:NSMakePoint([lights[0] doubleValue], [lights[1] doubleValue])] inWindow:window];
}

void FreePages(void *, const void *data, size_t size) {
  vm_deallocate(mach_task_self(), (vm_address_t)data, size);
}

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
  [ArdiaCoreEarlyWindow discardPrefetch];
  return picture;
}

}

@implementation ArdiaCoreEarlyWindow

+ (void)setDataDirectory:(NSString *)directory {
  gDirectory = [directory copy];
  gLayoutPath = directory.length && !SwitchedOffByEnvironment() ? [directory stringByAppendingPathComponent:@"launch-layout.json"] : nil;
}

+ (BOOL)switchedOff {
  return SwitchedOffByEnvironment();
}

+ (void)noteLayoutChangeIn:(NSWindow *)window {
  if (!gLayoutPath || gRecordQueued || !window) return;
  ArdiaCoreWindowController *controller = [ArdiaCoreWindowController forNSWindow:window];
  if (!controller.appWindowId.length || controller.stray || controller.standalone) return;
  gRecordQueued = YES;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRecordDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{ Record(NO); });
}

+ (void)recordNow {
  Record(YES);
}

+ (void)prefetchForSession:(NSDictionary *)session {
  NSString *focused = [session[@"focusedWindowId"] isKindOfClass:NSString.class] ? session[@"focusedWindowId"] : nil;
  if (!focused.length || !gLayoutPath || gPrefetch) return;
  gPrefetch = dispatch_group_create();
  gPrefetchedWindow = [focused copy];
  NSString *path = PicturePath(focused);
  dispatch_group_async(gPrefetch, dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0), ^{
    CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:path], nullptr);
    if (!source) return;
    CGImageRef encoded = CGImageSourceCreateImageAtIndex(source, 0, nullptr);
    CFRelease(source);
    if (!encoded) return;
    CGImageRef decoded = DecodeOutsideHeap(encoded);
    CGImageRelease(encoded);
    os_unfair_lock_lock(&gPrefetchLock);
    const BOOL keep = !gPrefetchDiscarded;
    if (keep) gPrefetched = decoded;
    os_unfair_lock_unlock(&gPrefetchLock);
    if (!keep) CGImageRelease(decoded);
  });
}

+ (void)discardPrefetch {
  os_unfair_lock_lock(&gPrefetchLock);
  gPrefetchDiscarded = YES;
  CGImageRef image = gPrefetched;
  gPrefetched = nullptr;
  os_unfair_lock_unlock(&gPrefetchLock);
  CGImageRelease(image);
}

+ (BOOL)canShowWindow:(NSString *)windowId session:(NSDictionary *)session {
  if (!gLayoutPath || !windowId.length || Shown().count) return NO;
  LoadLayouts();
  NSDictionary *layout = gLayouts[windowId];
  NSString *state = StateOf(session, windowId);
  if (![layout isKindOfClass:NSDictionary.class] || !state || ![layout[@"state"] isEqual:state]) return NO;
  NSString *content = ContentOf(session, windowId);
  gPictureCurrent = content.length && [layout[@"pictureContent"] isEqual:content];
  NSDictionary *hint = [session[@"launchTab"] isKindOfClass:NSDictionary.class] ? session[@"launchTab"] : nil;
  gLaunchURL = [hint[@"url"] isKindOfClass:NSString.class] ? [hint[@"url"] copy] : nil;
  return YES;
}

+ (void)forgetPicturesNow {
  [self forgetPictures];
  dispatch_sync(Writer(), ^{});
}

+ (BOOL)holdsPage:(ArdiaCoreTab *)tab {
  if (!tab) return NO;
  for (ACEarlyShown *s in Shown())
    if (s.tab == tab && !s.claimed && tab.view.superview == s.cover) return YES;
  return NO;
}

+ (void)forgetPictures {
  NSString *directory = gDirectory;
  if (!directory.length) return;
  gLayouts = [NSMutableDictionary dictionary];
  gScheduled = nil;
  [self discardPrefetch];
  dispatch_async(Writer(), ^{
    NSFileManager *fm = NSFileManager.defaultManager;
    for (NSString *name in [fm contentsOfDirectoryAtPath:directory error:nil])
      if (([name hasPrefix:@"launch-picture-"] && [name hasSuffix:@".png"]) || [name isEqualToString:@"launch-layout.json"] ||
          [name isEqualToString:@"launch-look.json"])
        [fm removeItemAtPath:[directory stringByAppendingPathComponent:name] error:nil];
  });
}

+ (BOOL)showWindow:(NSString *)windowId
             frame:(NSArray<NSNumber *> *)frame
               key:(NSString *)key
           profile:(NSString *)profile
          backdrop:(NSDictionary *)backdrop {
  CGImageRef picture = TakePrefetched(windowId);
  BOOL shown = [self showWindow:windowId frame:frame key:key profile:profile backdrop:backdrop picture:picture];
  if (picture) CGImageRelease(picture);
  return shown;
}

+ (BOOL)showWindow:(NSString *)windowId
             frame:(NSArray<NSNumber *> *)frame
               key:(NSString *)key
           profile:(NSString *)profile
          backdrop:(NSDictionary *)backdrop
           picture:(CGImageRef)picture {
  if (!gLayoutPath || !windowId.length || !key.length || frame.count != 4 || (Shown().count && !gLittleLayout)) return NO;
  Class backdropClass = NSClassFromString(@"ArdiaEarlyBackdrop");
  const SEL make = NSSelectorFromString(@"make:");
  if (![backdropClass respondsToSelector:make]) return NO;
  NSDictionary *layout = gLittleLayout ?: gLayouts[windowId];
  if (![layout isKindOfClass:NSDictionary.class]) return NO;
  for (int i = 0; i < 4; i++)
    if (![frame[i] isKindOfClass:NSNumber.class] || !std::isfinite(frame[i].doubleValue)) return NO;
  const NSRect rect = NSMakeRect(frame[0].doubleValue, frame[1].doubleValue, frame[2].doubleValue, frame[3].doubleValue);
  if (NSWidth(rect) < 300 || NSHeight(rect) < 200) return NO;
  NSWindow *window = [ACChromeWindowHost makeWindowForProfile:profile ?: @""];
  ArdiaCoreWindowController *controller = [ArdiaCoreWindowController forNSWindow:window];
  NSView *host = controller.coreWindow.hostView;
  if (!window || !host) {
    if (window) [ACChromeWindowHost closeWindow:window];
    return NO;
  }
  controller.appWindowId = windowId;
  [window setFrame:rect display:NO];
  if (NSScreen *screen = window.screen ?: NSScreen.mainScreen) [window setFrame:[window constrainFrameRect:window.frame toScreen:screen] display:NO];
  if ([layout[@"appearance"] isKindOfClass:NSString.class]) window.appearance = [NSAppearance appearanceNamed:layout[@"appearance"]];
  [host layoutSubtreeIfNeeded];
  NSView *backdropView = ((NSView * (*)(id, SEL, NSDictionary *)) objc_msgSend)(backdropClass, make, backdrop);
  NSRect pageRect = NSZeroRect;
  NSView *cover = backdropView ? Cover(host, layout, &pageRect) : nil;
  if (!cover) {
    [ACChromeWindowHost closeWindow:window];
    return NO;
  }
  backdropView.frame = host.bounds;
  backdropView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [host addSubview:backdropView positioned:NSWindowBelow relativeTo:cover];
  ApplyLights(window, layout);
  ACEarlyShown *s = [ACEarlyShown new];
  s.window = window;
  s.appWindow = windowId;
  s.profile = profile ?: @"";
  s.cover = cover;
  s.key = key;
  s.pageRect = pageRect;
  s.backdrop = backdropView;
  NSArray *size = layout[@"size"];
  const BOOL sameSize = [size isKindOfClass:NSArray.class] && size.count == 2 && fabs([size[0] doubleValue] - NSWidth(window.frame)) < 0.5 &&
                        fabs([size[1] doubleValue] - NSHeight(window.frame)) < 0.5;
  if (picture && sameSize && gPictureCurrent && (!layout[@"glass"] || AddLiveGlass(layout[@"glass"], host, backdropView))) {
    NSView *view = [[NSView alloc] initWithFrame:host.bounds];
    view.wantsLayer = YES;
    view.layer.contents = (__bridge id)picture;
    view.layer.contentsGravity = kCAGravityResize;
    view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [host addSubview:view positioned:NSWindowBelow relativeTo:cover];
    s.picture = view;
  }
  [Shown() addObject:s];
  __weak ACEarlyShown *weakShown = s;
  s.closeObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                                     object:window
                                                                      queue:nil
                                                                 usingBlock:^(NSNotification *) {
                                                                   ACEarlyShown *closing = weakShown;
                                                                   if (!closing) return;
                                                                   if (!closing.claimed) {
                                                                     [Dismissed() addObject:closing.appWindow];
                                                                     ArdiaCoreTab *page = closing.tab;
                                                                     if (page && page == ArdiaCoreTabParking.launchTab)
                                                                       [ArdiaCoreTabParking claimLaunchTab:@"" url:@"" profile:@""];
                                                                     else if (page && closing.expectedURL) {
                                                                       [Dismissed() addObject:closing.key];
                                                                       [ArdiaCoreTabParking dismissLinkTab:page];
                                                                     }
                                                                     else if (page)
                                                                       [ArdiaCoreWebView releaseTransfer:closing.key];
                                                                   }
                                                                   DropPictures(closing);
                                                                   Forget(closing);
                                                                 }];
  [window makeKeyAndOrderFront:nil];
  [window displayIfNeeded];
  [CATransaction flush];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kUnclaimedSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ACEarlyShown *still = weakShown;
    if (!still || still.claimed || ![Shown() containsObject:still]) return;
    if (still.tab) still.expired = YES;
    else Abandon(still);
  });
  return YES;
}

+ (void)attachPage:(ArdiaCoreTab *)tab key:(NSString *)key {
  if (!tab || tab.closed || !key.length) return;
  for (ACEarlyShown *s in Shown()) {
    if (!s.cover || s.tab || ![s.key isEqualToString:key]) continue;
    NSView *page = tab.view;
    if (!page) return;
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    [page removeFromSuperview];
    page.frame = s.pageRect;
    [s.cover addSubview:page];
    [CATransaction commit];
    s.tab = tab;
    if (!ShowsLaunchOrigin(tab, s.expectedURL ?: gLaunchURL)) Shield(s);
    return;
  }
}

+ (BOOL)showLittleWindowForLink:(ArdiaCoreTab *)tab
                           mark:(NSString *)mark
                            url:(NSString *)url
                          frame:(NSArray<NSNumber *> *)frame
                        profile:(NSString *)profile
                       backdrop:(NSDictionary *)backdrop
                           like:(NSString *)windowId {
  if (!gLayoutPath || !tab || tab.closed || !url.length || !mark.length) return NO;
  for (ACEarlyShown *s in Shown())
    if ([s.appWindow isEqualToString:kLittleWindow]) return NO;
  LoadLayouts();
  NSDictionary *main = windowId.length && [gLayouts[windowId] isKindOfClass:NSDictionary.class] ? gLayouts[windowId] : @{};
  NSMutableDictionary *layout = [@{
    @"page" : @[ @6, @38, @6, @6 ],
    @"card" : @[ @6, @38, @6, @6 ],
    @"radius" : [main[@"radius"] isKindOfClass:NSNumber.class] ? main[@"radius"] : @10,
    @"curve" : [main[@"curve"] isKindOfClass:NSString.class] ? main[@"curve"] : kCACornerCurveCircular,
    @"lights" : @[ @20, @19 ],
  } mutableCopy];
  if ([main[@"appearance"] isKindOfClass:NSString.class]) layout[@"appearance"] = main[@"appearance"];
  gLittleLayout = layout;
  const BOOL shown = [self showWindow:kLittleWindow frame:frame key:mark profile:profile backdrop:backdrop picture:nullptr];
  gLittleLayout = nil;
  if (!shown) return NO;
  ACEarlyShown *little = Shown().lastObject;
  little.window.identifier = @"ardia.window.small";
  little.expectedURL = url;
  [self attachPage:tab key:mark];
  if (little.tab == tab && !little.inputBlock) {
    BOOL answered = NO;
    little.inputBlock = TabCall(tab, @"suppressInput", &answered);
    ReleaseFocusFrom(tab.view);
  }
  __weak ACEarlyShown *weakLittle = little;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kUnclaimedSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ACEarlyShown *still = weakLittle;
    if (still && !still.claimed && [Shown() containsObject:still]) Abandon(still);
  });
  return YES;
}

+ (NSWindow *)claimLittleWindowForLink:(NSString *)mark profile:(NSString *)profile {
  BOOL pending = NO;
  for (ACEarlyShown *s in Shown())
    if ([s.appWindow isEqualToString:kLittleWindow] && !s.claimed && [s.key isEqualToString:mark]) pending = YES;
  if (!pending) return nil;
  NSWindow *window = [self claimForAppWindow:kLittleWindow profile:profile];
  if (window) [ArdiaCoreWindowController forNSWindow:window].appWindowId = nil;
  return window;
}

+ (NSWindow *)claimForAppWindow:(NSString *)windowId profile:(NSString *)profile {
  if (!windowId.length) return nil;
  for (ACEarlyShown *s in [Shown() copy]) {
    if (s.claimed || ![s.appWindow isEqualToString:windowId]) continue;
    NSWindow *window = s.window;
    if (!window || ![ArdiaCoreWindowController forNSWindow:window]) {
      Abandon(s);
      return nil;
    }
    s.claimed = YES;
    window.appearance = nil;
    if (![s.profile isEqualToString:profile ?: @""]) {
      DropPictures(s);
      Forget(s);
      return window;
    }
    __weak ACEarlyShown *weakShown = s;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kClaimedSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      ACEarlyShown *late = weakShown;
      if (late && [Shown() containsObject:late]) Forget(late);
    });
    return window;
  }
  return nil;
}

+ (BOOL)takeDismissed:(NSString *)windowId {
  if (!windowId.length || ![Dismissed() containsObject:windowId]) return NO;
  [Dismissed() removeObject:windowId];
  return YES;
}

+ (NSView *)coverInWindow:(NSWindow *)window {
  return ShownForWindow(window).cover;
}

+ (void)rootEmbedded:(NSView *)root inWindow:(NSWindow *)window {
  ACEarlyShown *s = ShownForWindow(window);
  if (!root || !s) return;
  if (s.rootFillCleared && s.root != root) {
    [s.root setValue:s.rootFill forKey:@"backgroundColor"];
    s.root.alphaValue = 1;
    s.rootFillCleared = NO;
    s.rootFill = nil;
  }
  s.root = root;
  ClearRootFill(s, root);
  if (s.contentObserver) [NSNotificationCenter.defaultCenter removeObserver:s.contentObserver];
  __weak ACEarlyShown *weakShown = s;
  s.contentObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:@"RCTContentDidAppearNotification"
                  object:root
                   queue:nil
              usingBlock:^(NSNotification *) {
                ACEarlyShown *shown = weakShown;
                if (!shown) return;
                [NSNotificationCenter.defaultCenter removeObserver:shown.contentObserver];
                shown.contentObserver = nil;
                if (!shown.tab) DropCover(shown);
                HandOffPictures(shown);
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kUntakenAfterContentSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                  ACEarlyShown *later = weakShown;
                  if (later && [Shown() containsObject:later]) Forget(later);
                });
              }];
}

+ (void)pageMoved:(ArdiaCoreTab *)tab {
  if (!tab) return;
  if (ACEarlyVeil *veil = [Veils() objectForKey:tab]) {
    PlaceVeil(tab, veil);
    Reconcile(tab);
  }
  for (ACEarlyShown *s in [Shown() copy]) {
    if (s.tab != tab || tab.view.superview == s.cover) continue;
    if (s.claimed) Forget(s);
    else if (s.expired) Abandon(s);
    else DropCover(s);
  }
}

+ (BOOL)veils:(ArdiaCoreTab *)tab {
  return tab && [Veils() objectForKey:tab] != nil;
}

+ (void)requestFocus:(ArdiaCoreTab *)tab {
  if (tab) [Veils() objectForKey:tab].restoreFocus = YES;
}

+ (void)page:(ArdiaCoreTab *)tab shownURL:(NSString *)url {
  if (!tab) return;
  ACEarlyVeil *veil = [Veils() objectForKey:tab];
  if (veil && ![veil.lastShown ?: @"" isEqualToString:url ?: @""]) {
    veil.lastShown = url;
    veil.changedAt = CACurrentMediaTime();
    ACPageEmits *emits = EmitsOf(tab);
    const BOOL unknown = url.length && ![emits.current containsObject:url] && ![emits.older containsObject:url];
    if (unknown && !emits.forgot && emits.firstEmitAt > 0 && veil.changedAt > emits.firstEmitAt) {
      const BOOL armed = veil.armedGeneration == emits.generation && veil.armedShown;
      veil.armedGeneration = emits.generation;
      veil.armedShown = url;
      if (!armed) WatchVeil(tab, veil, kVeilFailSafeSeconds);
    } else {
      veil.armedShown = nil;
    }
  }
  const BOOL veiled = veil != nil;
  if (!veiled && ![Watched() containsObject:tab]) return;
  if (tab.closed) {
    [Watched() removeObject:tab];
    return Unveil(tab);
  }
  const BOOL matches = ShownMatches(url, tab);
  if (veiled) {
    if (matches) Unveil(tab);
    return;
  }
  if (!url.length) return;
  if (!matches) {
    [Watched() removeObject:tab];
    return CarryShield(tab, nil, url);
  }
  if (!tab.loading) [Watched() removeObject:tab];
}

+ (void)pageCommitted:(ArdiaCoreTab *)tab shownURL:(NSString *)url {
  if (!tab) return;
  ACPageEmits *emits = EmitsOf(tab);
  for (NSString *each in emits.current) Archive(emits, each);
  emits.generation++;
  [emits.current removeAllObjects];
  emits.firstEmitAt = 0;
  if (NSString *visible = tab.url; visible.length) [emits.current addObject:visible];
  if (ACEarlyVeil *veil = [Veils() objectForKey:tab]) {
    veil.armedShown = nil;
    return Reconcile(tab);
  }
  if (!url.length || PageVeilOff() || ShownMatches(url, tab)) return;
  CarryShield(tab, nil, url);
}

+ (void)page:(ArdiaCoreTab *)tab emitted:(NSString *)url {
  if (!tab || !url) return;
  ACPageEmits *emits = EmitsOf(tab);
  if (!emits.firstEmitAt) emits.firstEmitAt = CACurrentMediaTime();
  if ([emits.current containsObject:url]) return;
  [emits.current addObject:url];
  while (emits.current.count > kOlderEmitsKept) {
    Archive(emits, emits.current.firstObject);
    [emits.current removeObjectAtIndex:0];
  }
  if ([Veils() objectForKey:tab]) Reconcile(tab);
}

+ (void)pageNavigated:(ArdiaCoreTab *)tab launchURL:(NSString *)launchURL {
  if (!tab) return;
  for (ACEarlyShown *s in Shown())
    if (s.tab == tab && !s.shielded && tab.view.superview == s.cover && !ShowsLaunchOrigin(tab, launchURL)) Shield(s);
}

+ (void)dropPage:(ArdiaCoreTab *)tab {
  if (!tab) return;
  [Watched() removeObject:tab];
  Unveil(tab);
  for (ACEarlyShown *s in [Shown() copy])
    if (s.tab == tab) {
      if (s.claimed) Forget(s);
      else if (s.expired) Abandon(s);
      else DropCover(s);
    }
}

@end
