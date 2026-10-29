#include "ardia/linux/ac_linux_typeahead_input.h"

#include <tuple>
#include <utility>

#include "base/i18n/rtl.h"
#include "services/metrics/public/cpp/ukm_source_id.h"
#include "ui/aura/client/focus_client.h"
#include "ui/aura/window.h"
#include "ui/aura/window_tree_host.h"
#include "ui/base/ime/input_method.h"
#include "ui/base/ime/text_input_mode.h"
#include "ui/base/ime/text_input_type.h"
#include "ui/events/event_constants.h"
#include "ui/events/keycodes/dom/dom_code.h"
#include "ui/events/keycodes/keyboard_codes.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/range/range.h"

namespace ardia::linux_window {

int TypeaheadModifierFlag(ui::KeyboardCode key) {
  switch (key) {
    case ui::VKEY_SHIFT:
    case ui::VKEY_LSHIFT:
    case ui::VKEY_RSHIFT:
      return ui::EF_SHIFT_DOWN;
    case ui::VKEY_CONTROL:
    case ui::VKEY_LCONTROL:
    case ui::VKEY_RCONTROL:
      return ui::EF_CONTROL_DOWN;
    case ui::VKEY_MENU:
    case ui::VKEY_LMENU:
    case ui::VKEY_RMENU:
      return ui::EF_ALT_DOWN;
    case ui::VKEY_LWIN:
    case ui::VKEY_RWIN:
      return ui::EF_COMMAND_DOWN;
    default:
      return ui::EF_NONE;
  }
}

TypeaheadInput::TypeaheadInput(aura::WindowTreeHost* host, ui::InputMethod* input, Owns owns)
    : host_(host), input_(input), owns_(std::move(owns)) {}

TypeaheadInput::~TypeaheadInput() {
  Stop();
}

void TypeaheadInput::Start() {
  if (held_.capturing() || !host_) return;
  held_.Start();
  if (!held_.capturing()) return;
  host_->AddEventRewriter(this);
  rewriting_ = true;
  if (!input_) return;
  if (ui::TextInputClient* current = input_->GetTextInputClient(); current && current != this) {
    wanted_ = current->AsWeakPtr();
  }
  input_->AddObserver(this);
  observing_ = true;
  input_->SetFocusedTextInputClient(this);
}

std::vector<ui::KeyEvent> TypeaheadInput::Release() {
  std::vector<ui::KeyEvent> held = held_.Release();
  if (rewriting_ && host_) host_->RemoveEventRewriter(this);
  rewriting_ = false;
  if (input_ && observing_) input_->RemoveObserver(this);
  observing_ = false;
  base::WeakPtr<ui::TextInputClient> wanted = std::exchange(wanted_, nullptr);
  ui::InputMethod* input = std::exchange(input_, nullptr);
  host_ = nullptr;
  if (input && input->GetTextInputClient() == this) {
    input->DetachTextInputClient(this);
    if (wanted) input->SetFocusedTextInputClient(wanted.get());
  }
  return held;
}

void TypeaheadInput::Stop() {
  std::ignore = held_.Release();
  if (rewriting_ && host_) host_->RemoveEventRewriter(this);
  rewriting_ = false;
  if (input_ && observing_) input_->RemoveObserver(this);
  observing_ = false;
  if (input_ && input_->GetTextInputClient() == this) input_->DetachTextInputClient(this);
  input_ = nullptr;
  host_ = nullptr;
}

ui::EventDispatchDetails TypeaheadInput::RewriteEvent(const ui::Event& event, const Continuation continuation) {
  if (!held_.capturing() || !event.IsKeyEvent() ||
      (event.type() != ui::EventType::kKeyPressed && event.type() != ui::EventType::kKeyReleased)) {
    return SendEvent(continuation, &event);
  }
  if (!owns_.Run(FocusedTarget())) return SendEvent(continuation, &event);
  const ui::KeyEvent& key = *event.AsKeyEvent();
  if (live_) {
    const bool pressed = key.type() == ui::EventType::kKeyPressed;
    const ShortcutKind shortcut = pressed ? live_.Run(key) : ShortcutKind::kNone;
    switch (live_keys_.Pass(pressed, key.code(), shortcut, TypeaheadModifierFlag(key.key_code()) != ui::EF_NONE)) {
      case LiveKey::kPass:
        if (shortcut == ShortcutKind::kFocusing) held_.DropHeld();
        return SendEvent(continuation, &event);
      case LiveKey::kPassAndHold:
        std::ignore = held_.Hold(ui::KeyEvent(key));
        return SendEvent(continuation, &event);
      case LiveKey::kHold:
        break;
    }
  }
  if (held_.Hold(ui::KeyEvent(key))) return DiscardEvent(continuation);
  return SendEvent(continuation, &event);
}

aura::Window* TypeaheadInput::FocusedTarget() const {
  aura::Window* root = host_ ? host_->window() : nullptr;
  aura::client::FocusClient* focus = root ? aura::client::GetFocusClient(root) : nullptr;
  aura::Window* target = focus ? focus->GetFocusedWindow() : nullptr;
  return target ? target : root;
}

void TypeaheadInput::OnTextInputStateChanged(const ui::TextInputClient* client) {
  if (!held_.capturing() || !input_ || !client || client == this || !owns_.Run(FocusedTarget())) return;
  wanted_ = const_cast<ui::TextInputClient*>(client)->AsWeakPtr();
  if (input_->GetTextInputClient() != this) input_->SetFocusedTextInputClient(this);
}

void TypeaheadInput::OnInputMethodDestroyed(const ui::InputMethod* input_method) {
  if (input_method != input_) return;
  observing_ = false;
  input_ = nullptr;
}

base::WeakPtr<ui::TextInputClient> TypeaheadInput::AsWeakPtr() {
  return weak_factory_.GetWeakPtr();
}

size_t TypeaheadInput::ConfirmCompositionText(bool) {
  return 0;
}

ui::TextInputType TypeaheadInput::GetTextInputType() const {
  return ui::TEXT_INPUT_TYPE_NONE;
}

ui::TextInputMode TypeaheadInput::GetTextInputMode() const {
  return ui::TEXT_INPUT_MODE_NONE;
}

base::i18n::TextDirection TypeaheadInput::GetTextDirection() const {
  return base::i18n::UNKNOWN_DIRECTION;
}

int TypeaheadInput::GetTextInputFlags() const {
  return 0;
}

bool TypeaheadInput::CanComposeInline() const {
  return false;
}

gfx::Rect TypeaheadInput::GetCaretBounds() const {
  return gfx::Rect();
}

gfx::Rect TypeaheadInput::GetSelectionBoundingBox() const {
  return gfx::Rect();
}

#if BUILDFLAG(IS_WIN)
std::optional<gfx::Rect> TypeaheadInput::GetProximateCharacterBounds(const gfx::Range&) const {
  return std::nullopt;
}

std::optional<size_t> TypeaheadInput::GetProximateCharacterIndexFromPoint(const gfx::Point&,
                                                                          IndexFromPointFlags) const {
  return std::nullopt;
}
#endif

bool TypeaheadInput::GetCompositionCharacterBounds(size_t, gfx::Rect*) const {
  return false;
}

bool TypeaheadInput::HasCompositionText() const {
  return false;
}

ui::TextInputClient::FocusReason TypeaheadInput::GetFocusReason() const {
  return ui::TextInputClient::FOCUS_REASON_NONE;
}

bool TypeaheadInput::GetTextRange(gfx::Range*) const {
  return false;
}

bool TypeaheadInput::GetCompositionTextRange(gfx::Range*) const {
  return false;
}

bool TypeaheadInput::GetEditableSelectionRange(gfx::Range*) const {
  return false;
}

bool TypeaheadInput::SetEditableSelectionRange(const gfx::Range&) {
  return false;
}

#if BUILDFLAG(IS_MAC)
bool TypeaheadInput::DeleteRange(const gfx::Range&) {
  return false;
}
#endif

bool TypeaheadInput::GetTextFromRange(const gfx::Range&, std::u16string*) const {
  return false;
}

bool TypeaheadInput::ChangeTextDirectionAndLayoutAlignment(base::i18n::TextDirection) {
  return false;
}

bool TypeaheadInput::IsTextEditCommandEnabled(ui::TextEditCommand) const {
  return false;
}

ukm::SourceId TypeaheadInput::GetClientSourceForMetrics() const {
  return ukm::kInvalidSourceId;
}

bool TypeaheadInput::ShouldDoLearning() {
  return false;
}

#if BUILDFLAG(IS_WIN) || BUILDFLAG(IS_LINUX) || BUILDFLAG(IS_CHROMEOS)
bool TypeaheadInput::SetCompositionFromExistingText(const gfx::Range&, const std::vector<ui::ImeTextSpan>&) {
  return false;
}
#endif

#if BUILDFLAG(IS_CHROMEOS)
gfx::Range TypeaheadInput::GetAutocorrectRange() const {
  return gfx::Range();
}

gfx::Rect TypeaheadInput::GetAutocorrectCharacterBounds() const {
  return gfx::Rect();
}

bool TypeaheadInput::SetAutocorrectRange(const gfx::Range&) {
  return false;
}
#endif

}
