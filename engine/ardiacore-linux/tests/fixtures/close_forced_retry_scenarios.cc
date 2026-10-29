namespace {

void ForcedRetryOrdering(int mode, bool veto, bool new_window) {
  Install();
  ignore_unload = true;
  auto browser = Window();
  Native native(*browser);
  native.delay_begin = true;
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs = {&tab};
  const auto before_close = [&] {
    assert(native.begun && !ardia::CanCancelLinuxClose(browser.get()));
    assert(ardia::CurrentLinuxCloseToken(browser.get()) == native.token);
  };
  browser->tabs.before_close_all = before_close;
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  auto other = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  const auto token = native.token;
  assert(native.pending.contains(ardia::LinuxCloseStage::kBeginTeardown));
  if (mode == 0) owner->StartClosingBrowsers();
  if (mode == 1) ignore_unload = false;
  if (mode == 2) {
    owner->StartClosingBrowsers();
    other->StartClosingBrowsers();
  }
  if (mode == 3) {
    other->StartClosingBrowsers();
    ignore_unload = false;
  }
  std::unique_ptr<BrowserWindowInterface> added;
  std::unique_ptr<Native> late;
  if (new_window) {
    added = Window();
    late = std::make_unique<Native>(*added);
    added->tabs.before_close_all = [&] {
      assert(late->begun && !ardia::CanCancelLinuxClose(added.get()));
      assert(ardia::CurrentLinuxCloseToken(added.get()) == late->token);
    };
  }
  native.delay_begin = false;
  native.Release(ardia::LinuxCloseStage::kBeginTeardown);
  DrainCloseTasks();
  assert(ardia::CurrentLinuxCloseToken(browser.get()) == token);
  if (mode == 1 || mode == 3) {
    assert(!native.begun && native.cancels == 0);
    assert(ardia::CanCancelLinuxClose(browser.get()));
    assert(browser->tabs.closed == 0 && !browser->destroyed);
    assert(tab.dispatches == 1 && tab.close_pages == 0);
    assert(!browser->controller->force_skip_warning_user_on_close());
    tab.Ack(!veto);
    DrainCloseTasks();
    if (veto) {
      assert(!native.begun && native.cancels == 1 && !native.sealed);
      assert(tab.close_pages == 0 && browser->tabs.closed == 0);
      assert(!browser->destroyed && owner->linux_cancelled_);
      if (mode == 3) assert(other->linux_cancelled_);
      return;
    }
  }
  if (new_window) {
    assert(!late->begun && !native.begun);
    assert(added->tabs.closed == 0 && browser->tabs.closed == 0);
    assert(late->pending.contains(ardia::LinuxCloseStage::kPrepare));
    late->Release(ardia::LinuxCloseStage::kPrepare);
    DrainCloseTasks();
  }
  assert(native.begun && native.cancels == 0);
  if (mode == 1 || mode == 3) {
    assert(tab.dispatches == 1 && tab.close_pages == 1);
    browser->controller->ClearUnloadState(&tab, true);
    DrainCloseTasks();
    browser->controller->OnWindowClosing();
    DrainCloseTasks();
  }
  assert(browser->destroyed && native.sealed);
  if (new_window) assert(added->destroyed && late->begun);
}

void ForcedCallbackLease(int mode) {
  Install();
  ignore_unload = true;
  auto browser = Window();
  Native native(*browser);
  native.delay_begin = true;
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs = {&tab};
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  const auto old = native.token;
  auto attempt = owner->linux_weak_factory_.GetWeakPtr();
  auto weak_browser = browser->GetWeakPtr();
  auto callback = base::BindOnce(&BrowserCloseManager::OnLinuxTeardownReady,
      owner, attempt, weak_browser, mode == 0 ? base::UnguessableToken() : old);
  if (mode == 1 || mode == 2 || mode == 3) {
    assert(ardia::CancelLinuxCloseAttempt(browser.get(), old));
    native.pending.erase(ardia::LinuxCloseStage::kBeginTeardown);
    owner->StartClosingBrowsers();
    native.Release(ardia::LinuxCloseStage::kPrepare);
    DrainCloseTasks();
    assert(native.token != old);
    if (mode == 2 || mode == 3) {
      native.delay_destroy = true;
      native.delay_begin = false;
      native.Release(ardia::LinuxCloseStage::kBeginTeardown);
      assert(native.begun && !ardia::CanCancelLinuxClose(browser.get()));
    }
  }
  const auto current = native.token;
  const auto closed = browser->tabs.closed;
  const auto cancels = native.cancels;
  std::move(callback).Run(mode != 3);
  assert(browser->tabs.closed == closed && !browser->destroyed);
  assert(native.cancels == cancels);
  assert(ardia::CurrentLinuxCloseToken(browser.get()) == current);
  if (native.begun) {
    native.delay_destroy = false;
    native.Release(ardia::LinuxCloseStage::kDestroy);
    DrainCloseTasks();
    assert(browser->destroyed && native.sealed);
  } else {
    assert(ardia::CancelLinuxCloseAttempt(browser.get(), current));
  }
}

void ForcedDestroyLease(int mode) {
  Install();
  ignore_unload = true;
  auto browser = Window();
  Native native(*browser);
  native.delay_begin = true;
  native.delay_destroy = true;
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs = {&tab};
  browser->tabs.before_close_all = [&] {
    assert(native.begun && !ardia::CanCancelLinuxClose(browser.get()));
    assert(ardia::CurrentLinuxCloseToken(browser.get()) == native.token);
  };
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  native.delay_begin = false;
  native.Release(ardia::LinuxCloseStage::kBeginTeardown);
  assert(native.begun && browser->tabs.closed > 0 && !browser->destroyed);
  assert(base::SingleThreadTaskRunner::GetCurrentDefault()->tasks.empty());
  const auto token = native.token;
  if (mode == 0) owner->StartClosingBrowsers();
  if (mode == 1) {
    owner->CancelBrowserClose();
    ignore_unload = false;
  }
  if (mode == 2) {
    browser->weak.InvalidateWeakPtrs();
  }
  native.delay_destroy = false;
  native.Release(ardia::LinuxCloseStage::kDestroy);
  DrainCloseTasks();
  assert(ardia::CurrentLinuxCloseToken(browser.get()) == token);
  assert(native.cancels == 0 && native.sealed);
  assert(browser->destroyed == (mode != 2));
}

void ForcedCancelledBeforeBegin() {
  Install();
  ignore_unload = true;
  auto browser = Window();
  Native native(*browser);
  native.delay_begin = true;
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs = {&tab};
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  owner->CancelBrowserClose();
  native.delay_begin = false;
  native.Release(ardia::LinuxCloseStage::kBeginTeardown);
  DrainCloseTasks();
  assert(!native.begun && native.cancels == 1 && !native.sealed);
  assert(browser->tabs.closed == 0 && !browser->destroyed && tab.dispatches == 0);
}

void ForcedPlainControls(bool null_hooks) {
  if (null_hooks) ardia::g_ardia_linux_close_hooks = {};
  else Install();
  ignore_unload = true;
  auto browser = Window();
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs = {&tab};
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  DrainCloseTasks();
  assert(browser->tabs.empty() && browser->destroyed && tab.dispatches == 0);
  assert(ardia::CurrentLinuxCloseToken(browser.get()).is_empty());
}

void ForcedDirtyDestroyRetry(bool veto) {
  Install();
  ignore_unload = false;
  auto browser = Window();
  Native native(*browser);
  native.prepared = true;
  native.delay_destroy = true;
  native.token = base::UnguessableToken::Create();
  const auto token = native.token;
  assert(ardia::BindLinuxCloseAttempt(browser.get(), token));
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs = {&tab};
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  browser->controller->SetLinuxQuitCancel(owner->MakeLinuxQuitCancel());
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kDestroy,
      base::BindOnce(&BrowserCloseManager::OnLinuxTeardownReady, owner,
          owner->linux_weak_factory_.GetWeakPtr(), browser->GetWeakPtr(), token),
      [] { return false; }));
  native.delay_destroy = false;
  native.Release(ardia::LinuxCloseStage::kDestroy);
  DrainCloseTasks();
  assert(!native.begun && native.cancels == 0);
  assert(ardia::CanCancelLinuxClose(browser.get()));
  assert(ardia::CurrentLinuxCloseToken(browser.get()) == token);
  assert(tab.dispatches == 1 && tab.close_pages == 0 && browser->tabs.closed == 0);
  tab.Ack(!veto);
  DrainCloseTasks();
  if (veto) {
    assert(native.cancels == 1 && !native.begun && !native.sealed);
    assert(!browser->destroyed && browser->tabs.closed == 0);
  } else {
    assert(native.begun && tab.close_pages == 1 && native.cancels == 0);
    browser->controller->ClearUnloadState(&tab, true);
    DrainCloseTasks();
    browser->controller->OnWindowClosing();
    DrainCloseTasks();
    assert(browser->destroyed && native.sealed);
  }
}

}
