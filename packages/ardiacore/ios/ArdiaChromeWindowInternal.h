#import "ArdiaChromeWindowHost.h"
#import "ArdiaInternal.h"

@interface ArdiaPageDrawWait : NSObject
+ (void)tab:(ArdiaCoreTab *)tab draws:(NSInteger (^)(BOOL fullScreen, BOOL fills))test then:(void (^)(void))done;
@end

@interface ArdiaPageCover : NSView
@property(readonly, weak) ArdiaCoreTab *tab;
+ (void)coverTabs:(NSArray<ArdiaCoreTab *> *)tabs then:(void (^)(NSArray<ArdiaPageCover *> *covers))then;
- (void)repicture;
- (void)uncover:(BOOL)fade;
@end

@interface ArdiaPopupOriginStrip : NSView
- (void)showURL:(NSString *)url security:(NSString *)level;
@end

@interface ArdiaWindowFullScreen : NSObject
+ (instancetype)ofWindow:(ArdiaCoreWindow *)coreWindow create:(BOOL)create;
- (void)tab:(ArdiaCoreTab *)tab fullScreen:(BOOL)fullScreen tell:(void (^)(void))tell;
- (BOOL)seen;
- (NSDictionary *)state;
- (ArdiaCoreTab *)probedTab;
- (BOOL)covered;
- (NSInteger)covers;
- (BOOL)transitioning;
- (BOOL)pageFullScreen;
- (BOOL)enteredForPage;
@end

namespace ardia_window {

NSMapTable<NSWindow *, ArdiaWindowController *> *Controllers();
extern BOOL (^gRefusesUnhandledKey)(NSWindow *, NSEvent *);

void ConfigureWindow(NSWindow *window);
extern const void *kLightsCenterKey;
extern const void *kLightsShownKey;
extern const void *kLightsMoveKey;
NSArray<NSButton *> *TrafficLightButtons(NSWindow *window);
NSPoint LightsCenter(NSValue *center, NSSize size);
void TranslateTrafficLights(NSWindow *window, CGFloat dx);
void RetileTrafficLights(NSWindow *window);
bool MoveTrafficLights(NSWindow *window, NSValue *center);

void WatchFullScreenLights(NSWindow *window);
void PlaceFullScreenLights(NSWindow *window);
NSView *FullScreenLightsView(NSWindow *window);

void SuppressFullScreenTitlebar(NSWindow *window);
CGFloat FullScreenRevealHeight(NSWindow *window);
void ApplyFullScreenReveal(NSWindow *window);
void SetFullScreenRevealAmount(NSWindow *window, double amount);
NSDictionary *FullScreenRevealState(NSWindow *window);

NSMenuItem *ReservedMenuItemForEvent(NSEvent *event);
bool IsReservedKey(NSEvent *event);
bool IsSecondSidebarKeyPress(NSEvent *event);
bool KeepsUnhandledSidebarKeyInPage(NSWindow *window, NSEvent *event);

extern const void *kActedFullScreenKey;
extern const void *kWindowFullScreenKey;
BOOL IsWindowFullScreen(NSWindow *window);
void ActOcclusion(NSWindow *window, NSNumber *visible);
extern NSTimeInterval gActedOcclusionGap;
void ActWindowFullScreen(ArdiaCoreWindow *coreWindow, BOOL enter, NSTimeInterval seconds);
extern NSTimeInterval gActedTransition;
NSMapTable<ArdiaCoreTab *, NSNumber *> *FullScreenChanges();

extern BOOL gPageCoverOff;

NSString *PopupOriginText(NSString *url);

}
