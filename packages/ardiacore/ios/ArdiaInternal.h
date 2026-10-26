#import <AppKit/AppKit.h>

#import "ArdiaCore.h"
#import "ArdiaEvents.h"
#import "ArdiaFavicons.h"
#import "ArdiaHost.h"
#import "ArdiaTabStrip.h"
#import "ArdiaTabRegistry.h"
#import "ArdiaWindowController.h"

@class ArdiaWebView;

NS_ASSUME_NONNULL_BEGIN

namespace ardia_host {

ArdiaCoreProfile *_Nullable LoadedProfile(NSString *name);
bool IsDeletedProfile(NSString *name);
void WithProfile(NSString *name, void (^completion)(ArdiaCoreProfile *_Nullable profile));
NSString *ProfileName(ArdiaCoreProfile *_Nullable profile);
NSString *ProfileNameOfDirectory(NSString *directory);
ArdiaCoreProfile *_Nullable PersonalIfLoaded(ArdiaCoreEngine *engine);
bool IsPrivateProfile(NSString *_Nullable name);
bool IsPrivateSessionId(NSString *_Nullable name);
NSString *ProfileDirectoryName(NSString *_Nullable name);
NSString *ProfileNameOfDirectoryName(NSString *_Nullable directory);
NSString *OriginalProfileName(NSString *_Nullable name);
NSString *OriginalProfileNameOf(ArdiaCoreProfile *_Nullable profile);
bool IsOffTheRecordOf(ArdiaCoreProfile *_Nullable profile, NSString *_Nullable name);
NSArray<NSString *> *LoadedProfileNames();

int BrowserId(ArdiaCoreTab *tab);
ArdiaCoreTab *_Nullable TabWithBrowserId(int browserId);
NSString *_Nullable AppTabIdOf(ArdiaCoreTab *_Nullable tab);
id AppTabIdValue(ArdiaCoreTab *_Nullable tab);
ArdiaCoreTab *_Nullable TabWithAppTabId(NSString *_Nullable tabId);
void HoldUntilHosted(ArdiaCoreTab *tab, NSString *event, NSDictionary *payload);
void ReleaseHeldEvents(ArdiaCoreTab *tab);
void DropHeldEvent(NSString *event, NSString *eventId);

NSString *AppDisposition(NSString *chromeDisposition);

void InstallActivationGuardsEarly();
void InstallActivationGuardsLate();
bool Background();
void LogActivation(NSString *what);
void SetAppActive(bool active);
void ActToggleFullScreen(NSWindow *window);
void InstallTestCrashGuard(NSString *_Nullable dataDir);

void OpenPopupWindow(ArdiaCoreTab *tab, ArdiaWebView *_Nullable opener);
bool IsReservedKeyEvent(NSEvent *event);
bool IsReservedBinding(NSString *key, NSString *unshiftedKey, NSEventModifierFlags modifiers);
NSUInteger PopupWindowCount();
bool AskPermissionInPopupWindow(ArdiaCoreTab *tab, NSDictionary *request);
void DropPopupWindowPermission(NSString *requestId);
void NotePasswordPromptSource(ArdiaWebView *view, ArdiaCoreTab *_Nullable source);
ArdiaCoreTab *_Nullable PasswordPromptTab(ArdiaWebView *view, ArdiaCoreTab *_Nullable own);

}

@interface ArdiaTabStrip (Engine)
+ (void)changedInWindow:(ArdiaWindowController *)controller profile:(ArdiaCoreProfile *)profile;
+ (void)changedInWindow:(ArdiaWindowController *)controller profile:(ArdiaCoreProfile *)profile cause:(nullable id)cause;
+ (void)windowClosed:(ArdiaWindowController *)controller;
+ (void)activated:(ArdiaCoreTab *)tab inWindow:(ArdiaWindowController *)controller;
+ (nullable ArdiaCoreTab *)activeTabInWindow:(ArdiaWindowController *)controller profile:(ArdiaCoreProfile *)profile;
+ (void)removed:(ArdiaCoreTab *)tab fromWindow:(ArdiaWindowController *)controller;
+ (void)setPinned:(BOOL)pinned tab:(ArdiaCoreTab *)tab;
@end

namespace ardia_host {
NSArray<ArdiaCoreProfile *> *LoadedProfiles();
void LoadContentBlocker(NSString *profile);
void PrepareContentBlocker();
}

@interface ArdiaFavicons (Tabs)
+ (void)noteImage:(nullable NSImage *)image forURL:(nullable NSString *)url profile:(nullable NSString *)profile;
@end

NS_ASSUME_NONNULL_END
