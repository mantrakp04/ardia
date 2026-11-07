#ifndef ARDIA_LINUX_AC_LINUX_IMPORT_SESSIONS_H_
#define ARDIA_LINUX_AC_LINUX_IMPORT_SESSIONS_H_

#include <optional>
#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_import_crypto.h"
#include "ardia/linux/ac_linux_import_storage.h"
#include "base/values.h"

namespace ardia::linux_import {

inline constexpr size_t kMaxSessionBytes = 64u * 1024 * 1024;
inline constexpr size_t kMaxImportedTabs = 5000;

struct OpenTabs {
  base::ListValue tabs;
  base::ListValue groups;
  int count = 0;
};

std::optional<Failure> ParseChromiumSession(std::string_view data, const SecretBytes* key, OpenTabs* out);
std::optional<Failure> ParseFirefoxSession(std::string_view json, OpenTabs* out);
bool ChromiumSessionNeedsKey(const std::string& profile);
std::optional<Failure> ReadChromiumTabs(const std::string& profile, const SecretBytes* key, OpenTabs* out);
std::optional<Failure> ReadFirefoxTabs(const std::string& profile, OpenTabs* out);

}

#endif
