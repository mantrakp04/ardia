#ifndef ARDIA_LINUX_AC_LINUX_WEB_STORE_QUEUE_H_
#define ARDIA_LINUX_AC_LINUX_WEB_STORE_QUEUE_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace ardiacore {

inline constexpr size_t kLinuxWebStoreRequestsMax = 16;
inline constexpr double kLinuxWebStoreClaimSeconds = 30;

bool LinuxWebStoreExtensionId(std::string_view id);

class LinuxWebStoreQueue {
 public:
  std::optional<uint64_t> Add(std::string extension_id);
  std::optional<std::string> Claim(double now);
  std::vector<uint64_t> Uninstalled(std::string_view extension_id);
  std::vector<uint64_t> Expired(double now);
  std::optional<double> NextExpiry() const;
  bool HasClaimed() const;
  void Renew(double now);
  std::vector<uint64_t> Clear();
  void Forget(uint64_t id);
  bool empty() const { return entries_.empty(); }

 private:
  struct Entry {
    uint64_t id = 0;
    std::string extension_id;
    std::optional<double> claimed_at;
  };
  std::vector<Entry> entries_;
  uint64_t next_ = 0;
};

}

#endif
