#pragma once
#include <string>
namespace base {
inline std::u16string UTF8ToUTF16(const std::string& text) {
  std::u16string out;
  for (size_t i = 0; i < text.size();) {
    const unsigned char lead = static_cast<unsigned char>(text[i]);
    const int extra = lead < 0x80 ? 0 : (lead >> 5) == 0x6 ? 1 : (lead >> 4) == 0xE ? 2 : (lead >> 3) == 0x1E ? 3 : -1;
    char32_t point = extra == 0 ? lead : extra == 1 ? lead & 0x1F : extra == 2 ? lead & 0x0F : lead & 0x07;
    bool valid = extra >= 0 && i + extra < text.size() + (extra == 0 ? 1 : 0);
    for (int k = 1; valid && k <= extra; ++k) {
      const unsigned char next = static_cast<unsigned char>(text[i + k]);
      valid = (next & 0xC0) == 0x80;
      point = (point << 6) | (next & 0x3F);
    }
    if (!valid || point > 0x10FFFF || (point >= 0xD800 && point <= 0xDFFF)) {
      out.push_back(u'�');
      ++i;
      continue;
    }
    if (point >= 0x10000) {
      point -= 0x10000;
      out.push_back(static_cast<char16_t>(0xD800 + (point >> 10)));
      out.push_back(static_cast<char16_t>(0xDC00 + (point & 0x3FF)));
    } else {
      out.push_back(static_cast<char16_t>(point));
    }
    i += extra + 1;
  }
  return out;
}
}
