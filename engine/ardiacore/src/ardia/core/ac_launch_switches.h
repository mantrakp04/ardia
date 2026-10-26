#ifndef ARDIA_CORE_AC_LAUNCH_SWITCHES_H_
#define ARDIA_CORE_AC_LAUNCH_SWITCHES_H_

#include <optional>
#include <string>
#include <string_view>

namespace base {
class CommandLine;
}

namespace ardiacore {

inline constexpr char kBackgroundSwitch[] = "ardia-background";
inline constexpr char kDataDirSwitch[] = "ardia-data-dir";
inline constexpr char kTestSwitch[] = "ardia-test";
inline constexpr char kTraceSwitch[] = "ardia-trace";
inline constexpr char kSwitchesSwitch[] = "ardia-switches";

bool BackgroundInstance();

std::optional<std::string> InstanceValue(std::string_view key);

bool SignedForDistribution();

bool TestInstance();

std::optional<std::string> TestValue(std::string_view key);

bool TestFlag(std::string_view key);

bool Traced(std::string_view area);

std::optional<bool> SwitchOverride(std::string_view name);

bool SwitchOn(std::string_view name);

bool ExperimentOn(std::string_view name);

void PassSwitchesToGpuProcess(base::CommandLine* gpu_command_line);

void DecideTestGateAtStartup();

}

#endif
