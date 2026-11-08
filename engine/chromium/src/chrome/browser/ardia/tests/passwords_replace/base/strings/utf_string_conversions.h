#pragma once
#include <string>
namespace base {
inline std::u16string UTF8ToUTF16(const std::string& text) { return std::u16string(text.begin(), text.end()); }
}
