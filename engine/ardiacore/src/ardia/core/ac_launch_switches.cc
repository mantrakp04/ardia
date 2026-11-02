#include "ardia/core/ac_launch_switches.h"

#include <Security/Security.h>

#include <map>
#include <set>
#include <string>
#include <vector>

#include "base/apple/scoped_cftyperef.h"
#include "base/command_line.h"
#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "chrome/common/chrome_switches.h"
#include "components/os_crypt/common/os_crypt_switches.h"
#include "content/public/common/content_switches.h"

namespace ardiacore {

namespace {

const base::CommandLine& CommandLine() {
  return *base::CommandLine::ForCurrentProcess();
}

bool BrowserProcess() {
  return !CommandLine().HasSwitch(switches::kProcessType);
}

std::vector<std::string> ListOf(std::string_view switch_name) {
  return base::SplitString(CommandLine().GetSwitchValueASCII(switch_name), ",",
                           base::TRIM_WHITESPACE, base::SPLIT_WANT_NONEMPTY);
}

std::map<std::string, std::string, std::less<>> EntriesOf(
    std::string_view switch_name) {
  std::map<std::string, std::string, std::less<>> entries;
  for (const std::string& listed : ListOf(switch_name)) {
    const std::string_view entry(listed);
    const size_t equals = entry.find('=');
    std::string key(
        base::TrimWhitespaceASCII(entry.substr(0, equals), base::TRIM_ALL));
    if (key.empty()) {
      continue;
    }
    entries[std::move(key)] =
        equals == std::string::npos
            ? "1"
            : std::string(base::TrimWhitespaceASCII(entry.substr(equals + 1),
                                                    base::TRIM_ALL));
  }
  return entries;
}

const std::map<std::string, std::string, std::less<>>& TestEntries() {
  static const base::NoDestructor<std::map<std::string, std::string, std::less<>>>
      entries(EntriesOf(kTestSwitch));
  return *entries;
}

const std::set<std::string, std::less<>>& TraceAreas() {
  static const base::NoDestructor<std::set<std::string, std::less<>>> areas([] {
    std::vector<std::string> list = ListOf(kTraceSwitch);
    return std::set<std::string, std::less<>>(list.begin(), list.end());
  }());
  return *areas;
}

bool AsksForTestOrTrace() {
  return CommandLine().HasSwitch(kTestSwitch) ||
         CommandLine().HasSwitch(kTraceSwitch);
}

bool UserDataDirIsScratch() {
  const base::FilePath scratch =
      CommandLine().GetSwitchValuePath(kDataDirSwitch);
  const base::FilePath user_data_dir =
      CommandLine().GetSwitchValuePath(switches::kUserDataDir);
  if (scratch.empty() || user_data_dir.empty()) {
    return false;
  }
  const base::FilePath expected = base::MakeAbsoluteFilePath(
      scratch.Append(FILE_PATH_LITERAL("Chromium")));
  const base::FilePath actual = base::MakeAbsoluteFilePath(user_data_dir);
  return !expected.empty() && expected == actual;
}

std::string TestGateRefusal() {
  if (!BrowserProcess()) {
    return "not the browser process";
  }
  if (SignedForDistribution()) {
    return "signed for distribution";
  }
  if (!CommandLine().HasSwitch(os_crypt::switches::kUseMockKeychain)) {
    return "not on the mock keychain";
  }
  if (!UserDataDirIsScratch()) {
    return "--user-data-dir isn't the scratch data dir's Chromium folder";
  }
  return std::string();
}

const std::string& WhyNotATestInstance() {
  static const base::NoDestructor<std::string> refusal(TestGateRefusal());
  return *refusal;
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
  static const bool distribution = [] {
    base::apple::ScopedCFTypeRef<SecCodeRef> self;
    if (SecCodeCopySelf(kSecCSDefaultFlags, self.InitializeInto()) !=
        errSecSuccess) {
      return true;
    }
    base::apple::ScopedCFTypeRef<SecRequirementRef> requirement;
    if (SecRequirementCreateWithString(
            CFSTR("anchor apple generic and "
                  "(certificate leaf[field.1.2.840.113635.100.6.1.9] exists or "
                  "certificate 1[field.1.2.840.113635.100.6.2.6] exists and "
                  "certificate leaf[field.1.2.840.113635.100.6.1.13] exists)"),
            kSecCSDefaultFlags,
            requirement.InitializeInto()) != errSecSuccess) {
      return true;
    }
    return SecCodeCheckValidity(self.get(), kSecCSDefaultFlags,
                                requirement.get()) == errSecSuccess;
  }();
  return distribution;
}

bool TestInstance() {
  return WhyNotATestInstance().empty();
}

std::optional<std::string> TestValue(std::string_view key) {
  if (!CommandLine().HasSwitch(kTestSwitch) || !TestInstance()) {
    return std::nullopt;
  }
  const auto found = TestEntries().find(key);
  if (found == TestEntries().end()) {
    return std::nullopt;
  }
  return found->second;
}

bool TestFlag(std::string_view key) {
  const std::optional<std::string> value = TestValue(key);
  return value && *value != "0" && *value != "off" && *value != "false";
}

bool Traced(std::string_view area) {
  return CommandLine().HasSwitch(kTraceSwitch) && TestInstance() &&
         TraceAreas().contains(area);
}

std::optional<bool> SwitchOverride(std::string_view name) {
  std::optional<bool> said;
  for (const std::string& listed : ListOf(kSwitchesSwitch)) {
    const std::string_view entry(listed);
    const size_t equals = entry.find('=');
    if (equals == std::string::npos ||
        base::TrimWhitespaceASCII(entry.substr(0, equals), base::TRIM_ALL) !=
            name) {
      continue;
    }
    const std::string_view value =
        base::TrimWhitespaceASCII(entry.substr(equals + 1), base::TRIM_ALL);
    if (value == "on" || value == "1" || value == "true") {
      said = true;
    } else if (value == "off" || value == "0" || value == "false") {
      said = false;
    }
  }
  return said;
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
  if (!BrowserProcess() || (!AsksForTestOrTrace() && !BackgroundInstance())) {
    return;
  }
  const std::string& why = WhyNotATestInstance();
  if (why.empty() || !AsksForTestOrTrace()) {
    return;
  }
  LOG(WARNING) << "[ardiacore] --" << kTestSwitch << " and --" << kTraceSwitch
               << " ignored: not a test instance (" << why << ")";
}

}
