#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ACChromeWindowHost : NSObject

+ (nullable NSWindow *)makeWindowForProfile:(NSString *)profile;
+ (nullable NSWindow *)makeWindowForProfile:(NSString *)profile chromeWindow:(nullable NSString *)chromeWindow;
+ (nullable NSWindow *)makeWindowForProfile:(NSString *)profile
                               chromeWindow:(nullable NSString *)chromeWindow
                                  appWindow:(nullable NSString *)appWindow;

+ (void)recordLaunchLayout;
+ (void)forgetLaunchPictures;
+ (BOOL)takeDismissedAppWindow:(NSString *)appWindow;

+ (void)embedRootView:(NSView *)root inWindow:(NSWindow *)window;

+ (nullable NSView *)rootViewOfWindow:(NSWindow *)window;

+ (void)removeRootViewOfWindow:(NSWindow *)window;

+ (void)setTrafficLightsCenter:(nullable NSValue *)center inWindow:(NSWindow *)window;
+ (void)moveTrafficLightsCenter:(nullable NSValue *)center inWindow:(NSWindow *)window;

+ (void)closeWindow:(NSWindow *)window;

+ (void)showProfile:(NSString *)profile inWindow:(NSWindow *)window;
+ (void)prepareProfiles:(NSArray<NSString *> *)profiles forWindow:(NSWindow *)window;
@property(class, nonatomic, copy, nullable) void (^swappedHandler)(NSWindow *from, NSWindow *to);

@property(class, nonatomic, copy, nullable) BOOL (^shouldCloseHandler)(NSWindow *window);
@property(class, nonatomic, copy, nullable) BOOL (^refusesUnhandledKeyHandler)(NSWindow *window, NSEvent *event);
+ (BOOL)windowShouldClose:(NSWindow *)window;
+ (BOOL)windowFullScreenIsForPage:(NSWindow *)window;

@end

NSView *_Nullable ACWindowRootView(NSWindow *_Nullable window);
NSValue *_Nullable ACTrafficLightsCenter(NSWindow *_Nullable window);

@interface ACChromeWindowHost (Dev)

+ (nullable NSString *)devAction:(NSString *)action window:(NSWindow *)window;

@end

NS_ASSUME_NONNULL_END
