#pragma once
#include <initializer_list>
#include <string>
#include <string_view>

namespace base {
inline std::string StrCat(std::initializer_list<std::string_view> parts) {
  std::string joined;
  for (std::string_view part : parts) joined.append(part);
  return joined;
}
}
