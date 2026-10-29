#pragma once
#include <algorithm>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <initializer_list>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

#define FROM_HERE 0
#define CHECK(value) assert(value)
#define CHECK_EQ(a, b) assert((a) == (b))
#define DCHECK(value) assert(value)
#define NOTREACHED() std::abort()
#define BUILDFLAG(value) value
#define IS_MAC 0
#define IS_CHROMEOS 0
#define ENABLE_SESSION_SERVICE 1
#define ENABLE_BACKGROUND_MODE 0
#define ENABLE_CHROME_NOTIFICATIONS 0

namespace ardia { enum class LinuxCloseStage; struct LinuxCloseDispatch; }

namespace base {
using TerminationStatus = int;
template <class Signature> class OnceCallback;
template <class R, class... A> class OnceCallback<R(A...)> {
 public:
  OnceCallback() = default;
  template <class F> OnceCallback(F&& fn) : fn_(std::forward<F>(fn)) {}
  OnceCallback(OnceCallback&&) = default;
  OnceCallback& operator=(OnceCallback&&) = default;
  R Run(A... args) { auto fn = std::move(fn_); return fn(std::forward<A>(args)...); }
  R operator()(A... args) { return Run(std::forward<A>(args)...); }
  bool is_null() const { return !fn_; }
  explicit operator bool() const { return bool(fn_); }
  void Reset() { fn_ = nullptr; }
 private:
  std::move_only_function<R(A...)> fn_;
};
template <class Signature> class RepeatingCallback;
template <class R, class... A> class RepeatingCallback<R(A...)> {
 public:
  RepeatingCallback() = default;
  RepeatingCallback(const RepeatingCallback&) = default;
  RepeatingCallback(RepeatingCallback&&) = default;
  RepeatingCallback& operator=(const RepeatingCallback&) = default;
  RepeatingCallback& operator=(RepeatingCallback&&) = default;
  template <class F> requires (!std::is_same_v<std::remove_cvref_t<F>, RepeatingCallback>)
  RepeatingCallback(F&& fn) : fn_(std::forward<F>(fn)) {}
  R Run(A... args) const { auto fn = fn_; return fn(std::forward<A>(args)...); }
  R operator()(A... args) { return Run(std::forward<A>(args)...); }
  bool is_null() const { return !fn_; }
  explicit operator bool() const { return bool(fn_); }
  void Reset() { fn_ = nullptr; }
 private:
  std::function<R(A...)> fn_;
};
using OnceClosure = OnceCallback<void()>;
using RepeatingClosure = RepeatingCallback<void()>;

template <class T> class WeakPtr;
template <class T> struct IsWeak : std::false_type {};
template <class T> struct IsWeak<WeakPtr<T>> : std::true_type {};

template <class F> struct OnceBinder {
  F fn;
  template <class... A> decltype(auto) operator()(A&&... args) { return fn(std::forward<A>(args)...); }
  template <class... A> decltype(auto) Run(A&&... args) { return fn(std::forward<A>(args)...); }
};

template <class F, class... Bound> auto BindOnce(F fn, Bound... bound) {
  return OnceBinder{[fn = std::move(fn), args = std::make_tuple(std::move(bound)...)](auto&&... tail) mutable -> decltype(auto) {
    if constexpr (std::is_member_function_pointer_v<F> && sizeof...(Bound) > 0) {
      using First = std::tuple_element_t<0, decltype(args)>;
      if constexpr (IsWeak<First>::value) {
        if (!std::get<0>(args)) return;
      }
    }
    return std::apply([&](auto&... head) -> decltype(auto) {
      return std::invoke(fn, std::move(head)..., std::forward<decltype(tail)>(tail)...);
    }, args);
  }};
}
template <class F, class... Bound> auto BindRepeating(F fn, Bound... bound) {
  return [fn = std::move(fn), args = std::make_tuple(std::move(bound)...)](auto&&... tail) mutable -> decltype(auto) {
    if constexpr (std::is_member_function_pointer_v<F> && sizeof...(Bound) > 0) {
      using First = std::tuple_element_t<0, decltype(args)>;
      if constexpr (IsWeak<First>::value) {
        if (!std::get<0>(args)) return;
      }
    }
    return std::apply([&](auto&... head) -> decltype(auto) {
      return std::invoke(fn, head..., std::forward<decltype(tail)>(tail)...);
    }, args);
  };
}

class UnguessableToken {
 public:
  static UnguessableToken Create() { UnguessableToken token; token.value_ = ++next_; return token; }
  bool is_empty() const { return value_ == 0; }
  auto operator<=>(const UnguessableToken&) const = default;
 private:
  uint64_t value_ = 0;
  static inline uint64_t next_ = 0;
};

template <class T> class WeakPtr {
 public:
  WeakPtr() = default;
  WeakPtr(T* ptr, std::weak_ptr<bool> alive, std::shared_ptr<int> references) : ptr_(ptr), alive_(alive), references_(std::move(references)) {}
  T* get() const { auto alive = alive_.lock(); return alive && *alive ? ptr_ : nullptr; }
  T* operator->() const { return get(); }
  T& operator*() const { return *get(); }
  explicit operator bool() const { return get(); }
  WeakPtr& operator=(std::nullptr_t) { ptr_ = nullptr; alive_.reset(); return *this; }
 private:
  T* ptr_ = nullptr;
  std::weak_ptr<bool> alive_;
  std::shared_ptr<int> references_;
};
template <class T> class WeakPtrFactory {
 public:
  explicit WeakPtrFactory(T* ptr) : ptr_(ptr) {}
  ~WeakPtrFactory() { *alive_ = false; }
  WeakPtr<T> GetWeakPtr() { return {ptr_, alive_, references_}; }
  void InvalidateWeakPtrs() { *alive_ = false; alive_ = std::make_shared<bool>(true); references_ = std::make_shared<int>(0); }
  bool HasWeakPtrs() const { return references_.use_count() > 1; }
 private:
  T* ptr_;
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
  std::shared_ptr<int> references_ = std::make_shared<int>(0);
};

template <class T> class RefCounted {
 public:
  void AddRef() const { ++refs_; }
  void Release() const { if (!--refs_) delete static_cast<const T*>(this); }
 private:
  mutable int refs_ = 0;
};
template <class T> class ScopedRef {
 public:
  explicit ScopedRef(T* ptr = nullptr) : ptr_(ptr) { if (ptr_) ptr_->AddRef(); }
  ScopedRef(const ScopedRef& other) : ScopedRef(other.ptr_) {}
  ScopedRef(ScopedRef&& other) : ptr_(std::exchange(other.ptr_, nullptr)) {}
  ~ScopedRef() { if (ptr_) ptr_->Release(); }
  T* get() const { return ptr_; }
  T* operator->() const { return ptr_; }
  T& operator*() const { return *ptr_; }
 private:
  T* ptr_;
};
template <class T> auto WrapRefCounted(T* ptr) { return ScopedRef<T>(ptr); }
template <class T> auto RetainedRef(T* ptr) { return WrapRefCounted(ptr); }

template <class T> class NoDestructor {
 public:
  T& operator*() { return value_; }
  T* operator->() { return &value_; }
 private:
  T value_;
};
class SingleThreadTaskRunner : public RefCounted<SingleThreadTaskRunner> {
 public:
  static ScopedRef<SingleThreadTaskRunner> GetCurrentDefault() { static auto runner = WrapRefCounted(new SingleThreadTaskRunner()); return runner; }
  bool RunsTasksInCurrentSequence() const { return on_sequence; }
  bool on_sequence = true;
  void PostTask(int, OnceClosure task) { tasks.push_back(std::move(task)); }
  void Drain() { for (int i = 0; !tasks.empty(); ++i) { assert(i < 100); auto task = std::move(tasks.front()); tasks.erase(tasks.begin()); std::move(task).Run(); } }
  std::vector<OnceClosure> tasks;
};
struct ElapsedTimer { int Elapsed() { return 0; } };
inline void UmaHistogramMediumTimes(const char*, int) {}
}
template <class T> using scoped_refptr = base::ScopedRef<T>;

inline std::vector<std::string> close_events;
inline bool trying_to_quit = true;
inline bool ignore_unload = false;
inline int shutdown_sessions = 0;
inline int pending_downloads = 0;
inline base::OnceCallback<void(bool)> download_answer;
inline std::vector<base::OnceCallback<void(bool)>> download_answers;
inline void DrainCloseTasks() { base::SingleThreadTaskRunner::GetCurrentDefault()->Drain(); }

class BrowserWindowInterface;
class UnloadController;
#include "close_content_types.h"

struct Profile { std::vector<Profile*> GetAllOffTheRecordProfiles() { return {}; } };
struct TabGroup { bool IsGroupClosing() { return false; } };
struct GroupModel { TabGroup* GetTabGroup(int) { static TabGroup group; return &group; } };
struct TabStripModel {
  std::vector<content::WebContents*> tabs;
  int closed = 0;
  base::RepeatingClosure before_close_all;
  int count() const { return tabs.size(); }
  bool empty() const { return tabs.empty(); }
  content::WebContents* GetWebContentsAt(int i) { return tabs.at(i); }
  void CloseAllTabs() { if (before_close_all) before_close_all.Run(); close_events.push_back("close-tabs"); ++closed; tabs.clear(); }
  void AddObserver(UnloadController*) {}
  void RemoveObserver(UnloadController*) {}
  std::optional<int> GetTabGroupForTab(int) { return {}; }
  static constexpr int kNoTab = -1;
  int GetIndexOfWebContents(content::WebContents* contents) { auto it = std::ranges::find(tabs, contents); return it == tabs.end() ? kNoTab : int(it - tabs.begin()); }
  GroupModel* group_model() { static GroupModel groups; return &groups; }
  void GroupCloseStopped(int) {}
};
struct FakeWindow {
  BrowserWindowInterface* browser = nullptr;
  int close_requests = 0;
  void Close();
};
class BrowserWindowInterface {
 public:
  enum class Type { TYPE_NORMAL, TYPE_DEVTOOLS, TYPE_APP, TYPE_APP_POPUP };
  enum class ClosingStatus { kPermitted, kDeniedByUser, kDeniedByPolicy, kDeniedUnloadHandlersNeedTime };
  BrowserWindowInterface() { window.browser = this; }
  ~BrowserWindowInterface();
  base::WeakPtr<BrowserWindowInterface> GetWeakPtr() { return weak.GetWeakPtr(); }
  TabStripModel* GetTabStripModel() { return &tabs; }
  TabStripModel* tab_strip_model() { return &tabs; }
  FakeWindow* GetWindow() { return &window; }
  Profile* GetProfile() { return &profile; }
  Type GetType() { return Type::TYPE_NORMAL; }
  int GetSessionID() { return 1; }
  int GetUnownedUserDataHost() { return 0; }
  TabStripModel tabs;
  Profile profile;
  FakeWindow window;
  UnloadController* controller = nullptr;
  bool destroyed = false;
  base::WeakPtrFactory<BrowserWindowInterface> weak{this};
};
inline std::vector<BrowserWindowInterface*> browsers;
namespace BrowserCollection { enum class Order { kCreation }; }
struct GlobalBrowserCollection {
  static GlobalBrowserCollection* GetInstance() { static GlobalBrowserCollection collection; return &collection; }
  template <class F> void ForEach(F fn, BrowserCollection::Order) {
    auto current = browsers;
    for (auto* browser : current) {
      if (std::ranges::find(browsers, browser) != browsers.end() && !browser->destroyed && !fn(browser)) break;
    }
  }
};
template <class F> void ForEachCurrentAndNewBrowserWindowInterfaceOrderedByActivation(F fn) {
  for (size_t i = 0; i < browsers.size(); ++i) if (!browsers[i]->destroyed && !fn(browsers[i])) break;
}
inline BrowserWindowInterface* GetLastActiveBrowserWindowInterfaceWithAnyProfile() {
  for (auto* browser : browsers) if (!browser->destroyed) return browser;
  return nullptr;
}
struct ProfileManager {
  static void ShutdownSessionServices() { close_events.push_back("shutdown-sessions"); ++shutdown_sessions; }
  std::vector<Profile*> GetLoadedProfiles() { return {}; }
};
namespace browser_shutdown {
inline bool ShouldIgnoreUnloadHandlers() { return ignore_unload; }
inline void SetTryingToQuit(bool value) { close_events.push_back(value ? "quit-true" : "quit-false"); trying_to_quit = value; }
inline bool IsTryingToQuit() { return trying_to_quit; }
enum class ShutdownType { kWindowClose };
inline void OnShutdownStarting(ShutdownType) {}
}
namespace chrome {
inline void OnClosingAllBrowsers(bool) { close_events.push_back("chrome-reset"); }
inline void ShowDownloads(BrowserWindowInterface*) {}
inline void CloseWindow(BrowserWindowInterface* browser) { browser->GetWindow()->Close(); }
}
struct DownloadCoreService { static int BlockingShutdownCountAllProfiles() { return pending_downloads; } };
namespace glic { struct GlicBackgroundModeManager { static GlicBackgroundModeManager* GetInstance() { return nullptr; } void ExitBackgroundMode() {} }; }
struct FakeOmnibox { void ExitBackgroundMode() {} };
struct FakeFeatures { FakeOmnibox* omnibox_everywhere_controller() { return nullptr; } };
struct FakeProcess {
  ProfileManager* profile_manager() { static ProfileManager manager; return &manager; }
  FakeFeatures* GetFeatures() { static FakeFeatures features; return &features; }
};
inline FakeProcess process;
inline FakeProcess* g_browser_process = &process;
struct SessionServiceBase { void WindowClosing(int) {} };
inline SessionServiceBase* GetAppropriateSessionServiceForProfile(BrowserWindowInterface*) { return nullptr; }
namespace sessions { struct TabRestoreService { void BrowserClosing(int) {} }; }
struct TabRestoreServiceFactory { static sessions::TabRestoreService* GetForProfile(Profile*) { return nullptr; } };
struct BrowserLiveTabContext { static int From(BrowserWindowInterface*) { return 0; } };
struct BrowserManagerService {
  static void SynchronouslyDestroyBrowser(BrowserWindowInterface* browser) { close_events.push_back("destroy-browser"); browser->destroyed = true; }
};
namespace performance_manager::execution_context_priority {
inline void SetPageIsClosing(content::WebContents*, bool) {}
}
namespace tab_groups { using TabGroupId = int; }
struct DevToolsWindow {
  static bool InterceptPageBeforeUnload(content::WebContents*) { return false; }
  static bool HasFiredBeforeUnloadEventForDevToolsBrowser(BrowserWindowInterface*) { return false; }
  static bool NeedsToInterceptBeforeUnload(content::WebContents*) { return false; }
  static void OnPageCloseCanceled(content::WebContents*) {}
};
struct KeepAliveRegistry {
  static KeepAliveRegistry* GetInstance() { static KeepAliveRegistry registry; return &registry; }
  bool IsKeepingAliveOnlyByBrowserOrigin() { return false; }
};

template <class T> class raw_ptr {
 public:
  raw_ptr(T* ptr = nullptr) : ptr_(ptr) {}
  raw_ptr& operator=(T* ptr) { ptr_ = ptr; return *this; }
  operator T*() const { return ptr_; }
  T* get() const { return ptr_; }
  T* operator->() const { return ptr_; }
 private:
  T* ptr_;
};
struct DummySubscription {
  template <class... T> explicit DummySubscription(T&&...) {}
};
struct FakeWebContentsCollection {
  explicit FakeWebContentsCollection(UnloadController*) {}
  void StopObserving(content::WebContents*) {}
};
struct FakeClosedCallbacks {
  int count = 0;
  void Notify(BrowserWindowInterface*) { ++count; }
};

class UnloadController {
 public:
  using UnloadListenerSet = std::set<content::WebContents*>;
  enum class State { kIdle, kRunningBeforeUnloadForShutdown, kBeforeUnloadConfirmed, kRunningBeforeUnloadForWindowClose, kRunningUnload, kUnloadCompleted };
  enum class CancelDownloadConfirmationState { kNotPrompted, kWaitingForResponse, kResponseReceived };
  enum class WarnBeforeClosingResult { kOkToClose, kDoNotClose };
  using WarnBeforeClosingCallback = base::OnceCallback<void(WarnBeforeClosingResult)>;
  explicit UnloadController(BrowserWindowInterface* browser);
  ~UnloadController();
  static UnloadController* From(BrowserWindowInterface* browser) { return browser->controller; }
  bool HandleBeforeClose();
  void OnWindowClosing();
  void OnWindowCloseComplete();
  bool BeforeUnloadFired(content::WebContents*, bool);
  bool RunBeforeUnloadForShutdown(bool, const base::RepeatingCallback<void(bool)>&);
  void ResetBeforeUnloadForShutdown();
  void CancelWindowClose();
  void SetLinuxQuitCancel(base::RepeatingClosure);
  void ScheduleLinuxCloseRescan();
  void WebContentsDestroyed(content::WebContents*);
  void DidFinishNavigation(content::WebContents*, content::NavigationHandle*);
  bool IsLinuxClosePreflightReady() const;
  bool DeferLinuxClose(ardia::LinuxCloseStage, base::OnceClosure);
  void TabDetachedImpl(content::WebContents*);
  void RenderProcessGone(content::WebContents*, base::TerminationStatus);
  void ProcessPendingTabs(bool);
  void TransitionTo(State);
  bool HasCompletedUnloadProcessing() const;
  UnloadListenerSet GetTabsNeedingBeforeUnloadFired() const;
  bool RemoveFromSet(UnloadListenerSet*, content::WebContents*);
  void ClearUnloadState(content::WebContents*, bool);
  void FinishWarnBeforeClosing(WarnBeforeClosingResult);
  BrowserWindowInterface::ClosingStatus GetBrowserClosingStatus() const;
  bool IsUnclosableApp() const { return false; }
  bool is_attempting_to_close_browser() const { return state_ != State::kIdle; }
  bool force_skip_warning_user_on_close() const { return force_skip_warning_user_on_close_; }
  void set_force_skip_warning_user_on_close(bool value) { force_skip_warning_user_on_close_ = value; }
  base::WeakPtr<UnloadController> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }
  bool TabsNeedBeforeUnloadFired() const { return !GetTabsNeedingBeforeUnloadFired().empty(); }
  WarnBeforeClosingResult MaybeWarnBeforeClosing(WarnBeforeClosingCallback callback) {
    if (warn) { warn_before_closing_callback_ = std::move(callback); return WarnBeforeClosingResult::kDoNotClose; }
    return WarnBeforeClosingResult::kOkToClose;
  }
  void NotifyWindowCloseCancelled(BrowserWindowInterface::ClosingStatus) {}
  raw_ptr<BrowserWindowInterface> browser_;
  DummySubscription scoped_unowned_user_data_;
  FakeWebContentsCollection web_contents_collection_;
  State state_ = State::kIdle;
  UnloadListenerSet tabs_needing_before_unload_fired_;
  UnloadListenerSet tabs_needing_unload_fired_;
  base::RepeatingCallback<void(bool)> on_close_confirmed_;
  CancelDownloadConfirmationState cancel_download_confirmation_state_ = CancelDownloadConfirmationState::kNotPrompted;
  CancelDownloadConfirmationState close_multitab_confirmation_state_ = CancelDownloadConfirmationState::kNotPrompted;
  WarnBeforeClosingCallback warn_before_closing_callback_;
  bool force_skip_warning_user_on_close_ = false;
  bool warn = false;
  bool is_delete_scheduled_ = false;
  FakeClosedCallbacks browser_did_close_callback_list_;
  std::vector<base::RepeatingClosure> linux_quit_cancels_;
  struct LinuxPendingUnload {
    bool approved = false;
    content::WeakDocumentPtr document;
    std::shared_ptr<ardia::LinuxCloseDispatch> request;
  };
  std::map<content::WebContents*, LinuxPendingUnload> linux_pending_unloads_;
  bool linux_window_close_requested_ = false;
  bool linux_rescan_posted_ = false;
  bool linux_waiting_for_dispatch_ = false;
  base::WeakPtrFactory<UnloadController> weak_factory_{this};
};

class BrowserCloseManager : public base::RefCounted<BrowserCloseManager> {
 public:
  friend class base::RefCounted<BrowserCloseManager>;
  BrowserCloseManager();
  ~BrowserCloseManager();
  void StartClosingBrowsers();
  void CancelBrowserClose();
  base::RepeatingClosure MakeLinuxQuitCancel();
  void TryToCloseBrowsers();
  void OnBrowserReportCloseable(bool);
  void CloseBrowsers();
  void CheckForDownloadsInProgress();
  void OnReportDownloadsCancellable(bool);
  void OnLinuxTeardownReady(base::WeakPtr<BrowserCloseManager>, base::WeakPtr<BrowserWindowInterface>, base::UnguessableToken, bool);
  void OnLinuxCloseReady(base::WeakPtr<BrowserCloseManager>, base::WeakPtr<BrowserWindowInterface>, bool);
  void ConfirmCloseWithPendingDownloads(int, base::OnceCallback<void(bool)> callback) { if (download_answer) download_answers.push_back(std::move(download_answer)); download_answer = std::move(callback); }
  std::optional<base::ElapsedTimer> close_timer_;
  base::WeakPtr<BrowserWindowInterface> current_browser_;
  bool linux_cancelled_ = false;
  std::vector<base::WeakPtr<BrowserWindowInterface>> linux_confirmed_browsers_;
  base::WeakPtrFactory<BrowserCloseManager> linux_weak_factory_{this};
  base::WeakPtrFactory<BrowserCloseManager> lifetime_{this};
};
inline void ShowInProgressDownloads(Profile*) {}

inline BrowserWindowInterface::~BrowserWindowInterface() {
  weak.InvalidateWeakPtrs();
  std::erase(browsers, this);
  delete controller;
}
inline void FakeWindow::Close() {
  ++close_requests;
  browser->controller->OnWindowClosing();
}

#include "close_content_support.h"
