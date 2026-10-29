#import "ArdiaInternal.h"
#import "ArdiaWebView.h"
#import "ArdiaNowPlaying.h"
#import "ArdiaTabLifecycle.h"

enum class ArdiaPageFocus { Unknown, Page, DevTools, Elsewhere };

@class ArdiaWebView;

struct ArdiaRequests {
  BOOL loadedOnce{};
  NSString *requestedURL;
};

struct ArdiaSentReports {
  BOOL navigationQueued{};
  NSDictionary *navigation;
  NSString *favicon;
  NSUInteger blockedGeneration{};
  BOOL blockedEmitQueued{};
  CFTimeInterval progressAt{};
  double progress{};
  BOOL progressQueued{};
};

struct ArdiaLeave {
  BOOL active{};
  NSUInteger generation{};
};

struct ArdiaFrameHold {
  BOOL awaiting{};
  NSUInteger generation{};
  NSArray *mark;
  __weak NSView *pane;
  CGFloat paneZ{};
  BOOL holding{};
  __weak ArdiaWebView *holdingFor;
  NSUInteger holdGeneration{};
  __weak ArdiaWebView *tookOverFrom;
  CFTimeInterval tookOverAt{};
};

struct ArdiaStandIn {
  __weak NSView *page;
  ArdiaCoreTab *tab;
  __weak ArdiaWebView *lender;
  BOOL closes{};
  BOOL leaving{};
  float opacity{};
  NSUInteger generation{};
  __weak ArdiaWebView *lentTo;
};

struct ArdiaLittlePage {
  BOOL held{};
  BOOL settled{};
  float opacity{};
  NSUInteger generation{};
};

struct ArdiaReveal {
  BOOL active{};
  NSUInteger generation{};
  __weak NSView *loweredPane;
  CGFloat loweredPaneZ{};
  __weak NSView *frontedPage;
  NSUInteger frontGeneration{};
};

struct ArdiaPageReports {
  NSString *theme;
  NSString *themeSource;
  NSInteger blockedCount{};
  NSString *lastBlocked;
  ArdiaNowPlaying *nowPlaying;
  NSMutableDictionary<NSString *, NSString *> *notificationFrames;
  NSMutableDictionary<NSString *, NSDictionary *> *displayRequests;
  double pinchScale{};
  BOOL capturing{};
  BOOL crashed{};
  BOOL seenByUser{YES};
  BOOL inPictureInPicture{};
  BOOL autoPictureInPictureActive{};
};

struct ArdiaPageFocusState {
  ArdiaPageFocus page{ArdiaPageFocus::Unknown};
  __weak NSView *devTools;
  BOOL onActivate{};
  BOOL keepsOutgoing{};
  CFTimeInterval activatedAt{};
  __weak NSWindow *activatedIn;
};

@interface ArdiaWebView () <ArdiaCoreTabDelegate> {
  __weak id<ArdiaWebViewDelegate> _delegate;
  ArdiaTabLifecycle _life;
  ArdiaRequests _requests;
  ArdiaSentReports _sent;
  ArdiaLeave _leave;
  ArdiaFrameHold _frameHold;
  ArdiaStandIn _standIn;
  ArdiaLittlePage _littlePage;
  ArdiaReveal _reveal;
  ArdiaPageFocusState _focus;
  ArdiaPageReports _reports;
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
  BOOL _muted;
  NSInteger _tabIndex;
  BOOL _pinned;
  NSView *_devtoolsView;
  CFTimeInterval _linkDropAt;
  id _sightObserver;
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
- (void)placeTab;
- (void)openedTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition;
- (void)announceOpenedTab:(ArdiaCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition tries:(int)tries;
- (void)tabRemovedFromWindow:(ArdiaCoreWindow *)window;
- (void)tabActivatedByChrome:(BOOL)chromes;
- (void)devToolsChanged:(NSView *)devToolsView;
- (void)dropDevTools;
@end

@interface ArdiaWebView (PaintingInternal)
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
- (void)beginFrameHoldIfCold;
- (void)finishFrameHold;
- (void)stopHolding;
- (void)takeFocusFromLingeringPane;
@end

@interface ArdiaWebView (StandInInternal)
- (void)lendPageToSuccessor;
- (void)reclaimLentPage;
- (BOOL)closesLentTab:(ArdiaCoreTab *)tab;
- (void)dropStandIn;
- (void)finishStandIn;
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
- (BOOL)peeksLinksToOtherSites;
- (void)fallBackFromPeek:(NSDictionary *)dict url:(NSString *)url frame:(NSString *)frameId reason:(NSString *)reason test:(BOOL)test;
- (void)peekLink:(NSDictionary *)dict frame:(NSString *)frameId main:(BOOL)main;
@end

@interface ArdiaWebView (PictureInPictureInternal)
- (void)traceManualPictureInPicture:(NSString *)what;
- (void)traceAutoPictureInPicture:(NSString *)what;
- (void)awaitPictureInPicture:(int)tries completion:(void (^)(BOOL))completion;
- (void)updateAutoPictureInPicture;
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
- (void)commandWheelFromPage:(NSDictionary *)reply;
@end

namespace ardia_web_view {

constexpr CFTimeInterval kNeighbourPagesAwakeSeconds = 10;

bool TraceVisibility();
NSHashTable<ArdiaWebView *> *LiveViews();
bool SamePage(NSString *a, NSString *b);
NSString *OriginOf(NSString *url);
NSString *VerifiedOrigin(NSString *origin);
void NoteEvent(int browserId, NSString *name, NSDictionary *payload);
void AcceptDrops(NSView *root, BOOL accept);
NSView *PaneUnder(NSView *view, NSView *ancestor);
NSView *SharedAncestor(NSView *a, NSView *b);

template <typename T>
T *Field(NSDictionary *d, NSString *key) {
  id value = d[key];
  return [value isKindOfClass:[T class]] ? value : nil;
}

NSString *Text(NSDictionary *d, NSString *key, NSUInteger max);
bool Flag(NSDictionary *d, NSString *key);
bool Finite(NSDictionary *d, NSString *key, double *out);

void AnswerHello(ArdiaCoreTab *tab, NSString *profile, NSString *frameId, BOOL main, NSString *verifiedOrigin);
NSMutableOrderedSet<NSString *> *ScriptFramesOf(ArdiaCoreTab *tab);

extern NSString *gPeekModifier;
void InstallPeekMonitor();
BOOL PeekTracing();
void PeekTrace(NSDictionary *entry);
NSString *SplitLinkModifier();
NSString *PeekConfigJSON(ArdiaWebView *view);

void InstallControlPressMonitor();
BOOL TracingPictureInPicture();

}
