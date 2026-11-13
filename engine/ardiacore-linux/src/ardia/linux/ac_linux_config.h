#ifndef ARDIA_LINUX_AC_LINUX_CONFIG_H_
#define ARDIA_LINUX_AC_LINUX_CONFIG_H_

#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_automation.h"
#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/values.h"

namespace ardiacore {

inline constexpr const char* kLinuxConfigCapabilities[] = {"ArdiaConfig.readFile", "ArdiaConfig.watch",
                                                           "ArdiaConfig.writeSchemas"};

void InitLinuxConfig(LinuxModuleSink sink);
bool LinuxConfigInvokes(std::string_view method);
void LinuxConfigInvoke(const std::string& caller, const base::FilePath& user_data_directory, std::string_view method,
                       const base::ListValue& args, base::OnceCallback<void(bool, base::Value)> done);
void LinuxConfigCallerGone(const std::string& caller);

}

#endif
