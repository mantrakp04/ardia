import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'
FIXTURE = ROOT / 'tests/fixtures/pane_layout.h'


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
  ShellHostView host;
  TabBinding* binding = host.Bind(&page, 7);
  Pane() {
    page.focused = [this] { binding->OnWebContentsFocused(nullptr); };
    DevToolsWindow::docked.clear();
    DevToolsWindow::strategies.clear();
    DevToolsWindow::companions.clear();
    views::focus_manager.focused = nullptr;
    posted.clear();
  }
  void Dock(int width = 300) {
    DevToolsWindow::docked[&page] = &frontend;
    DevToolsWindow::strategies[&page].width = width;
  }
  views::WebView* tools() { return binding->devtools_viewport(); }
};

int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string mode = argv[1];
  if (mode == "split") {
    Pane p;
    p.Dock();
    p.host.Show(p.binding, true);
    assert(p.tools() && p.tools()->GetVisible() && p.tools()->web_contents() == &p.frontend);
    assert(p.binding->viewport()->bounds() == gfx::Rect(100, 50, 500, 600));
    assert(p.tools()->bounds() == gfx::Rect(100, 50, 800, 600));
    assert(*p.host.GetIndexOf(p.tools()) < *p.host.GetIndexOf(p.binding->viewport()));
    DevToolsWindow::strategies[&p.page].hide = true;
    p.host.LayoutPane(p.binding);
    assert(*p.host.GetIndexOf(p.tools()) > *p.host.GetIndexOf(p.binding->viewport()));
    DevToolsWindow::docked.clear();
    p.host.LayoutPane(p.binding);
    assert(!p.tools()->GetVisible() && !p.tools()->web_contents());
    assert(p.binding->viewport()->bounds() == gfx::Rect(100, 50, 800, 600));
    return 0;
  }
  if (mode == "focus") {
    Pane p;
    p.Dock();
    p.host.Show(p.binding, true);
    assert(views::focus_manager.focused == p.tools() && p.frontend.focuses == 1);
    p.binding->viewport()->RequestFocus();
    p.host.Show(p.binding, false);
    assert(!p.tools()->GetVisible());
    p.host.Show(p.binding, true);
    assert(p.tools()->GetVisible());
    assert(views::focus_manager.focused == p.binding->viewport() && p.frontend.focuses == 1);
    p.tools()->RequestFocus();
    p.host.Show(p.binding, false);
    views::focus_manager.focused = nullptr;
    p.host.Show(p.binding, true);
    assert(views::focus_manager.focused == p.tools() && p.frontend.focuses == 2);
    p.host.LayoutPane(p.binding);
    assert(p.frontend.focuses == 2);
    content::WebContents replacement;
    DevToolsWindow::docked[&p.page] = &replacement;
    p.binding->viewport()->RequestFocus();
    p.host.LayoutPane(p.binding);
    assert(views::focus_manager.focused == p.tools() && replacement.focuses == 1);
    return 0;
  }
  if (mode == "close-focus") {
    Pane p;
    p.Dock();
    p.host.Show(p.binding, true);
    assert(views::focus_manager.focused == p.tools());
    DevToolsWindow::docked.clear();
    p.host.LayoutPane(p.binding);
    assert(views::focus_manager.focused == p.binding->viewport() && p.page.focuses == 1);
    assert(p.host.events.empty());
    p.page.Focus();
    assert(p.host.events.size() == 1 && p.host.events.front() == std::make_pair(7, std::string("focus")));
    return 0;
  }
  if (mode == "frontend-destroyed") {
    Pane p;
    p.Dock();
    p.host.Show(p.binding, true);
    assert(p.tools()->GetVisible());
    p.frontend.Destroy();
    DrainPosted();
    assert(!p.tools()->GetVisible() && !p.tools()->web_contents());
    assert(p.binding->viewport()->bounds() == gfx::Rect(100, 50, 800, 600));
    return 0;
  }
  if (mode == "before-viewport") {
    Pane p;
    p.binding->viewport_ = nullptr;
    p.host.children.clear();
    p.Dock();
    auto& chrome = p.host.browser_view_storage.containers[&p.page].devtools;
    chrome.SetWebContents(&p.frontend);
    chrome.SetVisible(true);
    p.host.LayoutPane(p.binding);
    assert(!chrome.web_contents() && !chrome.GetVisible());
    assert(!p.tools() && p.frontend.focuses == 0);
    p.binding->claim.clear();
    chrome.SetWebContents(&p.frontend);
    p.host.LayoutPane(p.binding);
    assert(chrome.web_contents() == &p.frontend);
    p.binding->claim = "claim";
    chrome.SetWebContents(nullptr);
    p.binding->viewport_ = p.host.AddChildView(std::make_unique<ViewportView>(0));
    p.host.Show(p.binding, true);
    assert(p.tools() && p.tools()->GetVisible() && p.tools()->web_contents() == &p.frontend);
    assert(views::focus_manager.focused == p.tools() && p.frontend.focuses == 1);
    return 0;
  }
  if (mode == "undock") {
    Pane p;
    p.Dock();
    p.host.Show(p.binding, true);
    assert(views::focus_manager.focused == p.tools());
    p.host.OnDevToolsDockChanged(&p.page, &p.frontend);
    assert(p.tools()->GetVisible() && p.tools()->web_contents() == &p.frontend);
    DrainPosted();
    DevToolsWindow::docked.clear();
    p.host.OnDevToolsDockChanged(&p.page, nullptr);
    assert(!p.tools()->GetVisible() && !p.tools()->web_contents());
    assert(views::focus_manager.focused == p.binding->viewport() && p.page.focuses == 1);
    DrainPosted();
    assert(!p.tools()->web_contents() && p.binding->viewport()->bounds() == gfx::Rect(100, 50, 800, 600));
    content::WebContents toolbox;
    DevToolsWindow::docked[&p.page] = &toolbox;
    p.host.OnDevToolsDockChanged(&p.page, &toolbox);
    DrainPosted();
    assert(p.tools()->GetVisible() && p.tools()->web_contents() == &toolbox);
    DevToolsWindow::docked[&p.page] = &p.frontend;
    p.host.OnDevToolsDockChanged(&p.page, &p.frontend);
    assert(!p.tools()->GetVisible() && !p.tools()->web_contents());
    DrainPosted();
    assert(p.tools()->GetVisible() && p.tools()->web_contents() == &p.frontend);
    ShellHostView other;
    content::WebContents stranger;
    other.OnDevToolsDockChanged(&stranger, nullptr);
    assert(p.tools()->web_contents() == &p.frontend);
    return 0;
  }
  assert(false);
}
'''


class PaneLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        compiler = shutil.which(os.environ.get('CXX', 'clang++')) or shutil.which('g++')
        if not compiler:
            raise unittest.SkipTest('C++ compiler unavailable')
        host = HOST.read_text()
        watch = method(host, 'class DevToolsFrontendWatch') + ';' if 'class DevToolsFrontendWatch' in host else 'struct DevToolsFrontendWatch {};'
        methods = '\n'.join(method(host, signature) for signature in [
            'void ShellHostView::LayoutPane(', 'void ShellHostView::OnDevToolsDockChanged(',
            'void ShellHostView::HideDevToolsViewport(', 'void TabBinding::WebContentsDestroyed(',
            'void TabBinding::FocusFromHost(', 'void TabBinding::OnWebContentsFocused('])
        methods = methods.replace('content::RenderWidgetHost*', 'void*')
        code = FIXTURE.read_text().replace('#pragma once\n', '').replace('ARDIA_FRONTEND_WATCH', watch).replace('ARDIA_HOST_METHODS', methods)
        cls.temp = tempfile.TemporaryDirectory(prefix='ardia-pane-layout-')
        cls.addClassCleanup(cls.temp.cleanup)
        root = pathlib.Path(cls.temp.name)
        (root / 'main.cc').write_text(code + MAIN)
        cls.binary = root / 'pane'
        result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
                                 '-Wno-unused-private-field', '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
                                 str(root / 'main.cc'), '-o', str(cls.binary)], capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    def run_case(self, mode):
        result = subprocess.run([str(self.binary), mode], capture_output=True, text=True, timeout=20,
                                env={**os.environ, 'ASAN_OPTIONS': 'detect_leaks=1'})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_docked_frontend_splits_the_pane_and_orders_by_strategy(self):
        self.run_case('split')

    def test_reshow_restores_the_tabs_previous_focus_and_only_new_frontends_take_focus(self):
        self.run_case('focus')

    def test_devtools_close_returns_focus_to_the_page_without_reporting_page_focus(self):
        self.run_case('close-focus')

    def test_destroyed_frontend_hides_its_panel_and_restores_the_page(self):
        self.run_case('frontend-destroyed')

    def test_devtools_opened_before_the_first_viewport_waits_for_it_without_chrome_hosting_it(self):
        self.run_case('before-viewport')

    def test_undocking_releases_the_frontend_before_chrome_moves_it_into_its_window(self):
        self.run_case('undock')

if __name__ == '__main__':
    unittest.main()
