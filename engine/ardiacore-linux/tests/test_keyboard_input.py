from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class KeyboardInputTests(unittest.TestCase):
    def test_window_input_handles_shortcuts_without_a_focused_views_view(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = (Path(__file__).resolve().parents[1] / 'src/ardia/linux/ac_linux_host.cc').read_text()
        start = source.index('void ShellHostView::OnKeyEvent(')
        brace = source.index('{', start)
        depth = 1
        end = brace + 1
        while depth:
            depth += (source[end] == '{') - (source[end] == '}')
            end += 1
        method = source[start:end]
        accelerator_start = source.index('ui::Accelerator ShellHostView::KeyAccelerator(const ui::KeyEvent& event) {')
        method += source[accelerator_start:source.index('\n}\n', accelerator_start) + 3]
        focus_start = source.index('void ShellHostView::FocusShell()')
        focus_end = source.index('\n}\n', focus_start) + 3
        method += source[focus_start:focus_end]
        prelude = r'''
#include <cassert>
#include <iostream>
#include <set>
#include <string>
#define LOG(level) std::cerr
namespace base {
struct CommandLine {
  static CommandLine* ForCurrentProcess() { static CommandLine value; return &value; }
  bool HasSwitch(const char*) { return false; }
};
}
namespace ui {
using KeyboardCode = int;
constexpr int VKEY_UNKNOWN = 0;
inline int DomCodeToUsLayoutKeyboardCode(int code) { return code; }
enum class EventType { kKeyPressed, kKeyReleased };
struct KeyEvent {
  EventType event_type = EventType::kKeyPressed;
  int key = 84;
  bool stopped = false;
  EventType type() const { return event_type; }
  bool IsControlDown() const { return true; }
  int key_code() const { return key; }
  int code() const { return key; }
  int flags() const { return 4; }
  void StopPropagation() { assert(!stopped); stopped = true; }
};
struct Accelerator {
  int key;
  Accelerator(int value, int) : key(value) {}
  auto operator<=>(const Accelerator&) const = default;
};
}
struct FocusManager {
  bool suspended = false;
  bool shortcut_handling_suspended() const { return suspended; }
  void* GetFocusedView() const { return nullptr; }
};
struct ShellContents {
  int focuses = 0;
  void Focus() { ++focuses; }
};
struct ShellView {
  int requests = 0;
  bool HasFocus() const { return true; }
  void RequestFocus() { ++requests; }
};
struct ShellHostView {
  ShellContents contents;
  ShellView shell_view;
  ShellView* shell_ = &shell_view;
  ShellContents* shell() { return &contents; }
  void FocusShell();
  FocusManager focus;
  FocusManager* focus_manager_ = &focus;
  bool shortcut_recording_ = false;
  bool ready = true;
  bool modal = false;
  bool consume = true;
  int dispatches = 0;
  std::string window_id_ = "main";
  std::set<ui::Accelerator> shortcuts_;
  bool CanHandleAccelerators() const { return ready; }
  bool OwnsKeyboardEvent(const ui::KeyEvent&) const { return !modal; }
  bool AcceleratorPressed(const ui::Accelerator& accelerator) {
    assert(accelerator.key == 84);
    ++dispatches;
    return consume;
  }
  bool extension_consumes = false;
  int extension_dispatches = 0;
  bool last_reserved = false;
  bool ExtensionShortcutPressed(const ui::KeyEvent&, bool reserved_by_ardia) {
    ++extension_dispatches;
    last_reserved = reserved_by_ardia;
    return extension_consumes && !reserved_by_ardia;
  }
  bool forwards_escape = false;
  bool ForwardDragEscape(const ui::KeyEvent&) const { return forwards_escape; }
  void OnKeyEvent(ui::KeyEvent* event);
  static ui::Accelerator KeyAccelerator(const ui::KeyEvent& event);
};
'''
        checks = r'''
int main() {
  ShellHostView host;
  host.FocusShell();
  assert(host.shell_view.requests == 1 && host.contents.focuses == 1);
  ui::KeyEvent event;
  host.OnKeyEvent(&event);
  assert(event.stopped && host.dispatches == 1 && host.extension_dispatches == 0);
  host.consume = false;
  event.stopped = false;
  host.OnKeyEvent(&event);
  assert(!event.stopped && host.dispatches == 2 && host.extension_dispatches == 1 && !host.last_reserved);
  host.extension_consumes = true;
  host.OnKeyEvent(&event);
  assert(event.stopped && host.dispatches == 3 && host.extension_dispatches == 2);
  event.stopped = false;
  host.shortcuts_.insert(ui::Accelerator(84, 4));
  host.OnKeyEvent(&event);
  assert(!event.stopped && host.dispatches == 4 && host.extension_dispatches == 3 && host.last_reserved);
  host.shortcuts_.clear();
  host.extension_consumes = false;
  host.dispatches = 2;
  host.modal = true;
  host.OnKeyEvent(&event);
  assert(!event.stopped && host.dispatches == 2);
  host.modal = false;
  host.shortcut_recording_ = true;
  host.OnKeyEvent(&event);
  assert(!event.stopped && host.dispatches == 2);
  host.shortcut_recording_ = false;
  host.focus.suspended = true;
  host.OnKeyEvent(&event);
  assert(!event.stopped && host.dispatches == 2);
  host.focus.suspended = false;
  host.ready = false;
  host.OnKeyEvent(&event);
  assert(!event.stopped && host.dispatches == 2);
  host.ready = true;
  event.event_type = ui::EventType::kKeyReleased;
  host.OnKeyEvent(&event);
  assert(!event.stopped && host.dispatches == 2);
  event.event_type = ui::EventType::kKeyPressed;
  host.focus_manager_ = nullptr;
  host.OnKeyEvent(&event);
  assert(!event.stopped && host.dispatches == 2);
  host.focus_manager_ = &host.focus;
  host.consume = true;
  host.ready = false;
  event.stopped = false;
  host.OnKeyEvent(&event);
  assert(!event.stopped && host.dispatches == 2);
  host.ready = true;
  host.OnKeyEvent(&event);
  assert(event.stopped && host.dispatches == 3);
  host.forwards_escape = true;
  host.ready = false;
  host.modal = true;
  event.stopped = false;
  host.OnKeyEvent(&event);
  assert(event.stopped && host.dispatches == 3 && host.extension_dispatches == 3);
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-keyboard-input-') as scratch:
            cpp = Path(scratch) / 'keyboard.cc'
            cpp.write_text(prelude + method + checks)
            binary = Path(scratch) / 'keyboard'
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', '-I', str(Path(__file__).resolve().parents[1] / 'src'), str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            subprocess.run([str(binary)], check=True)


    def test_escape_cancels_a_tab_drag_from_any_window_and_any_focus(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        source = (Path(__file__).resolve().parents[1] / 'src/ardia/linux/ac_linux_host.cc').read_text()
        owner_start = source.index('std::optional<int>& DragEscapeOwner() {')
        owner = source[owner_start:source.index('\n}\n', owner_start) + 3]
        forward_start = source.index('bool ShellHostView::ForwardDragEscape(const ui::KeyEvent& event) {')
        forward = source[forward_start:source.index('\n}\n', forward_start) + 3]
        on_key_start = source.index('void ShellHostView::OnKeyEvent(')
        on_key_body = source[source.index('{', on_key_start) + 1:source.index('\n', source.index('{', on_key_start) + 2)]
        self.assertIn('ForwardDragEscape(*event)', on_key_body, 'Escape must be checked before any shortcut condition')
        capture_start = source.index('if (method == "ArdiaShell.setDragEscapeCapture") {')
        capture = source[capture_start:source.index('\n  }\n', capture_start) + 4]
        self.assertIn('.Append("ArdiaShell.setDragEscapeCapture")', source)
        reset_start = source.index('    switcher_capture_ = false;\n    switcher_source_.reset();')
        self.assertIn('ReleaseDragEscape();', source[reset_start:reset_start + 400])
        release_start = source.index('void ShellHostView::ReleaseDragEscape() {')
        release = source[release_start:source.index('\n}\n', release_start) + 3]
        self.assertIn('ReleaseDragEscape();', source[source.index('ShellHostView::~ShellHostView()'):source.index('ShellHostView::~ShellHostView()') + 600])
        prelude = r"""
#include <cassert>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
namespace base {
struct DictValue {
  std::map<std::string, std::string> values;
  DictValue&& Set(std::string_view key, std::string_view value) && { values[std::string(key)] = std::string(value); return std::move(*this); }
};
struct Value {
  DictValue dict;
  bool flag = false;
  bool boolean = false;
  explicit Value(DictValue value) : dict(std::move(value)) {}
  explicit Value(bool value) : flag(value), boolean(true) {}
  Value(const char*) {}
  Value() = default;
  bool is_bool() const { return boolean; }
  bool GetBool() const { return flag; }
};
}
namespace ui {
constexpr int VKEY_ESCAPE = 27;
constexpr int EF_SHIFT_DOWN = 1 << 1;
constexpr int EF_CONTROL_DOWN = 1 << 2;
constexpr int EF_ALT_DOWN = 1 << 3;
constexpr int EF_COMMAND_DOWN = 1 << 4;
enum class EventType { kKeyPressed, kKeyReleased };
struct KeyEvent {
  EventType event_type = EventType::kKeyPressed;
  int key = VKEY_ESCAPE;
  int modifiers = 0;
  EventType type() const { return event_type; }
  int key_code() const { return key; }
  int flags() const { return modifiers; }
};
}
struct ShellHostView;
std::map<int, ShellHostView*>& Hosts() {
  static std::map<int, ShellHostView*> hosts;
  return hosts;
}
struct ShellHostView {
  int id_;
  bool modal = false;
  std::vector<std::string> events;
  explicit ShellHostView(int id) : id_(id) { Hosts()[id] = this; }
  ~ShellHostView() { ReleaseDragEscape(); Hosts().erase(id_); }
  bool OwnsKeyboardEvent(const ui::KeyEvent&) const { return !modal; }
  void Event(std::string_view module, std::string_view event, base::Value payload) {
    events.push_back(std::string(module) + "." + std::string(event) + ":" + payload.dict.values["type"]);
  }
  bool ForwardDragEscape(const ui::KeyEvent& event);
  void ReleaseDragEscape();
  void Capture(std::vector<base::Value> values, std::function<void(bool, base::Value)> done);
};
"""
        capture_method = 'void ShellHostView::Capture(std::vector<base::Value> values, std::function<void(bool, base::Value)> done) {\n  const std::string method = "ArdiaShell.setDragEscapeCapture";\n  ' + capture.replace('std::move(done).Run(', 'done(') + '}\n'
        checks = r"""
int main() {
  bool ok = false;
  const auto done = [&](bool result, base::Value) { ok = result; };
  ShellHostView source(1);
  {
    ShellHostView other(2);
    ui::KeyEvent escape;
    assert(!source.ForwardDragEscape(escape) && !other.ForwardDragEscape(escape));
    std::vector<base::Value> on;
    on.emplace_back(true);
    source.Capture(std::move(on), done);
    assert(ok);
    assert(other.ForwardDragEscape(escape));
    assert(source.events.size() == 1 && source.events[0] == "ArdiaShell.onAppEvent:dragEscape" && other.events.empty());
    assert(source.ForwardDragEscape(escape) && source.events.size() == 2);
    ui::KeyEvent shifted;
    shifted.modifiers = ui::EF_SHIFT_DOWN;
    assert(!other.ForwardDragEscape(shifted));
    ui::KeyEvent released;
    released.event_type = ui::EventType::kKeyReleased;
    assert(!other.ForwardDragEscape(released));
    ui::KeyEvent letter;
    letter.key = 65;
    assert(!other.ForwardDragEscape(letter));
    other.modal = true;
    assert(!other.ForwardDragEscape(escape));
    other.modal = false;
    std::vector<base::Value> off;
    off.emplace_back(false);
    other.Capture(std::move(off), done);
    assert(ok && other.ForwardDragEscape(escape) && source.events.size() == 3);
    std::vector<base::Value> bad;
    other.Capture(std::move(bad), done);
    assert(!ok);
    std::vector<base::Value> released_capture;
    released_capture.emplace_back(false);
    source.Capture(std::move(released_capture), done);
    assert(ok && !other.ForwardDragEscape(escape) && source.events.size() == 3);
    std::vector<base::Value> again;
    again.emplace_back(true);
    other.Capture(std::move(again), done);
  }
  ui::KeyEvent escape;
  assert(!source.ForwardDragEscape(escape) && source.events.size() == 3);
}
"""
        with tempfile.TemporaryDirectory(prefix='ardia-drag-escape-') as scratch:
            cpp = Path(scratch) / 'escape.cc'
            cpp.write_text(prelude + owner + forward + release + capture_method + checks)
            binary = Path(scratch) / 'escape'
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', str(cpp), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
