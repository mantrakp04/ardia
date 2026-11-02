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

constexpr double kCoverCheckSeconds = 0.016;

constexpr double kCoveredFailSafeSeconds = 1.5;

constexpr double kOnScreenAfterCoveredSeconds = 0.05;

constexpr double kTrimAfterHandoffSeconds = 2;

constexpr double kWatchAfterAdoptionSeconds = 10;

}

namespace ardia_early_window {

void DropCover(ArdiaEarlyShown *s) {
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
    NSString *shown = [host isKindOfClass:ArdiaWebView.class] ? ((ArdiaWebView *)host).shownURL : nil;
    CarryShield(tab, inputBlock, shown.length ? shown : (s.expectedURL ?: gLaunchURL));
  }
  else if (tab && !tab.closed && [tab.view.superview isKindOfClass:ArdiaWebView.class]) {
    [Watched() addObject:tab];
    __weak ArdiaCoreTab *watched = tab;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kWatchAfterAdoptionSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (ArdiaCoreTab *still = watched) [Watched() removeObject:still];
    });
    [ArdiaEarlyWindow page:tab shownURL:((ArdiaWebView *)tab.view.superview).shownURL];
  }
}

}

namespace {

void TrimAfterHandoff() {
  static bool trimmed;
  if (trimmed) return;
  trimmed = true;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kTrimAfterHandoffSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [ArdiaEngineBridge call:@"ac_memory_trim" profile:@"" args:nil completion:^(NSString *) {}];
  });
}

void RemovePicture(NSView *picture) {
  picture.layer.contents = nil;
  [picture removeFromSuperview];
}

}

namespace ardia_early_window {

void ClearRootFill(ArdiaEarlyShown *s, NSView *root) {
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

}

namespace {

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

}

namespace ardia_early_window {

void DropPictures(ArdiaEarlyShown *s) {
  ReleasePictures(s.picture, s.backdrop, s.rootFillCleared ? s.root : nil, s.rootFill);
  s.picture = nil;
  s.backdrop = nil;
  s.rootFillCleared = NO;
  s.rootFill = nil;
}

void HandOffPictures(ArdiaEarlyShown *s) {
  if (s.picture || s.backdrop)
    ReleaseOnceCovered(s.picture, s.backdrop, s.root, s.rootFill, s.rootFillCleared, CACurrentMediaTime() + kCoveredFailSafeSeconds);
  s.picture = nil;
  s.backdrop = nil;
  s.rootFillCleared = NO;
  s.rootFill = nil;
}

void Forget(ArdiaEarlyShown *s) {
  DropCover(s);
  if (s.closeObserver) [NSNotificationCenter.defaultCenter removeObserver:s.closeObserver];
  s.closeObserver = nil;
  HandOffPictures(s);
  [Shown() removeObject:s];
  if (!Shown().count) TrimAfterHandoff();
}

void Abandon(ArdiaEarlyShown *s) {
  NSWindow *window = s.window;
  const BOOL unclaimed = !s.claimed;
  DropPictures(s);
  Forget(s);
  if (!unclaimed || !window) return;
  [window orderOut:nil];
  [ArdiaChromeWindowHost closeWindow:window];
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

void Shield(ArdiaEarlyShown *s) {
  s.shielded = YES;
  s.inputBlock = [s.tab suppressInput];
  ReleaseFocusFrom(s.tab.view);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  s.cover.hidden = YES;
  [CATransaction commit];
}

void ApplyLights(NSWindow *window, NSDictionary *layout) {
  NSArray *lights = layout[@"lights"];
  if ([lights isKindOfClass:NSArray.class] && lights.count == 2 && [lights[0] isKindOfClass:NSNumber.class] && [lights[1] isKindOfClass:NSNumber.class])
    [ArdiaChromeWindowHost setTrafficLightsCenter:[NSValue valueWithPoint:NSMakePoint([lights[0] doubleValue], [lights[1] doubleValue])] inWindow:window];
}

}
