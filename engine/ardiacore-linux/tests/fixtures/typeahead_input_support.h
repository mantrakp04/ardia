#ifndef ARDIA_TESTS_TYPEAHEAD_INPUT_SUPPORT_H_
#define ARDIA_TESTS_TYPEAHEAD_INPUT_SUPPORT_H_

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

#define BUILDFLAG(flag) (BUILDFLAG_##flag)
#define BUILDFLAG_IS_LINUX 1
#define BUILDFLAG_IS_WIN 0
#define BUILDFLAG_IS_MAC 0
#define BUILDFLAG_IS_CHROMEOS 0

template <class T> using raw_ptr = T*;

namespace base {

template <class Signature> class RepeatingCallback;
template <class R, class... A> class RepeatingCallback<R(A...)> {
 public:
  RepeatingCallback() = default;
  template <class F>
    requires std::is_invocable_r_v<R, const F&, A...>
  RepeatingCallback(F f) : f_(std::move(f)) {}
  R Run(A... args) const { return f_(std::forward<A>(args)...); }
  explicit operator bool() const { return static_cast<bool>(f_); }

 private:
  std::function<R(A...)> f_;
};

template <class T> class WeakPtr {
 public:
  WeakPtr() = default;
  WeakPtr(std::nullptr_t) {}
  explicit WeakPtr(std::shared_ptr<T*> target) : target_(std::move(target)) {}
  explicit operator bool() const { return target_ && *target_; }
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

namespace i18n {
enum TextDirection { UNKNOWN_DIRECTION, RIGHT_TO_LEFT, LEFT_TO_RIGHT };
}

}

namespace ukm {
using SourceId = int64_t;
constexpr SourceId kInvalidSourceId = 0;
}

namespace gfx {
struct Rect {};
struct Point {};
struct Range {};
}

namespace ui {

enum class EventType { kKeyPressed, kKeyReleased, kMousePressed };
enum KeyboardCode {
  VKEY_UNKNOWN = 0,
  VKEY_TAB = 0x09,
  VKEY_SHIFT = 0x10,
  VKEY_CONTROL = 0x11,
  VKEY_MENU = 0x12,
  VKEY_L = 0x4C,
  VKEY_LWIN = 0x5B,
  VKEY_RWIN = 0x5C,
  VKEY_LSHIFT = 0xA0,
  VKEY_RSHIFT = 0xA1,
  VKEY_LCONTROL = 0xA2,
  VKEY_RCONTROL = 0xA3,
  VKEY_LMENU = 0xA4,
  VKEY_RMENU = 0xA5,
};
enum class DomCode : uint32_t {};
enum EventFlags {
  EF_NONE = 0,
  EF_SHIFT_DOWN = 1 << 1,
  EF_CONTROL_DOWN = 1 << 2,
  EF_ALT_DOWN = 1 << 3,
  EF_COMMAND_DOWN = 1 << 4,
};
enum TextInputType { TEXT_INPUT_TYPE_NONE, TEXT_INPUT_TYPE_TEXT };
enum TextInputMode { TEXT_INPUT_MODE_NONE, TEXT_INPUT_MODE_TEXT };
enum class TextEditCommand { kNone };
struct CompositionText {};
struct ImeTextSpan {};

class KeyEvent;
class Event {
 public:
  explicit Event(EventType type) : type_(type) {}
  virtual ~Event() = default;
  EventType type() const { return type_; }
  bool IsKeyEvent() const { return type_ == EventType::kKeyPressed || type_ == EventType::kKeyReleased; }
  const KeyEvent* AsKeyEvent() const;

 private:
  EventType type_;
};

class KeyEvent : public Event {
 public:
  KeyEvent(EventType type, char key)
      : Event(type), key(key), key_code_(static_cast<KeyboardCode>(key >= 'a' && key <= 'z' ? key - 'a' + 'A' : key)) {}
  KeyEvent(EventType type, KeyboardCode key_code, int flags) : Event(type), key(0), key_code_(key_code), flags_(flags) {}
  KeyEvent(const KeyEvent&) = default;
  KeyboardCode key_code() const { return key_code_; }
  DomCode code() const { return static_cast<DomCode>(key_code_); }
  int flags() const { return flags_; }
  char key;

 private:
  KeyboardCode key_code_;
  int flags_ = EF_NONE;
};
inline const KeyEvent* Event::AsKeyEvent() const { return static_cast<const KeyEvent*>(this); }

struct EventDispatchDetails {
  bool discarded = false;
};

class EventRewriter {
 public:
  struct Continuation {
    std::vector<const Event*>* sent;
  };
  virtual ~EventRewriter() = default;
  virtual EventDispatchDetails RewriteEvent(const Event& event, const Continuation continuation) = 0;

 protected:
  static EventDispatchDetails SendEvent(const Continuation continuation, const Event* event) {
    continuation.sent->push_back(event);
    return {};
  }
  static EventDispatchDetails DiscardEvent(const Continuation) { return {true}; }
};

class TextInputClient {
 public:
  enum class InsertTextCursorBehavior { kMoveCursorAfterText, kMoveCursorBeforeText };
  enum FocusReason { FOCUS_REASON_NONE, FOCUS_REASON_MOUSE };
  virtual ~TextInputClient() = default;
  virtual base::WeakPtr<TextInputClient> AsWeakPtr() = 0;
  virtual void SetCompositionText(const CompositionText&) = 0;
  virtual size_t ConfirmCompositionText(bool) = 0;
  virtual void ClearCompositionText() = 0;
  virtual void InsertText(const std::u16string&, InsertTextCursorBehavior) = 0;
  virtual void InsertChar(const KeyEvent&) = 0;
  virtual TextInputType GetTextInputType() const = 0;
  virtual TextInputMode GetTextInputMode() const = 0;
  virtual base::i18n::TextDirection GetTextDirection() const = 0;
  virtual int GetTextInputFlags() const = 0;
  virtual bool CanComposeInline() const = 0;
  virtual gfx::Rect GetCaretBounds() const = 0;
  virtual gfx::Rect GetSelectionBoundingBox() const = 0;
  virtual bool GetCompositionCharacterBounds(size_t, gfx::Rect*) const = 0;
  virtual bool HasCompositionText() const = 0;
  virtual FocusReason GetFocusReason() const = 0;
  virtual bool GetTextRange(gfx::Range*) const = 0;
  virtual bool GetCompositionTextRange(gfx::Range*) const = 0;
  virtual bool GetEditableSelectionRange(gfx::Range*) const = 0;
  virtual bool SetEditableSelectionRange(const gfx::Range&) = 0;
  virtual bool GetTextFromRange(const gfx::Range&, std::u16string*) const = 0;
  virtual void OnInputMethodChanged() = 0;
  virtual bool ChangeTextDirectionAndLayoutAlignment(base::i18n::TextDirection) = 0;
  virtual void ExtendSelectionAndDelete(size_t, size_t) = 0;
  virtual void EnsureCaretNotInRect(const gfx::Rect&) = 0;
  virtual bool IsTextEditCommandEnabled(TextEditCommand) const = 0;
  virtual void SetTextEditCommandForNextKeyEvent(TextEditCommand) = 0;
  virtual ukm::SourceId GetClientSourceForMetrics() const = 0;
  virtual bool ShouldDoLearning() = 0;
  virtual bool SetCompositionFromExistingText(const gfx::Range&, const std::vector<ImeTextSpan>&) = 0;
  virtual void GetActiveTextInputControlLayoutBounds(std::optional<gfx::Rect>*, std::optional<gfx::Rect>*) = 0;
};

class InputMethod;
class InputMethodObserver {
 public:
  virtual ~InputMethodObserver() = default;
  virtual void OnFocus() = 0;
  virtual void OnBlur() = 0;
  virtual void OnCaretBoundsChanged(const TextInputClient*) = 0;
  virtual void OnTextInputStateChanged(const TextInputClient*) = 0;
  virtual void OnInputMethodDestroyed(const InputMethod*) = 0;
};

class InputMethod {
 public:
  ~InputMethod() {
    for (auto* observer : std::vector<InputMethodObserver*>(observers)) observer->OnInputMethodDestroyed(this);
  }
  void SetFocusedTextInputClient(TextInputClient* client) {
    if (client_ == client) return;
    client_ = client;
    for (auto* observer : std::vector<InputMethodObserver*>(observers)) observer->OnTextInputStateChanged(client);
  }
  void DetachTextInputClient(TextInputClient* client) {
    if (client_ != client) return;
    client_ = nullptr;
    for (auto* observer : std::vector<InputMethodObserver*>(observers)) observer->OnTextInputStateChanged(nullptr);
  }
  TextInputClient* GetTextInputClient() const { return client_; }
  void AddObserver(InputMethodObserver* observer) { observers.push_back(observer); }
  void RemoveObserver(InputMethodObserver* observer) { std::erase(observers, observer); }
  std::vector<InputMethodObserver*> observers;

 private:
  TextInputClient* client_ = nullptr;
};

}

namespace aura {

class Window {};

namespace client {
class FocusClient {
 public:
  Window* focused = nullptr;
  Window* GetFocusedWindow() { return focused; }
};
inline std::map<Window*, FocusClient*>& FocusClients() {
  static std::map<Window*, FocusClient*> clients;
  return clients;
}
inline FocusClient* GetFocusClient(Window* window) {
  auto found = FocusClients().find(window);
  return found == FocusClients().end() ? nullptr : found->second;
}
}

class WindowTreeHost {
 public:
  Window* window() { return &root; }
  void AddEventRewriter(ui::EventRewriter* rewriter) { rewriters.push_back(rewriter); }
  void RemoveEventRewriter(ui::EventRewriter* rewriter) { std::erase(rewriters, rewriter); }
  bool Send(const ui::Event& event) {
    std::vector<const ui::Event*> sent;
    for (auto* rewriter : std::vector<ui::EventRewriter*>(rewriters)) {
      if (rewriter->RewriteEvent(event, {&sent}).discarded) return false;
    }
    return true;
  }
  Window root;
  std::vector<ui::EventRewriter*> rewriters;
};

}

#endif
