#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaHost : NSObject

@property(class, readonly) BOOL isStarted;
@property(class, readonly) NSString *dataDirectory;
@property(class, readonly) NSDictionary<NSString *, id> *engineInfo;
@property(class, readonly) NSArray<NSDictionary<NSString *, id> *> *chromeWindows;
@property(class, readonly) NSArray<NSDictionary<NSString *, id> *> *displayMediaSources;
+ (void)resolveExternalApp:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember NS_SWIFT_NAME(resolveExternalApp(_:open:remember:));
+ (void)deviceChooser:(int)chooserId select:(int)index NS_SWIFT_NAME(deviceChooser(_:select:));
+ (void)deviceChooser:(int)chooserId action:(NSString *)action NS_SWIFT_NAME(deviceChooser(_:action:));
+ (NSArray<NSDictionary *> *)testExternalLaunches;
+ (BOOL)devShowBluetoothChooser:(NSString *)tabId unauthorized:(BOOL)unauthorized NS_SWIFT_NAME(devShowBluetoothChooser(tabId:unauthorized:));
+ (NSArray<NSDictionary *> *)testChooserEvents;
+ (BOOL)shareTabInstead:(NSString *)capturerTabId target:(NSString *)targetTabId NS_SWIFT_NAME(shareTabInstead(capturer:target:));
+ (BOOL)showCastDialog:(NSString *)tabId NS_SWIFT_NAME(showCastDialog(tabId:));
+ (void)castDialog:(int)dialogId start:(NSString *)sink mode:(int)mode NS_SWIFT_NAME(castDialog(_:start:mode:));
+ (void)castDialog:(int)dialogId stop:(NSString *)route NS_SWIFT_NAME(castDialog(_:stop:));
+ (void)closeCastDialog:(int)dialogId NS_SWIFT_NAME(closeCastDialog(_:));
+ (void)watchCastRoutes:(NSString *)profile NS_SWIFT_NAME(watchCastRoutes(_:));
+ (void)terminateCastRoute:(NSString *)route NS_SWIFT_NAME(terminateCastRoute(_:));
+ (NSDictionary<NSString *, id> *)actionStates:(NSString *)tabId extensions:(NSArray<NSString *> *)ids NS_SWIFT_NAME(actionStates(tabId:extensions:));
+ (nullable NSString *)sidePanelURL:(NSString *)tabId extension:(NSString *)extensionId NS_SWIFT_NAME(sidePanelURL(tabId:extension:));
+ (void)resolveExtensionInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted
    NS_SWIFT_NAME(resolveExtensionInstallPrompt(_:accepted:));
+ (void)replayInstallPrompts;
+ (void)beginTracing:(void (^)(BOOL started))completion;
+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *_Nullable path))completion NS_SWIFT_NAME(endTracing(keep:completion:));
@property(class, readonly) BOOL isTracing;
+ (void)deleteProfileData:(NSString *)profile completion:(void (^)(NSArray<NSString *> *remaining))completion
    NS_SWIFT_NAME(deleteProfileData(_:completion:));
+ (void)releaseProfile:(NSString *)profile;
+ (BOOL)stopCapture:(NSString *)tabId NS_SWIFT_NAME(stopCapture(tabId:));
+ (BOOL)showAutofillSuggestions:(NSString *)tabId passwords:(BOOL)passwords NS_SWIFT_NAME(showAutofillSuggestions(tabId:passwords:));
+ (int)chromeTabIdOfTab:(NSString *)tabId NS_SWIFT_NAME(chromeTabId(ofTab:));
+ (BOOL)isPrivateProfile:(NSString *)profile NS_SWIFT_NAME(isPrivateProfile(_:));
@property(class, nullable, copy) void (^quitCancelledHandler)(void);
+ (void)menuShortcutsChanged;
+ (NSString *)baseProfileOf:(NSString *)profile NS_SWIFT_NAME(baseProfile(of:));
+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember
    NS_SWIFT_NAME(resolvePermission(_:result:remember:));

@end

@interface ArdiaHost (Launch)

+ (int)runWithArgc:(int)argc
              argv:(char *_Nullable *_Nonnull)argv
          delegate:(id<NSApplicationDelegate> (^)(void))makeDelegate NS_SWIFT_NAME(run(argc:argv:delegate:));

@end

NS_ASSUME_NONNULL_END
