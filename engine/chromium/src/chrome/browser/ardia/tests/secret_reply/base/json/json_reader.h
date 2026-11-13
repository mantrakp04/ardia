#pragma once
#include <optional>
#include <string_view>
#include "base/values.h"

namespace base {
enum JSONParserOptions { JSON_PARSE_CHROMIUM_EXTENSIONS = 1 };
struct JSONReader {
  static std::optional<Value> Read(std::string_view, int) { return std::nullopt; }
};
}
