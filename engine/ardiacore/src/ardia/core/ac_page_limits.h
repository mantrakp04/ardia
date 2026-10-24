#ifndef ARDIA_CORE_AC_PAGE_LIMITS_H_
#define ARDIA_CORE_AC_PAGE_LIMITS_H_

#include <stddef.h>

#include <string_view>

namespace ardiacore {

inline constexpr size_t kMaxPageMessageKind = 32;
inline constexpr size_t kMaxEvaluationResultBytes = 4 * 1024 * 1024;

inline constexpr size_t MaxPageMessageBytes(std::string_view kind) {
  return kind == "notification" || kind == "nowPlaying" ? 1280 * 1024
                                                        : 64 * 1024;
}

}

#endif
