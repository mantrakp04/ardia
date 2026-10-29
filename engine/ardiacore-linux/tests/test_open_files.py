import pathlib
import unittest

from test_renderer_contract import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'


class OpenFilesTests(unittest.TestCase):
    def setUp(self):
        self.files = (LINUX / 'ac_linux_files.cc').read_text()
        self.host = (LINUX / 'ac_linux_host.cc').read_text()

    def test_the_shell_reaches_the_native_file_chooser_and_it_is_advertised(self):
        bootstrap = self.host[self.host.index('base::DictValue ShellHostView::Bootstrap() const {'):self.host.index('void ShellHostView::LayoutOverlay()')]
        self.assertIn('.Append("ArdiaShell.pickFiles")', bootstrap)
        self.assertIn('if (method == "ArdiaShell.pickFiles") {\n    return LinuxPickFiles(GetWidget() ? GetWidget()->GetNativeWindow() : gfx::NativeWindow(), values, std::move(done));', self.host)
        self.assertIn('void LinuxPickFiles(gfx::NativeWindow window, const base::ListValue& values,', (LINUX / 'ac_linux_files.h').read_text())

    def test_the_chooser_opens_several_files_and_answers_with_file_urls_like_macos(self):
        start = method(self.files, '  static void Start(gfx::NativeWindow window, Done done) {')
        self.assertIn('ui::SelectFileDialog::SELECT_OPEN_MULTI_FILE, u"Open File"', start)
        self.assertIn('ERR_FILE_PICKER_UNAVAILABLE', start)
        self.assertIn('picker->Finish();', start)
        self.assertIn('void FileSelected(const ui::SelectedFileInfo& file, int) override { Reply({file}); }', self.files)
        self.assertIn('void MultiFilesSelected(const std::vector<ui::SelectedFileInfo>& files) override { Reply(files); }', self.files)
        self.assertIn('void FileSelectionCanceled() override { Reply({}); }', self.files)
        reply = method(self.files, '  void Reply(const std::vector<ui::SelectedFileInfo>& files) {')
        self.assertIn('urls.Append(net::FilePathToFileURL(file.path()).spec());', reply)
        self.assertLess(reply.index('Finish();'), reply.index('std::move(done).Run(true, base::Value(std::move(urls)));'))

    def test_one_chooser_per_window_and_a_background_instance_answers_an_empty_list(self):
        pick = method(self.files, 'void LinuxPickFiles(gfx::NativeWindow window, const base::ListValue& values, Done done) {')
        self.assertIn('ERR_FILES_REQUEST', pick)
        self.assertLess(pick.index('ardiacore::BackgroundInstance()'), pick.index('OpenFilesPicker::Start('))
        self.assertIn('std::move(done).Run(true, base::Value(base::ListValue()));', pick)
        self.assertLess(pick.index('ERR_FILE_PICKER_OPEN'), pick.index('OpenFilesPicker::Start('))
        finishes = self.files.split('class OpenFilesPicker :')[1]
        self.assertIn('FilesPickers().Release(window_, this);', method(finishes, '  void Finish() {'))


if __name__ == '__main__':
    unittest.main()
