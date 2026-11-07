#pragma once

namespace base {
inline bool IsHexDigit(char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
inline int HexDigitToInt(char c) { return c <= '9' ? c - '0' : (c | 0x20) - 'a' + 10; }
}
