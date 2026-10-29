from document_host_fixture import ROOT, PRELUDE, HANDLER, host_methods
from test_renderer_contract import method


def fixture():
    source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
    renderer = (ROOT / 'tests/fixtures/renderer.h').read_text()
    types = renderer[renderer.index('struct GURL {'):renderer.index('namespace base {')]
    types += renderer[renderer.index('namespace content {'):renderer.index('std::string String(')]
    types += r'''
namespace content {
struct BrowserThread { enum { UI }; static bool CurrentlyOn(int) { return true; } };
}
#define CHECK(value) assert(value)
namespace base {
using TerminationStatus = int;
template<class F, class... A> int BindRepeating(F, A...) { return 0; }
template<class T> T* Unretained(T* value) { return value; }
std::optional<std::string> WriteJson(ValueView value) { return WriteJsonWithOptions(value, 2); }
}
struct TabStripModelObserver { static void StopObservingAll(void*) {} };
struct HostMessageHandler {
  base::WeakPtr<ShellHostView> host_;
  uint64_t generation_ = 0;
  bool allowed = false;
  content::WebUI ui_;
  struct Factory {
    HostMessageHandler* owner;
    std::shared_ptr<bool> alive = std::make_shared<bool>(true);
    ~Factory() { *alive = false; }
    base::WeakPtr<HostMessageHandler> GetWeakPtr() { return {owner, alive}; }
    void InvalidateWeakPtrs() { *alive = false; alive = std::make_shared<bool>(true); }
  } weak_factory_{this};
  std::vector<std::pair<bool, base::Value>> replies;
  explicit HostMessageHandler(ShellHostView*);
  ~HostMessageHandler();
  content::WebUI* web_ui() { return &ui_; }
  bool IsJavascriptAllowed() { return allowed; }
  void AllowJavascript() { allowed = true; }
  bool Authorized();
  base::WeakPtr<HostMessageHandler> GetWeakPtr();
  void RegisterMessages();
  void ActivateCommittedRenderer();
  void PrimaryPageChanged(content::Page&);
  void PrimaryMainFrameRenderProcessGone(base::TerminationStatus);
  void OnJavascriptDisallowed();
  void SendEvent(std::string_view, std::string_view, const base::Value&);
  void Reply(std::string, bool, base::Value);
  void Resolve(const std::string&, base::Value);
  void Fail(const std::string&, std::string_view, std::string_view);
  void Request(const base::ListValue&);
  void CallJavascriptFunction(const char*, const base::Value&, const base::Value&, const base::Value&);
};
struct FocusManager { void set_shortcut_handling_suspended(bool) {} };
struct TabBinding {
  int page_command_resets = 0;
  void ResetPageCommands() { ++page_command_resets; }
  bool temporary = false;
  bool live = true;
  bool transferable = false;
  std::string claim;
  uint64_t renderer_generation = 0;
  int retired_pages = 0;
  void RetirePage() { ++retired_pages; }
  TabBinding* contents() { return live ? this : nullptr; }
};
'''
    prelude = PRELUDE.replace('#include "ardia/linux/ac_linux_document_service.h"', '#include "ardia/linux/ac_linux_document_service.h"\n#include "base/json/json_writer.h"')
    prelude = prelude.replace(HANDLER, types)
    prelude = prelude.replace('  bool OwnsHandler(Handler* owner, uint64_t generation) const { return owner && owner == handler_ && generation == renderer_generation_; }\n', '')
    prelude = prelude.replace('  Handler handler;\n  Handler* handler_ = &handler;', '  HostMessageHandler* handler_ = nullptr;')
    prelude = prelude.replace('  uint64_t renderer_generation_ = 9007199254740993ULL;', r'''  uint64_t renderer_generation_ = 0;
  content::WeakDocumentPtr renderer_document_;
  content::RenderFrameHost frame_;
  content::WebContents contents_{&frame_};
  content::WebContents* shell() const { return const_cast<content::WebContents*>(&contents_); }
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  bool switcher_capture_ = false;
  std::unique_ptr<int> switcher_source_;
  FocusManager* focus_manager_ = nullptr;
  bool shortcut_recording_ = false;
  void DetachViewports() {}
  void ReleaseDragEscape() {}
  TabBinding* Binding(int id) { return bindings_.contains(id) ? bindings_[id].get() : nullptr; }
  bool DisposeTemporary(TabBinding* binding) { binding->live = false; return true; }
  bool Trusted(content::WebUI*) const;
  void DetachBrowser();
  void UnregisterAccelerators() {}
  struct Factory {
    ShellHostView* owner;
    void InvalidateWeakPtrs() { *owner->alive = false; owner->alive = std::make_shared<bool>(true); }
  } weak_factory_{this};
  struct ViewObservation { void Reset() {} } view_observation_;
  int id_ = 0;
  ARDIA_LIFECYCLE''')
    prelude = prelude.replace('  void Replace() { RetireDocuments(); ++renderer_generation_; document_window_ = "replacement"; }', '')
    event_start = prelude.index('  void Event(std::string_view module,')
    event_end = prelude.index('\n  LinuxDocumentClient DocumentClient()', event_start)
    prelude = prelude[:event_start] + '  void Event(std::string_view, std::string_view, base::Value);\n' + prelude[event_end:]
    lifecycle = '\n'.join(method(source, signature) for signature in ['  uint64_t SetHandler(', '  bool OwnsHandler(', '  bool ClearHandler(', '  void RetireRenderer()'])
    lifecycle = '  std::string LiveCaller() const { return std::to_string(id_); }\n' + lifecycle
    prelude = prelude.replace('ARDIA_LIFECYCLE', lifecycle)
    prelude = prelude.replace('struct ShellHostView {', 'inline void LinuxLiveCallerGone(const std::string&) {}\nstruct ShellHostView {', 1)
    handlers = []
    handler_source = source[source.index('class HostMessageHandler :'):]
    for name, signature in [
        ('~HostMessageHandler', '  ~HostMessageHandler('),
        ('Authorized', '  bool Authorized('),
        ('GetWeakPtr', '  base::WeakPtr<HostMessageHandler> GetWeakPtr('),
        ('RegisterMessages', '  void RegisterMessages('),
        ('ActivateCommittedRenderer', '  void ActivateCommittedRenderer('),
        ('PrimaryPageChanged', '  void PrimaryPageChanged('),
        ('PrimaryMainFrameRenderProcessGone', '  void PrimaryMainFrameRenderProcessGone('),
        ('OnJavascriptDisallowed', '  void OnJavascriptDisallowed('),
        ('SendEvent', '  void SendEvent('),
        ('Reply', '  void Reply('),
        ('Resolve', '  void Resolve('),
        ('Fail', '  void Fail('),
    ]:
        native = method(handler_source, signature).strip().replace(' override', '')
        handlers.append(native.replace(name + '(', 'HostMessageHandler::' + name + '(', 1))
    request = method(handler_source, '  void Request(')
    prefix = request[:request.index('    if (arguments[1].GetString() == "engine.call")')]
    prefix = prefix.replace('void Request(', 'void HostMessageHandler::Request(', 1)
    document_branch = method(request, '      if (name.starts_with("documents.")) {')
    prefix += r'''
    if (arguments[1].GetString() == "identity") {
      return host_->CloseInvoke("ArdiaShell.windowIdentity", args,
          base::BindOnce(&HostMessageHandler::Reply, weak_factory_.GetWeakPtr(), id));
    }
    if (arguments[1].GetString() == "drain") {
      return host_->BeginWindowCloseDrain(args, base::BindOnce(&HostMessageHandler::Reply,
          weak_factory_.GetWeakPtr(), id));
    }
    if (arguments[1].GetString() == "ack") {
      return host_->AcknowledgeWindowClose(args, base::BindOnce(&HostMessageHandler::Reply,
          weak_factory_.GetWeakPtr(), id));
    }
    const std::string name = String(args, "name");
    const auto& input = *args.FindDict("request");
''' + document_branch + '\n}\n'
    support = r'''
HostMessageHandler::HostMessageHandler(ShellHostView* host) : host_(host->GetWeakPtr()) {}
void HostMessageHandler::CallJavascriptFunction(
    const char* function, const base::Value& first, const base::Value& second,
    const base::Value& third) {
  if (std::string_view(function) == "__ardiaEvent")
    host_->events.emplace_back(first.GetString(), second.GetString(), third.Clone());
  else replies.emplace_back(second.GetBool(), third.Clone());
}
void Activate(ShellHostView& host, HostMessageHandler& handler, content::RenderFrameHost& frame) {
  handler.ui_ = {&frame, host.shell()};
  frame.NewDocument(handler.web_ui());
  host.contents_.primary = &frame;
  content::Page page{&frame};
  handler.PrimaryPageChanged(page);
  handler.AllowJavascript();
}
void Send(HostMessageHandler& handler, std::string verb, base::DictValue request) {
  base::DictValue input;
  input.Set("name", "documents." + verb);
  input.Set("request", std::move(request));
  base::ListValue arguments;
  arguments.Append(base::Value("request-id")); arguments.Append(base::Value("engine.call"));
  arguments.Append(base::Value(std::move(input)));
  handler.Request(arguments);
}
void QueryIdentity(HostMessageHandler& handler) {
  base::DictValue request; request.Set("args", base::Value(base::ListValue()));
  base::ListValue arguments;
  arguments.Append(base::Value("identity-id")); arguments.Append(base::Value("identity"));
  arguments.Append(base::Value(std::move(request)));
  handler.Request(arguments);
}
void SendAck(HostMessageHandler& handler, const base::DictValue& identity, int watermark) {
  base::ListValue drain;
  drain.Append(base::Value("drain-id")); drain.Append(base::Value("drain"));
  drain.Append(base::Value(identity.Clone()));
  handler.Request(drain);
  base::ListValue arguments;
  arguments.Append(base::Value("ack-id")); arguments.Append(base::Value("ack"));
  arguments.Append(base::Value(Ack(identity, watermark)));
  handler.Request(arguments);
}
'''
    return prelude + support + '\n'.join(handlers) + prefix + method(source, 'bool ShellHostView::Trusted(') + method(source, 'void ShellHostView::Event(') + host_methods() + method(source, 'void ShellHostView::DetachBrowser(') + r'''
void ShellHostView::CloseInvoke(std::string method, const base::DictValue& args,
                                base::OnceCallback<void(bool, base::Value)> done) {
  const base::ListValue empty;
  const auto* supplied = args.Find("args");
  const auto& values = supplied && supplied->is_list() ? supplied->GetList() : empty;
''' + method(source, '  if (method == "ArdiaShell.windowIdentity")') + '\n}\n'
