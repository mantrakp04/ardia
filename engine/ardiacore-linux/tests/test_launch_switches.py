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
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <new>
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
  FilePath Append(std::string_view name) const { return FilePath(path_ + "/" + std::string(name)); }
  bool operator==(const FilePath&) const = default;
 private:
  std::string path_;
};
inline bool ReadFileToStringWithMaxSize(const FilePath& path, std::string* contents, size_t limit) {
  FILE* file = std::fopen(path.value().c_str(), "rb");
  if (!file) return false;
  contents->clear();
  char buffer[64];
  size_t count = 0;
  while ((count = std::fread(buffer, 1, sizeof(buffer), file)) > 0) contents->append(buffer, count);
  std::fclose(file);
  if (contents->size() > limit) {
    contents->resize(limit);
    return false;
  }
  return true;
}
enum BasePathKey { DIR_EXE };
class PathService {
 public:
  static bool Get(int, FilePath* path) {
    const char* directory = std::getenv("FIXTURE_EXE_DIR");
    *path = FilePath(directory ? directory : "");
    return directory != nullptr;
  }
};
template <typename T>
class NoDestructor {
 public:
  NoDestructor() { new (storage_) T(); }
  T& operator*() { return *reinterpret_cast<T*>(storage_); }
  T* operator->() { return reinterpret_cast<T*>(storage_); }
 private:
  alignas(T) unsigned char storage_[sizeof(T)];
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
  std::optional<std::string> GetVar(const std::string& name) {
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
  assert(config.values.size() == 9);
  assert(config.At("dataDirectory").text == argv[2]);
  assert(config.At("configDirectory").text == std::string(argv[3]) + "/config");
  assert(!config.At("testInstance").boolean);
  assert(config.At("test").dict->values.empty());
  assert(!config.At("switches").dict->At("newTabPrewarm").boolean);
  if (scenario == "defaults") {
    assert(command->GetSwitchValueASCII("disable-features") == "DevToolsAcceptDebuggingConnections");
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
  } else if (scenario == "approval") {
    assert(command->GetSwitchValueASCII("disable-features") == "Example,DevToolsAcceptDebuggingConnections");
  } else if (scenario == "child") {
    assert(!command->HasSwitch("disable-features"));
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
  } else if (scenario == "package") {
    const char* expected = std::getenv("FIXTURE_VERSION");
    const char* directory = std::getenv("FIXTURE_PACKAGE_DIR");
    assert(ardiacore::LinuxPackage().directory.value() == (directory ? directory : ""));
    if (expected) assert(ardiacore::LinuxPackage().version == std::string(expected));
    else assert(!ardiacore::LinuxPackage().version);
  } else if (scenario == "cli") {
    const auto& cli = ardiacore::LinuxCli();
    const auto expect = [](const std::optional<std::string>& value, const char* name) {
      const char* wanted = std::getenv(name);
      if (wanted) assert(value == std::string(wanted));
      else assert(!value);
    };
    expect(cli.home, "FIXTURE_CLI_HOME");
    expect(cli.bin_dir, "FIXTURE_CLI_BIN_DIR");
    expect(cli.url, "FIXTURE_CLI_URL");
    expect(cli.default_home, "FIXTURE_CLI_DEFAULT_HOME");
    assert(cli.isolated == (std::getenv("FIXTURE_ISOLATED") != nullptr));
  } else if (scenario == "versions") {
    assert(ardiacore::WellFormedLinuxVersion("0.2.44\n") == std::string("0.2.44"));
    assert(ardiacore::WellFormedLinuxVersion(" 0.2.44-nightly.3 \n\n") == std::string("0.2.44-nightly.3"));
    assert(!ardiacore::WellFormedLinuxVersion(""));
    assert(!ardiacore::WellFormedLinuxVersion("\n"));
    assert(!ardiacore::WellFormedLinuxVersion("v0.2.44\n"));
    assert(!ardiacore::WellFormedLinuxVersion("0.2.44\n0.2.45\n"));
    assert(!ardiacore::WellFormedLinuxVersion("0.2.44 beta\n"));
    assert(!ardiacore::WellFormedLinuxVersion("0.2/44\n"));
    assert(!ardiacore::WellFormedLinuxVersion(std::string(65, '1')));
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
        for header in ('base/base_paths.h', 'base/no_destructor.h', 'base/path_service.h', 'base/command_line.h', 'base/environment.h', 'base/files/file_path.h', 'base/files/file_util.h', 'base/logging.h', 'base/strings/string_split.h', 'base/strings/string_util.h', 'base/values.h', 'chrome/common/chrome_switches.h', 'content/public/common/content_switches.h'):
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

    def package_root(self, name, version_text):
        package = self.root / name
        package.mkdir(exist_ok=True)
        if version_text is not None:
            (package / 'VERSION').write_text(version_text)
        return package

    def test_the_version_file_beside_chrome_is_the_app_version(self):
        package = self.package_root('beside', '0.2.44-nightly.3\n')
        self.run_case('package', environment={'FIXTURE_EXE_DIR': str(package), 'FIXTURE_PACKAGE_DIR': str(package), 'FIXTURE_VERSION': '0.2.44-nightly.3'})

    def test_a_missing_or_malformed_version_file_keeps_the_engine_version(self):
        missing = self.package_root('missing', None)
        self.run_case('package', environment={'FIXTURE_EXE_DIR': str(missing), 'FIXTURE_PACKAGE_DIR': str(missing)})
        malformed = self.package_root('malformed', '<html>\n')
        self.run_case('package', environment={'FIXTURE_EXE_DIR': str(malformed), 'FIXTURE_PACKAGE_DIR': str(malformed)})

    def test_the_package_directory_moves_only_for_an_instance_with_its_own_user_data(self):
        real = self.package_root('real', '1.0.0\n')
        scratch = self.package_root('scratch', '0.0.1\n')
        self.run_case('package', environment={'FIXTURE_EXE_DIR': str(real), 'ARDIA_PACKAGE_DIR': str(scratch), 'FIXTURE_PACKAGE_DIR': str(real), 'FIXTURE_VERSION': '1.0.0'})
        self.run_case('package', f'user-data-dir={self.user}', environment={'FIXTURE_EXE_DIR': str(real), 'ARDIA_PACKAGE_DIR': str(scratch), 'FIXTURE_PACKAGE_DIR': str(scratch), 'FIXTURE_VERSION': '0.0.1'})
        self.run_case('package', f'user-data-dir={self.user}', environment={'FIXTURE_EXE_DIR': str(real), 'ARDIA_PACKAGE_DIR': 'relative/dir', 'FIXTURE_PACKAGE_DIR': str(real), 'FIXTURE_VERSION': '1.0.0'})

    def test_chrome_inspect_approval_mode_never_replaces_the_control_server(self):
        self.run_case('approval', 'disable-features=Example')

    def test_well_formed_versions(self):
        self.run_case('versions')

    def test_cli_home_follows_xdg_data_home_then_home(self):
        self.run_case('cli', environment={'HOME': '/home/someone', 'XDG_DATA_HOME': '/data', 'FIXTURE_CLI_DEFAULT_HOME': '/data/ardia/cli'})
        self.run_case('cli', environment={'HOME': '/home/someone', 'XDG_DATA_HOME': 'relative', 'FIXTURE_CLI_DEFAULT_HOME': '/home/someone/.local/share/ardia/cli'})
        self.run_case('cli', environment={'HOME': '/home/someone', 'XDG_DATA_HOME': '', 'FIXTURE_CLI_DEFAULT_HOME': '/home/someone/.local/share/ardia/cli'})

    def test_cli_variables_pass_through_and_mark_isolated_instances(self):
        self.run_case('cli', f'user-data-dir={self.user}', environment={
            'HOME': '/home/someone', 'XDG_DATA_HOME': '', 'ARDIA_CLI_HOME': '/tmp/cli-home', 'ARDIA_CLI_BIN_DIR': '/tmp/cli-bin', 'ARDIA_CLI_URL': 'file:///tmp/a.tar.gz',
            'FIXTURE_CLI_HOME': '/tmp/cli-home', 'FIXTURE_CLI_BIN_DIR': '/tmp/cli-bin', 'FIXTURE_CLI_URL': 'file:///tmp/a.tar.gz',
            'FIXTURE_CLI_DEFAULT_HOME': '/home/someone/.local/share/ardia/cli', 'FIXTURE_ISOLATED': '1'})
        self.run_case('cli', environment={'HOME': '/home/someone', 'XDG_DATA_HOME': '', 'ARDIA_CLI_HOME': 'relative', 'ARDIA_CLI_BIN_DIR': '', 'FIXTURE_CLI_DEFAULT_HOME': '/home/someone/.local/share/ardia/cli'})

    def test_children_read_no_package_or_cli_environment(self):
        package = self.package_root('child-package', '1.0.0\n')
        self.run_case('package', 'type=renderer', environment={'FIXTURE_EXE_DIR': str(package)})
        self.run_case('cli', 'type=renderer', environment={'HOME': '/home/someone', 'ARDIA_CLI_HOME': '/tmp/cli-home'})

    def test_missing_document_root_is_null(self):
        self.run_case('null-directory', directory='')
