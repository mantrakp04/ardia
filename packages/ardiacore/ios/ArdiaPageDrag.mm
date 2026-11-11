#import <AppKit/AppKit.h>

#import "ArdiaInternal.h"
#import "ArdiaRuntime.h"

namespace ardia_host {

void InstallPageDragSession() {
  static bool installed = false;
  if (installed) return;
  const SEL begin = @selector(beginDraggingSessionWithItems:event:source:);
  installed = ardia_runtime::ReplaceMethod(NSClassFromString(@"WebContentsViewCocoa"), begin, ^id(IMP original) {
    return ^NSDraggingSession *(NSView *view, NSArray<NSDraggingItem *> *items, NSEvent *event, id<NSDraggingSource> source) {
      NSDraggingSession *session = ((NSDraggingSession * (*)(NSView *, SEL, NSArray<NSDraggingItem *> *, NSEvent *, id<NSDraggingSource>))original)(view, begin, items, event, source);
      session.animatesToStartingPositionsOnCancelOrFail = NO;
      return session;
    };
  });
  if (!installed) NSLog(@"[ardiacore] page drag session override not installed: WebContentsViewCocoa has no %@", NSStringFromSelector(begin));
}

}
