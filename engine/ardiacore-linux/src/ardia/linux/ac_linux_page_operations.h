#ifndef ARDIA_LINUX_AC_LINUX_PAGE_OPERATIONS_H_
#define ARDIA_LINUX_AC_LINUX_PAGE_OPERATIONS_H_

#include <stddef.h>

#include <array>
#include <string_view>

namespace ardiacore {

enum class LinuxPageOperationArgs { kNone, kReplace };

struct LinuxPageOperation {
  std::string_view name;
  size_t length;
  std::string_view sha256;
  LinuxPageOperationArgs args;
};

inline constexpr std::array<LinuxPageOperation, 5> kLinuxPageOperations = {{
    {"selectionContext", 1008, "62ba51dd7be1cd91d50b0589d3ed77c5f255976d926e396238962989cfe5bab6", LinuxPageOperationArgs::kNone},
    {"hasSelection", 69, "9bb48919244a58886c424cbc69298a078e3d3958c320cb696c7ac697facdb811", LinuxPageOperationArgs::kNone},
    {"jumpToSelection", 1751, "bac34cf89afc24d8bb87418864914717a177d14adeb141e91fdd111b0ecba730", LinuxPageOperationArgs::kNone},
    {"replaceInField", 3685, "47debcd4188e773db97bd81d575c0b524ef0c4d1b444eb012a6f50a074cb9b2c", LinuxPageOperationArgs::kReplace},
    {"selectedText", 81, "e981a1488b91874e78f575240afb0c8fa7431ef388b18bb0c2338d0b31c77252", LinuxPageOperationArgs::kNone},
}};

}

#endif
