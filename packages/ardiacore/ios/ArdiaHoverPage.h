#import "ArdiaInternal.h"

NS_ASSUME_NONNULL_BEGIN

namespace ardia_host {

enum class PageCover { none, reactNative, chromium, other };

Class _Nullable PageClass();
NSView *_Nullable PageAt(NSWindow *window, NSPoint point);
NSView *_Nullable EnclosingPage(NSView *_Nullable view);
bool PageIgnoresMove(NSView *page, NSWindow *window, NSPoint point);
NSView *_Nullable HitAt(NSWindow *window, NSPoint point);
PageCover CoverOf(NSView *_Nullable hit);
bool SeeThrough(NSView *_Nullable hit);
bool ResponderLost(NSWindow *window, bool clickedPage);

}

NS_ASSUME_NONNULL_END
