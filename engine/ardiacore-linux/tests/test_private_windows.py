import pathlib
import unittest

from test_renderer_contract import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'


class PrivateWindowDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.host = HOST.read_text()

    def test_the_directory_lists_other_private_windows_by_id_and_stable_ordinal_only(self):
        listed = method(self.host, '  if (method == "ArdiaShell.privateWindows") {')
        self.assertIn('ardiacore::linux_profiles::WindowListedAsPrivate(host->access(), requester())', listed)
        self.assertIn('!host->is_utility() && host->browser()', listed)
        self.assertIn('windows.Append(base::DictValue().Set("id", host->window_id()).Set("ordinal", host->private_ordinal_));', listed)
        for leaked in ('Strip()', 'title', 'url', 'page_profile', 'bindings_'):
            self.assertNotIn(leaked, listed)

    def test_a_private_window_takes_the_lowest_free_ordinal_when_it_is_configured(self):
        configure = method(self.host, '  void ConfigureWindow(RequestedWindow request) {')
        self.assertIn('name->kind == ardiacore::linux_profiles::ProfileKind::kPrivate', configure)
        self.assertIn('if (host != this && host->private_ordinal_) taken.push_back(host->private_ordinal_);', configure)
        self.assertIn('private_ordinal_ = ardiacore::linux_profiles::NextPrivateOrdinal(taken);', configure)

    def test_any_renderer_may_focus_a_private_window_but_nothing_else(self):
        operations = method(self.host, '  if (method == "ArdiaShell.windowFrame" || method == "ArdiaShell.closeWindow"')
        self.assertIn('(method == "ArdiaShell.focusWindow" ? FocusReaches(host) : Reaches(host))', operations)
        focus = method(self.host, '  bool FocusReaches(const ShellHostView* target) const {')
        self.assertIn('ardiacore::linux_profiles::WindowFocusableBy(target->access(), requester())', focus)
        ids = method(self.host, '  if (method == "ArdiaShell.windowIds") {')
        self.assertIn('if (Reaches(host)) ids.Append(host->window_id());', ids)
        request = method(self.host, '  if (method == "ArdiaShell.requestWindowClose") {')
        self.assertIn('!Reaches(target)) continue;', request)

    def test_every_renderer_hears_when_the_private_directory_changes(self):
        changed = method(self.host, 'void PrivateWindowsChanged() {')
        self.assertIn('host->Event("ArdiaShell", "privateWindows", base::Value(base::DictValue()));', changed)
        attach = method(self.host, '  void Attach(base::WeakPtr<BrowserWindowInterface> browser, bool startup) {')
        self.assertIn('if (shell->private_window()) PrivateWindowsChanged();', attach)
        closed = method(self.host, '  void OnBrowserClosed(BrowserWindowInterface* browser) override {')
        self.assertIn('PrivateWindowsChanged();', closed)


if __name__ == '__main__':
    unittest.main()
