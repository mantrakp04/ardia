#pragma once
#include <algorithm>
#include <memory>
#include <string>
#include <string_view>
#include <vector>
#include "dialog_callbacks.h"

template<class T> using raw_ptr = T*;
namespace base {
template<class T, class O> class ScopedObservation {
  O* observer_;
  T* source_ = nullptr;
 public:
  explicit ScopedObservation(O* observer) : observer_(observer) {}
  ~ScopedObservation() { Reset(); }
  void Observe(T* source) { source_ = source; source_->AddObserver(observer_); }
  void Reset() { if (auto* source = std::exchange(source_, nullptr)) source->RemoveObserver(observer_); }
};
class SingleThreadTaskRunner {
 public:
  std::vector<OnceClosure> tasks;
  static SingleThreadTaskRunner* GetCurrentDefault() { static SingleThreadTaskRunner runner; return &runner; }
  void PostTask(int, OnceClosure task) { tasks.push_back(std::move(task)); }
  void Drain() {
    while (!tasks.empty()) {
      auto work = std::move(tasks); tasks.clear();
      for (auto& task : work) std::move(task).Run();
    }
  }
};
}
namespace ui {
inline constexpr int kColorAlertHighSeverity = 1;
inline constexpr int kColorDialogBackground = 2;
namespace mojom {
enum class DialogButton { kOk, kCancel };
enum class ModalType { kWindow };
}
}
namespace views {
class Widget;
class WidgetObserver {
 public:
  virtual ~WidgetObserver() = default;
  virtual void OnWidgetDestroying(Widget*) {}
  virtual void OnWidgetDestroyed(Widget*) {}
};
struct View { virtual ~View() = default; };
struct Textfield : View {
  std::u16string placeholder;
  bool selected = false;
  void SetPlaceholderText(std::u16string value) { placeholder = value; }
  void SelectAll(bool) { selected = true; }
};
struct MessageBoxView : View {
  std::u16string message;
  std::u16string suppression;
  std::u16string value;
  bool checked = false;
  bool prompt = false;
  Textfield field;
  explicit MessageBoxView(std::u16string text) : message(std::move(text)) {}
  void SetCheckBoxLabel(std::u16string label) { suppression = label; }
  void SetPromptField(std::u16string text) { prompt = true; value = text; }
  Textfield* GetVisiblePromptField() { return prompt ? &field : nullptr; }
  bool IsCheckBoxSelected() { return checked; }
  std::u16string_view GetInputText() { return value; }
};
struct MdTextButton {
  int bg = 0;
  int fg = 0;
  void SetBgColorIdOverride(int color) { bg = color; }
  void SetEnabledTextColors(int color) { fg = color; }
};
class DialogDelegate;
class Widget {
  std::vector<WidgetObserver*> observers_;
  base::WeakPtrFactory<Widget> weak_{this};
  bool closed_ = false;
  bool destroying_ = false;
 public:
  struct InitParams { enum Ownership { CLIENT_OWNS_WIDGET }; };
  enum class ClosedReason { kAcceptButtonClicked, kCancelButtonClicked, kUnspecified };
  DialogDelegate* delegate = nullptr;
  std::unique_ptr<View> contents;
  base::OnceCallback<void(ClosedReason)> close;
  inline static int shown = 0;
  inline static Widget* latest = nullptr;
  ~Widget() { DestroyNative(); weak_.InvalidateWeakPtrs(); }
  void AddObserver(WidgetObserver* value) { observers_.push_back(value); }
  void RemoveObserver(WidgetObserver* value) { std::erase(observers_, value); }
  void DestroyNative() {
    if (destroying_) return;
    destroying_ = true; closed_ = true;
    for (auto* observer : std::vector(observers_))
      if (std::find(observers_.begin(), observers_.end(), observer) != observers_.end()) observer->OnWidgetDestroying(this);
    contents.reset();
    for (auto* observer : std::vector(observers_))
      if (std::find(observers_.begin(), observers_.end(), observer) != observers_.end()) observer->OnWidgetDestroyed(this);
  }
  void CloseNow() { DestroyNative(); }
  bool IsClosed() const { return closed_; }
  bool is_destroying() const { return destroying_; }
  base::WeakPtr<Widget> GetWeakPtr() { return weak_.GetWeakPtr(); }
  void* GetNativeWindow() { return this; }
  void* GetNativeView() { return this; }
  void Show() { ++shown; latest = this; }
  void MakeCloseSynchronous(base::OnceCallback<void(ClosedReason)> callback) { close = std::move(callback); }
  void RequestClose(ClosedReason reason) { std::move(close).Run(reason); }
};
class DialogDelegate {
 public:
  std::u16string title;
  std::u16string ok;
  std::u16string cancel;
  ui::mojom::ModalType modal;
  Widget::InitParams::Ownership ownership;
  View* focus = nullptr;
  MdTextButton button;
  std::unique_ptr<View> contents;
  void SetOwnershipOfNewWidget(Widget::InitParams::Ownership value) { ownership = value; }
  void SetTitle(std::u16string value) { title = value; }
  void SetModalType(ui::mojom::ModalType value) { modal = value; }
  void SetButtonLabel(ui::mojom::DialogButton type, std::u16string value) { (type == ui::mojom::DialogButton::kOk ? ok : cancel) = value; }
  void SetInitiallyFocusedView(View* view) { focus = view; }
  void SetContentsView(std::unique_ptr<View> value) { contents = std::move(value); }
  MdTextButton* GetOkButton() { return &button; }
  static Widget* CreateDialogWidget(DialogDelegate* value, void* context, void* parent) {
    assert(parent && parent == context);
    auto widget = std::make_unique<Widget>();
    widget->delegate = value;
    widget->contents = std::move(value->contents);
    return widget.release();
  }
};
}
