namespace {

void RetirementAck(bool detached) {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  auto dispatch = tab.frame.linux_before_unload_request_;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
          &content::RenderFrameHostManager::BeforeUnloadCompleted,
          tab.environment->manager.GetWeakPtr(), true, dispatch));
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  if (detached) {
    browser->tabs.tabs.clear();
    browser->controller->TabDetachedImpl(&tab);
    browser->tabs.tabs.push_back(&tab);
  } else {
    tab.ReplaceDocument();
    browser->controller->RenderProcessGone(&tab, 0);
  }
  DrainCloseTasks();
  assert(!native.sealed && !native.begun && dispatch->revoked);
  assert(dispatch->completed && tab.close_pages == 0 && browser->tabs.closed == 0);
}

void DispatchOrdering(bool old_first, bool proceed, bool standalone, bool waiting_event, bool renderer_loss) {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  auto old_dispatch = tab.frame.linux_before_unload_request_;
  auto old_reply = tab.TakeAck();
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  if (waiting_event) {
    browser->GetWindow()->Close();
    native.Release(ardia::LinuxCloseStage::kPrepare);
    DrainCloseTasks();
    assert(tab.dispatches == 1 && browser->controller->linux_waiting_for_dispatch_);
    assert(base::SingleThreadTaskRunner::GetCurrentDefault()->tasks.empty());
  }
  tab.ReplaceDocument();
  if (waiting_event) {
    if (renderer_loss) browser->controller->RenderProcessGone(&tab, 0);
    else {
      content::NavigationHandle navigation;
      browser->controller->DidFinishNavigation(&tab, &navigation);
    }
    DrainCloseTasks();
  } else if (standalone) {
    tab.DispatchBeforeUnload(false);
  } else {
    browser->GetWindow()->Close();
    native.Release(ardia::LinuxCloseStage::kPrepare);
    DrainCloseTasks();
  }
  assert(tab.dispatches == 2);
  auto current = tab.frame.linux_before_unload_request_;
  assert(current != old_dispatch && old_dispatch->revoked);
  auto current_reply = tab.TakeAck();
  if (old_first) std::move(old_reply).Run(true, {}, {}, {}, {});
  assert(tab.close_pages == 0);
  std::move(current_reply).Run(proceed, {}, {}, {}, {});
  if (!old_first) std::move(old_reply).Run(true, {}, {}, {}, {});
  DrainCloseTasks();
  if (!proceed) {
    assert(tab.close_pages == 0 && !native.begun && !native.sealed);
    assert(browser->controller->state_ == UnloadController::State::kIdle);
    assert(native.cancels == (standalone ? 1 : 2));
  } else {
    assert(tab.close_pages == 1);
    assert(native.begun == !standalone);
  }
}

BrowserCloseManager* cancelling_first = nullptr;
BrowserCloseManager* cancelling_second = nullptr;
base::WeakPtr<BrowserCloseManager> first_attempt;
base::WeakPtr<BrowserCloseManager> second_attempt;
int confirmed_cancels = 0;
void ConfirmAllParticipants(BrowserWindowInterface* browser, const base::UnguessableToken& token) {
  assert(cancelling_first->linux_cancelled_ && cancelling_second->linux_cancelled_);
  assert(!first_attempt && !second_attempt);
  Cancel(browser, token);
  ++confirmed_cancels;
}

void OutermostCancellation() {
  Install();
  auto browser = Window();
  Native native(*browser);
  pending_downloads = 1;
  auto first = base::WrapRefCounted(new BrowserCloseManager());
  auto second = base::WrapRefCounted(new BrowserCloseManager());
  cancelling_first = first.get();
  cancelling_second = second.get();
  first->StartClosingBrowsers();
  second->StartClosingBrowsers();
  first_attempt = first->linux_weak_factory_.GetWeakPtr();
  second_attempt = second->linux_weak_factory_.GetWeakPtr();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(download_answer && download_answers.size() == 1);
  ardia::g_ardia_linux_close_hooks.cancel = &ConfirmAllParticipants;
  const auto token = native.token;
  browser->controller->linux_quit_cancels_.insert(
      browser->controller->linux_quit_cancels_.begin(), [&] {
        first->CancelBrowserClose();
        assert(!second->linux_cancelled_ && native.sealed && native.cancels == 0);
        assert(!ardia::CancelLinuxCloseAttempt(browser.get(), token));
      });
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  assert(confirmed_cancels == 1 && !trying_to_quit);
  for (auto& answer : download_answers) std::move(answer).Run(true);
  download_answers.clear();
  std::move(download_answer).Run(true);
  DrainCloseTasks();
  assert(shutdown_sessions == 0 && !browser->destroyed);
}

void CancellationDeletesRequester() {
  Install();
  auto browser = Window();
  Native native(*browser);
  browser->GetWindow()->Close();
  const auto token = native.token;
  int observers = 0;
  browser->controller->SetLinuxQuitCancel([&] { browser.reset(); ++observers; });
  browser->controller->SetLinuxQuitCancel([&] { ++observers; });
  auto* pointer = browser.get();
  assert(!ardia::CancelLinuxCloseAttempt(pointer, token));
  assert(!browser && observers == 2 && native.cancels == 0);
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
}

void EmptyManagerParticipation(bool cancel) {
  Install();
  auto first = Window();
  auto second = Window();
  Native a(*first), b(*second);
  a.delay_begin = b.delay_begin = cancel;
  base::WeakPtr<BrowserCloseManager> lifetime;
  base::WeakPtr<BrowserCloseManager> attempt;
  {
    auto owner = base::WrapRefCounted(new BrowserCloseManager());
    owner->StartClosingBrowsers();
    lifetime = owner->lifetime_.GetWeakPtr();
    attempt = owner->linux_weak_factory_.GetWeakPtr();
  }
  a.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  b.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  if (cancel) {
    assert(attempt && lifetime);
    assert(a.pending.contains(ardia::LinuxCloseStage::kBeginTeardown));
    assert(b.pending.contains(ardia::LinuxCloseStage::kBeginTeardown));
    assert(ardia::CancelLinuxCloseAttempt(first.get(), a.token));
    assert(!trying_to_quit && a.cancels == 1 && b.cancels == 1);
    b.delay_begin = false;
    b.Release(ardia::LinuxCloseStage::kBeginTeardown);
    a.delay_begin = false;
    a.Release(ardia::LinuxCloseStage::kBeginTeardown);
    DrainCloseTasks();
    assert(!first->destroyed && !second->destroyed);
  } else {
    assert(first->destroyed && second->destroyed);
  }
  assert(!lifetime);
}

void BegunPreflightSurvivesCancellation() {
  Install();
  auto first = Window();
  auto second = Window();
  Native a(*first), b(*second);
  a.delay_begin = b.delay_begin = true;
  content::WebContents tab;
  tab.needs_unload = true;
  first->tabs.tabs.push_back(&tab);
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  a.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  auto acknowledged = tab.frame.linux_before_unload_request_;
  assert(!tab.Ack(true));
  DrainCloseTasks();
  b.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(first->controller->state_ == UnloadController::State::kBeforeUnloadConfirmed);
  assert(first->controller->tabs_needing_unload_fired_.size() == 1);
  a.delay_begin = false;
  a.Release(ardia::LinuxCloseStage::kBeginTeardown);
  assert(!ardia::CanCancelLinuxClose(first.get()) && tab.close_pages == 1);
  assert(ardia::CancelLinuxCloseAttempt(second.get(), b.token));
  assert(first->controller->state_ == UnloadController::State::kRunningUnload);
  assert(first->controller->tabs_needing_unload_fired_.size() == 1);
  DrainCloseTasks();
  assert(tab.close_pages == 1 && tab.dispatches == 1 && a.sealed);
  tab.environment->manager.BeforeUnloadCompleted(false, acknowledged);
  assert(tab.close_pages == 1 && first->controller->state_ == UnloadController::State::kRunningUnload);
  first->controller->ClearUnloadState(&tab, true);
  first->controller->OnWindowClosing();
  DrainCloseTasks();
  assert(first->destroyed && a.cancels == 0 && a.sealed);
}

void VetoBeforeBegin() {
  Install();
  pending_downloads = 1;
  auto first = Window();
  auto second = Window();
  Native a(*first), b(*second);
  content::WebContents original;
  original.needs_unload = true;
  first->tabs.tabs.push_back(&original);
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  a.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(!original.Ack(true));
  DrainCloseTasks();
  b.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(download_answer);
  content::WebContents added;
  added.needs_unload = true;
  first->tabs.tabs.push_back(&added);
  std::move(download_answer).Run(true);
  DrainCloseTasks();
  assert(added.dispatches == 1 && !a.begun && !b.begun);
  assert(!added.Ack(false));
  DrainCloseTasks();
  assert(a.cancels == 1 && b.cancels == 1 && !a.sealed && !b.sealed);
  assert(original.close_pages == 0 && added.close_pages == 0);
}

void SimulatedCompletionIdentity(int route = 0) {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  if (route == 0) tab.frame.SimulateBeforeUnloadCompleted(true);
  else if (route == 1) tab.frame.ContinueNavigationAfterBeforeUnloadCheck(content::BeforeUnloadExecutionMode::kForLegacy);
  else tab.frame.ProcessBeforeUnloadCompletedFromFrame(true, false, &tab.frame, true, {}, {}, content::BeforeUnloadExecutionMode::kSync, tab.frame.linux_before_unload_request_);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  tab.ReplaceDocument();
  native.prepared = true;
  browser->GetWindow()->Close();
  assert(tab.dispatches == 2 && tab.frame.is_waiting_for_beforeunload_completion_);
  DrainCloseTasks();
  assert(tab.frame.is_waiting_for_beforeunload_completion_);
  assert(tab.dispatches == 2 && tab.close_pages == 0 && !native.begun);
  assert(!tab.Ack(false, 1));
  assert(native.cancels == 2 && !native.sealed);
}


void FastCompletionIdentity() {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  browser->tabs.tabs.push_back(&tab);
  native.token = base::UnguessableToken::Create();
  native.prepared = native.sealed = true;
  assert(ardia::BindLinuxCloseAttempt(browser.get(), native.token));
  std::shared_ptr<ardia::LinuxCloseDispatch> dispatch;
  {
    ardia::ScopedLinuxCloseDispatch scope(browser.get(), &dispatch,
        [&] { return browser->tabs.GetIndexOfWebContents(&tab) != TabStripModel::kNoTab; }, [] {});
    tab.DispatchBeforeUnload(false);
  }
  assert(dispatch && !dispatch->completed);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  tab.ReplaceDocument();
  tab.DispatchBeforeUnload(false);
  DrainCloseTasks();
  assert(dispatch->revoked && dispatch->completed && !native.sealed);
  assert(tab.close_pages == 1 && !native.begun);
}


void DestroyedDocumentWakeup() {
  Install();
  auto browser = Window();
  Native native(*browser);
  auto original = std::make_unique<content::WebContents>();
  original->needs_unload = true;
  browser->tabs.tabs.push_back(original.get());
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  auto old_reply = original->TakeAck();
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(browser->controller->linux_waiting_for_dispatch_);
  content::WebContents replacement;
  replacement.needs_unload = true;
  browser->tabs.tabs = {&replacement};
  browser->controller->WebContentsDestroyed(original.get());
  original.reset();
  DrainCloseTasks();
  assert(replacement.dispatches == 1 && replacement.close_pages == 0);
  std::move(old_reply).Run(true, {}, {}, {}, {});
  assert(!replacement.Ack(false));
  DrainCloseTasks();
  assert(replacement.close_pages == 0 && native.cancels == 2 && !native.begun);
}


void MissingFrameDoesNotBeginEarly() {
  Install();
  auto first = Window();
  auto second = Window();
  Native a(*first), b(*second);
  a.delay_begin = b.delay_begin = true;
  content::WebContents tab;
  tab.needs_unload = true;
  first->tabs.tabs.push_back(&tab);
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  a.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(!tab.Ack(true));
  DrainCloseTasks();
  tab.frame.live = false;
  tab.needs_unload = false;
  b.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(a.pending.contains(ardia::LinuxCloseStage::kBeginTeardown));
  assert(first->controller->state_ == UnloadController::State::kUnloadCompleted);
  assert(!a.begun && tab.close_pages == 0 && first->tabs.closed == 0);
  assert(ardia::CancelLinuxCloseAttempt(second.get(), b.token));
  assert(a.cancels == 1 && b.cancels == 1 && !a.sealed);
  a.delay_begin = false;
  a.Release(ardia::LinuxCloseStage::kBeginTeardown);
  DrainCloseTasks();
  assert(first->tabs.closed == 0 && !first->destroyed);
}


void CoalescedIdentity() {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  tab.DispatchBeforeUnload(false);
  auto dispatch = tab.frame.linux_before_unload_request_;
  assert(dispatch->current.is_null());
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.frame.linux_before_unload_request_ == dispatch);
  assert(!dispatch->current.is_null() && tab.frame.local_frame.replies.size() == 1);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(browser->controller->linux_waiting_for_dispatch_);
  assert(!tab.Ack(true));
  DrainCloseTasks();
  assert(tab.frame.linux_before_unload_request_ != dispatch && dispatch->revoked);
  assert(tab.frame.local_frame.replies.size() == 1 && tab.close_pages == 0);
  assert(!tab.Ack(false));
  assert(native.cancels == 2 && !native.begun && tab.close_pages == 0);
}

}
