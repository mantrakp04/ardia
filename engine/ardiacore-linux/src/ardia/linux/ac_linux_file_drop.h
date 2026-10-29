#ifndef ARDIA_LINUX_AC_LINUX_FILE_DROP_H_
#define ARDIA_LINUX_AC_LINUX_FILE_DROP_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace ardia::linux_downloads {

class LinuxDropLedger {
 public:
  static constexpr size_t kMaxFiles = 64;
  static constexpr int64_t kLifetimeMs = 120000;

  bool Record(std::vector<std::string> paths, int64_t now_ms);
  std::optional<std::vector<std::string>> Take(const std::vector<std::string>& names, int64_t now_ms);
  void Clear();
  bool pending() const { return !paths_.empty(); }

 private:
  std::vector<std::string> paths_;
  int64_t recorded_ms_ = 0;
};

}

#endif
