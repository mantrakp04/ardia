from pathlib import Path

from test_session_merge import VALUES, WRITER
from test_renderer_contract import method

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ['ac_linux_documents.cc', 'ac_linux_document_schema.cc', 'ac_linux_document_reducer.cc', 'ac_linux_document_service.cc', 'ac_linux_profiles.cc']


def values():
    return VALUES.replace('#include <map>', '#include <map>\n#include <optional>').replace('  size_t size() const { return entries_.size(); }', '''  size_t size() const { return entries_.size(); }
  bool empty() const { return entries_.empty(); }''').replace('  const DictValue* FindDict', '''  std::optional<int> FindInt(std::string_view key) const {
    auto* value = Find(key); return value && value->is_int() ? std::optional(value->GetInt()) : std::nullopt;
  }
  const ListValue* FindList(std::string_view key) const {
    auto* value = Find(key); return value && value->is_list() ? &value->GetList() : nullptr;
  }
  const DictValue* FindDict''')


REPEATING = r'''template<class Signature> class RepeatingCallback;
template<class R, class... Args> class RepeatingCallback<R(Args...)> {
  std::function<R(Args...)> callback_;
 public:
  RepeatingCallback() = default;
  RepeatingCallback(const RepeatingCallback&) = default;
  RepeatingCallback(RepeatingCallback&&) = default;
  RepeatingCallback& operator=(const RepeatingCallback&) = default;
  RepeatingCallback& operator=(RepeatingCallback&&) = default;
  template<class F> requires (!std::is_same_v<std::decay_t<F>, RepeatingCallback>)
  RepeatingCallback(F&& callback) : callback_(std::forward<F>(callback)) {}
  explicit operator bool() const { return bool(callback_); }
  bool is_null() const { return !callback_; }
  R Run(Args... args) const { return callback_(std::move(args)...); }
};
template<class F, class... Args> auto BindRepeating(F function, Args... args) {
  return [function, args...](auto&&... rest) { return std::invoke(function, args..., std::forward<decltype(rest)>(rest)...); };
}
'''
COMPANIONS_ACCEPT = 'void ShellHostView::ConfirmCompanions(base::OnceCallback<void(bool)> done) { std::move(done).Run(true); }\n'


def host_methods(real_companions=True):
    source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
    signatures = ['LinuxDocumentClient ShellHostView::DocumentClient', 'bool ShellHostView::EnsureDocumentClient', 'bool ShellHostView::RetireDocuments', 'void ShellHostView::DocumentCall', 'std::optional<ShellHostView::StorageTicket> ShellHostView::BeginStorageIntent', 'void ShellHostView::CompleteStorageIntent', 'bool ShellHostView::TrackStorageWrite', 'void ShellHostView::CloseNativeWindow', 'void ShellHostView::ArmWindowClose', 'base::DictValue ShellHostView::RequestWindowClose', 'void ShellHostView::BeginWindowCloseDrain', 'bool ShellHostView::AwaitingChromeHandoff', 'bool ShellHostView::ClosingEndsSession', 'std::string ShellHostView::DialogProfile', 'std::optional<LinuxDialogClient> ShellHostView::DialogClient', 'void ShellHostView::DialogInvoke', 'void ShellHostView::SuspendDialogsForClose', 'void ShellHostView::CommitWindowDeparture', 'void ShellHostView::ResumeDialogsForClose', 'void ShellHostView::RequestUtilityClose', 'bool ShellHostView::ReadyForChromeClose', 'LinuxCloseAdmission ShellHostView::AdmitChromeTeardown', 'void ShellHostView::ReplyChromeClose', 'void ShellHostView::FinishChromePreparations', 'bool ShellHostView::DeferChromeClose', 'void ShellHostView::ChromeCloseCancelled', 'void ShellHostView::CancelWindowClose', 'void ShellHostView::CancelDocumentSeal', 'void ShellHostView::AcknowledgeWindowClose', 'void ShellHostView::ConfirmCompanions', 'void ShellHostView::OnWidgetClosing', 'void ShellHostView::OnWidgetDestroying']
    if not real_companions:
        signatures.remove('void ShellHostView::ConfirmCompanions')
    methods = '\n'.join(method(source, signature) for signature in signatures)
    return methods if real_companions else methods + '\n' + COMPANIONS_ACCEPT


PROFILE = r'''struct Profile { bool regular = true; bool IsRegularProfile() const { return regular; } };'''
HANDLER = r'''struct Handler { bool authorized = true; bool Authorized() { return authorized; } std::shared_ptr<bool> alive = std::make_shared<bool>(true); ~Handler() { *alive = false; } base::WeakPtr<Handler> GetWeakPtr() { return {this, alive}; } std::vector<base::Value> sent; void SendEvent(std::string_view, std::string_view, const base::Value& payload) { sent.push_back(payload.Clone()); } };
using HostMessageHandler = Handler;'''
DIALOGS = r'''namespace ardia {
struct LinuxDialogClient { std::string window_id; std::string profile_identity; std::string renderer_generation; bool authenticated_shell = false; bool default_regular_profile = false; };
class LinuxDialogSuspension { public: uint64_t value = 0; explicit operator bool() const { return value != 0; } bool operator==(const LinuxDialogSuspension&) const = default; };
struct LinuxDialogController {
  static constexpr size_t kMaxSuspensions = 64;
  std::string generation;
  std::set<uint64_t> suspensions;
  bool exhausted = false;
  std::vector<std::string> retired;
  bool ReplaceRenderer(const std::string& value) { generation = value; return true; }
  void RetireRenderer(const std::string& value) { if (value == generation) { retired.push_back(value); generation.clear(); } }
  bool Identify(const LinuxDialogClient& client, base::DictValue* identity) const {
    if (exhausted || !suspensions.empty() || (!generation.empty() && client.renderer_generation != generation) || !client.authenticated_shell || !client.default_regular_profile) return false;
    identity->Set("windowId", client.window_id); identity->Set("rendererGeneration", client.renderer_generation); return true;
  }
  bool Begin(const LinuxDialogClient&, const base::DictValue&, base::OnceCallback<void(base::DictValue)>, std::string* error) { *error = "Unavailable"; return false; }
  bool Cancel(const LinuxDialogClient&, const std::string&) { return false; }
};
struct LinuxWindowDialogs {
  LinuxDialogController controller_;
  uint64_t next = 0;
  LinuxDialogController& controller() { return controller_; }
  LinuxDialogSuspension Suspend() {
    LinuxDialogSuspension token;
    if (controller_.suspensions.size() >= LinuxDialogController::kMaxSuspensions) { controller_.exhausted = true; return token; }
    token.value = ++next; controller_.suspensions.insert(token.value); return token;
  }
  bool Resume(const LinuxDialogSuspension& token) { return token && controller_.suspensions.erase(token.value) == 1; }
};
}'''


TEMPLATE = r'''
#include <algorithm>
#include <cassert>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <vector>
#include "ardia/linux/ac_linux_document_service.h"
#include "base/json/json_writer.h"
#include "ardia/linux/ac_linux_close.h"
using namespace ardia;
#define FROM_HERE 0
namespace base {
struct UnguessableToken {
  uint64_t value = 0;
  static inline uint64_t next = 0;
  static UnguessableToken Create() { return {++next}; }
  bool is_empty() const { return value == 0; }
  bool operator==(const UnguessableToken&) const = default;
};
template<class Signature> class OnceCallback;
template<class R, class... Args> class OnceCallback<R(Args...)> {
  std::move_only_function<R(Args...)> callback_;
 public:
  OnceCallback() = default;
  template<class F> OnceCallback(F&& callback) : callback_(std::forward<F>(callback)) {}
  OnceCallback(OnceCallback&&) = default;
  OnceCallback& operator=(OnceCallback&&) = default;
  explicit operator bool() const { return bool(callback_); }
  R Run(Args... args) { auto callback = std::move(callback_); return callback(std::move(args)...); }
};
template<class T> struct WeakPtr {
  T* pointer;
  std::shared_ptr<bool> alive;
  explicit operator bool() const { return pointer && alive && *alive; }
  T* operator->() const { assert(bool(*this)); return pointer; }
  T* get() const { return bool(*this) ? pointer : nullptr; }
  void reset() { pointer = nullptr; alive.reset(); }
  T& operator*() const { return *operator->(); }
};
ARDIA_REPEATINGtemplate<class F, class... Args> auto BindOnce(F function, Args... args) {
  return [function = std::move(function), ...args = std::move(args)](auto&&... rest) mutable {
    if constexpr (requires { std::move(function).Run(std::move(args)..., std::forward<decltype(rest)>(rest)...); })
      return std::move(function).Run(std::move(args)..., std::forward<decltype(rest)>(rest)...);
    else return std::invoke(function, std::move(args)..., std::forward<decltype(rest)>(rest)...);
  };
}
struct SingleThreadTaskRunner {
  std::deque<OnceCallback<void()>> tasks;
  std::deque<OnceCallback<void()>> timers;
  static SingleThreadTaskRunner* GetCurrentDefault() {
    static SingleThreadTaskRunner runner;
    return &runner;
  }
  void PostTask(int, OnceCallback<void()> task) { tasks.push_back(std::move(task)); }
  void PostDelayedTask(int, OnceCallback<void()> task, int) { timers.push_back(std::move(task)); }
  void One() { auto task = std::move(tasks.front()); tasks.pop_front(); std::move(task).Run(); }
  void Drain() { while (!tasks.empty()) One(); }
  void Expire() { auto batch = std::move(timers); timers.clear(); for (auto& timer : batch) std::move(timer).Run(); }
};
int Seconds(int n) { return n; }
std::string NumberToString(uint64_t n) { return std::to_string(n); }
}
namespace browser_shutdown {
inline bool trying_to_quit = false;
inline bool IsTryingToQuit() { return trying_to_quit; }
}
base::SingleThreadTaskRunner files;
void Drain() {
  auto* ui = base::SingleThreadTaskRunner::GetCurrentDefault();
  while (!files.tasks.empty() || !ui->tasks.empty()) { files.Drain(); ui->Drain(); }
}
template<class R, class... Params> struct AsyncCall {
  using Method = R(LinuxDocumentService::*)(Params...);
  std::shared_ptr<LinuxDocumentService> service;
  Method method;
  template<class Tuple> struct Work {
    std::shared_ptr<LinuxDocumentService> service;
    Method method;
    Tuple args;
    bool posted = false;
    ~Work() {
      if constexpr (std::is_void_v<R>) {
        if (!posted) files.PostTask(0, [service = service, method = method, args = std::move(args)]() mutable {
          std::apply([&](auto&&... args) { std::invoke(method, service.get(), std::move(args)...); }, args);
        });
      } else assert(posted);
    }
    template<class Reply> void Then(Reply reply) {
      posted = true;
      files.PostTask(0, [service = service, method = method, args = std::move(args), reply = std::move(reply)]() mutable {
        auto result = std::apply([&](auto&&... args) { return std::invoke(method, service.get(), std::move(args)...); }, args);
        base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(0,
            [reply = std::move(reply), result = std::move(result)]() mutable {
              if constexpr (requires { std::move(reply).Run(std::move(result)); }) std::move(reply).Run(std::move(result));
              else reply(std::move(result));
            });
      });
    }
  };
  template<class... Args> auto WithArgs(Args... args) {
    return Work<std::tuple<Args...>>{service, method, std::tuple(std::move(args)...)};
  }
};
struct BoundService {
  std::shared_ptr<LinuxDocumentService> value;
  template<class R, class... Params> auto AsyncCall(R(LinuxDocumentService::*method)(Params...)) {
    return ::AsyncCall<R, Params...>{value, method};
  }
};
struct DocumentAuthority {
  std::string scope = "native-scope";
  std::optional<base::DictValue> disk;
  bool fail = false;
  bool read_error = false;
  int reads = 0;
  int writes = 0;
  BoundService service;
  DocumentAuthority() {
    service.value = std::make_shared<LinuxDocumentService>(scope, "epoch",
        [this](std::string_view name) {
          ++reads;
          LinuxDocumentRead result;
          if (read_error) { result.state = LinuxDocumentRead::State::kError; return result; }
          if (name == kLinuxLiveEnvelope && disk) {
            result.state = LinuxDocumentRead::State::kFound;
            result.value = disk->Clone();
          }
          return result;
        }, [this](const base::DictValue& value) {
          if (fail) return false;
          ++writes; disk = value.Clone(); return true;
        });
  }
};
struct ShellHostView;
namespace views {
struct Widget {
  enum class ClosedReason { kUnspecified, kWindowButton, kCompositor, kKeyboard, kQuit };
  std::shared_ptr<bool> alive = std::make_shared<bool>(true);
  base::OnceCallback<void(ClosedReason)> close;
  bool armed = false;
  bool closed = false;
  bool veto = false;
  ShellHostView* owner = nullptr;
  bool IsClosed() const { return closed; }
  base::WeakPtr<Widget> GetWeakPtr() { return {this, alive}; }
  void MakeCloseSynchronous(base::OnceCallback<void(ClosedReason)> callback) { armed = bool(callback); close = std::move(callback); }
  void CloseWithReason(ClosedReason reason);
  void Close() { CloseWithReason(ClosedReason::kUnspecified); }
};
}
struct Browser {
  std::shared_ptr<bool> alive = std::make_shared<bool>(true);
  ~Browser() { *alive = false; }
  base::WeakPtr<Browser> GetWeakPtr() { return {this, alive}; }
  bool registered = true;
  bool cancel_confirmed = true;
  int discard_requests = 0;
  base::UnguessableToken bound;
  std::function<void(base::UnguessableToken)> on_cancel;
  views::Widget widget;
  views::Widget* GetWindow() { return &widget; }
  struct Strip {
    int tabs = 0;
    int count() const { return tabs; }
  } strip;
  Strip* GetTabStripModel() { return &strip; }
  struct Unload {
    enum class State { kIdle, kRunning, kConfirmed };
    int resets = 0;
    int prompts = 0;
    bool handlers = false;
    State state = State::kIdle;
    std::function<void(bool)> confirmed;
    template<class Confirmed> bool RunBeforeUnloadForShutdown(bool, const Confirmed& on_close_confirmed) {
      if (!handlers || state != State::kIdle) return false;
      confirmed = on_close_confirmed;
      state = State::kRunning;
      ++prompts;
      return true;
    }
    void Answer(bool proceed) {
      assert(state == State::kRunning);
      if (proceed) {
        state = State::kConfirmed;
        auto callback = confirmed;
        callback(true);
        return;
      }
      Cancel();
    }
    void Cancel() {
      auto callback = std::move(confirmed);
      confirmed = {};
      state = State::kIdle;
      callback(false);
    }
    void ResetBeforeUnloadForShutdown() {
      ++resets;
      if (state != State::kIdle) Cancel();
    }
  } unload;
};
using BrowserWindowInterface = Browser;
struct UnloadController {
  static Browser::Unload* From(Browser* browser) { return &browser->unload; }
};
namespace ardia {
enum class LinuxCloseStage { kPrepare, kBeginTeardown, kDestroy };
enum class LinuxCloseAdmission { kRejected, kRetryPreflight, kCommitted };
inline bool BindLinuxCloseAttempt(Browser* browser, const base::UnguessableToken& token) {
  if (!browser || !browser->registered || (!browser->bound.is_empty() && browser->bound != token)) return false;
  browser->bound = token; return true;
}
inline base::UnguessableToken CurrentLinuxCloseToken(Browser* browser) {
  return browser ? browser->bound : base::UnguessableToken();
}
inline LinuxCloseAdmission CommitLinuxCloseTeardown(Browser* browser,
    const base::UnguessableToken& token, LinuxCloseStage stage, base::OnceCallback<bool()> native_commit) {
  if (stage == LinuxCloseStage::kPrepare || !browser || browser->bound != token || !browser->registered) return LinuxCloseAdmission::kRejected;
  return std::move(native_commit).Run() ? LinuxCloseAdmission::kCommitted : LinuxCloseAdmission::kRejected;
}
inline bool CancelLinuxCloseAttempt(Browser* browser, const base::UnguessableToken& token) {
  if (!browser || browser->bound != token) return false;
  ++browser->discard_requests;
  if (!browser->registered || !browser->cancel_confirmed) return false;
  browser->bound = {};
  if (browser->on_cancel) browser->on_cancel(token);
  return true;
}
}
ARDIA_PROFILE
ARDIA_HANDLER
ARDIA_DIALOGS
#include "ardia/linux/ac_linux_profiles.h"
struct ShellHostView {
  Browser native;
  std::vector<base::WeakPtr<BrowserWindowInterface>> companions_;
  std::vector<std::shared_ptr<void>> confirmation_steps_;
  void ConfirmCompanions(base::OnceCallback<void(bool)> done);
  std::string page_profile_;
  int reach_id_ = 0;
  int opener_host_ = 0;
  uint64_t opener_generation_ = 0;
  Browser* browser_ = &native;
  void* browser_view_ = this;
  Handler handler;
  Handler* handler_ = &handler;
  Profile native_profile;
  Profile* shared_profile = nullptr;
  Profile* profile() const { return browser_ ? (shared_profile ? shared_profile : const_cast<Profile*>(&native_profile)) : nullptr; }
  std::shared_ptr<bool> alive = std::make_shared<bool>(true);
  uint64_t renderer_generation_ = 9007199254740993ULL;
  std::shared_ptr<DocumentAuthority> documents_ = std::make_shared<DocumentAuthority>();
  std::string document_window_ = "native-window";
  LinuxDocumentClient document_client_;
  uint64_t document_client_generation_ = 0;
  uint64_t document_subscription_ = 0;
  bool document_watched_ = false;
  bool document_used_ = false;
  struct StorageIntent {
    std::string name;
    base::DictValue operation;
    size_t bytes;
    size_t pending = 0;
    uint64_t failure = 0;
  };
  struct StorageTicket {
    std::shared_ptr<StorageIntent> intent;
    uint64_t sequence;
  };
  std::vector<std::shared_ptr<StorageIntent>> storage_intents_;
  size_t storage_bytes_ = 0;
  size_t storage_pending_bytes_ = 0;
  uint64_t storage_sequence_ = 0;
  size_t storage_pending_ = 0;
  std::set<std::string> storage_failures_;
  LinuxClose close_;
  std::unique_ptr<LinuxWindowDialogs> dialogs_ = std::make_unique<LinuxWindowDialogs>();
  std::map<std::string, LinuxDialogSuspension> close_dialogs_;
  std::optional<std::pair<std::string, base::DictValue>> close_departure_;
  static inline std::vector<std::pair<std::string, base::DictValue>> departures;
  static void PersistWindowDeparture(Profile*, std::string source_window, base::DictValue departure) {
    departures.emplace_back(std::move(source_window), std::move(departure));
  }
  void CommitWindowDeparture(const std::string&);
  bool OwnsHandler(Handler* owner, uint64_t generation) const { return owner && owner == handler_ && generation == renderer_generation_; }
  std::optional<base::UnguessableToken> chrome_close_token_;
  LinuxDocumentClient close_client_;
  base::WeakPtr<BrowserWindowInterface> close_browser_{};
  base::WeakPtr<views::Widget> close_widget_{};
  std::string close_window_;
  bool close_cancel_running_ = false;
  std::vector<std::pair<LinuxCloseStage, base::OnceCallback<void(bool)>>> close_preparations_;
  std::vector<base::OnceCallback<void(bool, base::Value)>> close_cancellations_;
  struct PendingDocumentWatch {
    uint64_t generation;
    uint64_t subscription;
    base::DictValue request;
    base::OnceCallback<void(LinuxDocumentResult)> done;
  };
  std::vector<PendingDocumentWatch> pending_document_watches_;
  std::optional<std::pair<std::string, std::string>> close_error_;
  std::vector<base::OnceCallback<void(bool, base::Value)>> close_replies_;
  bool utility_ready_ = true;
  bool utility_close_pending_ = false;
  std::string window_id_ = "settings";
  std::string kind_;
  bool is_utility() const { return !kind_.empty(); }
  struct Observation { void Reset() {} } close_observation_, pane_focus_observation_;
  std::vector<std::tuple<std::string, std::string, base::Value>> events;
  ShellHostView() {
    native.widget.owner = this;
    native.on_cancel = [this](base::UnguessableToken token) { ChromeCloseCancelled(token); };
  }
  ~ShellHostView() { *alive = false; }
  const std::string& window_id() const { return window_id_; }
  ardiacore::linux_profiles::WindowAccess access() const { return {window_id_, page_profile_, reach_id_, opener_host_, opener_generation_}; }
  bool Reaches(const ShellHostView* target) const {
    return target && ardiacore::linux_profiles::WindowReachableBy(target->access(), {reach_id_, renderer_generation_});
  }
  void GenericInvoke(std::string, const base::DictValue&, base::OnceCallback<void(bool, base::Value)>);
  void CloseInvoke(std::string, const base::DictValue&, base::OnceCallback<void(bool, base::Value)>);
  Browser* browser() { return browser_; }
  views::Widget* GetWidget() const { return const_cast<views::Widget*>(&native.widget); }
  base::WeakPtr<ShellHostView> GetWeakPtr() { return {this, alive}; }
  void Event(std::string_view module, std::string_view channel, base::Value value) {
    if (handler_ && handler_->Authorized()) events.emplace_back(module, channel, std::move(value));
  }
  void Replace() { RetireDocuments(); ++renderer_generation_; document_window_ = "replacement"; }
  LinuxDocumentClient DocumentClient() const;
  bool EnsureDocumentClient();
  bool RetireDocuments();
  std::optional<StorageTicket> BeginStorageIntent(std::string, base::DictValue);
  void CompleteStorageIntent(const StorageTicket&, bool, bool);
  bool TrackStorageWrite(std::string, base::DictValue, base::OnceCallback<void(bool, base::Value)>&);
  void DocumentCall(std::string, base::DictValue, base::OnceCallback<void(LinuxDocumentResult)>);
  void ArmWindowClose();
  void CloseNativeWindow(LinuxClose::Identity);
  bool ReadyForChromeClose(const LinuxClose::Identity&) const;
  LinuxCloseAdmission AdmitChromeTeardown(LinuxClose::Identity, base::UnguessableToken, LinuxCloseStage);
  void ReplyChromeClose(LinuxCloseStage, LinuxClose::Identity, base::UnguessableToken, base::OnceCallback<void(bool)>, bool);
  void FinishChromePreparations(bool);
  bool DeferChromeClose(const base::UnguessableToken&, LinuxCloseStage, base::OnceCallback<void(bool)>);
  void ChromeCloseCancelled(const base::UnguessableToken&);
  void CancelDocumentSeal(LinuxClose::Identity, bool);
  base::DictValue RequestWindowClose();
  void RequestUtilityClose();
  void CancelWindowClose(LinuxClose::Identity, base::OnceCallback<void(bool, base::Value)>);
  void BeginWindowCloseDrain(const base::DictValue&, base::OnceCallback<void(bool, base::Value)>);
  bool AwaitingChromeHandoff() const;
  std::optional<LinuxDialogClient> DialogClient() const;
  std::string DialogProfile() const;
  void DialogInvoke(const std::string&, const base::ListValue&, base::OnceCallback<void(bool, base::Value)>);
  void SuspendDialogsForClose(const std::string&);
  void ResumeDialogsForClose(const std::string&);
  bool ClosingEndsSession() const;
  void AcknowledgeWindowClose(const base::DictValue&, base::OnceCallback<void(bool, base::Value)>);
  int remembered_outputs = 0;
  int forgotten_outputs = 0;
  void RememberWindowOutput() { ++remembered_outputs; }
  void ForgetWindowOutput() { ++forgotten_outputs; }
  void OnWidgetClosing(views::Widget*);
  void OnWidgetDestroying(views::Widget*);
};
std::map<int, ShellHostView*> hosts;
auto& Hosts() { return hosts; }
void ForgetOpenerHost(int) {}
std::string String(const base::DictValue& request, const char* key) {
  const auto* value = request.FindString(key);
  return value ? *value : "";
}
void views::Widget::CloseWithReason(ClosedReason reason) {
  if (armed) { armed = false; auto callback = std::move(close); std::move(callback).Run(reason); return; }
  if (closed || veto) return;
  closed = true;
  if (owner) owner->OnWidgetClosing(this);
}
base::DictValue WatchRequest() { base::DictValue request; request.Set("document", "live.json"); return request; }
base::DictValue CommitRequest(const LinuxDocumentClient& client, int sequence) {
  base::DictValue request;
  request.Set("document", "live.json"); request.Set("epoch", "epoch");
  request.Set("requestId", client.id + ":" + std::to_string(sequence));
  request.Set("observedRevision", base::Value(0));
  base::DictValue operation;
  operation.Set("type", "member"); operation.Set("target", "hiddenCalendarIds");
  operation.Set("member", "item-" + std::to_string(sequence)); operation.Set("present", base::Value(true));
  base::ListValue operations; operations.Append(base::Value(std::move(operation)));
  request.Set("operations", base::Value(std::move(operations)));
  return request;
}
base::DictValue Drained(ShellHostView& host, base::DictValue request) {
  bool accepted = false;
  host.BeginWindowCloseDrain(request, [&](bool ok, base::Value) { accepted = ok; });
  assert(accepted);
  return request;
}
base::DictValue Ack(const base::DictValue& identity, int watermark) {
  auto result = identity.Clone(); result.Set("watermark", base::Value(watermark)); return result;
}
auto Ignore = [](bool, base::Value) {};
base::OnceCallback<void(bool, base::Value)> AcceptedStorage(
    ShellHostView& host, std::string name, std::string payload = "intent") {
  base::OnceCallback<void(bool, base::Value)> done = Ignore;
  assert(host.TrackStorageWrite(std::move(name), base::DictValue().Set("contents", payload), done));
  return done;
}
void Watch(ShellHostView& host) {
  bool watched = false;
  host.DocumentCall("watch", WatchRequest(), [&](LinuxDocumentResult result) { assert(result.ok()); watched = true; });
  Drain(); assert(watched);
}
'''
PRELUDE = TEMPLATE.replace('ARDIA_PROFILE', PROFILE).replace('ARDIA_HANDLER', HANDLER).replace('ARDIA_DIALOGS', DIALOGS).replace('ARDIA_REPEATING', REPEATING)
PRELUDE_WITHOUT_REPEATING = PRELUDE.replace(REPEATING, '')


def close_invoke():
    source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
    branches = '\n'.join(method(source, signature) for signature in [
        '  if (method == "ArdiaShell.windowIdentity")',
        '  if (method == "ArdiaShell.requestWindowClose")',
        '  if (method == "ArdiaShell.beginWindowCloseDrain")',
        '  if (method == "ArdiaShell.acknowledgeWindowClose" || method == "ArdiaShell.rejectWindowClose")'])
    return r'''
void ShellHostView::CloseInvoke(std::string method, const base::DictValue& args,
                                base::OnceCallback<void(bool, base::Value)> done) {
  const base::ListValue empty;
  const auto* supplied = args.Find("args");
  const auto& values = supplied && supplied->is_list() ? supplied->GetList() : empty;
''' + branches + r'''
  std::move(done).Run(false, base::Value());
}
'''


def generic_invoke():
    source = (ROOT / 'src/ardia/linux/ac_linux_host.cc').read_text()
    branches = '\n'.join(method(source, signature) for signature in [
        '  if (method == "ArdiaShell.readDocument")',
        '  if (method == "ArdiaShell.writeDocument" || method == "ArdiaShell.saveDocument"'])
    return r'''
#include "ardia/linux/ac_linux_policy.h"
int generic_reads = 0;
int generic_writes = 0;
std::string DocumentDirectory(Profile*) { return "/native/Ardia"; }
std::optional<std::string> ReadDocument(const std::string&, const std::string&) { ++generic_reads; return "ok"; }
struct StoredDocument { ardia::linux_policy::StoredRead outcome; std::string contents; };
StoredDocument ReadStoredDocument(const std::string& directory, const std::string& name) { auto contents = ReadDocument(directory, name); return {contents ? ardia::linux_policy::StoredRead::kFound : ardia::linux_policy::StoredRead::kFailed, contents.value_or(std::string())}; }
bool WriteDocument(const std::string&, const std::string&, const std::optional<std::string>&) { ++generic_writes; return true; }
std::string ArgumentString(const base::ListValue& values, size_t index) { return values[index].GetString(); }
constexpr char kSessionName[] = "linux-session.json";
constexpr size_t kDocumentLimit = 8 * 1024 * 1024;
int storage_digests = 0;
std::string StorageDigest(std::string_view text) { ++storage_digests; return std::to_string(std::hash<std::string_view>{}(text)) + ":" + std::to_string(text.size()); }
struct FileRunnerApi {
  template<class Work, class Reply> void PostTaskAndReplyWithResult(int, Work work, Reply reply) {
    files.PostTask(0, [work = std::move(work), reply = std::move(reply)]() mutable {
      auto result = work();
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(0,
          [reply = std::move(reply), result = std::move(result)]() mutable { reply(std::move(result)); });
    });
  }
};
FileRunnerApi* FileRunner() { static FileRunnerApi runner; return &runner; }
void ShellHostView::GenericInvoke(std::string method, const base::DictValue& args,
                                  base::OnceCallback<void(bool, base::Value)> done) {
  const base::ListValue empty;
  const auto* supplied = args.Find("args");
  const auto& values = supplied && supplied->is_list() ? supplied->GetList() : empty;
''' + branches + r'''
  std::move(done).Run(false, base::Value());
}
'''
