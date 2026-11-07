#include "ardia/core/ac_launch_switches.h"

#include <map>
#include <string>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_launch_config.h"
#include "base/base_paths.h"
#include "base/command_line.h"
#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "chrome/common/chrome_switches.h"
#include "content/public/common/content_switches.h"

namespace ardiacore {

namespace {

constexpr size_t kVersionFileLimit = 256;
constexpr char kDisableFeaturesSwitch[] = "disable-features";
constexpr char kApprovalDebuggingFeature[] = "DevToolsAcceptDebuggingConnections";
constexpr size_t kVersionLimit = 64;

LinuxPackageInfo& PackageStorage() {
  static base::NoDestructor<LinuxPackageInfo> package;
  return *package;
}

LinuxCliEnvironment& CliStorage() {
  static base::NoDestructor<LinuxCliEnvironment> cli;
  return *cli;
}

std::optional<std::string> NonEmptyVariable(base::Environment& environment, const std::string& name) {
  auto value = environment.GetVar(name);
  if (!value || value->empty()) {
    return std::nullopt;
  }
  return value;
}

std::optional<std::string> AbsoluteVariable(base::Environment& environment, const std::string& name) {
  auto value = NonEmptyVariable(environment, name);
  if (!value || value->front() != '/') {
    return std::nullopt;
  }
  return value;
}

void ReadPackage(base::Environment& environment, bool isolated) {
  LinuxPackageInfo& package = PackageStorage();
  base::FilePath executable_directory;
  base::PathService::Get(base::DIR_EXE, &executable_directory);
  package.directory = executable_directory;
  if (isolated) {
    if (const auto directory = AbsoluteVariable(environment, "ARDIA_PACKAGE_DIR")) {
      package.directory = base::FilePath(*directory);
    }
  }
  std::string text;
  if (!package.directory.empty() &&
      base::ReadFileToStringWithMaxSize(package.directory.Append("VERSION"), &text, kVersionFileLimit)) {
    package.version = WellFormedLinuxVersion(text);
  }
}

void ReadCliEnvironment(base::Environment& environment, bool isolated) {
  LinuxCliEnvironment& cli = CliStorage();
  cli.isolated = isolated;
  cli.home = AbsoluteVariable(environment, "ARDIA_CLI_HOME");
  cli.bin_dir = AbsoluteVariable(environment, "ARDIA_CLI_BIN_DIR");
  cli.url = NonEmptyVariable(environment, "ARDIA_CLI_URL");
  if (const auto data = AbsoluteVariable(environment, "XDG_DATA_HOME")) {
    cli.default_home = *data + "/ardia/cli";
  } else if (const auto home = AbsoluteVariable(environment, "HOME")) {
    cli.default_home = *home + "/.local/share/ardia/cli";
  }
}

const base::CommandLine& CommandLine() {
  return *base::CommandLine::ForCurrentProcess();
}

std::map<std::string, bool, std::less<>> SwitchEntries() {
  std::map<std::string, bool, std::less<>> entries;
  for (const std::string& listed : base::SplitString(
           CommandLine().GetSwitchValueASCII(kSwitchesSwitch), ",",
           base::TRIM_WHITESPACE, base::SPLIT_WANT_NONEMPTY)) {
    const std::string_view entry(listed);
    const size_t equals = entry.find('=');
    if (equals == std::string::npos) {
      continue;
    }
    const std::string_view name =
        base::TrimWhitespaceASCII(entry.substr(0, equals), base::TRIM_ALL);
    const std::string_view value =
        base::TrimWhitespaceASCII(entry.substr(equals + 1), base::TRIM_ALL);
    if (name.empty()) {
      continue;
    }
    if (value == "on" || value == "1" || value == "true") {
      entries[std::string(name)] = true;
    } else if (value == "off" || value == "0" || value == "false") {
      entries[std::string(name)] = false;
    }
  }
  entries["newTabPrewarm"] = false;
  return entries;
}

bool ExplicitUserDataDirectory(const base::FilePath& actual) {
  const base::FilePath requested =
      CommandLine().GetSwitchValuePath(switches::kUserDataDir);
  if (requested.empty() || actual.empty()) {
    return false;
  }
  const base::FilePath resolved = base::MakeAbsoluteFilePath(requested);
  return !resolved.empty() && resolved == base::MakeAbsoluteFilePath(actual);
}

bool KnownInstanceKey(std::string_view key) {
  return key == "jsLocation" || key == "chromiumSwitches" ||
         key == "downloadsDir" || key == "updateFeed" || key == "allowAudio" ||
         key == "allowOcclusion" || key == "releaseNotes" || key == "cliHome" ||
         key == "cliBinDir" || key == "cliUrl" || key == "syncFolder" ||
         key == "importSourceDir" || key == "importSafariHome";
}

std::optional<std::string> DownloadsDirectory(std::string_view text) {
  std::optional<std::string> value;
  bool collecting = false;
  while (true) {
    const size_t comma = text.find(',');
    const std::string_view piece = text.substr(0, comma);
    const size_t equals = piece.find('=');
    const std::string_view key =
        base::TrimWhitespaceASCII(piece.substr(0, equals), base::TRIM_ALL);
    if (KnownInstanceKey(key)) {
      collecting = key == "downloadsDir";
      if (collecting) {
        value = equals == std::string_view::npos
                    ? "1"
                    : std::string(piece.substr(equals + 1));
      }
    } else if (collecting) {
      value->append(",").append(piece);
    }
    if (comma == std::string_view::npos) {
      break;
    }
    text.remove_prefix(comma + 1);
  }
  if (value) {
    *value = std::string(base::TrimWhitespaceASCII(*value, base::TRIM_ALL));
  }
  return value;
}

}

LinuxPackageInfo::LinuxPackageInfo() = default;
LinuxPackageInfo::LinuxPackageInfo(const LinuxPackageInfo&) = default;
LinuxPackageInfo::~LinuxPackageInfo() = default;
LinuxCliEnvironment::LinuxCliEnvironment() = default;
LinuxCliEnvironment::LinuxCliEnvironment(const LinuxCliEnvironment&) = default;
LinuxCliEnvironment::~LinuxCliEnvironment() = default;

std::optional<std::string> WellFormedLinuxVersion(std::string_view text) {
  const size_t newline = text.find('\n');
  const std::string_view rest = newline == std::string_view::npos ? std::string_view() : text.substr(newline + 1);
  if (!base::TrimWhitespaceASCII(rest, base::TRIM_ALL).empty()) {
    return std::nullopt;
  }
  const std::string_view line = base::TrimWhitespaceASCII(text.substr(0, newline), base::TRIM_ALL);
  if (line.empty() || line.size() > kVersionLimit || line.front() < '0' || line.front() > '9') {
    return std::nullopt;
  }
  for (const char c : line) {
    const bool allowed = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                         c == '.' || c == '-' || c == '+';
    if (!allowed) {
      return std::nullopt;
    }
  }
  return std::string(line);
}

const LinuxPackageInfo& LinuxPackage() {
  return PackageStorage();
}

const LinuxCliEnvironment& LinuxCli() {
  return CliStorage();
}

void InitializeLinuxLaunchConfig() {
  static bool initialized = false;
  if (std::exchange(initialized, true) ||
      CommandLine().HasSwitch(switches::kProcessType)) {
    return;
  }
  auto* command = base::CommandLine::ForCurrentProcess();
  const auto environment = base::Environment::Create();
  if (!command->HasSwitch(kBackgroundSwitch) &&
      environment->GetVar("ARDIA_BACKGROUND").value_or("") == "1") {
    command->AppendSwitch(kBackgroundSwitch);
  }
  if (!command->HasSwitch(kSwitchesSwitch)) {
    const auto value = environment->GetVar("ARDIA_SWITCHES");
    if (value && base::IsStringASCII(*value)) {
      command->AppendSwitchASCII(kSwitchesSwitch, *value);
    }
  }
  const auto hyprland = environment->GetVar("HYPRLAND_INSTANCE_SIGNATURE");
  if (hyprland && !hyprland->empty()) {
    if (!command->HasSwitch("ardia-hyprland-instance")) {
      command->AppendSwitchNative("ardia-hyprland-instance", *hyprland);
    }
    const auto runtime = environment->GetVar("XDG_RUNTIME_DIR");
    if (runtime && !command->HasSwitch("ardia-hyprland-runtime-dir")) {
      command->AppendSwitchNative("ardia-hyprland-runtime-dir", *runtime);
    }
  }
  std::string disabled = command->GetSwitchValueASCII(kDisableFeaturesSwitch);
  if (!disabled.empty()) {
    disabled += ",";
  }
  disabled += kApprovalDebuggingFeature;
  command->AppendSwitchASCII(kDisableFeaturesSwitch, disabled);
  const bool isolated = command->HasSwitch(switches::kUserDataDir);
  ReadPackage(*environment, isolated);
  ReadCliEnvironment(*environment, isolated);
  if (!command->HasSwitch("ardia-downloads-dir")) {
    const auto downloads =
        DownloadsDirectory(environment->GetVar("ARDIA_INSTANCE").value_or(""));
    if (downloads) {
      command->AppendSwitchNative("ardia-downloads-dir", *downloads);
    }
  }
}

bool BackgroundInstance() {
  return CommandLine().HasSwitch(kBackgroundSwitch);
}

std::optional<std::string> InstanceValue(std::string_view key) {
  const std::string name = "ardia-" + std::string(key);
  if (!CommandLine().HasSwitch(name)) {
    return std::nullopt;
  }
  return CommandLine().GetSwitchValueNative(name);
}

bool SignedForDistribution() {
  return true;
}

bool TestInstance() {
  return false;
}

std::optional<std::string> TestValue(std::string_view) {
  return std::nullopt;
}

bool TestFlag(std::string_view) {
  return false;
}

bool Traced(std::string_view) {
  return false;
}

std::optional<bool> SwitchOverride(std::string_view name) {
  const auto entries = SwitchEntries();
  const auto found = entries.find(name);
  return found == entries.end() ? std::nullopt
                                : std::optional<bool>(found->second);
}

bool SwitchOn(std::string_view name) {
  return SwitchOverride(name).value_or(true);
}

bool ExperimentOn(std::string_view name) {
  return SwitchOverride(name).value_or(false);
}

void PassSwitchesToGpuProcess(base::CommandLine* gpu_command_line) {
  if (gpu_command_line->GetSwitchValueASCII(switches::kProcessType) !=
          switches::kGpuProcess ||
      !CommandLine().HasSwitch(kSwitchesSwitch)) {
    return;
  }
  gpu_command_line->AppendSwitchASCII(
      kSwitchesSwitch, CommandLine().GetSwitchValueASCII(kSwitchesSwitch));
}

void DecideTestGateAtStartup() {
  if (!CommandLine().HasSwitch(switches::kProcessType) &&
      (CommandLine().HasSwitch(kTestSwitch) ||
       CommandLine().HasSwitch(kTraceSwitch))) {
    LOG(WARNING) << "[ardiacore] test and trace switches ignored: "
                    "secure test mode is unavailable on Linux";
  }
}

base::FilePath LinuxConfigFolder(const base::FilePath& user_data_directory) {
  return user_data_directory.Append("config");
}

base::DictValue LinuxLaunchConfig(const base::FilePath& data_directory,
                                 const base::FilePath& user_data_directory) {
  base::DictValue instance;
  if (const auto downloads = InstanceValue("downloads-dir");
      downloads && !downloads->empty()) {
    instance.Set("downloadsDir", *downloads);
  }
  base::DictValue switches;
  for (const auto& [name, on] : SwitchEntries()) {
    switches.Set(name, on);
  }
  base::DictValue snapshot;
  snapshot.Set("dataDirectory", data_directory.empty()
                                    ? base::Value()
                                    : base::Value(data_directory.value()));
  snapshot.Set("configDirectory",
               LinuxConfigFolder(user_data_directory).value());
  snapshot.Set("background", BackgroundInstance());
  snapshot.Set("isolated", ExplicitUserDataDirectory(user_data_directory));
  snapshot.Set("testInstance", TestInstance());
  snapshot.Set("instance", std::move(instance));
  snapshot.Set("switches", std::move(switches));
  snapshot.Set("trace", base::ListValue());
  snapshot.Set("test", base::DictValue());
  return snapshot;
}

}
