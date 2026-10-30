from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_host_fixture import ROOT, SOURCES, PRELUDE, WRITER, close_invoke, host_methods, values


SUPPORT = r'''
int Named(const ShellHostView& host, std::string_view name) {
  int count = 0;
  for (const auto& event : host.events)
    if (*std::get<2>(event).GetDict().FindString("name") == name) ++count;
  return count;
}
std::set<std::string> RequestedGenerations(const ShellHostView& host) {
  std::set<std::string> generations;
  for (const auto& event : host.events) {
    const auto& envelope = std::get<2>(event).GetDict();
    if (*envelope.FindString("name") == "shell.closeRequested")
      generations.insert(*envelope.FindDict("data")->FindString("closeGeneration"));
  }
  return generations;
}
struct Reply { bool called = false; bool ok = false; base::Value value; };
std::shared_ptr<Reply> Invoke(ShellHostView& host, std::string method, base::Value value) {
  auto reply = std::make_shared<Reply>();
  base::ListValue list; list.Append(std::move(value));
  base::DictValue args; args.Set("args", base::Value(std::move(list)));
  host.CloseInvoke(method, args, [reply](bool ok, base::Value result) {
    reply->called = true; reply->ok = ok; reply->value = std::move(result);
  });
  return reply;
}
void Commit(ShellHostView& host, int sequence, bool expect_ok) {
  bool done = false;
  host.DocumentCall("commit", CommitRequest(host.DocumentClient(), sequence), [&](auto result) {
    assert(result.ok() == expect_ok); done = true;
  });
  Drain(); assert(done);
}
auto* UI() { return base::SingleThreadTaskRunner::GetCurrentDefault(); }
'''


MAIN = r'''
int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  (void)Ignore;
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
  if (mode == "deliberation") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    auto first = Invoke(host, "ArdiaShell.requestWindowClose", base::Value("settings"));
    assert(first->ok);
    const auto request = first->value.GetDict().Clone();
    for (auto reason : {views::Widget::ClosedReason::kWindowButton, views::Widget::ClosedReason::kCompositor,
                        views::Widget::ClosedReason::kKeyboard, views::Widget::ClosedReason::kQuit}) {
      host.native.widget.CloseWithReason(reason);
      assert(!host.native.widget.IsClosed());
    }
    assert(Invoke(host, "ArdiaShell.requestWindowClose", base::Value("settings"))->value.GetDict() == request);
    assert(host.RequestWindowClose() == request);
    assert(RequestedGenerations(host) == std::set<std::string>{*request.FindString("closeGeneration")});
    for (int minute = 0; minute < 10; ++minute) { UI()->Expire(); Drain(); }
    assert(host.close_.phase() == LinuxClose::Phase::kRequested);
    assert(host.close_.identity().close == *request.FindString("closeGeneration"));
    assert(Named(host, "shell.closeCancelled") == 0 && !host.native.widget.IsClosed());
    Commit(host, 1, true);
  }
  if (mode == "transition") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    const auto request = host.RequestWindowClose();
    auto refused = [&](base::DictValue forged) {
      auto reply = Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(std::move(forged)));
      assert(reply->called && !reply->ok);
      assert(host.close_.phase() == LinuxClose::Phase::kRequested && UI()->timers.empty());
    };
    refused(request.Clone().Set("closeGeneration", "2"));
    refused(request.Clone().Set("rendererGeneration", "4294967296"));
    refused(request.Clone().Set("rendererGeneration", base::Value(1)));
    refused(request.Clone().Set("closeGeneration", base::Value(1)));
    refused(request.Clone().Set("windowId", "main"));
    refused(request.Clone().Set("watermark", base::Value(0)));
    auto missing = request.Clone(); missing.Remove("closeGeneration"); refused(std::move(missing));
    host.handler.authorized = false; refused(request.Clone()); host.handler.authorized = true;
    auto begun = Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()));
    assert(begun->called && begun->ok && begun->value.is_dict());
    assert(begun->value.GetDict().size() == 2 && begun->value.GetDict().Find("accepted")->GetBool());
    assert(begun->value.GetDict().Find("endsSession")->GetBool());
    assert(host.close_.phase() == LinuxClose::Phase::kDraining && UI()->timers.size() == 1);
    assert(files.tasks.empty() && !host.close_.BlocksWrites());
    auto again = Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()));
    assert(again->ok && host.close_.phase() == LinuxClose::Phase::kDraining && UI()->timers.size() == 1);
    assert(host.RequestWindowClose() == request && Named(host, "shell.closeRequested") == 1);
    Commit(host, 1, true);
    bool cancelled = false;
    host.CancelWindowClose(host.close_.identity(), [&](bool ok, auto) { cancelled = ok; });
    Drain(); assert(cancelled && host.close_.phase() == LinuxClose::Phase::kCancelled);
    auto stale = Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()));
    assert(!stale->ok && host.close_.phase() == LinuxClose::Phase::kCancelled);
    const auto next = host.RequestWindowClose();
    assert(*next.FindString("closeGeneration") != *request.FindString("closeGeneration"));
    assert(!Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
    assert(host.close_.phase() == LinuxClose::Phase::kRequested);
    UI()->timers.clear();
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(next.Clone()))->ok);
    host.Replace();
    assert(!Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(next.Clone()))->ok);
  }
  if (mode == "seal-gate") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    const auto request = host.RequestWindowClose();
    auto early = Invoke(host, "ArdiaShell.acknowledgeWindowClose", base::Value(Ack(request, 0)));
    assert(early->called && !early->ok && *early->value.GetDict().FindString("code") == "ERR_WINDOW_CLOSE_STALE");
    assert(files.tasks.empty() && host.close_.phase() == LinuxClose::Phase::kRequested && !host.close_.BlocksWrites());
    assert(!host.close_.BeginSeal(host.close_.identity(), host.renderer_generation_, 0));
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
    int acknowledged = 0;
    host.AcknowledgeWindowClose(Ack(request, 0), [&](bool ok, auto) { assert(ok); ++acknowledged; });
    host.AcknowledgeWindowClose(Ack(request, 0), [&](bool ok, auto) { assert(ok); ++acknowledged; });
    host.AcknowledgeWindowClose(Ack(request, 1), [](bool ok, auto) { assert(!ok); });
    assert(host.close_.phase() == LinuxClose::Phase::kSealing);
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
    Drain(); assert(host.native.widget.IsClosed() && acknowledged == 2);
  }
  if (mode == "sealed-stuck") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    const auto request = host.RequestWindowClose();
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
    bool replied = false, acknowledged = true;
    host.AcknowledgeWindowClose(Ack(request, 0), [&](bool ok, auto) { replied = true; acknowledged = ok; });
    files.Drain(); UI()->One();
    assert(host.close_.phase() == LinuxClose::Phase::kSealed && !host.chrome_close_token_ && UI()->tasks.size() == 1);
    host.handler.authorized = false; UI()->One(); host.handler.authorized = true;
    Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kSealed && host.close_.BlocksWrites());
    assert(!replied && !host.native.widget.IsClosed() && !host.chrome_close_token_);
    UI()->Expire(); Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kCancelled && !host.close_.BlocksWrites());
    assert(replied && !acknowledged && host.native.discard_requests == 0);
    assert(Named(host, "shell.closeCancelled") == 1);
    Commit(host, 1, true);
  }
  if (mode == "replacement-suspension") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    const auto first = host.RequestWindowClose();
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(first.Clone()))->ok);
    assert(host.dialogs_->controller_.suspensions.size() == 1);
    host.Replace();
    assert(host.close_.phase() == LinuxClose::Phase::kIdle);
    const auto second = host.RequestWindowClose();
    assert(!second.empty() && *second.FindString("closeGeneration") != *first.FindString("closeGeneration"));
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(second.Clone()))->ok);
    assert(host.dialogs_->controller_.suspensions.size() == 2);
    Drain();
    assert(host.dialogs_->controller_.suspensions.size() == 1);
    host.CancelWindowClose(host.close_.identity(), Ignore);
    Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kCancelled);
    assert(host.dialogs_->controller_.suspensions.empty() && !host.dialogs_->controller_.exhausted);
    base::DictValue identity;
    assert(host.dialogs_->controller().Identify(*host.DialogClient(), &identity));
  }
  if (mode == "suspension-bound") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    for (size_t n = 0; n <= LinuxDialogController::kMaxSuspensions; ++n) {
      const auto request = host.RequestWindowClose();
      assert(!request.empty());
      assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
      host.Replace();
    }
    assert(host.dialogs_->controller_.suspensions.size() == LinuxDialogController::kMaxSuspensions);
    assert(host.dialogs_->controller_.exhausted);
    Drain();
    assert(host.dialogs_->controller_.suspensions.empty() && host.dialogs_->controller_.exhausted);
    base::DictValue identity;
    assert(!host.dialogs_->controller().Identify(*host.DialogClient(), &identity));
  }
  if (mode.starts_with("departure-")) {
    ShellHostView::departures.clear();
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts.clear(); hosts[1] = &host;
    auto departure = [] {
      base::DictValue value;
      value.Set("base", base::DictValue().Set("windowOrder", base::Value(base::ListValue().Append(base::Value("settings")))));
      value.Set("session", base::DictValue().Set("windowOrder", base::Value(base::ListValue())));
      return value;
    };
    auto sealed = [&](bool with_departure) {
      assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [](bool) {}));
      const auto token = *host.chrome_close_token_;
      const auto request = host.RequestWindowClose();
      assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
      auto ack = Ack(request, 0);
      if (with_departure) ack.Set("departure", departure());
      host.AcknowledgeWindowClose(ack, Ignore);
      Drain();
      assert(host.close_.phase() == LinuxClose::Phase::kSealed);
      return token;
    };
    if (mode == "departure-completed") {
      const auto token = sealed(true);
      assert(host.close_departure_ && ShellHostView::departures.empty());
      assert(!host.DeferChromeClose(token, LinuxCloseStage::kBeginTeardown, [](bool) {}));
      assert(host.close_.Irreversible() && !host.close_departure_);
      assert(ShellHostView::departures.size() == 1 && ShellHostView::departures[0].first == host.window_id_);
      assert(ShellHostView::departures[0].second.FindDict("base") && ShellHostView::departures[0].second.FindDict("session"));
      assert(!host.DeferChromeClose(token, LinuxCloseStage::kDestroy, [](bool) {}));
      host.Replace(); Drain();
      assert(ShellHostView::departures.size() == 1);
    }
    if (mode == "departure-renderer-death-after-seal") {
      sealed(true);
      host.Replace(); Drain();
      assert(host.close_.phase() == LinuxClose::Phase::kCancelled && !host.close_departure_);
      assert(ShellHostView::departures.empty());
      const auto next = sealed(false);
      assert(!host.DeferChromeClose(next, LinuxCloseStage::kBeginTeardown, [](bool) {}));
      assert(host.close_.Irreversible() && ShellHostView::departures.empty());
    }
    if (mode == "departure-malformed") {
      const auto request = host.RequestWindowClose();
      assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
      auto missing = Ack(request, 0); missing.Set("departure", base::DictValue().Set("base", base::DictValue()));
      auto extra = Ack(request, 0); auto bloated = departure(); bloated.Set("more", base::DictValue()); extra.Set("departure", std::move(bloated));
      auto wrong = Ack(request, 0); wrong.Set("departure", base::Value("session"));
      for (auto* ack : {&missing, &extra, &wrong}) {
        bool refused = false;
        host.AcknowledgeWindowClose(*ack, [&](bool ok, auto) { refused = !ok; });
        assert(refused && host.close_.phase() == LinuxClose::Phase::kDraining && !host.close_departure_);
      }
    }
    hosts.clear();
  }
  if (mode == "decision-cancel") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    int answers = 0;
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [&](bool ready) { assert(!ready); ++answers; }));
    host.native.widget.CloseWithReason(views::Widget::ClosedReason::kQuit);
    const auto request = host.RequestWindowClose();
    assert(RequestedGenerations(host).size() == 1);
    auto rejected = Invoke(host, "ArdiaShell.rejectWindowClose", base::Value(request.Clone()));
    Drain();
    assert(rejected->ok && answers == 1 && host.native.discard_requests == 1);
    assert(host.close_.phase() == LinuxClose::Phase::kCancelled && Named(host, "shell.closeCancelled") == 1);
    assert(!host.native.widget.IsClosed() && !host.close_.BlocksWrites());
    assert(!Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
  }
}
'''


class DocumentCloseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            raise unittest.SkipTest('C++ compiler is unavailable')
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-document-close-')
        root = Path(cls.scratch.name)
        (root / 'base/json').mkdir(parents=True)
        (root / 'base/values.h').write_text(values())
        (root / 'base/json/json_writer.h').write_text(WRITER)
        (root / 'main.cc').write_text(PRELUDE + host_methods() + close_invoke() + SUPPORT + MAIN)
        cls.binary = root / 'close'
        result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(root), '-I', str(ROOT / 'src'), *[str(ROOT / 'src/ardia/linux' / source) for source in SOURCES], str(root / 'main.cc'), '-o', str(cls.binary)], capture_output=True, text=True, timeout=300)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_mode(self, mode):
        result = subprocess.run([str(self.binary), mode], capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_peer_events_reach_only_authorized_current_subscribers(self):
        self.run_mode('documents')

    def test_widget_close_entry_points_defer_to_exact_native_identity(self):
        self.run_mode('close')

    def test_watermarks_pending_generations_timeout_and_cancel_races(self):
        self.run_mode('races')

    def test_storage_failures_block_close_until_the_matching_retry(self):
        self.run_mode('storage')

    def test_chromium_abort_confirmation_precedes_worker_unseal_and_cancel_event(self):
        self.run_mode('chrome-cancel')

    def test_renderer_replacement_rejects_stale_preparation_and_releases_waiting_watch(self):
        self.run_mode('chrome-replacement')

    def test_no_document_client_cannot_forge_watermark(self):
        self.run_mode('no-client')

    def test_decision_longer_than_the_deadline_never_cancels(self):
        self.run_mode('deliberation')

    def test_drain_transition_is_authenticated_idempotent_and_rejects_stale_identity(self):
        self.run_mode('transition')

    def test_seal_requires_the_draining_phase(self):
        self.run_mode('seal-gate')

    def test_sealed_attempt_that_never_reaches_chrome_is_cancelled_by_the_backstop(self):
        self.run_mode('sealed-stuck')

    def test_renderer_replacement_mid_drain_resumes_each_dialog_suspension(self):
        self.run_mode('replacement-suspension')

    def test_close_dialog_suspensions_are_bounded_and_fail_closed(self):
        self.run_mode('suspension-bound')

    def test_cancel_decision_rejects_the_pending_attempt_through_chrome(self):
        self.run_mode('decision-cancel')

    def test_departure_is_written_once_only_when_teardown_commits(self):
        self.run_mode('departure-completed')

    def test_renderer_death_after_seal_discards_the_departure(self):
        self.run_mode('departure-renderer-death-after-seal')

    def test_malformed_departure_is_refused_before_seal(self):
        self.run_mode('departure-malformed')


if __name__ == '__main__':
    unittest.main()
