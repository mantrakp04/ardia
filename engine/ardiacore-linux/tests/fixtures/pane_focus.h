#pragma once

#include <cassert>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace content { class WebContents; }

namespace views {
class View;
class WebView;
class FocusManager {
 public:
  View* GetFocusedView() const { return focused; }
  void ClearFocus() { focused = nullptr; }
  void AdvanceFocusIfNecessary();
  View* focused = nullptr;
  std::vector<WebView*> order;
  std::function<void(View*, View*)> changed;
};
inline FocusManager focus_manager;
class View {
 public:
  virtual ~View() = default;
  virtual void RequestFocus() {
    if (!IsFocusable()) return;
    View* before = focus_manager.focused;
    focus_manager.focused = this;
    if (focus_manager.changed) focus_manager.changed(before, this);
  }
  virtual bool IsFocusable() const { return visible; }
  bool GetVisible() const { return visible; }
  void SetVisible(bool value) { visible = value; }
  bool visible = true;
};
class WebView : public View {
 public:
  WebView() { focus_manager.order.push_back(this); }
  ~WebView() override { std::erase(focus_manager.order, this); }
  void RequestFocus() override;
  bool IsFocusable() const override { return visible && contents; }
  void SetWebContents(content::WebContents* replacement) {
    if (replacement == contents) return;
    contents = replacement;
    attaches += !!replacement;
    if (focus_manager.focused == this && !IsFocusable()) focus_manager.AdvanceFocusIfNecessary();
  }
  content::WebContents* web_contents() const { return contents; }
  content::WebContents* contents = nullptr;
  int attaches = 0;
};
}

namespace content {
class WebContents {
 public:
  void Focus() { focuses++; }
  int focuses = 0;
};
}
inline void views::WebView::RequestFocus() {
  if (!IsFocusable()) return;
  View::RequestFocus();
  contents->Focus();
}
inline void views::FocusManager::AdvanceFocusIfNecessary() {
  View* from = focused;
  focused = nullptr;
  for (WebView* view : order) {
    if (view != from && view->IsFocusable()) return view->RequestFocus();
  }
}

class ChromeWebContentsViewFocusHelper {
 public:
  static ChromeWebContentsViewFocusHelper* FromWebContents(content::WebContents* contents) {
    return &helpers[contents];
  }
  views::View* GetStoredFocus() { return stored && stored->IsFocusable() ? stored : nullptr; }
  void SetStoredFocusView(views::View* view) { stored = view; }
  void StoreFocus() { stored = views::focus_manager.focused; }
  bool RestoreFocus() {
    views::View* view = GetStoredFocus();
    stored = nullptr;
    if (!view) return false;
    view->RequestFocus();
    return true;
  }
  views::View* stored = nullptr;
  static inline std::map<content::WebContents*, ChromeWebContentsViewFocusHelper> helpers;
};

class TabBinding {
 public:
  content::WebContents* contents() const { return contents_; }
  views::WebView* viewport() const { return viewport_; }
  views::WebView* devtools_viewport() const { return devtools_viewport_; }
  void FocusFromHost() {
    host_focuses++;
    if (viewport_) viewport_->RequestFocus();
  }
  content::WebContents* contents_ = nullptr;
  views::WebView* viewport_ = nullptr;
  views::WebView* devtools_viewport_ = nullptr;
  int host_focuses = 0;
};

struct BrowserView {
  views::WebView* GetActiveContentsWebView() { return &active; }
  views::WebView active;
};

class ShellHostView {
 public:
  views::FocusManager* GetFocusManager() { return &views::focus_manager; }
  void KeepPaneFocus(TabBinding* activating);
  void ReattachViewports();
  void LayoutPane(TabBinding*) { layouts++; }
  void OnDidChangeFocus(views::View* before, views::View* now);
  BrowserView* browser_view_ = &browser_view;
  BrowserView browser_view;
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  std::map<int, bool> devtools_had_focus_;
  int layouts = 0;
};

ARDIA_HOST_METHODS
