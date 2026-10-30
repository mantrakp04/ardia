from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from document_host_fixture import ROOT, SOURCES, PRELUDE, WRITER, host_methods, values, close_invoke


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


DELIBERATION = r'''
int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  (void)Ignore;
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
  if (mode == "chrome-deliberation") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    int answers = 0;
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [&](bool) { ++answers; }));
    assert(host.chrome_close_token_);
    const auto token = *host.chrome_close_token_;
    const auto identity = host.close_.identity();
    for (int minute = 0; minute < 10; ++minute) { UI()->Expire(); Drain(); }
    assert(answers == 0 && host.chrome_close_token_ && *host.chrome_close_token_ == token);
    assert(host.native.discard_requests == 0 && host.close_.identity() == identity);
    assert(host.close_.phase() == LinuxClose::Phase::kRequested && !host.close_.BlocksWrites());
    assert(Named(host, "shell.closeRequested") == 1 && Named(host, "shell.closeCancelled") == 0);
  }
}
'''


DRAIN = r'''
int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  (void)Ignore;
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
  if (mode == "companion-stay") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    Browser first, second, empty;
    first.strip.tabs = 1; first.unload.handlers = true;
    second.strip.tabs = 2; second.unload.handlers = true;
    host.companions_ = {first.GetWeakPtr(), second.GetWeakPtr(), empty.GetWeakPtr()};
    const auto request = host.RequestWindowClose();
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
    host.AcknowledgeWindowClose(Ack(request, 0), Ignore);
    Drain();
    assert(first.unload.prompts == 1 && second.unload.prompts == 0 && !host.native.widget.IsClosed());
    first.unload.Answer(true);
    Drain();
    assert(second.unload.prompts == 1 && first.unload.state == Browser::Unload::State::kConfirmed);
    second.unload.Answer(false);
    Drain();
    assert(!host.native.widget.IsClosed() && host.close_.phase() == LinuxClose::Phase::kCancelled);
    assert(Named(host, "shell.closeCancelled") == 1);
    assert(first.unload.state == Browser::Unload::State::kIdle && second.unload.state == Browser::Unload::State::kIdle);
    assert(empty.unload.prompts == 0);
    const auto again = host.RequestWindowClose();
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(again.Clone()))->ok);
    host.AcknowledgeWindowClose(Ack(again, 0), Ignore);
    Drain();
    assert(first.unload.prompts == 2 && !host.native.widget.IsClosed());
    first.unload.Answer(true);
    Drain();
    second.unload.Answer(true);
    Drain();
    assert(host.native.widget.IsClosed());
  }
  if (mode == "companion-stay-first") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    Browser first, second;
    first.strip.tabs = 1; first.unload.handlers = true;
    second.strip.tabs = 1; second.unload.handlers = true;
    host.companions_ = {first.GetWeakPtr(), second.GetWeakPtr()};
    const auto request = host.RequestWindowClose();
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
    host.AcknowledgeWindowClose(Ack(request, 0), Ignore);
    Drain();
    first.unload.Answer(false);
    Drain();
    assert(second.unload.prompts == 0 && !host.native.widget.IsClosed());
    assert(host.close_.phase() == LinuxClose::Phase::kCancelled && Named(host, "shell.closeCancelled") == 1);
  }
  if (mode == "deadline") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    const auto request = host.RequestWindowClose();
    UI()->Expire(); Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kRequested);
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
    UI()->Expire(); Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kCancelled && Named(host, "shell.closeCancelled") == 1);
    Commit(host, 1, true);
    const auto old = host.RequestWindowClose();
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(old.Clone()))->ok);
    host.CancelWindowClose(host.close_.identity(), Ignore); Drain();
    const auto current = host.RequestWindowClose();
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(current.Clone()))->ok);
    assert(UI()->timers.size() == 2);
    auto stale = std::move(UI()->timers.front()); UI()->timers.pop_front(); std::move(stale).Run(); Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kDraining && Named(host, "shell.closeCancelled") == 2);
    host.native.widget.veto = true;
    int answers = 0;
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [&](bool ready) { assert(ready); ++answers; }));
    const auto token = *host.chrome_close_token_;
    bool replied = false;
    host.AcknowledgeWindowClose(Ack(current, 1), [&](bool, auto) { replied = true; });
    Drain(); assert(answers == 1 && host.close_.phase() == LinuxClose::Phase::kSealed && !replied);
    UI()->Expire(); Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kSealed && host.close_.BlocksWrites());
    assert(host.native.discard_requests == 0 && *host.chrome_close_token_ == token && !replied);
    assert(Named(host, "shell.closeCancelled") == 2);
    host.CancelWindowClose(host.close_.identity(), Ignore); Drain();
    assert(replied && host.native.discard_requests == 1 && host.close_.phase() == LinuxClose::Phase::kCancelled);
    assert(Named(host, "shell.closeCancelled") == 3);
  }
  if (mode == "chrome-drain-deadline") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    int answers = 0;
    assert(host.DeferChromeClose({}, LinuxCloseStage::kPrepare, [&](bool ready) { assert(!ready); ++answers; }));
    const auto request = host.RequestWindowClose();
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
    UI()->Expire(); Drain();
    assert(answers == 1 && host.native.discard_requests == 1 && !host.chrome_close_token_);
    assert(host.close_.phase() == LinuxClose::Phase::kCancelled && Named(host, "shell.closeCancelled") == 1);
    Commit(host, 1, true);
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
  if (mode == "handoff") {
    ShellHostView host; Watch(host); host.ArmWindowClose();
    hosts[1] = &host;
    host.native.widget.veto = true;
    const auto request = host.RequestWindowClose();
    assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
    host.AcknowledgeWindowClose(Ack(request, 0), Ignore);
    Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kHandedOff && host.chrome_close_token_);
    const auto token = *host.chrome_close_token_;
    UI()->Expire(); Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kHandedOff && *host.chrome_close_token_ == token);
    assert(host.native.discard_requests == 0 && Named(host, "shell.closeCancelled") == 0);
  }
  if (mode == "quit-flag") {
    auto quitting = [](const ShellHostView& host) {
      for (const auto& event : host.events) {
        const auto& envelope = std::get<2>(event).GetDict();
        if (*envelope.FindString("name") != "shell.closeRequested") continue;
        const auto* value = envelope.Find("quitting");
        return value ? std::optional<bool>(value->GetBool()) : std::nullopt;
      }
      return std::optional<bool>();
    };
    browser_shutdown::trying_to_quit = false;
    ShellHostView window; Watch(window); hosts[1] = &window;
    assert(!window.RequestWindowClose().empty() && quitting(window) == false);
    browser_shutdown::trying_to_quit = true;
    ShellHostView quit; quit.window_id_ = "window-2"; Watch(quit); hosts[2] = &quit;
    assert(!quit.RequestWindowClose().empty() && quitting(quit) == true);
    browser_shutdown::trying_to_quit = false;
  }
  if (mode == "ends-session") {
    ShellHostView host; Watch(host);
    ShellHostView other; other.window_id_ = "window-2";
    ShellHostView utility; utility.window_id_ = "import"; utility.kind_ = "import";
    hosts[1] = &host; hosts[2] = &utility;
    auto ends = [&](const base::DictValue& request) {
      auto reply = Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()));
      assert(reply->ok);
      return reply->value.GetDict().Find("endsSession")->GetBool();
    };
    auto request = host.RequestWindowClose();
    assert(ends(request));
    hosts[3] = &other;
    assert(!ends(request));
    browser_shutdown::trying_to_quit = true;
    assert(ends(request));
    browser_shutdown::trying_to_quit = false;
    other.native.widget.closed = true;
    assert(ends(request));
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
  if (mode == "two-window-ends-session") {
    for (const bool a_first : {true, false}) {
      ShellHostView a; Watch(a); a.ArmWindowClose();
      ShellHostView b; b.window_id_ = "window-2"; Watch(b); b.ArmWindowClose();
      hosts.clear(); hosts[1] = &a; hosts[2] = &b;
      const auto ra = a.RequestWindowClose();
      const auto rb = b.RequestWindowClose();
      assert(!ra.empty() && !rb.empty());
      auto drain = [](ShellHostView& host, const base::DictValue& request) {
        auto reply = Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()));
        assert(reply->ok);
        return reply->value.GetDict().Find("endsSession")->GetBool();
      };
      const bool first = a_first ? drain(a, ra) : drain(b, rb);
      const bool second = a_first ? drain(b, rb) : drain(a, ra);
      assert(!first && second);
      hosts.clear();
      Drain();
    }
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
    if (mode == "departure-renderer-death-before-seal") {
      const auto request = host.RequestWindowClose();
      assert(Invoke(host, "ArdiaShell.beginWindowCloseDrain", base::Value(request.Clone()))->ok);
      host.Replace(); Drain();
      assert(!host.close_departure_ && ShellHostView::departures.empty());
    }
    if (mode == "departure-confirmed-cancel") {
      sealed(true);
      bool cancelled = false;
      host.CancelWindowClose(host.close_.identity(), [&](bool ok, auto) { cancelled = ok; });
      Drain();
      assert(cancelled && host.close_.phase() == LinuxClose::Phase::kCancelled && !host.close_departure_);
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


class CloseDeliberationTests(unittest.TestCase):
    @classmethod
    def build(cls, name, main):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            raise unittest.SkipTest('C++ compiler is unavailable')
        root = Path(cls.scratch.name) / name
        (root / 'base/json').mkdir(parents=True)
        (root / 'base/values.h').write_text(values())
        (root / 'base/json/json_writer.h').write_text(WRITER)
        (root / 'main.cc').write_text(PRELUDE + host_methods() + close_invoke() + SUPPORT + main)
        binary = root / name
        result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(root), '-I', str(ROOT / 'src'), *[str(ROOT / 'src/ardia/linux' / source) for source in SOURCES], str(root / 'main.cc'), '-o', str(binary)], capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        return binary

    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-close-deliberation-')
        cls.binaries = {}

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_mode(self, program, mode):
        if program not in self.binaries:
            self.binaries[program] = self.build(program, DELIBERATION if program == 'deliberation' else DRAIN)
        result = subprocess.run([str(self.binaries[program]), mode], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_decision_longer_than_the_deadline_never_cancels_and_repeats_join(self):
        self.run_mode('deliberation', 'deliberation')

    def test_chrome_initiated_decision_keeps_its_token_and_preparation(self):
        self.run_mode('deliberation', 'chrome-deliberation')

    def test_drain_transition_is_authenticated_idempotent_and_rejects_stale_identity(self):
        self.run_mode('drain', 'transition')

    def test_seal_requires_the_draining_phase_and_keeps_watermark_idempotency(self):
        self.run_mode('drain', 'seal-gate')

    def test_stay_on_a_later_companion_after_an_earlier_one_accepted_cancels_the_whole_close(self):
        self.run_mode('drain', 'companion-stay')

    def test_stay_on_the_first_companion_cancels_before_asking_the_next(self):
        self.run_mode('drain', 'companion-stay-first')

    def test_drain_deadline_starts_at_drain_checks_identity_and_ends_at_seal(self):
        self.run_mode('drain', 'deadline')

    def test_drain_deadline_requests_coordinated_chrome_cancellation(self):
        self.run_mode('drain', 'chrome-drain-deadline')

    def test_sealed_attempt_that_never_reaches_chrome_is_cancelled_by_the_backstop(self):
        self.run_mode('drain', 'sealed-stuck')

    def test_backstop_never_fires_after_chrome_handoff(self):
        self.run_mode('drain', 'handoff')

    def test_drain_reports_whether_closing_ends_the_session(self):
        self.run_mode('drain', 'ends-session')

    def test_close_request_tells_the_renderer_when_the_app_is_quitting(self):
        self.run_mode('drain', 'quit-flag')

    def test_renderer_replacement_mid_drain_resumes_each_attempt_suspension(self):
        self.run_mode('drain', 'replacement-suspension')

    def test_close_suspensions_are_bounded_and_fail_closed(self):
        self.run_mode('drain', 'suspension-bound')

    def test_simultaneous_last_two_window_closes_keep_one_for_restore(self):
        self.run_mode('drain', 'two-window-ends-session')

    def test_departure_is_written_once_only_when_teardown_commits(self):
        self.run_mode('drain', 'departure-completed')

    def test_renderer_death_after_seal_discards_the_departure(self):
        self.run_mode('drain', 'departure-renderer-death-after-seal')

    def test_renderer_death_before_seal_records_no_departure(self):
        self.run_mode('drain', 'departure-renderer-death-before-seal')

    def test_confirmed_cancellation_discards_the_departure(self):
        self.run_mode('drain', 'departure-confirmed-cancel')

    def test_malformed_departure_is_refused_before_seal(self):
        self.run_mode('drain', 'departure-malformed')

    def test_cancel_decision_rejects_the_pending_attempt_through_chrome(self):
        self.run_mode('drain', 'decision-cancel')


if __name__ == '__main__':
    unittest.main()
