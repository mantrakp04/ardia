#import "ArdiaChromeWindowInternal.h"
#import "ArdiaWebViewInternal.h"

using namespace ardia_window;

@interface ArdiaPopupWindow : NSObject <ArdiaCoreWindowDelegate, ArdiaCoreTabDelegate>
@property(nonatomic, readonly) ArdiaCoreTab *tab;
- (void)askPermission:(NSDictionary *)request;
- (BOOL)dropPermission:(NSString *)requestId;
@end

namespace {

constexpr CGFloat kPopupOriginStripHeight = 28;

NSMutableSet<ArdiaPopupWindow *> *PopupWindows() {
  static NSMutableSet *windows = [NSMutableSet set];
  return windows;
}

NSMapTable<ArdiaWebView *, NSPointerArray *> *PasswordPromptSources() {
  static NSMapTable *sources = [NSMapTable weakToStrongObjectsMapTable];
  return sources;
}

NSString *HostOf(NSString *url) {
  return [NSURL URLWithString:url ?: @""].host ?: @"";
}

NSDictionary<NSString *, NSArray<NSString *> *> *PermissionKinds() {
  static NSDictionary *kinds = @{
    @"camera" : @[ @"video", @"camera" ],
    @"microphone" : @[ @"mic", @"microphone" ],
    @"cameraPanTiltZoom" : @[ @"video", @"camera's pan, tilt and zoom" ],
    @"screen" : @[ @"rectangle.on.rectangle", @"", @"Allow %@ to share your screen?" ],
    @"location" : @[ @"location", @"location" ],
    @"notifications" : @[ @"bell", @"", @"Allow %@ to send you notifications?" ],
    @"clipboard" : @[ @"doc.on.clipboard", @"clipboard" ],
    @"midi" : @[ @"pianokeys", @"MIDI devices" ],
    @"multipleDownloads" : @[ @"arrow.down.circle", @"", @"Allow %@ to download multiple files?" ],
    @"localFonts" : @[ @"textformat", @"fonts" ],
    @"idleDetection" : @[ @"person.crop.circle.badge.clock", @"", @"Allow %@ to know when you're actively using this device?" ],
    @"storageAccess" : @[ @"externaldrive", @"", @"Allow %@ to use cookies and site data while embedded?" ],
    @"diskQuota" : @[ @"internaldrive", @"", @"Allow %@ to store files on your device?" ],
    @"windowManagement" : @[ @"macwindow.on.rectangle", @"displays to open and place windows" ],
    @"fileSystem" : @[ @"folder", @"files" ],
    @"keyboardLock" : @[ @"keyboard", @"keyboard" ],
    @"pointerLock" : @[ @"cursorarrow", @"mouse pointer" ],
    @"protocolHandler" : @[ @"envelope", @"", @"Make %@ your default mail app?" ],
    @"sensors" : @[ @"gyroscope", @"motion sensors" ],
    @"localNetwork" : @[ @"network", @"devices on your local network" ],
    @"vr" : @[ @"visionpro", @"virtual reality devices" ],
    @"ar" : @[ @"visionpro", @"augmented reality data" ],
    @"handTracking" : @[ @"hand.raised", @"hand tracking" ],
    @"identityProvider" : @[ @"person.badge.key", @"", @"Allow %@ to sign you in with an identity provider?" ],
    @"webAppInstallation" : @[ @"app.badge", @"", @"Allow %@ to install web apps?" ],
    @"capturedSurfaceControl" : @[ @"rectangle.on.rectangle", @"", @"Allow %@ to scroll and zoom the tab you share?" ],
  };
  return kinds;
}

NSString *ListOf(NSArray<NSString *> *words) {
  if (words.count < 2) return words.firstObject ?: @"";
  NSString *head = [[words subarrayWithRange:NSMakeRange(0, words.count - 1)] componentsJoinedByString:@", "];
  return [NSString stringWithFormat:@"%@ and %@", head, words.lastObject];
}

NSString *PermissionQuestion(NSDictionary *request) {
  NSString *origin = [request[@"origin"] isKindOfClass:NSString.class] ? request[@"origin"] : @"";
  NSString *site = HostOf(origin);
  if ([site hasPrefix:@"www."]) site = [site substringFromIndex:4];
  if (!site.length) site = origin;
  NSArray<NSString *> *kinds = [request[@"permissions"] isKindOfClass:NSArray.class] ? request[@"permissions"] : @[];
  if (kinds.count == 1 && PermissionKinds()[kinds[0]].count > 2)
    return [NSString stringWithFormat:PermissionKinds()[kinds[0]][2], site];
  NSMutableArray<NSString *> *nouns = [NSMutableArray array];
  BOOL allNouns = YES;
  for (NSString *kind in kinds) {
    NSString *noun = PermissionKinds()[kind][1] ?: kind;
    allNouns &= noun.length > 0;
    [nouns addObject:noun.length ? noun : kind];
  }
  return allNouns ? [NSString stringWithFormat:@"Allow %@ to access your %@?", site, ListOf(nouns)]
                  : [NSString stringWithFormat:@"Allow %@ to use %@?", site, ListOf(nouns)];
}

NSImage *_Nullable PermissionIcon(NSDictionary *request) {
  NSArray<NSString *> *kinds = [request[@"permissions"] isKindOfClass:NSArray.class] ? request[@"permissions"] : @[];
  NSString *symbol = PermissionKinds()[kinds.firstObject ?: @""].firstObject ?: @"questionmark.circle";
  NSImageSymbolConfiguration *config = [NSImageSymbolConfiguration configurationWithPointSize:32 weight:NSFontWeightRegular];
  return [[NSImage imageWithSystemSymbolName:symbol accessibilityDescription:nil] imageWithSymbolConfiguration:config];
}

}

@implementation ArdiaPopupWindow {
  ArdiaCoreWindow *_coreWindow;
  ArdiaCoreTab *_tab;
  __weak ArdiaWebView *_opener;
  ArdiaPopupOriginStrip *_strip;
  id _closeObserver;
  BOOL _adopting;
  NSMutableArray<NSDictionary *> *_permissionQueue;
  NSDictionary *_shownPermission;
  NSAlert *_permissionAlert;
}

- (ArdiaCoreTab *)tab {
  return _tab;
}

- (void)askPermission:(NSDictionary *)request {
  [_permissionQueue addObject:request];
  [self showNextPermission];
}

- (void)showNextPermission {
  NSWindow *window = _coreWindow.window;
  if (_shownPermission || !_permissionQueue.count || !window) return;
  NSDictionary *request = _permissionQueue.firstObject;
  [_permissionQueue removeObjectAtIndex:0];
  _shownPermission = request;
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = PermissionQuestion(request);
  alert.informativeText = @"";
  if (NSImage *icon = PermissionIcon(request)) alert.icon = icon;
  [alert addButtonWithTitle:@"Allow"];
  [alert addButtonWithTitle:@"Don't Allow"].keyEquivalent = @"\e";
  _permissionAlert = alert;
  NSString *requestId = request[@"id"];
  __weak ArdiaPopupWindow *weakSelf = self;
  [alert beginSheetModalForWindow:window
                completionHandler:^(NSModalResponse response) {
                  [weakSelf permission:requestId answered:response];
                }];
}

- (void)permission:(NSString *)requestId answered:(NSModalResponse)response {
  if (![_shownPermission[@"id"] isEqual:requestId]) return;
  _shownPermission = nil;
  _permissionAlert = nil;
  if (response == NSAlertFirstButtonReturn) [ArdiaHost resolvePermission:requestId result:@"accept" remember:YES];
  else if (response == NSAlertSecondButtonReturn) [ArdiaHost resolvePermission:requestId result:@"deny" remember:YES];
  [self showNextPermission];
}

- (BOOL)dropPermission:(NSString *)requestId {
  NSUInteger queued = [_permissionQueue indexOfObjectPassingTest:^BOOL(NSDictionary *request, NSUInteger, BOOL *) {
    return [request[@"id"] isEqual:requestId];
  }];
  if (queued != NSNotFound) {
    [_permissionQueue removeObjectAtIndex:queued];
    return YES;
  }
  if (![_shownPermission[@"id"] isEqual:requestId]) return NO;
  NSAlert *alert = _permissionAlert;
  _shownPermission = nil;
  _permissionAlert = nil;
  if (alert.window.sheetParent) [alert.window.sheetParent endSheet:alert.window returnCode:NSModalResponseAbort];
  [self showNextPermission];
  return YES;
}

- (instancetype)initWithTab:(ArdiaCoreTab *)tab opener:(ArdiaWebView *)opener {
  if (!(self = [super init])) return nil;
  _tab = tab;
  _opener = opener;
  _permissionQueue = [NSMutableArray array];
  NSDictionary<NSString *, NSNumber *> *features = tab.popupFeatures ?: @{};
  const NSSize size = NSMakeSize(MAX(features[@"width"] ? features[@"width"].doubleValue : 500, 200),
                                 MAX(features[@"height"] ? features[@"height"].doubleValue : 600, 150) + kPopupOriginStripHeight);
  _coreWindow = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, size.width, size.height)];
  NSWindow *window = _coreWindow.window;
  if (!window) return nil;
  _coreWindow.delegate = self;
  window.styleMask |= NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
                      NSWindowStyleMaskResizable;
  window.releasedWhenClosed = NO;
  window.tabbingMode = NSWindowTabbingModeDisallowed;
  window.minSize = NSMakeSize(200, 150);
  [window setContentSize:size];
  [self placeWithFeatures:features];
  __weak ArdiaPopupWindow *weakSelf = self;
  _closeObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                                   object:window
                                                                    queue:nil
                                                               usingBlock:^(NSNotification *) { [weakSelf windowWillClose]; }];
  return self;
}

- (void)placeWithFeatures:(NSDictionary<NSString *, NSNumber *> *)features {
  NSWindow *window = _coreWindow.window;
  NSWindow *parent = _opener.window;
  NSScreen *screen = parent.screen ?: NSScreen.mainScreen;
  const NSRect visible = screen.visibleFrame;
  NSRect frame = window.frame;
  if (!NSIsEmptyRect(visible))
    frame.size = NSMakeSize(MIN(NSWidth(frame), NSWidth(visible)), MIN(NSHeight(frame), NSHeight(visible)));
  if (features[@"x"] || features[@"y"]) {
    const NSRect primary = NSScreen.screens.firstObject.frame;
    const NSRect content = [window contentRectForFrameRect:frame];
    const CGFloat left = features[@"x"] ? features[@"x"].doubleValue : NSMidX(parent.frame) - NSWidth(frame) / 2;
    const CGFloat top = features[@"y"] ? features[@"y"].doubleValue : NSMaxY(primary) - NSMaxY(parent.frame) + 60;
    frame.origin = NSMakePoint(left, NSMaxY(primary) - top - NSHeight(content));
  } else if (parent) {
    frame.origin = NSMakePoint(NSMidX(parent.frame) - NSWidth(frame) / 2, NSMaxY(parent.frame) - NSHeight(frame) - 60);
  } else {
    [window center];
    frame.origin = window.frame.origin;
  }
  frame.origin.x = MAX(NSMinX(visible), MIN(NSMinX(frame), NSMaxX(visible) - NSWidth(frame)));
  frame.origin.y = MAX(NSMinY(visible), MIN(NSMinY(frame), NSMaxY(visible) - NSHeight(frame)));
  [window setFrame:frame display:NO];
}

- (void)takeTab {
  if (_tab.closed) return [_coreWindow close];
  _adopting = YES;
  [_coreWindow adoptTab:_tab];
  _adopting = NO;
  if (ArdiaCoreProfile *profile = _tab.profile) _coreWindow.activeProfile = profile;
  _tab.delegate = self;
  NSView *page = _tab.view, *host = _coreWindow.hostView;
  [page removeFromSuperview];
  const NSRect bounds = host.bounds;
  const CGFloat pageHeight = MAX(NSHeight(bounds) - kPopupOriginStripHeight, 0);
  const BOOL flipped = host.isFlipped;
  page.frame = NSMakeRect(0, flipped ? kPopupOriginStripHeight : 0, NSWidth(bounds), pageHeight);
  page.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [host addSubview:page];
  _strip = [[ArdiaPopupOriginStrip alloc]
      initWithFrame:NSMakeRect(0, flipped ? 0 : pageHeight, NSWidth(bounds), kPopupOriginStripHeight)];
  _strip.autoresizingMask = NSViewWidthSizable | (flipped ? NSViewMaxYMargin : NSViewMinYMargin);
  [host addSubview:_strip positioned:NSWindowAbove relativeTo:page];
  [self updateTitle];
  [self updateOrigin];
  if (ardia_host::Background()) [_coreWindow showInactive];
  else [_coreWindow.window makeKeyAndOrderFront:nil];
  [_tab focus];
}

- (void)updateTitle {
  NSString *url = _tab.url ?: @"", *title = _tab.title;
  _coreWindow.window.title = title.length && ![title isEqualToString:url] ? title : PopupOriginText(url);
}

- (void)updateOrigin {
  id level = _tab.securityInfo[@"level"];
  [_strip showURL:_tab.url ?: @"" security:[level isKindOfClass:NSString.class] ? level : nil];
}

- (void)windowWillClose {
  if (_closeObserver) [NSNotificationCenter.defaultCenter removeObserver:_closeObserver];
  _closeObserver = nil;
  [_permissionQueue removeAllObjects];
  NSAlert *alert = _permissionAlert;
  _shownPermission = nil;
  _permissionAlert = nil;
  if (alert.window.sheetParent) [alert.window.sheetParent endSheet:alert.window returnCode:NSModalResponseAbort];
  if (_tab.delegate == self) _tab.delegate = nil;
  ArdiaPopupWindow *me = self;
  dispatch_async(dispatch_get_main_queue(), ^{ [PopupWindows() removeObject:me]; });
}

- (void)tabDidChangeTitle:(ArdiaCoreTab *)tab {
  [self updateTitle];
}

- (void)tabDidChangeURL:(ArdiaCoreTab *)tab {
  [self updateTitle];
  [self updateOrigin];
}

- (void)tabDidChangeSecurity:(ArdiaCoreTab *)tab {
  [self updateOrigin];
}

- (void)tab:(ArdiaCoreTab *)tab requestsActivation:(NSString *)reason {
  if (!ardia_host::Background()) [_coreWindow.window makeKeyAndOrderFront:nil];
}

- (void)tab:(ArdiaCoreTab *)tab externalAppRequest:(NSDictionary<NSString *, id> *)request {
  [_opener tab:tab externalAppRequest:request];
}

- (void)window:(ArdiaCoreWindow *)window didInsertTab:(ArdiaCoreTab *)tab opener:(ArdiaCoreTab *)opener disposition:(NSString *)disposition {
  if (_adopting || tab == _tab) return;
  if ([disposition isEqualToString:@"popup"]) return ardia_host::OpenPopupWindow(tab, _opener);
  ArdiaWebView *view = _opener ?: [ArdiaWindowController hostingViewForProfile:tab.profile];
  if (view) [view openedTab:tab adoptId:[ArdiaTabRegistry offerTab:tab] disposition:ardia_host::AppDisposition(disposition)];
  else [tab closeNow];
}

- (void)window:(ArdiaCoreWindow *)window passwordPrompt:(NSDictionary<NSString *, id> *)prompt forTab:(ArdiaCoreTab *)tab {
  ArdiaWebView *opener = _opener;
  if (tab != _tab) return;
  if (!opener) {
    NSLog(@"[ardiacore] dropped a popup's password prompt: its opener is gone");
    return;
  }
  ardia_host::NotePasswordPromptSource(opener, tab);
  [opener emit:@"passwordPrompt" payload:prompt];
}

- (void)window:(ArdiaCoreWindow *)window didRemoveTab:(ArdiaCoreTab *)tab {
  if (tab != _tab) return;
  __weak ArdiaCoreWindow *coreWindow = _coreWindow;
  dispatch_async(dispatch_get_main_queue(), ^{ [coreWindow close]; });
}

- (BOOL)window:(ArdiaCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  NSMenuItem *reserved = ReservedMenuItemForEvent(event);
  if (!reserved) return NO;
  if ([reserved.identifier isEqualToString:@"ardia.command.closeTab"]) {
    [_coreWindow close];
    return YES;
  }
  return [NSApp.mainMenu performKeyEquivalent:event];
}

@end

namespace ardia_host {

void OpenPopupWindow(ArdiaCoreTab *tab, ArdiaWebView *opener) {
  ArdiaPopupWindow *popup = [[ArdiaPopupWindow alloc] initWithTab:tab opener:opener];
  if (!popup) {
    if (opener) [opener openedTab:tab adoptId:[ArdiaTabRegistry offerTab:tab] disposition:@"foreground"];
    return;
  }
  [PopupWindows() addObject:popup];
  __weak ArdiaPopupWindow *weakPopup = popup;
  dispatch_async(dispatch_get_main_queue(), ^{ [weakPopup takeTab]; });
}

NSUInteger PopupWindowCount() {
  return PopupWindows().count;
}

bool AskPermissionInPopupWindow(ArdiaCoreTab *tab, NSDictionary *request) {
  for (ArdiaPopupWindow *popup in PopupWindows()) {
    if (popup.tab != tab) continue;
    [popup askPermission:request];
    return true;
  }
  return false;
}

void DropPopupWindowPermission(NSString *requestId) {
  for (ArdiaPopupWindow *popup in PopupWindows().allObjects)
    if ([popup dropPermission:requestId]) return;
}

void NotePasswordPromptSource(ArdiaWebView *view, ArdiaCoreTab *source) {
  if (!source) {
    [PasswordPromptSources() removeObjectForKey:view];
    return;
  }
  NSPointerArray *route = [NSPointerArray weakObjectsPointerArray];
  [route addPointer:(__bridge void *)source];
  [PasswordPromptSources() setObject:route forKey:view];
}

ArdiaCoreTab *PasswordPromptTab(ArdiaWebView *view, ArdiaCoreTab *own) {
  NSPointerArray *route = [PasswordPromptSources() objectForKey:view];
  if (!route) return own;
  [PasswordPromptSources() removeObjectForKey:view];
  ArdiaCoreTab *source = (__bridge ArdiaCoreTab *)[route pointerAtIndex:0];
  return source.closed ? nil : source;
}

}
