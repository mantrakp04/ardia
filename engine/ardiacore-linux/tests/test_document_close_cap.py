from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_close_fixture import fixture
from document_host_fixture import ROOT, SOURCES
from test_document_close_admission import MAIN as ADMISSION_MAIN


SUPPORT = r'''
base::UnguessableToken ExhaustCloseHistory(JoinedWindow& window, int count = 1024) {
  auto& h = window.host; auto& b = window.browser;
  base::UnguessableToken first;
  for (int n = 0; n < count; ++n) {
    b.GetWindow()->Close(); assert(h.chrome_close_token_);
    if (!n) first = *h.chrome_close_token_;
    bool cancelled = false;
    h.CancelWindowClose(h.close_.identity(), [&](bool ok, auto) { assert(ok); cancelled = true; });
    Drain(); assert(cancelled && !h.chrome_close_token_ && !h.close_.BlocksWrites() && !b.destroyed);
  }
  h.events.clear();
  return first;
}
int CancellationEvents(const ShellHostView& h, const LinuxClose::Identity& identity) {
  int count = 0;
  for (const auto& event : h.events) {
    const auto& envelope = std::get<2>(event).GetDict();
    const auto* name = envelope.FindString("name");
    if (!name || *name != "shell.closeCancelled") continue;
    const auto* data = envelope.FindDict("data"); assert(data && *data->FindString("windowId") == h.window_id_);
    if (*data->FindString("rendererGeneration") == identity.renderer && *data->FindString("closeGeneration") == identity.close) ++count;
  }
  return count;
}
void Deadline() {
  auto ui = base::SingleThreadTaskRunner::GetCurrentDefault();
  assert(!ui->timers.empty());
  auto timer = std::move(ui->timers.back()); ui->timers.pop_back(); std::move(timer).Run();
}
'''


CASES = r'''
  if (mode.starts_with("cap-")) {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    const bool retained = mode == "cap-retained-lease";
    const auto old = ExhaustCloseHistory(window, retained ? 1023 : 1024);
    if (retained) {
      content::WebContents tab; tab.needs_unload = true; HandlerChanged(tab.frame, true); b.tabs.tabs = {&tab};
      auto request = Drained(h, h.RequestWindowClose()); h.AcknowledgeWindowClose(Ack(request, 0), Ignore); Drain();
      assert(h.chrome_close_token_ && !h.close_.Irreversible() && tab.dispatches == 1);
      tab.Ack(true); Drain(); assert(h.close_.Irreversible() && tab.close_pages == 1);
      const auto token = *h.chrome_close_token_; const auto identity = h.close_.identity();
      Deadline(); Drain(); assert(h.close_.BlocksWrites() && !CancelLinuxCloseAttempt(&b, token));
      h.Replace(); Drain();
      h.DocumentCall("commit", CommitRequest(h.DocumentClient(), 1), [](auto result) { assert(result.code == "ERR_DOCUMENT_CLOSING"); });
      b.controller->ClearUnloadState(&tab, true); b.controller->OnWindowClosing(); Drain();
      assert(b.destroyed && h.close_.identity() == identity && h.close_.BlocksWrites());
    } else if (mode == "cap-chrome") {
      for (int n = 0; n < 2; ++n) {
        b.GetWindow()->Close(); Drain();
        assert(h.close_.phase() == LinuxClose::Phase::kCancelled && !h.close_.BlocksWrites() && !b.destroyed);
        assert(!BindLinuxCloseAttempt(&b, old));
        h.DocumentCall("commit", CommitRequest(h.DocumentClient(), n + 1), [](auto result) { assert(result.ok()); }); Drain();
      }
    } else if (mode == "cap-ledger") {
      h.documents_->fail = true;
      h.DocumentCall("commit", CommitRequest(h.DocumentClient(), 1), [](auto result) { assert(result.code == "ERR_DOCUMENT_STORAGE"); }); Drain();
      h.documents_->fail = false;
      h.AcknowledgeWindowClose(Ack(Drained(h, h.RequestWindowClose()), 0), [](bool ok, auto value) {
        assert(!ok && *value.GetDict().FindString("code") == "ERR_DOCUMENT_STORAGE");
      }); Drain();
      h.CancelWindowClose(h.close_.identity(), Ignore); Drain();
      assert(h.storage_failures_.contains(kLinuxLiveEnvelope));
      h.DocumentCall("commit", CommitRequest(h.DocumentClient(), 1), [](auto result) { assert(result.ok()); }); Drain();
      assert(h.storage_failures_.empty());
      h.AcknowledgeWindowClose(Ack(Drained(h, h.RequestWindowClose()), 1), Ignore); Drain();
      assert(!h.close_.BlocksWrites() && !b.destroyed);
      h.DocumentCall("commit", CommitRequest(h.DocumentClient(), 2), [](auto result) { assert(result.ok()); }); Drain();
    } else {
      const auto request = Drained(h, h.RequestWindowClose()); const auto identity = h.close_.identity();
      int rejected = 0;
      auto reply = [&](bool ok, auto value) {
        assert(!ok && *value.GetDict().FindString("code") == "ERR_WINDOW_CLOSE_CANCELLED"); ++rejected;
      };
      h.AcknowledgeWindowClose(Ack(request, 0), mode == "cap-lost" ? base::OnceCallback<void(bool, base::Value)>(Ignore) : base::OnceCallback<void(bool, base::Value)>(reply));
      h.AcknowledgeWindowClose(Ack(request, 0), reply);
      files.Drain();
      auto ui = base::SingleThreadTaskRunner::GetCurrentDefault(); ui->One();
      assert(h.close_.phase() == LinuxClose::Phase::kSealed && h.close_.BlocksWrites());
      const auto chrome_calls = b.GetWindow()->close_requests;
      if (mode == "cap-worker-failure") {
        files.PostTask(FROM_HERE, [service = h.documents_->service.value, client = h.close_client_, identity] {
          assert(service->CancelSeal(client, identity.close).ok());
          assert(service->Seal(client, "987654321", 0, true).ok());
        });
      }
      ui->One();
      assert(h.close_.phase() == LinuxClose::Phase::kCancelling && h.close_.BlocksWrites());
      assert(!h.chrome_close_token_ && CurrentLinuxCloseToken(&b).is_empty());
      assert(b.GetWindow()->close_requests == chrome_calls && !b.destroyed && !rejected);
      assert(CancellationEvents(h, identity) == 0);
      if (mode == "cap-worker-failure") {
        Drain();
        assert(h.close_.BlocksWrites() && !rejected && CancellationEvents(h, identity) == 0);
        files.PostTask(FROM_HERE, [service = h.documents_->service.value, client = h.close_client_] {
          assert(service->CancelSeal(client, "987654321").ok());
        });
        h.CancelWindowClose(identity, Ignore);
      }
      if (mode == "cap-reentrant") cap_event = [&] {
        bool already = false;
        h.CancelWindowClose(identity, [&](bool ok, auto) { assert(ok); already = true; });
        assert(already); b.GetWindow()->Close();
      };
      files.Drain(); assert(h.close_.BlocksWrites() && CancellationEvents(h, identity) == 0);
      ui->One();
      assert(CancellationEvents(h, identity) == 1 && rejected == (mode == "cap-lost" ? 1 : 2));
      Drain(); assert(!h.close_.BlocksWrites() && !b.destroyed && !h.chrome_close_token_);
      assert(CancellationEvents(h, identity) == 1);
      Deadline(); Drain(); assert(!h.close_.BlocksWrites() && CancellationEvents(h, identity) == 1);
      if (mode != "cap-reentrant") {
        bool confirmed = false; h.CancelWindowClose(identity, [&](bool ok, auto) { assert(ok); confirmed = true; });
        assert(confirmed); Drain(); assert(CancellationEvents(h, identity) == 1);
      }
      assert(!BindLinuxCloseAttempt(&b, old));
      h.DocumentCall("commit", CommitRequest(h.DocumentClient(), 1), [](auto result) { assert(result.ok()); }); Drain();
      assert(h.storage_failures_.empty());
      std::cout << mode << " phase_cancelled=1 writes_resumed=1 chrome_not_invoked=1 exact_event=1 replay_refused=1\n";
    }
  }
  if (mode.starts_with("guard-")) {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    const auto request = Drained(h, h.RequestWindowClose()); const auto identity = h.close_.identity();
    h.AcknowledgeWindowClose(Ack(request, 0), Ignore); files.Drain();
    auto ui = base::SingleThreadTaskRunner::GetCurrentDefault(); ui->One();
    assert(h.close_.phase() == LinuxClose::Phase::kSealed && !h.chrome_close_token_);
    const auto calls = b.GetWindow()->close_requests;
    if (mode == "guard-cancel") h.CancelWindowClose(identity, Ignore);
    if (mode == "guard-replace") h.Replace();
    if (mode == "guard-chrome") {
      b.GetWindow()->Close(); assert(h.close_.Irreversible() && h.chrome_close_token_);
    }
    base::UnguessableToken existing;
    if (mode == "guard-registry") {
      existing = base::UnguessableToken::Create(); assert(BindLinuxCloseAttempt(&b, existing));
    }
    if (mode == "guard-unbound-handoff") {
      assert(h.close_.HandOff(identity, h.renderer_generation_));
      h.CancelWindowClose(identity, [](bool ok, auto value) {
        assert(!ok && *value.GetDict().FindString("code") == "ERR_WINDOW_CLOSE_IN_PROGRESS");
      });
      Deadline();
    }
    ui->One();
    if (mode == "guard-chrome") {
      assert(b.GetWindow()->close_requests == calls + 1 && h.close_.Irreversible());
      Drain(); assert(b.destroyed && CancellationEvents(h, identity) == 0 && h.close_.BlocksWrites());
    } else {
      assert(b.GetWindow()->close_requests == calls && !b.destroyed);
      if (mode == "guard-registry") {
        assert(CurrentLinuxCloseToken(&b) == existing && !h.chrome_close_token_);
        h.CancelWindowClose(identity, [](bool ok, auto value) {
          assert(!ok && *value.GetDict().FindString("code") == "ERR_WINDOW_CLOSE_IN_PROGRESS");
        });
        Deadline(); Drain(); assert(h.close_.BlocksWrites() && CurrentLinuxCloseToken(&b) == existing);
        assert(CancelLinuxCloseAttempt(&b, existing)); h.CancelWindowClose(identity, Ignore);
      }
      Drain();
      if (mode == "guard-unbound-handoff") assert(h.close_.BlocksWrites() && !h.chrome_close_token_);
      else assert(!h.close_.BlocksWrites() && CurrentLinuxCloseToken(&b).is_empty());
    }
  }
'''


class DocumentCloseCapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-native-cap-')
        root = Path(cls.scratch.name)
        source = fixture(root)
        source = source.replace('struct ShellHostView;', 'std::function<void()> cap_event;\nstruct ShellHostView;', 1)
        source = source.replace('    if (handler_ && handler_->Authorized()) events.emplace_back(module, channel, std::move(value));', '''    if (handler_ && handler_->Authorized()) {
      const bool cancelled = value.GetDict().FindString("name") && *value.GetDict().FindString("name") == "shell.closeCancelled";
      events.emplace_back(module, channel, std::move(value));
      if (cancelled && cap_event) { auto callback = std::move(cap_event); callback(); }
    }''')
        main = ADMISSION_MAIN.replace('int main(int argc, char** argv) {', SUPPORT + '\nint main(int argc, char** argv) {')
        main = main[:main.rfind('\n}')] + CASES + main[main.rfind('\n}'):]
        (root / 'main.cc').write_text(source + main)
        compiler = shutil.which('clang++') or shutil.which('c++')
        cls.binary = root / 'cap'
        result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(root), '-I', str(ROOT / 'src'), str(ROOT / 'src/ardia/linux/ac_linux_close_hooks.cc'), *[str(ROOT / 'src/ardia/linux' / name) for name in SOURCES], str(root / 'main.cc'), '-o', str(cls.binary)], text=True, capture_output=True, timeout=90)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_mode(self, mode):
        result = subprocess.run([str(self.binary), mode], text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, mode + '\n' + result.stdout + result.stderr)
        print(result.stdout, end='')

    def test_renderer_first_cap_cancels_after_worker_unseal_and_exact_event(self):
        self.run_mode('cap-renderer')

    def test_chrome_first_cap_control_still_cancels_without_replaying_tokens(self):
        self.run_mode('cap-chrome')

    def test_lost_ack_reply_does_not_own_cancellation_or_event(self):
        self.run_mode('cap-lost')

    def test_reentrant_close_and_reject_are_scoped_and_deadline_is_idempotent(self):
        self.run_mode('cap-reentrant')

    def test_cap_refusal_does_not_forget_accepted_failed_or_recovered_work(self):
        self.run_mode('cap-ledger')

    def test_last_allowed_binding_retains_irreversible_lease_across_replacement(self):
        self.run_mode('cap-retained-lease')

    def test_worker_cancellation_failure_never_emits_resume_until_matching_success(self):
        self.run_mode('cap-worker-failure')

    def test_cancelled_before_posted_task_never_binds_or_invokes_chrome(self):
        self.run_mode('guard-cancel')

    def test_retired_renderer_posted_task_never_binds_or_invokes_chrome(self):
        self.run_mode('guard-replace')

    def test_chrome_first_race_preserves_already_progressing_attempt(self):
        self.run_mode('guard-chrome')

    def test_existing_registry_attempt_is_never_rebound_or_cancelled_by_old_task(self):
        self.run_mode('guard-registry')

    def test_unbound_handed_off_attempt_remains_protected_from_blind_unseal(self):
        self.run_mode('guard-unbound-handoff')
