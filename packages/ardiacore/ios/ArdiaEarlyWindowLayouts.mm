#import "ArdiaEarlyWindowInternal.h"
#import "ArdiaSavedDocument.h"
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

constexpr int kLayoutVersion = 3;

constexpr CGFloat kMinPage = 100;

}

namespace ardia_early_window {

NSString *StateOf(ArdiaSavedSession *session, NSString *windowId) {
  NSDictionary *settings = session.settings;
  NSDictionary *window = [session windowWithId:windowId];
  if (!window) return nil;
  NSMutableDictionary *state = [NSMutableDictionary dictionary];
  for (NSString *key in @[ @"tabLayout", @"addressBar", @"sidebarWidth", @"bookmarksBar", @"appearance", @"hideToolbarWhileScrolling", @"showFullUrl" ])
    if (settings[key]) state[[@"s." stringByAppendingString:key]] = settings[key];
  if ([settings[@"compactToolbar"] isEqual:@YES]) state[@"s.compactToolbar"] = @YES;
  for (NSString *key in @[ @"sidebarOpen", @"tabLayout", @"profileId", @"incognito" ])
    if (window[key]) state[[@"w." stringByAppendingString:key]] = window[key];
  NSData *data = [NSJSONSerialization dataWithJSONObject:state options:NSJSONWritingSortedKeys error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
}

NSString *ContentOf(ArdiaSavedSession *session, NSString *windowId) {
  NSDictionary *window = [session windowWithId:windowId];
  if (!window) return nil;
  NSMutableDictionary *tabs = [NSMutableDictionary dictionary];
  for (NSDictionary *t in session.tabs)
    if ([t[@"windowId"] isEqual:windowId] && [t[@"id"] isKindOfClass:NSString.class])
      tabs[t[@"id"]] = @[ t[@"title"] ?: NSNull.null, t[@"customTitle"] ?: NSNull.null, t[@"url"] ?: NSNull.null, t[@"favicon"] ?: NSNull.null,
                          t[@"customIcon"] ?: NSNull.null, [session pinOfTab:t] ?: NSNull.null, t[@"muted"] ?: NSNull.null ];
  NSMutableArray *groups = [NSMutableArray array];
  for (NSDictionary *g in session.groups)
    if ([g[@"windowId"] isEqual:windowId]) [groups addObject:g];
  NSDictionary *content = @{
    @"window" : window,
    @"tabs" : tabs,
    @"groups" : groups,
    @"profiles" : session.profiles ?: NSNull.null,
    @"settings" : session.settings,
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:content options:NSJSONWritingSortedKeys error:nil];
  if (!data) return nil;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  NSMutableString *hex = [NSMutableString string];
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [hex appendFormat:@"%02x", digest[i]];
  return hex;
}

}

namespace {

NSArray<NSNumber *> *Insets(NSRect rect, NSView *host) {
  const NSRect bounds = host.bounds;
  const CGFloat top = host.isFlipped ? NSMinY(rect) : NSMaxY(bounds) - NSMaxY(rect);
  const CGFloat bottom = host.isFlipped ? NSMaxY(bounds) - NSMaxY(rect) : NSMinY(rect);
  return @[ @(round(NSMinX(rect) * 2) / 2), @(round(top * 2) / 2), @(round((NSMaxX(bounds) - NSMaxX(rect)) * 2) / 2), @(round(bottom * 2) / 2) ];
}

}

namespace ardia_early_window {

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

}

namespace {

NSDictionary *WindowLayout(ArdiaWindowController *controller, ArdiaSavedSession *session) {
  NSWindow *window = controller.coreWindow.window;
  NSView *host = controller.coreWindow.hostView;
  if (!window.visible || !host || !controller.root || (window.styleMask & NSWindowStyleMaskFullScreen)) return nil;
  if ([window.identifier isEqualToString:@"ardia.window.small"] || ShownForWindow(window)) return nil;
  NSString *state = StateOf(session, controller.appWindowId);
  if (!state) return nil;
  NSMutableArray<NSView *> *pending = [NSMutableArray arrayWithObject:controller.root];
  NSMutableArray<ArdiaWebView *> *shown = [NSMutableArray array];
  for (NSUInteger i = 0; i < pending.count && i < 4000; i++) {
    NSView *view = pending[i];
    if ([view isKindOfClass:ArdiaWebView.class]) {
      ArdiaWebView *web = (ArdiaWebView *)view;
      if (web.visible && web.browserId && !web.hiddenOrHasHiddenAncestor && web.alphaValue > 0) [shown addObject:web];
      continue;
    }
    [pending addObjectsFromArray:view.subviews];
  }
  if (shown.count != 1) return nil;
  ArdiaWebView *web = shown[0];
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
  if (NSValue *lights = ArdiaTrafficLightsCenter(window)) layout[@"lights"] = @[ @(lights.pointValue.x), @(lights.pointValue.y) ];
  if (window.appearance.name) layout[@"appearance"] = window.appearance.name;
  if (NSColor *color = [web.pageBackgroundColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace])
    layout[@"pageColor"] = @[ @(color.redComponent), @(color.greenComponent), @(color.blueComponent), @(color.alphaComponent) ];
  return layout;
}

}

namespace ardia_early_window {

void LoadLayouts() {
  if (gLayouts || !gLayoutPath) return;
  gLayouts = [NSMutableDictionary dictionary];
  NSData *data = [NSData dataWithContentsOfFile:gLayoutPath];
  NSDictionary *file = [ArdiaSavedDocument parse:data oldest:kLayoutVersion newest:kLayoutVersion];
  if (!file) return;
  if ([file[@"windows"] isKindOfClass:NSDictionary.class])
    for (NSString *key in file[@"windows"])
      if ([key isKindOfClass:NSString.class] && [file[@"windows"][key] isKindOfClass:NSDictionary.class]) gLayouts[key] = file[@"windows"][key];
  gScheduled = data;
}

}

namespace {

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

NSString *ActiveTabOf(ArdiaSavedSession *session, NSString *windowId) {
  NSDictionary *w = [session windowWithId:windowId];
  NSDictionary *active = [w[@"activeTabIds"] isKindOfClass:NSDictionary.class] ? w[@"activeTabIds"] : nil;
  id tab = [w[@"profileId"] isKindOfClass:NSString.class] ? active[w[@"profileId"]] : nil;
  return [tab isKindOfClass:NSString.class] ? tab : nil;
}

void RecordLayouts(ArdiaSavedSession *session, BOOL wait) {
  LoadLayouts();
  NSMutableSet *saved = [NSMutableSet set];
  for (NSDictionary *w in session.windows)
    if ([w[@"id"] isKindOfClass:NSString.class]) [saved addObject:w[@"id"]];
  NSMutableSet *live = [NSMutableSet set];
  for (ArdiaWindowController *controller in ArdiaWindowController.all) {
    NSString *windowId = controller.appWindowId;
    if (!windowId.length || controller.stray || controller.standalone) continue;
    [live addObject:windowId];
    NSMutableDictionary *layout = [WindowLayout(controller, session) mutableCopy];
    if (!layout) continue;
    if (wait) {
      NSString *active = ActiveTabOf(session, windowId);
      if (active && [layout[@"tab"] isEqual:active] && CapturePicture(controller, windowId, layout)) layout[@"pictureContent"] = layout[@"content"];
      else DropPictureFile(windowId);
    } else if ([gLayouts[windowId][@"pictureContent"] isKindOfClass:NSString.class] && !gLayouts[windowId][@"glass"]) {
      layout[@"pictureContent"] = gLayouts[windowId][@"pictureContent"];
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

}

namespace ardia_early_window {

void Record(BOOL wait) {
  gRecordQueued = NO;
  if (!gDirectory.length) return;
  ArdiaSavedSession *session = [ArdiaSavedSession readFrom:gDirectory];
  if ([session.settings[@"restoreSession"] isEqual:@NO])
    [ArdiaEarlyWindow forgetPictures];
  else if (gLayoutPath && session)
    RecordLayouts(session, wait);
  if (wait) dispatch_sync(Writer(), ^{});
}

}
