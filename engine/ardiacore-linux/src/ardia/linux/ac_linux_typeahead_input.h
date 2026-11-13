#ifndef ARDIA_LINUX_AC_LINUX_TYPEAHEAD_INPUT_H_
#define ARDIA_LINUX_AC_LINUX_TYPEAHEAD_INPUT_H_

#include <optional>
#include <string>
#include <vector>

#include "ardia/linux/ac_linux_typeahead.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "build/build_config.h"
#include "ui/base/ime/input_method_observer.h"
#include "ui/base/ime/text_input_client.h"
#include "ui/events/event.h"
#include "ui/events/event_rewriter.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/keyboard_codes.h"

namespace aura {
class Window;
class WindowTreeHost;
}

namespace ui {
class InputMethod;
}

namespace ardia::linux_window {

int TypeaheadModifierFlag(ui::KeyboardCode key);

class TypeaheadInput : public ui::EventRewriter, public ui::InputMethodObserver, public ui::TextInputClient {
 public:
  using Owns = base::RepeatingCallback<bool(aura::Window* target)>;
  using Live = base::RepeatingCallback<ShortcutKind(const ui::KeyEvent& event)>;

  TypeaheadInput(aura::WindowTreeHost* host, ui::InputMethod* input, Owns owns);
  TypeaheadInput(const TypeaheadInput&) = delete;
  TypeaheadInput& operator=(const TypeaheadInput&) = delete;
  ~TypeaheadInput() override;

  void Start();
  bool capturing() const { return held_.capturing(); }
  void SetLive(Live live) { live_ = std::move(live); }
  std::vector<ui::KeyEvent> Release();

  ui::EventDispatchDetails RewriteEvent(const ui::Event& event, const Continuation continuation) override;

  void OnFocus() override {}
  void OnBlur() override {}
  void OnCaretBoundsChanged(const ui::TextInputClient* client) override {}
  void OnTextInputStateChanged(const ui::TextInputClient* client) override;
  void OnInputMethodDestroyed(const ui::InputMethod* input_method) override;

  base::WeakPtr<ui::TextInputClient> AsWeakPtr() override;
  void SetCompositionText(const ui::CompositionText& composition) override {}
  size_t ConfirmCompositionText(bool keep_selection) override;
  void ClearCompositionText() override {}
  void InsertText(const std::u16string& text, InsertTextCursorBehavior cursor_behavior) override {}
  void InsertChar(const ui::KeyEvent& event) override {}
  ui::TextInputType GetTextInputType() const override;
  ui::TextInputMode GetTextInputMode() const override;
  base::i18n::TextDirection GetTextDirection() const override;
  int GetTextInputFlags() const override;
  bool CanComposeInline() const override;
  gfx::Rect GetCaretBounds() const override;
  gfx::Rect GetSelectionBoundingBox() const override;
#if BUILDFLAG(IS_WIN)
  std::optional<gfx::Rect> GetProximateCharacterBounds(const gfx::Range& range) const override;
  std::optional<size_t> GetProximateCharacterIndexFromPoint(const gfx::Point& screen_point_in_dips,
                                                            IndexFromPointFlags flags) const override;
#endif
  bool GetCompositionCharacterBounds(size_t index, gfx::Rect* rect) const override;
  bool HasCompositionText() const override;
  ui::TextInputClient::FocusReason GetFocusReason() const override;
  bool GetTextRange(gfx::Range* range) const override;
  bool GetCompositionTextRange(gfx::Range* range) const override;
  bool GetEditableSelectionRange(gfx::Range* range) const override;
  bool SetEditableSelectionRange(const gfx::Range& range) override;
#if BUILDFLAG(IS_MAC)
  bool DeleteRange(const gfx::Range& range) override;
#endif
  bool GetTextFromRange(const gfx::Range& range, std::u16string* text) const override;
  void OnInputMethodChanged() override {}
  bool ChangeTextDirectionAndLayoutAlignment(base::i18n::TextDirection direction) override;
  void ExtendSelectionAndDelete(size_t before, size_t after) override {}
  void EnsureCaretNotInRect(const gfx::Rect& rect) override {}
  bool IsTextEditCommandEnabled(ui::TextEditCommand command) const override;
  void SetTextEditCommandForNextKeyEvent(ui::TextEditCommand command) override {}
  ukm::SourceId GetClientSourceForMetrics() const override;
  bool ShouldDoLearning() override;
#if BUILDFLAG(IS_WIN) || BUILDFLAG(IS_LINUX) || BUILDFLAG(IS_CHROMEOS)
  bool SetCompositionFromExistingText(const gfx::Range& range,
                                      const std::vector<ui::ImeTextSpan>& ui_ime_text_spans) override;
#endif
#if BUILDFLAG(IS_CHROMEOS)
  gfx::Range GetAutocorrectRange() const override;
  gfx::Rect GetAutocorrectCharacterBounds() const override;
  bool SetAutocorrectRange(const gfx::Range& range) override;
#endif
  void GetActiveTextInputControlLayoutBounds(std::optional<gfx::Rect>* control_bounds,
                                             std::optional<gfx::Rect>* selection_bounds) override {}
#if BUILDFLAG(IS_WIN)
  void SetActiveCompositionForAccessibility(const gfx::Range& range, const std::u16string& active_composition_text,
                                            bool is_composition_committed) override {}
#endif

 private:
  void Stop();
  aura::Window* FocusedTarget() const;

  raw_ptr<aura::WindowTreeHost> host_;
  raw_ptr<ui::InputMethod> input_;
  Owns owns_;
  Typeahead<ui::KeyEvent> held_;
  Live live_;
  LiveKeys<ui::DomCode> live_keys_;
  base::WeakPtr<ui::TextInputClient> wanted_;
  bool rewriting_ = false;
  bool observing_ = false;
  base::WeakPtrFactory<ui::TextInputClient> weak_factory_{this};
};

}

#endif
