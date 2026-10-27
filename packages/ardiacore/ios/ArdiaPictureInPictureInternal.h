#import "ArdiaPictureInPicture.h"
#import "ArdiaWebViewInternal.h"

#include <vector>

namespace ardia_pip_throw {
struct Point;
struct Rect;
struct Screen;
}

@interface NSWindow (ArdiaPreventsActivation)
- (void)_setPreventsActivation:(BOOL)prevents;
- (BOOL)_preventsActivation;
- (NSInteger)_resizeDirectionForMouseLocation:(NSPoint)location;
@end

namespace ardia_pip {

constexpr CGFloat kPeek = 28;
constexpr CGFloat kReturnMargin = 16;
constexpr CGFloat kButtonMargin = 12, kButtonSize = 28;
constexpr CGFloat kCornerRadius = 6;
constexpr CGFloat kRimAlpha = 0.17;

}

typedef NS_ENUM(NSInteger, ArdiaPiPEdge) { ArdiaPiPEdgeNone = 0, ArdiaPiPEdgeLeft = -1, ArdiaPiPEdgeRight = 1 };

@interface ArdiaPiPControl : NSView
@property (nonatomic, copy) void (^onClick)(void);
@property (nonatomic) BOOL hovered;
@end

@interface ArdiaPiPHandle : ArdiaPiPControl
@property (nonatomic) ArdiaPiPEdge edge;
@end

@interface ArdiaPiPOverlay : NSView
@property (nonatomic, readonly) ArdiaPiPHandle *handle;
@end

@interface ArdiaPiPController : NSObject
@property (nonatomic, readonly) NSWindow *window;
@property (nonatomic, weak) ArdiaWebView *view;
@property (nonatomic, copy) NSString *host;
@property (nonatomic, readonly) ArdiaPiPOverlay *overlay;
@property (nonatomic, readonly) ArdiaPiPEdge stashedEdge;
@property (nonatomic) BOOL keepOnTop;
+ (instancetype)forWindow:(NSWindow *)window;
- (instancetype)initWithWindow:(NSWindow *)window;
- (void)roundCorners;
- (void)backToTab;
- (void)unstash;
- (NSMenu *)menu;
- (void)stopMotion;
- (void)abandonSwipe;
- (NSScreen *)gestureHome;
- (void)dragReleasedAt:(NSPoint)pointer velocity:(NSPoint)velocity;
- (NSDictionary *)throwInfo;
@end

@interface ArdiaPiPController () {
  NSWindow *_window;
  __weak ArdiaWebView *_view;
  NSString *_host;
  ArdiaPiPOverlay *_overlay;
  ArdiaPiPEdge _stashedEdge;
  BOOL _keepOnTop;
  NSMutableArray *_observers;
  NSTimer *_slide;
  BOOL _animating;
  BOOL _sawDrag;
  BOOL _swiping;
  NSPoint _swipeGrab;
  NSPoint _swipeLastDelta;
  NSPoint _swipePointer;
  CFTimeInterval _swipeBeganAt;
  NSTimeInterval _swipeLastAt;
  NSRect _swipeStart;
  NSDictionary *_lastRelease;
  NSDictionary *_lastSwipe;
  NSMutableDictionary *_lastThrow;
  __weak NSScreen *_lastScreen;
  __weak NSScreen *_swipeHome;
  __weak NSScreen *_stashScreen;
}
- (void)detach;
- (void)toggleKeepOnTop:(id)sender;
- (void)backToTabFromMenu:(id)sender;
- (void)windowMoved;
- (NSScreen *)homeScreen;
- (ArdiaPiPEdge)edgeBeyond;
- (BOOL)throwFrom:(NSPoint)grab velocity:(NSPoint)velocity;
- (void)throwTo:(NSRect)target velocity:(NSPoint)velocity corner:(int)corner;
- (void)settle;
- (void)rescueIfLost;
- (NSRect)frameStashedAt:(ArdiaPiPEdge)edge;
- (void)stashAt:(ArdiaPiPEdge)edge;
- (void)animateTo:(NSRect)target;
- (void)swipeBegan:(NSEvent *)event;
- (void)moveBy:(ardia_pip_throw::Point)delta;
- (void)swipeMoved:(NSEvent *)event;
- (void)swipeEnded:(NSEvent *)event cancelled:(BOOL)cancelled;
@end

@interface ArdiaPiPController (Swipe)
+ (BOOL)handleSwipe:(NSEvent *)event;
+ (void)abandonSwipeOn:(NSWindow *)window;
- (void)devSwipe:(NSArray<NSString *> *)args;
- (void)devDrag:(NSArray<NSString *> *)args;
@end

@interface ArdiaPiPController (SelfTest)
- (NSString *)snapshot:(NSString *)name;
- (void)runSelfTest;
- (void)runButtonSelfTest:(NSString *)button;
- (void)runHoverSelfTest;
@end

@interface ArdiaPiPZoom : NSObject
+ (BOOL)handle:(NSEvent *)event;
@end

namespace ardia_pip {

extern NSString *const kZoomDefault;
extern const void *const kZoomKey;
BOOL IsChromeFloatingWindow(NSWindow *window);
BOOL IsChromeVideoPictureInPicture(NSWindow *window);
BOOL IsChromeDocumentPictureInPicture(NSWindow *window);
NSScreen *ScreenFor(NSRect frame);
void PreventActivation(NSWindow *window);
BOOL PreventsActivation(NSWindow *window);
extern NSInteger gActivations;
void ActivateApp(NSString *why);
BOOL ThrowEnabled();
NSPoint PointerOf(NSEvent *event);
ardia_pip_throw::Rect ThrowRect(NSRect r);
int ScreenIndex(NSScreen *screen);
std::vector<ardia_pip_throw::Screen> ThrowScreens();

}
