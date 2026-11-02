#ifndef ARDIA_CORE_ARDIACORE_TAB_INTERNAL_H_
#define ARDIA_CORE_ARDIACORE_TAB_INTERNAL_H_

#import <AppKit/AppKit.h>

#import "ardia/core/public/ArdiaCore.h"
#include "base/memory/raw_ptr.h"

namespace content {
class WebContents;
}

@interface ArdiaCoreTab () {
  raw_ptr<content::WebContents> _contents;
  int _browserId;
  NSColor* __strong _pageBackgroundColor;
}
@end

#endif
