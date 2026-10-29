#pragma once
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstddef>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <ostream>
#include <sstream>
#include <set>
#include <string>
#include <tuple>
#include <utility>
#include <vector>

#include "base/values.h"

#define FROM_HERE 0
#define WARNING 0
#define LOG(severity) ::base::LogSink()
#define LOG_IF(severity, condition) ::base::LogSink()

namespace base {

struct LogSink {
  template <class T> LogSink& operator<<(const T&) { return *this; }
};

template <class> class OnceCallback;
template <class R, class... A> class OnceCallback<R(A...)> {
  struct Target {
    virtual ~Target() = default;
    virtual R Run(A... args) = 0;
  };
  template <class F> struct Callable : Target {
    F fn;
    explicit Callable(F value) : fn(std::move(value)) {}
    R Run(A... args) override { return fn(std::forward<A>(args)...); }
  };
  std::unique_ptr<Target> fn_;

 public:
  OnceCallback() = default;
  template <class F> OnceCallback(F fn) : fn_(std::make_unique<Callable<F>>(std::move(fn))) {}
  OnceCallback(OnceCallback&&) = default;
  OnceCallback& operator=(OnceCallback&&) = default;
  explicit operator bool() const { return !!fn_; }
  bool is_null() const { return !fn_; }
  R Run(A... args) && {
    auto fn = std::move(fn_);
    assert(fn);
    return fn->Run(std::forward<A>(args)...);
  }
};
using OnceClosure = OnceCallback<void()>;

template <class> class RepeatingCallback;
template <class R, class... A> class RepeatingCallback<R(A...)> {
  std::shared_ptr<std::function<R(A...)>> fn_;

 public:
  RepeatingCallback() = default;
  template <class F> RepeatingCallback(F fn) : fn_(std::make_shared<std::function<R(A...)>>(std::move(fn))) {}
  explicit operator bool() const { return !!fn_; }
  R Run(A... args) const { return (*fn_)(std::forward<A>(args)...); }
};

template <class T> class WeakPtr {
 public:
  WeakPtr() = default;
  WeakPtr(std::shared_ptr<bool> alive, T* value) : alive_(std::move(alive)), value_(value) {}
  T* get() const { return alive_ && *alive_ ? value_ : nullptr; }
  T* operator->() const { return get(); }
  explicit operator bool() const { return get() != nullptr; }

 private:
  std::shared_ptr<bool> alive_;
  T* value_ = nullptr;
};

template <class T> class WeakPtrFactory {
 public:
  explicit WeakPtrFactory(T* value) : value_(value) {}
  ~WeakPtrFactory() { *alive_ = false; }
  WeakPtr<T> GetWeakPtr() { return WeakPtr<T>(alive_, value_); }
  void InvalidateWeakPtrs() {
    *alive_ = false;
    alive_ = std::make_shared<bool>(true);
  }

 private:
  T* value_;
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
};

template <class C, class... P, class... B>
auto BindOnce(void (C::*fn)(P...), WeakPtr<C> target, B... bound) {
  return [fn, target, bound = std::make_tuple(std::move(bound)...)](auto&&... rest) mutable {
    C* object = target.get();
    if (!object) return;
    std::apply([&](auto&&... values) { (object->*fn)(std::move(values)..., std::forward<decltype(rest)>(rest)...); },
               std::move(bound));
  };
}

template <class R, class... A, class... B>
auto BindOnce(OnceCallback<R(A...)> callback, B... bound) {
  return [callback = std::move(callback), bound = std::make_tuple(std::move(bound)...)](auto&&... rest) mutable {
    std::apply([&](auto&&... values) { std::move(callback).Run(std::move(values)..., std::forward<decltype(rest)>(rest)...); },
               std::move(bound));
  };
}

template <class F, class... B>
auto BindOnce(F fn, B... bound) {
  return [fn = std::move(fn), bound = std::make_tuple(std::move(bound)...)](auto&&... rest) mutable {
    return std::apply([&](auto&&... values) { return fn(std::move(values)..., std::forward<decltype(rest)>(rest)...); },
                      std::move(bound));
  };
}

template <class T> class NoDestructor {
 public:
  T& operator*() { return value_; }
  T* operator->() { return &value_; }

 private:
  T value_;
};

inline std::deque<OnceClosure>& PostedTasks() {
  static std::deque<OnceClosure> tasks;
  return tasks;
}

inline void RunPostedTasks() {
  while (!PostedTasks().empty()) {
    OnceClosure task = std::move(PostedTasks().front());
    PostedTasks().pop_front();
    std::move(task).Run();
  }
}

class SingleThreadTaskRunner {
 public:
  static SingleThreadTaskRunner* GetCurrentDefault() {
    static SingleThreadTaskRunner runner;
    return &runner;
  }
  template <class F> void PostTask(int, F task) { PostedTasks().push_back(OnceClosure(std::move(task))); }
};

class TimeDelta {
 public:
  constexpr explicit TimeDelta(double seconds = 0) : seconds_(seconds) {}
  constexpr double InSecondsF() const { return seconds_; }

 private:
  double seconds_;
};
constexpr TimeDelta Seconds(double seconds) { return TimeDelta(seconds); }

inline double& FakeNow() {
  static double now = 1000;
  return now;
}

class TimeTicks {
 public:
  constexpr TimeTicks() = default;
  constexpr explicit TimeTicks(double seconds) : seconds_(seconds) {}
  static TimeTicks Now() { return TimeTicks(FakeNow()); }
  TimeDelta operator-(const TimeTicks& other) const { return TimeDelta(seconds_ - other.seconds_); }

 private:
  double seconds_ = 0;
};

class OneShotTimer;
inline std::vector<OneShotTimer*>& LiveTimers() {
  static std::vector<OneShotTimer*> timers;
  return timers;
}

class OneShotTimer {
 public:
  OneShotTimer() { LiveTimers().push_back(this); }
  ~OneShotTimer() { std::erase(LiveTimers(), this); }
  template <class F> void Start(int, TimeDelta delay, F task) {
    delay_ = delay;
    task_ = OnceClosure(std::move(task));
  }
  void Stop() { task_ = OnceClosure(); }
  bool IsRunning() const { return !!task_; }
  void Fire() {
    auto task = std::move(task_);
    if (task) std::move(task).Run();
  }

 private:
  TimeDelta delay_;
  OnceClosure task_;
};

template <class Source, class Observer> class ScopedObservation {
 public:
  explicit ScopedObservation(Observer* observer) : observer_(observer) {}
  ~ScopedObservation() { Reset(); }
  void Observe(Source* source) {
    source_ = source;
    source_->AddObserver(observer_);
  }
  void Reset() {
    if (source_) source_->RemoveObserver(observer_);
    source_ = nullptr;
  }

 private:
  Observer* observer_;
  Source* source_ = nullptr;
};

}

template <class T> class raw_ptr {
 public:
  raw_ptr() = default;
  raw_ptr(T* value) : value_(value) {}
  raw_ptr& operator=(T* value) {
    value_ = value;
    return *this;
  }
  T* get() const { return value_; }
  T* operator->() const { return value_; }
  T& operator*() const { return *value_; }
  operator T*() const { return value_; }
  explicit operator bool() const { return value_ != nullptr; }
  T* ExtractAsDangling() { return std::exchange(value_, nullptr); }

 private:
  T* value_ = nullptr;
};

namespace gfx {
using NativeView = void*;
using NativeWindow = void*;
class Size {
 public:
  constexpr Size() = default;
  constexpr Size(int width, int height) : width_(width), height_(height) {}
  constexpr int width() const { return width_; }
  constexpr int height() const { return height_; }
  friend bool operator==(const Size&, const Size&) = default;

 private:
  int width_ = 0;
  int height_ = 0;
};
class Rect {
 public:
  Rect() = default;
  Rect(int x, int y, int width, int height) : x_(x), y_(y), width_(width), height_(height) {}
  int x() const { return x_; }
  int y() const { return y_; }
  int width() const { return width_; }
  int height() const { return height_; }
  bool IsEmpty() const { return width_ <= 0 || height_ <= 0; }
  friend bool operator==(const Rect&, const Rect&) = default;

 private:
  int x_ = 0, y_ = 0, width_ = 0, height_ = 0;
};
struct RectF {
  RectF(double x, double y, double width, double height) : x(x), y(y), width(width), height(height) {}
  double x, y, width, height;
};
inline Rect ToEnclosingRect(const RectF& r) {
  const int left = static_cast<int>(std::floor(r.x));
  const int top = static_cast<int>(std::floor(r.y));
  return Rect(left, top, static_cast<int>(std::ceil(r.x + r.width)) - left, static_cast<int>(std::ceil(r.y + r.height)) - top);
}
}

class GURL {
 public:
  explicit GURL(std::string spec) : spec_(std::move(spec)) {}
  bool is_valid() const { return !spec_.empty() && spec_.find(' ') == std::string::npos; }
  const std::string& spec() const { return spec_; }

 private:
  std::string spec_;
};

namespace input {
struct NativeWebKeyboardEvent;
}

namespace content {
class BrowserContext {
 public:
  virtual ~BrowserContext() = default;
};
class NavigationEntry;
class RenderWidgetHostView {
 public:
  void EnableAutoResize(const gfx::Size& min, const gfx::Size& max) {
    auto_min = min;
    auto_max = max;
    ++auto_resizes;
  }
  gfx::Size auto_min, auto_max;
  int auto_resizes = 0;
};
class RenderFrameHost {
 public:
  RenderWidgetHostView* GetView() { return &view; }
  bool IsRenderFrameLive() const { return true; }
  RenderWidgetHostView view;
};
class WebContentsObserver;
class WebContents {
 public:
  gfx::NativeView GetNativeView() { return this; }
  RenderFrameHost* GetPrimaryMainFrame() { return &frame; }
  GURL GetVisibleURL() const { return GURL(url); }
  std::string GetTitle() const { return title; }
  bool IsLoading() const { return loading; }
  void Focus() { ++focuses; }
  BrowserContext* GetBrowserContext() const { return context; }
  BrowserContext* context = nullptr;
  std::vector<WebContentsObserver*> observers;
  RenderFrameHost frame;
  std::string url;
  std::string title;
  bool loading = true;
  int focuses = 0;
  void Destroy();
};
class WebContentsObserver {
 public:
  WebContentsObserver() = default;
  explicit WebContentsObserver(WebContents* contents) { Observe(contents); }
  virtual ~WebContentsObserver() { Observe(nullptr); }
  virtual void WebContentsDestroyed() {}
  void Observe(WebContents* contents) {
    if (observed_) std::erase(observed_->observers, this);
    observed_ = contents;
    if (observed_) observed_->observers.push_back(this);
  }
  WebContents* web_contents() const { return observed_; }
  virtual void DidStartLoading() {}
  virtual void DidStopLoading() {}
  virtual void TitleWasSet(NavigationEntry*) {}
  virtual void RenderFrameHostChanged(RenderFrameHost*, RenderFrameHost*) {}

 private:
  WebContents* observed_ = nullptr;
};
inline void WebContents::Destroy() {
  for (auto* observer : std::vector<WebContentsObserver*>(observers)) observer->WebContentsDestroyed();
}
}

class Profile : public content::BrowserContext {
 public:
  bool IsOffTheRecord() const { return off_the_record; }
  bool ShutdownStarted() const { return shutdown_started; }
  Profile* GetOriginalProfile() { return original ? original : this; }
  Profile* original = nullptr;
  bool off_the_record = false;
  bool shutdown_started = false;
  std::set<std::string> incognito_enabled;
};

namespace extensions::util {
inline bool IsIncognitoEnabled(const std::string& id, const Profile* profile) {
  return profile->incognito_enabled.contains(id);
}
}

class BrowserWindowInterface {};

namespace extensions {

enum class UnloadedExtensionReason { UNINSTALL, DISABLE };

class Extension {
 public:
  explicit Extension(std::string id) : id_(std::move(id)) {}
  const std::string& id() const { return id_; }

 private:
  std::string id_;
};

class ExtensionHost;

class ExtensionView {
 public:
  virtual ~ExtensionView() = default;
  virtual gfx::NativeView GetNativeView() = 0;
  virtual void ResizeDueToAutoResize(content::WebContents* web_contents, const gfx::Size& new_size) = 0;
  virtual void RenderFrameCreated(content::RenderFrameHost* render_frame_host) = 0;
  virtual bool HandleKeyboardEvent(content::WebContents* source, const input::NativeWebKeyboardEvent& event) = 0;
  virtual void OnLoaded() = 0;
};

inline int& LiveHosts() {
  static int hosts = 0;
  return hosts;
}

class ExtensionHost {
 public:
  using CloseHandler = base::OnceCallback<void(ExtensionHost*)>;
  ExtensionHost(content::BrowserContext* context, std::string extension_id, std::string url)
      : context_(context), extension_id_(std::move(extension_id)) {
    contents_->url = std::move(url);
    ++LiveHosts();
  }
  virtual ~ExtensionHost() { --LiveHosts(); }
  const std::string& extension_id() const { return extension_id_; }
  content::WebContents* host_contents() const { return contents_.get(); }
  content::BrowserContext* browser_context() const { return context_; }
  bool has_loaded_once() const { return loaded_; }
  bool document_element_available() const { return document_; }
  void SetCloseHandler(CloseHandler handler) { close_ = std::move(handler); }
  void CreateRendererSoon() { ++renderers; }
  void Close() {
    if (close_) std::move(close_).Run(this);
  }
  void FinishLoad(bool document);
  int renderers = 0;

 protected:
  content::BrowserContext* context_;
  std::string extension_id_;
  std::unique_ptr<content::WebContents> contents_ = std::make_unique<content::WebContents>();
  CloseHandler close_;
  bool loaded_ = false;
  bool document_ = false;
};

class ExtensionViewHost : public ExtensionHost {
 public:
  using ExtensionHost::ExtensionHost;
  void set_view(ExtensionView* view) { view_ = view; }
  ExtensionView* view() { return view_; }

 private:
  ExtensionView* view_ = nullptr;
};

inline void ExtensionHost::FinishLoad(bool document) {
  loaded_ = true;
  document_ = document;
  contents_->loading = false;
  if (auto* view = static_cast<ExtensionViewHost*>(this)->view()) view->OnLoaded();
}

class ExtensionRegistryObserver {
 public:
  virtual ~ExtensionRegistryObserver() = default;
  virtual void OnExtensionUnloaded(content::BrowserContext*, const Extension*, UnloadedExtensionReason) {}
  virtual void OnShutdown(class ExtensionRegistry*) {}
};

class ExtensionSet {
 public:
  const Extension* GetByID(const std::string& id) const {
    auto found = extensions.find(id);
    return found == extensions.end() ? nullptr : found->second.get();
  }
  std::map<std::string, std::unique_ptr<Extension>> extensions;
};

class ExtensionRegistry {
 public:
  static ExtensionRegistry* Get(content::BrowserContext* context) {
    static std::map<content::BrowserContext*, std::unique_ptr<ExtensionRegistry>> registries;
    auto& registry = registries[context];
    if (!registry) registry = std::make_unique<ExtensionRegistry>();
    return registry.get();
  }
  const ExtensionSet& enabled_extensions() const { return enabled; }
  void AddObserver(ExtensionRegistryObserver* observer) { observers.push_back(observer); }
  void RemoveObserver(ExtensionRegistryObserver* observer) { std::erase(observers, observer); }
  void Enable(const std::string& id) { enabled.extensions[id] = std::make_unique<Extension>(id); }
  void Unload(content::BrowserContext* context, const std::string& id) {
    auto extension = std::move(enabled.extensions[id]);
    enabled.extensions.erase(id);
    for (auto* observer : std::vector<ExtensionRegistryObserver*>(observers))
      observer->OnExtensionUnloaded(context, extension.get(), UnloadedExtensionReason::DISABLE);
  }
  ExtensionSet enabled;
  std::vector<ExtensionRegistryObserver*> observers;
};

class ExtensionHostRegistry {
 public:
  class Observer {
   public:
    virtual ~Observer() = default;
    virtual void OnExtensionHostRenderProcessGone(content::BrowserContext*, ExtensionHost*) {}
    virtual void OnExtensionHostRegistryShutdown(ExtensionHostRegistry*) {}
  };
  static ExtensionHostRegistry* Get(content::BrowserContext* context) {
    static std::map<content::BrowserContext*, std::unique_ptr<ExtensionHostRegistry>> registries;
    auto& registry = registries[context];
    if (!registry) registry = std::make_unique<ExtensionHostRegistry>();
    return registry.get();
  }
  void AddObserver(Observer* observer) { observers.push_back(observer); }
  void RemoveObserver(Observer* observer) { std::erase(observers, observer); }
  void Gone(content::BrowserContext* context, ExtensionHost* host) {
    for (auto* observer : std::vector<Observer*>(observers)) observer->OnExtensionHostRenderProcessGone(context, host);
  }
  std::vector<Observer*> observers;
};

struct FactoryLog {
  std::string kind;
  std::string url;
  BrowserWindowInterface* browser = nullptr;
  content::BrowserContext* context = nullptr;
  ExtensionViewHost* host = nullptr;
  bool fail = false;
};
inline FactoryLog& Factory() {
  static FactoryLog log;
  return log;
}

class ExtensionViewHostFactory {
 public:
  static std::unique_ptr<ExtensionViewHost> Create(const char* kind, const Extension& extension, const GURL& url,
                                                   BrowserWindowInterface* browser, content::BrowserContext* context) {
    Factory().kind = kind;
    Factory().url = url.spec();
    Factory().browser = browser;
    if (Factory().fail) return nullptr;
    auto host = std::make_unique<ExtensionViewHost>(context, extension.id(), url.spec());
    Factory().host = host.get();
    return host;
  }
  static std::unique_ptr<ExtensionViewHost> CreatePopupHost(const Extension& extension, const GURL& url,
                                                            BrowserWindowInterface* browser);
  static std::unique_ptr<ExtensionViewHost> CreateSidePanelHost(const Extension& extension, const GURL& url,
                                                                BrowserWindowInterface* browser, void* tab);
};

}

namespace extensions {
inline std::unique_ptr<ExtensionViewHost> ExtensionViewHostFactory::CreatePopupHost(const Extension& extension, const GURL& url,
                                                                                   BrowserWindowInterface* browser) {
  return Create("popup", extension, url, browser, Factory().context);
}
inline std::unique_ptr<ExtensionViewHost> ExtensionViewHostFactory::CreateSidePanelHost(const Extension& extension, const GURL& url,
                                                                                       BrowserWindowInterface* browser, void*) {
  return Create("sidePanel", extension, url, browser, Factory().context);
}
}

using ShowPopupCallback = base::OnceCallback<void(extensions::ExtensionHost*)>;

namespace views {
class View {
 public:
  virtual ~View() = default;
  template <class T> T* AddChildView(std::unique_ptr<T> view) {
    T* raw = view.get();
    children_.push_back(std::move(view));
    return raw;
  }
  template <class T> std::unique_ptr<T> RemoveChildViewT(T* view) {
    auto found = std::find_if(children_.begin(), children_.end(), [&](const auto& child) { return child.get() == view; });
    assert(found != children_.end());
    std::unique_ptr<View> owned = std::move(*found);
    children_.erase(found);
    return std::unique_ptr<T>(static_cast<T*>(owned.release()));
  }
  void ReorderChildView(View* view, size_t index) {
    auto found = std::find_if(children_.begin(), children_.end(), [&](const auto& child) { return child.get() == view; });
    assert(found != children_.end());
    std::unique_ptr<View> owned = std::move(*found);
    children_.erase(found);
    index = std::min(index, children_.size());
    children_.insert(children_.begin() + static_cast<std::ptrdiff_t>(index), std::move(owned));
  }
  std::vector<View*> children() const {
    std::vector<View*> out;
    for (const auto& child : children_) out.push_back(child.get());
    return out;
  }
  int width() const { return bounds_.width(); }
  int height() const { return bounds_.height(); }
  void SetBoundsRect(const gfx::Rect& bounds) { bounds_ = bounds; }
  const gfx::Rect& bounds() const { return bounds_; }
  void SetVisible(bool visible) { visible_ = visible; }
  bool GetVisible() const { return visible_; }
  void RequestFocus() { ++focus_requests; }
  int focus_requests = 0;

 private:
  std::vector<std::unique_ptr<View>> children_;
  gfx::Rect bounds_;
  bool visible_ = true;
};

class WebView : public View {
 public:
  explicit WebView(content::BrowserContext*) {}
  ~WebView() override { assert(!contents_); }
  void SetWebContents(content::WebContents* contents) { contents_ = contents; }
  content::WebContents* web_contents() const { return contents_; }

 private:
  content::WebContents* contents_ = nullptr;
};
}
