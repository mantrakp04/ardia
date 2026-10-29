namespace {

void StandaloneSubframeOverlap(bool old_first, bool old_veto,
                               bool new_veto, bool bound, int callbacks,
                               bool old_reply) {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents root, child;
  root.needs_unload = true;
  browser->tabs.tabs = {&root};
  child.frame.parent = &root.frame;
  child.frame.id = 2;
  root.frame.children = {&child.frame};
  if (bound) {
    browser->GetWindow()->Close();
    native.Release(ardia::LinuxCloseStage::kPrepare);
    DrainCloseTasks();
  } else {
    root.DispatchBeforeUnload(false);
  }
  auto old = root.frame.linux_before_unload_request_;
  root.frame.beforeunload_pending_replies_.insert(2);
  root.frame.SendBeforeUnload(false, false, child.frame.GetWeakPtr());
  auto old_child = child.TakeAck();
  root.Ack(!old_veto);
  if (!old_veto) {
    assert(!old->completed);
    assert(bound && ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
    root.ReplaceDocument();
  } else {
    assert(old->completed);
  }
  if (callbacks == 1) old->current.Reset();
  if (callbacks == 2) old->current = [] { return true; };
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  auto current = root.frame.linux_before_unload_request_;
  assert(current != old && current->hosted);
  root.frame.beforeunload_pending_replies_.insert(2);
  root.frame.SendBeforeUnload(false, false, child.frame.GetWeakPtr());
  auto fresh_child = child.TakeAck();
  root.DispatchBeforeUnload(false);
  assert(root.frame.linux_before_unload_request_ == current);
  assert(root.frame.beforeunload_pending_replies_.size() == 2);
  root.Ack(true);
  assert(!current->completed && root.close_pages == 0);
  if (old_first) std::move(old_child).Run(old_reply, {}, {}, {}, {});
  assert(!current->completed && root.close_pages == 0 && !native.begun);
  std::move(fresh_child).Run(!new_veto, {}, {}, {}, {});
  if (!old_first) std::move(old_child).Run(old_reply, {}, {}, {}, {});
  DrainCloseTasks();
  assert(root.close_pages == (new_veto ? 0 : 1));
  assert(native.begun == !new_veto);
  if (new_veto) assert(!native.sealed && ardia::CanCancelLinuxClose(browser.get()));
}

void HandlerChanged(content::RenderFrameHostImpl& frame, bool present) {
  frame.SuddenTerminationDisablerChanged(
      present, blink::mojom::SuddenTerminationDisablerType::kBeforeUnloadHandler);
}

void FreshPreflightAdmission(int change, bool synchronous, bool veto) {
  Install();
  auto browser = Window();
  Native native(*browser);
  native.delay_begin = !synchronous;
  content::WebContents original, late, child;
  original.needs_unload = true;
  HandlerChanged(original.frame, true);
  browser->tabs.tabs = {&original, &late};
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  auto change_preflight = [&] {
    if (change == 0) {
      late.needs_unload = true;
      HandlerChanged(late.frame, true);
    } else if (change == 1) {
      HandlerChanged(original.frame, false);
      HandlerChanged(original.frame, true);
    } else if (change == 2) {
      child.frame.parent = &original.frame;
      child.frame.id = 2;
      original.frame.children = {&child.frame};
      HandlerChanged(child.frame, true);
    } else {
      original.ReplaceDocument();
    }
  };
  if (synchronous) native.before_admission = change_preflight;
  original.Ack(true);
  DrainCloseTasks();
  assert(original.close_pages == 0 && !native.begun);
  if (!synchronous) {
    assert(native.pending.contains(ardia::LinuxCloseStage::kBeginTeardown));
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
        change_preflight);
    native.delay_begin = false;
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE,
        [&] { native.Release(ardia::LinuxCloseStage::kBeginTeardown); });
    DrainCloseTasks();
  }
  assert(!native.begun && ardia::CanCancelLinuxClose(browser.get()));
  assert(original.close_pages == 0 && late.close_pages == 0);
  auto& pending = change == 0 ? late : original;
  assert(pending.dispatches == (change == 0 ? 1 : 2));
  pending.Ack(!veto);
  DrainCloseTasks();
  if (veto) {
    assert(!native.begun && !native.sealed && native.cancels == 1);
    assert(original.close_pages == 0 && late.close_pages == 0);
  } else {
    assert(native.begun && !ardia::CanCancelLinuxClose(browser.get()));
    assert(original.close_pages + late.close_pages == 1);
  }
}

void NoPostedBeginGap() {
  Install();
  auto browser = Window();
  Native native(*browser);
  native.delay_begin = true;
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs = {&tab};
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  tab.Ack(true);
  native.delay_begin = false;
  native.Release(ardia::LinuxCloseStage::kBeginTeardown);
  assert(native.begun && tab.close_pages == 1);
  assert(base::SingleThreadTaskRunner::GetCurrentDefault()->tasks.empty());
}

void BegunSecondManager(bool empty, bool download) {
  Install();
  auto browser = Window();
  Native native(*browser);
  native.delay_begin = true;
  content::WebContents tab, added;
  tab.needs_unload = added.needs_unload = true;
  if (!empty) browser->tabs.tabs = {&tab};
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  if (!empty) { tab.Ack(true); DrainCloseTasks(); }
  assert(native.pending.contains(ardia::LinuxCloseStage::kBeginTeardown));
  base::WeakPtr<BrowserCloseManager> second;
  native.after_admission = [&] {
    assert(native.begun && !ardia::CanCancelLinuxClose(browser.get()));
    const auto state = browser->controller->state_;
    const auto requested = browser->controller->linux_window_close_requested_;
    const auto queue = browser->controller->tabs_needing_unload_fired_;
    const auto before = browser->controller->cancel_download_confirmation_state_;
    browser->tabs.tabs.push_back(&added);
    pending_downloads = download ? 1 : 0;
    auto manager = base::WrapRefCounted(new BrowserCloseManager());
    second = manager->linux_weak_factory_.GetWeakPtr();
    manager->StartClosingBrowsers();
    assert(browser->controller->state_ == state);
    assert(browser->controller->linux_window_close_requested_ == requested);
    assert(browser->controller->tabs_needing_unload_fired_ == queue);
    assert(browser->controller->cancel_download_confirmation_state_ == before);
    assert(!manager->current_browser_);
  };
  native.delay_begin = false;
  native.Release(ardia::LinuxCloseStage::kBeginTeardown);
  DrainCloseTasks();
  assert(native.begun && native.cancels == 0);
  if (!empty) {
    assert(tab.close_pages == 1);
    browser->controller->ClearUnloadState(&tab, true);
    DrainCloseTasks();
  }
  if (added.close_pages) {
    browser->controller->ClearUnloadState(&added, true);
    DrainCloseTasks();
  }
  if (download && download_answer) { std::move(download_answer).Run(false); }
  browser->controller->OnWindowClosing();
  DrainCloseTasks();
  assert(browser->destroyed && !second && native.sealed);
}

void AdmissionReentrancy(int mode) {
  Install();
  auto browser = Window();
  Native native(*browser);
  native.prepared = true;
  native.sealed = true;
  native.token = base::UnguessableToken::Create();
  assert(ardia::BindLinuxCloseAttempt(browser.get(), native.token));
  native.delay_begin = true;
  int commits = 0;
  bool called = false;
  auto validator = [&] {
    if (mode == 0) browser->controller->CancelWindowClose();
    if (mode == 1) {
      ardia::UnregisterLinuxCloseClient(browser.get());
      ardia::RegisterLinuxCloseClient(browser.get(), [] {});
    }
    return true;
  };
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kBeginTeardown,
      [&](bool proceed) { called = true; assert(!proceed); }, validator));
  const auto token = native.token;
  auto runner = base::SingleThreadTaskRunner::GetCurrentDefault();
  if (mode == 2) runner->on_sequence = false;
  const auto result = ardia::CommitLinuxCloseTeardown(browser.get(), token, ardia::LinuxCloseStage::kBeginTeardown,
      [&] { ++commits; return true; });
  runner->on_sequence = true;
  assert(result == ardia::LinuxCloseAdmission::kRejected && commits == 0);
  if (mode == 2) browser->controller->CancelWindowClose();
  DrainCloseTasks();
  assert(!native.begun);
  assert(called == (mode == 1));
}

bool inline_hook_active = false;
int admission_commits = 0;
bool InlineAdmission(BrowserWindowInterface* browser,
                     const base::UnguessableToken& token,
                     ardia::LinuxCloseStage stage,
                     base::OnceCallback<void(bool)> continuation) {
  inline_hook_active = true;
  const auto admission = ardia::CommitLinuxCloseTeardown(browser, token, stage, [] {
    ++admission_commits;
    return true;
  });
  std::move(continuation).Run(admission == ardia::LinuxCloseAdmission::kCommitted);
  inline_hook_active = false;
  return true;
}

void InlineAdmissionUnwinds() {
  auto browser = Window();
  const auto token = base::UnguessableToken::Create();
  assert(ardia::BindLinuxCloseAttempt(browser.get(), token));
  ardia::g_ardia_linux_close_hooks = {&InlineAdmission, nullptr};
  bool resumed = false;
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kBeginTeardown,
      [&](bool proceed) {
        assert(proceed && !inline_hook_active);
        assert(!ardia::CanCancelLinuxClose(browser.get()));
        resumed = true;
      }, [] { return true; }));
  assert(resumed && admission_commits == 1);
  assert(base::SingleThreadTaskRunner::GetCurrentDefault()->tasks.empty());
  assert(ardia::CommitLinuxCloseTeardown(browser.get(), token, ardia::LinuxCloseStage::kBeginTeardown, [] {
    assert(false);
    return true;
  }) == ardia::LinuxCloseAdmission::kCommitted);
}

void CoalescedAdmission() {
  Install();
  auto browser = Window();
  Native native(*browser);
  native.prepared = true;
  native.token = base::UnguessableToken::Create();
  assert(ardia::BindLinuxCloseAttempt(browser.get(), native.token));
  native.delay_begin = true;
  int ready = 0;
  int commits = 0;
  const auto token = native.token;
  auto validator = [&] {
    assert(ardia::CommitLinuxCloseTeardown(browser.get(), token, ardia::LinuxCloseStage::kBeginTeardown, [] {
      assert(false);
      return true;
    }) == ardia::LinuxCloseAdmission::kRejected);
    return true;
  };
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kBeginTeardown,
      [&](bool proceed) { assert(proceed); ++ready; }, validator));
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kBeginTeardown,
      [&](bool proceed) { assert(proceed); ++ready; }, validator));
  assert(ardia::CommitLinuxCloseTeardown(browser.get(), token, ardia::LinuxCloseStage::kBeginTeardown,
      [&] { ++commits; return true; }) == ardia::LinuxCloseAdmission::kCommitted);
  native.Release(ardia::LinuxCloseStage::kBeginTeardown);
  assert(commits == 1 && ready == 2);
}

void NativeCommitReentrancy() {
  Install();
  auto browser = Window();
  Native native(*browser);
  native.prepared = true;
  native.token = base::UnguessableToken::Create();
  assert(ardia::BindLinuxCloseAttempt(browser.get(), native.token));
  native.delay_begin = true;
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kBeginTeardown,
      [](bool) { assert(false); }, [] { return true; }));
  const auto& aliased_token = native.token;
  assert(ardia::CommitLinuxCloseTeardown(browser.get(), aliased_token, ardia::LinuxCloseStage::kBeginTeardown,
      [&] {
        browser->controller->CancelWindowClose();
        return false;
      }) == ardia::LinuxCloseAdmission::kRejected);
  assert(!native.begun && native.token.is_empty());
  assert(ardia::CanCancelLinuxClose(browser.get()));
}

void DeferredForceWithNewWindow() {
  Install();
  ignore_unload = true;
  auto browser = Window();
  Native native(*browser);
  native.delay_begin = true;
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs = {&tab};
  auto manager = base::WrapRefCounted(new BrowserCloseManager());
  manager->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(native.pending.contains(ardia::LinuxCloseStage::kBeginTeardown));
  auto added = Window();
  Native late(*added);
  native.delay_begin = false;
  native.Release(ardia::LinuxCloseStage::kBeginTeardown);
  assert(browser->tabs.empty() && browser->destroyed && native.begun);
  assert(!late.begun && late.pending.contains(ardia::LinuxCloseStage::kPrepare));
  assert(tab.dispatches == 0 && !ardia::CanCancelLinuxClose(browser.get()));
  assert(ardia::CancelLinuxCloseAttempt(added.get(), late.token));
  assert(native.sealed && !late.sealed);
}

}

void AdmissionRequiresCertificate(ardia::LinuxCloseStage stage) {
  Install();
  auto browser = Window();
  Native native(*browser);
  bool called = false;
  int commits = 0;
  assert(ardia::GateLinuxClose(browser.get(), stage,
      [&](bool proceed) { called = true; assert(!proceed); }));
  const auto token = native.token;
  assert(ardia::CommitLinuxCloseTeardown(browser.get(), token, stage,
      [&] { ++commits; return true; }) == ardia::LinuxCloseAdmission::kRejected);
  assert(commits == 0 && !native.begun && ardia::CanCancelLinuxClose(browser.get()));
  native.Release(stage, false);
  DrainCloseTasks();
  assert(called);
}

void RetiredAttemptBound() {
  Install();
  auto browser = Window();
  Native native(*browser);
  base::UnguessableToken first;
  for (int i = 0; i < 1024; ++i) {
    native.token = base::UnguessableToken::Create();
    if (i == 0) first = native.token;
    assert(ardia::BindLinuxCloseAttempt(browser.get(), native.token));
    const auto token = native.token;
    assert(ardia::CancelLinuxCloseAttempt(browser.get(), token));
    assert(native.token.is_empty());
  }
  assert(native.cancels == 1024);
  assert(!ardia::BindLinuxCloseAttempt(browser.get(), first));
  assert(!ardia::BindLinuxCloseAttempt(browser.get(), base::UnguessableToken::Create()));
  assert(ardia::CanCancelLinuxClose(browser.get()));
}
