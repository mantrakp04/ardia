import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

from chromium_series import applied

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
PATCH = REPO / 'engine/patches/chromium-linux-devtools-open-tab.patch'
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'


def block(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


def added(patch):
    return '\n'.join(line[1:] for line in patch.splitlines() if line.startswith('+') and not line.startswith('+++'))


PRELUDE = r'''
#include <cassert>
#include <cstdint>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#define BUILDFLAG(flag) 1
#define LOG(level) std::ostringstream()
struct GURL {
  std::string spec_;
  const std::string& spec() const { return spec_; }
  bool operator==(const GURL&) const = default;
};
struct Profile {};
namespace content {
using BrowserContext = Profile;
struct OpenURLParams { GURL url; };
struct WebContents {
  WebContents* OpenURL(const OpenURLParams& params, int) {
    opened_urls.push_back(params.url);
    return result;
  }
  Profile* GetBrowserContext() const { return profile; }
  WebContents* result = nullptr;
  Profile* profile = nullptr;
  std::vector<GURL> opened_urls;
};
}
using content::WebContents;
struct Report {
  content::WebContents* opened;
  GURL url;
  std::string disposition;
};
namespace base {
struct DictValue {
  std::map<std::string, std::string> text;
  std::map<std::string, bool> flags;
  DictValue&& Set(const std::string& key, const std::string& value) && { text[key] = value; return std::move(*this); }
  DictValue&& Set(const std::string& key, const char* value) && { text[key] = value; return std::move(*this); }
  DictValue&& Set(const std::string& key, bool value) && { flags[key] = value; return std::move(*this); }
};
}
class TabBinding {
 public:
  explicit TabBinding(content::WebContents* contents) : contents_(contents) {}
  content::WebContents* contents() const { return contents_; }
  void ReportOpened(content::WebContents* opened, const GURL& url, std::string_view disposition) {
    reports.push_back({opened, url, std::string(disposition)});
  }
  void ReportPresentation(std::string name, base::DictValue data) { presented.emplace_back(std::move(name), std::move(data)); }
  std::vector<Report> reports;
  std::vector<std::pair<std::string, base::DictValue>> presented;
 private:
  content::WebContents* contents_;
};
class ShellHostView;
std::map<int, ShellHostView*>& Hosts() {
  static std::map<int, ShellHostView*> hosts;
  return hosts;
}
std::vector<content::WebContents*> closed;
void CloseDevToolsTab(content::WebContents* contents) { closed.push_back(contents); }
class ShellHostView {
 public:
  ShellHostView(int id, Profile* profile) : profile_(profile) { Hosts()[id] = this; }
  ~ShellHostView() { Hosts().clear(); }
  TabBinding* Bind(int id, content::WebContents* contents) {
    bindings_[id] = std::make_unique<TabBinding>(contents);
    return bindings_[id].get();
  }
  Profile* page_profile() const { return profile_; }
  TabBinding* PrivateLinkBinding() { return bindings_.empty() ? nullptr : bindings_.begin()->second.get(); }
  bool StripHolds(content::WebContents* contents) const { return strip.contains(contents); }
  void FocusWindow() { ++focused; }
  std::set<content::WebContents*> strip;
  uint64_t activation_ = 0;
  int focused = 0;
  ARDIA_REPORT_METHOD
 private:
  Profile* profile_;
  std::map<int, std::unique_ptr<TabBinding>> bindings_;
};
ARDIA_WINDOW_CHOICE
void (*g_ardia_linux_devtools_opened_tab)(content::WebContents*, content::WebContents*, const GURL&) = nullptr;
void (*g_ardia_linux_devtools_open_url)(Profile*, const GURL&) = nullptr;
Profile* profile_ = nullptr;
void InstallHook() {
  ARDIA_HOOK
}
int fallbacks = 0;
void OpenInNewTab(content::WebContents* inspected_web_contents, const GURL& fixed_url) {
  content::OpenURLParams params{fixed_url};
ARDIA_OPEN_IN_NEW_TAB
    fallbacks++;
  }
}
'''

MAIN = r'''
int main() {
  Profile regular, other;
  content::WebContents first_page, second_page, opened, popup, stray;
  for (auto* contents : {&first_page, &second_page, &opened, &popup, &stray}) contents->profile = &regular;
  ShellHostView first(1, &regular), second(2, &regular), idle(3, &regular);
  TabBinding* a = first.Bind(7, &first_page);
  TabBinding* b = second.Bind(9, &second_page);
  first.activation_ = 5;
  second.activation_ = 3;
  idle.activation_ = 50;
  InstallHook();
  assert(g_ardia_linux_devtools_opened_tab && g_ardia_linux_devtools_open_url);
  second_page.result = &opened;
  OpenInNewTab(&second_page, {"https://example.test/5"});
  assert(second_page.opened_urls.size() == 1 && fallbacks == 0);
  assert(a->reports.empty() && b->reports.size() == 1);
  assert(b->reports[0].opened == &opened && b->reports[0].url == GURL{"https://example.test/5"});
  assert(b->reports[0].disposition == "foreground");
  second_page.result = &second_page;
  OpenInNewTab(&second_page, {"https://example.test/same"});
  assert(b->reports.size() == 1 && fallbacks == 0);

  second.strip.insert(&stray);
  popup.result = &stray;
  OpenInNewTab(&popup, {"https://example.test/popup"});
  assert(a->reports.empty() && b->reports.size() == 2 && b->reports[1].opened == &stray);
  assert(second.focused == 1 && first.focused == 0 && closed.empty() && fallbacks == 0);

  content::WebContents loose;
  loose.profile = &regular;
  popup.result = &loose;
  OpenInNewTab(&popup, {"https://example.test/loose"});
  assert(a->reports.size() == 1 && a->reports[0].opened == &loose && first.focused == 1 && closed.empty());

  content::WebContents foreign;
  foreign.profile = &other;
  popup.result = &foreign;
  OpenInNewTab(&popup, {"https://example.test/foreign"});
  assert(closed.size() == 1 && closed[0] == &foreign && a->reports.size() == 1 && b->reports.size() == 2);

  ShellHostView shower(4, &other);
  shower.Bind(11, &foreign);
  foreign.result = nullptr;
  popup.result = &foreign;
  OpenInNewTab(&popup, {"https://example.test/shown"});
  assert(closed.size() == 1);

  second_page.result = nullptr;
  profile_ = &regular;
  OpenInNewTab(&second_page, {"https://example.test/background"});
  assert(fallbacks == 0 && b->presented.empty() && a->presented.size() == 1 && first.focused == 2);
  assert(a->presented[0].first == "openWindow" && a->presented[0].second.text["url"] == "https://example.test/background");
  assert(a->presented[0].second.text["disposition"] == "foreground" && !a->presented[0].second.text.contains("adoptId"));
  second.activation_ = 9;
  OpenInNewTab(nullptr, {"https://example.test/worker"});
  assert(fallbacks == 0 && b->presented.size() == 1 && second.focused == 2 && a->presented.size() == 1);
  profile_ = &other;
  shower.activation_ = 1;
  OpenInNewTab(nullptr, {"https://example.test/other"});
  assert(fallbacks == 0 && a->presented.size() == 1 && b->presented.size() == 1 && shower.focused == 1);
  profile_ = nullptr;
  OpenInNewTab(nullptr, {"https://example.test/refused"});
  assert(fallbacks == 0 && a->presented.size() == 1 && b->presented.size() == 1 && idle.focused == 0);

  assert(!first.ReportDevToolsOpenedTab(nullptr, &opened, {"https://example.test"}));
  return 0;
}
'''


class DevToolsOpenTabTests(unittest.TestCase):
    def setUp(self):
        self.patch = PATCH.read_text()
        self.host = HOST.read_text()

    def linux_open_block(self):
        hunk = next(part for part in re.split(r'^@@.*$', self.patch, flags=re.M) if 'OpenURL(params' in part)
        lines = [line[1:] for line in hunk.splitlines() if line[:1] in (' ', '+')]
        text = '\n'.join(lines)
        start = text.index('#if BUILDFLAG(IS_LINUX)\n') + len('#if BUILDFLAG(IS_LINUX)\n')
        return text[start:text.index('\n#else', start)]

    def test_the_patch_reports_the_tab_devtools_opened_and_keeps_chromes_fallback(self):
        self.assertTrue(self.patch.startswith('--- a/chrome/browser/devtools/devtools_window.cc\n+++ b/chrome/browser/devtools/devtools_window.cc\n'))
        lines = added(self.patch)
        self.assertIn('void (*g_ardia_linux_devtools_opened_tab)(WebContents* inspected,', lines)
        self.assertEqual(lines.count('#if BUILDFLAG(IS_LINUX)'), 2)
        self.assertEqual(lines.count('#else'), 1)
        self.assertNotRegex(lines, r'(^|\s)//|/\*')
        self.assertIn('  if (!linux_opened) {', self.linux_open_block())
        self.assertIn('void (*g_ardia_linux_devtools_open_url)(Profile* profile, const GURL& url) = nullptr;', lines)
        self.assertIn('g_ardia_linux_devtools_open_url(profile_, fixed_url);\n    return;', self.linux_open_block())

    def test_the_patch_is_registered_for_linux_after_the_devtools_authority_patch(self):
        series = (REPO / 'engine/patches/series').read_text().splitlines()
        self.assertIn('chromium chromium-linux-devtools-open-tab.patch linux', series)
        self.assertLess(series.index('chromium chromium-linux-devtools-authority.patch linux'),
                        series.index('chromium chromium-linux-devtools-open-tab.patch linux'))

    def test_the_patch_applies_to_the_156_tree(self):
        with applied(PATCH.name, 'chrome/browser/devtools/devtools_window.cc') as scratch:
            patched = (scratch / 'chrome/browser/devtools/devtools_window.cc').read_text()
            self.assertIn('g_ardia_linux_devtools_opened_tab(inspected_web_contents, linux_opened,', patched)
            self.assertIn('g_ardia_linux_devtools_open_url(profile_, fixed_url);', patched)

    def test_devtools_opened_tabs_are_reported_from_the_inspected_tabs_binding(self):
        compiler = shutil.which(os.environ.get('CXX', 'clang++')) or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        self.assertIn('extern void (*g_ardia_linux_devtools_opened_tab)(content::WebContents*, content::WebContents*, const GURL&);', self.host)
        self.assertIn('extern void (*g_ardia_linux_devtools_open_url)(Profile*, const GURL&);', self.host)
        self.assertIn('void FocusWindow() { ActivateNativeWindow(browser_, WindowFocus().Focus(id_)); }', self.host)
        self.assertIn('if (active) activation_ = ++ActivationClock();', block(self.host, 'void ShellHostView::OnWidgetActivationChanged('))
        report = '\n'.join(block(self.host, signature) for signature in
                           ['  bool ReportDevToolsOpenedTab(', '  bool ShowsDevToolsLinks(', '  void AdoptDevToolsTab(',
                            '  void OpenDevToolsLink(', '  bool BindsTab(', '  uint64_t activation() const'])
        choice = block(self.host, 'ShellHostView* DevToolsLinkWindow(')
        hook = self.host[self.host.index('  g_ardia_linux_devtools_opened_tab = '):]
        hook = hook[:hook.index('\n  };\n', hook.index('g_ardia_linux_devtools_open_url = ')) + len('\n  };\n')]
        code = (PRELUDE.replace('ARDIA_REPORT_METHOD', report).replace('ARDIA_HOOK', hook).replace('ARDIA_WINDOW_CHOICE', choice)
                .replace('ARDIA_OPEN_IN_NEW_TAB', self.linux_open_block())) + MAIN
        with tempfile.TemporaryDirectory(prefix='ardia-devtools-open-tab-') as scratch:
            path = pathlib.Path(scratch)
            (path / 'main.cc').write_text(code)
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-value',
                                     '-fsanitize=address,undefined', str(path / 'main.cc'), '-o', str(path / 'test')],
                                    capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(path / 'test')], capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
