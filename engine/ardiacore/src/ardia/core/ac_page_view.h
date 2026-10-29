#ifndef ARDIA_CORE_AC_PAGE_VIEW_H_
#define ARDIA_CORE_AC_PAGE_VIEW_H_

#import <Cocoa/Cocoa.h>

@protocol RenderWidgetHostViewMacDelegate;

namespace content {
class RenderWidgetHost;
}

namespace ardiacore {

NSObject<RenderWidgetHostViewMacDelegate>* CreatePageViewDelegate(
    content::RenderWidgetHost* host);

}

#endif
