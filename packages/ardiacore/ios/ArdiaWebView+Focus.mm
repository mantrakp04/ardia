#import "ArdiaWebViewInternal.h"
#import "ArdiaEarlyWindow.h"
#import "ArdiaNotifications.h"

using namespace ardia_web_view;

namespace {

constexpr CFTimeInterval kFocusRestoreWindow = 1;
}

@implementation ArdiaWebView (Focus)

static BOOL InTabPage(NSView *view) {
  for (NSView *v = view; v; v = v.superview)
    if ([v isKindOfClass:ArdiaWebView.class]) return !((ArdiaWebView *)v)->_standalone;
  return NO;
}

+ (void)installOutgoingFocusSnapshots {
  static id snapshots, ends;
  if (snapshots) return;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  snapshots = [center addObserverForName:ArdiaOutgoingFocusNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
    if (ArdiaWebView *view = [ArdiaWebView holding:note.object]) {
      [view storePageFocusFrom:note.object];
      view->_keepsOutgoingFocus = YES;
    }
  }];
  ends = [center addObserverForName:ArdiaFocusHandoffEndedNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
    if (ArdiaWebView *view = [ArdiaWebView holding:note.object]) view->_keepsOutgoingFocus = NO;
  }];
}

+ (ArdiaWebView *)holding:(id)responder {
  NSView *outgoing = [responder isKindOfClass:NSView.class] ? responder : nil;
  for (ArdiaWebView *view in LiveViews().allObjects)
    if (outgoing && view.window == outgoing.window && [outgoing isDescendantOf:view]) return view;
  return nil;
}

- (void)storePageFocus {
  NSResponder *responder = self.window.firstResponder;
  const BOOL unfocused = !responder || responder == self.window;
  const BOOL snapshotted = _keepsOutgoingFocus;
  _keepsOutgoingFocus = NO;
  if (snapshotted && unfocused) {
    _focusOnActivate = NO;
    return;
  }
  [self storePageFocusFrom:responder];
}

- (void)storePageFocusFrom:(NSResponder *)responder {
  _focusOnActivate = NO;
  _focusedDevTools = nil;
  NSWindow *window = self.window;
  if (!window || !_tab) return;
  NSView *view = [responder isKindOfClass:NSView.class] ? (NSView *)responder : nil;
  if (view && _tab.view && [view isDescendantOf:_tab.view]) {
    _pageFocus = ArdiaPageFocus::Page;
  } else if (view && _devtoolsView && [view isDescendantOf:_devtoolsView]) {
    _pageFocus = ArdiaPageFocus::DevTools;
    _focusedDevTools = view;
  } else if (!responder || responder == window || (view && InTabPage(view))) {
    _pageFocus = ArdiaPageFocus::Unknown;
  } else {
    _pageFocus = ArdiaPageFocus::Elsewhere;
  }
}

- (void)requestFocusRestore {
  [self requestFocusRestoreIn:self.window];
}

- (void)requestFocusRestoreIn:(NSWindow *)window {
  if (_standalone || !_tab || !window) return;
  _focusOnActivate = YES;
  _focusActivatedAt = CACurrentMediaTime();
  _focusActivatedIn = window;
  [self restoreFocusIfDue];
  if (_focusOnActivate) [self schedulePainting];
}

- (void)restoreFocusIfDue {
  if (!_focusOnActivate) return;
  NSWindow *window = self.window;
  NSView *page = _tab.view;
  if (!window || window != _focusActivatedIn || !page || _standalone || page.superview != self ||
      CACurrentMediaTime() - _focusActivatedAt > kFocusRestoreWindow) {
    _focusOnActivate = NO;
    return;
  }
  if (!_visible || page.isHiddenOrHasHiddenAncestor) return;
  [self takeFocusFromLingeringPane];
  _focusOnActivate = NO;
  NSResponder *responder = window.firstResponder;
  NSView *view = [responder isKindOfClass:NSView.class] ? (NSView *)responder : nil;
  if (view && [view isDescendantOf:self]) return;
  if (responder && responder != window && !(view && InTabPage(view))) return;
  NSView *devTools = _focusedDevTools;
  if (_pageFocus == ArdiaPageFocus::DevTools && devTools.window == window && _devtoolsView && [devTools isDescendantOf:_devtoolsView]) {
    [window makeFirstResponder:devTools];
  } else if (_pageFocus != ArdiaPageFocus::Elsewhere) {
    [self focusPage];
  }
}

- (void)focusAfterLoad {
  if (_visible && _tab) [self focusPage];
}

- (void)focusPage {
  if ([ArdiaEarlyWindow veils:_tab]) return [ArdiaEarlyWindow requestFocus:_tab];
  [_tab focus];
}

- (void)tabDidGainFocus:(ArdiaCoreTab *)tab {
  [self emit:@"focus" payload:@{}];
}

@end
