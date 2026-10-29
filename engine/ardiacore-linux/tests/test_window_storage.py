from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_host_fixture import ROOT, SOURCES, WRITER, values, generic_invoke
from document_renderer_fixture import fixture
from test_renderer_contract import method


SUPPORT = r'''
#include <iostream>
std::map<std::string, std::optional<std::string>> storage_disk;
std::deque<bool> storage_outcomes;
int storage_attempts = 0;
void Write(ShellHostView& host, std::string text, bool expected = true) {
  base::ListValue input; input.Append(base::Value("settings.json")); input.Append(base::Value(std::move(text)));
  base::DictValue args; args.Set("args", base::Value(std::move(input)));
  host.GenericInvoke("ArdiaShell.writeDocument", args, [expected](bool ok, auto value) {
    if (!expected) assert(!ok && *value.GetDict().FindString("code") == "ERR_DOCUMENT_LIMIT");
  });
}
base::DictValue OperationRequest(const LinuxDocumentClient& client, int sequence, base::DictValue operation) {
  auto result = CommitRequest(client, sequence);
  base::ListValue operations; operations.Append(base::Value(std::move(operation)));
  result.Set("operations", base::Value(std::move(operations)));
  return result;
}
base::DictValue Member(std::string member) {
  return base::DictValue().Set("type", "member").Set("target", "hiddenCalendarIds")
      .Set("member", member).Set("present", base::Value(true));
}
void Blocked(ShellHostView& host, HostMessageHandler& handler, int watermark) {
  int refused = 0;
  assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [&](bool ready) { assert(!ready); ++refused; }));
  const auto token = *host.chrome_close_token_;
  const auto request = host.RequestWindowClose();
  SendAck(handler, request, watermark); Drain();
  assert(refused == 1 && !host.native.widget.IsClosed());
  for (auto stage : {LinuxCloseStage::kBeginTeardown, LinuxCloseStage::kDestroy}) {
    assert(host.DeferChromeClose(token, stage, [&](bool ready) { assert(!ready); ++refused; }));
    Drain();
  }
  assert(refused == 3 && !host.close_.Irreversible());
  host.CancelWindowClose(host.close_.identity(), Ignore); Drain();
  assert(!host.chrome_close_token_ && !host.close_.BlocksWrites());
}
void CloseReady(ShellHostView& host, HostMessageHandler& handler, int watermark) {
  bool prepared = false;
  assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [&](bool ready) { assert(ready); prepared = true; }));
  const auto token = *host.chrome_close_token_;
  const auto request = host.RequestWindowClose();
  SendAck(handler, request, watermark); Drain();
  assert(prepared);
  assert(!host.DeferChromeClose(token, LinuxCloseStage::kBeginTeardown, [](bool) { assert(false); }));
  assert(!host.DeferChromeClose(token, LinuxCloseStage::kDestroy, [](bool) { assert(false); }));
  host.native.widget.Close(); assert(host.native.widget.IsClosed());
}
'''


MAIN = r'''
int main(int argc, char** argv) {
  (void)Ignore;
  assert(argc == 2);
  const std::string mode = argv[1];
  ShellHostView host;
  auto original = std::make_unique<HostMessageHandler>(&host);
  Activate(host, *original, host.frame_);
  host.ArmWindowClose();
  content::RenderFrameHost next_frame;
  HostMessageHandler replacement(&host);
  if (mode == "same-name") {
    storage_disk["settings.json"] = "old-snapshot";
    storage_outcomes.push_back(false); Write(host, "accepted-new-intent");
    Activate(host, replacement, next_frame); original.reset(); Drain();
    assert(host.storage_failures_.contains("settings.json"));
    Write(host, "old-snapshot"); Drain();
    assert(host.storage_failures_.contains("settings.json"));
    Blocked(host, replacement, 0);
    std::cout << "disk=old-snapshot ledger_failures=" << host.storage_failures_.size()
              << " window_closed=" << host.native.widget.IsClosed() << '\n';
    Write(host, "accepted-new-intent"); Drain();
    assert(host.storage_failures_.empty() && host.storage_intents_.empty());
    assert(*storage_disk["settings.json"] == "accepted-new-intent");
    CloseReady(host, replacement, 0);
  }
  if (mode == "canonical-failure") {
    Send(*original, "watch", WatchRequest()); Drain();
    const auto client = host.DocumentClient();
    host.documents_->fail = true;
    Send(*original, "commit", CommitRequest(client, 1));
    assert(host.storage_pending_ == 1);
    Activate(host, replacement, next_frame); original.reset(); Drain();
    assert(host.storage_pending_ == 0 && host.storage_failures_.contains(kLinuxLiveEnvelope));
    host.documents_->fail = false;
    Send(replacement, "watch", WatchRequest()); Drain();
    Blocked(host, replacement, 0);
    std::cout << "failed_original_receipt=" << bool(host.documents_->disk->FindDict("clients")->FindDict(client.id))
              << " ledger_failures=" << host.storage_failures_.size()
              << " pending=" << host.storage_pending_ << " window_closed=" << host.native.widget.IsClosed() << '\n';
    ShellHostView peer; peer.documents_ = host.documents_; peer.document_window_ = "peer";
    HostMessageHandler other(&peer); Activate(peer, other, peer.frame_);
    Send(other, "watch", WatchRequest()); Drain();
    Send(other, "commit", CommitRequest(peer.DocumentClient(), 1)); Drain();
    assert(host.storage_failures_.contains(kLinuxLiveEnvelope) && peer.storage_failures_.empty());
    auto unrelated = OperationRequest(host.DocumentClient(), 1, Member("unrelated"));
    Send(replacement, "commit", std::move(unrelated)); Drain();
    assert(host.storage_failures_.contains(kLinuxLiveEnvelope));
    auto retry = OperationRequest(host.DocumentClient(), 2, Member("item-1"));
    retry.Set("observedRevision", base::Value(2));
    Send(replacement, "commit", std::move(retry));
    files.Drain(); assert(host.storage_failures_.contains(kLinuxLiveEnvelope));
    Drain(); assert(host.storage_failures_.empty() && host.storage_intents_.empty());
    CloseReady(host, replacement, 2);
    peer.RetireDocuments(); Drain();
  }
  if (mode == "retired-preparation") {
    Send(*original, "watch", WatchRequest()); Drain();
    const auto client = host.DocumentClient();
    auto folder = base::DictValue().Set("id", "lf-a").Set("profileId", "logical").Set("kind", "documents")
        .Set("name", "original-name").Set("icon", base::Value()).Set("collapsed", base::Value(false))
        .Set("sources", base::Value(base::ListValue())).Set("createdAt", base::Value(0))
        .Set("filters", base::DictValue().Set("authored", base::Value(true)).Set("reviewRequests", base::Value(true)));
    host.DocumentCall("commit", OperationRequest(client, 1, base::DictValue().Set("type", "create")
        .Set("id", "lf-a").Set("incarnation", "folder:lf-a").Set("value", std::move(folder))),
        [](auto result) { assert(result.ok()); }); Drain();
    auto claim = base::DictValue().Set("type", "claim").Set("id", "lf-a").Set("incarnation", "folder:lf-a");
    host.DocumentCall("commit", OperationRequest(client, 2, claim.Clone()), [](auto result) { assert(result.ok()); }); Drain();
    host.documents_->fail = true; Activate(host, replacement, next_frame); original.reset(); Drain();
    host.documents_->fail = false; Send(replacement, "watch", WatchRequest()); Drain();
    auto request = OperationRequest(host.DocumentClient(), 1, std::move(claim));
    auto operations = request.FindList("operations")->Clone();
    operations.Append(base::Value(base::DictValue().Set("type", "field").Set("target", "folder")
        .Set("id", "lf-a").Set("incarnation", "folder:lf-a").Set("field", "name")
        .Set("expected", "original-name").Set("value", "accepted-new-name")));
    request.Set("operations", base::Value(std::move(operations)));
    host.documents_->read_error = true;
    Send(replacement, "commit", request.Clone());
    content::RenderFrameHost final_frame;
    HostMessageHandler last(&host);
    Activate(host, last, final_frame); Drain();
    assert(host.storage_failures_.contains(kLinuxLiveEnvelope));
    host.documents_->read_error = false; Send(last, "watch", WatchRequest()); Drain();
    Blocked(host, last, 0);
    request.Set("requestId", host.DocumentClient().id + ":1");
    Send(last, "commit", std::move(request)); Drain();
    assert(host.storage_failures_.empty());
    assert(*host.documents_->disk->FindDict("payload")->FindDict("folders")->FindDict("lf-a")->FindString("name") == "accepted-new-name");
    CloseReady(host, last, 1);
  }
  if (mode == "receipt-preparation") {
    Send(*original, "watch", WatchRequest()); Drain();
    auto envelope = host.documents_->disk->Clone();
    auto payload = envelope.FindDict("payload")->Clone();
    base::ListValue filler;
    for (int i = 0; i < 8100; ++i) filler.Append(base::Value(std::to_string(i) + std::string(1000, 'x')));
    payload.Set("dismissedAlerts", base::Value(std::move(filler))); envelope.Set("payload", std::move(payload));
    auto remaining = kLinuxLiveMaxBytes - base::WriteJsonWithOptions(envelope, 2)->size() - 100;
    payload = envelope.FindDict("payload")->Clone();
    auto more = payload.FindList("dismissedAlerts")->Clone();
    while (remaining > 4) {
      const auto length = std::min(size_t(1024), remaining - 3);
      const auto prefix = std::to_string(more.size());
      more.Append(base::Value(prefix + std::string(length - prefix.size(), 'z'))); remaining -= length + 3;
    }
    payload.Set("dismissedAlerts", base::Value(std::move(more))); envelope.Set("payload", std::move(payload));
    host.documents_->disk = std::move(envelope);
    auto request = CommitRequest(host.DocumentClient(), 1);
    host.DocumentCall("commit", request.Clone(), [](auto result) { assert(result.code == "ERR_DOCUMENT_LIMIT"); }); Drain();
    host.documents_->read_error = true;
    host.DocumentCall("commit", request.Clone(), [](auto result) { assert(result.code == "ERR_DOCUMENT_STORAGE"); }); Drain();
    assert(host.storage_failures_.empty() && !host.storage_pending_);
    host.documents_->read_error = false;
    host.DocumentCall("commit", std::move(request), [](auto result) { assert(result.code == "ERR_DOCUMENT_LIMIT"); }); Drain();
    assert(host.storage_failures_.empty() && host.storage_intents_.empty());
    CloseReady(host, *original, 0);
  }
  if (mode == "watch-unwatch" || mode == "watch-rewatch") {
    Send(*original, "watch", WatchRequest()); Drain();
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [](bool ready) { assert(!ready); }));
    Activate(host, replacement, next_frame); original.reset();
    int stale = 0;
    host.DocumentCall("watch", WatchRequest(), [&](auto result) { assert(result.code == "ERR_DOCUMENT_SUBSCRIPTION"); ++stale; });
    assert(host.pending_document_watches_.size() == 1);
    Send(replacement, "unwatch", WatchRequest());
    int current = 0;
    if (mode == "watch-rewatch")
      host.DocumentCall("watch", WatchRequest(), [&](auto result) { assert(result.ok()); ++current; });
    assert(!host.document_watched_); Drain();
    assert(stale == 1 && host.pending_document_watches_.empty());
    assert(host.document_watched_ == (mode == "watch-rewatch"));
    assert(current == (mode == "watch-rewatch"));
    std::cout << "explicit_unwatch=1 pending_watches=" << host.pending_document_watches_.size()
              << " final_watched=" << host.document_watched_ << '\n';
    ShellHostView peer; peer.documents_ = host.documents_; peer.document_window_ = "peer";
    HostMessageHandler other(&peer); Activate(peer, other, peer.frame_);
    Send(other, "watch", WatchRequest()); Drain(); host.events.clear();
    Send(other, "commit", CommitRequest(peer.DocumentClient(), 1)); Drain();
    assert(host.events.size() == size_t(mode == "watch-rewatch"));
    peer.RetireDocuments(); Drain();
  }
  if (mode == "watch-event-unwatch") {
    Send(*original, "watch", WatchRequest()); Drain();
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [](bool ready) { assert(!ready); }));
    Activate(host, replacement, next_frame); original.reset();
    bool stale = false;
    host.DocumentCall("watch", WatchRequest(), [&](auto result) {
      assert(result.code == "ERR_DOCUMENT_SUBSCRIPTION"); stale = true;
    });
    after_native_event = [&] { Send(replacement, "unwatch", WatchRequest()); };
    Drain(); assert(stale && !host.document_watched_ && host.pending_document_watches_.empty());
  }
  if (mode == "ordering") {
    storage_outcomes = {true, false};
    Write(host, "same-intent"); Write(host, "same-intent");
    assert(host.storage_pending_ == 2); Drain();
    assert(host.storage_failures_.contains("settings.json"));
    auto early = AcceptedStorage(host, "ordered.json");
    auto late = AcceptedStorage(host, "ordered.json");
    std::move(late).Run(false, base::Value());
    std::move(early).Run(true, base::Value());
    assert(host.storage_failures_.contains("ordered.json"));
    auto retry = AcceptedStorage(host, "ordered.json"); std::move(retry).Run(true, base::Value());
    assert(!host.storage_failures_.contains("ordered.json"));
    Write(host, "same-intent"); Drain(); assert(host.storage_failures_.empty());
  }
  if (mode == "read-classification") {
    Send(*original, "watch", WatchRequest()); Drain();
    const auto client = host.DocumentClient();
    host.documents_->read_error = true;
    auto malformed = CommitRequest(client, 1); malformed.Set("unexpected", "invalid");
    Send(*original, "commit", std::move(malformed));
    Send(*original, "commit", CommitRequest(client, 99)); Drain();
    assert(host.storage_failures_.empty() && !host.storage_pending_ && host.storage_intents_.empty());
    Send(*original, "commit", CommitRequest(client, 1)); Drain();
    assert(host.storage_failures_.contains(kLinuxLiveEnvelope));
    host.documents_->read_error = false;
    Send(*original, "commit", CommitRequest(client, 1)); Drain();
    assert(host.storage_failures_.empty());
    auto conflict = OperationRequest(client, 2, base::DictValue().Set("type", "delete")
        .Set("id", "lf-missing").Set("incarnation", "folder:lf-missing"));
    Send(*original, "commit", std::move(conflict)); Drain(); assert(host.storage_failures_.empty());
    auto bad = CommitRequest(client, 2); bad.Set("operations", base::Value(base::ListValue()));
    Send(*original, "commit", std::move(bad)); Drain(); assert(host.storage_failures_.empty());
    int sequence = 2;
    for (bool corrupt : {true, false}) {
      auto good = host.documents_->disk->Clone();
      if (corrupt) host.documents_->disk->Set("format", base::Value(2));
      else host.documents_->disk->Set("epoch", "unexpected-authority");
      auto invalid = CommitRequest(client, sequence); invalid.Set("unexpected", "invalid");
      Send(*original, "commit", std::move(invalid)); Drain(); assert(host.storage_failures_.empty());
      host.DocumentCall("commit", CommitRequest(client, sequence), [](auto result) { assert(result.code == "ERR_DOCUMENT_DATA"); });
      Drain(); assert(host.storage_failures_.contains(kLinuxLiveEnvelope));
      host.documents_->disk = std::move(good);
      Send(*original, "commit", CommitRequest(client, sequence)); Drain(); assert(host.storage_failures_.empty());
      ++sequence;
    }
  }
  if (mode == "nonowner-limit") {
    Send(*original, "watch", WatchRequest()); Drain();
    const auto client = host.DocumentClient();
    base::DictValue folder;
    folder.Set("id", "lf-a"); folder.Set("profileId", "logical"); folder.Set("kind", "documents");
    folder.Set("name", "A"); folder.Set("icon", base::Value()); folder.Set("collapsed", base::Value(false));
    folder.Set("sources", base::Value(base::ListValue())); folder.Set("createdAt", base::Value(0));
    folder.Set("filters", base::DictValue().Set("authored", base::Value(true)).Set("reviewRequests", base::Value(true)));
    auto create = OperationRequest(client, 1, base::DictValue().Set("type", "create")
        .Set("id", "lf-a").Set("incarnation", "folder:lf-a").Set("value", std::move(folder)));
    host.DocumentCall("commit", std::move(create), [](auto result) { assert(result.ok()); }); Drain();
    auto claim = base::DictValue().Set("type", "claim").Set("id", "lf-a").Set("incarnation", "folder:lf-a");
    host.DocumentCall("commit", OperationRequest(client, 2, claim.Clone()), [](auto result) { assert(result.ok()); }); Drain();
    ShellHostView peer; peer.documents_ = host.documents_; peer.document_window_ = "peer";
    HostMessageHandler other(&peer); Activate(peer, other, peer.frame_);
    Send(other, "watch", WatchRequest()); Drain();
    auto request = OperationRequest(peer.DocumentClient(), 1, claim.Clone());
    peer.DocumentCall("commit", request.Clone(), [](auto result) {
      assert(result.ok() && *result.value.FindString("status") == "conflict" &&
             *result.value.FindString("reason") == "notOwner");
    }); Drain(); assert(peer.storage_failures_.empty());
    host.documents_->read_error = true;
    peer.DocumentCall("commit", std::move(request), [](auto result) { assert(result.code == "ERR_DOCUMENT_STORAGE"); });
    Drain(); assert(peer.storage_failures_.empty());
    host.documents_->read_error = false;
    host.documents_->disk->Set("revision", base::Value(2147483647));
    host.DocumentCall("commit", CommitRequest(client, 3), [](auto result) { assert(result.code == "ERR_DOCUMENT_LIMIT"); });
    Drain(); assert(host.storage_failures_.empty() && host.storage_intents_.empty());
    peer.RetireDocuments(); Drain();
  }
  if (mode == "superseded-duplicate") {
    Send(*original, "watch", WatchRequest()); Drain();
    const auto client = host.DocumentClient();
    auto request = OperationRequest(client, 1, base::DictValue().Set("type", "refresh")
        .Set("id", "lf-missing").Set("incarnation", "folder:lf-missing")
        .Set("owner", client.id).Set("generation", base::Value(1))
        .Set("operations", base::Value(base::ListValue())));
    host.documents_->fail = true; Send(*original, "commit", request.Clone()); Drain();
    assert(host.storage_failures_.contains(kLinuxLiveEnvelope));
    host.documents_->fail = false;
    bool superseded = false;
    host.DocumentCall("commit", request.Clone(), [&](auto result) {
      assert(result.ok()); superseded = result.value.Find("superseded")->GetBool();
    }); Drain(); assert(superseded);
    assert(host.storage_failures_.contains(kLinuxLiveEnvelope));
    const auto writes = host.documents_->writes;
    host.DocumentCall("commit", std::move(request), [&](auto result) {
      assert(result.ok()); superseded = result.value.Find("superseded")->GetBool();
    }); Drain(); assert(!superseded);
    assert(host.documents_->writes == writes && host.storage_failures_.contains(kLinuxLiveEnvelope));
    Blocked(host, *original, 1);
  }
  if (mode == "canonical-ordering") {
    Send(*original, "watch", WatchRequest()); Drain();
    const auto client = host.DocumentClient();
    Send(*original, "commit", CommitRequest(client, 1)); files.One();
    host.documents_->read_error = true;
    Send(*original, "commit", CommitRequest(client, 1)); files.One();
    base::SingleThreadTaskRunner::GetCurrentDefault()->Drain();
    assert(host.storage_failures_.contains(kLinuxLiveEnvelope));
    host.documents_->read_error = false;
    Send(*original, "commit", CommitRequest(client, 1)); Drain();
    assert(host.storage_failures_.contains(kLinuxLiveEnvelope));
    Activate(host, replacement, next_frame); original.reset(); Drain();
    Send(replacement, "watch", WatchRequest()); Drain();
    Send(replacement, "commit", CommitRequest(host.DocumentClient(), 1)); Drain();
    assert(host.storage_failures_.empty());
  }
  if (mode == "capacity" || mode == "byte-capacity") {
    const int count = mode == "capacity" ? 128 : 3;
    const size_t bytes = mode == "capacity" ? 8 : 8 * 1024 * 1024;
    for (int i = 0; i < count; ++i) {
      storage_outcomes.push_back(false);
      auto text = std::string(bytes, char('a' + i % 26)); text.replace(0, std::to_string(i).size(), std::to_string(i));
      Write(host, std::move(text)); Drain();
    }
    assert(host.storage_intents_.size() == size_t(count) && host.storage_pending_ == 0);
    const int attempts = storage_attempts;
    Write(host, std::string(bytes, 'z'), false); Drain();
    assert(storage_attempts == attempts && host.storage_intents_.size() == size_t(count));
    auto retry = std::string(bytes, 'a'); retry.replace(0, 1, "0");
    Write(host, std::move(retry)); Drain();
    assert(host.storage_intents_.size() == size_t(count - 1));
  }
  if (mode == "pending-byte-capacity") {
    const auto text = std::string(8 * 1024 * 1024, 'a');
    Write(host, text); Write(host, text); Write(host, text);
    assert(host.storage_intents_.size() == 1 && host.storage_pending_ == 3);
    const auto tasks = files.tasks.size();
    Write(host, text, false);
    assert(files.tasks.size() == tasks && host.storage_pending_ == 3);
    Drain(); assert(!host.storage_pending_ && !host.storage_pending_bytes_ && host.storage_intents_.empty());
  }
  if (mode == "large-sync-state") {
    auto save = [&](std::string name, std::string text, std::string expected) {
      base::ListValue input; input.Append(base::Value(std::move(name))); input.Append(base::Value(std::move(text)));
      base::DictValue args; args.Set("args", base::Value(std::move(input)));
      host.GenericInvoke("ArdiaShell.saveDocument", args, [expected](bool ok, auto value) {
        if (expected == "ok") assert(ok);
        else if (expected == "failed") assert(!ok);
        else assert(!ok && *value.GetDict().FindString("code") == expected);
      });
    };
    const size_t limit = ardia::linux_policy::kSyncStateDocumentLimit;
    save("settings.json", std::string(8 * 1024 * 1024 + 1, 's'), "ERR_DOCUMENT_LIMIT");
    save("sync-journal-1.nns", std::string(8 * 1024 * 1024 + 1, 'j'), "ERR_DOCUMENT_LIMIT");
    save("sync-state.nns", std::string(limit + 1, 'x'), "ERR_DOCUMENT_LIMIT");
    Drain();
    assert(storage_attempts == 0 && host.storage_intents_.empty());
    save("sync-state.nns", "small", "ok");
    assert(host.storage_intents_.size() == 1 && host.storage_intents_[0]->operation.Find("contents"));
    Drain();
    const auto big = std::string(9 * 1024 * 1024, 'b');
    const int digests = storage_digests;
    save("sync-state.nns", big, "ok");
    assert(storage_digests == digests);
    assert(host.storage_intents_.size() == 1 && host.storage_intents_[0]->operation.Find("sha256") &&
           !host.storage_intents_[0]->operation.Find("contents") && host.storage_intents_[0]->bytes < 1024);
    save("sync-state.nns", std::string(9 * 1024 * 1024, 'c'), "ERR_DOCUMENT_BUSY");
    assert(storage_digests == digests);
    Drain();
    assert(storage_digests == digests + 1);
    assert(storage_disk["sync-state.nns"] == big && host.storage_intents_.empty());
    save("sync-state.nns", std::string(limit, 'm'), "ok"); Drain();
    assert(storage_disk["sync-state.nns"]->size() == limit);
    storage_outcomes.push_back(false);
    save("sync-state.nns", big, "failed"); Drain();
    assert(host.storage_failures_.contains("sync-state.nns"));
    save("sync-state.nns", std::string(9 * 1024 * 1024, 'd'), "ok"); Drain();
    assert(host.storage_failures_.contains("sync-state.nns"));
    save("sync-state.nns", big, "ok"); Drain();
    assert(host.storage_failures_.empty() && host.storage_intents_.empty() && storage_disk["sync-state.nns"] == big);
  }
  if (mode == "different-write") {
    storage_outcomes.push_back(false); Write(host, "first"); Drain();
    storage_outcomes.push_back(false); Write(host, "second"); Drain();
    assert(host.storage_intents_.size() == 2);
    base::ListValue input; input.Append(base::Value("settings.json"));
    base::DictValue args; args.Set("args", base::Value(std::move(input)));
    host.GenericInvoke("ArdiaShell.removeDocument", args, Ignore); Drain();
    assert(host.storage_intents_.size() == 2);
    Write(host, "first"); Drain(); assert(host.storage_intents_.size() == 1 && !host.storage_failures_.empty());
    Write(host, "second"); Drain(); assert(host.storage_intents_.empty() && host.storage_failures_.empty());
  }
  if (mode == "destroyed-completion") {
    auto target = std::make_unique<ShellHostView>();
    auto handler = std::make_unique<HostMessageHandler>(target.get());
    Activate(*target, *handler, target->frame_); Send(*handler, "watch", WatchRequest()); Drain();
    auto authority = target->documents_;
    Send(*handler, "commit", CommitRequest(target->DocumentClient(), 1));
    target->RetireDocuments(); handler.reset(); target.reset(); Drain();
    assert(authority->disk->FindDict("clients")->size() == 1);
    auto retiring = std::make_unique<ShellHostView>();
    base::OnceCallback<void(bool, base::Value)> done = [&](bool, auto) { retiring.reset(); };
    assert(retiring->TrackStorageWrite("test.json", base::DictValue().Set("kind", "remove"), done));
    std::move(done).Run(false, base::Value()); assert(!retiring);
  }
  if (mode == "session") {
    base::DictValue before; before.Set("title", "old");
    base::DictValue proposed; proposed.Set("title", "accepted-new-intent");
    auto submit = [&](const base::DictValue& base, const base::DictValue& local) {
      base::DictValue args; args.Set("base", base.Clone()); args.Set("session", local.Clone());
      host.SessionInvoke("session.write", args, Ignore);
    };
    storage_disk[kSessionName] = base::WriteJsonWithOptions(before, 2);
    storage_outcomes.push_back(false); submit(before, proposed);
    Activate(host, replacement, next_frame); original.reset(); Drain();
    assert(host.storage_failures_.contains(kSessionName));
    submit(before, before); Drain();
    assert(host.storage_failures_.contains(kSessionName));
    submit(base::DictValue(), proposed); Drain();
    assert(host.storage_failures_.contains(kSessionName));
    Blocked(host, replacement, 0);
    submit(before, proposed); Drain();
    assert(host.storage_failures_.empty()); CloseReady(host, replacement, 0);
  }
  if (mode == "after-begin") {
    Send(*original, "watch", WatchRequest()); Drain();
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [](bool ready) { assert(ready); }));
    const auto token = *host.chrome_close_token_;
    SendAck(*original, host.RequestWindowClose(), 0); Drain();
    assert(!host.DeferChromeClose(token, LinuxCloseStage::kBeginTeardown, [](bool) { assert(false); }));
    Activate(host, replacement, next_frame); original.reset(); Drain();
    int denied = 0;
    for (auto method : {"session.write", "ArdiaShell.writeDocument", "ArdiaShell.saveDocument", "ArdiaShell.removeDocument"})
      host.StorageGateInvoke(method, base::DictValue(), [&](bool ok, auto value) {
        assert(!ok && *value.GetDict().FindString("code") == "ERR_DOCUMENT_CLOSING"); ++denied;
      });
    Send(replacement, "commit", CommitRequest(host.DocumentClient(), 1)); Drain();
    assert(denied == 4 && !host.storage_pending_ && host.close_.Irreversible());
    assert(!host.DeferChromeClose(token, LinuxCloseStage::kDestroy, [](bool) { assert(false); }));
  }
  host.RetireDocuments(); Drain();
}
'''


class WindowStorageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix="ardia-window-storage-")
        root = Path(cls.scratch.name)
        (root / "base/json").mkdir(parents=True)
        (root / "base/values.h").write_text(values())
        writer = WRITER.replace('inline std::optional<std::string> WriteJsonWithOptions',
            'inline std::map<std::string, Value> fixture_json;\ninline std::optional<std::string> WriteJsonWithOptions')
        writer = writer.replace('return Encode(value.Clone());',
            'auto copy = value.Clone(); auto text = Encode(copy); fixture_json.insert_or_assign(text, std::move(copy)); return text;')
        (root / "base/json/json_writer.h").write_text(writer)
        generic = generic_invoke().replace('bool WriteDocument(const std::string&, const std::string&, const std::optional<std::string>&) { ++generic_writes; return true; }', r'''
extern std::map<std::string, std::optional<std::string>> storage_disk;
extern std::deque<bool> storage_outcomes;
extern int storage_attempts;
bool WriteDocument(const std::string&, const std::string& name, const std::optional<std::string>& text) {
  ++storage_attempts;
  bool ok = true;
  if (!storage_outcomes.empty()) { ok = storage_outcomes.front(); storage_outcomes.pop_front(); }
  if (ok) storage_disk[name] = text;
  return ok;
}
''')
        generic = generic.replace('std::optional<std::string> ReadDocument(const std::string&, const std::string&) { ++generic_reads; return "ok"; }', r'''
std::optional<std::string> ReadDocument(const std::string&, const std::string& name) {
  extern std::map<std::string, std::optional<std::string>> storage_disk;
  return storage_disk[name];
}
''')
        native = fixture().replace('struct Profile { bool regular = true; bool IsRegularProfile() const { return regular; } };', r'''
struct Profile {
  bool regular = true;
  bool IsRegularProfile() const { return regular; }
  bool IsOffTheRecord() const { return !regular; }
  std::string GetPath() const { return "/native"; }
};
''').replace('  void GenericInvoke(', '''  void SessionInvoke(std::string, const base::DictValue&, base::OnceCallback<void(bool, base::Value)>);
  void StorageGateInvoke(std::string, const base::DictValue&, base::OnceCallback<void(bool, base::Value)>);
  void GenericInvoke(''')
        native = native.replace('HostMessageHandler::HostMessageHandler(ShellHostView* host)',
            'std::function<void()> after_native_event;\nHostMessageHandler::HostMessageHandler(ShellHostView* host)')
        native = native.replace('''  if (std::string_view(function) == "__ardiaEvent")
    host_->events.emplace_back(first.GetString(), second.GetString(), third.Clone());''', '''  if (std::string_view(function) == "__ardiaEvent") {
    host_->events.emplace_back(first.GetString(), second.GetString(), third.Clone());
    if (after_native_event) { auto callback = std::move(after_native_event); callback(); }
  }''')
        source = (ROOT / "src/ardia/linux/ac_linux_host.cc").read_text()
        session = r'''
#include "ardia/linux/ac_linux_session.h"
namespace base {
using FilePath = std::string;
inline constexpr int JSON_PARSE_RFC = 0;
struct JSONReader {
  static std::optional<Value> Read(std::string_view text, int, size_t) {
    auto found = fixture_json.find(std::string(text));
    return found == fixture_json.end() ? std::nullopt : std::make_optional(found->second.Clone());
  }
};
}
'''
        session += '\n'.join(method(source, signature) for signature in [
            'std::optional<base::DictValue> ReadSession(', 'struct SessionWriteResult {',
            'SessionWriteResult MergeAndWriteSession(']).replace('base::DictValue session;\n}', 'base::DictValue session;\n};')
        session += '''\nvoid ShellHostView::SessionInvoke(std::string method, const base::DictValue& args,
          base::OnceCallback<void(bool, base::Value)> done) {\n'''
        session += method(source, '  if (method == "session.write")') + '\n}\n'
        session += '''\nvoid ShellHostView::StorageGateInvoke(std::string method, const base::DictValue&,
          base::OnceCallback<void(bool, base::Value)> done) {\n'''
        invoke = source[source.index('void ShellHostView::Invoke('):]
        session += method(invoke, '  if ((close_.BlocksWrites()') + '\n}\n'
        (root / "main.cc").write_text(native + generic + session + SUPPORT + MAIN)
        compiler = shutil.which("clang++") or shutil.which("c++")
        cls.binary = root / "window-storage"
        result = subprocess.run([compiler, "-std=c++23", "-Wall", "-Wextra", "-Werror", "-fsanitize=address,undefined", "-fno-omit-frame-pointer", "-I", str(root), "-I", str(ROOT / "src"), *[str(ROOT / "src/ardia/linux" / name) for name in [*SOURCES, 'ac_linux_session.cc']], str(root / "main.cc"), "-o", str(cls.binary)], capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_mode(self, name):
        result = subprocess.run([str(self.binary), name], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        if result.stdout:
            print(result.stdout, end="")

    def test_stale_same_filename_success_requires_exact_recovery(self):
        self.run_mode("same-name")

    def test_canonical_failure_survives_source_and_reply_loss_until_matching_worker_receipt(self):
        self.run_mode("canonical-failure")

    def test_retirement_cleanup_preparation_keeps_mixed_intent_through_two_replacements(self):
        self.run_mode("retired-preparation")

    def test_receipt_size_refusal_never_poisoned_by_transient_read_failure(self):
        self.run_mode("receipt-preparation")

    def test_unwatch_cancels_queued_watch_and_peer_events(self):
        self.run_mode("watch-unwatch")

    def test_only_latest_rewatch_receives_snapshot_and_peer_events(self):
        self.run_mode("watch-rewatch")

    def test_cancellation_event_unwatch_invalidates_already_moved_replay(self):
        self.run_mode("watch-event-unwatch")

    def test_earlier_success_cannot_recover_later_failure(self):
        self.run_mode("ordering")

    def test_read_failures_preserve_valid_intent_without_poisoning_invalid_requests(self):
        self.run_mode("read-classification")

    def test_nonowner_conflicts_and_native_limits_do_not_poison_storage_ledger(self):
        self.run_mode("nonowner-limit")

    def test_superseded_and_duplicate_paths_cannot_manufacture_durable_recovery(self):
        self.run_mode("superseded-duplicate")

    def test_actual_worker_ordering_excludes_earlier_and_duplicate_recovery(self):
        self.run_mode("canonical-ordering")

    def test_count_capacity_preserves_failures_and_admits_exact_retry(self):
        self.run_mode("capacity")

    def test_byte_capacity_preserves_failures_and_admits_exact_retry(self):
        self.run_mode("byte-capacity")

    def test_duplicate_pending_work_also_reserves_native_byte_budget(self):
        self.run_mode("pending-byte-capacity")

    def test_sync_state_may_exceed_the_document_limit_with_a_digest_ledger_entry(self):
        self.run_mode("large-sync-state")

    def test_other_failed_payload_and_remove_success_do_not_recover_written_intent(self):
        self.run_mode("different-write")

    def test_worker_and_reply_completion_tolerate_native_owner_destruction(self):
        self.run_mode("destroyed-completion")

    def test_session_recovery_requires_exact_base_and_proposed_snapshot(self):
        self.run_mode("session")

    def test_after_begin_original_lease_blocks_every_storage_route_across_replacement(self):
        self.run_mode("after-begin")
