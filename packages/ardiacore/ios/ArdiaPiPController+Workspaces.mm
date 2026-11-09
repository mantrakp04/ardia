#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaRuntime.h"

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

void JoinBeforeFirstShown(NSWindow *window) {
  if (window.visible || window.level < NSFloatingWindowLevel || !(window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces)) return;
  JoinFullScreenSpaces(window);
}

const void *const kJoinsFullScreenSpacesKey = &kJoinsFullScreenSpacesKey;

BOOL MarkedToJoinFullScreenSpaces(NSWindow *window) { return objc_getAssociatedObject(window, kJoinsFullScreenSpacesKey) != nil; }

void AnswerNonactivatingPanelForMarkedWindows() {
  ardia_runtime::ReplaceMethod(NSWindow.class, @selector(_isNonactivatingPanel), ^id(IMP original) {
    return ^BOOL(NSWindow *window) {
      return MarkedToJoinFullScreenSpaces(window) || ((BOOL (*)(id, SEL))original)(window, @selector(_isNonactivatingPanel));
    };
  });
}

void JoinWhenChromeMakesItFloat(Class windowClass) {
  ardia_runtime::ReplaceMethod(windowClass, @selector(setCollectionBehavior:), ^id(IMP original) {
    return ^(NSWindow *window, NSWindowCollectionBehavior behavior) {
      ((void (*)(id, SEL, NSWindowCollectionBehavior))original)(window, @selector(setCollectionBehavior:), behavior);
      JoinBeforeFirstShown(window);
    };
  });
  ardia_runtime::ReplaceMethod(windowClass, @selector(setLevel:), ^id(IMP original) {
    return ^(NSWindow *window, NSWindowLevel level) {
      ((void (*)(id, SEL, NSWindowLevel))original)(window, @selector(setLevel:), level);
      JoinBeforeFirstShown(window);
    };
  });
}

}

namespace ardia_pip {

BOOL JoinsFullScreenSpaces(NSWindow *window) {
  const NSWindowCollectionBehavior needed =
      NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
  const BOOL nonactivating = [window respondsToSelector:@selector(_isNonactivatingPanel)] && [window _isNonactivatingPanel];
  return nonactivating && (window.collectionBehavior & needed) == needed;
}

void JoinFullScreenSpaces(NSWindow *window) {
  const NSWindowCollectionBehavior exclusive = NSWindowCollectionBehaviorPrimary | NSWindowCollectionBehaviorAuxiliary |
                                               NSWindowCollectionBehaviorFullScreenPrimary | NSWindowCollectionBehaviorFullScreenNone;
  const NSWindowCollectionBehavior joined = (window.collectionBehavior & ~exclusive) | NSWindowCollectionBehaviorCanJoinAllSpaces |
                                            NSWindowCollectionBehaviorFullScreenAuxiliary;
  if (joined != window.collectionBehavior) window.collectionBehavior = joined;
  objc_setAssociatedObject(window, kJoinsFullScreenSpacesKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

}

@implementation ArdiaPiPController (Workspaces)

+ (void)load {
  Class frameless = NSClassFromString(@"NativeWidgetMacFramelessNSWindow");
  if (!frameless) return;
  AnswerSystemFloatingSubrole(frameless);
  AnswerNonactivatingPanelForMarkedWindows();
  JoinWhenChromeMakesItFloat(frameless);
}

@end
