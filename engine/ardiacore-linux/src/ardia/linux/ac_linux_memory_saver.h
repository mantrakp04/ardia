#ifndef ARDIA_LINUX_AC_LINUX_MEMORY_SAVER_H_
#define ARDIA_LINUX_AC_LINUX_MEMORY_SAVER_H_

#include <cstddef>
#include <optional>
#include <string_view>

#include "base/values.h"

namespace ardiacore {

inline constexpr const char* kLinuxMemorySaverRoutes[] = {"engine.memorySaver", "engine.validateKeepActiveSite"};
inline constexpr const char kLinuxMemorySaverService[] = "ac_memory_saver";
inline constexpr std::size_t kLinuxKeepActiveSiteLimit = 1000;
inline constexpr std::size_t kLinuxKeepActiveSiteLength = 2048;

bool IsLinuxMemorySaverRoute(std::string_view name);
std::optional<base::DictValue> PrepareLinuxMemorySaver(std::string_view method, const base::DictValue& args);
std::optional<base::DictValue> CompleteLinuxMemorySaver(std::string_view method, const base::DictValue& reply);

}

#endif
