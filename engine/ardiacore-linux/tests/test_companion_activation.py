import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
HOST = ROOT / 'src/ardia/linux/ac_linux_host.cc'
SIGNATURES = ['void ShellHostView::SelectProfile(', 'void ShellHostView::ActivateMember(']


def method(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


PRELUDE = r'''
#include <cassert>
#include <map>
#include <memory>
#include <string>
#include <vector>
struct Profile {
  std::shared_ptr<bool> alive = std::make_shared<bool>(true);
  struct Weak {
    Profile* profile = nullptr;
    std::weak_ptr<bool> alive;
    Profile* get() const { return alive.expired() ? nullptr : profile; }
  };
  Weak GetWeakPtr() { return {this, alive}; }
};
struct BrowserWindowInterface {
  Profile* profile;
  std::string name;
  bool deleting = false;
  Profile* GetProfile() const { return profile; }
  bool IsDeleteScheduled() const { return deleting; }
};
std::vector<std::string> activity;
std::map<std::string, bool> active;
struct BrowserActiveStateManager {
  BrowserWindowInterface* browser;
  static BrowserActiveStateManager* From(BrowserWindowInterface* browser) {
    static std::vector<std::unique_ptr<BrowserActiveStateManager>> managers;
    managers.push_back(std::make_unique<BrowserActiveStateManager>(BrowserActiveStateManager{browser}));
    return managers.back().get();
  }
  void DidBecomeActive() {
    if (active[browser->name]) return;
    active[browser->name] = true;
    activity.push_back("+" + browser->name);
  }
  void DidBecomeInactive() {
    if (!active[browser->name]) return;
    active[browser->name] = false;
    activity.push_back("-" + browser->name);
  }
};
struct Widget {
  bool active = true;
  bool IsActive() const { return active; }
};
struct Surfaces {};
struct ShellHostView {
  BrowserWindowInterface* browser_ = nullptr;
  std::vector<BrowserWindowInterface*> companions;
  Profile::Weak active_profile_;
  std::unique_ptr<Surfaces> extension_surfaces_ = std::make_unique<Surfaces>();
  std::unique_ptr<Surfaces> extension_keybindings_ = std::make_unique<Surfaces>();
  bool member_active_ = false;
  Widget widget;
  Widget* GetWidget() { return &widget; }
  std::vector<BrowserWindowInterface*> Members() const {
    std::vector<BrowserWindowInterface*> members{browser_};
    members.insert(members.end(), companions.begin(), companions.end());
    return members;
  }
  BrowserWindowInterface* MemberFor(const Profile* profile) const {
    for (auto* member : Members()) if (member->GetProfile() == profile) return member;
    return nullptr;
  }
  bool ServesProfile(const Profile* profile) const { return MemberFor(profile); }
  Profile* ActiveProfile() const {
    Profile* active = active_profile_.get();
    return active && MemberFor(active) ? active : browser_->GetProfile();
  }
  BrowserWindowInterface* ActiveMember() const { return MemberFor(ActiveProfile()); }
  void SelectProfile(Profile* profile);
  void ActivateMember(BrowserWindowInterface* member);
};
'''

MAIN = r'''
std::string Last(char sign) {
  for (auto it = activity.rbegin(); it != activity.rend(); ++it) if ((*it)[0] == sign) return it->substr(1);
  return "";
}
int main() {
  Profile home, work, side;
  BrowserWindowInterface primary{&home, "primary"}, companion{&work, "companion"}, other{&side, "other"};
  ShellHostView host;
  host.browser_ = &primary;
  host.companions = {&companion, &other};
  host.SelectProfile(&work);
  assert(Last('+') == "companion");
  assert(!host.extension_surfaces_ && !host.extension_keybindings_);
  host.SelectProfile(&home);
  assert(Last('+') == "primary");
  assert(activity.back() == "+primary");
  for (const auto& entry : activity) assert(entry != "+other");
  host.SelectProfile(&side);
  assert(Last('+') == "other");
  host.widget.active = false;
  activity.clear();
  host.SelectProfile(&home);
  assert(activity.size() == 1 && activity[0] == "-other");
  for (const auto& entry : activity) assert(entry[0] != '+');
  host.widget.active = true;
  host.SelectProfile(&work);
  assert(activity.back() == "+companion");
  activity.clear();
  host.SelectProfile(&work);
  assert(activity.empty());
  companion.deleting = true;
  host.SelectProfile(&home);
  for (const auto& entry : activity) assert(entry != "+companion");
  companion.deleting = false;

  active.clear();
  activity.clear();
  host.widget.active = true;
  host.SelectProfile(&home);
  host.SelectProfile(&work);
  assert(active["companion"] && !active["primary"]);
  host.widget.active = false;
  host.SelectProfile(&home);
  assert(!active["companion"]);
  assert(!active["primary"]);
  host.widget.active = true;
  host.SelectProfile(&work);
  assert(active["companion"] && activity.back() == "+companion");
  host.widget.active = false;
  host.SelectProfile(&side);
  assert(!active["companion"] && !active["other"]);
  return 0;
}
'''


class CompanionActivationTests(unittest.TestCase):
    def test_switching_back_to_the_window_profile_makes_its_browser_the_last_active_one(self):
        compiler = shutil.which(os.environ.get('CXX', 'clang++')) or shutil.which('g++')
        if not compiler:
            self.skipTest('C++ compiler unavailable')
        host = HOST.read_text()
        methods = '\n'.join(method(host, signature) for signature in SIGNATURES if signature in host)
        with tempfile.TemporaryDirectory(prefix='ardia-companion-activation-') as scratch:
            path = pathlib.Path(scratch)
            (path / 'main.cc').write_text(PRELUDE + methods + MAIN)
            result = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
                                     '-fsanitize=address,undefined', str(path / 'main.cc'), '-o', str(path / 'test')],
                                    capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            result = subprocess.run([str(path / 'test')], capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
