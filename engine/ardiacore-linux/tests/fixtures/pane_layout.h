#pragma once

#include <algorithm>
#include <cassert>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace base {
template <typename T> class WeakPtr {
 public:
  WeakPtr() = default;
  WeakPtr(T* value, std::weak_ptr<bool> alive) : value_(value), alive_(std::move(alive)) {}
  T* get() const { return alive_.expired() ? nullptr : value_; }
  T* operator->() const { return get(); }
  explicit operator bool() const { return get(); }
 private:
  T* value_ = nullptr;
  std::weak_ptr<bool> alive_;
};
template <typename T> class WeakPtrFactory {
 public:
  explicit WeakPtrFactory(T* value) : value_(value) {}
  WeakPtr<T> GetWeakPtr() { return {value_, alive_}; }
 private:
  T* value_;
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
};
class OnceClosure {
 public:
  OnceClosure() = default;
  template <typename F> OnceClosure(F fn) : fn_(std::move(fn)) {}
  explicit operator bool() const { return static_cast<bool>(fn_); }
  void Run() && { auto fn = std::move(fn_); if (fn) fn(); }
 private:
  std::function<void()> fn_;
};
template <typename F, typename... Bound> OnceClosure BindOnce(F fn, Bound... bound) {
  return OnceClosure([fn, bound...]() mutable { fn(std::move(bound)...); });
}
struct DictValue {
  DictValue& Set(const char*, const char* value) { type = value; return *this; }
  std::string type;
};
template <typename T> class AutoReset {
 public:
  AutoReset(T* target, T value) : target_(target), previous_(*target) { *target_ = std::move(value); }
  ~AutoReset() { *target_ = std::move(previous_); }
 private:
  T* target_;
  T previous_;
};
}

namespace gfx {
struct Vector2d {
  int x = 0, y = 0;
};
struct Size {
  int width = 0, height = 0;
};
struct Rect {
  int x_ = 0, y_ = 0, w_ = 0, h_ = 0;
  Rect() = default;
  Rect(int x, int y, int w, int h) : x_(x), y_(y), w_(w), h_(h) {}
  explicit Rect(Size size) : w_(size.width), h_(size.height) {}
  int x() const { return x_; }
  int y() const { return y_; }
  int width() const { return w_; }
  int height() const { return h_; }
  Size size() const { return {w_, h_}; }
  bool IsEmpty() const { return w_ <= 0 || h_ <= 0; }
  Vector2d OffsetFromOrigin() const { return {x_, y_}; }
  void Offset(int dx, int dy) { x_ += dx; y_ += dy; }
  void Intersect(const Rect& other) {
    const int left = std::max(x_, other.x_), top = std::max(y_, other.y_);
    const int right = std::min(x_ + w_, other.x_ + other.w_), bottom = std::min(y_ + h_, other.y_ + other.h_);
    if (right <= left || bottom <= top) { *this = Rect(); return; }
    *this = Rect(left, top, right - left, bottom - top);
  }
  bool operator==(const Rect&) const = default;
};
inline Rect operator+(Rect rect, Vector2d offset) { rect.Offset(offset.x, offset.y); return rect; }
struct RoundedCornersF { explicit RoundedCornersF(float) {} };
}

namespace aura {
struct Window {
  void Show() { shows++; visible = true; }
  void Hide() { visible = false; }
  bool IsVisible() const { return visible; }
  bool visible = true;
  int shows = 0;
};
}

namespace content {
class WebContents;
class WebContentsObserver {
 public:
  explicit WebContentsObserver(WebContents* contents = nullptr) { Observe(contents); }
  virtual ~WebContentsObserver() { Observe(nullptr); }
  void Observe(WebContents* contents);
  WebContents* web_contents() const { return observed_; }
  virtual void WebContentsDestroyed() {}
 private:
  WebContents* observed_ = nullptr;
};
class WebContents {
 public:
  ~WebContents() { Destroy(); }
  void Destroy() {
    if (destroyed) return;
    destroyed = true;
    auto pending = observers;
    for (auto* observer : pending) observer->WebContentsDestroyed();
    alive.reset();
  }
  base::WeakPtr<WebContents> GetWeakPtr() { return {this, alive}; }
  aura::Window* GetNativeView() { return &native; }
  void Focus() {
    focuses++;
    auto hook = focused;
    if (hook) hook();
  }
  std::function<void()> focused;
  aura::Window native;
  int focuses = 0;
  bool destroyed = false;
  std::vector<WebContentsObserver*> observers;
  std::shared_ptr<bool> alive = std::make_shared<bool>(true);
};
inline void WebContentsObserver::Observe(WebContents* contents) {
  if (observed_) std::erase(observed_->observers, this);
  observed_ = contents;
  if (observed_) observed_->observers.push_back(this);
}
}

struct DevToolsContentsResizingStrategy {
  bool hide_inspected_contents() const { return hide; }
  int width = 0;
  bool hide = false;
};
inline void ApplyDevToolsContentsResizingStrategy(const DevToolsContentsResizingStrategy& strategy,
                                                  const gfx::Rect& container, gfx::Rect* devtools,
                                                  gfx::Rect* page) {
  *devtools = container;
  *page = gfx::Rect(container.x(), container.y(), container.width() - strategy.width, container.height());
}
struct DevToolsWindow {
  static content::WebContents* GetInTabWebContents(content::WebContents* inspected,
                                                   DevToolsContentsResizingStrategy* strategy) {
    const auto found = docked.find(inspected);
    if (found == docked.end() || !found->second || found->second->destroyed) return nullptr;
    if (strategy) *strategy = strategies[inspected];
    return found->second;
  }
  static DevToolsWindow* AsDevToolsWindow(content::WebContents* contents) {
    static DevToolsWindow window;
    return contents && !companions.contains(contents) ? &window : nullptr;
  }
  static inline std::set<content::WebContents*> companions;
  static inline std::map<content::WebContents*, content::WebContents*> docked;
  static inline std::map<content::WebContents*, DevToolsContentsResizingStrategy> strategies;
};

namespace views {
class View {
 public:
  virtual ~View() = default;
  bool Contains(const View* view) const { return view == this; }
  void RequestFocus();
  void SetVisible(bool value) { visible_ = value; }
  bool GetVisible() const { return visible_; }
  void SetBoundsRect(const gfx::Rect& bounds) { bounds_ = bounds; }
  const gfx::Rect& bounds() const { return bounds_; }
 private:
  bool visible_ = true;
  gfx::Rect bounds_;
};
class FocusManager {
 public:
  View* GetFocusedView() const { return focused; }
  View* focused = nullptr;
};
inline FocusManager focus_manager;
inline void View::RequestFocus() { focus_manager.focused = this; }
struct NativeViewHolder { void SetNativeViewCornerRadii(gfx::RoundedCornersF) {} };
class WebView : public View {
 public:
  void SetWebContents(content::WebContents* contents) {
    if (contents && contents != contents_ && GetVisible()) contents->GetNativeView()->Show();
    contents_ = contents;
  }
  content::WebContents* web_contents() const { return contents_; }
  NativeViewHolder* holder() { return &holder_; }
 private:
  content::WebContents* contents_ = nullptr;
  NativeViewHolder holder_;
};
}

class ViewportView : public views::WebView {
 public:
  explicit ViewportView(int) {}
  void SetShape(std::vector<gfx::Rect> paint, std::vector<gfx::Rect> input) {
    paint_shape = std::move(paint);
    input_shape = std::move(input);
  }
  std::vector<gfx::Rect> paint_shape;
  std::vector<gfx::Rect> input_shape;
};

struct ContentsContainerView {
  views::WebView* devtools_web_view() { return &devtools; }
  views::WebView devtools;
};
struct BrowserView {
  views::WebView* GetActiveContentsWebView() { return &contents; }
  ContentsContainerView* GetContentsContainerViewFor(content::WebContents* inspected) {
    return containers.contains(inspected) ? &containers[inspected] : nullptr;
  }
  views::WebView contents;
  std::map<content::WebContents*, ContentsContainerView> containers;
};

inline std::vector<base::OnceClosure> posted;
inline void DrainPosted() {
  while (!posted.empty()) {
    auto pending = std::move(posted);
    posted.clear();
    for (auto& task : pending) std::move(task).Run();
  }
}

inline std::map<content::WebContents*, int> tab_ids;
inline int TabId(content::WebContents* contents) { return tab_ids.contains(contents) ? tab_ids.at(contents) : 0; }

namespace ardiacore {
inline std::vector<content::WebContents*> forgotten_hangs;
inline void ForgetDeferredLinuxHangs(content::WebContents* contents) { forgotten_hangs.push_back(contents); }
}

class ShellHostView;
ARDIA_FRONTEND_WATCH

class TabBinding {
 public:
  TabBinding(ShellHostView* owner, content::WebContents* contents) : owner_(owner), contents_(contents) {}
  content::WebContents* contents() const { return contents_; }
  views::WebView* viewport() const { return viewport_; }
  views::WebView* devtools_viewport() const { return devtools_viewport_; }
  void SetDevToolsViewport(views::WebView* view) { devtools_viewport_ = view; }
  void ResetPageCommands() { resets++; }
  std::unique_ptr<int> media = std::make_unique<int>(1);
  struct Page {
    TabBinding* binding;
    bool EmitClosed();
  };
  std::unique_ptr<Page> page_ = std::make_unique<Page>(Page{this});
  void RetirePage() { page_.reset(); }
  void ReportPresentation(std::string name, base::DictValue data);
  struct Weak {
    TabBinding* binding;
    explicit operator bool() const { return binding; }
  };
  Weak GetWeakPtr() { return {this}; }
  void WebContentsDestroyed();
  void FocusFromHost();
  void OnWebContentsFocused(void*);
  bool presented = true;
  bool host_focusing_ = false;
  std::unique_ptr<DevToolsFrontendWatch> devtools_watch;
  bool devtools_had_focus = false;
  gfx::Rect pane_bounds;
  std::vector<gfx::Rect> pane_shape;
  std::vector<gfx::Rect> pane_input_shape;
  bool pane_visible = false;
  std::string claim = "claim";
  uint64_t renderer_generation = 1;
  int resets = 0;
  ShellHostView* owner_;
  content::WebContents* contents_;
  views::WebView* viewport_ = nullptr;
  views::WebView* devtools_viewport_ = nullptr;
};

class ShellHostView : public views::View {
 public:
  ShellHostView();
  ~ShellHostView();
  void LayoutPane(TabBinding* binding);
  void OnDevToolsDockChanged(content::WebContents* inspected, content::WebContents* devtools);
  void HideDevToolsViewport(TabBinding* binding);
  TabBinding* Binding(int id) {
    for (auto& binding : bindings) {
      if (TabId(binding->contents()) == id) return binding.get();
    }
    return nullptr;
  }
  void PresentDevTools(content::WebContents* inspected) {
    if (!inspected) return;
    posted.push_back(base::BindOnce(
        [](base::WeakPtr<ShellHostView> host, base::WeakPtr<content::WebContents> contents) {
          if (!host || !contents) return;
          for (auto& binding : host->bindings) {
            if (binding->contents() == contents.get()) host->LayoutPane(binding.get());
          }
        }, GetWeakPtr(), inspected->GetWeakPtr()));
  }
  views::FocusManager* GetFocusManager() { return &views::focus_manager; }
  template <typename T> T* AddChildView(std::unique_ptr<T> view) {
    T* raw = view.get();
    children.push_back(std::move(view));
    return raw;
  }
  std::optional<size_t> GetIndexOf(const views::View* view) const {
    for (size_t index = 0; index < children.size(); ++index) {
      if (children[index].get() == view) return index;
    }
    return std::nullopt;
  }
  void ReorderChildView(views::View* view, size_t index) {
    auto found = std::find_if(children.begin(), children.end(), [view](const auto& child) { return child.get() == view; });
    auto moved = std::move(*found);
    children.erase(found);
    children.insert(children.begin() + std::min(index, children.size()), std::move(moved));
  }
  int profile() const { return 0; }
  int page_profile() const { return 0; }
  base::WeakPtr<ShellHostView> GetWeakPtr() { return weak.GetWeakPtr(); }
  TabBinding* Bind(content::WebContents* contents, int id) {
    tab_ids[contents] = id;
    bindings.push_back(std::make_unique<TabBinding>(this, contents));
    auto* binding = bindings.back().get();
    binding->viewport_ = AddChildView(std::make_unique<ViewportView>(0));
    binding->renderer_generation = renderer_generation_;
    return binding;
  }
  void Show(TabBinding* binding, bool visible) {
    binding->pane_bounds = gfx::Rect(100, 50, 800, 600);
    binding->pane_shape = {gfx::Rect(0, 0, 800, 600)};
    binding->pane_input_shape = {gfx::Rect(0, 0, 800, 600)};
    binding->pane_visible = visible;
    LayoutPane(binding);
  }
  std::vector<std::unique_ptr<views::View>> children;
  std::vector<std::unique_ptr<TabBinding>> bindings;
  std::vector<int> closes;
  std::vector<std::pair<int, std::string>> events;
  BrowserView browser_view_storage;
  BrowserView* browser_view_ = &browser_view_storage;
  int handler_storage = 0;
  int* handler_ = &handler_storage;
  uint64_t renderer_generation_ = 1;
  base::WeakPtrFactory<ShellHostView> weak{this};
};

inline std::map<int, ShellHostView*>& Hosts() {
  static std::map<int, ShellHostView*> hosts;
  return hosts;
}

inline ShellHostView::ShellHostView() { Hosts()[static_cast<int>(Hosts().size()) + 1] = this; }
inline ShellHostView::~ShellHostView() {
  std::erase_if(Hosts(), [this](const auto& entry) { return entry.second == this; });
}

inline bool TabBinding::Page::EmitClosed() {
  binding->owner_->closes.push_back(TabId(binding->contents_));
  return true;
}
inline void TabBinding::ReportPresentation(std::string name, base::DictValue) {
  if (page_) owner_->events.emplace_back(TabId(contents_), std::move(name));
}

ARDIA_HOST_METHODS
