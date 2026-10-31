#include "ardia/core/ac_launch_switches.h"

#include <map>
#include <string>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_launch_config.h"
#include "base/command_line.h"
#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/logging.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "chrome/common/chrome_switches.h"
#include "content/public/common/content_switches.h"

namespace ardiacore {

namespace {

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
