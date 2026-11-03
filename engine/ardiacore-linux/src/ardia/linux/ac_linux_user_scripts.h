#ifndef ARDIA_LINUX_AC_LINUX_USER_SCRIPTS_H_
#define ARDIA_LINUX_AC_LINUX_USER_SCRIPTS_H_

#include <optional>
#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_automation.h"
#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/values.h"

namespace ardiacore {

inline constexpr const char* kLinuxUserScriptsCapabilities[] = {
    "ArdiaUserScripts.watch", "ArdiaUserScripts.read", "ArdiaUserScripts.readStatus", "ArdiaUserScripts.writeStatus"};

struct LinuxUserScriptsCaller {
  std::string key;
  bool eligible = false;
};

std::optional<std::string> LinuxUserScriptsManifestProblem(int extension_fd, const std::string& manifest);
void InitLinuxUserScripts(const base::FilePath& data_directory, LinuxModuleSink sink);
bool LinuxUserScriptsInvokes(std::string_view method);
void LinuxUserScriptsInvoke(const LinuxUserScriptsCaller& caller, std::string_view method, const base::ListValue& args,
                            base::OnceCallback<void(bool, base::Value)> done);
void LinuxUserScriptsCallerGone(const std::string& caller);

}

#endif
