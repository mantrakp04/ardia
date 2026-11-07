#import "ArdiaPictureInPictureInternal.h"

#import <objc/runtime.h>

using namespace ardia_pip;

namespace {

const void *const kFloatsOverWorkspacesKey = &kFloatsOverWorkspacesKey;

BOOL FloatsOverWorkspaces(NSWindow *window) {
  if ([ArdiaPiPController forWindow:window] || objc_getAssociatedObject(window, kFloatsOverWorkspacesKey)) return YES;
  if (!IsChromeFloatingWindow(window)) return NO;
  objc_setAssociatedObject(window, kFloatsOverWorkspacesKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  return YES;
}

void AnswerSystemFloatingSubrole(Class windowClass) {
  SEL subrole = @selector(accessibilitySubrole);
  Method inherited = class_getInstanceMethod(windowClass, subrole);
  if (!inherited) return;
  auto chrome = (NSAccessibilitySubrole (*)(id, SEL))method_getImplementation(inherited);
  IMP floating = imp_implementationWithBlock(^NSAccessibilitySubrole(NSWindow *window) {
    return FloatsOverWorkspaces(window) ? NSAccessibilitySystemFloatingWindowSubrole : chrome(window, subrole);
  });
  if (!class_addMethod(windowClass, subrole, floating, method_getTypeEncoding(inherited))) method_setImplementation(inherited, floating);
}

}

@implementation ArdiaPiPController (Workspaces)

+ (void)load {
  if (Class frameless = NSClassFromString(@"NativeWidgetMacFramelessNSWindow")) AnswerSystemFloatingSubrole(frameless);
}

@end
