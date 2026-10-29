#ifndef ARDIA_TESTS_WEB_STORE_SUPPORT_H_
#define ARDIA_TESTS_WEB_STORE_SUPPORT_H_

#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <type_traits>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

#define FROM_HERE 0
#define WEB_CONTENTS_USER_DATA_KEY_DECL() static constexpr int kUserDataKey = 0
#define WEB_CONTENTS_USER_DATA_KEY_IMPL(T)

constexpr int ISOLATED_WORLD_ID_ARDIA_PAGE = 1001;

template <class T> using raw_ptr = T*;

namespace base {

template <class Signature> class OnceCallback;
template <class R, class... A> class OnceCallback<R(A...)> {
 public:
  OnceCallback() = default;
  template <class F>
    requires std::is_invocable_r_v<R, F&, A...>
  OnceCallback(F f) : f_(std::move(f)) {}
  OnceCallback(OnceCallback&&) = default;
  OnceCallback& operator=(OnceCallback&&) = default;
  explicit operator bool() const { return static_cast<bool>(f_); }
  R Run(A... args) && {
    auto f = std::exchange(f_, nullptr);
    return f(std::forward<A>(args)...);
  }

 private:
  std::move_only_function<R(A...)> f_;
};

template <class Signature> class RepeatingCallback;
template <class R, class... A> class RepeatingCallback<R(A...)> {
 public:
  RepeatingCallback() = default;
  template <class F>
    requires std::is_invocable_r_v<R, const F&, A...>
  RepeatingCallback(F f) : f_(std::move(f)) {}
  explicit operator bool() const { return static_cast<bool>(f_); }
  R Run(A... args) const { return f_(std::forward<A>(args)...); }

 private:
  std::function<R(A...)> f_;
};

template <class T> T* Unretained(T* value) { return value; }

template <class F, class... Args> OnceCallback<void()> BindOnce(F f, Args... args) {
  return OnceCallback<void()>([f = std::move(f), ... args = std::move(args)]() mutable { std::invoke(f, std::move(args)...); });
}

template <class F, class... Args> RepeatingCallback<void()> BindRepeating(F f, Args... args) {
  return RepeatingCallback<void()>([f, args...]() { std::invoke(f, args...); });
}

struct NullCallbackType {
  template <class S> operator OnceCallback<S>() const { return OnceCallback<S>(); }
};
inline NullCallbackType NullCallback() { return {}; }

template <class T> class WeakPtr {
 public:
  WeakPtr() = default;
  explicit WeakPtr(std::shared_ptr<T*> target) : target_(std::move(target)) {}
  explicit operator bool() const { return target_ && *target_; }
  T* operator->() const { return *target_; }
  T* get() const { return target_ ? *target_ : nullptr; }

 private:
  std::shared_ptr<T*> target_;
};

template <class T> class WeakPtrFactory {
 public:
  explicit WeakPtrFactory(T* target) : target_(std::make_shared<T*>(target)) {}
  ~WeakPtrFactory() { *target_ = nullptr; }
  WeakPtr<T> GetWeakPtr() { return WeakPtr<T>(target_); }

 private:
  std::shared_ptr<T*> target_;
};

template <class T> class NoDestructor {
 public:
  T& operator*() { return value_; }
  T* operator->() { return &value_; }

 private:
  T value_;
};

template <class Source, class Observer> class ScopedObservation {
 public:
  explicit ScopedObservation(Observer* observer) : observer_(observer) {}
  ~ScopedObservation() { Reset(); }
  void Observe(Source* source) {
    Reset();
    source_ = source;
    source_->AddObserver(observer_);
  }
  void Reset() {
    if (source_) source_->RemoveObserver(observer_);
    source_ = nullptr;
  }
  bool IsObserving() const { return source_ != nullptr; }

 private:
  Observer* observer_;
  Source* source_ = nullptr;
};

class DictValue;
class Value {
 public:
  Value() = default;
  explicit Value(bool value) : value_(value) {}
  explicit Value(std::string value) : value_(std::move(value)) {}
  explicit Value(DictValue&& value);
  Value(Value&&) = default;
  Value& operator=(Value&&) = default;
  bool is_none() const { return std::holds_alternative<std::monostate>(value_); }
  bool is_string() const { return std::holds_alternative<std::string>(value_); }
  bool is_dict() const { return std::holds_alternative<std::shared_ptr<DictValue>>(value_); }
  const std::string& GetString() const { return std::get<std::string>(value_); }
  const DictValue& GetDict() const { return *std::get<std::shared_ptr<DictValue>>(value_); }
  std::optional<bool> GetIfBool() const {
    return std::holds_alternative<bool>(value_) ? std::optional<bool>(std::get<bool>(value_)) : std::nullopt;
  }

 private:
  std::variant<std::monostate, bool, std::string, std::shared_ptr<DictValue>> value_;
};

class DictValue {
 public:
  DictValue() = default;
  DictValue(DictValue&&) = default;
  DictValue&& Set(std::string_view key, bool value) && {
    entries_[std::string(key)] = Value(value);
    return std::move(*this);
  }
  std::optional<bool> FindBool(std::string_view key) const {
    auto found = entries_.find(std::string(key));
    return found == entries_.end() ? std::nullopt : found->second.GetIfBool();
  }

 private:
  std::map<std::string, Value> entries_;
};

inline Value::Value(DictValue&& value) : value_(std::make_shared<DictValue>(std::move(value))) {}

class SequencedTaskRunner {
 public:
  static SequencedTaskRunner* GetCurrentDefault() {
    static SequencedTaskRunner runner;
    return &runner;
  }
  void PostTask(int, OnceCallback<void()> task) { tasks_.push_back(std::move(task)); }
  size_t RunAll() {
    size_t ran = 0;
    while (!tasks_.empty()) {
      auto task = std::move(tasks_.front());
      tasks_.erase(tasks_.begin());
      std::move(task).Run();
      ++ran;
    }
    return ran;
  }

 private:
  std::vector<OnceCallback<void()>> tasks_;
};

inline double& FakeNow() {
  static double now = 0;
  return now;
}

class TimeDelta {
 public:
  explicit TimeDelta(double seconds) : seconds_(seconds) {}
  double InSecondsF() const { return seconds_; }

 private:
  double seconds_;
};
inline TimeDelta Seconds(double seconds) { return TimeDelta(seconds); }

class TimeTicks {
 public:
  static TimeTicks Now() { return TimeTicks(); }
  TimeDelta since_origin() const { return TimeDelta(FakeNow()); }
};

class RepeatingTimer;
inline std::vector<RepeatingTimer*>& LiveTimers() {
  static std::vector<RepeatingTimer*> timers;
  return timers;
}

class RepeatingTimer {
 public:
  RepeatingTimer() { LiveTimers().push_back(this); }
  ~RepeatingTimer() { std::erase(LiveTimers(), this); }
  void Start(int, TimeDelta delay, RepeatingCallback<void()> task) {
    delay_ = delay.InSecondsF();
    task_ = std::move(task);
    next_ = FakeNow() + delay_;
    running_ = true;
  }
  void Stop() { running_ = false; }
  bool IsRunning() const { return running_; }
  bool FireIfDue() {
    if (!running_ || FakeNow() < next_) return false;
    next_ = FakeNow() + delay_;
    task_.Run();
    return true;
  }

 private:
  RepeatingCallback<void()> task_;
  double delay_ = 0;
  double next_ = 0;
  bool running_ = false;
};

inline void AdvanceTo(double now) {
  while (FakeNow() < now) {
    FakeNow() = std::min(now, FakeNow() + 1);
    for (bool fired = true; fired;) {
      fired = false;
      for (auto* timer : std::vector<RepeatingTimer*>(LiveTimers())) {
        if (std::find(LiveTimers().begin(), LiveTimers().end(), timer) != LiveTimers().end() && timer->FireIfDue())
          fired = true;
      }
    }
  }
}

inline std::u16string UTF8ToUTF16(std::string_view text) { return std::u16string(text.begin(), text.end()); }

}

class GURL {
 public:
  GURL() = default;
  explicit GURL(std::string spec) : spec_(std::move(spec)) {}
  const std::string& spec() const { return spec_; }
  bool SchemeIsHTTPOrHTTPS() const { return spec_.starts_with("http://") || spec_.starts_with("https://"); }

 private:
  std::string spec_;
};

namespace content {

class BrowserContext {
 public:
  virtual ~BrowserContext() = default;
};
class Page {};

class RenderFrameHost {
 public:
  bool live = true;
  GURL url;
  std::vector<std::pair<std::u16string, int>> scripts;
  bool IsRenderFrameLive() const { return live; }
  const GURL& GetLastCommittedURL() const { return url; }
  void ExecuteJavaScriptInIsolatedWorld(const std::u16string& script, base::OnceCallback<void(base::Value)>, int world) {
    scripts.emplace_back(script, world);
  }
};

class WebContentsObserver;

struct UserDataBase {
  virtual ~UserDataBase() = default;
};

class WebContents {
 public:
  ~WebContents();
  RenderFrameHost* GetPrimaryMainFrame() { return &frame; }
  BrowserContext* GetBrowserContext() { return context_override ? context_override : &context; }
  const GURL& GetLastCommittedURL() const { return frame.url; }
  void OnWebPreferencesChanged() { ++preference_updates; }
  int preference_updates = 0;
  void ChangePrimaryPage();
  void Destroy();

  RenderFrameHost frame;
  BrowserContext context;
  BrowserContext* context_override = nullptr;
  std::vector<WebContentsObserver*> observers;
  std::map<const void*, std::unique_ptr<UserDataBase>> user_data;
};

class WebContentsObserver {
 public:
  explicit WebContentsObserver(WebContents* contents) : contents_(contents) { contents_->observers.push_back(this); }
  virtual ~WebContentsObserver() {
    if (contents_) std::erase(contents_->observers, this);
  }
  WebContents* web_contents() const { return contents_; }
  virtual void PrimaryPageChanged(Page&) {}
  virtual void WebContentsDestroyed() {}
  void Forget() { contents_ = nullptr; }

 private:
  WebContents* contents_;
};

template <class T> class WebContentsUserData : public UserDataBase {
 public:
  explicit WebContentsUserData(WebContents&) {}
  template <class... Args> static void CreateForWebContents(WebContents* contents, Args&&... args) {
    if (!FromWebContents(contents))
      contents->user_data[Key()] = std::unique_ptr<UserDataBase>(new T(contents, std::forward<Args>(args)...));
  }
  static T* FromWebContents(WebContents* contents) {
    auto found = contents->user_data.find(Key());
    return found == contents->user_data.end() ? nullptr : static_cast<T*>(found->second.get());
  }

 private:
  static const void* Key() {
    static int key;
    return &key;
  }
};

inline void WebContents::ChangePrimaryPage() {
  Page page;
  for (auto* observer : std::vector<WebContentsObserver*>(observers)) observer->PrimaryPageChanged(page);
}

inline void WebContents::Destroy() {
  for (auto* observer : std::vector<WebContentsObserver*>(observers)) observer->WebContentsDestroyed();
  for (auto* observer : observers) observer->Forget();
  observers.clear();
  user_data.clear();
}

inline WebContents::~WebContents() { Destroy(); }

}

namespace extensions {

enum UninstallReason { UNINSTALL_REASON_MANAGEMENT_API };

class Extension {
 public:
  explicit Extension(std::string id) : id_(std::move(id)) {}
  const std::string& id() const { return id_; }

 private:
  std::string id_;
};

class ExtensionRegistry;
class ExtensionRegistryObserver {
 public:
  virtual ~ExtensionRegistryObserver() = default;
  virtual void OnExtensionUninstalled(content::BrowserContext*, const Extension*, UninstallReason) {}
  virtual void OnShutdown(ExtensionRegistry*) {}
};

class ExtensionRegistry {
 public:
  static ExtensionRegistry* Get(content::BrowserContext* context) {
    static std::map<content::BrowserContext*, std::unique_ptr<ExtensionRegistry>> registries;
    auto& registry = registries[context];
    if (!registry) registry = std::make_unique<ExtensionRegistry>();
    return registry.get();
  }
  void AddObserver(ExtensionRegistryObserver* observer) { observers.push_back(observer); }
  void RemoveObserver(ExtensionRegistryObserver* observer) { std::erase(observers, observer); }
  void Uninstall(content::BrowserContext* context, const Extension& extension) {
    for (auto* observer : std::vector<ExtensionRegistryObserver*>(observers))
      observer->OnExtensionUninstalled(context, &extension, UNINSTALL_REASON_MANAGEMENT_API);
  }
  std::vector<ExtensionRegistryObserver*> observers;
};

class UninstallDialogDelegate {
 public:
  virtual ~UninstallDialogDelegate() = default;
};

class ManagementUninstallFunctionBase {
 public:
  const Extension* calling_extension = nullptr;
  GURL source;
  content::WebContents* sender = nullptr;
  std::unique_ptr<UninstallDialogDelegate> uninstall_dialog_;
  std::optional<bool> closed_removed;
  std::u16string closed_error;
  int closes = 0;

  const Extension* extension() const { return calling_extension; }
  const GURL& source_url() const { return source; }
  content::WebContents* GetSenderWebContents() { return sender; }
  void OnExtensionUninstallDialogClosed(bool did_start_uninstall, const std::u16string& error) {
    ++closes;
    closed_removed = did_start_uninstall;
    closed_error = error;
    uninstall_dialog_.reset();
  }
};

}

namespace extension_urls {
inline bool IsWebstoreDomain(const GURL& url) { return url.spec().starts_with("https://chromewebstore.google.com/"); }
}

#endif
