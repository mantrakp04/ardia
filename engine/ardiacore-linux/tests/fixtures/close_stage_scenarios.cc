namespace {

void StageOverlap(bool begin_first, bool reply_begin_first, bool veto) {
  Install();
  auto browser = Window();
  Native native(*browser);
  content::WebContents tab;
  browser->tabs.tabs = {&tab};
  const auto request = [&](ardia::LinuxCloseStage stage) {
    assert(browser->controller->DeferLinuxClose(stage, [&, stage] {
      if (stage == ardia::LinuxCloseStage::kBeginTeardown) {
        browser->controller->OnWindowClosing();
      } else {
        browser->controller->OnWindowCloseComplete();
      }
    }));
  };
  const auto first = begin_first ? ardia::LinuxCloseStage::kBeginTeardown :
                                  ardia::LinuxCloseStage::kDestroy;
  const auto second = begin_first ? ardia::LinuxCloseStage::kDestroy :
                                   ardia::LinuxCloseStage::kBeginTeardown;
  request(first);
  request(first);
  request(second);
  const auto token = native.token;
  native.prepared = true;
  tab.needs_unload = true;
  HandlerChanged(tab.frame, true);
  auto runner = base::SingleThreadTaskRunner::GetCurrentDefault();
  const auto release_first = reply_begin_first ? ardia::LinuxCloseStage::kBeginTeardown :
                                                ardia::LinuxCloseStage::kDestroy;
  const auto release_second = reply_begin_first ? ardia::LinuxCloseStage::kDestroy :
                                                 ardia::LinuxCloseStage::kBeginTeardown;
  runner->PostTask(FROM_HERE, [&, release_first] { native.Release(release_first); });
  runner->PostTask(FROM_HERE, [&, release_second] { native.Release(release_second); });
  DrainCloseTasks();
  assert(tab.dispatches == 1 && tab.close_pages == 0);
  assert(!native.begun && native.cancels == 0 && native.sealed);
  assert(ardia::CanCancelLinuxClose(browser.get()));
  assert(ardia::CurrentLinuxCloseToken(browser.get()) == token);
  assert(browser->tabs.closed == 0 && !browser->destroyed);
  tab.Ack(!veto);
  DrainCloseTasks();
  if (veto) {
    assert(native.cancels == 1 && !native.begun && !native.sealed);
    assert(browser->tabs.closed == 0 && !browser->destroyed);
  } else {
    assert(native.begun && tab.close_pages == 1 && native.cancels == 0);
    assert(ardia::CurrentLinuxCloseToken(browser.get()) == token);
    browser->controller->ClearUnloadState(&tab, true);
    DrainCloseTasks();
    browser->controller->OnWindowClosing();
    DrainCloseTasks();
    assert(browser->destroyed && native.sealed);
  }
}

void ExactStageCertificate(bool request_begin, bool ready) {
  Install();
  auto browser = Window();
  Native native(*browser);
  int begin_validations = 0;
  int destroy_validations = 0;
  std::vector<bool> begin_ready;
  std::vector<bool> destroy_ready;
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kBeginTeardown,
      [&](bool proceed) { begin_ready.push_back(proceed); }, [&] {
        ++begin_validations;
        return request_begin ? ready : !ready;
      }));
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kDestroy,
      [&](bool proceed) { destroy_ready.push_back(proceed); }, [&] {
        ++destroy_validations;
        return request_begin ? !ready : ready;
      }));
  int commits = 0;
  const auto stage = request_begin ? ardia::LinuxCloseStage::kBeginTeardown :
                                    ardia::LinuxCloseStage::kDestroy;
  const auto result = ardia::CommitLinuxCloseTeardown(browser.get(), native.token,
      stage, [&] { ++commits; return true; });
  assert(result == (ready ? ardia::LinuxCloseAdmission::kCommitted :
                           ardia::LinuxCloseAdmission::kRetryPreflight));
  assert(begin_validations == int(request_begin));
  assert(destroy_validations == int(!request_begin));
  assert(commits == int(ready));
  auto callback = std::move(native.pending.at(stage));
  native.pending.erase(stage);
  std::move(callback).Run(true);
  assert(begin_ready.size() == size_t(request_begin));
  assert(destroy_ready.size() == size_t(!request_begin));
  assert((request_begin ? begin_ready : destroy_ready).front());
  assert(ardia::CanCancelLinuxClose(browser.get()) == !ready);
  const auto other = request_begin ? ardia::LinuxCloseStage::kDestroy :
                                    ardia::LinuxCloseStage::kBeginTeardown;
  auto unrelated = std::move(native.pending.at(other));
  native.pending.erase(other);
  std::move(unrelated).Run(true);
  assert((request_begin ? destroy_ready : begin_ready).front() == ready);
  if (!ready) assert(ardia::CancelLinuxCloseAttempt(browser.get(), native.token));
}

void MissingStageAndPrepare(bool begun) {
  Install();
  auto browser = Window();
  Native native(*browser);
  assert(ardia::GateLinuxClose(browser.get(), ardia::LinuxCloseStage::kBeginTeardown,
      [](bool) {}, [] { return true; }));
  const auto token = native.token;
  int commits = 0;
  const auto commit = [&] { ++commits; return true; };
  assert(ardia::CommitLinuxCloseTeardown(browser.get(), token,
      ardia::LinuxCloseStage::kPrepare, commit) == ardia::LinuxCloseAdmission::kRejected);
  assert(ardia::CommitLinuxCloseTeardown(browser.get(), token,
      ardia::LinuxCloseStage::kDestroy, commit) == ardia::LinuxCloseAdmission::kRejected);
  assert(commits == 0 && ardia::CanCancelLinuxClose(browser.get()));
  if (begun) {
    assert(ardia::CommitLinuxCloseTeardown(browser.get(), token,
        ardia::LinuxCloseStage::kBeginTeardown, commit) == ardia::LinuxCloseAdmission::kCommitted);
    assert(commits == 1);
    assert(ardia::CommitLinuxCloseTeardown(browser.get(), token,
        ardia::LinuxCloseStage::kPrepare, commit) == ardia::LinuxCloseAdmission::kRejected);
    assert(ardia::CommitLinuxCloseTeardown(browser.get(), token,
        ardia::LinuxCloseStage::kDestroy, commit) == ardia::LinuxCloseAdmission::kCommitted);
    assert(ardia::CommitLinuxCloseTeardown(browser.get(), base::UnguessableToken(),
        ardia::LinuxCloseStage::kDestroy, commit) == ardia::LinuxCloseAdmission::kRejected);
    assert(ardia::CommitLinuxCloseTeardown(browser.get(), base::UnguessableToken::Create(),
        ardia::LinuxCloseStage::kBeginTeardown, commit) == ardia::LinuxCloseAdmission::kRejected);
    assert(commits == 1);
  } else {
    assert(ardia::CancelLinuxCloseAttempt(browser.get(), token));
    assert(ardia::CommitLinuxCloseTeardown(browser.get(), token,
        ardia::LinuxCloseStage::kBeginTeardown, commit) == ardia::LinuxCloseAdmission::kRejected);
  }
}

void PendingStageReplacement(bool during_commit, bool destroy) {
  Install();
  auto browser = Window();
  Native native(*browser);
  native.delay_begin = native.delay_destroy = true;
  const auto stage = destroy ? ardia::LinuxCloseStage::kDestroy :
                               ardia::LinuxCloseStage::kBeginTeardown;
  int commits = 0;
  int old_ready = 0;
  int new_ready = 0;
  const auto replace = [&] {
    auto callback = std::move(native.pending.at(stage));
    native.pending.erase(stage);
    std::move(callback).Run(false);
  };
  assert(ardia::GateLinuxClose(browser.get(), stage, [&](bool proceed) {
    assert(!proceed);
    ++old_ready;
    assert(ardia::GateLinuxClose(browser.get(), stage, [&](bool ready) {
      assert(ready); ++new_ready;
    }, [] { return false; }));
  }, [&] {
    if (!during_commit) replace();
    return true;
  }));
  native.prepared = true;
  const auto token = native.token;
  assert(ardia::CommitLinuxCloseTeardown(browser.get(), token, stage, [&] {
    ++commits;
    replace();
    return false;
  }) == ardia::LinuxCloseAdmission::kRejected);
  assert(commits == int(during_commit) && old_ready == 1 && new_ready == 0);
  assert(!native.begun && ardia::CurrentLinuxCloseToken(browser.get()) == token);
  assert(ardia::CommitLinuxCloseTeardown(browser.get(), token, stage, [] {
    assert(false); return false;
  }) == ardia::LinuxCloseAdmission::kRetryPreflight);
  auto callback = std::move(native.pending.at(stage));
  native.pending.erase(stage);
  std::move(callback).Run(true);
  assert(new_ready == 1 && !native.begun);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), token));
}

void CancelledStageReply(bool destroy) {
  Install();
  auto browser = Window();
  Native native(*browser);
  const auto stage = destroy ? ardia::LinuxCloseStage::kDestroy :
                               ardia::LinuxCloseStage::kBeginTeardown;
  int old_ready = 0;
  int new_ready = 0;
  assert(ardia::GateLinuxClose(browser.get(), stage,
      [&](bool) { ++old_ready; }, [] { return false; }));
  const auto old = native.token;
  auto stale = std::move(native.pending.at(stage));
  native.pending.erase(stage);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), old));
  assert(ardia::GateLinuxClose(browser.get(), stage,
      [&](bool proceed) { assert(proceed); ++new_ready; }, [] { return false; }));
  const auto current = native.token;
  assert(current != old);
  assert(ardia::CommitLinuxCloseTeardown(browser.get(), old, stage, [] {
    assert(false); return true;
  }) == ardia::LinuxCloseAdmission::kRejected);
  std::move(stale).Run(true);
  assert(old_ready == 0 && new_ready == 0 && !native.begun);
  assert(ardia::CurrentLinuxCloseToken(browser.get()) == current);
  native.Release(stage);
  DrainCloseTasks();
  assert(old_ready == 0 && new_ready == 1 && !native.begun);
  assert(ardia::CancelLinuxCloseAttempt(browser.get(), current));
  assert(native.cancels == 2 && !native.sealed);
}

}
