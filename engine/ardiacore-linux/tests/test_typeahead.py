import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

from support import method as extract

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
LINUX = SOURCE / 'ardia' / 'linux'
HOST = (LINUX / 'ac_linux_host.cc').read_text()

LEDGER = r'''#include <cassert>
#include <string>
#include <vector>
#include "ardia/linux/ac_linux_typeahead.h"

using ardia::linux_window::Typeahead;

static void NothingIsHeldBeforeStartOrAfterRelease() {
  Typeahead<std::string> typeahead;
  assert(!typeahead.capturing());
  assert(!typeahead.Hold("a"));
  typeahead.Start();
  assert(typeahead.capturing());
  assert(typeahead.Hold("g"));
  assert(typeahead.Hold("h"));
  assert((typeahead.Release() == std::vector<std::string>{"g", "h"}));
  assert(!typeahead.capturing());
  assert(!typeahead.Hold("i"));
  assert(typeahead.Release().empty());
}

static void CapturingStartsOnlyOnce() {
  Typeahead<std::string> typeahead;
  typeahead.Start();
  typeahead.Release();
  typeahead.Start();
  assert(!typeahead.capturing());
}

static void TheBufferIsBounded() {
  Typeahead<int> typeahead;
  typeahead.Start();
  for (size_t i = 0; i < Typeahead<int>::kMaxEvents; ++i) assert(typeahead.Hold(static_cast<int>(i)));
  const auto under = typeahead;
  assert(typeahead.Hold(-1));
  assert(typeahead.capturing());
  assert(typeahead.Hold(-2));
  assert(typeahead.Release().empty());
  assert(!typeahead.capturing());
  assert(!typeahead.Hold(-3));
  auto full = under;
  const auto held = full.Release();
  assert(held.size() == Typeahead<int>::kMaxEvents);
  assert(held.front() == 0 && held.back() == static_cast<int>(Typeahead<int>::kMaxEvents - 1));
}

static void DroppingKeepsCapturingAndRecoversFromOverflow() {
  Typeahead<int> typeahead;
  typeahead.DropHeld();
  assert(!typeahead.capturing());
  typeahead.Start();
  assert(typeahead.Hold(1) && typeahead.Hold(2));
  typeahead.DropHeld();
  assert(typeahead.capturing() && typeahead.Hold(3));
  for (size_t i = 0; i <= Typeahead<int>::kMaxEvents; ++i) assert(typeahead.Hold(4));
  typeahead.DropHeld();
  assert(typeahead.Hold(5));
  assert((typeahead.Release() == std::vector<int>{5}));
  typeahead.DropHeld();
  assert(!typeahead.capturing() && !typeahead.Hold(6));
}

int main() {
  DroppingKeepsCapturingAndRecoversFromOverflow();
  NothingIsHeldBeforeStartOrAfterRelease();
  CapturingStartsOnlyOnce();
  TheBufferIsBounded();
}
'''


class TypeaheadLedgerTests(unittest.TestCase):
    def test_ledger(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        with tempfile.TemporaryDirectory(prefix='ardia-typeahead-') as scratch:
            root = pathlib.Path(scratch)
            (root / 'ledger.cc').write_text(LEDGER)
            binary = root / 'ledger'
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(SOURCE),
                                    str(root / 'ledger.cc'), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            ran = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)


INPUT = (LINUX / 'ac_linux_typeahead_input.cc').read_text() if (LINUX / 'ac_linux_typeahead_input.cc').exists() else ''


class TypeaheadInputTests(unittest.TestCase):
    def test_real_typeahead_input_holds_keys_and_only_takes_ime_focus_for_this_window(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = LINUX / 'ac_linux_typeahead_input.cc'
        with tempfile.TemporaryDirectory(prefix='ardia-typeahead-input-') as scratch:
            stubs = pathlib.Path(scratch) / 'stubs'
            for header in [source, LINUX / 'ac_linux_typeahead_input.h']:
                for include in re.findall(r'#include "([^"]+)"', header.read_text()):
                    if include.startswith('ardia/'):
                        continue
                    path = stubs / include
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('#include "typeahead_input_support.h"\n')
            binary = pathlib.Path(scratch) / 'typeahead-input'
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-g',
                                    '-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-I', str(stubs),
                                    '-I', str(ROOT / 'tests/fixtures'), '-I', str(SOURCE), str(source),
                                    str(ROOT / 'tests/fixtures/typeahead_input_scenarios.cc'), '-o', str(binary)],
                                   capture_output=True, text=True, timeout=180)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            ran = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30)
            self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)
            self.assertIn('typeahead input scenarios passed', ran.stdout)


REPLAY_FAKES = r'''#include <compare>
#include <cstdio>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>
#include <vector>

namespace gfx {
struct Rect {
  int x = 0, y = 0, width = 0, height = 0;
};
}

namespace ui {
enum KeyboardCode {
  VKEY_UNKNOWN = 0,
  VKEY_SHIFT = 0x10,
  VKEY_CONTROL = 0x11,
  VKEY_MENU = 0x12,
  VKEY_LWIN = 0x5B,
  VKEY_RWIN = 0x5C,
  VKEY_LSHIFT = 0xA0,
  VKEY_RSHIFT = 0xA1,
  VKEY_LCONTROL = 0xA2,
  VKEY_RCONTROL = 0xA3,
  VKEY_LMENU = 0xA4,
  VKEY_RMENU = 0xA5,
};
enum EventFlags {
  EF_NONE = 0,
  EF_SHIFT_DOWN = 1 << 1,
  EF_CONTROL_DOWN = 1 << 2,
  EF_ALT_DOWN = 1 << 3,
  EF_COMMAND_DOWN = 1 << 4,
};
class EventTarget {
 public:
  virtual ~EventTarget() = default;
};
enum class EventType { kKeyPressed, kKeyReleased };
class Event {
 public:
  class DispatcherApi {
   public:
    explicit DispatcherApi(Event* event) : event_(event) {}
    void set_target(EventTarget* target) { event_->target_ = target; }

   private:
    Event* event_;
  };
  Event(EventType type, int flags) : type_(type), flags_(flags) {}
  Event(const Event& copy) : type_(copy.type_), flags_(copy.flags_) {}
  Event& operator=(const Event& rhs) {
    type_ = rhs.type_;
    flags_ = rhs.flags_;
    return *this;
  }
  EventType type() const { return type_; }
  int flags() const { return flags_; }
  EventTarget* target() const { return target_; }

 private:
  EventType type_;
  int flags_;
  EventTarget* target_ = nullptr;
};
class KeyEvent : public Event {
 public:
  KeyEvent(EventType type, char key, int flags = EF_NONE, KeyboardCode key_code = VKEY_UNKNOWN)
      : Event(type, flags), key(key), key_code_(key_code == VKEY_UNKNOWN ? static_cast<KeyboardCode>(key) : key_code) {}
  KeyboardCode key_code() const { return key_code_; }
  char key;

 private:
  KeyboardCode key_code_;
};
struct Accelerator {
  KeyboardCode key;
  int modifiers;
  auto operator<=>(const Accelerator&) const = default;
};
}

namespace aura {
class Window : public ui::EventTarget {
 public:
  gfx::Rect bounds{10, 20, 800, 600};
  gfx::Rect GetBoundsInScreen() const { return bounds; }
};
}

namespace ui {
struct EventDispatchDetails {};
struct InputMethod {
  std::vector<char> keys;
  std::vector<aura::Window*> targets;
  EventDispatchDetails DispatchKeyEvent(KeyEvent* event) {
    auto* window = static_cast<aura::Window*>(event->target());
    const gfx::Rect bounds = window->GetBoundsInScreen();
    std::ignore = bounds;
    keys.push_back(event->key);
    targets.push_back(window);
    return {};
  }
};
}

namespace base {
template <typename T> struct WeakPtr {
  T* value = nullptr;
  explicit operator bool() const { return value != nullptr; }
};
struct OneShotTimer {
  void Stop() {}
};
struct DictValue {
  std::map<std::string, std::string> strings;
  std::optional<bool> FindBool(std::string_view key) const {
    const auto found = strings.find(std::string(key));
    if (found == strings.end()) return std::nullopt;
    return found->second == "1";
  }
};
}

std::string String(const base::DictValue& value, std::string_view key) {
  const auto found = value.strings.find(std::string(key));
  return found == value.strings.end() ? std::string() : found->second;
}

struct Typeahead {
  std::vector<ui::KeyEvent> held;
  std::vector<ui::KeyEvent> Release() { return std::exchange(held, {}); }
};
namespace linux_window {
using TypeaheadInput = Typeahead;
enum class ShortcutKind { kNone, kShortcut, kFocusing };
ARDIA_MODIFIER_FLAG
}
struct Widget {
  ui::InputMethod input;
  aura::Window native;
  ui::InputMethod* GetInputMethod() { return &input; }
  aura::Window* GetNativeWindow() { return &native; }
};
struct ShellHostView {
  base::OneShotTimer typeahead_timer_;
  std::unique_ptr<linux_window::TypeaheadInput> typeahead_ = std::make_unique<linux_window::TypeaheadInput>();
  Widget widget;
  bool holds = true;
  bool ShellHoldsTextField() { return holds; }
  Widget* GetWidget() { return &widget; }
  base::WeakPtr<ShellHostView> GetWeakPtr() { return {this}; }
  void ReplayTypeahead(bool field);
  bool RunHeldShortcut(const ui::KeyEvent& event);
  bool SwitcherReleasedInHold(const std::vector<ui::KeyEvent>& held, size_t index) const;
  linux_window::ShortcutKind LiveShortcutKind(const ui::KeyEvent& event) const;
  static bool CommandFocusesShell(const std::string& command);
  uint64_t renderer_generation_ = 1;
  std::optional<uint64_t> live_generation_;
  struct FocusManager {
    bool suspended = false;
    bool shortcut_handling_suspended() const { return suspended; }
  } focus;
  FocusManager* focus_manager_ = &focus;
  bool shortcut_recording_ = false;
  bool accelerators = true;
  bool modal = false;
  bool CanHandleAccelerators() const { return accelerators; }
  aura::Window* KeyboardFocusTarget() const { return const_cast<aura::Window*>(&widget.native); }
  bool OwnsKeyboardTarget(aura::Window* target) const { return target == &widget.native && !modal; }
  std::map<ui::Accelerator, base::DictValue> shortcuts_{
      {{static_cast<ui::KeyboardCode>('I'), ui::EF_CONTROL_DOWN}, {{{"command", "devTools"}}}},
      {{static_cast<ui::KeyboardCode>('L'), ui::EF_CONTROL_DOWN}, {{{"command", "focusCommandBar"}}}},
      {{static_cast<ui::KeyboardCode>('E'), ui::EF_CONTROL_DOWN}, {{{"command", "returnToPinnedUrl"}, {"declines", "1"}}}},
      {{static_cast<ui::KeyboardCode>('\t'), ui::EF_CONTROL_DOWN}, {{{"command", "tabSwitcher"}}}},
      {{static_cast<ui::KeyboardCode>('P'), ui::EF_CONTROL_DOWN}, {{{"command", "returnToPinnedUrl"}, {"notInText", "1"}}}},
      {{static_cast<ui::KeyboardCode>('S'), ui::EF_CONTROL_DOWN}, {{{"command", "focusCommandBar"}, {"suppressed", "1"}}}}};
  std::set<char> extension_keys{'K'};
  std::string order;
  static ui::Accelerator KeyAccelerator(const ui::KeyEvent& event) { return {event.key_code(), event.flags()}; }
  bool AcceleratorPressed(const ui::Accelerator& accelerator) {
    const auto found = shortcuts_.find(accelerator);
    if (found == shortcuts_.end()) return false;
    if (String(found->second, "declines") == "1") {
      order += std::string("{") + static_cast<char>(accelerator.key) + "}";
      return false;
    }
    order += std::string("[") + static_cast<char>(accelerator.key) + "]";
    return true;
  }
  bool ExtensionShortcutPressed(const ui::KeyEvent& event, bool reserved_by_ardia) {
    if (reserved_by_ardia) {
      order += std::string("<") + event.key + "!>";
      return false;
    }
    if (!extension_keys.contains(event.key)) return false;
    order += std::string("<") + event.key + ">";
    return true;
  }
};
'''

HELD_SHORTCUT_SCENARIO = r'''
using ui::EventType;
constexpr int kCtrl = ui::EF_CONTROL_DOWN;

static ui::KeyEvent Down(char key, int flags = ui::EF_NONE) { return ui::KeyEvent(EventType::kKeyPressed, key, flags); }
static ui::KeyEvent Up(char key, int flags = ui::EF_NONE) { return ui::KeyEvent(EventType::kKeyReleased, key, flags); }
static ui::KeyEvent ModifierDown(ui::KeyboardCode code, int flags) { return ui::KeyEvent(EventType::kKeyPressed, 0, flags, code); }
static ui::KeyEvent ModifierUp(ui::KeyboardCode code) { return ui::KeyEvent(EventType::kKeyReleased, 0, ui::EF_NONE, code); }

static void Hold(ShellHostView& host, std::initializer_list<ui::KeyEvent> keys) {
  for (const ui::KeyEvent& key : keys) host.typeahead_->held.push_back(key);
}

int main() {
  {
    ShellHostView host;
    host.holds = false;
    Hold(host, {Down('I', kCtrl), Up('I', kCtrl)});
    host.ReplayTypeahead(false);
    if (host.order != "[I]") return 10;
    if (!host.widget.input.keys.empty()) return 11;
  }
  {
    ShellHostView host;
    Hold(host, {Down('a'), Down('L', kCtrl), Down('b'), Down('I', kCtrl)});
    host.ReplayTypeahead(true);
    if (host.order != "[L][I]") return 12;
    if ((host.widget.input.keys != std::vector<char>{'a'})) return 13;
  }
  {
    ShellHostView host;
    Hold(host, {Down('q'), Down('I', kCtrl)});
    host.holds = false;
    host.ReplayTypeahead(true);
    if (host.order != "[I]" || !host.widget.input.keys.empty()) return 14;
  }
  for (int blocked = 0; blocked < 4; ++blocked) {
    ShellHostView host;
    host.accelerators = blocked != 0;
    host.shortcut_recording_ = blocked == 1;
    host.focus.suspended = blocked == 2;
    host.modal = blocked == 3;
    host.holds = false;
    Hold(host, {Down('I', kCtrl), Down('K', kCtrl)});
    host.ReplayTypeahead(false);
    if (!host.order.empty()) return 15 + blocked;
  }
  {
    ShellHostView host;
    Hold(host, {Down('a'), Down('E', kCtrl), Down('b')});
    host.ReplayTypeahead(true);
    if (host.order != "{E}<E!>") return 20;
    if ((host.widget.input.keys != std::vector<char>{'a', 'E', 'b'})) return 21;
  }
  {
    ShellHostView host;
    Hold(host, {Down('a'), Down('K', kCtrl), Up('K', kCtrl), Down('b')});
    host.ReplayTypeahead(true);
    if (host.order != "<K>") return 22;
    if ((host.widget.input.keys != std::vector<char>{'a'})) return 23;
  }
  {
    ShellHostView host;
    host.holds = false;
    Hold(host, {ModifierDown(ui::VKEY_CONTROL, kCtrl), Down('\t', kCtrl), Up('\t', kCtrl), ModifierUp(ui::VKEY_LCONTROL)});
    host.ReplayTypeahead(false);
    if (!host.order.empty()) return 24;
  }
  {
    ShellHostView host;
    host.holds = false;
    Hold(host, {ModifierDown(ui::VKEY_CONTROL, kCtrl), Down('\t', kCtrl), Up('\t', kCtrl), ModifierUp(ui::VKEY_SHIFT)});
    host.ReplayTypeahead(false);
    if (host.order != "[\t]") return 25;
  }
  std::puts("held shortcut scenarios passed");
}
'''


REPLAY_SCENARIO = r'''
int main() {
  ShellHostView host;
  aura::Window source;
  for (const char key : {'a', 'b'}) {
    ui::KeyEvent live(ui::EventType::kKeyPressed, key);
    ui::Event::DispatcherApi(&live).set_target(&source);
    host.typeahead_->held.push_back(live);
  }
  if (host.typeahead_->held[0].target()) return 3;
  host.ReplayTypeahead(true);
  if ((host.widget.input.keys != std::vector<char>{'a', 'b'})) return 4;
  for (aura::Window* target : host.widget.input.targets) {
    if (target != &host.widget.native) return 5;
  }
  std::puts("replay scenarios passed");
}
'''


class TypeaheadReplayTests(unittest.TestCase):
    def run_replay(self, scenario, expected):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        replay = extract(HOST, 'void ShellHostView::ReplayTypeahead(bool field)')
        shortcut = extract(HOST, 'bool ShellHostView::RunHeldShortcut(const ui::KeyEvent& event)')
        switcher = extract(HOST, 'bool ShellHostView::SwitcherReleasedInHold(const std::vector<ui::KeyEvent>& held, size_t index) const')
        switcher += '\n' + extract(HOST, 'linux_window::ShortcutKind ShellHostView::LiveShortcutKind(const ui::KeyEvent& event) const')
        switcher += '\n' + extract(HOST, 'bool ShellHostView::CommandFocusesShell(const std::string& command)')
        modifier = extract(INPUT, 'int TypeaheadModifierFlag(ui::KeyboardCode key)')
        fakes = REPLAY_FAKES.replace('ARDIA_MODIFIER_FLAG', modifier)
        with tempfile.TemporaryDirectory(prefix='ardia-typeahead-replay-') as scratch:
            root = pathlib.Path(scratch)
            (root / 'replay.cc').write_text(fakes + shortcut + '\n' + switcher + '\n' + replay + scenario)
            binary = root / 'replay'
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-g', '-fsanitize=address,undefined',
                                    '-fno-sanitize-recover=all', '-fno-omit-frame-pointer', str(root / 'replay.cc'), '-o', str(binary)],
                                   capture_output=True, text=True, timeout=180)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            ran = subprocess.run([str(binary)], capture_output=True, text=True, timeout=30)
            self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)
            self.assertIn(expected, ran.stdout)

    def test_replayed_keys_carry_a_target_the_gtk_input_method_can_dereference(self):
        self.run_replay(REPLAY_SCENARIO, 'replay scenarios passed')

    def test_shortcuts_pressed_while_keys_are_held_run_when_the_window_is_ready(self):
        self.run_replay(HELD_SHORTCUT_SCENARIO, 'held shortcut scenarios passed')


if __name__ == '__main__':
    unittest.main()
