import pathlib
import shutil
import subprocess
import tempfile
import unittest

from support import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'


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
struct Profile {
  std::string name;
  Profile* original = this;
  Profile* GetOriginalProfile() { return original; }
};
namespace content {
struct WebContents {
  Profile* profile = nullptr;
  Profile* GetBrowserContext() const { return profile; }
};
}
Profile* ProfileOf(Profile* context) { return context; }
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
  Profile home{"home"};
  Profile otr{"work-otr", &work};
  tab.profile = &work;
  other.profile = &otr;
  ShellHostView first, second;
  first.page = &home;
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


if __name__ == '__main__':
    unittest.main()
