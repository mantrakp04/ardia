#ifndef ARDIA_LINUX_AC_LINUX_AUTOMATION_H_
#define ARDIA_LINUX_AC_LINUX_AUTOMATION_H_

#include <cstdint>
#include <string>
#include <string_view>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/values.h"

namespace ardiacore {

inline constexpr const char* kLinuxAutomationCapabilities[] = {
    "ArdiaAutomation.start", "ArdiaAutomation.stop", "ArdiaAutomation.reply", "ArdiaAutomation.broadcast"};

using LinuxModuleSink = base::RepeatingCallback<void(const std::string& caller, std::string_view event, base::Value payload)>;
using LinuxCallerRank = base::RepeatingCallback<uint64_t(const std::string& caller)>;

struct LinuxAutomationCaller {
  std::string key;
  std::string window;
  base::FilePath data_directory;
  bool eligible = false;
};

void InitLinuxAutomation(LinuxModuleSink sink, LinuxCallerRank rank);
bool LinuxAutomationInvokes(std::string_view method);
void LinuxAutomationInvoke(const LinuxAutomationCaller& caller, std::string_view method, const base::ListValue& args,
                           base::OnceCallback<void(bool, base::Value)> done);
void LinuxAutomationCallerGone(const std::string& caller);

}

#endif
