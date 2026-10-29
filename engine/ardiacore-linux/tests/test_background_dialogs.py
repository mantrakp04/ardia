import pathlib
import shutil
import subprocess
import tempfile
import unittest

from test_renderer_contract import method as extract

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
LINUX = SOURCE / 'ardia' / 'linux'
HOST = (LINUX / 'ac_linux_host.cc').read_text()
DIALOGS = (LINUX / 'ac_linux_background_dialogs.cc').read_text()
HEADER = (LINUX / 'ac_linux_background_dialogs.h').read_text()

PICKS = r'''#include <cassert>
#include <string>
#include <vector>
#include "ardia/linux/ac_linux_background_dialogs.h"

using ardiacore::LinuxFileChooserPicks;

int main() {
  assert(LinuxFileChooserPicks("").empty());
  assert((LinuxFileChooserPicks("/tmp/a.bin") == std::vector<std::string>{"/tmp/a.bin"}));
  assert((LinuxFileChooserPicks("/tmp/a.bin\r\n\nrelative.bin\n/tmp/b c.bin\n") ==
          std::vector<std::string>{"/tmp/a.bin", "/tmp/b c.bin"}));
  assert(LinuxFileChooserPicks(std::string("/tmp/a\0b", 8)).empty());
  std::string many;
  for (int i = 0; i < 100; ++i) many += "/tmp/" + std::to_string(i) + "\n";
  assert(LinuxFileChooserPicks(many).size() == ardiacore::kLinuxFileChooserPickLimit);
  assert(LinuxFileChooserPicks(std::string(ardiacore::kLinuxFileChooserFileLimit + 1, '/')).empty());
  return 0;
}
'''


class BackgroundFileDialogTests(unittest.TestCase):
    def test_answers_are_absolute_paths_one_per_line_and_bounded(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if not compiler:
            self.skipTest('C++ compiler is unavailable')
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / 'picks.cc'
            binary = pathlib.Path(directory) / 'picks'
            source.write_text(PICKS)
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(SOURCE),
                                    str(source), '-o', str(binary)], capture_output=True, text=True)
            self.assertEqual(built.returncode, 0, built.stderr)
            ran = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(ran.returncode, 0, ran.stderr)

    def test_only_background_instances_replace_the_file_dialog(self):
        install = extract(DIALOGS, 'void InstallLinuxBackgroundFileDialogs() {')
        self.assertLess(install.index('if (!BackgroundInstance()) return;'),
                        install.index('ui::SelectFileDialog::SetFactory(std::make_unique<BackgroundFileDialogFactory>());'))
        start = extract(HOST, 'void StartLinuxHost() {')
        self.assertLess(start.index('ardiacore::InitializeLinuxLaunchConfig();'),
                        start.index('ardiacore::InstallLinuxBackgroundFileDialogs();'))

    def test_a_dialog_takes_the_scripted_answer_once_off_the_ui_thread_and_otherwise_cancels(self):
        take = extract(DIALOGS, 'std::vector<std::string> TakeFileChooserPicks(const base::FilePath& directory) {')
        self.assertIn('directory.AppendASCII(kLinuxFileChooserAnswers)', take)
        self.assertIn('base::ReadFileToStringWithMaxSize(answers, &text, kLinuxFileChooserFileLimit)', take)
        self.assertIn('base::DeleteFile(answers);', take)
        self.assertIn('kLinuxFileChooserAnswers[] = "file-chooser.txt";', HEADER)
        select = extract(DIALOGS, '  void SelectFileImpl(Type type,')
        self.assertIn('base::PathService::Get(chrome::DIR_USER_DATA, &directory);', select)
        self.assertIn('base::ThreadPool::PostTaskAndReplyWithResult(', select)
        self.assertIn('base::MayBlock()', select)
        self.assertIn('base::BindOnce(&BackgroundFileDialog::Answer, base::WrapRefCounted(this), type)', select)
        self.assertIn('LOG(WARNING)', select)
        answer = extract(DIALOGS, '  void Answer(Type type, std::vector<std::string> picks) {')
        self.assertLess(answer.index('if (!listener_) return;'), answer.index('listener_->FileSelectionCanceled()'))
        self.assertIn('if (picks.empty()) return listener_->FileSelectionCanceled();', answer)
        self.assertIn('listener_->MultiFilesSelected(files);', answer)
        self.assertIn('listener_->FileSelected(ui::SelectedFileInfo(base::FilePath(picks.front())), 0);', answer)
        self.assertIn('void ListenerDestroyed() override { listener_ = nullptr; }', DIALOGS)

    def test_helper_is_comment_free_and_built(self):
        build = (LINUX / 'BUILD.gn').read_text()
        for name in ('ac_linux_background_dialogs.cc', 'ac_linux_background_dialogs.h'):
            self.assertIn(f'"{name}",', build)
            text = (LINUX / name).read_text()
            self.assertNotRegex(text, r'(?m)^\s*//|/\*')


if __name__ == '__main__':
    unittest.main()
