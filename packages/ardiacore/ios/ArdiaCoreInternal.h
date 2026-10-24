#import <AppKit/AppKit.h>

#import "ArdiaCore.h"
#import "ArdiaCoreHost.h"
#import "ArdiaCoreTabStrip.h"

@class ArdiaCoreWebView;

NS_ASSUME_NONNULL_BEGIN

namespace ardiacore_host {

ArdiaCoreProfile *_Nullable LoadedProfile(NSString *name);
bool IsDeletedProfile(NSString *name);
void WithProfile(NSString *name, void (^completion)(ArdiaCoreProfile *_Nullable profile));
NSString *ProfileName(ArdiaCoreProfile *_Nullable profile);
NSString *ProfileNameOfDirectory(NSString *directory);
ArdiaCoreProfile *_Nullable PersonalIfLoaded(ArdiaCoreEngine *engine);
bool IsIncognito(NSString *name);
NSString *OriginalProfileName(NSString *_Nullable name);
NSString *OriginalProfileNameOf(ArdiaCoreProfile *_Nullable profile);
bool IsOffTheRecordOf(ArdiaCoreProfile *_Nullable profile, NSString *_Nullable name);
NSArray<NSString *> *LoadedProfileNames();

int BrowserId(ArdiaCoreTab *tab);
ArdiaCoreTab *_Nullable TabWithBrowserId(int browserId);

NSString *AppDisposition(NSString *chromeDisposition);

void InstallActivationGuardsEarly();
void InstallActivationGuardsLate();
bool Background();
void LogActivation(NSString *what);
void SetAppActive(bool active);
void ActToggleFullScreen(NSWindow *window);
void InstallTestCrashGuard(NSString *_Nullable dataDir);

void OpenPopupWindow(ArdiaCoreTab *tab, ArdiaCoreWebView *_Nullable opener);
bool IsReservedKeyEvent(NSEvent *event);
bool IsReservedBinding(NSString *key, NSString *unshiftedKey, NSEventModifierFlags modifiers);
NSUInteger PopupWindowCount();

}

@interface ArdiaCoreWindowController : NSObject <ArdiaCoreWindowDelegate>
+ (nullable ArdiaCoreWindowController *)forNSWindow:(nullable NSWindow *)window;
+ (NSArray<ArdiaCoreWindowController *> *)all;
@property(nonatomic, readonly) ArdiaCoreWindow *coreWindow;
@property(nonatomic, strong, nullable) NSView *root;
@property(nonatomic) NSInteger hostChanges;
@property(nonatomic, copy, nullable) NSString *appWindowId;
+ (ArdiaCoreWindowController *)strayWindowForProfile:(ArdiaCoreProfile *)profile;
+ (nullable ArdiaCoreWindowController *)chromeMadeWindowForProfile:(ArdiaCoreProfile *)profile;
@property(nonatomic, readonly) BOOL stray;
+ (ArdiaCoreWindowController *)standaloneWindowForProfile:(ArdiaCoreProfile *)profile;
@property(nonatomic, readonly) BOOL standalone;
- (void)noteClosing:(ArdiaCoreTab *)tab;
+ (nullable ArdiaCoreWindowController *)holding:(ArdiaCoreTab *)tab;
+ (nullable ArdiaCoreWebView *)hostingViewForProfile:(nullable ArdiaCoreProfile *)profile;
+ (BOOL)userSees:(nullable NSWindow *)window;
@end
extern NSNotificationName const ArdiaCoreWindowSeenDidChange;

@interface ArdiaCoreTabStrip (Engine)
+ (void)changedInWindow:(ArdiaCoreWindowController *)controller profile:(ArdiaCoreProfile *)profile;
+ (void)changedInWindow:(ArdiaCoreWindowController *)controller profile:(ArdiaCoreProfile *)profile cause:(nullable id)cause;
+ (void)windowClosed:(ArdiaCoreWindowController *)controller;
+ (void)activated:(ArdiaCoreTab *)tab inWindow:(ArdiaCoreWindowController *)controller;
+ (nullable ArdiaCoreTab *)activeTabInWindow:(ArdiaCoreWindowController *)controller profile:(ArdiaCoreProfile *)profile;
+ (void)removed:(ArdiaCoreTab *)tab fromWindow:(ArdiaCoreWindowController *)controller;
+ (void)setPinned:(BOOL)pinned tab:(ArdiaCoreTab *)tab;
@end

@interface ArdiaCoreProfile (Pending)
- (nullable NSString *)loadComponentExtension:(NSString *)path;
- (void)releaseNavigationHoldReady;
- (void)unloadComponentExtension:(NSString *)extensionId;
@end

namespace ardiacore_host {
NSArray<ArdiaCoreProfile *> *LoadedProfiles();
void LoadContentBlocker(NSString *profile);
void PrepareContentBlocker();
bool EngineHasTabModel();
}

@interface ArdiaCoreTabs : NSObject
+ (void)setView:(nullable ArdiaCoreWebView *)view forTab:(ArdiaCoreTab *)tab;
+ (nullable ArdiaCoreWebView *)viewForTab:(ArdiaCoreTab *)tab;
+ (NSString *)offerTab:(ArdiaCoreTab *)tab;
+ (NSString *)offerTab:(ArdiaCoreTab *)tab prefix:(NSString *)prefix;
+ (nullable ArdiaCoreTab *)takeOffered:(NSString *)adoptId;
+ (nullable ArdiaCoreTab *)offeredTab:(NSString *)adoptId;
+ (void)forget:(ArdiaCoreTab *)tab;
@end

@interface ArdiaCoreFavicons (Tabs)
+ (void)noteImage:(nullable NSImage *)image forURL:(nullable NSString *)url profile:(nullable NSString *)profile;
@end

NS_ASSUME_NONNULL_END
