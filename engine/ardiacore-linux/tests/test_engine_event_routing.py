import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

from support import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
LINUX = SOURCE / 'ardia/linux'
HOST = (LINUX / 'ac_linux_host.cc').read_text()
DOWNLOADS = (LINUX / 'ac_linux_downloads.cc').read_text()

FAKES = r'''
#include <cassert>
#include <cctype>
#include <cstdio>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>
#include "ardia/linux/ac_linux_contract.h"

namespace base {
class DictValue;
class Value {
 public:
  Value() = default;
  explicit Value(bool value) : data_(value) {}
  explicit Value(int value) : data_(value) {}
  explicit Value(std::string value) : data_(std::move(value)) {}
  explicit Value(std::string_view value) : data_(std::string(value)) {}
  explicit Value(const char* value) : data_(std::string(value)) {}
  explicit Value(DictValue value);
  Value Clone() const;
  std::variant<std::monostate, bool, int, std::string, std::shared_ptr<DictValue>> data_;
};
class DictValue {
 public:
  DictValue Clone() const;
  std::optional<bool> FindBool(std::string_view key) const {
    auto found = values_.find(std::string(key));
    if (found == values_.end() || !std::holds_alternative<bool>(found->second.data_)) return std::nullopt;
    return std::get<bool>(found->second.data_);
  }
  std::optional<int> FindInt(std::string_view key) const {
    auto found = values_.find(std::string(key));
    if (found == values_.end() || !std::holds_alternative<int>(found->second.data_)) return std::nullopt;
    return std::get<int>(found->second.data_);
  }
  const std::string* FindString(std::string_view key) const {
    auto found = values_.find(std::string(key));
    return found != values_.end() && std::holds_alternative<std::string>(found->second.data_) ? &std::get<std::string>(found->second.data_) : nullptr;
  }
  const DictValue* FindDict(std::string_view key) const {
    auto found = values_.find(std::string(key));
    return found != values_.end() && std::holds_alternative<std::shared_ptr<DictValue>>(found->second.data_) ? std::get<std::shared_ptr<DictValue>>(found->second.data_).get() : nullptr;
  }
  bool Remove(std::string_view key) { return values_.erase(std::string(key)) > 0; }
  template <class T>
  DictValue& Set(std::string_view key, T value) & { values_[std::string(key)] = Value(std::move(value)); return *this; }
  template <class T>
  DictValue Set(std::string_view key, T value) && { values_[std::string(key)] = Value(std::move(value)); return std::move(*this); }
  std::map<std::string, Value> values_;
};
inline Value::Value(DictValue value) : data_(std::make_shared<DictValue>(std::move(value))) {}
inline Value Value::Clone() const {
  Value copy;
  if (auto* dict = std::get_if<std::shared_ptr<DictValue>>(&data_)) copy.data_ = std::make_shared<DictValue>((*dict)->Clone());
  else copy.data_ = data_;
  return copy;
}
inline DictValue DictValue::Clone() const {
  DictValue copy;
  for (const auto& [key, value] : values_) copy.values_[key] = value.Clone();
  return copy;
}
inline char ToUpperASCII(char c) { return static_cast<char>(std::toupper(static_cast<unsigned char>(c))); }
}

namespace linux_downloads {
LINUX_DELIVERS_REMOVAL
}

namespace ardiacore {
inline std::optional<std::string> LinuxProfileNameForPath(const std::string& path) {
  if (path == "/data/Default") return std::string("default");
  if (path == "/data/Work") return std::string("p-work");
  return std::nullopt;
}
}

std::string String(const base::DictValue& value, std::string_view key) {
  const std::string* found = value.FindString(key);
  return found ? *found : std::string();
}

struct FilePath {
  std::string path;
  const std::string& value() const { return path; }
};
struct Profile {
  std::string path;
  bool otr = false;
  bool shutting_down = false;
  Profile* original = this;
  bool IsOffTheRecord() const { return otr; }
  bool ShutdownStarted() const { return shutting_down; }
  Profile* GetOriginalProfile() { return original; }
  FilePath GetPath() const { return {path}; }
};
bool LinuxDownloadOwned(Profile*, const std::string& id) { return id.starts_with("own-"); }

struct TabBinding {
  std::string key_;
  bool live = true;
  const std::string& key() const { return key_; }
  void* contents() const { return live ? const_cast<TabBinding*>(this) : nullptr; }
};

struct Delivered {
  std::string module, domain, name;
  base::DictValue data;
};

struct BrowserWindowInterface {
  Profile* profile = nullptr;
  Profile* GetProfile() const { return profile; }
};

struct ShellHostView {
  std::vector<Profile*> companions;
  std::vector<BrowserWindowInterface> member_storage;
  std::vector<BrowserWindowInterface*> Members() {
    member_storage.clear();
    member_storage.reserve(companions.size() + 1);
    if (page) member_storage.push_back({page});
    for (Profile* companion : companions) member_storage.push_back({companion});
    std::vector<BrowserWindowInterface*> members;
    for (auto& member : member_storage) members.push_back(&member);
    return members;
  }
  Profile* page = nullptr;
  Profile* regular = nullptr;
  std::map<int, TabBinding> bindings;
  std::vector<Delivered> events;
  Profile* profile() { return regular; }
  Profile* page_profile() { return page; }
  TabBinding* Binding(int id) { auto found = bindings.find(id); return found == bindings.end() ? nullptr : &found->second; }
  TabBinding* BindingForKey(std::string_view key) {
    for (auto& [id, binding] : bindings) if (binding.key() == key) return &binding;
    return nullptr;
  }
  void Event(const std::string& module, const std::string& domain, base::Value payload) {
    auto& dict = *std::get<std::shared_ptr<base::DictValue>>(payload.data_);
    events.push_back({module, domain, String(dict, "name"), dict.FindDict("data")->Clone()});
  }
  bool ReceivesPrivateDownload(const base::DictValue& download);
  bool ReceivesRemoval(bool private_removal, const std::string& profile_path);
  void EngineEvent(std::string_view topic, const base::DictValue& payload);
};
'''

SCENARIO = r'''
int main() {
  Profile regular{"/data/Default"};
  Profile work{"/data/Work"};
  Profile regular_otr{"/data/Default/otr", true, false, &regular};
  Profile work_otr{"/data/Work/otr", true, false, &work};
  ShellHostView plain, private_default, private_work, shutting;
  plain.regular = plain.page = &regular;
  private_default.regular = &regular;
  private_default.page = &regular_otr;
  private_work.regular = &regular;
  private_work.page = &work_otr;
  Profile closing{"/data/Default/otr2", true, true, &regular};
  shutting.regular = &regular;
  shutting.page = &closing;
  std::vector<ShellHostView*> all{&plain, &private_default, &private_work, &shutting};
  auto send = [&](std::string_view topic, base::DictValue payload) {
    for (auto* host : all) { host->events.clear(); host->EngineEvent(topic, payload); }
  };

  send("downloads.removed", base::DictValue().Set("id", "g1").Set("profile", "/data/Default"));
  for (auto* host : all) assert(host->events.size() == 1 && host->events[0].name == "downloads.removed" && host->events[0].module == "ArdiaDownloads");
  assert(String(plain.events[0].data, "profile") == "default");

  send("downloads.removed", base::DictValue().Set("id", "g2").Set("profile", "/data/Default").Set("offTheRecord", true));
  assert(plain.events.empty() && private_work.events.empty());
  assert(private_default.events.size() == 1 && !private_default.events[0].data.FindBool("offTheRecord"));
  assert(shutting.events.size() == 1);

  send("downloads.removed", base::DictValue().Set("id", "g3").Set("profile", "/data/Work").Set("offTheRecord", true));
  assert(plain.events.empty() && private_default.events.empty() && private_work.events.size() == 1);
  assert(String(private_work.events[0].data, "profile") == "p-work");

  send("downloads.removed", base::DictValue().Set("id", "g4").Set("offTheRecord", true));
  for (auto* host : all) assert(host->events.empty());

  send("downloads.changed", base::DictValue().Set("profile", "/data/Default").Set("download", base::DictValue().Set("id", "own-1").Set("offTheRecord", true)));
  assert(plain.events.empty() && private_default.events.size() == 1 && private_work.events.size() == 1 && shutting.events.empty());
  send("downloads.changed", base::DictValue().Set("profile", "/data/Default").Set("download", base::DictValue().Set("id", "other").Set("offTheRecord", true)));
  for (auto* host : all) assert(host->events.empty());

  send("history.changed", base::DictValue().Set("profile", "/data/Default").Set("offTheRecord", true));
  for (auto* host : all) assert(host->events.empty());

  plain.bindings[7] = TabBinding{"t-7"};
  plain.events.clear();
  plain.EngineEvent("extensions.action", base::DictValue().Set("profile", "/data/Default").Set("browserId", 7));
  assert(plain.events.size() == 1 && String(plain.events[0].data, "tabId") == "t-7" && !plain.events[0].data.FindInt("browserId"));
  plain.events.clear();
  plain.EngineEvent("extensions.action", base::DictValue().Set("profile", "/data/Default").Set("browserId", 8));
  assert(plain.events.empty());
  plain.bindings[7].live = false;
  plain.EngineEvent("extensions.action", base::DictValue().Set("profile", "/data/Default").Set("browserId", 7));
  assert(plain.events.empty());
  plain.EngineEvent("unknown.topic", base::DictValue().Set("profile", "/data/Default"));
  assert(plain.events.empty());
  std::puts("engine_event_routing=ok");
  return 0;
}
'''


class EngineEventRoutingTests(unittest.TestCase):
    def test_private_removals_and_downloads_reach_only_the_private_windows_that_own_them(self):
        compiler = shutil.which(os.environ.get('CXX', 'clang++')) or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        members = '\n'.join(method(HOST, signature) for signature in [
            'bool ShellHostView::ReceivesPrivateDownload(',
            'bool ShellHostView::ReceivesRemoval(',
            'void ShellHostView::EngineEvent('])
        code = FAKES.replace('LINUX_DELIVERS_REMOVAL', method(DOWNLOADS, 'bool DeliversRemoval(')) + members + SCENARIO
        with tempfile.TemporaryDirectory(prefix='ardia-engine-event-') as scratch:
            root = pathlib.Path(scratch)
            (root / 'routing.cc').write_text(code)
            built = subprocess.run([compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter',
                                    '-fsanitize=address,undefined', '-I', str(SOURCE),
                                    str(root / 'routing.cc'), '-o', str(root / 'routing')],
                                   capture_output=True, text=True, timeout=120)
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            ran = subprocess.run([str(root / 'routing')], capture_output=True, text=True, timeout=20,
                                 env={**os.environ, 'UBSAN_OPTIONS': 'halt_on_error=1'})
            self.assertEqual(ran.returncode, 0, ran.stdout + ran.stderr)
            self.assertIn('engine_event_routing=ok', ran.stdout)


if __name__ == '__main__':
    unittest.main()
