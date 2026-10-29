#import <AppKit/AppKit.h>

#define ARDIACORE_EXPORT __attribute__((visibility("default")))

NS_ASSUME_NONNULL_BEGIN

@class ArdiaCoreEngine;
@class ArdiaCoreProfile;
@class ArdiaCoreTab;
@class ArdiaCoreWindow;

@protocol ArdiaCoreEngineDelegate <NSObject>
- (void)engineDidStart;
- (void)engineWillShutDown;
- (void)engineQuitCancelled;
- (nullable ArdiaCoreWindow*)engineWindowForNewBrowserOfProfile:(ArdiaCoreProfile*)profile
                                                        type:(NSString*)type;
- (void)engine:(ArdiaCoreEngine*)engine
    permissionRequest:(NSDictionary<NSString*, id>*)request
                  tab:(ArdiaCoreTab*)tab;
- (void)engine:(ArdiaCoreEngine*)engine permissionRequestDismissed:(NSString*)requestId;
- (void)engine:(ArdiaCoreEngine*)engine
    extensionSidePanel:(NSDictionary<NSString*, id>*)panel
                   tab:(ArdiaCoreTab*)tab;
- (BOOL)engine:(ArdiaCoreEngine*)engine
    extensionActionPopup:(NSDictionary<NSString*, id>*)popup
                     tab:(ArdiaCoreTab*)tab;
- (BOOL)engine:(ArdiaCoreEngine*)engine
    extensionActionShortcut:(NSDictionary<NSString*, id>*)shortcut
                        tab:(ArdiaCoreTab*)tab;
- (BOOL)engineIsReservedKeyEvent:(NSEvent*)event;
- (BOOL)engineIsReservedKey:(NSString*)key
               unshiftedKey:(NSString*)unshiftedKey
                  modifiers:(NSEventModifierFlags)modifiers;
- (void)engine:(ArdiaCoreEngine*)engine
    extensionInstallPrompt:(NSDictionary<NSString*, id>*)prompt
                   profile:(ArdiaCoreProfile*)profile
                       tab:(nullable ArdiaCoreTab*)tab;
- (void)engine:(ArdiaCoreEngine*)engine
    extensionInstallFailed:(NSString*)message
                       tab:(nullable ArdiaCoreTab*)tab;
- (void)engine:(ArdiaCoreEngine*)engine
    deviceChooser:(NSDictionary<NSString*, id>*)chooser
              tab:(ArdiaCoreTab*)tab;
- (void)engine:(ArdiaCoreEngine*)engine
    castDialog:(NSDictionary<NSString*, id>*)dialog
           tab:(ArdiaCoreTab*)tab;
- (void)engine:(ArdiaCoreEngine*)engine
    castRoutes:(NSArray<NSDictionary<NSString*, NSString*>*>*)routes
       profile:(ArdiaCoreProfile*)profile;
@end

ARDIACORE_EXPORT
@interface ArdiaCoreEngine : NSObject
+ (int)runWithArgc:(int)argc
              argv:(const char* _Nonnull* _Nonnull)argv
          delegate:(id<ArdiaCoreEngineDelegate>)delegate;
@property(class, readonly, nullable) ArdiaCoreEngine* sharedEngine;

@property(readonly) ArdiaCoreProfile* defaultProfile;
- (void)loadProfile:(NSString*)directoryName
         completion:(void (^)(ArdiaCoreProfile* _Nullable profile))completion;
- (void)quit;
@property(nonatomic, copy, nullable) NSString* pageScript;
+ (void)resolvePermission:(NSString*)requestId
                   result:(NSString*)result
                 remember:(BOOL)remember;
+ (void)resolveExtensionInstallPrompt:(NSString*)requestId accepted:(BOOL)accepted;
+ (void)startCasting:(int)dialogId sink:(NSString*)sinkId mode:(int)castMode;
+ (void)stopCasting:(int)dialogId route:(NSString*)routeId;
+ (void)closeCastDialog:(int)dialogId;
+ (void)terminateCastRoute:(NSString*)routeId;
+ (void)setAutoPictureInPicture:(BOOL)enabled;
+ (void)setVideoUpscaling:(BOOL)enabled;
+ (void)setVideoUpscalingTestConditions:(NSDictionary<NSString*, NSNumber*>*)conditions;
@property(class, readonly) NSDictionary<NSString*, id>* videoUpscalingState;
+ (void)reservedShortcutsChanged;
+ (void)selectDevice:(int)chooserId index:(int)index;
+ (void)cancelDeviceChooser:(int)chooserId;
+ (void)refreshDeviceChooser:(int)chooserId;
+ (void)openDeviceChooserSettings:(int)chooserId;
- (void)deleteProfile:(ArdiaCoreProfile*)profile
           completion:(nullable void (^)(BOOL deleted))completion;
- (void)releaseProfile:(ArdiaCoreProfile*)profile;
+ (void)resolveExternalApp:(NSString*)requestId open:(BOOL)open remember:(BOOL)remember;
@property(class, readonly) NSArray<NSDictionary*>* testExternalLaunches;
@property(class, readonly) NSArray<NSDictionary*>* testChooserEvents;
+ (void)allowDesktopCapture:(NSString*)sourceId
                        tab:(ArdiaCoreTab*)tab
                      frame:(nullable NSString*)frameId
                     origin:(nullable NSString*)origin
                      audio:(nullable NSString*)audio;
@property(class, readonly) NSDictionary<NSString*, NSNumber*>* desktopCaptureAudio;
- (void)offTheRecordProfileFor:(ArdiaCoreProfile*)profile
                    completion:(void (^)(ArdiaCoreProfile* _Nullable offTheRecord,
                                         NSString* _Nullable error))completion;
@property(readonly) NSString* chromiumVersion;
@property(readonly) NSString* keepAliveState;
@end

@interface ArdiaCoreEngine (Tracing)
+ (void)beginTracing:(void (^)(BOOL started))completion;
+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString* _Nullable path))completion;
@property(class, readonly) BOOL isTracing;
@end

ARDIACORE_EXPORT
@interface ArdiaCoreProfile : NSObject
@property(readonly) NSString* name;
@property(readonly) NSString* path;
@property(readonly) BOOL offTheRecord;
@property(readonly) BOOL destroyed;
- (nullable NSString*)loadComponentExtension:(NSString*)path;
- (void)unloadComponentExtension:(NSString*)extensionId;
- (void)warmSpareRenderer;
- (void)holdNavigationsUntilRulesetsOf:(NSString*)extensionId;
- (void)releaseNavigationHold:(NSString*)reason;
- (void)releaseNavigationHoldReady;
- (void)watchCastRoutes;
@property BOOL passwordsOffered;
@property BOOL addressesAutofilled;
@property BOOL cardsAutofilled;
- (void)clearBrowsingData:(NSArray<NSString*>*)types
                    since:(nullable NSDate*)since
               completion:(nullable void (^)(void))completion;
@end

@interface ArdiaCoreProfile (Icons)
- (void)fetchIcon:(NSString*)url
         maxBytes:(NSUInteger)maxBytes
       completion:(void (^)(NSData* _Nullable body))completion;
@end

@protocol ArdiaCoreWindowDelegate <NSObject>
@optional
- (void)window:(ArdiaCoreWindow*)window
    didInsertTab:(ArdiaCoreTab*)tab
          opener:(nullable ArdiaCoreTab*)opener
     disposition:(NSString*)disposition;
- (void)window:(ArdiaCoreWindow*)window didRemoveTab:(ArdiaCoreTab*)tab;
- (void)window:(ArdiaCoreWindow*)window didActivateTab:(ArdiaCoreTab*)tab;
- (void)window:(ArdiaCoreWindow*)window
    devToolsDidChangeForTab:(ArdiaCoreTab*)tab
                       view:(nullable NSView*)devToolsView;
- (void)window:(ArdiaCoreWindow*)window
                    tab:(ArdiaCoreTab*)tab
    didChangeFullscreen:(BOOL)fullscreen;
- (void)window:(ArdiaCoreWindow*)window
    passwordPrompt:(NSDictionary<NSString*, id>*)prompt
            forTab:(ArdiaCoreTab*)tab;
- (void)window:(ArdiaCoreWindow*)window
    autofillPrompt:(NSDictionary<NSString*, id>*)prompt
            forTab:(ArdiaCoreTab*)tab;
- (void)window:(ArdiaCoreWindow*)window
    passwordSavePromptForTab:(ArdiaCoreTab*)tab
                    username:(NSString*)username
                      origin:(NSString*)origin;
- (void)window:(ArdiaCoreWindow*)window showRequestedActive:(BOOL)active;
- (BOOL)windowShouldClose:(ArdiaCoreWindow*)window;
- (void)windowDidCancelClose:(ArdiaCoreWindow*)window;
- (void)window:(ArdiaCoreWindow*)window
    confirmCloseWithDownloads:(int)count
                   completion:(void (^)(BOOL closeAnyway))completion;
- (BOOL)window:(ArdiaCoreWindow*)window preHandleKeyEvent:(NSEvent*)event;
- (BOOL)window:(ArdiaCoreWindow*)window handleKeyEvent:(NSEvent*)event;
@end

ARDIACORE_EXPORT
@interface ArdiaCoreWindow : NSObject
+ (nullable NSView*)embeddedRootOfWindow:(NSWindow*)window;
+ (Class)contentViewClass;
+ (BOOL)isChromeFramelessWindow:(NSWindow*)window;
- (instancetype)initWithContentRect:(NSRect)rect;
@property(readonly) NSWindow* window;
@property(readonly) NSView* hostView;
@property(weak, nullable) id<ArdiaCoreWindowDelegate> delegate;

- (ArdiaCoreTab*)openTab:(NSString*)url
              profile:(ArdiaCoreProfile*)profile
           foreground:(BOOL)foreground;
- (nullable ArdiaCoreTab*)openExtensionView:(NSString*)url
                                 profile:(ArdiaCoreProfile*)profile
                                    kind:(NSString*)kind;
@property(nonatomic, nullable) ArdiaCoreProfile* activeProfile;
- (void)activateTab:(ArdiaCoreTab*)tab;
- (NSArray<ArdiaCoreTab*>*)tabsForProfile:(ArdiaCoreProfile*)profile;
- (int)chromeWindowIdForProfile:(ArdiaCoreProfile*)profile;
- (BOOL)executeChromeCommand:(int)commandId profile:(ArdiaCoreProfile*)profile;
- (void)showInactive;
@property(nonatomic) BOOL actedFullScreen;
- (void)close;

- (void)prepareProfile:(ArdiaCoreProfile*)profile;
- (void)adoptTab:(ArdiaCoreTab*)tab;
- (nullable ArdiaCoreTab*)restoreTab:(nullable NSString*)state
                          profile:(ArdiaCoreProfile*)profile
                       foreground:(BOOL)foreground;
- (nullable ArdiaCoreTab*)duplicateTab:(ArdiaCoreTab*)source
                            profile:(ArdiaCoreProfile*)profile
                         foreground:(BOOL)foreground;
- (void)placeTab:(ArdiaCoreTab*)tab index:(int)index pinned:(BOOL)pinned;
@property(nonatomic) BOOL internal;
@end

@protocol ArdiaCoreTabDelegate <NSObject>
@optional
- (void)tabDidChangeTitle:(ArdiaCoreTab*)tab;
- (void)tabDidChangeURL:(ArdiaCoreTab*)tab;
- (void)tabDidChangeLoading:(ArdiaCoreTab*)tab;
- (void)tabDidChangeProgress:(ArdiaCoreTab*)tab;
- (void)tabDidChangeFavicon:(ArdiaCoreTab*)tab;
- (void)tabDidChangeNavigationState:(ArdiaCoreTab*)tab;
- (void)tab:(ArdiaCoreTab*)tab didFindMatches:(int)count active:(int)active final:(BOOL)final;
- (void)tab:(ArdiaCoreTab*)tab
    didReceivePageMessage:(NSString*)kind
                     json:(NSString*)json
                    frame:(NSString*)frameId
                     main:(BOOL)main
                   origin:(NSString*)origin;
- (void)tabWillClose:(ArdiaCoreTab*)tab;
- (void)tab:(ArdiaCoreTab*)tab rendererGone:(NSString*)status code:(int)code;
- (void)tab:(ArdiaCoreTab*)tab didFailLoad:(NSString*)url code:(int)code description:(NSString*)text;
- (void)tab:(ArdiaCoreTab*)tab didChangeStatusText:(NSString*)text;
- (void)tab:(ArdiaCoreTab*)tab didRequestAppURL:(NSString*)url userGesture:(BOOL)userGesture;
- (void)tabDidChangeThemeColor:(ArdiaCoreTab*)tab;
- (void)tabDidCommitDocument:(ArdiaCoreTab*)tab;
- (void)tabDidGainFocus:(ArdiaCoreTab*)tab;
- (void)tabDidChangeAudio:(ArdiaCoreTab*)tab;
- (void)tabDidChangeSecurity:(ArdiaCoreTab*)tab;
- (void)tabDidChangeZoom:(ArdiaCoreTab*)tab;
- (void)tab:(ArdiaCoreTab*)tab didBlockPopup:(NSDictionary<NSString*, NSString*>*)popup;
- (void)tab:(ArdiaCoreTab*)tab preferredSizeDidChange:(NSSize)size;
- (void)tab:(ArdiaCoreTab*)tab externalAppRequest:(NSDictionary<NSString*, id>*)request;
- (void)tab:(ArdiaCoreTab*)tab requestsActivation:(NSString*)reason;
- (void)tab:(ArdiaCoreTab*)tab didChangePictureInPicture:(NSDictionary<NSString*, id>*)state;
- (void)tab:(ArdiaCoreTab*)tab didShowAutofillSuggestions:(NSArray<NSDictionary<NSString*, NSString*>*>*)items;
- (void)tab:(ArdiaCoreTab*)tab didBlockRequests:(int)count lastURL:(NSString*)url;
- (NSArray<NSDictionary<NSString*, NSString*>*>*)tab:(ArdiaCoreTab*)tab
                         contextMenuItemsForSelection:(NSString*)text;
- (void)tab:(ArdiaCoreTab*)tab
    contextMenuCommand:(NSString*)itemId
                  text:(NSString*)selection
             modifiers:(NSDictionary<NSString*, NSNumber*>*)modifiers;
- (void)tab:(ArdiaCoreTab*)tab didShowContextMenu:(NSArray<NSDictionary*>*)items;
- (nullable NSDictionary<NSString*, id>*)tab:(ArdiaCoreTab*)tab
                              runContextMenu:(NSDictionary<NSString*, id>*)menu;
- (void)tab:(ArdiaCoreTab*)tab navigationBecameDownload:(NSString*)url;
- (void)tabDidChangeDiscarded:(ArdiaCoreTab*)tab;
- (void)tabBecameUnresponsive:(ArdiaCoreTab*)tab;
- (void)tabBecameResponsive:(ArdiaCoreTab*)tab;
- (void)tab:(ArdiaCoreTab*)tab didChangeMediaAccess:(NSDictionary<NSString*, NSNumber*>*)access;
@end

ARDIACORE_EXPORT
@interface ArdiaCoreTab : NSObject
@property(readonly) NSView* view;
@property(readonly, weak) ArdiaCoreProfile* profile;
@property(readonly) int tabId;
@property(readonly) NSString* url;
@property(readonly) NSString* title;
@property(readonly) BOOL loading;
@property(readonly) double progress;
@property(readonly, nullable) NSImage* favicon;
@property(readonly) BOOL canGoBack;
@property(readonly) BOOL canGoForward;
@property(readonly) BOOL closed;
@property(weak, nullable) id<ArdiaCoreTabDelegate> delegate;

- (void)focus;
- (void)find:(NSString*)text forward:(BOOL)forward;
- (void)stopFinding;
- (void)close;
@property(readonly, nullable) NSDictionary<NSString*, id>* passwordPrompt;
- (void)resolvePasswordPrompt:(NSString*)action
                     username:(nullable NSString*)username
                     password:(nullable NSString*)password;
@property(readonly, nullable) NSDictionary<NSString*, id>* autofillPrompt;
- (void)resolveAutofillPrompt:(NSInteger)promptId action:(NSString*)action;

@property(readonly, nullable) NSString* faviconURL;
@property(readonly, nullable) NSString* themeColor;
@property(readonly) BOOL audible;
@property(nonatomic) BOOL muted;
@property(readonly) int browserId;
@property(readonly, nullable) NSString* committedOrigin;
+ (nullable NSString*)originForURL:(NSString*)url;
@property(readonly) BOOL initialDocumentAccessed;
@property(readonly) BOOL committedInitial;
- (nullable id)suppressInput;
- (void)closeNow;
@property(nonatomic) BOOL temporary;
- (void)setTemporarySource:(nullable ArdiaCoreTab*)source;
- (void)deliverHeldPageMessages;
@property(readonly) NSDictionary<NSString*, id>* securityInfo;
- (BOOL)discard;
@property(readonly) BOOL discarded;
@property(nonatomic) BOOL frozen;
- (void)resolveUnresponsive:(BOOL)terminate;
- (BOOL)showAutofillSuggestions:(BOOL)passwords;
@property(readonly, nullable) NSDictionary<NSString*, NSNumber*>* popupFeatures;
@property(readonly) NSSize preferredSize;
@end

@interface ArdiaCoreTab (Navigation)
- (void)goBack;
- (void)goForward;
- (void)reload;
- (void)stop;
- (void)loadURL:(NSString*)url userInitiated:(BOOL)userInitiated;
- (void)goToOffset:(int)offset;
- (void)reloadIgnoringCache;
- (void)loadIfNeeded;
@property(readonly) NSArray<NSDictionary<NSString*, id>*>* navigationEntries;
@end

@interface ArdiaCoreTab (Page)
- (void)executeJavaScript:(NSString*)code frame:(nullable NSString*)frameId;
- (void)evaluate:(NSString*)code completion:(void (^)(NSString* _Nullable json))completion;
- (BOOL)hasLiveFrame:(NSString*)frameId;
- (void)callPage:(NSString*)kind json:(NSString*)json;
- (void)callFrame:(NSString*)frameId kind:(NSString*)kind json:(NSString*)json;
- (void)grantUserActivationToFrame:(NSString*)frameId;
@property(nonatomic, nullable) NSColor* pageBackgroundColor;
@property(nonatomic, copy, nullable) NSString* pageColor;
@property(nonatomic, nullable) NSColor* contentsBackgroundColor;
@property(nonatomic) double zoomFactor;
- (void)zoomStep:(int)direction;
@property(readonly) double pinchScale;
@end

@interface ArdiaCoreTab (Commands)
- (BOOL)executeChromeCommand:(int)command;
- (void)openBlockedPopup:(NSString*)popupId always:(BOOL)always;
- (void)showDevTools;
- (void)closeDevTools;
@property(readonly, nullable) NSView* devToolsView;
- (void)devToolsLayoutForSize:(NSSize)size
                     devTools:(NSRect*)devToolsFrame
                         page:(NSRect*)pageFrame;
- (void)devToolsCall:(NSString*)method
              params:(nullable NSDictionary*)params
             timeout:(NSTimeInterval)timeout
          completion:(void (^)(NSDictionary* _Nullable result,
                               NSString* _Nullable error))completion;
@end

@interface ArdiaCoreTab (Media)
@property(readonly, nullable) NSString* mediaCaptureSourceId;
- (void)copyPicture:(NSTimeInterval)timeout completion:(void (^)(CGImageRef _Nullable picture))completion;
- (BOOL)stopCapture;
- (void)noteShownByHost:(BOOL)shown;
- (void)exitFullscreen;
- (void)exitExclusiveAccess;
- (void)tracePictureInPicture:(NSString*)line withInputs:(BOOL)withInputs;
- (void)exitPictureInPicture;
- (void)enterPictureInPictureForClickAt:(NSTimeInterval)clickTime
                             completion:(void (^)(NSString* route, BOOL opened))completion;
- (BOOL)canShareThisTabInsteadFor:(ArdiaCoreTab*)capturer;
- (BOOL)shareThisTabInsteadFor:(ArdiaCoreTab*)capturer;
- (BOOL)showCastDialog;
- (BOOL)devShowBluetoothChooser:(BOOL)unauthorized;
@end

@interface ArdiaCoreTab (Extensions)
- (NSString*)executeExtensionAction:(NSString*)extensionId;
- (NSDictionary<NSString*, NSDictionary*>*)actionStatesForExtensions:(NSArray<NSString*>*)extensionIds;
- (nullable NSString*)sidePanelURLForExtension:(NSString*)extensionId;
@end

typedef NS_ENUM(NSInteger, ArdiaCorePageScrollAck) {
  ArdiaCorePageScrollAckBegin,
  ArdiaCorePageScrollAckUpdate,
};

@protocol ArdiaCorePageScrollObserver <NSObject>
- (void)pageView:(NSView*)view
     ackedScroll:(ArdiaCorePageScrollAck)ack
        consumed:(BOOL)consumed;
- (void)pageView:(NSView*)view overscrolledAllowingHorizontal:(BOOL)allowed;
@end

ARDIACORE_EXPORT
@interface ArdiaCorePageView : NSObject
+ (BOOL)isPageView:(NSView*)view;
+ (void)setScrollObserver:(nullable id<ArdiaCorePageScrollObserver>)observer;
+ (BOOL)takeSwipes:(NSView*)view;
+ (BOOL)takesSwipes:(NSView*)view;
+ (BOOL)isEditingText:(NSView*)view;
@end

NS_ASSUME_NONNULL_END
