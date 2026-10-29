#ifndef ARDIA_LINUX_AC_LINUX_POLICY_H_
#define ARDIA_LINUX_AC_LINUX_POLICY_H_

#include <cerrno>
#include <cstddef>
#include <string_view>

namespace ardia::linux_policy {

inline constexpr size_t kDocumentLimit = 8 * 1024 * 1024;
inline constexpr char kSyncStateDocument[] = "sync-state.nns";
inline constexpr size_t kSyncStateDocumentLimit = 48 * 1024 * 1024;

inline constexpr size_t DocumentLimit(std::string_view name) {
  return name == kSyncStateDocument ? kSyncStateDocumentLimit : kDocumentLimit;
}

inline bool ValidDocumentName(std::string_view name) {
  if (name.empty() || name.size() > 128 || name == "." || name == "..") {
    return false;
  }
  for (const char c : name) {
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.')) {
      return false;
    }
  }
  return true;
}

inline bool ValidAssetPath(std::string_view path) {
  if (path.empty() || path.size() > 1024 || path.front() == '/') {
    return false;
  }
  while (!path.empty()) {
    const auto slash = path.find('/');
    const auto component = path.substr(0, slash);
    if (!ValidDocumentName(component)) {
      return false;
    }
    if (slash == std::string_view::npos) {
      return true;
    }
    path.remove_prefix(slash + 1);
  }
  return false;
}


enum class StoredRead { kFound, kMissing, kFailed };

inline StoredRead ClassifyStoredRead(int lstat_error, bool read_ok) {
  if (lstat_error == ENOENT) {
    return StoredRead::kMissing;
  }
  if (lstat_error != 0 || !read_ok) {
    return StoredRead::kFailed;
  }
  return StoredRead::kFound;
}

}

#endif
