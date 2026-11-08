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

namespace ardia_pip {

BOOL JoinsFullScreenSpaces(NSWindow *window) {
  const NSWindowCollectionBehavior needed =
      NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorCanJoinAllApplications | NSWindowCollectionBehaviorFullScreenAuxiliary;
  const BOOL independent = ![window respondsToSelector:@selector(activationIndependence)] || [window activationIndependence];
  return independent && (window.collectionBehavior & needed) == needed;
}

void JoinFullScreenSpaces(NSWindow *window) {
  const NSWindowCollectionBehavior exclusive = NSWindowCollectionBehaviorPrimary | NSWindowCollectionBehaviorAuxiliary |
                                               NSWindowCollectionBehaviorFullScreenPrimary | NSWindowCollectionBehaviorFullScreenNone;
  const NSWindowCollectionBehavior joined = (window.collectionBehavior & ~exclusive) | NSWindowCollectionBehaviorCanJoinAllSpaces |
                                            NSWindowCollectionBehaviorCanJoinAllApplications | NSWindowCollectionBehaviorFullScreenAuxiliary;
  if (joined != window.collectionBehavior) window.collectionBehavior = joined;
  if ([window respondsToSelector:@selector(setActivationIndependence:)] && ![window activationIndependence]) [window setActivationIndependence:YES];
}

}

@implementation ArdiaPiPController (Workspaces)

+ (void)load {
  if (Class frameless = NSClassFromString(@"NativeWidgetMacFramelessNSWindow")) AnswerSystemFloatingSubrole(frameless);
}

@end
