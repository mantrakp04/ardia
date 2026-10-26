#import "ardia/core/public/ArdiaCore.h"

#include <string>

#include "base/strings/sys_string_conversions.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/reload_type.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/page_transition_types.h"
#include "url/gurl.h"
#include "url/url_constants.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_contents_background.h"
#import "ardia/core/ardiacore_api_internal.h"
#import "ardia/core/ardiacore_internal.h"
#import "ardia/core/ardiacore_tab_internal.h"

using ardiacore::NS;

@implementation ArdiaCoreTab (Navigation)

- (void)loadURL:(NSString*)url userInitiated:(BOOL)userInitiated {
  if (!_contents) {
    return;
  }
  content::NavigationController::LoadURLParams params(
      GURL(base::SysNSStringToUTF8(url)));
  if (params.url.SchemeIs(url::kJavaScriptScheme)) {
    ardiacore::EndAheadBlank(_contents);
  }
  params.transition_type = userInitiated
                               ? ui::PageTransitionFromInt(
                                     ui::PAGE_TRANSITION_TYPED |
                                     ui::PAGE_TRANSITION_FROM_ADDRESS_BAR)
                               : ui::PAGE_TRANSITION_AUTO_TOPLEVEL;
  params.has_user_gesture = userInitiated;
  if (ardiacore::OnlyShowedBlank(_contents)) {
    params.should_replace_current_entry = true;
  }
  _contents->GetController().LoadURLWithParams(params);
}

- (void)goToOffset:(int)offset {
  if (_contents && _contents->GetController().CanGoToOffset(offset)) {
    _contents->GetController().GoToOffset(offset);
  }
}

- (void)reloadIgnoringCache {
  if (_contents) {
    _contents->GetController().Reload(content::ReloadType::BYPASSING_CACHE, true);
  }
}

- (NSArray<NSDictionary<NSString*, id>*>*)navigationEntries {
  NSMutableArray* entries = [NSMutableArray array];
  if (!_contents) {
    return entries;
  }
  content::NavigationController& controller = _contents->GetController();
  const int current = controller.GetCurrentEntryIndex();
  for (int i = 0; i < controller.GetEntryCount(); ++i) {
    content::NavigationEntry* entry = controller.GetEntryAtIndex(i);
    [entries addObject:@{
      @"url" : NS(entry->GetURL().spec()),
      @"title" : NS(entry->GetTitle()),
      @"current" : @(i == current),
    }];
  }
  return entries;
}

- (void)goBack {
  if (self.canGoBack) {
    _contents->GetController().GoBack();
  }
}

- (void)goForward {
  if (self.canGoForward) {
    _contents->GetController().GoForward();
  }
}

- (void)reload {
  if (_contents) {
    _contents->GetController().Reload(content::ReloadType::NORMAL, true);
  }
}

- (void)loadIfNeeded {
  if (_contents && _contents->GetController().NeedsReload()) {
    _contents->GetController().LoadIfNecessary();
  }
}

- (void)stop {
  if (_contents) {
    _contents->Stop();
  }
}

@end
