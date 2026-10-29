from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

from document_host_fixture import ROOT, SOURCES, WRITER, DIALOGS, values
from document_renderer_fixture import fixture
from test_renderer_contract import method


BASE = r'''
#define DCHECK_CURRENTLY_ON(thread) static_cast<void>(0)
namespace base {
template<class> class RepeatingCallback;
template<class R, class... A> class RepeatingCallback<R(A...)> {
  std::shared_ptr<std::function<R(A...)>> fn_;
 public:
  RepeatingCallback() = default;
  template<class F> RepeatingCallback(F fn) : fn_(std::make_shared<std::function<R(A...)>>(std::move(fn))) {}
  R Run(A... args) const { return (*fn_)(std::forward<A>(args)...); }
};
template<class T> struct WeakPtrFactory {
  T* owner;
  std::shared_ptr<bool> alive = std::make_shared<bool>(true);
  explicit WeakPtrFactory(T* value) : owner(value) {}
  ~WeakPtrFactory() { *alive = false; }
  WeakPtr<T> GetWeakPtr() { return {owner, alive}; }
  void InvalidateWeakPtrs() { *alive = false; alive = std::make_shared<bool>(true); }
};
template<class C, class... P, class... Args> auto BindOnce(void (C::*fn)(P...), WeakPtr<C> weak, Args... args) {
  return [fn, weak, ...args = std::move(args)](auto&&... rest) mutable {
    if (!weak) return;
    (weak.get()->*fn)(std::move(args)..., std::forward<decltype(rest)>(rest)...);
  };
}
enum TrimPositions { TRIM_ALL };
inline std::u16string UTF8ToUTF16(const std::string& text) { return std::u16string(text.begin(), text.end()); }
inline std::string UTF16ToUTF8(std::u16string_view text) { return std::string(text.begin(), text.end()); }
inline std::u16string_view TrimWhitespace(std::u16string_view value, TrimPositions) {
  constexpr std::u16string_view spaces = u" \t\r\n";
  const auto start = value.find_first_not_of(spaces);
  if (start == value.npos) return {};
  return value.substr(start, value.find_last_not_of(spaces) - start + 1);
}
}
'''


OWNER = r'''
namespace ardia {
struct LinuxWindowDialogs {
  struct Shown { LinuxDialogSpec spec; LinuxDialogResponder respond; };
  std::shared_ptr<std::vector<Shown>> shown = std::make_shared<std::vector<Shown>>();
  std::unique_ptr<LinuxDialogController> controller_;
  LinuxWindowDialogs(std::string window_id, std::string profile_identity)
      : controller_(std::make_unique<LinuxDialogController>(std::move(window_id), std::move(profile_identity),
            LinuxDialogPresenter([shown = shown](const LinuxDialogSpec& spec, LinuxDialogResponder respond) {
              shown->push_back({spec, std::move(respond)});
              return std::make_unique<LinuxDialogSurface>();
            }))) {}
  LinuxDialogController& controller() { return *controller_; }
  LinuxDialogSuspension Suspend() { return controller_->Suspend(); }
  bool Resume(const LinuxDialogSuspension& suspension) { return controller_->Resume(suspension); }
  void ParentDestroyed() { controller_->ParentDestroyed(); }
  bool Answer(bool accepted) {
    if (shown->empty()) return false;
    auto respond = std::move(shown->back().respond);
    shown->pop_back();
    std::move(respond).Run({.accepted = accepted});
    return true;
  }
};
}
'''


SUPPORT = r'''
void Own(ShellHostView& host) {
  host.dialogs_ = std::make_unique<LinuxWindowDialogs>(host.window_id_, host.DialogProfile());
}
std::shared_ptr<std::pair<bool, base::Value>> HostInvoke(HostMessageHandler& handler, std::string method, base::ListValue values) {
  base::DictValue payload; payload.Set("args", base::Value(std::move(values)));
  base::DictValue args; args.Set("method", method); args.Set("args", base::Value(std::move(payload)));
  base::ListValue arguments;
  arguments.Append(base::Value("host-id")); arguments.Append(base::Value("host.invoke"));
  arguments.Append(base::Value(std::move(args)));
  const auto before = handler.replies.size();
  handler.Request(arguments);
  if (handler.replies.size() == before) return nullptr;
  auto reply = std::make_shared<std::pair<bool, base::Value>>(handler.replies.back().first, handler.replies.back().second.Clone());
  return reply;
}
base::DictValue DialogRequest(std::string id, base::DictValue options = base::DictValue().Set("title", "Close 2 tabs?")) {
  base::DictValue request;
  request.Set("dialogId", id); request.Set("kind", "confirm"); request.Set("options", std::move(options));
  return request;
}
std::shared_ptr<std::pair<bool, base::Value>> BeginDialog(HostMessageHandler& handler, std::string id) {
  base::ListValue values; values.Append(base::Value(DialogRequest(id)));
  return HostInvoke(handler, "ArdiaShell.beginDialog", std::move(values));
}
std::string Code(const std::shared_ptr<std::pair<bool, base::Value>>& reply) {
  return reply && !reply->first && reply->second.is_dict() && reply->second.GetDict().FindString("code") ? *reply->second.GetDict().FindString("code") : "";
}
std::vector<std::string> Resolved(const HostMessageHandler& handler) {
  std::vector<std::string> ids;
  for (const auto& event : handler.events) {
    const auto& envelope = event.GetDict();
    if (*envelope.FindString("name") == "shell.dialogResolved")
      ids.push_back(*envelope.FindDict("data")->FindString("dialogId"));
  }
  return ids;
}
bool Confirmed(const HostMessageHandler& handler, const std::string& id) {
  for (const auto& event : handler.events) {
    const auto& envelope = event.GetDict();
    if (*envelope.FindString("name") != "shell.dialogResolved") continue;
    const auto& data = *envelope.FindDict("data");
    if (*data.FindString("dialogId") == id) return data.FindDict("result")->Find("confirmed")->GetBool();
  }
  return false;
}
int Named(const HostMessageHandler& handler, std::string_view name) {
  int count = 0;
  for (const auto& event : handler.events) if (*event.GetDict().FindString("name") == name) ++count;
  return count;
}
std::string Identity(HostMessageHandler& handler) {
  auto reply = HostInvoke(handler, "ArdiaShell.windowIdentity", base::ListValue());
  if (!reply || !reply->first) return "";
  return *reply->second.GetDict().FindString("rendererGeneration");
}
base::DictValue CloseRequest(HostMessageHandler& handler, const std::string& window) {
  base::ListValue values; values.Append(base::Value(window));
  auto reply = HostInvoke(handler, "ArdiaShell.requestWindowClose", std::move(values));
  assert(reply && reply->first);
  return reply->second.GetDict().Clone();
}
std::shared_ptr<std::pair<bool, base::Value>> CloseCall(HostMessageHandler& handler, std::string method, const base::DictValue& request) {
  base::ListValue values; values.Append(base::Value(request.Clone()));
  return HostInvoke(handler, std::move(method), std::move(values));
}
const std::string kId = "dialog:0123456789abcdef:";
void Watched(HostMessageHandler& handler) { Send(handler, "watch", WatchRequest()); Drain(); }
'''


MAIN = r'''
int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  (void)Ignore;
  if (mode == "dispatch") {
    ShellHostView host; Own(host); hosts[1] = &host;
    HostMessageHandler a(&host);
    a.ui_ = {&host.frame_, host.shell()};
    assert(Identity(a).empty() && a.replies.empty());
    Activate(host, a, host.frame_);
    const auto first = Identity(a);
    assert(first == std::to_string(a.generation_) && first == std::to_string(host.renderer_generation_));
    content::RenderFrameHost next_frame;
    HostMessageHandler b(&host);
    Activate(host, b, next_frame);
    assert(b.generation_ > a.generation_);
    assert(BeginDialog(a, kId + "1") == nullptr);
    auto begun = BeginDialog(b, kId + "1");
    assert(begun && begun->first);
    assert(begun->second.GetDict().Find("accepted")->GetBool());
    assert(host.dialogs_->shown->size() == 1);
    base::ListValue foreign; foreign.Append(base::Value(DialogRequest(kId + "2", base::DictValue().Set("title", "x").Set("windowId", "main"))));
    assert(Code(HostInvoke(b, "ArdiaShell.beginDialog", std::move(foreign))) == "ERR_DIALOG");
    base::ListValue extra; extra.Append(base::Value(DialogRequest(kId + "3"))); extra.Append(base::Value("more"));
    assert(Code(HostInvoke(b, "ArdiaShell.beginDialog", std::move(extra))) == "ERR_DIALOG");
    assert(Code(HostInvoke(b, "ArdiaShell.beginDialog", base::ListValue())) == "ERR_DIALOG");
    content::RenderFrameHost third_frame;
    HostMessageHandler c(&host);
    Activate(host, c, third_frame);
    assert(host.dialogs_->controller().pending() == 0);
    assert(Resolved(b).empty() && Resolved(c).empty() && Resolved(a).empty());
    assert(BeginDialog(c, kId + "4")->first);
    assert(host.dialogs_->Answer(true));
    assert(Resolved(c) == std::vector<std::string>{kId + "4"} && Confirmed(c, kId + "4"));
    const auto& data = *c.events.back().GetDict().FindDict("data");
    assert(*data.FindString("windowId") == host.window_id_ && *data.FindString("rendererGeneration") == std::to_string(c.generation_));
    assert(BeginDialog(c, kId + "5")->first);
    base::ListValue cancel; cancel.Append(base::Value(kId + "5"));
    assert(HostInvoke(c, "ArdiaShell.cancelDialog", std::move(cancel))->first);
    assert(Resolved(c).back() == kId + "5" && !Confirmed(c, kId + "5"));
    host.handler_ = nullptr;
    assert(Code(HostInvoke(c, "ArdiaShell.beginDialog", base::ListValue())) == "");
  }
  if (mode == "captured-origin") {
    ShellHostView host; Own(host); hosts[1] = &host;
    HostMessageHandler a(&host);
    Activate(host, a, host.frame_);
    assert(BeginDialog(a, kId + "1")->first);
    auto pending = std::move(host.dialogs_->shown->back().respond);
    host.dialogs_->shown->pop_back();
    content::RenderFrameHost next_frame;
    HostMessageHandler b(&host);
    Activate(host, b, next_frame);
    std::move(pending).Run({.accepted = true});
    assert(Resolved(a).empty() && Resolved(b).empty());
    assert(BeginDialog(b, kId + "2")->first);
    b.PrimaryMainFrameRenderProcessGone(0);
    assert(Resolved(b).empty() && host.dialogs_->controller().pending() == 0);
  }
  if (mode == "deliberation") {
    ShellHostView host; Own(host); hosts[1] = &host;
    HostMessageHandler a(&host);
    Activate(host, a, host.frame_); Watched(a);
    const auto request = CloseRequest(a, host.window_id_);
    assert(BeginDialog(a, kId + "1")->first);
    for (int minute = 0; minute < 10; ++minute) { base::SingleThreadTaskRunner::GetCurrentDefault()->Expire(); Drain(); }
    assert(host.close_.phase() == LinuxClose::Phase::kRequested && host.dialogs_->controller().pending() == 1);
    assert(Named(a, "shell.closeCancelled") == 0 && Resolved(a).empty());
    assert(host.dialogs_->Answer(true) && Confirmed(a, kId + "1"));
    auto drain = CloseCall(a, "ArdiaShell.beginWindowCloseDrain", request);
    assert(drain && drain->first && host.close_.phase() == LinuxClose::Phase::kDraining);
    assert(Identity(a).empty() && Code(BeginDialog(a, kId + "2")) == "ERR_DIALOG");
  }
  if (mode == "cancel-late-confirm") {
    ShellHostView host; Own(host); hosts[1] = &host;
    HostMessageHandler a(&host);
    Activate(host, a, host.frame_); Watched(a);
    const auto request = CloseRequest(a, host.window_id_);
    assert(BeginDialog(a, kId + "1")->first);
    CloseCall(a, "ArdiaShell.rejectWindowClose", request);
    Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kCancelled && Named(a, "shell.closeCancelled") == 1);
    assert(host.dialogs_->Answer(true) && Confirmed(a, kId + "1"));
    auto late = CloseCall(a, "ArdiaShell.beginWindowCloseDrain", request);
    assert(Code(late) == "ERR_WINDOW_CLOSE_STALE" && host.close_.phase() == LinuxClose::Phase::kCancelled);
    assert(!Identity(a).empty());
    const auto next = CloseRequest(a, host.window_id_);
    assert(BeginDialog(a, kId + "2")->first);
    assert(CloseCall(a, "ArdiaShell.beginWindowCloseDrain", next)->first);
    assert(Resolved(a).back() == kId + "2" && !Confirmed(a, kId + "2"));
    assert(Identity(a).empty() && host.close_dialogs_.size() == 1 && host.close_dialogs_.begin()->second);
    assert(CloseCall(a, "ArdiaShell.beginWindowCloseDrain", next)->first);
    CloseCall(a, "ArdiaShell.rejectWindowClose", next);
    Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kCancelled && host.close_dialogs_.empty());
    assert(!Identity(a).empty() && BeginDialog(a, kId + "3")->first);
  }
  if (mode == "quit-two-windows") {
    ShellHostView one; one.window_id_ = "main"; Own(one);
    ShellHostView two; two.window_id_ = "window-2"; Own(two);
    hosts[1] = &one; hosts[2] = &two;
    HostMessageHandler a(&one), b(&two);
    Activate(one, a, one.frame_); Activate(two, b, two.frame_); Watched(a); Watched(b);
    assert(BeginDialog(a, kId + "1")->first && BeginDialog(b, kId + "2")->first);
    browser_shutdown::trying_to_quit = true;
    const auto first = CloseRequest(a, "main");
    const auto second = CloseRequest(b, "window-2");
    auto ends = CloseCall(a, "ArdiaShell.beginWindowCloseDrain", first);
    assert(ends->first && ends->second.GetDict().Find("endsSession")->GetBool());
    assert(Resolved(a) == std::vector<std::string>{kId + "1"} && Resolved(b).empty());
    assert(two.dialogs_->controller().pending() == 1 && !Identity(b).empty());
    assert(CloseCall(b, "ArdiaShell.beginWindowCloseDrain", second)->second.GetDict().Find("endsSession")->GetBool());
    assert(Resolved(b) == std::vector<std::string>{kId + "2"});
    browser_shutdown::trying_to_quit = false;
    CloseCall(a, "ArdiaShell.rejectWindowClose", first);
    Drain();
    assert(!Identity(a).empty() && Identity(b).empty());
  }
  if (mode == "parent-close-now") {
    ShellHostView host; Own(host); hosts[1] = &host;
    HostMessageHandler a(&host);
    Activate(host, a, host.frame_); Watched(a);
    assert(BeginDialog(a, kId + "1")->first);
    const auto request = CloseRequest(a, host.window_id_);
    host.dialogs_->ParentDestroyed();
    assert(Resolved(a) == std::vector<std::string>{kId + "1"} && !Confirmed(a, kId + "1"));
    assert(Identity(a).empty() && Code(BeginDialog(a, kId + "2")) == "ERR_DIALOG");
    assert(CloseCall(a, "ArdiaShell.beginWindowCloseDrain", request)->first);
    CloseCall(a, "ArdiaShell.rejectWindowClose", request);
    Drain();
    assert(host.close_.phase() == LinuxClose::Phase::kCancelled && host.close_dialogs_.empty() && Identity(a).empty());
  }
  if (mode == "queue-full") {
    ShellHostView host; Own(host); hosts[1] = &host;
    HostMessageHandler a(&host);
    Activate(host, a, host.frame_); Watched(a);
    for (int n = 0; n < 16; ++n) assert(BeginDialog(a, kId + std::to_string(100 + n))->first);
    assert(Code(BeginDialog(a, kId + "200")) == "ERR_DIALOG");
    const auto request = CloseRequest(a, host.window_id_);
    assert(host.dialogs_->controller().pending() == 16 && host.close_.phase() == LinuxClose::Phase::kRequested);
    assert(CloseCall(a, "ArdiaShell.beginWindowCloseDrain", request)->first);
    assert(host.dialogs_->controller().pending() == 0 && Resolved(a).size() == 16);
    for (int n = 0; n < 16; ++n) assert(!Confirmed(a, kId + std::to_string(100 + n)));
    assert(Code(BeginDialog(a, kId + "201")) == "ERR_DIALOG");
    CloseCall(a, "ArdiaShell.rejectWindowClose", request);
    Drain();
    for (int n = 0; n < 16; ++n) assert(BeginDialog(a, kId + std::to_string(300 + n))->first);
  }
  if (mode == "detach") {
    auto host = std::make_unique<ShellHostView>(); Own(*host); hosts[1] = host.get();
    HostMessageHandler a(host.get());
    Activate(*host, a, host->frame_);
    assert(BeginDialog(a, kId + "1")->first);
    host->DetachBrowser();
    assert(!host->dialogs_ && Resolved(a).empty());
    hosts.clear();
  }
}
'''


def program():
    source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
    header = (ROOT / 'src/ardia/linux/ac_linux_dialogs.h').read_text()
    header = re.sub(r'^#(include|ifndef|define|endif).*$', '', header, flags=re.M)
    controller = (ROOT / 'src/ardia/linux/ac_linux_dialogs.cc').read_text()
    controller = re.sub(r'^#include.*$', '', controller, flags=re.M)
    text = fixture()
    assert text.count(DIALOGS) == 1
    text = text.replace(DIALOGS, BASE + header + OWNER)
    text = text.replace('  std::unique_ptr<LinuxWindowDialogs> dialogs_ = std::make_unique<LinuxWindowDialogs>();', '  std::unique_ptr<LinuxWindowDialogs> dialogs_;')
    text = text.replace('  std::vector<std::pair<bool, base::Value>> replies;', '  std::vector<std::pair<bool, base::Value>> replies;\n  std::vector<base::Value> events;')
    text = text.replace('    host_->events.emplace_back(first.GetString(), second.GetString(), third.Clone());',
                        '    { events.push_back(third.Clone()); if (host_) host_->events.emplace_back(first.GetString(), second.GetString(), third.Clone()); }')
    production_invoke = source[source.index('    if (arguments[1].GetString() != "host.invoke") {'):source.index('  base::WeakPtr<ShellHostView> host_;\n  uint64_t generation_ = 0;')]
    production_invoke = production_invoke.replace('host_->Invoke(', 'host_->CloseInvoke(').rstrip()
    assert production_invoke.endswith('}')
    production_invoke = production_invoke[:-1]
    route = '    if (arguments[1].GetString() == "host.invoke") {\n' + production_invoke.replace('    if (arguments[1].GetString() != "host.invoke") {\n      return Reply(id, false, base::Value("Unknown native transport operation"));\n    }\n', '') + '    }\n'
    assert text.count('    if (arguments[1].GetString() == "identity") {') == 1
    text = text.replace('    if (arguments[1].GetString() == "identity") {', route + '    if (arguments[1].GetString() == "identity") {')
    identity = method(source, '  if (method == "ArdiaShell.windowIdentity")')
    branches = '\n'.join(method(source, signature) for signature in [
        '  if (method == "ArdiaShell.beginDialog" || method == "ArdiaShell.cancelDialog")',
        '  if (method == "ArdiaShell.requestWindowClose")',
        '  if (method == "ArdiaShell.beginWindowCloseDrain")',
        '  if (method == "ArdiaShell.acknowledgeWindowClose" || method == "ArdiaShell.rejectWindowClose")'])
    assert text.count(identity) == 1
    text = text.replace(identity, identity + '\n' + branches)
    return text + controller + SUPPORT + MAIN


class DialogDispatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            raise unittest.SkipTest('C++ compiler is unavailable')
        cls.scratch = tempfile.TemporaryDirectory(prefix='ardia-dialog-dispatch-')
        root = Path(cls.scratch.name)
        (root / 'base/json').mkdir(parents=True)
        patched = values().replace('  Value* Set(std::string_view key, Value&& value) & {',
            '  Value* Set(std::string_view key, const char* value) & { return Set(key, Value(value)); }\n'
            '  Value* Set(std::string_view key, bool value) & { return Set(key, Value(value)); }\n'
            '  Value* Set(std::string_view key, Value&& value) & {')
        (root / 'base/values.h').write_text(patched)
        (root / 'base/json/json_writer.h').write_text(WRITER)
        (root / 'main.cc').write_text(program())
        cls.binary = root / 'dispatch'
        result = subprocess.run([compiler, '-std=c++23', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-Wno-missing-field-initializers',
                                 '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(root), '-I', str(ROOT / 'src'),
                                 *[str(ROOT / 'src/ardia/linux' / source) for source in SOURCES], str(root / 'main.cc'), '-o', str(cls.binary)],
                                capture_output=True, text=True, timeout=180)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def run_mode(self, mode):
        result = subprocess.run([str(self.binary), mode], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_production_dispatch_authenticates_and_replaces_query_to_begin(self):
        self.run_mode('dispatch')

    def test_results_reach_only_the_captured_still_authorized_origin(self):
        self.run_mode('captured-origin')

    def test_warning_decision_longer_than_thirty_seconds_stays_open(self):
        self.run_mode('deliberation')

    def test_native_cancel_then_late_confirm_cannot_drain_and_resumes_only_its_token(self):
        self.run_mode('cancel-late-confirm')

    def test_two_windows_each_with_a_dialog_during_quit_suspend_independently(self):
        self.run_mode('quit-two-windows')

    def test_parent_close_now_force_cancels_and_close_still_proceeds(self):
        self.run_mode('parent-close-now')

    def test_full_dialog_queue_is_cancelled_by_close_and_restored_after_cancellation(self):
        self.run_mode('queue-full')

    def test_detach_drops_dialogs_without_delivery(self):
        self.run_mode('detach')


if __name__ == '__main__':
    unittest.main()
