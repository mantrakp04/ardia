#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaFieldTiming.h"
#import "ArdiaHost.h"
#import "ArdiaPictureInPicture.h"
#import "ArdiaServices.h"

#import <objc/runtime.h>

#include <climits>
#include <cmath>

using namespace ardia_web_view;
using namespace ardia_runtime;

namespace {

NSDictionary *SelectionState(NSDictionary *d) {
  NSString *text = Text(d, @"text", 4000);
  NSDictionary *rect = Field<NSDictionary>(d, @"rect");
  double x, y, width, height;
  if (!text || !Finite(rect, @"x", &x) || !Finite(rect, @"y", &y) || !Finite(rect, @"width", &width) ||
      !Finite(rect, @"height", &height))
    return nil;
  return @{@"text" : text, @"rect" : @{@"x" : @(x), @"y" : @(y), @"width" : @(width), @"height" : @(height)}};
}

BOOL gDisplayMediaPicker = NO;
}

static BOOL gSelectionPopover = YES;
static char kScriptFramesKey;

static NSDictionary *DisplayMediaAudioOffer(NSDictionary *message) {
  if (!Flag(message, @"audio")) return nil;
  NSDictionary *support = ArdiaCoreEngine.desktopCaptureAudio;
  const bool system = Flag(support, @"system"), application = Flag(support, @"application");
  NSString *preference = Text(message, @"windowAudio", 16);
  NSString *window = nil;
  if ([preference isEqualToString:@"window"])
    window = application ? @"application" : system ? @"system" : nil;
  else if ([preference isEqualToString:@"system"])
    window = system ? @"system" : nil;
  return @{@"tab" : @YES, @"screen" : @(system && Flag(message, @"systemAudio")), @"window" : window ?: NSNull.null};
}

static NSString *DisplayMediaAudioFor(NSDictionary *offer, NSString *sourceId) {
  if ([sourceId hasPrefix:@"screen:"]) return Flag(offer, @"screen") ? @"system" : nil;
  if ([sourceId hasPrefix:@"window:"]) return Field<NSString>(offer, @"window");
  if ([sourceId hasPrefix:@"web-contents-media-stream://"]) return Flag(offer, @"tab") ? @"tab" : nil;
  return nil;
}

namespace ardia_web_view {

void AnswerHello(ArdiaCoreTab *tab, NSString *profile, NSString *frameId, BOOL main, NSString *verifiedOrigin) {
  NSString *origin = (main ? VerifiedOrigin(verifiedOrigin) : nil) ?: OriginOf(tab.url);
  __weak ArdiaCoreTab *weakTab = tab;
  void (^answer)(BOOL) = ^(BOOL blockAutoplay) {
    ArdiaCoreTab *to = weakTab;
    if (!frameId.length || !to) return;
    NSMutableDictionary *config = [NSMutableDictionary dictionary];
    if (blockAutoplay) config[@"blockAutoplay"] = @YES;
    if (gDisplayMediaPicker) config[@"displayMediaPicker"] = @YES;
    if (main && ArdiaFieldTimingEnabled()) config[@"fieldTiming"] = @YES;
    if (main) config[@"selectionPopover"] = @(gSelectionPopover);
    config[@"peek"] = gPeekModifier;
    config[@"split"] = SplitLinkModifier();
    config[@"peekOtherSites"] = @([ArdiaTabRegistry viewForTab:to].peeksLinksToOtherSites);
    if (PeekTracing()) config[@"peekTrace"] = @YES;
    if (TracingPictureInPicture()) config[@"pipTrace"] = @YES;
    [to callFrame:frameId kind:@"config" json:JSONText(config)];
  };
  if (origin && [origin hasPrefix:@"http"])
    [ArdiaServices siteSettings:profile ?: @"" origin:origin reply:^(NSDictionary *settings, NSString *) {
      NSDictionary *autoplay = [settings[@"autoplay"] isKindOfClass:NSDictionary.class] ? settings[@"autoplay"] : nil;
      answer([autoplay[@"value"] isEqual:@"block"]);
    }];
  else
    answer(NO);
}

NSMutableOrderedSet<NSString *> *ScriptFramesOf(ArdiaCoreTab *tab) {
  if (!tab) return nil;
  NSMutableOrderedSet *frames = objc_getAssociatedObject(tab, &kScriptFramesKey);
  if (!frames) {
    frames = [NSMutableOrderedSet orderedSet];
    objc_setAssociatedObject(tab, &kScriptFramesKey, frames, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  return frames;
}
}

@implementation ArdiaWebView (PageMessages)

+ (void)setDisplayMediaPicker:(BOOL)enabled {
  gDisplayMediaPicker = enabled;
}

+ (void)setSelectionPopoverEnabled:(BOOL)enabled {
  if (enabled == gSelectionPopover) return;
  gSelectionPopover = enabled;
  for (ArdiaWebView *view in LiveViews().allObjects) [view pushSelectionPopover];
}

- (void)tab:(ArdiaCoreTab *)tab
    didReceivePageMessage:(NSString *)kind
                     json:(NSString *)json
                    frame:(NSString *)frameId
                     main:(BOOL)main
                   origin:(NSString *)verifiedOrigin {
  NSString *sender = VerifiedOrigin(verifiedOrigin) ?: (main ? OriginOf(tab.url) : nil);
  id data = JSONObject(json);
  NSDictionary *dict = [data isKindOfClass:NSDictionary.class] ? data : nil;
  frameId = frameId ?: @"";
  if ([kind isEqualToString:@"hello"]) {
    PeekTrace(@{@"event" : @"hello", @"main" : @(main), @"frame" : frameId ?: @"", @"url" : Text(dict, @"url", 8192) ?: @""});
    if (main && !tab.discarded) [self resetPageMedia];
    if (main && ![(Text(dict, @"url", 8192) ?: @"about:") hasPrefix:@"about:"]) _requests.requestedURL = nil;
    [self noteScriptFrame:frameId main:main];
    [self callFrame:frameId kind:@"peekConfig" json:PeekConfigJSON(self)];
    AnswerHello(tab, _profile, frameId, main, verifiedOrigin);
    if (main && _littlePage.held) [self callFrame:frameId kind:@"firstPaint" json:@"{}"];
  } else if ([kind isEqualToString:@"firstPaint"] && main) {
    NSString *url = Text(dict, @"url", 8192);
    if (url.length && ![url hasPrefix:@"about:"] && SamePage(url, tab.url)) [self revealLittlePage:YES];
  } else if ([kind isEqualToString:@"peek"] && dict) {
    [self peekLink:dict frame:frameId main:main];
  } else if ([kind isEqualToString:@"peekHello"]) {
    [self noteScriptFrame:frameId main:main];
    [self callFrame:frameId kind:@"peekConfig" json:PeekConfigJSON(self)];
  } else if ([kind isEqualToString:@"peekGone"]) {
    [self forgetScriptFrame:frameId];
  } else if ([kind isEqualToString:@"commandWheel"] && dict) {
    [self commandWheelFromPage:dict];
  } else if ([kind isEqualToString:@"peekTrace"] && dict) {
    PeekTrace(@{@"event" : @"page", @"main" : @(main), @"page" : dict});
  } else if ([kind isEqualToString:@"selection"] && main) {
    [self emit:@"selection" payload:@{@"selection" : SelectionState(dict) ?: NSNull.null}];
  } else if ([kind isEqualToString:@"linkDrop"] && main) {
    NSString *url = Text(dict, @"url", 8192);
    NSString *scheme = (url.length ? [NSURL URLWithString:url].scheme.lowercaseString : nil) ?: @"";
    const CFTimeInterval now = CACurrentMediaTime();
    const CGEventSourceStateID state = kCGEventSourceStateCombinedSessionState;
    const double sinceUp = CGEventSourceSecondsSinceLastEventType(state, kCGEventLeftMouseUp);
    const BOOL released = !(NSEvent.pressedMouseButtons & 1) && sinceUp < 1 &&
                          sinceUp <= CGEventSourceSecondsSinceLastEventType(state, kCGEventLeftMouseDragged);
    const NSPoint mouse = NSEvent.mouseLocation;
    NSWindow *window = self.window;
    const BOOL over = window && [NSWindow windowNumberAtPoint:mouse belowWindowWithWindowNumber:0] == window.windowNumber &&
                      NSPointInRect([self convertPoint:[window convertPointFromScreen:mouse] fromView:nil], self.bounds);
    if (_visible && [@[ @"http", @"https" ] containsObject:scheme] && released && over && now - _linkDropAt > 1) {
      _linkDropAt = now;
      [self emit:@"openWindow" payload:@{@"url" : url, @"disposition" : @"foreground", @"userGesture" : @YES}];
    }
  } else if ([kind isEqualToString:@"perf"] && main && ArdiaFieldTimingEnabled()) {
    for (NSString *what in @[ @"fcp", @"shown" ]) {
      NSNumber *at = [dict[what] isKindOfClass:NSNumber.class] ? dict[what] : nil;
      if (at && fabs(at.doubleValue - ArdiaFieldNow()) < 600000) ArdiaFieldMark(_transferKey, what, at.doubleValue);
    }
  } else if ([kind isEqualToString:@"scroll"] && main) {
    NSString *state = Text(dict, @"state", 8);
    if ([@[ @"down", @"up", @"top" ] containsObject:state ?: @""])
      [self emit:@"scroll" payload:@{@"state" : state}];
  } else if ([kind isEqualToString:@"drm"] && dict) {
    [self emit:@"protectedMedia" payload:@{@"keySystem" : Text(dict, @"keySystem", 64) ?: @"", @"main" : @(main)}];
  } else if ([kind isEqualToString:@"nowPlaying"]) {
    if (!_reports.nowPlaying) _reports.nowPlaying = [ArdiaNowPlaying new];
    NSDictionary *state = [_reports.nowPlaying noteFrame:frameId page:dict main:main];
    [self emit:@"nowPlaying" payload:@{@"state" : state ?: NSNull.null}];
  } else if ([kind isEqualToString:@"theme"]) {
    if (!main || !dict) return;
    NSString *color = [dict[@"color"] isKindOfClass:NSString.class] ? Text(dict, @"color", 64) : nil;
    NSString *source = [dict[@"source"] isKindOfClass:NSString.class] ? Text(dict, @"source", 32) : nil;
    _reports.theme = color;
    _reports.themeSource = source;
    [self queueNavigation];
  } else if ([kind isEqualToString:@"pinch"] && main && dict) {
    double scale;
    if (!Finite(dict, @"scale", &scale) || scale <= 0) return;
    _reports.pinchScale = MIN(scale, 100);
    [self emitZoom];
  } else if ([kind isEqualToString:@"pipTrace"]) {
    if (TracingPictureInPicture())
      [_tab tracePictureInPicture:[NSString stringWithFormat:@"page (%@): %@", main ? @"main frame" : @"subframe", JSONText(dict ?: @{})]
                       withInputs:NO];
  } else if ([kind isEqualToString:@"notification"] && dict) {
    PeekTrace(@{@"event" : @"notification", @"bytes" : @(json.length), @"origin" : sender ?: @""});
    NSString *nid = Text(dict, @"id", 128);
    NSString *origin = sender;
    if (!nid.length || !Text(dict, @"title", 1024) || !origin) return;
    if (!_reports.notificationFrames || _reports.notificationFrames.count > 500) _reports.notificationFrames = [NSMutableDictionary dictionary];
    _reports.notificationFrames[nid] = frameId;
    NSDictionary *notification = @{
      @"id" : nid,
      @"title" : Text(dict, @"title", 1024),
      @"body" : Text(dict, @"body", 4096) ?: @"",
      @"icon" : Text(dict, @"icon", 1 << 20) ?: NSNull.null,
      @"tag" : Text(dict, @"tag", 1024) ?: @"",
      @"silent" : @(Flag(dict, @"silent")),
      @"requireInteraction" : @(Flag(dict, @"requireInteraction")),
      @"origin" : origin,
      @"tabId" : ardia_host::AppTabIdValue(tab),
      @"isMainFrame" : @(main),
    };
    __weak ArdiaWebView *weakSelf = self;
    [ArdiaServices siteSettings:_profile ?: @"" origin:origin reply:^(NSDictionary *settings, NSString *) {
      ArdiaWebView *view = weakSelf;
      if (!view || ![view->_reports.notificationFrames[nid] isEqualToString:frameId]) return;
      NSDictionary *permission = [settings[@"notifications"] isKindOfClass:NSDictionary.class] ? settings[@"notifications"] : nil;
      if ([permission[@"value"] isEqual:@"allow"]) [view emit:@"notification" payload:notification];
      else [view notificationAction:nid action:@"close"];
    }];
  } else if ([kind isEqualToString:@"notificationClose"] && dict) {
    NSString *nid = Text(dict, @"id", 128);
    if (!nid.length) return;
    [_reports.notificationFrames removeObjectForKey:nid];
    [self emit:@"notificationClose" payload:@{@"id" : nid}];
  } else if ([kind isEqualToString:@"displayMedia"] && dict) {
    double pageId;
    if (!Finite(dict, @"id", &pageId) || pageId < 1 || pageId > INT_MAX || pageId != floor(pageId) || !sender) return;
    if (!_reports.displayRequests) _reports.displayRequests = [NSMutableDictionary dictionary];
    if (_reports.displayRequests.count >= 16) return;
    NSString *requestId = NSUUID.UUID.UUIDString;
    NSDictionary *audio = DisplayMediaAudioOffer(dict);
    _reports.displayRequests[requestId] = @{@"frame" : frameId, @"id" : @((int)pageId), @"audio" : audio ?: NSNull.null, @"origin" : sender};
    [self emit:@"displayMediaRequest"
        payload:@{
          @"id" : requestId,
          @"origin" : OriginOf(tab.url) ?: sender,
          @"frameOrigin" : sender,
          @"audio" : audio ?: NSNull.null,
          @"sources" : ArdiaHost.displayMediaSources
        }];
  }
}

- (void)noteScriptFrame:(NSString *)frameId main:(BOOL)main {
  InstallPeekMonitor();
  NSMutableOrderedSet<NSString *> *frames = ScriptFramesOf(_tab);
  if (!frames || !frameId.length) return;
  [frames removeObject:frameId];
  [frames addObject:frameId];
  while (frames.count > 512) [frames removeObjectAtIndex:0];
}

- (void)forgetScriptFrame:(NSString *)frameId {
  if (frameId.length) [ScriptFramesOf(_tab) removeObject:frameId];
}

- (void)pushSelectionPopover {
  if (_tab) [self callFrame:@"" kind:@"selectionPopover" json:gSelectionPopover ? @"true" : @"false"];
}

- (void)callFrame:(NSString *)frameId kind:(NSString *)kind json:(NSString *)json {
  if (frameId.length) [_tab callFrame:frameId kind:kind json:json];
  else [_tab callPage:kind json:json];
}

- (void)resetPageMedia {
  if ([_reports.nowPlaying reset]) [self emit:@"nowPlaying" payload:@{@"state" : NSNull.null}];
}

- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(NSString *)sourceId audio:(BOOL)shareAudio {
  NSDictionary *request = requestId ? _reports.displayRequests[requestId] : nil;
  if (!request) return;
  [_reports.displayRequests removeObjectForKey:requestId];
  NSString *audio = shareAudio && sourceId.length ? DisplayMediaAudioFor(Field<NSDictionary>(request, @"audio"), sourceId) : nil;
  if (sourceId.length && _tab)
    [ArdiaCoreEngine allowDesktopCapture:sourceId
                                  tab:_tab
                                frame:[request[@"frame"] length] ? request[@"frame"] : nil
                               origin:request[@"origin"]
                                audio:audio];
  [self callFrame:request[@"frame"] kind:@"displayMedia"
             json:JSONText(@{@"id" : request[@"id"], @"sourceId" : sourceId.length ? sourceId : NSNull.null, @"audio" : @(audio != nil)})];
}

@end
