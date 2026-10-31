#include "ardia/linux/ac_linux_file_drop.h"

#include <algorithm>
#include <utility>

#include "ardia/linux/ac_linux_downloads.h"

namespace ardia::linux_downloads {

bool LinuxDropLedger::Record(std::vector<std::string> paths, int64_t now_ms) {
  Clear();
  if (paths.empty() || paths.size() > kMaxFiles) return false;
  for (const auto& path : paths) {
    if (!ValidLocalPath(path) || path == "/") return false;
  }
  paths_ = std::move(paths);
  recorded_ms_ = now_ms;
  return true;
}

std::optional<std::vector<std::string>> LinuxDropLedger::Take(const std::vector<std::string>& names,
                                                             int64_t now_ms) {
  std::vector<std::string> paths = std::exchange(paths_, {});
  const int64_t age = now_ms - recorded_ms_;
  recorded_ms_ = 0;
  if (paths.empty() || age < 0 || age > kLifetimeMs || names.size() != paths.size()) return std::nullopt;
  std::vector<std::string> expected;
  expected.reserve(paths.size());
  for (const auto& path : paths) expected.push_back(BaseName(path));
  std::vector<std::string> supplied = names;
  std::sort(expected.begin(), expected.end());
  std::sort(supplied.begin(), supplied.end());
  if (expected != supplied) return std::nullopt;
  return paths;
}

void LinuxDropLedger::Clear() {
  paths_.clear();
  recorded_ms_ = 0;
}

}
