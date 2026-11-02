#include "ardia/core/ac_browser.h"

#import <AppKit/AppKit.h>

#include "base/auto_reset.h"
#include "base/functional/bind.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/tab_list/tab_removed_reason.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/passwords/passwords_model_delegate.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/unload_controller.h"
#include "components/password_manager/core/browser/password_form.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/web_contents.h"
#include "ardia/core/ac_autofill_trigger.h"
#include "ardia/core/ac_browser_internal.h"
#include "ardia/core/ac_browser_window.h"
#include "ardia/core/ac_installed_bubble.h"
#include "ardia/core/ac_password_prompt.h"
#include "ardia/core/ac_video_upscaling.h"
#import "ardia/core/ardiacore_internal.h"
#include "url/origin.h"

namespace ardiacore {

void WindowHost::ActiveTabChanged(Browser* browser,
                                  content::WebContents* contents) {
  if (!contents) {
    return;
  }
  VideoUpscalingInputsChanged();
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&ShowWaitingInstalledBubbles));
  ScopedNotifying notifying(ScopedNotifying::Kind::kTabStrip);
  ArdiaCoreTab* tab = TabBridge::GetOrCreate(contents)->tab();
  ArdiaCoreWindow* owner = owner_;
  if ([owner.delegate respondsToSelector:@selector(window:didActivateTab:)]) {
    [owner.delegate window:owner didActivateTab:tab];
  }
}

void WindowHost::OnTabStripModelChanged(
    TabStripModel* tab_strip_model,
    const TabStripModelChange& change,
    const TabStripSelectionChange& selection) {
  ScopedNotifying notifying(ScopedNotifying::Kind::kTabStrip);
  ArdiaCoreWindow* owner = owner_;
  id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
  if (change.type() == TabStripModelChange::kInserted) {
    for (const auto& inserted : change.GetInsert()->contents) {
      TabBridge* bridge = TabBridge::GetOrCreate(inserted.contents);
      TrackAutofillFocus(inserted.contents);
      bridge->EnsureFaviconObserved();
      bridge->EnsurePopupsObserved();
      bridge->EnsureZoomObserved();
      std::optional<WindowOpenDisposition> disposition =
          bridge->TakeOpenDisposition();
      content::WebContents* source = bridge->open_source();
      if (!disposition && pending_open_.disposition) {
        disposition = pending_open_.disposition;
        source = pending_open_.source.get();
        bridge->set_open(pending_open_);
      }
      if (!source) {
        tabs::TabInterface* opener_tab =
            tab_strip_model->GetOpenerOfTabAt(inserted.index);
        source = opener_tab ? opener_tab->GetContents() : nullptr;
      }
      ArdiaCoreTab* opener =
          source ? TabBridge::GetOrCreate(source)->tab() : nil;
      if (!disposition) {
        disposition = tab_strip_model->active_index() == inserted.index
                          ? WindowOpenDisposition::NEW_FOREGROUND_TAB
                          : WindowOpenDisposition::NEW_BACKGROUND_TAB;
      }
      if ([delegate respondsToSelector:@selector
                    (window:didInsertTab:opener:disposition:)]) {
        [delegate window:owner
            didInsertTab:bridge->tab()
                  opener:opener
             disposition:@(DispositionName(*disposition))];
      }
    }
  } else if (change.type() == TabStripModelChange::kRemoved) {
    for (const auto& removed : change.GetRemove()->contents) {
      if (!removed.contents) {
        continue;
      }
      TabBridge* bridge = TabBridge::FromWebContents(removed.contents);
      Browser* browser = nullptr;
      for (Browser* b : browsers()) {
        if (b->GetTabStripModel() == tab_strip_model) {
          browser = b;
        }
      }
      ACBrowserWindow* browser_window =
          browser ? ACBrowserWindow::FromWindow(BrowserWindow::FromBrowser(browser)) : nullptr;
      const bool browser_closing =
          !browser ||
          (UnloadController::From(browser)->is_attempting_to_close_browser() &&
           !(browser_window && browser_window->closed_by_chrome()));
      if (bridge && removed.remove_reason == TabRemovedReason::kDeleted &&
          !browser_closing && !closing() && !browser_shutdown::IsTryingToQuit()) {
        bridge->ReportWillClose();
      }
      if (bridge &&
          [delegate respondsToSelector:@selector(window:didRemoveTab:)]) {
        [delegate window:owner didRemoveTab:bridge->tab()];
      }
    }
  }
}

void WindowHost::DevToolsDockChanged(content::WebContents* inspected,
                                     content::WebContents* devtools) {
  ArdiaCoreWindow* owner = owner_;
  id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
  if (![delegate respondsToSelector:@selector(window:
                                        devToolsDidChangeForTab:view:)]) {
    return;
  }
  NSView* view =
      devtools ? devtools->GetNativeView().GetNativeNSView() : nil;
  [delegate window:owner
      devToolsDidChangeForTab:TabBridge::GetOrCreate(inspected)->tab()
                         view:view];
}

bool WindowHost::OfferPasswordSave(content::WebContents* contents) {
  ArdiaCoreWindow* owner = owner_;
  id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
  if ([delegate respondsToSelector:@selector(window:passwordPrompt:forTab:)]) {
    NSDictionary* prompt = PasswordPrompt(contents);
    if (!prompt) {
      return false;
    }
    PasswordPromptShown(contents);
    [delegate window:owner
        passwordPrompt:prompt
                forTab:TabBridge::GetOrCreate(contents)->tab()];
    PasswordConfirmationShown(contents);
    return true;
  }
  if (![delegate respondsToSelector:@selector
                 (window:passwordSavePromptForTab:username:origin:)]) {
    return false;
  }
  base::WeakPtr<PasswordsModelDelegate> model =
      PasswordsModelDelegateFromWebContents(contents);
  if (!model ||
      model->GetState() != password_manager::ui::PENDING_PASSWORD_STATE) {
    return false;
  }
  const password_manager::PasswordForm& form = model->GetPendingPassword();
  [delegate window:owner
      passwordSavePromptForTab:TabBridge::GetOrCreate(contents)->tab()
                      username:base::SysUTF16ToNSString(form.username_value)
                        origin:base::SysUTF8ToNSString(
                                   model->GetOrigin().Serialize())];
  return true;
}

void WindowHost::FullscreenChanged(content::WebContents* contents,
                                   bool fullscreen) {
  ArdiaCoreWindow* owner = owner_;
  id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
  if (contents && [delegate respondsToSelector:@selector
                            (window:tab:didChangeFullscreen:)]) {
    [delegate window:owner
                     tab:TabBridge::GetOrCreate(contents)->tab()
        didChangeFullscreen:fullscreen];
  }
}

}
