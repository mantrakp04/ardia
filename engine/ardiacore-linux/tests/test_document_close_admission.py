from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_host_fixture import ROOT, SOURCES
from document_close_fixture import fixture


MAIN = r'''

std::map<BrowserWindowInterface*, ShellHostView*> seam_hosts;
void FinalizeWidget(BrowserWindowInterface* browser) {
  auto found = seam_hosts.find(browser);
  if (found == seam_hosts.end()) return;
  auto* host = found->second;
  host->native_widget.closed = true;
  host->OnWidgetClosing(host->GetWidget());
}
bool async_next_begin = false;
base::OnceClosure before_host_begin;
void Install() {
  g_ardia_linux_close_hooks = {
    [](BrowserWindowInterface* b, const base::UnguessableToken& t, LinuxCloseStage s, base::OnceCallback<void(bool)> cb) {
      auto weak = seam_hosts.at(b)->GetWeakPtr();
      if (s != LinuxCloseStage::kPrepare && !weak->close_.Irreversible()) {
        auto change = std::move(before_host_begin);
        if (std::exchange(async_next_begin, false)) {
          if (change) base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE, std::move(change));
          weak->ReplyChromeClose(s, weak->close_.identity(), t, std::move(cb), true);
          return true;
        }
        if (change) std::move(change).Run();
      }
      if (!weak) {
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(FROM_HERE, base::BindOnce(std::move(cb), false));
        return true;
      }
      return weak->DeferChromeClose(t, s, std::move(cb));
    },
    [](BrowserWindowInterface* b, const base::UnguessableToken& t) { seam_hosts.at(b)->ChromeCloseCancelled(t); }
  };
}
struct JoinedWindow {
  BrowserWindowInterface browser;
  ShellHostView host{browser};
  JoinedWindow() {
    browser.controller = new UnloadController(&browser);
    browsers.push_back(&browser);
    seam_hosts.emplace(&browser, &host);
    host.EnsureDocumentClient();
    Watch(host);
  }
  ~JoinedWindow() { host.RetireDocuments(); Drain(); seam_hosts.erase(&browser); }
};
void AckNow(ShellHostView& host, int watermark = 0) {
  host.AcknowledgeWindowClose(Ack(Drained(host, host.RequestWindowClose()), watermark), Ignore);
}

void HandlerChanged(content::RenderFrameHostImpl& frame, bool present) {
  frame.SuddenTerminationDisablerChanged(present,
      blink::mojom::SuddenTerminationDisablerType::kBeforeUnloadHandler);
}
void PrepareOnly(JoinedWindow& window) {
  int answered = 0;
  assert(GateLinuxClose(&window.browser, LinuxCloseStage::kPrepare,
      [&](bool ready) { assert(ready); ++answered; }));
  AckNow(window.host); Drain(); assert(answered == 1 && !window.host.close_.Irreversible());
}
void FreshAdmission(int change, bool asynchronous, bool veto) {
  JoinedWindow window;
  auto& b = window.browser; auto& h = window.host;
  content::WebContents original, late, child;
  original.needs_unload = true; HandlerChanged(original.frame, true);
  b.tabs.tabs = {&original, &late};
  b.GetWindow()->Close(); AckNow(h); Drain();
  assert(original.dispatches == 1 && !h.close_.Irreversible());
  async_next_begin = asynchronous;
  before_host_begin = [&] {
    assert(!h.close_.Irreversible() && CanCancelLinuxClose(&b));
    if (change == 0) { late.needs_unload = true; HandlerChanged(late.frame, true); }
    if (change == 1) { HandlerChanged(original.frame, false); HandlerChanged(original.frame, true); }
    if (change == 2) {
      child.frame.parent = &original.frame; child.frame.id = 2;
      original.frame.children = {&child.frame}; HandlerChanged(child.frame, true);
    }
    if (change == 3) original.ReplaceDocument();
  };
  original.Ack(true); Drain();
  assert(!h.close_.Irreversible() && CanCancelLinuxClose(&b));
  assert(original.close_pages == 0 && late.close_pages == 0);
  auto& pending = change == 0 ? late : original;
  assert(pending.dispatches == (change == 0 ? 1 : 2));
  pending.Ack(!veto);
  if (veto) assert(h.close_.BlocksWrites());
  Drain();
  if (veto) {
    assert(!h.close_.Irreversible() && !h.close_.BlocksWrites() && !b.destroyed);
    assert(original.close_pages == 0 && late.close_pages == 0);
  } else {
    assert(h.close_.Irreversible() && !CanCancelLinuxClose(&b));
    assert(original.close_pages + late.close_pages == 1);
  }
}

int main(int argc, char** argv) {
  assert(argc == 2);
  Install();
  const std::string mode = argv[1];

  if (mode.starts_with("fresh-")) {
    int change = mode.find("handler") != std::string::npos ? 1 :
                 mode.find("child") != std::string::npos ? 2 :
                 mode.find("document") != std::string::npos ? 3 : 0;
    FreshAdmission(change, mode.find("async") != std::string::npos, mode.find("veto") != std::string::npos);
  }
  if (mode == "during-drain") {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    content::WebContents original, late;
    original.needs_unload = true; HandlerChanged(original.frame, true);
    b.tabs.tabs = {&original, &late}; b.GetWindow()->Close();
    late.needs_unload = true; HandlerChanged(late.frame, true);
    assert(!h.close_.Irreversible()); AckNow(h); Drain();
    assert(original.dispatches == 1 && !h.close_.Irreversible());
    original.Ack(true); Drain();
    assert(late.dispatches == 1 && !h.close_.Irreversible() && CanCancelLinuxClose(&b));
    late.Ack(false); Drain(); assert(!h.close_.BlocksWrites() && !b.destroyed);
  }
  if (mode == "async-no-gap") {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    content::WebContents tab; b.tabs.tabs = {&tab};
    PrepareOnly(window);
    bool resumed = false;
    async_next_begin = true;
    assert(b.controller->DeferLinuxClose(LinuxCloseStage::kBeginTeardown,
        [&] { resumed = true; assert(h.close_.Irreversible()); b.controller->OnWindowClosing(); }));
    assert(!h.close_.Irreversible() && !resumed && b.tabs.closed == 0);
    auto ui = base::SingleThreadTaskRunner::GetCurrentDefault();
    ui->One();
    assert(h.close_.Irreversible() && resumed && b.tabs.closed == 1);
    b.controller->OnWindowClosing();
    Drain(); assert(b.destroyed);
  }
  if (mode == "destroy-first") {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    PrepareOnly(window); const auto identity = h.close_.identity();
    content::WebContents late; late.needs_unload = true; HandlerChanged(late.frame, true);
    b.tabs.tabs = {&late};
    assert(b.controller->DeferLinuxClose(LinuxCloseStage::kDestroy,
        [&] { b.controller->OnWindowCloseComplete(); }));
    assert(!h.close_.Irreversible() && CanCancelLinuxClose(&b));
    Drain(); assert(late.dispatches == 1 && !h.close_.Irreversible() && CanCancelLinuxClose(&b));
    late.Ack(true); Drain(); assert(h.close_.Irreversible());
    b.controller->ClearUnloadState(&late, true); b.controller->OnWindowClosing(); Drain();
    assert(b.destroyed && h.close_.identity() == identity);
  }
  if (mode == "destroy-no-certificate") {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    PrepareOnly(window);
    int refused = 0;
    assert(GateLinuxClose(&b, LinuxCloseStage::kDestroy, [&](bool ready) { assert(!ready); ++refused; }));
    Drain(); assert(refused == 1 && !h.close_.Irreversible() && CanCancelLinuxClose(&b));
    h.CancelWindowClose(h.close_.identity(), Ignore); Drain();
  }
  if (mode == "validator-auth-change") {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    PrepareOnly(window);
    int refused = 0;
    assert(GateLinuxClose(&b, LinuxCloseStage::kBeginTeardown,
        [&](bool ready) { assert(!ready); ++refused; }, [&] {
          assert(!h.close_.Irreversible()); h.handler.authorized = false; return true;
        }));
    Drain(); assert(refused == 1 && !h.close_.Irreversible() && CanCancelLinuxClose(&b));
    h.handler.authorized = true; h.CancelWindowClose(h.close_.identity(), Ignore); Drain();
  }
  if (mode == "validator-replace") {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    PrepareOnly(window);
    assert(GateLinuxClose(&b, LinuxCloseStage::kBeginTeardown, [](bool ready) { assert(!ready); }, [&] {
      h.Replace(); return true;
    }));
    Drain(); assert(!h.close_.Irreversible() && !h.close_.BlocksWrites() && CanCancelLinuxClose(&b));
  }
  if (mode == "validator-destroy") {
    auto window = std::make_unique<JoinedWindow>();
    auto authority = window->host.documents_;
    PrepareOnly(*window);
    auto* browser = &window->browser;
    assert(GateLinuxClose(browser, LinuxCloseStage::kBeginTeardown, [](bool ready) { assert(!ready); }, [&] {
      window.reset(); return true;
    }));
    Drain(); assert(!window && seam_hosts.empty() && authority->disk);
  }
  if (mode == "retained-ledger") {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    PrepareOnly(window);
    assert(!GateLinuxClose(&b, LinuxCloseStage::kBeginTeardown, [](bool) { assert(false); }, [] { return true; }));
    const auto identity = h.close_.identity();
    h.Replace(); Drain(); h.storage_failures_.insert("unresolved-native-work");
    bool refused = false;
    assert(GateLinuxClose(&b, LinuxCloseStage::kDestroy, [&](bool ready) { assert(!ready); refused = true; }));
    Drain(); assert(refused && !b.destroyed && h.close_.Irreversible());
    h.storage_failures_.clear();
    assert(!b.controller->DeferLinuxClose(LinuxCloseStage::kDestroy, [] {}));
    b.controller->OnWindowClosing(); Drain();
    assert(b.destroyed && h.close_.identity() == identity);
  }
  if (mode == "delayed-veto") {
    JoinedWindow window;
    auto& b = window.browser; auto& h = window.host;
    content::WebContents tab; tab.needs_unload = true; b.tabs.tabs.push_back(&tab);
    b.GetWindow()->Close();
    assert(!tab.dispatches && h.chrome_close_token_);
    AckNow(h); Drain();
    assert(tab.dispatches == 1 && !h.close_.Irreversible());
    assert(!tab.Ack(false));
    assert(h.close_.BlocksWrites() && h.close_.phase() == LinuxClose::Phase::kCancelling);
    assert(!b.destroyed && !tab.close_pages);
    Drain();
    assert(h.close_.phase() == LinuxClose::Phase::kCancelled && !h.close_.BlocksWrites());
    h.DocumentCall("commit", CommitRequest(h.DocumentClient(), 1), [](auto r) { assert(r.ok()); }); Drain();
    std::cout << mode << " seal_retained_until_worker=1 cancelled=1 writes_resumed=1 destructive=0\n";
  }
  if (mode == "multiwindow-quit") {
    JoinedWindow a; JoinedWindow b;
    content::WebContents one, two; one.needs_unload = two.needs_unload = true;
    a.browser.tabs.tabs.push_back(&one); b.browser.tabs.tabs.push_back(&two);
    auto manager = base::WrapRefCounted(new BrowserCloseManager());
    manager->StartClosingBrowsers(); AckNow(a.host); Drain();
    assert(one.dispatches == 1 && two.dispatches == 0);
    assert(!one.Ack(true)); Drain();
    assert(!a.host.close_.Irreversible());
    AckNow(b.host); Drain(); assert(two.dispatches == 1);
    assert(!two.Ack(false));
    assert(manager->linux_cancelled_ && a.host.close_.BlocksWrites() && b.host.close_.BlocksWrites());
    Drain();
    assert(a.host.close_.phase() == LinuxClose::Phase::kCancelled && b.host.close_.phase() == LinuxClose::Phase::kCancelled);
    assert(!one.close_pages && !two.close_pages && !shutdown_sessions);
    std::cout << mode << " both_cancelled=1 workers_before_resume=1 destructive=0\n";
  }
  if (mode == "accepted-write-replacement") {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    h.documents_->fail = true;
    h.DocumentCall("commit", CommitRequest(h.DocumentClient(), 1), [](auto r) { assert(r.code == "ERR_DOCUMENT_STORAGE"); });
    b.GetWindow()->Close(); const auto token = *h.chrome_close_token_;
    h.Replace();
    h.DocumentCall("watch", WatchRequest(), [](auto r) { assert(r.ok()); });
    assert(h.storage_pending_ == 1 && h.pending_document_watches_.size() == 1);
    Drain();
    assert(!h.chrome_close_token_ && h.storage_failures_.size() == 1 && !h.storage_pending_);
    assert(CurrentLinuxCloseToken(&b).is_empty() && CancelLinuxCloseAttempt(&b, token));
    h.documents_->fail = false;
    b.GetWindow()->Close(); AckNow(h); Drain();
    assert(!h.close_.Irreversible() && !b.destroyed && h.storage_failures_.size() == 1);
    h.CancelWindowClose(h.close_.identity(), Ignore); Drain();
    h.DocumentCall("commit", CommitRequest(h.DocumentClient(), 1), [](auto r) { assert(r.ok()); }); Drain();
    assert(h.storage_failures_.empty());
    std::cout << mode << " ledger_failure_survived=1 blocked_close=1 exact_recovery=1\n";
  }
  if (mode == "retired-owner-close") {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    const auto client = h.DocumentClient();
    auto operation_request = [&](int sequence, base::DictValue operation) {
      auto request = CommitRequest(h.DocumentClient(), sequence);
      base::ListValue operations; operations.Append(base::Value(std::move(operation)));
      request.Set("operations", base::Value(std::move(operations)));
      return request;
    };
    auto folder = base::DictValue().Set("id", "lf-a").Set("profileId", "logical").Set("kind", "documents")
        .Set("name", "original-name").Set("icon", base::Value()).Set("collapsed", base::Value(false))
        .Set("sources", base::Value(base::ListValue())).Set("createdAt", base::Value(0))
        .Set("filters", base::DictValue().Set("authored", base::Value(true)).Set("reviewRequests", base::Value(true)));
    h.DocumentCall("commit", operation_request(1, base::DictValue().Set("type", "create")
        .Set("id", "lf-a").Set("incarnation", "folder:lf-a").Set("value", std::move(folder))),
        [](auto r) { assert(r.ok()); }); Drain();
    auto claim = base::DictValue().Set("type", "claim").Set("id", "lf-a").Set("incarnation", "folder:lf-a");
    h.DocumentCall("commit", operation_request(2, claim.Clone()), [](auto r) { assert(r.ok()); }); Drain();
    h.documents_->fail = true; h.Replace(); Drain();
    assert(*h.documents_->disk->FindDict("owners")->FindString("lf-a") == client.id);
    h.documents_->fail = false; Watch(h);
    auto request = operation_request(1, std::move(claim));
    auto operations = request.FindList("operations")->Clone();
    operations.Append(base::Value(base::DictValue().Set("type", "field").Set("target", "folder")
        .Set("id", "lf-a").Set("incarnation", "folder:lf-a").Set("field", "name")
        .Set("expected", "original-name").Set("value", "accepted-new-name")));
    request.Set("operations", base::Value(std::move(operations)));
    h.documents_->read_error = true;
    h.DocumentCall("commit", std::move(request), [](auto r) { assert(r.code == "ERR_DOCUMENT_STORAGE"); }); Drain();
    assert(h.storage_failures_.size() == 1);
    h.Replace(); Drain(); h.documents_->read_error = false; Watch(h);
    b.GetWindow()->Close(); AckNow(h); Drain();
    assert(!b.destroyed && !h.native_widget.IsClosed() && h.storage_failures_.size() == 1);
    assert(*h.documents_->disk->FindDict("payload")->FindDict("folders")->FindDict("lf-a")->FindString("name") == "original-name");
    std::cout << mode << " failed_accepted_edit=1 ledger_failure=1 watermark=0 actual_kernel_destroyed=0\n";
  }
  if (mode == "after-begin-replacement") {
    JoinedWindow window;
    auto& h = window.host; auto& b = window.browser;
    content::WebContents tab; tab.needs_unload = true; b.tabs.tabs.push_back(&tab);
    b.GetWindow()->Close(); AckNow(h); Drain();
    assert(!tab.Ack(true)); Drain();
    assert(tab.close_pages == 1 && h.close_.Irreversible());
    const auto token = *h.chrome_close_token_;
    const auto identity = h.close_.identity();
    h.Replace(); Drain();
    assert(!CancelLinuxCloseAttempt(&b, token));
    bool denied = false;
    h.DocumentCall("commit", CommitRequest(h.DocumentClient(), 1), [&](auto r) { assert(r.code == "ERR_DOCUMENT_CLOSING"); denied = true; });
    assert(denied && h.ReadyForChromeClose(identity));
    b.controller->ClearUnloadState(&tab, true);
    b.controller->OnWindowClosing(); Drain();
    assert(b.destroyed && h.native_widget.IsClosed() && h.close_.identity() == identity);
    std::cout << mode << " original_lease=1 cancel_refused=1 replacement_write_refused=1 destroyed=1\n";
  }
}
'''


class DocumentCloseAdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-native-admission-')
        root = Path(cls.scratch.name)
        (root / 'main.cc').write_text(fixture(root) + MAIN)
        cls.binary = root / 'admission'
        compiler = shutil.which('clang++') or shutil.which('c++')
        result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(root), '-I', str(ROOT / 'src'), str(ROOT / 'src/ardia/linux/ac_linux_close_hooks.cc'), *[str(ROOT / 'src/ardia/linux' / name) for name in SOURCES], str(root / 'main.cc'), '-o', str(cls.binary)], capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_mode(self, mode):
        result = subprocess.run([str(self.binary), mode], capture_output=True, text=True, timeout=25)
        self.assertEqual(result.returncode, 0, mode + '\n' + result.stdout + result.stderr)

    def test_handlers_added_during_native_drain_remain_vetoable(self):
        self.run_mode('during-drain')

    def test_sync_final_preflight_certifies_current_tabs_frames_and_documents(self):
        for change in ['late', 'handler', 'child', 'document']:
            for outcome in ['allow', 'veto']:
                with self.subTest(change=change, outcome=outcome):
                    self.run_mode('fresh-' + change + '-sync-' + outcome)

    def test_async_final_preflight_certifies_current_tabs_frames_and_documents(self):
        for change in ['late', 'handler', 'child', 'document']:
            for outcome in ['allow', 'veto']:
                with self.subTest(change=change, outcome=outcome):
                    self.run_mode('fresh-' + change + '-async-' + outcome)

    def test_async_commit_and_first_destructive_continuation_have_no_posted_gap(self):
        self.run_mode('async-no-gap')

    def test_destroy_first_dirty_preflight_retries_then_preserves_original_identity(self):
        self.run_mode('destroy-first')

    def test_destroy_first_without_current_chrome_certificate_fails_closed(self):
        self.run_mode('destroy-no-certificate')

    def test_native_auth_is_rechecked_after_validator_reentrancy(self):
        self.run_mode('validator-auth-change')

    def test_validator_replacement_rejects_stale_native_begin(self):
        self.run_mode('validator-replace')

    def test_validator_owner_destruction_never_accesses_raw_host_after_callback(self):
        self.run_mode('validator-destroy')

    def test_post_begin_lease_always_rechecks_retained_window_ledger(self):
        self.run_mode('retained-ledger')

    def test_delayed_page_veto_keeps_seal_until_worker_cancellation(self):
        self.run_mode('delayed-veto')

    def test_multiwindow_quit_cancellation_retains_both_worker_barriers(self):
        self.run_mode('multiwindow-quit')

    def test_accepted_failure_and_exact_recovery_survive_source_replacement(self):
        self.run_mode('accepted-write-replacement')

    def test_shared_preparation_retains_failed_retired_owner_intent(self):
        self.run_mode('retired-owner-close')

    def test_post_begin_replacement_finishes_original_lease_and_blocks_writes(self):
        self.run_mode('after-begin-replacement')
