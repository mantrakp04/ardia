#include "ardia/core/ac_browser.h"

#import <AppKit/AppKit.h>

#include "base/functional/bind.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "content/public/browser/web_contents.h"
#include "ardia/core/ac_browser_window.h"
#include "ardia/core/ac_modal_dialog_host.h"
#include "ui/views/widget/widget.h"

namespace ardiacore {

gfx::NativeView WindowHost::GetHostView() const {
  return gfx::NativeView(host_view_);
}

namespace {

content::WebContents* ActiveContentsOf(const WindowHost* host) {
  Browser* browser = host->active_profile()
                         ? host->ExistingBrowserFor(host->active_profile())
                         : nullptr;
  return browser ? browser->GetTabStripModel()->GetActiveWebContents()
                 : nullptr;
}

}

gfx::Point WindowHost::GetDialogPosition(const gfx::Size& size) {
  return DialogPositionInHostView(
      host_view_, PageRectInHostView(host_view_, ActiveContentsOf(this)),
      size);
}

bool WindowHost::ShouldActivateDialog() const {
  BrowserWindowInterface* last =
      GetLastActiveBrowserWindowInterfaceWithAnyProfile();
  return last && ForBrowser(last) == this &&
         IsActiveBrowser(static_cast<Browser*>(last)) &&
         WindowIsForeground(ns_window());
}

gfx::Size WindowHost::GetMaximumDialogSize() {
  return PageRectInHostView(host_view_, ActiveContentsOf(this)).size();
}

void WindowHost::AddObserver(web_modal::ModalDialogHostObserver* observer) {
  if (modal_observers_.HasObserver(observer)) {
    return;
  }
  modal_observers_.AddObserver(observer);
  DialogHostObserverAdded();
}

void WindowHost::RemoveObserver(web_modal::ModalDialogHostObserver* observer) {
  if (!modal_observers_.HasObserver(observer)) {
    return;
  }
  modal_observers_.RemoveObserver(observer);
  DialogHostObserverRemoved();
}

void WindowHost::NotifyPositionRequiresUpdate() {
  dialog_position_update_scheduled_ = false;
  modal_observers_.Notify(
      &web_modal::ModalDialogHostObserver::OnPositionRequiresUpdate);
  for (Browser* browser : browsers()) {
    TabStripModel* tabs = browser->GetTabStripModel();
    for (int i = 0; i < tabs->count(); ++i) {
      if (auto* host = ACTabDialogHost::FromWebContents(tabs->GetWebContentsAt(i))) {
        host->NotifyPositionRequiresUpdate();
      }
    }
  }
}

void WindowHost::ScheduleDialogPositionUpdate() {
  if (dialog_position_update_scheduled_) {
    return;
  }
  dialog_position_update_scheduled_ = true;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&WindowHost::NotifyPositionRequiresUpdate,
                                GetWeakPtr()));
}

void WindowHost::OnWidgetBoundsChanged(views::Widget* widget,
                                       const gfx::Rect& new_bounds) {
  ScheduleDialogPositionUpdate();
  for (Browser* browser : browsers()) {
    if (ACBrowserWindow* window = ACBrowserWindow::FromWindow(BrowserWindow::FromBrowser(browser))) {
      window->RepositionExclusiveAccessBubble();
    }
  }
}

}
