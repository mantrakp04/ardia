#include "ardia/core/ac_browser.h"

#import <AppKit/AppKit.h>

#include "base/auto_reset.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/tabs/tab_strip_model_delegate.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/web_contents.h"
#include "ardia/core/ac_browser_internal.h"
#include "ardia/core/ac_contents_background.h"
#import "ardia/core/ardiacore_internal.h"

namespace ardiacore {

const char* DispositionName(WindowOpenDisposition disposition) {
  switch (disposition) {
    case WindowOpenDisposition::CURRENT_TAB:
      return "current_tab";
    case WindowOpenDisposition::SINGLETON_TAB:
      return "singleton_tab";
    case WindowOpenDisposition::NEW_FOREGROUND_TAB:
      return "foreground_tab";
    case WindowOpenDisposition::NEW_BACKGROUND_TAB:
      return "background_tab";
    case WindowOpenDisposition::NEW_POPUP:
      return "popup";
    case WindowOpenDisposition::NEW_WINDOW:
      return "window";
    case WindowOpenDisposition::NEW_PICTURE_IN_PICTURE:
      return "picture_in_picture";
    case WindowOpenDisposition::OFF_THE_RECORD:
      return "off_the_record";
    case WindowOpenDisposition::NEW_SPLIT_VIEW:
      return "split_view";
    default:
      return "other";
  }
}

int g_tab_strip_notifying = 0;
int g_navigation_notifying = 0;

bool IsNotifyingTabStrip() {
  return g_tab_strip_notifying > 0;
}

bool IsNotifyingNavigation() {
  return g_navigation_notifying > 0;
}

void InitialMainDocumentAccessed(content::WebContents* contents) {
  if (contents) {
    EndAheadBlank(contents);
  }
  TabBridge* bridge = contents ? TabBridge::FromWebContents(contents) : nullptr;
  if (!bridge) {
    return;
  }
  ArdiaCoreTab* tab = bridge->tab();
  base::AutoReset<int> notifying(&g_navigation_notifying,
                                 g_navigation_notifying + 1);
  [tab notify:@selector(tabDidChangeURL:)];
  [tab notify:@selector(tabDidChangeNavigationState:)];
}

bool OnlyShowedBlank(content::WebContents* contents) {
  TabBridge* bridge = TabBridge::FromWebContents(contents);
  if (!bridge || !bridge->made_ahead()) {
    return false;
  }
  content::NavigationController& controller = contents->GetController();
  content::NavigationEntry* committed = controller.GetLastCommittedEntry();
  return controller.GetEntryCount() == 1 && committed && !committed->IsInitialEntry() &&
         committed->GetURL().IsAboutBlank();
}

void CloseBlankTabsBeforeWindowCloses(Browser* browser) {
  TabStripModel* model = browser->GetTabStripModel();
  if (IsNotifyingTabStrip() || !model) {
    return;
  }
  for (int i = model->count() - 1; i >= 0; --i) {
    if (OnlyShowedBlank(model->GetWebContentsAt(i))) {
      model->DetachAndDeleteWebContentsAt(i);
    }
  }
}

void DeleteTabClosedByHost(content::WebContents* contents) {
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser) {
    return;
  }
  TabStripModel* model = browser->GetTabStripModel();
  const int index = model->GetIndexOfWebContents(contents);
  if (index == TabStripModel::kNoTab) {
    return;
  }
  content::NavigationEntry* committed =
      contents->GetController().GetLastCommittedEntry();
  if (!Profile::FromBrowserContext(contents->GetBrowserContext())
           ->IsOffTheRecord() &&
      committed && !committed->IsInitialEntry() && !OnlyShowedBlank(contents)) {
    model->delegate()->CreateHistoricalTab(contents);
  }
  model->DetachAndDeleteWebContentsAt(index);
}

}
