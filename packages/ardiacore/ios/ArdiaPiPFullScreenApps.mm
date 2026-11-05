#import "ArdiaPictureInPictureInternal.h"
#import "ArdiaRuntime.h"

#import <objc/runtime.h>

@interface ArdiaPiPFullScreenApps : NSObject
@end

namespace {

const void *const kOverFullScreenAppsKey = &kOverFullScreenAppsKey;
void (*gSetCollectionBehavior)(id, SEL, NSWindowCollectionBehavior);

BOOL Marked(NSWindow *window) {
  return objc_getAssociatedObject(window, kOverFullScreenAppsKey) != nil;
}

BOOL FloatsOnEverySpace(NSWindow *window) {
  return [ArdiaCoreWindow isChromeFramelessWindow:window] && window.level >= NSFloatingWindowLevel &&
         (window.collectionBehavior & NSWindowCollectionBehaviorCanJoinAllSpaces);
}

void Mark(NSWindow *window) {
  if (Marked(window) || !gSetCollectionBehavior) return;
  objc_setAssociatedObject(window, kOverFullScreenAppsKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  gSetCollectionBehavior(window, @selector(setCollectionBehavior:),
                         window.collectionBehavior | NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary);
}

void MarkIfFloatingOnEverySpace(NSWindow *window) {
  if (!Marked(window) && FloatsOnEverySpace(window)) Mark(window);
}

BOOL Install() {
  static BOOL installed = ^{
    using ardia_runtime::ReplaceMethod;
    BOOL panel = ReplaceMethod(NSWindow.class, @selector(_isNonactivatingPanel), ^id(IMP original) {
      return ^BOOL(NSWindow *window) { return Marked(window) || ((BOOL (*)(id, SEL))original)(window, @selector(_isNonactivatingPanel)); };
    });
    BOOL behavior = ReplaceMethod(NSWindow.class, @selector(setCollectionBehavior:), ^id(IMP original) {
      gSetCollectionBehavior = (void (*)(id, SEL, NSWindowCollectionBehavior))original;
      return ^(NSWindow *window, NSWindowCollectionBehavior value) {
        gSetCollectionBehavior(window, @selector(setCollectionBehavior:), value);
        MarkIfFloatingOnEverySpace(window);
      };
    });
    BOOL level = ReplaceMethod(NSWindow.class, @selector(setLevel:), ^id(IMP original) {
      return ^(NSWindow *window, NSWindowLevel value) {
        ((void (*)(id, SEL, NSWindowLevel))original)(window, @selector(setLevel:), value);
        MarkIfFloatingOnEverySpace(window);
      };
    });
    return panel && behavior && level;
  }();
  return installed;
}

}

@implementation ArdiaPiPFullScreenApps

+ (void)load {
  Install();
}

@end

namespace ardia_pip {

void ShowOverFullScreenApps(NSWindow *window) {
  if (Install()) Mark(window);
}

BOOL ShowsOverFullScreenApps(NSWindow *window) {
  return Marked(window) && (window.collectionBehavior & NSWindowCollectionBehaviorFullScreenAuxiliary) &&
         [window respondsToSelector:@selector(_isNonactivatingPanel)] && [window _isNonactivatingPanel];
}

}
