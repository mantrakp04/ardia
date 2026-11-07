#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaPiPThrowMath.h"
#import "ArdiaRuntime.h"

namespace {

BOOL ReachableOnADisplay(NSRect rect) {
  const auto screens = ardia_pip::ThrowScreens();
  return ardia_pip_throw::Reachable(ardia_pip::ThrowRect(rect), screens.data(), (int)screens.size());
}

}

@implementation ArdiaPiPController (Placement)

+ (void)load {
  SEL constrain = @selector(constrainFrameRect:toScreen:);
  ardia_runtime::ReplaceMethod(NSClassFromString(@"NativeWidgetMacFramelessNSWindow"), constrain, ^id(IMP original) {
    return ^NSRect(NSWindow *window, NSRect rect, NSScreen *screen) {
      if ([ArdiaPiPController forWindow:window] && ReachableOnADisplay(rect)) return rect;
      return ((NSRect (*)(id, SEL, NSRect, NSScreen *))original)(window, constrain, rect, screen);
    };
  });
}

@end
