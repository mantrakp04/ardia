#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaPiPThrowMath.h"
#import "ArdiaRuntime.h"

namespace {

BOOL WhereTheThrowMathsMayPutIt(NSRect rect) {
  const auto screens = ardia_pip::ThrowScreens();
  return !screens.empty() && ardia_pip_throw::Shortfall(ardia_pip::ThrowRect(rect), screens.data(), (int)screens.size()) <= 1e-9;
}

}

@implementation ArdiaPiPController (Placement)

+ (void)load {
  SEL constrain = @selector(constrainFrameRect:toScreen:);
  ardia_runtime::ReplaceMethod(NSClassFromString(@"NativeWidgetMacFramelessNSWindow"), constrain, ^id(IMP original) {
    return ^NSRect(NSWindow *window, NSRect rect, NSScreen *screen) {
      if ([ArdiaPiPController forWindow:window] && WhereTheThrowMathsMayPutIt(rect)) return rect;
      return ((NSRect (*)(id, SEL, NSRect, NSScreen *))original)(window, constrain, rect, screen);
    };
  });
}

@end
