#import "ArdiaInternal.h"
#import "ArdiaWebView.h"

enum class ArdiaPageFocus { Unknown, Page, DevTools, Elsewhere };

@interface ArdiaWebView () <ArdiaCoreTabDelegate> {
  __weak id<ArdiaWebViewDelegate> _delegate;
  NSString *_profile;
  NSString *_initialURL;
  NSString *_adoptId;
  NSString *_transferKey;
  BOOL _standalone;
  BOOL _temporary;
  NSString *_temporarySource;
  NSString *_extensionHost;
  NSColor *_pageBackgroundColor;
  NSColor *_contentsBackgroundColor;
  NSString *_pageColor;
  NSString *_shownURL;
  BOOL _visible;
  BOOL _warm;
  BOOL _neighbour;
  BOOL _autoPictureInPicture;
  BOOL _frozen;
  ArdiaCoreTab *_tab;
  BOOL _loadedOnce;
  BOOL _pendingUserInitiated;
  NSString *_requestedURL;
  BOOL _creating;
  BOOL _closing;
  BOOL _launchCloseSent;
  BOOL _offerClosed;
  BOOL _moving;
  NSString *_pendingURL;
  NSString *_creatingURL;
  CFTimeInterval _creatingAt;
  NSString *_transferredURL;
  BOOL _muted;
  NSInteger _tabIndex;
  BOOL _pinned;
  NSView *_devtoolsView;
  BOOL _navigationQueued;
  NSString *_pageTheme;
  NSString *_pageThemeSource;
  NSUInteger _createGeneration;
  NSUInteger _blockedGeneration;
  NSInteger _blockedCount;
  NSString *_lastBlocked;
  BOOL _blockedEmitQueued;
  NSDictionary *_sentNavigation;
  NSString *_lastFavicon;
  CFTimeInterval _sentProgressAt;
  double _sentProgress;
  BOOL _progressQueued;
  CFTimeInterval _linkDropAt;
  NSMutableDictionary<NSString *, NSDictionary *> *_nowPlaying;
  NSString *_nowPlayingFrame;
  NSMutableDictionary<NSString *, NSString *> *_notificationFrames;
  NSMutableDictionary<NSString *, NSDictionary *> *_displayRequests;
  double _pinchScale;
  BOOL _autoPictureInPictureActive;
  BOOL _inPictureInPicture;
  BOOL _seenByUser;
  id _sightObserver;
  BOOL _capturing;
  BOOL _crashed;
  BOOL _leaving;
  NSUInteger _leaveGeneration;
  BOOL _handingOff;
  BOOL _revealed;
  BOOL _littlePageHeld;
  BOOL _littlePageSettled;
  float _littlePageOpacity;
  NSUInteger _littlePageGeneration;
  NSUInteger _revealGeneration;
  __weak NSView *_loweredPane;
  CGFloat _loweredPaneZ;
  __weak NSView *_frontedPage;
  NSUInteger _frontGeneration;
  ArdiaPageFocus _pageFocus;
  __weak NSView *_focusedDevTools;
  BOOL _focusOnActivate;
  BOOL _keepsOutgoingFocus;
  CFTimeInterval _focusActivatedAt;
  __weak NSWindow *_focusActivatedIn;
}
- (ArdiaWindowController *)controller;
- (void)emit:(NSString *)name payload:(NSDictionary *)payload;
@end

@interface ArdiaWebView (TransferInternal)
+ (void)keepTransfersOfWindow:(NSWindow *)window;
- (BOOL)takeLinkTab:(NSString *)adoptId;
- (void)ensureTab;
- (BOOL)cloneTab:(NSString *)sourceKey profile:(ArdiaCoreProfile *)profile;
- (BOOL)canTake:(ArdiaCoreTab *)tab;
- (BOOL)takeTransferredTab;
- (void)bindRestoreKey;
@end

@interface ArdiaWebView (TabInternal)
- (void)adoptIntoWindow;
- (void)attach:(ArdiaCoreTab *)tab;
- (void)detach;
- (void)stashPageReports;
- (void)takePageReports;
- (void)takeReports:(NSDictionary *)reports;
- (void)placeTab;
- (void)openedTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition;
- (void)announceOpenedTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition tries:(int)tries;
- (void)tabRemovedFromWindow:(ArdiaCoreWindow *)window;
- (void)tabActivatedByChrome:(BOOL)chromes;
- (void)devToolsChanged:(NSView *)devToolsView;
- (void)dropDevTools;
@end

@interface ArdiaWebView (PaintingInternal)
+ (void)wakeNeighbourPagesIn:(NSWindow *)window seconds:(CFTimeInterval)seconds committed:(BOOL)committed;
+ (void)releaseNeighbourPagesIn:(NSWindow *)window;
+ (void)sleepNeighbourPagesIn:(NSWindow *)window after:(CFTimeInterval)delay;
+ (void)repaintWarmPagesIn:(NSWindow *)window;
+ (void)noteShown:(ArdiaCoreTab *)tab;
+ (void)drainPainting;
- (void)layoutPage;
- (BOOL)paints;
- (BOOL)neighbourPageAsleep;
- (void)holdLittlePage;
- (void)revealLittlePage:(BOOL)animated;
- (void)applyPainting;
- (void)markTemporary;
- (BOOL)seenByUser;
- (void)userSightChanged;
- (void)schedulePainting;
- (void)leaveScreen;
@end

@interface ArdiaWebView (FocusInternal)
+ (ArdiaWebView *)holding:(id)responder;
- (void)storePageFocus;
- (void)storePageFocusFrom:(NSResponder *)responder;
- (void)requestFocusRestore;
- (void)requestFocusRestoreIn:(NSWindow *)window;
- (void)restoreFocusIfDue;
- (void)focusAfterLoad;
@end

@interface ArdiaWebView (RevealsInternal)
+ (void)dropRevealsInWindow:(NSWindow *)window except:(ArdiaWebView *)keep;
- (BOOL)onlyShownInWindow;
- (void)frontPage:(NSView *)page profile:(ArdiaCoreProfile *)profile;
- (void)dropFront;
- (void)revealAhead;
- (void)endReveal;
- (void)dropReveal;
- (void)settleRevealsInWindow;
@end

@interface ArdiaWebView (PageMessagesInternal)
- (void)noteScriptFrame:(NSString *)frameId main:(BOOL)main;
- (void)forgetScriptFrame:(NSString *)frameId;
- (void)pushSelectionPopover;
- (void)callFrame:(NSString *)frameId kind:(NSString *)kind json:(NSString *)json;
- (void)resetPageMedia;
@end

@interface ArdiaWebView (PeekInternal)
- (void)pushPeekModifier;
- (void)fallBackFromPeek:(NSDictionary *)dict url:(NSString *)url frame:(NSString *)frameId reason:(NSString *)reason test:(BOOL)test;
- (void)peekLink:(NSDictionary *)dict frame:(NSString *)frameId main:(BOOL)main;
@end

@interface ArdiaWebView (PictureInPictureInternal)
- (void)traceManualPictureInPicture:(NSString *)what;
- (void)traceAutoPictureInPicture:(NSString *)what;
- (void)awaitPictureInPicture:(int)tries completion:(void (^)(BOOL))completion;
- (void)updateAutoPictureInPicture;
- (void)exitPictureInPictureInFrame:(NSString *)frameId;
@end

@interface ArdiaWebView (NavigationInternal)
- (void)emitNavigation;
- (void)queueNavigation;
- (void)resetBlocked:(BOOL)report;
- (void)sendProgress;
- (void)loadNow:(NSString *)url userInitiated:(BOOL)userInitiated;
- (BOOL)skipsNavigationDownload:(NSString *)url userInitiated:(BOOL)userInitiated;
@end

@interface ArdiaWebView (PageCommandsInternal)
- (void)emitMedia;
- (void)emitZoom;
- (void)runChromeCommand:(int)command;
- (void)thawHiddenPage;
@end

@interface ArdiaWebView (InputMonitorsInternal)
+ (BOOL)prewarmForMouseEvent:(NSEvent *)event;
- (BOOL)canWakeFrames;
@end

namespace ardia_web_view {

constexpr CFTimeInterval kNeighbourPagesAwakeSeconds = 10;

bool TraceVisibility();
NSHashTable<ArdiaWebView *> *LiveViews();
bool SamePage(NSString *a, NSString *b);
id JSONValue(NSString *json);
NSString *JSONString(id value);
NSString *OriginOf(NSString *url);
void NoteEvent(int browserId, NSString *name, NSDictionary *payload);
void AcceptDrops(NSView *root, BOOL accept);

template <typename T>
T *Field(NSDictionary *d, NSString *key) {
  id value = d[key];
  return [value isKindOfClass:[T class]] ? value : nil;
}

NSString *Text(NSDictionary *d, NSString *key, NSUInteger max);
bool Flag(NSDictionary *d, NSString *key);
bool Finite(NSDictionary *d, NSString *key, double *out);

void AnswerHello(ArdiaCoreTab *tab, NSString *profile, NSDictionary *hello, NSString *frameId, BOOL main);
NSMutableOrderedSet<NSString *> *ScriptFramesOf(ArdiaCoreTab *tab);

extern NSString *gPeekModifier;
void InstallPeekMonitor();
BOOL PeekTracing();
void PeekTrace(NSDictionary *entry);
NSString *SplitLinkModifier();
NSString *PeekConfigJSON();

void InstallControlPressMonitor();
BOOL TracingPictureInPicture();

}
