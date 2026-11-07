#pragma once
#include <cstdint>
#include <string>
namespace base {
inline std::string NumberToString(uint64_t value) { return std::to_string(value); }
}
