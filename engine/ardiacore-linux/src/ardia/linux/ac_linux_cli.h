#ifndef ARDIA_LINUX_AC_LINUX_CLI_H_
#define ARDIA_LINUX_AC_LINUX_CLI_H_

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/linux/ac_linux_automation.h"
#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/values.h"

namespace ardiacore {

inline constexpr const char* kLinuxCliCapabilities[] = {"ArdiaCli.installedVersion", "ArdiaCli.install"};

using LinuxModuleBroadcast = base::RepeatingCallback<void(std::string_view event, base::Value payload)>;

struct LinuxCliInstallPlan {
  LinuxCliInstallPlan();
  LinuxCliInstallPlan(const LinuxCliInstallPlan&);
  LinuxCliInstallPlan(LinuxCliInstallPlan&&);
  ~LinuxCliInstallPlan();
  std::string app_version;
  base::FilePath package_directory;
  std::optional<std::string> home;
  std::optional<std::string> bin_dir;
  std::optional<std::string> url;
  std::optional<std::string> default_home;
  bool isolated = false;
};

std::string LinuxAppVersion();
bool LinuxCliReleaseVersion(std::string_view version);
std::optional<std::string> LinuxCliDigest(std::string_view text);
std::optional<base::FilePath> LinuxCliHome(const LinuxCliInstallPlan& plan);
base::DictValue LinuxCliInstallResult(const std::vector<std::string>& lines, int status,
                                      const std::vector<std::string>& errors, const std::string& app_version,
                                      const std::optional<std::string>& installed);

void InitLinuxCli(LinuxModuleSink sink, LinuxModuleBroadcast broadcast);
bool LinuxCliInvokes(std::string_view method);
void LinuxCliInvoke(const std::string& caller, std::string_view method, const base::ListValue& args,
                    base::OnceCallback<void(bool, base::Value)> done);
std::optional<base::Value> LinuxCliBootstrapVersion();

}

#endif
