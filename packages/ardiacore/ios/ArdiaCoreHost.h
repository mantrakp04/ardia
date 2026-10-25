#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ArdiaCoreHost : NSObject

+ (int)runWithArgc:(int)argc
              argv:(char *_Nullable *_Nonnull)argv
          delegate:(id<NSApplicationDelegate> (^)(void))makeDelegate NS_SWIFT_NAME(run(argc:argv:delegate:));

@property(class, readonly) BOOL isStarted;
@property(class, readonly) BOOL usesMockKeychain;
@property(class, readonly) NSString *dataDirectory;
@property(class, readonly) NSDictionary<NSString *, id> *engineInfo;
@property(class, readonly) NSArray<NSDictionary<NSString *, id> *> *chromeWindows;
@property(class, nonatomic, copy, nullable) void (^eventHandler)(NSString *name, NSDictionary<NSString *, id> *payload);
@property(class, readonly) NSArray<NSDictionary<NSString *, id> *> *displayMediaSources;
@property(class, nonatomic, copy, nullable) void (^chromeUIHandler)(NSString *name, NSDictionary<NSString *, id> *payload);
+ (void)resolveExternalApp:(NSString *)requestId open:(BOOL)open remember:(BOOL)remember NS_SWIFT_NAME(resolveExternalApp(_:open:remember:));
+ (void)deviceChooser:(int)chooserId select:(int)index NS_SWIFT_NAME(deviceChooser(_:select:));
+ (void)deviceChooser:(int)chooserId action:(NSString *)action NS_SWIFT_NAME(deviceChooser(_:action:));
+ (NSArray<NSDictionary *> *)testExternalLaunches;
+ (BOOL)devShowBluetoothChooser:(int)browserId unauthorized:(BOOL)unauthorized NS_SWIFT_NAME(devShowBluetoothChooser(browserId:unauthorized:));
+ (NSArray<NSDictionary *> *)testChooserEvents;
+ (BOOL)shareTabInstead:(int)capturerBrowserId target:(int)targetBrowserId NS_SWIFT_NAME(shareTabInstead(capturer:target:));
+ (BOOL)showCastDialog:(int)browserId NS_SWIFT_NAME(showCastDialog(browserId:));
+ (void)castDialog:(int)dialogId start:(NSString *)sink mode:(int)mode NS_SWIFT_NAME(castDialog(_:start:mode:));
+ (void)castDialog:(int)dialogId stop:(NSString *)route NS_SWIFT_NAME(castDialog(_:stop:));
+ (void)closeCastDialog:(int)dialogId NS_SWIFT_NAME(closeCastDialog(_:));
+ (void)watchCastRoutes:(NSString *)profile NS_SWIFT_NAME(watchCastRoutes(_:));
+ (void)terminateCastRoute:(NSString *)route NS_SWIFT_NAME(terminateCastRoute(_:));
+ (NSDictionary<NSString *, id> *)actionStates:(int)browserId extensions:(NSArray<NSString *> *)ids NS_SWIFT_NAME(actionStates(browserId:extensions:));
+ (nullable NSString *)sidePanelURL:(int)browserId extension:(NSString *)extensionId NS_SWIFT_NAME(sidePanelURL(browserId:extension:));
+ (void)resolveExtensionInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted
    NS_SWIFT_NAME(resolveExtensionInstallPrompt(_:accepted:));
@property(class, nonatomic, copy, nullable) void (^extensionsEventHandler)(NSString *name, NSDictionary<NSString *, id> *payload);
+ (void)beginTracing:(void (^)(BOOL started))completion;
+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *_Nullable path))completion NS_SWIFT_NAME(endTracing(keep:completion:));
@property(class, readonly) BOOL isTracing;
+ (void)deleteProfileData:(NSString *)profile completion:(void (^)(NSArray<NSString *> *remaining))completion
    NS_SWIFT_NAME(deleteProfileData(_:completion:));
+ (void)releaseProfile:(NSString *)profile;
+ (BOOL)stopCapture:(int)browserId NS_SWIFT_NAME(stopCapture(browserId:));
+ (BOOL)showAutofillSuggestions:(int)browserId passwords:(BOOL)passwords NS_SWIFT_NAME(showAutofillSuggestions(browserId:passwords:));
+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember
    NS_SWIFT_NAME(resolvePermission(_:result:remember:));

@end

@interface ArdiaCoreFavicons : NSObject
+ (void)fetch:(NSString *)url
       profile:(NSString *)profile
          name:(nullable NSString *)name
    completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(fetch(_:profile:name:completion:));
@end

NS_ASSUME_NONNULL_END
