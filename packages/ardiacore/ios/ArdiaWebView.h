#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@class ArdiaWebView;

@protocol ArdiaWebViewDelegate <NSObject>
- (void)webView:(ArdiaWebView *)view event:(NSString *)name payload:(NSDictionary<NSString *, id> *)payload;
@end

@interface ArdiaWebView : NSView

@property (nonatomic, weak, nullable) id<ArdiaWebViewDelegate> delegate;
@property (nonatomic, copy) NSString *profile;
@property (nonatomic, copy, nullable) NSString *initialURL;
@property (nonatomic, copy, nullable) NSString *adoptId;
@property (nonatomic, copy, nullable) NSString *transferKey;
@property (nonatomic) BOOL standalone;
@property (nonatomic) BOOL temporary;
@property (nonatomic, copy, nullable) NSString *temporarySource;
@property (nonatomic, copy, nullable) NSString *extensionHost;
@property (nonatomic, strong, nullable) NSColor *pageBackgroundColor;
@property (nonatomic, strong, nullable) NSColor *contentsBackgroundColor;
@property (nonatomic, copy, nullable) NSString *pageColor;
@property (nonatomic, copy, nullable) NSString *shownURL;
@property (nonatomic) BOOL visible;
@property (nonatomic) BOOL warm;
@property (nonatomic) BOOL neighbour;
@property (nonatomic) BOOL autoPictureInPicture;
@property (nonatomic, readonly) BOOL discarded;
@property (nonatomic) BOOL frozen;
@property (nonatomic, readonly) int browserId;
@property (nonatomic, readonly, nullable) NSString *mediaCaptureSourceId;
@property (nonatomic, readonly, nullable) NSView *devtoolsView;

+ (NSArray<NSDictionary<NSString *, id> *> *)devEventsForBrowser:(int)browserId NS_SWIFT_NAME(devEvents(browserId:));
+ (NSInteger)devWindowNumberForBrowser:(int)browserId NS_SWIFT_NAME(devWindowNumber(browserId:));
+ (BOOL)devFocusPageOfBrowser:(int)browserId NS_SWIFT_NAME(devFocusPage(browserId:));
+ (int)browserIdOfTab:(nullable NSString *)tabId NS_SWIFT_NAME(browserId(ofTab:));

@end

@interface ArdiaWebView (Transfer)
+ (void)prepareTransfer:(NSString *)transferKey;
+ (void)releaseTransfer:(NSString *)transferKey;
+ (void)startLaunchTab:(NSString *)transferKey url:(NSString *)url profile:(NSString *)profile;
+ (void)claimLaunchTab:(NSString *)transferKey url:(NSString *)url profile:(NSString *)profile;
+ (void)startLinkTabs:(NSArray<NSString *> *)urls profile:(NSString *)profile;
+ (NSDictionary<NSString *, id> *)routeLinkTabs:(NSArray<NSString *> *)urls;
- (void)closeBrowser;
@end

@interface ArdiaWebView (Tab)
- (void)resolveUnresponsive:(BOOL)terminate NS_SWIFT_NAME(resolveUnresponsive(terminate:));
- (NSString *)discard:(BOOL)unload NS_SWIFT_NAME(discard(unload:));
@end

@interface ArdiaWebView (Reveals)
+ (void)revealTab:(NSString *)transferKey;
+ (void)dropTabReveals:(NSString *)transferKey;
+ (void)revealOffered:(NSString *)adoptId over:(NSString *)transferKey;
@end

@interface ArdiaWebView (Focus)
+ (void)installOutgoingFocusSnapshots;
- (void)focusPage;
@end

@interface ArdiaWebView (InputMonitors)
+ (void)installScrollZoom;
+ (void)installSwitchPrewarm;
+ (void)setCommandScrollZoomEnabled:(BOOL)enabled NS_SWIFT_NAME(setCommandScrollZoomEnabled(_:));
+ (NSArray<NSNumber *> *)devScrollZoom:(NSArray<NSDictionary<NSString *, id> *> *)steps
                               browser:(int)browserId NS_SWIFT_NAME(devScrollZoom(_:browserId:));
@end

@interface ArdiaWebView (PageMessages)
+ (void)setDisplayMediaPicker:(BOOL)enabled;
+ (void)setSelectionPopoverEnabled:(BOOL)enabled NS_SWIFT_NAME(setSelectionPopoverEnabled(_:));
- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(nullable NSString *)sourceId audio:(BOOL)audio
    NS_SWIFT_NAME(resolveDisplayMedia(_:sourceId:audio:));
@end

@interface ArdiaWebView (Peek)
+ (void)setPeekModifier:(NSString *)modifier;
+ (void)setSplitLinkModifier:(NSString *)modifier;
+ (BOOL)devPostPeekMouseUp:(NSString *)keys over:(NSString *)transferKey;
@end

@interface ArdiaWebView (ContextMenu)
+ (void)setSearchEngineName:(NSString *)name;
@end

@interface ArdiaWebView (PictureInPicture)
+ (void)setAutoPictureInPictureEnabled:(BOOL)enabled NS_SWIFT_NAME(setAutoPictureInPictureEnabled(_:));
+ (void)setVideoUpscalingEnabled:(BOOL)enabled NS_SWIFT_NAME(setVideoUpscalingEnabled(_:));
+ (void)setVideoUpscalingTestConditions:(NSDictionary<NSString *, NSNumber *> *)conditions
    NS_SWIFT_NAME(setVideoUpscalingTestConditions(_:));
+ (NSDictionary<NSString *, id> *)videoUpscalingState;
- (BOOL)takeControlPressAt:(double)clickMs control:(NSInteger)target NS_SWIFT_NAME(takeControlPress(clickAt:control:));
- (void)requestPictureInPictureForClickAt:(double)clickMs
                                  control:(NSInteger)target
                               completion:(void (^)(BOOL ok))completion NS_SWIFT_NAME(requestPictureInPicture(clickAt:control:_:));
- (void)exitPictureInPicture;
@end

@interface ArdiaWebView (PictureInPictureDev)
+ (NSArray<NSDictionary<NSString *, id> *> *)devPictureInPicture NS_SWIFT_NAME(devPictureInPicture());
+ (NSString *)devPictureInPictureAction:(NSString *)action NS_SWIFT_NAME(devPictureInPictureAction(_:));
@end

@interface ArdiaWebView (Navigation)
- (void)loadURL:(NSString *)url userInitiated:(BOOL)userInitiated NS_SWIFT_NAME(loadURL(_:userInitiated:));
- (void)goBack;
- (void)goForward;
- (void)goToHistoryOffset:(NSInteger)offset;
- (void)reload;
- (void)reloadIgnoringCache;
- (void)stopLoading;
- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always NS_SWIFT_NAME(openBlockedPopup(_:always:));
@end

@interface ArdiaWebView (PageCommands)
- (void)setMuted:(BOOL)muted;
- (void)setZoomFactor:(double)factor;
- (void)zoomStep:(NSInteger)direction NS_SWIFT_NAME(zoomStep(_:));
- (void)find:(NSString *)text forward:(BOOL)forward findNext:(BOOL)findNext;
- (void)stopFinding:(BOOL)clearSelection;
- (void)print;
- (void)showDevTools;
- (void)showDevToolsPanel:(nullable NSString *)panel NS_SWIFT_NAME(showDevTools(panel:));
- (void)runPageCommand:(NSString *)name NS_SWIFT_NAME(runPageCommand(_:));
- (void)executeJavaScript:(NSString *)code;
- (void)evaluate:(NSString *)code completion:(void (^)(NSString *_Nullable json))completion;
- (void)capturePicture:(double)scale completion:(void (^)(NSDictionary<NSString *, id> *_Nullable picture))completion;
- (void)navigationEntries:(void (^)(NSArray<NSDictionary<NSString *, id> *> *entries))completion;
- (void)downloadFavicon:(NSString *)url name:(nullable NSString *)name
             completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(downloadFavicon(_:name:completion:));
- (void)downloadImage:(NSString *)url
            maxPixels:(NSInteger)maxPixels
           completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(downloadImage(_:maxPixels:completion:));
- (void)mediaCommand:(NSString *)action seconds:(double)seconds NS_SWIFT_NAME(mediaCommand(_:seconds:));
@end

@interface ArdiaWebView (Site)
- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *info))completion NS_SWIFT_NAME(securityInfo(_:));
- (void)pageCookies:(NSArray<NSString *> *)urls
         completion:(void (^)(NSArray<NSDictionary<NSString *, id> *> *_Nullable cookies))completion
    NS_SWIFT_NAME(pageCookies(_:completion:));
- (void)clearSiteData:(void (^)(id _Nullable result, NSString *_Nullable error))reply NS_SWIFT_NAME(clearSiteData(_:));
- (void)resolvePasswordPrompt:(NSString *)action username:(nullable NSString *)username password:(nullable NSString *)password
    NS_SWIFT_NAME(resolvePasswordPrompt(_:username:password:));
- (void)resolveAutofillPrompt:(NSInteger)promptId action:(NSString *)action NS_SWIFT_NAME(resolveAutofillPrompt(_:action:));
- (nullable NSString *)executeExtensionAction:(NSString *)extensionId NS_SWIFT_NAME(executeExtensionAction(_:));
- (void)notificationAction:(NSString *)notificationId action:(NSString *)action NS_SWIFT_NAME(notificationAction(_:action:));
@end

NS_ASSUME_NONNULL_END
