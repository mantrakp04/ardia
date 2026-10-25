#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@class ArdiaCoreWebView;

@protocol ArdiaCoreWebViewDelegate <NSObject>
- (void)webView:(ArdiaCoreWebView *)view event:(NSString *)name payload:(NSDictionary<NSString *, id> *)payload;
@end

@interface ArdiaCoreWebView : NSView

@property (nonatomic, weak, nullable) id<ArdiaCoreWebViewDelegate> delegate;
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

+ (void)prepareTransfer:(NSString *)transferKey;
+ (void)releaseTransfer:(NSString *)transferKey;
+ (void)startLaunchTab:(NSString *)transferKey url:(NSString *)url profile:(NSString *)profile;
+ (void)claimLaunchTab:(NSString *)transferKey url:(NSString *)url profile:(NSString *)profile;
+ (void)revealTab:(NSString *)transferKey;
+ (void)dropTabReveals:(NSString *)transferKey;
+ (void)revealOffered:(NSString *)adoptId over:(NSString *)transferKey;
+ (void)startLinkTabs:(NSArray<NSString *> *)urls profile:(NSString *)profile;
+ (NSDictionary<NSString *, id> *)routeLinkTabs:(NSArray<NSString *> *)urls;
+ (void)setSearchEngineName:(NSString *)name;
+ (void)installScrollZoom;
+ (void)installSwitchPrewarm;
+ (void)installOutgoingFocusSnapshots;
+ (NSArray<NSNumber *> *)devScrollZoom:(NSArray<NSDictionary<NSString *, id> *> *)steps
                               browser:(int)browserId NS_SWIFT_NAME(devScrollZoom(_:browserId:));
+ (void)setDisplayMediaPicker:(BOOL)enabled;
+ (void)setPeekModifier:(NSString *)modifier;
+ (void)setSplitLinkModifier:(NSString *)modifier;
+ (void)setSelectionPopoverEnabled:(BOOL)enabled NS_SWIFT_NAME(setSelectionPopoverEnabled(_:));
+ (BOOL)devPostPeekMouseUp:(NSString *)keys over:(NSString *)transferKey;
+ (void)setAutoPictureInPictureEnabled:(BOOL)enabled NS_SWIFT_NAME(setAutoPictureInPictureEnabled(_:));
+ (void)setVideoUpscalingEnabled:(BOOL)enabled NS_SWIFT_NAME(setVideoUpscalingEnabled(_:));
+ (void)setVideoUpscalingTestConditions:(NSDictionary<NSString *, NSNumber *> *)conditions
    NS_SWIFT_NAME(setVideoUpscalingTestConditions(_:));
+ (NSDictionary<NSString *, id> *)videoUpscalingState;
+ (NSArray<NSDictionary<NSString *, id> *> *)devEventsForBrowser:(int)browserId NS_SWIFT_NAME(devEvents(browserId:));
+ (NSInteger)devWindowNumberForBrowser:(int)browserId NS_SWIFT_NAME(devWindowNumber(browserId:));
+ (NSArray<NSDictionary<NSString *, id> *> *)devPictureInPicture NS_SWIFT_NAME(devPictureInPicture());
+ (NSString *)devPictureInPictureAction:(NSString *)action NS_SWIFT_NAME(devPictureInPictureAction(_:));
+ (BOOL)devFocusPageOfBrowser:(int)browserId NS_SWIFT_NAME(devFocusPage(browserId:));

- (void)loadURL:(NSString *)url;
- (void)loadURL:(NSString *)url userInitiated:(BOOL)userInitiated NS_SWIFT_NAME(loadURL(_:userInitiated:));
- (void)goBack;
- (void)goForward;
- (void)goToHistoryOffset:(NSInteger)offset;
- (void)reload;
- (void)reloadIgnoringCache;
- (void)stopLoading;
- (void)focusPage;
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
- (BOOL)takeControlPressAt:(double)clickMs control:(NSInteger)target NS_SWIFT_NAME(takeControlPress(clickAt:control:));
- (void)requestPictureInPictureForClickAt:(double)clickMs
                                  control:(NSInteger)target
                               completion:(void (^)(BOOL ok))completion NS_SWIFT_NAME(requestPictureInPicture(clickAt:control:_:));
- (void)exitPictureInPicture;

- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *info))completion NS_SWIFT_NAME(securityInfo(_:));
- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always NS_SWIFT_NAME(openBlockedPopup(_:always:));
- (void)clearSiteData:(void (^)(NSDictionary<NSString *, id> *result))completion NS_SWIFT_NAME(clearSiteData(_:));

- (void)resolvePasswordPrompt:(NSString *)action username:(nullable NSString *)username password:(nullable NSString *)password
    NS_SWIFT_NAME(resolvePasswordPrompt(_:username:password:));
- (void)resolveAutofillPrompt:(NSInteger)promptId action:(NSString *)action NS_SWIFT_NAME(resolveAutofillPrompt(_:action:));
- (nullable NSString *)executeExtensionAction:(NSString *)extensionId NS_SWIFT_NAME(executeExtensionAction(_:));

- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(nullable NSString *)sourceId audio:(BOOL)audio
    NS_SWIFT_NAME(resolveDisplayMedia(_:sourceId:audio:));
@property (nonatomic, readonly, nullable) NSString *mediaCaptureSourceId;

- (void)notificationAction:(NSString *)notificationId action:(NSString *)action NS_SWIFT_NAME(notificationAction(_:action:));

- (void)resolveUnresponsive:(BOOL)terminate NS_SWIFT_NAME(resolveUnresponsive(terminate:));
- (NSString *)discard:(BOOL)unload NS_SWIFT_NAME(discard(unload:));
- (void)closeBrowser;

@end

NS_ASSUME_NONNULL_END
