import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'
FIXTURE = ROOT / 'tests/fixtures/pane_focus.h'


def method(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


MAIN = r'''
struct Pane {
  content::WebContents page, frontend;
  views::WebView viewport, tools;
  TabBinding* binding;
};

struct Split {
  ShellHostView host;
  Pane a, b;
  views::View shell;
  Split() {
    ChromeWebContentsViewFocusHelper::helpers.clear();
    views::focus_manager.focused = nullptr;
    views::focus_manager.changed = [this](views::View* before, views::View* now) { host.OnDidChangeFocus(before, now); };
    Bind(a, 1);
    Bind(b, 2);
  }
  void Bind(Pane& pane, int id) {
    auto binding = std::make_unique<TabBinding>();
    pane.viewport.SetWebContents(&pane.page);
    pane.tools.SetWebContents(&pane.frontend);
    binding->contents_ = &pane.page;
    binding->viewport_ = &pane.viewport;
    pane.binding = binding.get();
    host.bindings_[id] = std::move(binding);
  }
  void ChromeActivates(Pane& from, Pane& to) {
    ChromeWebContentsViewFocusHelper::FromWebContents(&from.page)->StoreFocus();
    views::focus_manager.ClearFocus();
    host.browser_view.active.SetWebContents(nullptr);
    host.browser_view.active.SetWebContents(&to.page);
    if (!ChromeWebContentsViewFocusHelper::FromWebContents(&to.page)->RestoreFocus()) to.page.Focus();
    host.KeepPaneFocus(nullptr);
    host.ReattachViewports();
  }
  void ShellActivates(Pane& from, Pane& to) {
    host.KeepPaneFocus(to.binding);
    ChromeActivates(from, to);
  }
  void Click(Pane& pane) { pane.viewport.RequestFocus(); }
};

int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  if (mode == "click") {
    Split s;
    s.Click(s.a);
    s.ChromeActivates(s.a, s.b);
    s.Click(s.b);
    const int a = s.a.page.focuses, b = s.b.page.focuses;
    s.Click(s.a);
    s.ShellActivates(s.b, s.a);
    assert(views::focus_manager.focused == &s.a.viewport);
    assert(s.b.page.focuses == b);
    assert(s.a.viewport.web_contents() == &s.a.page && !s.host.browser_view.active.web_contents());
    s.Click(s.b);
    s.ShellActivates(s.a, s.b);
    assert(views::focus_manager.focused == &s.b.viewport && s.a.page.focuses > a);
    const int settled = s.a.page.focuses;
    s.ShellActivates(s.a, s.b);
    assert(views::focus_manager.focused == &s.b.viewport && s.a.page.focuses == settled);
    return 0;
  }
  if (mode == "sidebar") {
    Split s;
    s.Click(s.b);
    s.ShellActivates(s.a, s.b);
    s.Click(s.a);
    s.ShellActivates(s.b, s.a);
    const int a = s.a.page.focuses;
    s.shell.RequestFocus();
    s.ShellActivates(s.a, s.b);
    assert(views::focus_manager.focused == &s.b.viewport && s.a.page.focuses == a);
    const int b = s.b.page.focuses;
    s.shell.RequestFocus();
    s.ShellActivates(s.b, s.a);
    assert(views::focus_manager.focused == &s.shell && s.b.page.focuses == b);
    return 0;
  }
  if (mode == "devtools") {
    Split s;
    s.a.binding->devtools_viewport_ = &s.a.tools;
    s.Click(s.b);
    s.ChromeActivates(s.a, s.b);
    s.a.tools.RequestFocus();
    const int b = s.b.page.focuses;
    s.ShellActivates(s.b, s.a);
    assert(views::focus_manager.focused == &s.a.tools && s.b.page.focuses == b);
    assert(s.host.layouts >= 2);
    s.Click(s.b);
    s.ShellActivates(s.a, s.b);
    s.a.viewport.visible = false;
    s.a.tools.visible = false;
    const int hidden = s.b.page.focuses;
    s.shell.RequestFocus();
    s.ShellActivates(s.b, s.a);
    assert(views::focus_manager.focused != &s.b.viewport && s.b.page.focuses == hidden);
    return 0;
  }
  if (mode == "reattach") {
    Split s;
    s.Click(s.a);
    const int a = s.a.viewport.attaches, b = s.b.viewport.attaches;
    s.host.browser_view.active.SetWebContents(&s.a.page);
    s.host.ReattachViewports();
    assert(s.a.viewport.attaches == a + 1 && s.b.viewport.attaches == b);
    assert(views::focus_manager.focused == &s.a.viewport && s.a.binding->host_focuses == 1 && s.b.page.focuses == 0);
    assert(!s.host.browser_view.active.web_contents() && !s.host.browser_view.active.GetVisible());
    s.b.viewport.SetWebContents(nullptr);
    s.host.ReattachViewports();
    assert(s.b.viewport.web_contents() == &s.b.page && s.a.viewport.attaches == a + 1);
    return 0;
  }
  assert(false);
}
'''


class PaneFocusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which(os.environ.get('CXX', 'clang++')) or shutil.which('g++')
        if not compiler:
            raise unittest.SkipTest('C++ compiler unavailable')
        cls.host = HOST.read_text()
        code = FIXTURE.read_text().replace('#pragma once\n', '').replace(
            'ARDIA_HOST_METHODS', '\n'.join(method(cls.host, signature) for signature in [
                'void ShellHostView::KeepPaneFocus(', 'void ShellHostView::ReattachViewports(', 'void ShellHostView::OnDidChangeFocus(']))
        cls.temp = tempfile.TemporaryDirectory(prefix='ardia-pane-focus-')
        cls.addClassCleanup(cls.temp.cleanup)
        root = pathlib.Path(cls.temp.name)
        (root / 'main.cc').write_text(code + MAIN)
        cls.binary = root / 'pane-focus'
        subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined',
                        str(root / 'main.cc'), '-o', str(cls.binary)], check=True, timeout=120)

    def run_case(self, mode):
        subprocess.run([str(self.binary), mode], check=True, timeout=20)

    def test_clicking_the_inactive_pane_keeps_focus_there_through_chromes_restore(self):
        self.run_case('click')

    def test_activating_a_pane_from_the_shell_focuses_that_pane_and_never_its_neighbour(self):
        self.run_case('sidebar')

    def test_a_focused_docked_devtools_frontend_survives_activating_its_pane(self):
        self.run_case('devtools')

    def test_reattaching_only_moves_the_page_chrome_took_and_keeps_its_focus(self):
        self.run_case('reattach')

if __name__ == '__main__':
    unittest.main()
