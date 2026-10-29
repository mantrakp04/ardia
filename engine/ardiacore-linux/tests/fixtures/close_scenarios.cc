namespace {

struct Native;
std::map<BrowserWindowInterface*, Native*> native_hosts;

struct Native {
  explicit Native(BrowserWindowInterface& value) : browser(&value) {
    native_hosts.emplace(browser, this);
  }
  ~Native() { native_hosts.erase(browser); }
  void Release(ardia::LinuxCloseStage stage, bool proceed = true) {
    auto it = pending.find(stage);
    assert(it != pending.end());
    auto callback = std::move(it->second);
    pending.erase(it);
    if (proceed) {
      prepared = true;
      if (before_admission) std::move(before_admission).Run();
      if (stage != ardia::LinuxCloseStage::kPrepare && !begun) {
        const auto result = ardia::CommitLinuxCloseTeardown(
            browser, token, stage, [this] { begun = true; return true; });
        proceed = result != ardia::LinuxCloseAdmission::kRejected;
      }
    }
    if (after_admission) std::move(after_admission).Run();
    std::move(callback).Run(proceed);
  }
  BrowserWindowInterface* browser;
  base::UnguessableToken token;
  bool prepared = false;
  bool begun = false;
  bool sealed = false;
  bool delay_begin = false;
  bool delay_destroy = false;
  bool widget_acknowledged = false;
  int cancels = 0;
  int prepares = 0;
  base::OnceClosure before_admission;
  base::OnceClosure after_admission;
  std::map<ardia::LinuxCloseStage, base::OnceCallback<void(bool)>> pending;
};

bool Defer(BrowserWindowInterface* browser, const base::UnguessableToken& token,
           ardia::LinuxCloseStage stage, base::OnceCallback<void(bool)> callback) {
  auto it = native_hosts.find(browser);
  if (it == native_hosts.end()) return false;
  auto& native = *it->second;
  if (token.is_empty()) {
    if (native.token.is_empty()) native.token = base::UnguessableToken::Create();
    assert(ardia::BindLinuxCloseAttempt(browser, native.token));
    ++native.prepares;
  } else {
    assert(token == native.token);
  }
  bool wait = !native.prepared ||
      (stage == ardia::LinuxCloseStage::kBeginTeardown && native.delay_begin) ||
      (stage == ardia::LinuxCloseStage::kDestroy && native.delay_destroy);
  if (wait) {
    assert(!native.pending.contains(stage));
    native.pending.emplace(stage, std::move(callback));
    return true;
  }
  native.sealed = true;
  if (native.before_admission) std::move(native.before_admission).Run();
  if (stage != ardia::LinuxCloseStage::kPrepare && !native.begun) {
    const auto result = ardia::CommitLinuxCloseTeardown(
        browser, native.token, stage, [&native] { native.begun = true; return true; });
    if (result != ardia::LinuxCloseAdmission::kCommitted) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(std::move(callback),
              result == ardia::LinuxCloseAdmission::kRetryPreflight));
      return true;
    }
  }
  return false;
}

void Cancel(BrowserWindowInterface* browser, const base::UnguessableToken& token) {
  auto& native = *native_hosts.at(browser);
  assert(token == native.token);
  assert(!native.begun);
  auto* unload = browser->controller;
  assert(unload->state_ == UnloadController::State::kIdle);
  assert(unload->tabs_needing_before_unload_fired_.empty());
  assert(unload->tabs_needing_unload_fired_.empty());
  assert(unload->on_close_confirmed_.is_null());
  assert(unload->warn_before_closing_callback_.is_null());
  assert(!close_events.empty());
  assert(std::ranges::find(close_events, "chrome-reset") != close_events.end());
  close_events.push_back("native-cancel");
  native.token = base::UnguessableToken();
  native.prepared = false;
  native.sealed = false;
  ++native.cancels;
}

void Install() { ardia::g_ardia_linux_close_hooks = {&Defer, &Cancel}; }

std::unique_ptr<BrowserWindowInterface> Window() {
  auto browser = std::make_unique<BrowserWindowInterface>();
  browser->controller = new UnloadController(browser.get());
  browsers.push_back(browser.get());
  return browser;
}

void Hooks() {
  auto browser = Window();
  auto* b = browser.get();
  assert(!ardia::GateLinuxClose(b, ardia::LinuxCloseStage::kPrepare,
                                [](bool) { assert(false); }));
  Install();
  assert(!ardia::GateLinuxClose(b, ardia::LinuxCloseStage::kPrepare,
                                [](bool) { assert(false); }));
  Native native(*b);
  int ready = 0;
  assert(ardia::GateLinuxClose(b, ardia::LinuxCloseStage::kPrepare,
                               [&](bool ok) { assert(ok); ++ready; }));
  const auto first = native.token;
  assert(!first.is_empty());
  assert(!ardia::BindLinuxCloseAttempt(b, base::UnguessableToken::Create()));
  assert(ardia::GateLinuxClose(b, ardia::LinuxCloseStage::kPrepare,
                               [&](bool ok) { assert(ok); ++ready; }));
  native.Release(ardia::LinuxCloseStage::kPrepare);
  assert(ready == 0 && !native.widget_acknowledged);
  DrainCloseTasks();
  assert(ready == 2 && !native.widget_acknowledged);
  assert(ardia::CancelLinuxCloseAttempt(b, first));
  assert(ardia::CancelLinuxCloseAttempt(b, first));
  assert(native.cancels == 1);
  assert(!ardia::BindLinuxCloseAttempt(b, first));
  assert(ardia::GateLinuxClose(b, ardia::LinuxCloseStage::kPrepare,
                               [&](bool) { ++ready; }));
  assert(native.token != first);
  const auto second = native.token;
  assert(!ardia::CancelLinuxCloseAttempt(b, first));
  native.Release(ardia::LinuxCloseStage::kPrepare);
  assert(ardia::CancelLinuxCloseAttempt(b, second));
  DrainCloseTasks();
  assert(ready == 2);
  assert(!ardia::BindLinuxCloseAttempt(b, first));
  ardia::UnregisterLinuxCloseClient(b);
  ardia::RegisterLinuxCloseClient(b, [] {});
  const auto unconfirmed = base::UnguessableToken::Create();
  assert(ardia::BindLinuxCloseAttempt(b, unconfirmed));
  assert(!ardia::CancelLinuxCloseAttempt(b, unconfirmed));
  assert(ardia::CurrentLinuxCloseToken(b) == unconfirmed);
  ardia::g_ardia_linux_close_hooks = {};
  ardia::FinishLinuxCloseCancellation(b, unconfirmed);
  assert(ardia::CancelLinuxCloseAttempt(b, unconfirmed));
}

void Ordinary() {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  browser->GetWindow()->Close();
  assert(tab.dispatches == 0 && tab.close_pages == 0);
  assert(browser->tabs.closed == 0);
  native.Release(ardia::LinuxCloseStage::kPrepare);
  assert(tab.dispatches == 0);
  DrainCloseTasks();
  assert(tab.dispatches == 1 && tab.close_pages == 0);
  native.sealed = true;
  const auto token = native.token;
  native.delay_begin = true;
  assert(!tab.Ack(true));
  assert(tab.close_pages == 0 && !native.begun);
  assert(!native.widget_acknowledged);
  native.delay_begin = false;
  native.Release(ardia::LinuxCloseStage::kBeginTeardown);
  assert(!ardia::CancelLinuxCloseAttempt(browser.get(), token));
  assert(tab.close_pages == 1 && native.sealed);
  DrainCloseTasks();
  assert(tab.close_pages == 1 && native.begun);
  assert(!ardia::CancelLinuxCloseAttempt(browser.get(), token));
  assert(native.sealed && native.cancels == 0);
  browser->controller->ClearUnloadState(&tab, true);
  assert(browser->tabs.closed == 1);
  browser->controller->OnWindowClosing();
  assert(browser->controller->is_delete_scheduled_);
  DrainCloseTasks();
  assert(browser->destroyed);
  assert(!native.widget_acknowledged);
  native.widget_acknowledged = true;
}

void Timeout() {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 1);
  native.sealed = true;
  const auto token = native.token;
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), token));
  assert(!native.sealed && native.cancels == 1);
  browser->controller->ProcessPendingTabs(false);
  assert(tab.close_pages == 0 && browser->tabs.closed == 0);
  assert(!tab.Ack(true));
  assert(tab.close_pages == 0 && browser->tabs.closed == 0);
  browser->GetWindow()->Close();
  assert(native.token != token);
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 2);
  const auto next = native.token;
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), next));
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 2);
  assert(!tab.Ack(true));
  DrainCloseTasks();
  assert(tab.dispatches == 3);
  assert(!tab.Ack(true));
  assert(tab.close_pages == 1 && native.begun);
  assert(!ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  assert(native.sealed);
}

void Quit() {
  Install();
  auto first = Window();
  auto second = Window();
  Native a(*first), b(*second);
  content::WebContents tab;
  tab.needs_unload = true;
  first->tabs.tabs.push_back(&tab);
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  assert(tab.dispatches == 0);
  a.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 1 && b.pending.empty());
  assert(!tab.Ack(true));
  DrainCloseTasks();
  assert(b.pending.size() == 1);
  auto third = Window();
  Native c(*third);
  b.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(c.pending.size() == 1);
  assert(shutdown_sessions == 0 && first->tabs.closed == 0);
  c.Release(ardia::LinuxCloseStage::kPrepare, false);
  DrainCloseTasks();
  assert(owner->linux_cancelled_ && !trying_to_quit);
  assert(a.cancels == 1 && b.cancels == 1 && c.cancels == 1);
  assert(tab.close_pages == 0 && first->tabs.closed == 0);
  owner->StartClosingBrowsers();
  a.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(!tab.Ack(true));
  DrainCloseTasks();
  b.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  c.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(shutdown_sessions == 1);
  assert(tab.close_pages == 1 && a.begun && b.begun && c.begun);
}

void Downloads() {
  Install();
  auto browser = Window();
  Native native(*browser);
  pending_downloads = 1;
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(download_answer && !owner->linux_cancelled_);
  auto token = native.token;
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), token));
  assert(owner->linux_cancelled_ && !trying_to_quit && native.cancels == 1);
  std::move(download_answer).Run(true);
  DrainCloseTasks();
  assert(shutdown_sessions == 0 && !browser->destroyed);
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(download_answer);
  std::move(download_answer).Run(false);
  DrainCloseTasks();
  assert(native.cancels == 2 && shutdown_sessions == 0);
  pending_downloads = 0;
  browser->controller->warn = true;
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(browser->controller->warn_before_closing_callback_);
  std::move(browser->controller->warn_before_closing_callback_)
      .Run(UnloadController::WarnBeforeClosingResult::kDoNotClose);
  assert(native.cancels == 3 && !browser->destroyed);
}

void Boundaries() {
  Install();
  auto browser = Window();
  Native native(*browser);
  browser->controller->OnWindowCloseComplete();
  assert(!browser->controller->is_delete_scheduled_);
  assert(browser->controller->browser_did_close_callback_list_.count == 0);
  native.delay_destroy = false;
  native.Release(ardia::LinuxCloseStage::kDestroy);
  DrainCloseTasks();
  assert(browser->controller->is_delete_scheduled_);
  assert(browser->destroyed && native.begun);
  assert(!ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  auto plain = Window();
  content::WebContents tab;
  plain->tabs.tabs.push_back(&tab);
  plain->GetWindow()->Close();
  assert(plain->tabs.closed == 1);
  ardia::g_ardia_linux_close_hooks = {};
  auto null = Window();
  null->tabs.tabs.push_back(&tab);
  null->GetWindow()->Close();
  assert(null->tabs.closed == 1);
}

void Destroyed() {
  Install();
  auto browser = Window();
  Native native(*browser);
  base::WeakPtr<BrowserCloseManager> weak_manager;
  {
    auto owner = base::WrapRefCounted(new BrowserCloseManager());
    owner->StartClosingBrowsers();
    weak_manager = owner->linux_weak_factory_.GetWeakPtr();
  }
  assert(weak_manager);
  browser.reset();
  DrainCloseTasks();
  assert(!weak_manager);
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(shutdown_sessions == 0);
}

void Force() {
  Install();
  ignore_unload = true;
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  assert(browser->tabs.closed == 0 && shutdown_sessions == 0);
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(browser->tabs.closed > 0 && browser->destroyed);
  assert(tab.dispatches == 0 && native.begun && native.sealed);
  assert(!ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
}


void ChromeCancellation() {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 1);
  assert(!tab.Ack(false));
  assert(owner->linux_cancelled_ && !trying_to_quit);
  assert(native.cancels == 1 && !native.sealed);
  assert(tab.close_pages == 0 && shutdown_sessions == 0);
  auto reset = std::ranges::find(close_events, "quit-false");
  auto cancel = std::ranges::find(close_events, "native-cancel");
  assert(reset < cancel);
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 2);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  assert(!tab.Ack(true));
  DrainCloseTasks();
  assert(tab.close_pages == 0 && native.cancels == 2);
}

void NewWindowAtDownloads() {
  Install();
  auto first = Window();
  Native a(*first);
  pending_downloads = 1;
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  a.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(download_answer);
  auto second = Window();
  Native b(*second);
  content::WebContents tab;
  tab.needs_unload = true;
  second->tabs.tabs.push_back(&tab);
  std::move(download_answer).Run(true);
  DrainCloseTasks();
  assert(b.pending.contains(ardia::LinuxCloseStage::kPrepare));
  assert(shutdown_sessions == 0 && tab.dispatches == 0);
  b.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 1 && shutdown_sessions == 0);
  assert(!tab.Ack(false));
  assert(owner->linux_cancelled_ && a.cancels == 1 && b.cancels == 1);
}

void RetiredDispatch() {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 1);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  tab.ReplaceDocument();
  browser->controller->RenderProcessGone(&tab, 0);
  assert(browser->controller->linux_pending_unloads_.empty() || browser->controller->linux_pending_unloads_.at(&tab).request->revoked);
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 2);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  browser->controller->TabDetachedImpl(&tab);
  assert(browser->controller->linux_pending_unloads_.empty() || browser->controller->linux_pending_unloads_.at(&tab).request->revoked);
}

void Aba() {
  Install();
  alignas(BrowserWindowInterface) unsigned char storage[sizeof(BrowserWindowInterface)];
  auto* first = new (storage) BrowserWindowInterface;
  first->controller = new UnloadController(first);
  browsers.push_back(first);
  base::OnceCallback<void(bool)> old_reply;
  base::UnguessableToken old_token;
  int old_successes = 0;
  {
    Native native(*first);
    assert(ardia::GateLinuxClose(first, ardia::LinuxCloseStage::kPrepare,
                                 [&](bool ok) { if (ok) ++old_successes; }));
    old_reply = std::move(native.pending.at(ardia::LinuxCloseStage::kPrepare));
    old_token = native.token;
  }
  first->~BrowserWindowInterface();
  auto* second = new (storage) BrowserWindowInterface;
  second->controller = new UnloadController(second);
  browsers.push_back(second);
  {
    Native native(*second);
    int ready = 0;
    assert(ardia::GateLinuxClose(second, ardia::LinuxCloseStage::kPrepare,
                                 [&](bool ok) { if (ok) ++ready; }));
    assert(!ardia::CancelLinuxCloseAttempt(second, old_token));
    std::move(old_reply).Run(true);
    DrainCloseTasks();
    assert(old_successes == 0 && ready == 0 && native.cancels == 0);
    native.Release(ardia::LinuxCloseStage::kPrepare);
    DrainCloseTasks();
    assert(ready == 1);
    assert(ardia::CancelLinuxCloseAttempt(second, native.token));
  }
  second->~BrowserWindowInterface();
}

void PostedDestruction() {
  Install();
  auto browser = Window();
  Native native(*browser);
  native.prepared = true;
  browser->controller->OnWindowCloseComplete();
  assert(browser->controller->is_delete_scheduled_ && !browser->destroyed);
  native.delay_destroy = true;
  DrainCloseTasks();
  assert(!browser->destroyed && native.sealed);
  assert(!ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  native.delay_destroy = false;
  native.Release(ardia::LinuxCloseStage::kDestroy);
  DrainCloseTasks();
  assert(browser->destroyed && native.sealed);
}

void Reentrant() {
  Install();
  auto browser = Window();
  Native native(*browser);
  int ready = 0;
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kPrepare,
                               [&](bool ok) {
                                 assert(ok);
                                 ++ready;
                                 assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
                               }));
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kPrepare,
                               [&](bool) { assert(false); }));
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(ready == 1 && native.cancels == 1);
  ardia::g_ardia_linux_close_hooks.defer =
      +[](BrowserWindowInterface* browser, const base::UnguessableToken&,
          ardia::LinuxCloseStage, base::OnceCallback<void(bool)>) {
        auto& native = *native_hosts.at(browser);
        native.token = base::UnguessableToken::Create();
        assert(ardia::BindLinuxCloseAttempt(browser, native.token));
        assert(ardia::CancelLinuxCloseAttempt(browser, native.token));
        return false;
      };
  browser->GetWindow()->Close();
  assert(browser->tabs.closed == 0 && !browser->controller->is_delete_scheduled_);
}


void DocumentReplacement() {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 1);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  tab.ReplaceDocument();
  browser->GetWindow()->Close();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 2);
  assert(!tab.Ack(true));
  DrainCloseTasks();
  assert(tab.dispatches == 2 && tab.close_pages == 0);
  assert(!tab.Ack(false));
  assert(native.cancels == 2 && tab.close_pages == 0);
}

void RepeatedManagers() {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  auto first = base::WrapRefCounted(new BrowserCloseManager());
  auto second = base::WrapRefCounted(new BrowserCloseManager());
  first->StartClosingBrowsers();
  first->StartClosingBrowsers();
  second->StartClosingBrowsers();
  const auto token = native.token;
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), token));
  assert(first->linux_cancelled_ && second->linux_cancelled_);
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 0 && shutdown_sessions == 0);
}

void DestroyedBeforeUnload() {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  tab.needs_unload = true;
  browser->tabs.tabs.push_back(&tab);
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.dispatches == 1);
  browser.reset();
  DrainCloseTasks();
  assert(owner->linux_cancelled_ && !trying_to_quit);
  assert(native.cancels == 0 && shutdown_sessions == 0);
}


void PartialTeardown() {
  Install();
  auto first = Window();
  auto second = Window();
  Native a(*first), b(*second);
  b.delay_begin = true;
  content::WebContents tab;
  tab.needs_unload = true;
  first->tabs.tabs.push_back(&tab);
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  a.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(!tab.Ack(true));
  DrainCloseTasks();
  b.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(tab.close_pages == 1 && a.begun && b.pending.contains(ardia::LinuxCloseStage::kBeginTeardown));
  b.Release(ardia::LinuxCloseStage::kBeginTeardown, false);
  DrainCloseTasks();
  assert(owner->linux_cancelled_ && a.cancels == 0 && a.sealed);
  assert(b.cancels == 1 && !b.sealed);
  first->controller->ClearUnloadState(&tab, true);
  assert(first->tabs.closed == 1 && a.sealed);
}


int reentrant_ready = 0;
void SynchronousReentry() {
  Install();
  auto browser = Window();
  Native native(*browser);
  ardia::g_ardia_linux_close_hooks.defer =
      +[](BrowserWindowInterface* browser, const base::UnguessableToken&,
          ardia::LinuxCloseStage stage, base::OnceCallback<void(bool)>) {
        auto& native = *native_hosts.at(browser);
        native.token = base::UnguessableToken::Create();
        native.prepared = true;
        assert(ardia::BindLinuxCloseAttempt(browser, native.token));
        assert(ardia::GateLinuxClose(browser, stage,
                                     [](bool ok) { assert(ok); ++reentrant_ready; }));
        return false;
      };
  assert(!ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kPrepare,
                                [](bool) { assert(false); }));
  assert(reentrant_ready == 0);
  DrainCloseTasks();
  assert(reentrant_ready == 1);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
  ardia::g_ardia_linux_close_hooks.defer =
      +[](BrowserWindowInterface* browser, const base::UnguessableToken&,
          ardia::LinuxCloseStage stage, base::OnceCallback<void(bool)>) {
        assert(ardia::GateLinuxClose(browser, stage,
                                     [](bool ok) { assert(ok); ++reentrant_ready; }));
        return false;
      };
  assert(!ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kDestroy,
                                [](bool) { assert(false); }));
  DrainCloseTasks();
  assert(reentrant_ready == 2 && ardia::CanCancelLinuxClose(browser.get()));
}


void ArdiaAskedAboutDownloads() {
  Install();
  auto browser = Window();
  Native native(*browser);
  pending_downloads = 2;
  assert(!ardia::LinuxQuitAsksAboutDownloads());
  ardia::SetLinuxQuitAsksAboutDownloads(true);
  assert(ardia::LinuxQuitAsksAboutDownloads());
  auto owner = base::WrapRefCounted(new BrowserCloseManager());
  owner->StartClosingBrowsers();
  native.Release(ardia::LinuxCloseStage::kPrepare);
  DrainCloseTasks();
  assert(!download_answer && download_answers.empty());
  assert(!owner->linux_cancelled_ && trying_to_quit && shutdown_sessions == 1);
  ardia::SetLinuxQuitAsksAboutDownloads(false);
  assert(!ardia::LinuxQuitAsksAboutDownloads());
  pending_downloads = 0;
}
}

int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  if (mode == "hooks") Hooks();
  else if (mode == "ordinary") Ordinary();
  else if (mode == "timeout") Timeout();
  else if (mode == "quit") Quit();
  else if (mode == "downloads") Downloads();
  else if (mode == "ardia-asked-downloads") ArdiaAskedAboutDownloads();
  else if (mode == "boundaries") Boundaries();
  else if (mode == "destroyed") Destroyed();
  else if (mode == "force") Force();
  else if (mode == "chrome-cancel") ChromeCancellation();
  else if (mode == "new-window-downloads") NewWindowAtDownloads();
  else if (mode == "retired-dispatch") RetiredDispatch();
  else if (mode == "aba") Aba();
  else if (mode == "posted-destruction") PostedDestruction();
  else if (mode == "reentrant") Reentrant();
  else if (mode == "document-replacement") DocumentReplacement();
  else if (mode == "repeated-managers") RepeatedManagers();
  else if (mode == "destroyed-beforeunload") DestroyedBeforeUnload();
  else if (mode == "partial-teardown") PartialTeardown();
  else if (mode == "synchronous-reentry") SynchronousReentry();
  else if (mode == "retirement-ack") RetirementAck(false);
  else if (mode == "detach-ack") RetirementAck(true);
  else if (mode == "outermost-cancel") OutermostCancellation();
  else if (mode == "delete-requester") CancellationDeletesRequester();
  else if (mode == "empty-cancel") EmptyManagerParticipation(true);
  else if (mode == "empty-complete") EmptyManagerParticipation(false);
  else if (mode == "begun-preflight") BegunPreflightSurvivesCancellation();
  else if (mode == "veto-before-begin") VetoBeforeBegin();
  else if (mode == "simulated-identity") SimulatedCompletionIdentity();
  else if (mode == "legacy-identity") SimulatedCompletionIdentity(1);
  else if (mode == "queued-identity") SimulatedCompletionIdentity(2);
  else if (mode == "fast-identity") FastCompletionIdentity();
  else if (mode == "destroyed-document") DestroyedDocumentWakeup();
  else if (mode == "missing-frame") MissingFrameDoesNotBeginEarly();
  else if (mode == "coalesced-identity") CoalescedIdentity();
  else if (mode.starts_with("ack-order-")) DispatchOrdering(mode.at(10) == '1', mode.at(11) == '1', mode.at(12) == '1', false, false);
  else if (mode.starts_with("waiting-event-")) DispatchOrdering(mode.at(14) == '1', false, false, true, mode.at(15) == '1');
  else if (mode.starts_with("fresh-overlap-")) StandaloneSubframeOverlap(mode.at(14) == '1', mode.at(15) == '1', mode.at(16) == '1', mode.at(17) == '1', mode.at(18) - '0', mode.at(19) == '1');
  else if (mode.starts_with("fresh-admission-")) FreshPreflightAdmission(mode.at(16) - '0', mode.at(17) == '1', mode.at(18) == '1');
  else if (mode == "fresh-force") DeferredForceWithNewWindow();
  else if (mode == "fresh-no-gap") NoPostedBeginGap();
  else if (mode == "fresh-inline") InlineAdmissionUnwinds();
  else if (mode == "fresh-coalesced") CoalescedAdmission();
  else if (mode == "fresh-native-reentry") NativeCommitReentrancy();
  else if (mode.starts_with("fresh-second-")) BegunSecondManager(mode.at(13) == '1', mode.at(14) == '1');
  else if (mode.starts_with("fresh-reentrant-")) AdmissionReentrancy(mode.at(16) - '0');
  else if (mode == "missing-begin-certificate") AdmissionRequiresCertificate(ardia::LinuxCloseStage::kBeginTeardown);
  else if (mode == "missing-destroy-certificate") AdmissionRequiresCertificate(ardia::LinuxCloseStage::kDestroy);
  else if (mode == "retired-attempt-bound") RetiredAttemptBound();
  else if (mode.starts_with("force-retry-order-")) ForcedRetryOrdering(mode.at(18) - '0', mode.at(19) == '1', mode.at(20) == '1');
  else if (mode.starts_with("force-retry-lease-")) ForcedCallbackLease(mode.at(18) - '0');
  else if (mode.starts_with("force-retry-destroy-")) ForcedDestroyLease(mode.at(20) - '0');
  else if (mode.starts_with("force-retry-dirty-")) ForcedDirtyDestroyRetry(mode.at(18) == '1');
  else if (mode == "force-retry-cancel") ForcedCancelledBeforeBegin();
  else if (mode.starts_with("force-retry-plain-")) ForcedPlainControls(mode.at(18) == '1');
  else if (mode.starts_with("stage-cancelled-")) CancelledStageReply(mode.at(16) == '1');
  else if (mode.starts_with("stage-overlap-")) StageOverlap(mode.at(14) == '1', mode.at(15) == '1', mode.at(16) == '1');
  else if (mode.starts_with("stage-certificate-")) ExactStageCertificate(mode.at(18) == '1', mode.at(19) == '1');
  else if (mode.starts_with("stage-missing-")) MissingStageAndPrepare(mode.at(14) == '1');
  else if (mode.starts_with("stage-replacement-")) PendingStageReplacement(mode.at(18) == '1', mode.at(19) == '1');
  else assert(false);
  download_answer.Reset();
  download_answers.clear();
  DrainCloseTasks();
}
