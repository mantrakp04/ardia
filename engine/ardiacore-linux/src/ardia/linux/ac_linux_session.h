#ifndef ARDIA_LINUX_AC_LINUX_SESSION_H_
#define ARDIA_LINUX_AC_LINUX_SESSION_H_

#include <cstddef>
#include <optional>

#include "base/values.h"

namespace ardia {

inline constexpr size_t kLinuxSessionMaxBytes = 8 * 1024 * 1024;
inline constexpr size_t kLinuxSessionMaxDepth = 64;
inline constexpr size_t kLinuxSessionMaxNodes = 100000;

bool ValidLinuxSession(const base::DictValue& session);
std::optional<base::DictValue> MergeLinuxSession(
    const base::DictValue& base,
    const base::DictValue& local,
    const base::DictValue& current);

}

#endif
