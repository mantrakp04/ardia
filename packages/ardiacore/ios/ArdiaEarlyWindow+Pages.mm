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

@implementation ArdiaEarlyVeil
@end

@implementation ArdiaPageEmits
@end

namespace {

constexpr double kVeilFailSafeSeconds = 2;

constexpr NSUInteger kOlderEmitsKept = 256;

NSMapTable<ArdiaCoreTab *, ArdiaEarlyVeil *> *Veils() {
  static NSMapTable *veils = [NSMapTable weakToStrongObjectsMapTable];
  return veils;
}

NSMapTable<ArdiaCoreTab *, ArdiaPageEmits *> *Emits() {
  static NSMapTable *emits = [NSMapTable weakToStrongObjectsMapTable];
  return emits;
}

ArdiaPageEmits *EmitsOf(ArdiaCoreTab *tab) {
  ArdiaPageEmits *emits = [Emits() objectForKey:tab];
  if (!emits && tab) {
    emits = [ArdiaPageEmits new];
    emits.generation = 1;
    emits.current = [NSMutableOrderedSet orderedSet];
    emits.older = [NSMutableOrderedSet orderedSet];
    [Emits() setObject:emits forKey:tab];
  }
  return emits;
}

void Archive(ArdiaPageEmits *emits, NSString *url) {
  [emits.older removeObject:url];
  [emits.older addObject:url];
  while (emits.older.count > kOlderEmitsKept) {
    [emits.older removeObjectAtIndex:0];
    emits.forgot = YES;
  }
}

}

namespace ardia_early_window {

NSHashTable<ArdiaCoreTab *> *Watched() {
  static NSHashTable *watched = [NSHashTable weakObjectsHashTable];
  return watched;
}

}

namespace {

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
    id origin = [ArdiaCoreTab originForURL:url];
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

}

namespace ardia_early_window {

}

namespace {

NSString *LiveOrigin(ArdiaCoreTab *tab) {
  return tab.committedOrigin;
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

}

namespace ardia_early_window {

BOOL ShowsLaunchOrigin(ArdiaCoreTab *tab, NSString *launchURL) {
  NSString *launch = OriginOfURL(launchURL);
  if (!launch) return NO;
  NSString *committed = tab.committedOrigin;
  if (committed.length && ![committed isEqualToString:launch]) return NO;
  NSString *url = tab.url;
  if (!url.length) return YES;
  if ([url isEqualToString:@"about:blank"]) return YES;
  NSString *live = OriginOfURL(url);
  if (![live isEqualToString:launch]) return NO;
  if (![live hasPrefix:@"https:"]) return YES;
  return ![tab.securityInfo[@"level"] isEqual:@"certificateError"];
}

BOOL ReleaseFocusFrom(NSView *page) {
  NSWindow *window = page.window;
  NSResponder *focused = window.firstResponder;
  if (!page || ![focused isKindOfClass:NSView.class] || ![(NSView *)focused isDescendantOf:page]) return NO;
  [window makeFirstResponder:nil];
  return YES;
}

}

namespace {

void PlaceVeil(ArdiaCoreTab *tab, ArdiaEarlyVeil *veil) {
  NSView *page = tab.view, *host = page.superview;
  if (!host || host == veil.view.superview) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  if (!veil.view) {
    veil.view = [[NSView alloc] initWithFrame:host.bounds];
    veil.view.wantsLayer = YES;
    veil.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  }
  NSColor *fill = [host isKindOfClass:ArdiaWebView.class] ? ((ArdiaWebView *)host).pageBackgroundColor : nil;
  veil.view.layer.backgroundColor = (fill ?: NSColor.windowBackgroundColor).CGColor;
  veil.view.frame = host.bounds;
  [host addSubview:veil.view positioned:NSWindowAbove relativeTo:page];
  [CATransaction commit];
  if (ReleaseFocusFrom(page)) veil.restoreFocus = YES;
}

void Unveil(ArdiaCoreTab *tab) {
  ArdiaEarlyVeil *veil = [Veils() objectForKey:tab];
  if (!veil) return;
  [Veils() removeObjectForKey:tab];
  NSView *host = veil.view.superview;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [veil.view removeFromSuperview];
  [CATransaction commit];
  if (!veil.restoreFocus || tab.closed || tab.view.superview != host || ![host isKindOfClass:ArdiaWebView.class]) return;
  ArdiaWebView *web = (ArdiaWebView *)host;
  NSWindow *window = web.window;
  NSResponder *focused = window.firstResponder;
  if (window.isVisible && !window.isMiniaturized && web.visible && !web.isHiddenOrHasHiddenAncestor && (!focused || focused == window)) [tab focus];
}

void Reconcile(ArdiaCoreTab *tab) {
  NSView *host = tab.view.superview;
  if ([host isKindOfClass:ArdiaWebView.class]) [ArdiaEarlyWindow page:tab shownURL:((ArdiaWebView *)host).shownURL];
}

void WatchVeil(ArdiaCoreTab *tab, ArdiaEarlyVeil *veil, double after) {
  __weak ArdiaCoreTab *weakTab = tab;
  __weak ArdiaEarlyVeil *weakVeil = veil;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(after * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    ArdiaCoreTab *page = weakTab;
    ArdiaEarlyVeil *still = weakVeil;
    if (!page || !still || [Veils() objectForKey:page] != still) return;
    if (still.armedGeneration != EmitsOf(page).generation || ![still.armedShown ?: @"" isEqualToString:still.lastShown ?: @""]) return;
    const double left = still.changedAt + kVeilFailSafeSeconds - CACurrentMediaTime();
    if (left > 0.05) return WatchVeil(page, still, left);
    NSLog(@"[ardiacore] page veil lifted %.1f s after the bar showed a URL the engine never sent: shown %@, committed %@, visible %@", kVeilFailSafeSeconds,
          still.lastShown ?: @"(none)", page.committedOrigin ?: @"(none)", page.url ?: @"(none)");
    Unveil(page);
  });
}

}

namespace ardia_early_window {

void CarryShield(ArdiaCoreTab *tab, id inputBlock, NSString *shownAtPlacement) {
  if (!tab || tab.closed) return;
  ArdiaEarlyVeil *veil = [Veils() objectForKey:tab];
  if (!veil) {
    veil = [ArdiaEarlyVeil new];
    veil.lastShown = shownAtPlacement;
    veil.changedAt = CACurrentMediaTime();
    [Veils() setObject:veil forKey:tab];
  }
  if (!veil.inputBlock) veil.inputBlock = inputBlock ?: [tab suppressInput];
  PlaceVeil(tab, veil);
  Reconcile(tab);
}

}

@implementation ArdiaEarlyWindow (Pages)

+ (void)pageMoved:(ArdiaCoreTab *)tab {
  if (!tab) return;
  if (ArdiaEarlyVeil *veil = [Veils() objectForKey:tab]) {
    PlaceVeil(tab, veil);
    Reconcile(tab);
  }
  for (ArdiaEarlyShown *s in [Shown() copy]) {
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
  ArdiaEarlyVeil *veil = [Veils() objectForKey:tab];
  if (veil && ![veil.lastShown ?: @"" isEqualToString:url ?: @""]) {
    veil.lastShown = url;
    veil.changedAt = CACurrentMediaTime();
    ArdiaPageEmits *emits = EmitsOf(tab);
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
  ArdiaPageEmits *emits = EmitsOf(tab);
  for (NSString *each in emits.current) Archive(emits, each);
  emits.generation++;
  [emits.current removeAllObjects];
  emits.firstEmitAt = 0;
  if (NSString *visible = tab.url; visible.length) [emits.current addObject:visible];
  if (ArdiaEarlyVeil *veil = [Veils() objectForKey:tab]) {
    veil.armedShown = nil;
    return Reconcile(tab);
  }
  if (!url.length || ShownMatches(url, tab)) return;
  CarryShield(tab, nil, url);
}

+ (void)page:(ArdiaCoreTab *)tab emitted:(NSString *)url {
  if (!tab || !url) return;
  ArdiaPageEmits *emits = EmitsOf(tab);
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
  for (ArdiaEarlyShown *s in Shown())
    if (s.tab == tab && !s.shielded && tab.view.superview == s.cover && !ShowsLaunchOrigin(tab, launchURL)) Shield(s);
}

+ (void)dropPage:(ArdiaCoreTab *)tab {
  if (!tab) return;
  [Watched() removeObject:tab];
  Unveil(tab);
  for (ArdiaEarlyShown *s in [Shown() copy])
    if (s.tab == tab) {
      if (s.claimed) Forget(s);
      else if (s.expired) Abandon(s);
      else DropCover(s);
    }
}

@end
