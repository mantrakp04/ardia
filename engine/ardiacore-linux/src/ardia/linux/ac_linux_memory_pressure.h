#ifndef ARDIA_LINUX_AC_LINUX_MEMORY_PRESSURE_H_
#define ARDIA_LINUX_AC_LINUX_MEMORY_PRESSURE_H_

#include <poll.h>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace ardiacore {

struct LinuxPsiTotals {
  uint64_t some = 0;
  std::optional<uint64_t> full;
  double some_avg10 = 0;
  std::optional<double> full_avg10;
};

std::optional<LinuxPsiTotals> ParseLinuxPsi(std::string_view text);

enum class LinuxMemoryLevel { kNormal, kWarning, kCritical };

std::string_view LinuxMemoryLevelName(LinuxMemoryLevel level);

class LinuxMemoryPressureTracker {
 public:
  LinuxMemoryLevel Observe(const LinuxPsiTotals& totals, uint64_t now_us, bool triggered);
  LinuxMemoryLevel level() const { return level_; }
  int NextWaitMs(bool armed) const;

 private:
  std::optional<LinuxPsiTotals> baseline_;
  uint64_t baseline_us_ = 0;
  bool measuring_ = false;
  LinuxMemoryLevel level_ = LinuxMemoryLevel::kNormal;
};

std::optional<std::string> LinuxOwnCgroup(std::string_view proc_self_cgroup);
std::vector<std::string> LinuxMemoryPressureFiles(std::string_view cgroup_mount, std::string_view proc_root,
                                                  std::string_view proc_self_cgroup);

class LinuxMemoryPressureWatch {
 public:
  static LinuxMemoryPressureWatch Open(const std::vector<std::string>& paths);
  LinuxMemoryPressureWatch(LinuxMemoryPressureWatch&& other) noexcept;
  LinuxMemoryPressureWatch& operator=(LinuxMemoryPressureWatch&& other) noexcept;
  LinuxMemoryPressureWatch(const LinuxMemoryPressureWatch&) = delete;
  LinuxMemoryPressureWatch& operator=(const LinuxMemoryPressureWatch&) = delete;
  ~LinuxMemoryPressureWatch();

  bool available() const { return !sources_.empty(); }
  bool armed() const;
  std::string_view signal() const { return available() ? "psi" : "meminfo"; }
  LinuxMemoryLevel Sample(uint64_t now_us);
  int NextWaitMs() const;
  bool Wait(int timeout_ms, int (*poll_fn)(pollfd*, nfds_t, int) = &poll);

 private:
  struct Source {
    int fd = -1;
    bool armed = false;
    bool triggered = false;
    LinuxMemoryPressureTracker tracker;
  };
  LinuxMemoryPressureWatch() = default;
  void Close();

  std::vector<Source> sources_;
  int failures_ = 0;
};

uint64_t LinuxMonotonicMicroseconds();

}

#endif
