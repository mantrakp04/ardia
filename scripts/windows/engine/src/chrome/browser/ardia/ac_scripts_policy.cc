#include "chrome/browser/ardia/ac_scripts_policy.h"

#include "base/files/file_path.h"

namespace ardia {

void RegisterManagementPolicyProviders(Profile* profile,
                                       extensions::ManagementPolicy* policy) {}

void AddScriptsPagesThrottle(content::NavigationThrottleRegistry& registry) {}

bool NamesScriptsFolder(const base::FilePath& path) {
  return false;
}

std::optional<std::string> ScriptsFolderInstallProblem(
    const base::FilePath& path) {
  return std::nullopt;
}

base::FilePath ScriptsFolder() {
  return base::FilePath();
}

base::ScopedClosureRunner BeginScriptsInstall() {
  return base::ScopedClosureRunner();
}

}
