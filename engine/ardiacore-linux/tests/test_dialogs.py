import pathlib
import shutil
import subprocess
import tempfile
import unittest

from support import VALUES

ROOT = pathlib.Path(__file__).resolve().parents[1]


class DialogControllerTests(unittest.TestCase):
    def test_production_controller(self):
        self.compile_and_run(False)

    def test_views_presenter_and_parent_teardown(self):
        self.compile_and_run(True)

    def compile_and_run(self, views):
        compiler = shutil.which('clang++') or shutil.which('c++')
        self.assertIsNotNone(compiler)
        with tempfile.TemporaryDirectory(prefix='ardia-dialogs-') as directory:
            root = pathlib.Path(directory)
            headers = {
                'content/public/browser/browser_thread.h': '#define DCHECK_CURRENTLY_ON(sequence) static_cast<void>(0)\n',
                'base/values.h': VALUES.replace('  Value* Set(std::string_view key, Value&& value) & {', '  Value* Set(std::string_view key, const char* value) & { return Set(key, Value(value)); }\n  Value* Set(std::string_view key, bool value) & { return Set(key, Value(value)); }\n  Value* Set(std::string_view key, Value&& value) & {'),
                'base/functional/callback.h': '#include "dialog_callbacks.h"\n',
                'base/functional/bind.h': '#include "dialog_callbacks.h"\n',
                'base/memory/weak_ptr.h': '#include "dialog_callbacks.h"\n',
                'base/strings/utf_string_conversions.h': r'''
#pragma once
#include <codecvt>
#include <locale>
#include <string>
#include <string_view>
namespace base {
inline std::u16string UTF8ToUTF16(const std::string& text) {
  return std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>().from_bytes(text);
}
inline std::string UTF16ToUTF8(std::u16string_view text) {
  return std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>().to_bytes(text.data(), text.data() + text.size());
}
}
''',
                'base/strings/string_util.h': r'''
#pragma once
#include <string_view>
namespace base {
enum TrimPositions { TRIM_ALL };
inline std::u16string_view TrimWhitespace(std::u16string_view value, TrimPositions) {
  constexpr std::u16string_view spaces = u" \t\r\n\u2003";
  const auto start = value.find_first_not_of(spaces);
  if (start == value.npos) return {};
  return value.substr(start, value.find_last_not_of(spaces) - start + 1);
}
}
''',
            }
            if views:
                for name in [
                    'base/scoped_observation.h', 'base/memory/raw_ptr.h',
                    'base/task/single_thread_task_runner.h',
                    'ui/views/widget/widget.h', 'ui/views/widget/widget_observer.h',
                    'ui/base/mojom/dialog_button.mojom.h',
                    'ui/base/mojom/ui_base_types.mojom.h', 'ui/color/color_id.h',
                    'ui/views/controls/button/md_text_button.h',
                    'ui/views/controls/message_box_view.h',
                    'ui/views/controls/textfield/textfield.h',
                    'ui/views/window/dialog_delegate.h',
                ]:
                    headers[name] = '#include "dialog_views.h"\n'
                headers['base/location.h'] = '#define FROM_HERE 0\n'
                headers['base/logging.h'] = '#pragma once\n#include <iostream>\nstruct FakeLogLine { ~FakeLogLine() { std::cerr << std::endl; } template <class T> FakeLogLine& operator<<(const T& value) { std::cerr << value; return *this; } };\n#define LOG(severity) FakeLogLine()\n'
            sources = [str(ROOT / 'src/ardia/linux/ac_linux_dialogs.cc')]
            if views:
                sources.append(str(ROOT / 'src/ardia/linux/ac_linux_dialog_views.cc'))
            sources.append(str(ROOT / 'tests/fixtures' / ('dialog_views.cc' if views else 'dialog_controller.cc')))
            for name, source in headers.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(source)
            executable = root / 'dialogs'
            compiled = subprocess.run([
                compiler, '-std=c++20', '-g', '-fsanitize=address,undefined',
                '-fno-omit-frame-pointer', '-I', str(root),
                '-I', str(ROOT / 'tests/fixtures'), '-I', str(ROOT / 'src'),
                *sources,
                '-o', str(executable),
            ], capture_output=True, text=True, timeout=60)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            result = subprocess.run([str(executable)], capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            if views:
                self.assertIn('[ardiacore] dialog (background run, not shown): "Delete Profile?" (Delete Profile / Keep Profile): Keep Profile\n', result.stderr)
                self.assertEqual(result.stderr.count('[ardiacore] dialog (background run, not shown)'), 1)


if __name__ == '__main__':
    unittest.main()
