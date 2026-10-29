from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_host_fixture import ROOT, SOURCES, PRELUDE, WRITER, host_methods, values, generic_invoke


MAIN = r'''
int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  if (mode == "documents") {
    ShellHostView source;
    ShellHostView peer;
    peer.documents_ = source.documents_;
    peer.document_window_ = "peer";
    Watch(source); Watch(peer);
    auto authority = source.documents_;
    const auto source_client = source.DocumentClient();
    files.PostTask(0, [authority, source_client] {
      auto forged = source_client;
      forged.scope = "forged";
      assert(authority->service.value->Dispatch("unwatch", forged, WatchRequest(), [](auto) {}).code == "ERR_DOCUMENT_AUTH");
      forged = source_client; forged.privileged = false;
      assert(authority->service.value->Dispatch("watch", forged, WatchRequest(), [](auto) {}).code == "ERR_DOCUMENT_AUTH");
    });
    files.Drain();
    bool committed = false;
    source.DocumentCall("commit", CommitRequest(source_client, 1), [&](auto result) {
      assert(result.ok()); committed = true;
    });
    *source.alive = false;
    Drain();
    assert(committed && authority->writes == 2);
    assert(source.events.empty());
    assert(peer.events.size() == 1);
    auto& [module, channel, envelope] = peer.events.back();
    assert(module == "ArdiaDocuments" && channel == "documents");
    assert(*envelope.GetDict().FindString("name") == "documents.changed");
    assert(*envelope.GetDict().FindDict("data")->FindString("clientId") == source_client.id);
    assert(*envelope.GetDict().FindDict("data")->FindDict("snapshot")->FindString("clientId") == peer.DocumentClient().id);
    peer.events.clear();
    peer.DocumentCall("commit", CommitRequest(peer.DocumentClient(), 1), [](auto result) { assert(result.ok()); });
    Drain(); assert(peer.events.size() == 1);
    auto& own = std::get<2>(peer.events.back()).GetDict();
    assert(*own.FindDict("data")->FindString("clientId") == peer.DocumentClient().id);
    peer.events.clear();
    peer.DocumentCall("commit", CommitRequest(peer.DocumentClient(), 2), [](auto result) { assert(result.ok()); });
    files.Drain();
    peer.DocumentCall("unwatch", WatchRequest(), [](auto result) { assert(result.ok()); });
    Drain(); assert(peer.events.empty());
    Watch(peer);
    peer.DocumentCall("commit", CommitRequest(peer.DocumentClient(), 3), [](auto result) { assert(result.ok()); });
    files.Drain(); peer.Replace(); Drain();
    assert(peer.events.empty());
    Watch(peer);
    auto wrong = WatchRequest(); wrong.Set("scope", "forged");
    peer.DocumentCall("watch", std::move(wrong), [](auto result) { assert(result.code == "ERR_DOCUMENT_REQUEST"); });
    peer.handler.authorized = false;
    peer.DocumentCall("watch", WatchRequest(), [](auto result) { assert(result.code == "ERR_DOCUMENT_AUTH"); });
    peer.handler.authorized = true; peer.native_profile.regular = false;
    peer.DocumentCall("watch", WatchRequest(), [](auto result) { assert(result.code == "ERR_DOCUMENT_AUTH"); });
    Drain();
  }
  if (mode == "close") {
    for (auto reason : {views::Widget::ClosedReason::kWindowButton, views::Widget::ClosedReason::kCompositor,
                        views::Widget::ClosedReason::kKeyboard, views::Widget::ClosedReason::kQuit}) {
      ShellHostView host;
      Watch(host); host.ArmWindowClose();
      host.native.widget.CloseWithReason(reason);
      assert(!host.native.widget.IsClosed());
      const auto request = host.RequestWindowClose();
      assert(*request.FindString("rendererGeneration") == "9007199254740993");
      assert(request == host.RequestWindowClose());
      assert(host.events.size() >= 1);
      auto& [module, channel, envelope] = host.events.front();
      assert(module == "ArdiaShell" && channel == "shell");
      assert(*envelope.GetDict().FindString("name") == "shell.closeRequested");
      Drained(host, request.Clone());
      auto forged = Ack(request, 0); forged.Set("rendererGeneration", "4294967296");
      bool refused = false;
      host.AcknowledgeWindowClose(forged, [&](bool success, auto) { refused = !success; });
      assert(refused && files.tasks.empty());
      int replies = 0;
      host.AcknowledgeWindowClose(Ack(request, 0), [&](bool success, auto) { assert(success); ++replies; });
      host.AcknowledgeWindowClose(Ack(request, 0), [&](bool success, auto) { assert(success); ++replies; });
      assert(!host.native.widget.IsClosed());
      Drain(); assert(host.native.widget.IsClosed() && replies == 2);
    }
  }
  if (mode == "races") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    host.DocumentCall("commit", CommitRequest(host.DocumentClient(), 1), [](auto result) { assert(result.ok()); });
    auto request = Drained(host, host.RequestWindowClose());
    bool rejected = false;
    host.AcknowledgeWindowClose(Ack(request, 0), [&](bool success, auto value) {
      assert(*value.GetDict().FindString("code") == "ERR_DOCUMENT_WATERMARK"); rejected = !success;
    });
    Drain(); assert(rejected && !host.native.widget.IsClosed());
    bool retried = false;
    host.AcknowledgeWindowClose(Ack(request, 0), [&](bool success, auto value) {
      assert(*value.GetDict().FindString("code") == "ERR_DOCUMENT_WATERMARK"); retried = !success;
    });
    assert(retried && files.tasks.empty());
    bool cancelled = false;
    host.CancelWindowClose(host.close_.identity(), [&](bool success, auto) { cancelled = success; });
    Drain(); assert(cancelled);
    request = Drained(host, host.RequestWindowClose());
    auto stale = request.Clone(); stale.Set("closeGeneration", "1");
    host.AcknowledgeWindowClose(Ack(stale, 1), [](bool success, auto) { assert(!success); });
    host.native.widget.veto = true;
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [&](bool ready) {
      assert(ready); host.native.widget.Close();
    }));
    bool failed = false;
    host.AcknowledgeWindowClose(Ack(request, 1), [&](bool success, auto) { failed = !success; });
    Drain(); assert(host.close_.CanClose() && !failed && !host.native.widget.IsClosed());
    host.DocumentCall("watch", WatchRequest(), [](auto result) { assert(result.code == "ERR_DOCUMENT_CLOSING"); });
    host.DocumentCall("commit", CommitRequest(host.DocumentClient(), 2), [](auto result) { assert(result.code == "ERR_DOCUMENT_CLOSING"); });
    auto* ui = base::SingleThreadTaskRunner::GetCurrentDefault();
    ui->Expire(); Drain();
    assert(host.close_.CanClose() && host.close_.BlocksWrites() && !failed);
    host.CancelWindowClose(host.close_.identity(), Ignore);
    assert(host.close_.BlocksWrites());
    Drain(); assert(failed && host.close_.phase() == LinuxClose::Phase::kCancelled);
    host.CancelWindowClose(host.close_.identity(), [](bool success, auto) { assert(success); });
    host.DocumentCall("commit", CommitRequest(host.DocumentClient(), 2), [](auto result) { assert(result.ok()); });
    Drain();
    request = Drained(host, host.RequestWindowClose());
    host.AcknowledgeWindowClose(Ack(request, 2), Ignore);
    host.CancelWindowClose(host.close_.identity(), [](bool success, auto) { assert(success); });
    Drain(); assert(!host.native.widget.IsClosed() && !host.close_.CanClose());
    auto old = host.close_.identity();
    host.Replace();
    host.CancelWindowClose(old, [](bool success, auto) { assert(!success); });
    Drain();
  }
  if (mode == "lost") {
    auto host = std::make_unique<ShellHostView>();
    Watch(*host); host->ArmWindowClose();
    const auto authority = host->documents_;
    const auto client = host->DocumentClient();
    bool persisted = false;
    host->DocumentCall("commit", CommitRequest(client, 1), [&](auto result) { assert(result.ok()); persisted = true; });
    host->RetireDocuments(); host.reset();
    Drain(); assert(persisted && authority->disk);
    assert(authority->disk->FindDict("clients")->FindDict(client.id));
    ShellHostView replacement;
    Watch(replacement); replacement.ArmWindowClose();
    const auto request = Drained(replacement, replacement.RequestWindowClose());
    replacement.AcknowledgeWindowClose(Ack(request, 0), Ignore);
    files.Drain(); replacement.Replace(); Drain();
    assert(!replacement.native.widget.IsClosed());
    Watch(replacement);
    replacement.DocumentCall("commit", CommitRequest(replacement.DocumentClient(), 1), [](auto result) { assert(result.ok()); });
    Drain();
  }
  if (mode == "storage") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    auto failed = AcceptedStorage(host, "linux-session.json");
    std::move(failed).Run(false, base::Value());
    auto request = Drained(host, host.RequestWindowClose());
    bool refused = false;
    host.AcknowledgeWindowClose(Ack(request, 0), [&](bool ok, auto result) {
      refused = !ok; assert(*result.GetDict().FindString("code") == "ERR_DOCUMENT_STORAGE");
    });
    Drain(); assert(refused && !host.native.widget.IsClosed());
    host.CancelWindowClose(host.close_.identity(), Ignore); Drain();
    auto unrelated = AcceptedStorage(host, "settings.json");
    std::move(unrelated).Run(true, base::Value());
    assert(!host.storage_failures_.empty());
    auto retry = AcceptedStorage(host, "linux-session.json");
    request = Drained(host, host.RequestWindowClose());
    host.AcknowledgeWindowClose(Ack(request, 0), Ignore);
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(0,
        [retry = std::move(retry)]() mutable { std::move(retry).Run(true, base::Value()); });
    Drain(); assert(host.native.widget.IsClosed());
    auto retired = AcceptedStorage(host, "settings.json");
    host.Replace(); std::move(retired).Run(false, base::Value());
    assert(host.storage_pending_ == 0 && host.storage_failures_.contains("settings.json"));
    auto recovered = AcceptedStorage(host, "settings.json");
    std::move(recovered).Run(true, base::Value());
    assert(host.storage_failures_.empty());
  }
  if (mode == "generic") {
    ShellHostView host;
    for (auto name : {"live.json", "live.canonical.json"}) {
      for (auto method : {"ArdiaShell.readDocument", "ArdiaShell.writeDocument", "ArdiaShell.saveDocument", "ArdiaShell.removeDocument"}) {
        base::ListValue args; args.Append(base::Value(name)); args.Append(base::Value("text"));
        base::DictValue request; request.Set("args", base::Value(std::move(args)));
        host.GenericInvoke(method, request, [](bool success, auto) { assert(!success); });
      }
    }
    assert(files.tasks.empty() && !generic_reads && !generic_writes && !host.storage_pending_);
    base::ListValue args; args.Append(base::Value("settings.json")); args.Append(base::Value("text"));
    base::DictValue request; request.Set("args", base::Value(std::move(args)));
    bool persisted = false;
    host.GenericInvoke("ArdiaShell.saveDocument", request, [&](bool success, auto) { persisted = success; });
    assert(host.storage_pending_ == 1);
    Drain(); assert(persisted && generic_writes == 1 && !host.storage_pending_);
    host.GenericInvoke("ArdiaShell.readDocument", request, [](bool success, auto value) { assert(success && value.GetString() == "ok"); });
    Drain(); assert(generic_reads == 1);
  }
  if (mode == "reentrant") {
    auto host = std::make_unique<ShellHostView>();
    Watch(*host);
    auto authority = host->documents_;
    bool second = false;
    host->close_replies_.emplace_back([&](bool success, auto) { assert(!success); host.reset(); });
    host->close_replies_.emplace_back([&](bool success, auto) { assert(!success); second = true; });
    assert(!host->RetireDocuments());
    assert(!host && second);
    Drain();
    host = std::make_unique<ShellHostView>();
    auto request = host->RequestWindowClose();
    auto identity = host->close_.identity();
    assert(!host->close_.BeginSeal(identity, host->renderer_generation_, 0));
    assert(host->close_.BeginDrain(identity, host->renderer_generation_));
    assert(host->close_.BeginSeal(identity, host->renderer_generation_, 0));
    assert(host->close_.Sealed(identity, host->renderer_generation_));
    host->close_replies_.emplace_back([&](bool success, auto) { assert(success); host.reset(); });
    host->close_replies_.emplace_back([](bool success, auto) { assert(success); });
    host->OnWidgetClosing(nullptr);
    assert(!host);
  }
  if (mode == "retired-storage") {
    ShellHostView host; host.ArmWindowClose();
    auto accepted = AcceptedStorage(host, "linux-session.json");
    host.Replace();
    assert(host.storage_pending_ == 1);
    std::move(accepted).Run(false, base::Value());
    assert(host.storage_pending_ == 0 && host.storage_failures_.contains("linux-session.json"));
    auto request = Drained(host, host.RequestWindowClose());
    bool refused = false;
    host.AcknowledgeWindowClose(Ack(request, 0), [&](bool ok, auto value) {
      refused = !ok; assert(*value.GetDict().FindString("code") == "ERR_DOCUMENT_STORAGE");
    });
    Drain(); assert(refused && !host.native.widget.IsClosed());
    host.CancelWindowClose(host.close_.identity(), Ignore); Drain();
    auto unrelated = AcceptedStorage(host, "other.json");
    std::move(unrelated).Run(true, base::Value());
    assert(host.storage_failures_.contains("linux-session.json"));
    auto retry = AcceptedStorage(host, "linux-session.json");
    std::move(retry).Run(true, base::Value());
    request = Drained(host, host.RequestWindowClose());
    host.AcknowledgeWindowClose(Ack(request, 0), Ignore);
    Drain(); assert(host.native.widget.IsClosed());
  }
  if (mode == "retired-posted") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    auto request = Drained(host, host.RequestWindowClose());
    host.AcknowledgeWindowClose(Ack(request, 0), Ignore);
    files.Drain();
    auto* ui = base::SingleThreadTaskRunner::GetCurrentDefault();
    ui->One(); assert(host.close_.CanClose());
    host.Replace();
    const auto count = host.events.size();
    ui->One();
    assert(host.events.size() == count && host.close_.phase() == LinuxClose::Phase::kIdle);
    Drain(); assert(!host.native.widget.IsClosed());
  }
  if (mode == "chrome-cancel") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    int prepared = 0;
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [&](bool ready) { assert(ready); ++prepared; }));
    assert(prepared == 0 && host.chrome_close_token_ && !host.chrome_close_token_->is_empty());
    const auto token = *host.chrome_close_token_;
    const auto request = Drained(host, host.RequestWindowClose());
    bool ack_failed = false;
    host.AcknowledgeWindowClose(Ack(request, 0), [&](bool ready, auto) { ack_failed = !ready; });
    Drain(); assert(prepared == 1 && !ack_failed && host.close_.CanClose());
    host.native.cancel_confirmed = false;
    host.CancelWindowClose(host.close_.identity(), [](bool ready, auto value) {
      assert(!ready && *value.GetDict().FindString("code") == "ERR_WINDOW_CLOSE_IN_PROGRESS");
    });
    assert(host.native.discard_requests == 1 && host.close_.CanClose() && host.close_.BlocksWrites());
    host.native.cancel_confirmed = true;
    bool cancelled = false;
    host.CancelWindowClose(host.close_.identity(), [&](bool ready, auto) { cancelled = ready; });
    assert(!cancelled && !ack_failed && host.close_.BlocksWrites());
    files.Drain(); assert(!cancelled);
    Drain(); assert(cancelled && ack_failed && !host.close_.BlocksWrites());
    int cancellations = 0;
    for (const auto& event : host.events) if (*std::get<2>(event).GetDict().FindString("name") == "shell.closeCancelled") ++cancellations;
    assert(cancellations == 1);
    host.ChromeCloseCancelled(token);
    Drain();
    Watch(host);
    host.DocumentCall("commit", CommitRequest(host.DocumentClient(), 1), [](auto result) { assert(result.ok()); });
    Drain();
    bool invalid = false;
    assert(host.DeferChromeClose(token, LinuxCloseStage::kPrepare, [&](bool ready) { invalid = !ready; }));
    assert(!invalid); Drain(); assert(invalid);
  }
  if (mode == "chrome-teardown") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [](bool ready) { assert(ready); }));
    const auto token = *host.chrome_close_token_;
    auto request = Drained(host, host.RequestWindowClose());
    bool ack_failed = false;
    host.AcknowledgeWindowClose(Ack(request, 0), [&](bool ready, auto) { ack_failed = !ready; });
    Drain();
    int callbacks = 0;
    assert(!host.DeferChromeClose(token, LinuxCloseStage::kBeginTeardown, [&](bool) { ++callbacks; }));
    assert(callbacks == 0 && host.close_.Irreversible());
    base::SingleThreadTaskRunner::GetCurrentDefault()->Expire(); Drain();
    assert(!ack_failed && host.close_.CanClose() && host.close_.BlocksWrites());
    host.CancelWindowClose(host.close_.identity(), [](bool ready, auto value) {
      assert(!ready && *value.GetDict().FindString("code") == "ERR_WINDOW_CLOSE_IN_PROGRESS");
    });
    host.ChromeCloseCancelled(token);
    host.DocumentCall("commit", CommitRequest(host.DocumentClient(), 1), [](auto result) { assert(result.code == "ERR_DOCUMENT_CLOSING"); });
    Drain(); assert(!ack_failed && host.close_.BlocksWrites());
    const auto sealed_client = host.close_client_.id;
    const auto sealed_identity = host.close_.identity();
    host.Replace();
    assert(host.close_.Irreversible() && host.close_client_.id == sealed_client && host.close_.identity() == sealed_identity);
    assert(host.RequestWindowClose().empty());
    assert(!host.DeferChromeClose(token, LinuxCloseStage::kBeginTeardown, [](bool) { assert(false); }));
    assert(!host.DeferChromeClose(token, LinuxCloseStage::kDestroy, [](bool) { assert(false); }));
    host.native.widget.Close();
    assert(host.native.widget.IsClosed());
  }
  if (mode == "chrome-replacement") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    int answers = 0;
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [&](bool ready) { assert(!ready); ++answers; }));
    auto request = Drained(host, host.RequestWindowClose());
    host.AcknowledgeWindowClose(Ack(request, 0), Ignore);
    files.Drain();
    base::SingleThreadTaskRunner::GetCurrentDefault()->One();
    host.Replace();
    bool watched = false;
    host.DocumentCall("watch", WatchRequest(), [&](auto result) { assert(result.ok()); watched = true; });
    assert(!watched);
    Drain();
    assert(answers == 1 && watched && !host.close_.BlocksWrites() && !host.native.widget.IsClosed());
  }
  if (mode == "cancel-retirement") {
    ShellHostView host;
    auto request = host.RequestWindowClose();
    bool stale = false;
    host.CancelWindowClose(host.close_.identity(), [&](bool ready, auto) { stale = !ready; });
    assert(host.close_cancel_running_);
    host.Replace(); assert(stale && !host.close_cancel_running_);
    request = host.RequestWindowClose();
    bool cancelled = false;
    host.CancelWindowClose(host.close_.identity(), [&](bool ready, auto) { cancelled = ready; });
    Drain(); assert(cancelled && !host.close_cancel_running_);
    auto pending = std::make_unique<ShellHostView>();
    auto authority = pending->documents_;
    int answers = 0;
    assert(pending->DeferChromeClose({}, LinuxCloseStage::kPrepare, [&](bool ready) { assert(!ready); ++answers; }));
    pending->RetireDocuments(); pending.reset();
    assert(answers == 0); Drain(); assert(answers == 1);
  }
  if (mode == "no-client") {
    ShellHostView host; host.ArmWindowClose();
    auto request = Drained(host, host.RequestWindowClose());
    bool denied = false;
    host.AcknowledgeWindowClose(Ack(request, 1), [&](bool success, auto) { denied = !success; });
    Drain(); assert(denied && !host.native.widget.IsClosed());
    host.CancelWindowClose(host.close_.identity(), Ignore); Drain();
    request = Drained(host, host.RequestWindowClose());
    host.AcknowledgeWindowClose(Ack(request, 0), Ignore);
    Drain(); assert(host.native.widget.IsClosed() && host.documents_->reads == 0);
  }
}
'''


class DocumentHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            raise unittest.SkipTest('C++ compiler is unavailable')
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-document-host-')
        root = Path(cls.scratch.name)
        (root / 'base/json').mkdir(parents=True)
        (root / 'base/values.h').write_text(values())
        (root / 'base/json/json_writer.h').write_text(WRITER)
        (root / 'main.cc').write_text(PRELUDE + host_methods() + generic_invoke() + MAIN)
        cls.binary = root / 'host'
        result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-I', str(root), '-I', str(ROOT / 'src'), *[str(ROOT / 'src/ardia/linux' / source) for source in SOURCES], str(root / 'main.cc'), '-o', str(cls.binary)], capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_mode(self, mode):
        result = subprocess.run([str(self.binary), mode], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_authorized_own_peer_delivery_and_stale_subscription_filtering(self):
        self.run_mode('documents')

    def test_widget_close_entry_points_defer_to_exact_native_identity(self):
        self.run_mode('close')

    def test_watermarks_pending_generations_timeout_and_cancel_races(self):
        self.run_mode('races')

    def test_accepted_work_survives_source_loss_and_stale_ui_seal_callback(self):
        self.run_mode('lost')

    def test_session_and_generic_storage_failures_block_close_until_matching_retry(self):
        self.run_mode('storage')

    def test_generic_read_write_save_and_remove_cannot_bypass_live_reservations(self):
        self.run_mode('generic')

    def test_retirement_and_widget_replies_tolerate_reentrant_owner_destruction(self):
        self.run_mode('reentrant')

    def test_failed_accepted_storage_survives_renderer_replacement(self):
        self.run_mode('retired-storage')

    def test_retired_posted_close_cannot_request_a_replacement_close(self):
        self.run_mode('retired-posted')

    def test_chromium_abort_confirmation_precedes_worker_unseal_and_cancel_event(self):
        self.run_mode('chrome-cancel')

    def test_begin_teardown_retains_seal_after_native_or_transport_timeout(self):
        self.run_mode('chrome-teardown')

    def test_renderer_replacement_rejects_stale_preparation_and_releases_waiting_watch(self):
        self.run_mode('chrome-replacement')

    def test_cancel_retirement_does_not_strand_new_attempt_or_prepared_callback(self):
        self.run_mode('cancel-retirement')

    def test_no_document_client_cannot_forge_watermark(self):
        self.run_mode('no-client')


if __name__ == '__main__':
    unittest.main()
