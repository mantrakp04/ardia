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

@implementation ArdiaEarlyShown
@end

namespace {

constexpr double kRecordDelay = 1.0;

constexpr double kUnclaimedSeconds = 15;

constexpr double kClaimedSeconds = 5;

constexpr double kUntakenAfterContentSeconds = 2;

}

namespace ardia_early_window {

NSString *gLayoutPath;

NSString *gDirectory;

BOOL gRecordQueued;

NSData *gScheduled;

NSMutableDictionary<NSString *, NSDictionary *> *gLayouts;

os_unfair_lock gPrefetchLock = OS_UNFAIR_LOCK_INIT;

CGImageRef gPrefetched;

}

namespace {

BOOL gPrefetchDiscarded;

}

namespace ardia_early_window {

NSString *gPrefetchedWindow;

dispatch_group_t gPrefetch;

}

namespace {

BOOL gPictureCurrent;

}

namespace ardia_early_window {

NSString *gLaunchURL;

}

namespace {

NSDictionary *gLittleLayout;

NSString *const kLittleWindow = @"ardia.early.little-ardia";

NSMutableSet<NSString *> *Dismissed() {
  static NSMutableSet *dismissed = [NSMutableSet set];
  return dismissed;
}

}

namespace ardia_early_window {

dispatch_queue_t Writer() {
  static dispatch_queue_t queue = dispatch_queue_create("ardia.early-window.writer", DISPATCH_QUEUE_SERIAL);
  return queue;
}

NSMutableArray<ArdiaEarlyShown *> *Shown() {
  static NSMutableArray *shown = [NSMutableArray array];
  return shown;
}

ArdiaEarlyShown *ShownForWindow(NSWindow *window) {
  if (!window) return nil;
  for (ArdiaEarlyShown *s in Shown())
    if (s.window == window) return s;
  return nil;
}

}

@implementation ArdiaEarlyWindow

+ (void)setDataDirectory:(NSString *)directory {
  gDirectory = [directory copy];
  gLayoutPath = directory.length ? [directory stringByAppendingPathComponent:@"launch-layout.json"] : nil;
}

+ (void)noteLayoutChangeIn:(NSWindow *)window {
  if (!gLayoutPath || gRecordQueued || !window) return;
  ArdiaWindowController *controller = [ArdiaWindowController forNSWindow:window];
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
  for (ArdiaEarlyShown *s in Shown())
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
  NSWindow *window = [ArdiaChromeWindowHost makeWindowForProfile:profile ?: @""];
  ArdiaWindowController *controller = [ArdiaWindowController forNSWindow:window];
  NSView *host = controller.coreWindow.hostView;
  if (!window || !host) {
    if (window) [ArdiaChromeWindowHost closeWindow:window];
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
    [ArdiaChromeWindowHost closeWindow:window];
    return NO;
  }
  backdropView.frame = host.bounds;
  backdropView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [host addSubview:backdropView positioned:NSWindowBelow relativeTo:cover];
  ApplyLights(window, layout);
  ArdiaEarlyShown *s = [ArdiaEarlyShown new];
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
  __weak ArdiaEarlyShown *weakShown = s;
  s.closeObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                                     object:window
                                                                      queue:nil
                                                                 usingBlock:^(NSNotification *) {
                                                                   ArdiaEarlyShown *closing = weakShown;
                                                                   if (!closing) return;
                                                                   if (!closing.claimed) {
                                                                     [Dismissed() addObject:closing.appWindow];
                                                                     ArdiaCoreTab *page = closing.tab;
                                                                     if (page && page == ArdiaTabParking.launchTab)
                                                                       [ArdiaTabParking claimLaunchTab:@"" url:@"" profile:@""];
                                                                     else if (page && closing.expectedURL) {
                                                                       [Dismissed() addObject:closing.key];
                                                                       [ArdiaTabParking dismissLinkTab:page];
                                                                     }
                                                                     else if (page)
                                                                       [ArdiaWebView releaseTransfer:closing.key];
                                                                   }
                                                                   DropPictures(closing);
                                                                   Forget(closing);
                                                                 }];
  [window makeKeyAndOrderFront:nil];
  [window displayIfNeeded];
  [CATransaction flush];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kUnclaimedSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaEarlyShown *still = weakShown;
    if (!still || still.claimed || ![Shown() containsObject:still]) return;
    if (still.tab) still.expired = YES;
    else Abandon(still);
  });
  return YES;
}

+ (void)attachPage:(ArdiaCoreTab *)tab key:(NSString *)key {
  if (!tab || tab.closed || !key.length) return;
  for (ArdiaEarlyShown *s in Shown()) {
    if (!s.cover || s.tab || ![s.key isEqualToString:key]) continue;
    NSView *page = tab.view;
    if (!page) return;
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    [page removeFromSuperview];
    page.frame = s.pageRect;
    page.hidden = NO;
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
  for (ArdiaEarlyShown *s in Shown())
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
  ArdiaEarlyShown *little = Shown().lastObject;
  little.window.identifier = @"ardia.window.small";
  little.expectedURL = url;
  [self attachPage:tab key:mark];
  if (little.tab == tab && !little.inputBlock) {
    little.inputBlock = [tab suppressInput];
    ReleaseFocusFrom(tab.view);
  }
  __weak ArdiaEarlyShown *weakLittle = little;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kUnclaimedSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaEarlyShown *still = weakLittle;
    if (still && !still.claimed && [Shown() containsObject:still]) Abandon(still);
  });
  return YES;
}

+ (NSWindow *)claimLittleWindowForLink:(NSString *)mark profile:(NSString *)profile {
  BOOL pending = NO;
  for (ArdiaEarlyShown *s in Shown())
    if ([s.appWindow isEqualToString:kLittleWindow] && !s.claimed && [s.key isEqualToString:mark]) pending = YES;
  if (!pending) return nil;
  NSWindow *window = [self claimForAppWindow:kLittleWindow profile:profile];
  if (window) [ArdiaWindowController forNSWindow:window].appWindowId = nil;
  return window;
}

+ (NSWindow *)claimForAppWindow:(NSString *)windowId profile:(NSString *)profile {
  if (!windowId.length) return nil;
  for (ArdiaEarlyShown *s in [Shown() copy]) {
    if (s.claimed || ![s.appWindow isEqualToString:windowId]) continue;
    NSWindow *window = s.window;
    if (!window || ![ArdiaWindowController forNSWindow:window]) {
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
    __weak ArdiaEarlyShown *weakShown = s;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kClaimedSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      ArdiaEarlyShown *late = weakShown;
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
  ArdiaEarlyShown *s = ShownForWindow(window);
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
  __weak ArdiaEarlyShown *weakShown = s;
  s.contentObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:@"RCTContentDidAppearNotification"
                  object:root
                   queue:nil
              usingBlock:^(NSNotification *) {
                ArdiaEarlyShown *shown = weakShown;
                if (!shown) return;
                [NSNotificationCenter.defaultCenter removeObserver:shown.contentObserver];
                shown.contentObserver = nil;
                if (!shown.tab) DropCover(shown);
                HandOffPictures(shown);
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kUntakenAfterContentSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                  ArdiaEarlyShown *later = weakShown;
                  if (later && [Shown() containsObject:later]) Forget(later);
                });
              }];
}

@end
