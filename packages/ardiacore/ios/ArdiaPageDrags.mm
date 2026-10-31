#import <AppKit/AppKit.h>

#import "ArdiaInternal.h"
#import "ArdiaRuntime.h"

namespace ardia_host {

void InstallPageDragSessions() {
  const SEL begin = @selector(beginDraggingSessionWithItems:event:source:);
  ardia_runtime::ReplaceMethod(NSClassFromString(@"WebContentsViewCocoa"), begin, ^id(IMP original) {
    return ^NSDraggingSession *(NSView *view, NSArray<NSDraggingItem *> *items, NSEvent *event, id<NSDraggingSource> source) {
      NSDraggingSession *session = ((NSDraggingSession * (*)(NSView *, SEL, NSArray<NSDraggingItem *> *, NSEvent *, id<NSDraggingSource>))original)(view, begin, items, event, source);
      session.animatesToStartingPositionsOnCancelOrFail = NO;
      return session;
    };
  });
}

}
