import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

from test_renderer_contract import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
PATCH = REPO / 'engine/patches/chromium-linux-private-links.patch'
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'
TREE = pathlib.Path.home() / 'ardia-linux-build-156/chromium_git/chromium/src'


class PrivateLinkTests(unittest.TestCase):
    def test_the_patch_hands_off_the_record_navigations_to_the_linux_host_before_chrome_opens_a_window(self):
        patch = PATCH.read_text()
        self.assertTrue(patch.startswith('--- a/chrome/browser/ui/navigator/browser_navigator.cc\n'))
        added = '\n'.join(line[1:] for line in patch.splitlines() if line.startswith('+') and not line.startswith('+++'))
        self.assertIn('bool (*g_ardia_linux_off_the_record_navigation)(WebContents* source,', added)
        self.assertEqual(added.count('#if BUILDFLAG(IS_LINUX)'), 2)
        hook = added[added.index('if (params->disposition == WindowOpenDisposition::OFF_THE_RECORD &&'):]
        self.assertIn('!params->contents_to_insert && params->source_contents &&', hook)
        self.assertIn('!params->is_renderer_initiated && params->user_gesture &&', hook)
        self.assertIn('return nullptr;', hook)
        hunks = re.split(r'^@@.*$', patch, flags=re.M)
        hunk = next(part for part in hunks if 'OFF_THE_RECORD' in part)
        context = [line[1:] for line in hunk.splitlines() if line.startswith(' ')]
        self.assertIn('        params->browser->GetTabStripModel()->GetActiveWebContents();', context)
        self.assertIn('  WebContents* contents_to_navigate_or_insert =', context)
        self.assertNotRegex(added, r'(^|\s)//')

    def test_the_patch_is_registered_for_linux_only(self):
        series = (REPO / 'engine/patches/series').read_text().splitlines()
        self.assertIn('chromium chromium-linux-private-links.patch linux', series)

    def test_the_host_turns_the_navigation_into_an_ardia_private_window_request(self):
        host = HOST.read_text()
        self.assertIn('extern bool (*g_ardia_linux_off_the_record_navigation)(content::WebContents*, const GURL&);', host)
        opened = method(host, '  bool OpenPrivateLink(content::WebContents* contents, const GURL& url) {')
        self.assertIn('binding->contents() != contents || !binding->page()', opened)
        self.assertIn('ardiacore::LinuxProfileName(page->GetOriginalProfile())', opened)
        self.assertIn('.Set("disposition", "incognito")', opened)
        self.assertNotIn('adoptId', opened)
        start = host[host.index('g_ardia_linux_off_the_record_navigation = [](content::WebContents* contents, const GURL& url) {'):]
        start = start[:start.index('\n  };\n')]
        self.assertIn('if (host->OpenPrivateLink(contents, url)) return true;', start)
        self.assertIn('return false;', start)


HOOK_FAKES = r'''
#include <cassert>
#include <cstdio>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>
struct Sink { template <class T> Sink operator<<(const T&) const { return {}; } };
#define LOG(level) Sink()
namespace content { struct WebContents {}; }
struct GURL {
  std::string value;
  bool is_valid() const { return !value.empty(); }
  const std::string& spec() const { return value; }
};
namespace base {
struct DictValue {
  std::map<std::string, std::string> values;
  DictValue Set(const std::string& key, const std::string& value) && { values[key] = value; return std::move(*this); }
};
}
struct Profile {
  std::string name;
  Profile* original = this;
  Profile* GetOriginalProfile() { return original; }
};
namespace ardiacore {
inline std::optional<std::string> LinuxProfileName(Profile* profile) {
  if (!profile || profile->name.empty()) return std::nullopt;
  return profile->name;
}
}
struct TabBinding {
  content::WebContents* contents_ = nullptr;
  bool page_ = true;
  std::vector<std::pair<std::string, base::DictValue>> reported;
  content::WebContents* contents() const { return contents_; }
  bool page() const { return page_; }
  void ReportPresentation(const std::string& name, base::DictValue data) { reported.emplace_back(name, std::move(data)); }
};
struct ShellHostView {
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
  Profile* page = nullptr;
  Profile* page_profile() { return page; }
  bool OpenPrivateLink(content::WebContents* contents, const GURL& url);
};
std::map<int, ShellHostView*>& Hosts() {
  static std::map<int, ShellHostView*> hosts;
  return hosts;
}
bool (*g_ardia_linux_off_the_record_navigation)(content::WebContents*, const GURL&) = nullptr;
'''

HOOK_SCENARIO = r'''
void Install() {
HOOK_BODY
}
int main() {
  Install();
  content::WebContents tab, other, unbound;
  Profile work{"work"};
  Profile otr{"work-otr", &work};
  ShellHostView first, second;
  first.page = &work;
  second.page = &otr;
  auto a = std::make_unique<TabBinding>();
  a->contents_ = &tab;
  TabBinding* opened = a.get();
  first.bindings_[1] = std::move(a);
  auto b = std::make_unique<TabBinding>();
  b->contents_ = &other;
  b->page_ = false;
  TabBinding* pageless = b.get();
  second.bindings_[2] = std::move(b);
  Hosts()[1] = &first;
  Hosts()[2] = &second;
  assert(!g_ardia_linux_off_the_record_navigation(nullptr, GURL{"https://a.test/"}));
  assert(!g_ardia_linux_off_the_record_navigation(&tab, GURL{}));
  assert(g_ardia_linux_off_the_record_navigation(&tab, GURL{"https://a.test/"}));
  assert(opened->reported.size() == 1 && opened->reported[0].first == "openWindow");
  assert(opened->reported[0].second.values["disposition"] == "incognito");
  assert(opened->reported[0].second.values["profile"] == "work");
  assert(opened->reported[0].second.values["url"] == "https://a.test/");
  assert(g_ardia_linux_off_the_record_navigation(&other, GURL{"https://b.test/"}));
  assert(pageless->reported.empty());
  assert(g_ardia_linux_off_the_record_navigation(&unbound, GURL{"https://c.test/"}));
  assert(opened->reported.size() == 1);
  std::puts("private_link_hook=ok");
  return 0;
}
'''


class PrivateLinkHookTests(unittest.TestCase):
    def setUp(self):
        self.host = HOST.read_text()
        self.hook = self.host[self.host.index('g_ardia_linux_off_the_record_navigation = [](content::WebContents* contents, const GURL& url) {'):]
        self.hook = self.hook[:self.hook.index('\n  };\n') + len('\n  };')]

    def test_the_hook_opens_through_the_tab_that_owns_the_link_and_refuses_anything_else(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        opened = method(self.host, '  bool OpenPrivateLink(content::WebContents* contents, const GURL& url) {').replace(
            '  bool OpenPrivateLink(', 'bool ShellHostView::OpenPrivateLink(', 1)
        code = HOOK_FAKES + opened + HOOK_SCENARIO.replace('HOOK_BODY', self.hook)
        with tempfile.TemporaryDirectory(prefix='ardia-private-link-') as scratch:
            root = pathlib.Path(scratch)
            (root / 'hook.cc').write_text(code)
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
                                    '-fsanitize=address,undefined', str(root / 'hook.cc'), '-o', str(root / 'hook')],
                                   capture_output=True, text=True, timeout=120)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            ran = subprocess.run([str(root / 'hook')], capture_output=True, text=True, timeout=20)
            self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)
            self.assertIn('private_link_hook=ok', ran.stdout)

    def test_extension_surfaces_and_devtools_need_no_path_of_their_own(self):
        self.assertNotIn('OpenSurfacePrivateLink', self.host)
        self.assertNotIn('PrivateLinkSource', self.host)
        self.assertNotIn('HostsContents', (ROOT / 'src/ardia/linux/ac_linux_extension_views.h').read_text())
        self.assertIn('LOG(WARNING) << "[ardia] off-the-record link refused: the window\'s active tab has no live Ardia page";', self.hook)


class PrivateLinkChromiumTests(unittest.TestCase):
    def setUp(self):
        if not (TREE / 'chrome/browser/ui/browser.cc').is_file():
            self.skipTest('Chromium 156 source is unavailable')

    def test_browser_open_url_drops_its_source_so_the_navigator_uses_the_active_tab(self):
        browser = (TREE / 'chrome/browser/ui/browser.cc').read_text()
        opened = method(browser, 'WebContents* Browser::OpenURL(')
        self.assertIn('nullptr, params, std::move(navigation_handle_callback));', opened)

    def test_devtools_forwards_page_links_to_its_inspected_tab(self):
        devtools = (TREE / 'chrome/browser/devtools/devtools_window.cc').read_text()
        self.assertIn('return OpenURLFromInspectedTab(params);', method(devtools, 'WebContents* DevToolsWindow::OpenURLFromTab('))
        self.assertIn('inspected_web_contents->OpenURL(modified,', method(devtools, 'WebContents* DevToolsWindow::OpenURLFromInspectedTab('))


if __name__ == '__main__':
    unittest.main()
