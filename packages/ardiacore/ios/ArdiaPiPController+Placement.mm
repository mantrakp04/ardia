#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaPiPThrowMath.h"

#import <objc/runtime.h>

namespace {

BOOL OnAConnectedDisplay(NSRect rect) {
  const auto screens = ardia_pip::ThrowScreens();
  return ardia_pip_throw::OnAScreen(ardia_pip::ThrowRect(rect), screens.data(), (int)screens.size());
}

void LetPiPChooseItsDisplay(Class windowClass) {
  SEL constrain = @selector(constrainFrameRect:toScreen:);
  Method inherited = class_getInstanceMethod(windowClass, constrain);
  if (!inherited) return;
  __block IMP chrome = nil;
  IMP placed = imp_implementationWithBlock(^NSRect(NSWindow *window, NSRect rect, NSScreen *screen) {
    if ([ArdiaPiPController forWindow:window] && OnAConnectedDisplay(rect)) return rect;
    IMP next = chrome ?: class_getMethodImplementation(class_getSuperclass(windowClass), constrain);
    return ((NSRect (*)(id, SEL, NSRect, NSScreen *))next)(window, constrain, rect, screen);
  });
  if (!class_addMethod(windowClass, constrain, placed, method_getTypeEncoding(inherited))) chrome = method_setImplementation(inherited, placed);
}

}

@implementation ArdiaPiPController (Placement)

+ (void)load {
  if (Class frameless = NSClassFromString(@"NativeWidgetMacFramelessNSWindow")) LetPiPChooseItsDisplay(frameless);
}

@end
