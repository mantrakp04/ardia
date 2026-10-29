#include <cassert>
#include <cstdio>
#include <memory>

#include "typeahead_input_support.h"
#include "ardia/linux/ac_linux_typeahead_input.h"

using ardia::linux_window::TypeaheadInput;

namespace {

class Client : public ui::TextInputClient {
 public:
  base::WeakPtr<ui::TextInputClient> AsWeakPtr() override { return weak_.GetWeakPtr(); }
  void SetCompositionText(const ui::CompositionText&) override {}
  size_t ConfirmCompositionText(bool) override { return 0; }
  void ClearCompositionText() override {}
  void InsertText(const std::u16string&, InsertTextCursorBehavior) override {}
  void InsertChar(const ui::KeyEvent&) override {}
  ui::TextInputType GetTextInputType() const override { return ui::TEXT_INPUT_TYPE_TEXT; }
  ui::TextInputMode GetTextInputMode() const override { return ui::TEXT_INPUT_MODE_TEXT; }
  base::i18n::TextDirection GetTextDirection() const override { return base::i18n::LEFT_TO_RIGHT; }
  int GetTextInputFlags() const override { return 0; }
  bool CanComposeInline() const override { return true; }
  gfx::Rect GetCaretBounds() const override { return {}; }
  gfx::Rect GetSelectionBoundingBox() const override { return {}; }
  bool GetCompositionCharacterBounds(size_t, gfx::Rect*) const override { return false; }
  bool HasCompositionText() const override { return false; }
  FocusReason GetFocusReason() const override { return FOCUS_REASON_MOUSE; }
  bool GetTextRange(gfx::Range*) const override { return false; }
  bool GetCompositionTextRange(gfx::Range*) const override { return false; }
  bool GetEditableSelectionRange(gfx::Range*) const override { return false; }
  bool SetEditableSelectionRange(const gfx::Range&) override { return false; }
  bool GetTextFromRange(const gfx::Range&, std::u16string*) const override { return false; }
  void OnInputMethodChanged() override {}
  bool ChangeTextDirectionAndLayoutAlignment(base::i18n::TextDirection) override { return false; }
  void ExtendSelectionAndDelete(size_t, size_t) override {}
  void EnsureCaretNotInRect(const gfx::Rect&) override {}
  bool IsTextEditCommandEnabled(ui::TextEditCommand) const override { return false; }
  void SetTextEditCommandForNextKeyEvent(ui::TextEditCommand) override {}
  ukm::SourceId GetClientSourceForMetrics() const override { return 0; }
  bool ShouldDoLearning() override { return false; }
  bool SetCompositionFromExistingText(const gfx::Range&, const std::vector<ui::ImeTextSpan>&) override { return false; }
  void GetActiveTextInputControlLayoutBounds(std::optional<gfx::Rect>*, std::optional<gfx::Rect>*) override {}

 private:
  base::WeakPtrFactory<ui::TextInputClient> weak_{this};
};

struct Window {
  aura::WindowTreeHost host;
  aura::client::FocusClient focus;
  ui::InputMethod input;
  aura::Window shell;
  aura::Window dialog;
  Client shell_client;
  Client dialog_client;
  Window() {
    aura::client::FocusClients()[host.window()] = &focus;
    focus.focused = &shell;
    input.SetFocusedTextInputClient(&shell_client);
  }
  ~Window() { aura::client::FocusClients().erase(host.window()); }
  std::unique_ptr<TypeaheadInput> Typeahead() {
    return std::make_unique<TypeaheadInput>(&host, &input, base::RepeatingCallback<bool(aura::Window*)>(
        [this](aura::Window* target) { return target != &dialog; }));
  }
};

ui::KeyEvent Press(char key) { return ui::KeyEvent(ui::EventType::kKeyPressed, key); }

base::RepeatingCallback<ardia::linux_window::ShortcutKind(const ui::KeyEvent&)> Shortcuts(
    int* asked, ardia::linux_window::ShortcutKind kind) {
  return base::RepeatingCallback<ardia::linux_window::ShortcutKind(const ui::KeyEvent&)>(
      [asked, kind](const ui::KeyEvent& event) {
        ++*asked;
        return event.key_code() == ui::VKEY_L && (event.flags() & ui::EF_CONTROL_DOWN)
                   ? kind
                   : ardia::linux_window::ShortcutKind::kNone;
      });
}
ui::KeyEvent Up(char key) { return ui::KeyEvent(ui::EventType::kKeyReleased, key); }

void HoldsRawKeysWithTheImeDisengaged() {
  Window w;
  auto typeahead = w.Typeahead();
  typeahead->Start();
  assert(typeahead->capturing() && w.host.rewriters.size() == 1);
  assert(w.input.GetTextInputClient() == typeahead.get());
  assert(typeahead->GetTextInputType() == ui::TEXT_INPUT_TYPE_NONE);
  assert(!w.host.Send(Press('a')) && !w.host.Send(Up('a')));
  assert(w.host.Send(ui::Event(ui::EventType::kMousePressed)));
  w.input.SetFocusedTextInputClient(&w.shell_client);
  assert(w.input.GetTextInputClient() == typeahead.get());
  assert(!w.host.Send(Press('b')));
  auto held = typeahead->Release();
  assert(held.size() == 3 && held[0].key == 'a' && held[0].type() == ui::EventType::kKeyPressed);
  assert(held[1].type() == ui::EventType::kKeyReleased && held[2].key == 'b');
  assert(w.input.GetTextInputClient() == &w.shell_client);
  assert(w.host.rewriters.empty() && w.input.observers.empty() && !typeahead->capturing());
  assert(w.host.Send(Press('c')));
}

void LeavesAnotherWidgetsTypingAlone() {
  Window w;
  auto typeahead = w.Typeahead();
  typeahead->Start();
  w.focus.focused = &w.dialog;
  w.input.SetFocusedTextInputClient(&w.dialog_client);
  assert(w.input.GetTextInputClient() == &w.dialog_client);
  assert(w.host.Send(Press('x')) && w.host.Send(Up('x')));
  w.focus.focused = &w.shell;
  w.input.SetFocusedTextInputClient(&w.shell_client);
  assert(w.input.GetTextInputClient() == typeahead.get());
  assert(!w.host.Send(Press('y')));
  auto held = typeahead->Release();
  assert(held.size() == 1 && held[0].key == 'y');
  assert(w.input.GetTextInputClient() == &w.shell_client);
}

void ReleaseWithAnotherWidgetFocusedRestoresNothing() {
  Window w;
  auto typeahead = w.Typeahead();
  typeahead->Start();
  w.focus.focused = &w.dialog;
  w.input.SetFocusedTextInputClient(&w.dialog_client);
  std::ignore = typeahead->Release();
  assert(w.input.GetTextInputClient() == &w.dialog_client);
}

void OverflowDiscardsEverything() {
  Window w;
  auto typeahead = w.Typeahead();
  typeahead->Start();
  for (size_t i = 0; i <= ardia::linux_window::Typeahead<ui::KeyEvent>::kMaxEvents; ++i) assert(!w.host.Send(Press('k')));
  assert(!w.host.Send(Press('k')));
  assert(typeahead->Release().empty());
}

void DestroyedWhileHoldingDetaches() {
  Window w;
  auto typeahead = w.Typeahead();
  typeahead->Start();
  typeahead.reset();
  assert(w.host.rewriters.empty() && w.input.observers.empty() && !w.input.GetTextInputClient());
  assert(w.host.Send(Press('z')));
}

void ShortcutsPassLiveOnlyOnceCommandsAreReady() {
  Window w;
  auto typeahead = w.Typeahead();
  typeahead->Start();
  const ui::KeyEvent ctrl_down(ui::EventType::kKeyPressed, ui::VKEY_CONTROL, ui::EF_CONTROL_DOWN);
  const ui::KeyEvent l_down(ui::EventType::kKeyPressed, ui::VKEY_L, ui::EF_CONTROL_DOWN);
  const ui::KeyEvent l_up(ui::EventType::kKeyReleased, ui::VKEY_L, ui::EF_CONTROL_DOWN);
  const ui::KeyEvent ctrl_up(ui::EventType::kKeyReleased, ui::VKEY_CONTROL, ui::EF_NONE);
  assert(!w.host.Send(ctrl_down) && !w.host.Send(l_down) && !w.host.Send(l_up) && !w.host.Send(ctrl_up));
  int asked = 0;
  typeahead->SetLive(Shortcuts(&asked, ardia::linux_window::ShortcutKind::kShortcut));
  assert(!w.host.Send(ctrl_down));
  assert(w.host.Send(l_down));
  assert(!w.host.Send(Press('a')));
  assert(w.host.Send(l_up));
  assert(!w.host.Send(Up('a')));
  assert(w.host.Send(ctrl_up));
  assert(!w.host.Send(ui::KeyEvent(ui::EventType::kKeyReleased, ui::VKEY_L, ui::EF_NONE)));
  assert(asked == 3);
  w.focus.focused = &w.dialog;
  assert(w.host.Send(Press('b')));
  w.focus.focused = &w.shell;
  auto held = typeahead->Release();
  assert(held.size() == 9);
  assert(held[4].key_code() == ui::VKEY_CONTROL && held[4].type() == ui::EventType::kKeyPressed);
  assert(held[5].key == 'a' && held[6].key == 'a' && held[6].type() == ui::EventType::kKeyReleased);
  assert(held[7].key_code() == ui::VKEY_CONTROL && held[7].type() == ui::EventType::kKeyReleased);
  assert(held[8].key_code() == ui::VKEY_L);
  assert(w.host.Send(l_down));
}

void ALiveModifierReleaseIsAlsoHeldForTheReplay() {
  Window w;
  auto typeahead = w.Typeahead();
  typeahead->Start();
  const ui::KeyEvent ctrl_down(ui::EventType::kKeyPressed, ui::VKEY_LCONTROL, ui::EF_CONTROL_DOWN);
  const ui::KeyEvent tab_down(ui::EventType::kKeyPressed, ui::VKEY_TAB, ui::EF_CONTROL_DOWN);
  const ui::KeyEvent tab_up(ui::EventType::kKeyReleased, ui::VKEY_TAB, ui::EF_CONTROL_DOWN);
  assert(!w.host.Send(ctrl_down) && !w.host.Send(tab_down) && !w.host.Send(tab_up));
  int asked = 0;
  typeahead->SetLive(base::RepeatingCallback<ardia::linux_window::ShortcutKind(const ui::KeyEvent&)>(
      [&asked](const ui::KeyEvent& event) {
        ++asked;
        return event.key_code() == ui::VKEY_TAB ? ardia::linux_window::ShortcutKind::kShortcut
                                                : ardia::linux_window::ShortcutKind::kNone;
      }));
  assert(w.host.Send(tab_down) && w.host.Send(tab_up));
  assert(w.host.Send(ui::KeyEvent(ui::EventType::kKeyReleased, ui::VKEY_LCONTROL, ui::EF_NONE)));
  auto held = typeahead->Release();
  assert(held.size() == 4);
  assert(held[1].key_code() == ui::VKEY_TAB && held[1].type() == ui::EventType::kKeyPressed);
  assert(held[3].key_code() == ui::VKEY_LCONTROL && held[3].type() == ui::EventType::kKeyReleased);
}

void AFocusingShortcutDropsTheTextHeldBeforeIt() {
  Window w;
  auto typeahead = w.Typeahead();
  typeahead->Start();
  assert(!w.host.Send(Press('a')) && !w.host.Send(Up('a')) && !w.host.Send(Press('b')));
  int asked = 0;
  typeahead->SetLive(Shortcuts(&asked, ardia::linux_window::ShortcutKind::kFocusing));
  assert(w.host.Send(ui::KeyEvent(ui::EventType::kKeyPressed, ui::VKEY_L, ui::EF_CONTROL_DOWN)));
  assert(!w.host.Send(Press('c')));
  auto held = typeahead->Release();
  assert(held.size() == 1 && held[0].key == 'c');
}

void StartsOnlyOnce() {
  Window w;
  auto typeahead = w.Typeahead();
  typeahead->Start();
  std::ignore = typeahead->Release();
  typeahead->Start();
  assert(!typeahead->capturing() && w.host.rewriters.empty() && w.input.GetTextInputClient() == &w.shell_client);
}

}

int main() {
  HoldsRawKeysWithTheImeDisengaged();
  LeavesAnotherWidgetsTypingAlone();
  ReleaseWithAnotherWidgetFocusedRestoresNothing();
  OverflowDiscardsEverything();
  DestroyedWhileHoldingDetaches();
  StartsOnlyOnce();
  ShortcutsPassLiveOnlyOnceCommandsAreReady();
  ALiveModifierReleaseIsAlsoHeldForTheReplay();
  AFocusingShortcutDropsTheTextHeldBeforeIt();
  std::puts("typeahead input scenarios passed");
}
