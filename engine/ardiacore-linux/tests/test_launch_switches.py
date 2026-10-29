import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest


SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'src'
SHARED = SOURCE.parents[1] / 'ardiacore/src'

FIXTURE = r'''
#pragma once
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#define LOG(level) std::cerr
namespace base {
class FilePath {
 public:
  FilePath() = default;
  explicit FilePath(std::string path) : path_(std::move(path)) {}
  bool empty() const { return path_.empty(); }
  const std::string& value() const { return path_; }
  bool operator==(const FilePath&) const = default;
 private:
  std::string path_;
};
inline FilePath MakeAbsoluteFilePath(const FilePath& path) {
  std::error_code error;
  auto resolved = std::filesystem::canonical(path.value(), error);
  return error ? FilePath() : FilePath(resolved.string());
}
enum WhitespaceHandling { TRIM_WHITESPACE };
enum SplitResult { SPLIT_WANT_NONEMPTY };
enum TrimPositions { TRIM_ALL };
inline std::string_view TrimWhitespaceASCII(std::string_view text, TrimPositions) {
  const auto first = text.find_first_not_of(" \t\r\n");
  return first == std::string_view::npos ? std::string_view() :
      text.substr(first, text.find_last_not_of(" \t\r\n") - first + 1);
}
inline bool IsStringASCII(std::string_view text) {
  for (unsigned char c : text) if (c > 127) return false;
  return true;
}
inline std::vector<std::string> SplitString(std::string_view text, std::string_view separator,
                                          WhitespaceHandling, SplitResult) {
  std::vector<std::string> parts;
  while (!text.empty()) {
    const auto comma = text.find(separator);
    const auto part = TrimWhitespaceASCII(text.substr(0, comma), TRIM_ALL);
    if (!part.empty()) parts.emplace_back(part);
    if (comma == std::string_view::npos) break;
    text.remove_prefix(comma + separator.size());
  }
  return parts;
}
class CommandLine {
 public:
  static CommandLine* ForCurrentProcess() { static CommandLine command; return &command; }
  bool HasSwitch(std::string_view name) const { return switches_.contains(name); }
  std::string GetSwitchValueASCII(std::string_view name) const {
    auto found = switches_.find(name);
    return found == switches_.end() ? "" : found->second;
  }
  std::string GetSwitchValueNative(std::string_view name) const { return GetSwitchValueASCII(name); }
  FilePath GetSwitchValuePath(std::string_view name) const { return FilePath(GetSwitchValueASCII(name)); }
  void AppendSwitch(std::string_view name) { AppendSwitchNative(name, ""); }
  void AppendSwitchASCII(std::string_view name, const std::string& value) { AppendSwitchNative(name, value); }
  void AppendSwitchNative(std::string_view name, const std::string& value) { switches_[std::string(name)] = value; }
 private:
  std::map<std::string, std::string, std::less<>> switches_;
};
class Environment {
 public:
  static auto Create() { return std::make_unique<Environment>(); }
  std::optional<std::string> GetVar(const std::string& name) const {
    const char* value = std::getenv(name.c_str());
    return value ? std::optional<std::string>(value) : std::nullopt;
  }
};
class DictValue;
class ListValue {};
class Value {
 public:
  Value() = default;
  explicit Value(bool value) : boolean(value), none(false) {}
  explicit Value(const std::string& value) : text(value), none(false) {}
  explicit Value(DictValue&& value);
  explicit Value(ListValue&&) : none(false) {}
  std::shared_ptr<DictValue> dict;
  std::string text;
  bool boolean = false;
  bool none = true;
};
class DictValue {
 public:
  template <typename T> void Set(std::string_view key, T&& value) {
    values.insert_or_assign(std::string(key), Value(std::forward<T>(value)));
  }
  const Value& At(std::string_view key) const { return values.at(std::string(key)); }
  std::map<std::string, Value> values;
};
inline Value::Value(DictValue&& value) : dict(std::make_shared<DictValue>(std::move(value))), none(false) {}
}
namespace switches {
inline constexpr char kUserDataDir[] = "user-data-dir";
inline constexpr char kProcessType[] = "type";
inline constexpr char kGpuProcess[] = "gpu-process";
}
'''

HARNESS = r'''
#include <cassert>
#include "ardia/core/ac_launch_switches.h"
#include "ardia/linux/ac_linux_launch_config.h"
#include "base/command_line.h"
int main(int argc, char** argv) {
  assert(argc >= 4);
  const std::string scenario = argv[1];
  const std::string_view example_experiment = "example";
  auto* command = base::CommandLine::ForCurrentProcess();
  for (int i = 4; i < argc; ++i) {
    const std::string argument = argv[i];
    const auto equals = argument.find('=');
    if (equals == std::string::npos) command->AppendSwitch(argument);
    else command->AppendSwitchNative(argument.substr(0, equals), argument.substr(equals + 1));
  }
  ardiacore::InitializeLinuxLaunchConfig();
  ardiacore::InitializeLinuxLaunchConfig();
  ardiacore::DecideTestGateAtStartup();
  assert(ardiacore::SignedForDistribution());
  assert(!ardiacore::TestInstance());
  assert(!ardiacore::TestFlag("reauth"));
  assert(!ardiacore::TestValue("reauth"));
  assert(!ardiacore::Traced("profileGate"));
  assert(!ardiacore::SwitchOn("newTabPrewarm"));
  const std::string_view unregistered_switch = "unknownDefaultOn";
  const std::string_view unregistered_experiment = "unknownDefaultOff";
  assert(ardiacore::SwitchOn(unregistered_switch));
  assert(!ardiacore::ExperimentOn(unregistered_experiment));
  auto config = ardiacore::LinuxLaunchConfig(base::FilePath(argv[2]), base::FilePath(argv[3]));
  assert(config.values.size() == 8);
  assert(config.At("dataDirectory").text == argv[2]);
  assert(!config.At("testInstance").boolean);
  assert(config.At("test").dict->values.empty());
  assert(!config.At("switches").dict->At("newTabPrewarm").boolean);
  if (scenario == "defaults") {
    assert(!ardiacore::BackgroundInstance());
    assert(!config.At("isolated").boolean);
    assert(config.At("instance").dict->values.empty());
  } else if (scenario == "test-authority") {
    assert(ardiacore::BackgroundInstance());
    assert(!config.At("isolated").boolean);
  } else if (scenario == "environment") {
    assert(ardiacore::BackgroundInstance());
    assert(config.At("background").boolean);
    assert(config.At("instance").dict->At("downloadsDir").text == "/tmp/downloads");
    assert(config.At("instance").dict->values.size() == 1);
    assert(ardiacore::ExperimentOn(example_experiment));
    assert(config.At("isolated").boolean);
  } else if (scenario == "hyprland") {
    assert(ardiacore::InstanceValue("hyprland-runtime-dir") == "/run/user/1000");
    assert(ardiacore::InstanceValue("hyprland-instance") == "abc_123");
    assert(config.At("instance").dict->values.empty());
  } else if (scenario == "hyprland-cli") {
    assert(ardiacore::InstanceValue("hyprland-runtime-dir") == "/tmp/cli-runtime");
    assert(ardiacore::InstanceValue("hyprland-instance") == "cli_instance");
  } else if (scenario == "no-hyprland") {
    assert(!ardiacore::InstanceValue("hyprland-runtime-dir"));
    assert(!ardiacore::InstanceValue("hyprland-instance"));
  } else if (scenario == "precedence") {
    assert(!ardiacore::ExperimentOn(example_experiment));
    assert(!ardiacore::SwitchOverride("malformed"));
    assert(ardiacore::InstanceValue("downloads-dir") == "/tmp/cli");
    assert(config.At("instance").dict->At("downloadsDir").text == "/tmp/cli");
    assert(!config.At("isolated").boolean);
    base::CommandLine gpu;
    gpu.AppendSwitchASCII("type", "gpu-process");
    ardiacore::PassSwitchesToGpuProcess(&gpu);
    assert(gpu.GetSwitchValueASCII("ardia-switches") == command->GetSwitchValueASCII("ardia-switches"));
    assert(!gpu.HasSwitch("ardia-test"));
    assert(!gpu.HasSwitch("ardia-trace"));
    base::CommandLine renderer;
    renderer.AppendSwitchASCII("type", "renderer");
    ardiacore::PassSwitchesToGpuProcess(&renderer);
    assert(!renderer.HasSwitch("ardia-switches"));
  } else if (scenario == "child") {
    assert(!ardiacore::BackgroundInstance());
    assert(!ardiacore::ExperimentOn(example_experiment));
    assert(config.At("instance").dict->values.empty());
  } else if (scenario == "empty-cli") {
    assert(!ardiacore::ExperimentOn(example_experiment));
    assert(config.At("instance").dict->values.empty());
  } else if (scenario == "commas") {
    assert(ardiacore::InstanceValue("downloads-dir") == "/tmp/N05 downloads,review,part=two,, last");
    assert(config.At("instance").dict->At("downloadsDir").text == "/tmp/N05 downloads,review,part=two,, last");
    assert(config.At("instance").dict->values.size() == 1);
  } else if (scenario == "null-directory") {
    assert(config.At("dataDirectory").none);
    assert(!config.At("isolated").boolean);
  } else {
    assert(false);
  }
}
'''


class LaunchSwitchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='ardia-launch-test-')
        cls.root = pathlib.Path(cls.temp.name)
        for header in ('base/command_line.h', 'base/environment.h', 'base/files/file_path.h', 'base/files/file_util.h', 'base/logging.h', 'base/strings/string_split.h', 'base/strings/string_util.h', 'base/values.h', 'chrome/common/chrome_switches.h', 'content/public/common/content_switches.h'):
            path = cls.root / header
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('#include "fixture.h"\n')
        (cls.root / 'fixture.h').write_text(FIXTURE)
        harness = cls.root / 'harness.cc'
        harness.write_text(HARNESS)
        cls.binary = cls.root / 'launch-test'
        result = subprocess.run([shutil.which('clang++') or 'c++', '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', str(cls.root), '-I', str(SOURCE), '-I', str(SHARED), str(SOURCE / 'ardia/core/ac_launch_switches_linux.cc'), str(harness), '-o', str(cls.binary)], capture_output=True, text=True, timeout=30)
        if result.returncode:
            cls.temp.cleanup()
            raise AssertionError(result.stdout + result.stderr)
        cls.user = cls.root / 'userdata'
        cls.user.mkdir()
        cls.alias = cls.root / 'alias'
        cls.alias.symlink_to(cls.user, target_is_directory=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_case(self, scenario, *args, environment=None, directory=None):
        env = {key: value for key, value in os.environ.items() if not key.startswith('ARDIA_') and key != 'HYPRLAND_INSTANCE_SIGNATURE'}
        env.update(environment or {})
        result = subprocess.run([str(self.binary), scenario, str(self.root) if directory is None else directory, str(self.user), *args], env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_production_defaults_and_disabled_prewarm(self):
        self.run_case('defaults')

    def test_environment_allowlist_and_real_root_isolation(self):
        self.run_case('environment', f'user-data-dir={self.alias}', environment={'ARDIA_BACKGROUND': '1', 'ARDIA_SWITCHES': 'example=on,newTabPrewarm=on', 'ARDIA_INSTANCE': 'unknown=secret,reauth=grant,downloadsDir=/tmp/downloads,updateFeed=secret'})

    def test_hyprland_socket_values_come_from_the_launch_environment(self):
        self.run_case('hyprland', environment={'XDG_RUNTIME_DIR': '/run/user/1000', 'HYPRLAND_INSTANCE_SIGNATURE': 'abc_123'})

    def test_hyprland_socket_cli_values_win_over_the_environment(self):
        self.run_case('hyprland-cli', 'ardia-hyprland-runtime-dir=/tmp/cli-runtime', 'ardia-hyprland-instance=cli_instance', environment={'XDG_RUNTIME_DIR': '/run/user/1000', 'HYPRLAND_INSTANCE_SIGNATURE': 'abc_123'})

    def test_hyprland_socket_values_need_a_hyprland_session(self):
        self.run_case('no-hyprland', environment={'XDG_RUNTIME_DIR': '/run/user/1000', 'HYPRLAND_INSTANCE_SIGNATURE': ''})

    def test_renderer_never_imports_hyprland_environment(self):
        self.run_case('no-hyprland', 'type=renderer', environment={'XDG_RUNTIME_DIR': '/run/user/1000', 'HYPRLAND_INSTANCE_SIGNATURE': 'abc_123'})

    def test_downloads_directory_preserves_shared_comma_grammar(self):
        self.run_case('commas', environment={'ARDIA_INSTANCE': 'unknown=secret,downloadsDir=/tmp/N05 downloads,review,part=two,, last,updateFeed=secret'})

    def test_downloads_cli_precedence_preserves_commas(self):
        self.run_case('commas', 'ardia-downloads-dir=/tmp/N05 downloads,review,part=two,, last', environment={'ARDIA_INSTANCE': 'downloadsDir=/tmp/env,ignored'})

    def test_cli_precedence_duplicate_switches_and_gpu_scope(self):
        self.run_case('precedence', 'ardia-switches= example=on,example=off,malformed=bad,example=invalid,newTabPrewarm=on', 'ardia-downloads-dir=/tmp/cli', 'user-data-dir=/missing', environment={'ARDIA_SWITCHES': 'example=on', 'ARDIA_INSTANCE': 'downloadsDir=/tmp/env'})

    def test_empty_cli_overrides_environment(self):
        self.run_case('empty-cli', 'ardia-switches=', 'ardia-downloads-dir=', environment={'ARDIA_SWITCHES': 'example=on', 'ARDIA_INSTANCE': 'downloadsDir=/tmp/env'})

    def test_renderer_never_imports_browser_environment(self):
        self.run_case('child', 'type=renderer', environment={'ARDIA_BACKGROUND': '1', 'ARDIA_SWITCHES': 'example=on', 'ARDIA_INSTANCE': 'downloadsDir=/tmp/env'})

    def test_scratch_background_and_mock_keychain_never_grant_test_authority(self):
        result = self.run_case('test-authority', 'ardia-background', f'ardia-data-dir={self.root}', 'use-mock-keychain', 'headless', 'ardia-test=reauth=grant', 'ardia-trace=profileGate')
        self.assertIn('secure test mode is unavailable on Linux', result.stderr)

    def test_data_directory_environment_does_not_claim_native_isolation(self):
        self.run_case('defaults', environment={'ARDIA_DATA_DIR': '/unselected/scratch', 'ARDIA_TEST': 'reauth=grant', 'ARDIA_TRACE': 'profileGate'})

    def test_missing_document_root_is_null(self):
        self.run_case('null-directory', directory='')
