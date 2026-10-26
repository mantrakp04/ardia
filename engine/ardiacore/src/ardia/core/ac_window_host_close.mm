#include "ardia/core/ac_browser.h"

#import <AppKit/AppKit.h>

#include "base/functional/bind.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/download/download_core_service.h"
#include "chrome/browser/download/download_core_service_factory.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface_iterator.h"
#include "chrome/browser/ui/browser_window/public/desktop_browser_window_capabilities.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/unload_controller.h"
#include "ardia/core/ac_browser_internal.h"
#include "ardia/core/ac_browser_window.h"
#import "ardia/core/ardiacore_internal.h"
#include "ui/views/widget/widget.h"

namespace ardiacore {

void WindowHost::CloseRequestedByUser() {
  if (close_state_ != CloseState::kOpen) {
    return;
  }
  ArdiaCoreWindow* owner = owner_;
  id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
  if ([delegate respondsToSelector:@selector(windowShouldClose:)] &&
      ![delegate windowShouldClose:owner]) {
    return;
  }
  Close();
}

void WindowHost::Close() {
  if (close_state_ != CloseState::kOpen) {
    return;
  }
  close_state_ = CloseState::kAsking;
  ++close_attempt_;
  ContinueClose();
}

void WindowHost::ContinueCloseAttempt(int attempt) {
  if (attempt != close_attempt_ || browser_shutdown::IsTryingToQuit()) {
    return;
  }
  ContinueClose();
}

void WindowHost::ContinueClose() {
  if (close_state_ != CloseState::kAsking) {
    return;
  }
  asking_ = nullptr;
  for (Browser* browser : browsers()) {
    if (UnloadController::From(browser)->RunBeforeUnloadForShutdown(
            false,
            base::BindRepeating(&WindowHost::OnBeforeUnloadAnswered,
                                GetWeakPtr()))) {
      asking_ = browser;
      return;
    }
  }
  const int downloads = DownloadsCancelledByClose();
  if (downloads > 0) {
    ConfirmCloseWithDownloads(
        downloads, base::BindOnce(
                       [](base::WeakPtr<WindowHost> host, bool close_anyway) {
                         if (!host || host->close_state_ != CloseState::kAsking) {
                           return;
                         }
                         if (close_anyway) {
                           host->CommitClose();
                         } else {
                           host->CancelClose();
                         }
                       },
                       GetWeakPtr()));
    return;
  }
  CommitClose();
}

void WindowHost::OnBeforeUnloadAnswered(bool proceed) {
  if (close_state_ != CloseState::kAsking) {
    return;
  }
  asking_ = nullptr;
  if (proceed) {
    ContinueClose();
  } else {
    CancelClose();
  }
}

void WindowHost::CancelClose() {
  close_state_ = CloseState::kOpen;
  asking_ = nullptr;
  ++close_attempt_;
  for (Browser* browser : browsers()) {
    UnloadController::From(browser)->ResetBeforeUnloadForShutdown();
  }
  NotifyCloseCancelled();
}

void WindowHost::NotifyCloseCancelled() {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<WindowHost> host) {
                       if (!host) {
                         return;
                       }
                       ArdiaCoreWindow* owner = host->owner_;
                       id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
                       if ([delegate respondsToSelector:@selector
                                     (windowDidCancelClose:)]) {
                         [delegate windowDidCancelClose:owner];
                       }
                     },
                     GetWeakPtr()));
}

void WindowHost::CommitClose() {
  close_state_ = CloseState::kClosing;
  if (browsers_.empty()) {
    CloseWidget();
    return;
  }
  for (Browser* browser : browsers()) {
    browser->GetWindow()->Close();
  }
}

void WindowHost::CloseWidget() {
  if (widget_close_allowed_) {
    return;
  }
  widget_close_allowed_ = true;
  if (widget_) {
    widget_->Close();
  }
  std::erase(Hosts(), this);
  ArdiaCoreWindow* owner = owner_ref_;
  owner_ref_ = nil;
  dispatch_async(dispatch_get_main_queue(), ^{
    (void)owner;
  });
}

int WindowHost::DownloadsCancelledByClose() const {
  int count = 0;
  for (const auto& [profile, browser] : browsers_) {
    if (!profile->IsOffTheRecord()) {
      continue;
    }
    bool other_window = false;
    GlobalBrowserCollection::GetInstance()->ForEach(
        [&](BrowserWindowInterface* other) {
          if (other->GetProfile() == profile && WindowHost::ForBrowser(other) != this &&
              !other->capabilities()->IsAttemptingToCloseBrowser()) {
            other_window = true;
          }
          return !other_window;
        });
    DownloadCoreService* downloads =
        DownloadCoreServiceFactory::GetForBrowserContext(profile);
    if (!other_window && downloads) {
      count += downloads->BlockingShutdownCount();
    }
  }
  return count;
}

void WindowHost::ConfirmCloseWithDownloads(int count,
                                           base::OnceCallback<void(bool)> callback) {
  auto answer = std::make_shared<base::OnceCallback<void(bool)>>(std::move(callback));
  auto reply = ^(BOOL close_anyway) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(
                       [](std::shared_ptr<base::OnceCallback<void(bool)>> answer,
                          bool close_anyway) {
                         if (*answer) {
                           std::move(*answer).Run(close_anyway);
                         }
                       },
                       answer, close_anyway));
  };
  ArdiaCoreWindow* owner = owner_;
  id<ArdiaCoreWindowDelegate> delegate = owner.delegate;
  if (![delegate respondsToSelector:@selector
                 (window:confirmCloseWithDownloads:completion:)]) {
    reply(YES);
    return;
  }
  [delegate window:owner confirmCloseWithDownloads:count completion:reply];
}

void WindowHost::BrowserWindowDestroyed(ACBrowserWindow* window) {
  const bool was_asking = asking_ && window->browser() == asking_;
  if (was_asking) {
    asking_ = nullptr;
  }
  for (auto it = browsers_.begin(); it != browsers_.end(); ++it) {
    if (it->second == window->browser()) {
      it->second->GetTabStripModel()->RemoveObserver(this);
      if (active_profile_ == it->first) {
        active_profile_ = nullptr;
      }
      browsers_.erase(it);
      break;
    }
  }
  if (browsers_.empty() &&
      (closing() || browser_shutdown::IsTryingToQuit())) {
    close_state_ = CloseState::kClosing;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&WindowHost::CloseWidget, GetWeakPtr()));
  } else if (was_asking && close_state_ == CloseState::kAsking &&
             !browser_shutdown::IsTryingToQuit()) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&WindowHost::ContinueCloseAttempt, GetWeakPtr(),
                                  close_attempt_));
  }
}

void ConfirmQuitWithDownloads(int count, base::OnceCallback<void(bool)> callback) {
  WindowHost* host =
      WindowHost::ForBrowser(GetLastActiveBrowserWindowInterfaceWithAnyProfile());
  if (!host && !WindowHost::All().empty()) {
    host = WindowHost::All().back();
  }
  if (host) {
    host->ConfirmCloseWithDownloads(count, std::move(callback));
    return;
  }
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(std::move(callback), true));
}

void NotifyWindowsQuitCancelled() {
  for (WindowHost* host : WindowHost::All()) {
    host->QuitCancelled();
  }
}

void WindowHost::QuitCancelled() {
  if (close_state_ == CloseState::kAsking) {
    close_state_ = CloseState::kOpen;
    asking_ = nullptr;
    ++close_attempt_;
    for (Browser* browser : browsers()) {
      UnloadController::From(browser)->ResetBeforeUnloadForShutdown();
    }
  }
  NotifyCloseCancelled();
}

}
