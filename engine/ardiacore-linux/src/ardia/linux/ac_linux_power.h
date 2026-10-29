#ifndef ARDIA_LINUX_AC_LINUX_POWER_H_
#define ARDIA_LINUX_AC_LINUX_POWER_H_

#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_memory_pressure.h"
#include "ardia/linux/ac_linux_tab_policy.h"
#include "base/callback_list.h"
#include "base/functional/callback.h"
#include "base/memory/scoped_refptr.h"
#include "base/memory/weak_ptr.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/single_thread_task_runner.h"
#include "base/timer/timer.h"
#include "base/values.h"

namespace dbus {
class Bus;
}

namespace ardiacore {

struct LinuxMemorySample {
  uint64_t physical = 0;
  uint64_t available = 0;
  std::string level;
  std::string signal;
};

class LinuxPowerMonitor {
 public:
  using Listener = base::RepeatingCallback<void(const base::DictValue&)>;
  static LinuxPowerMonitor& Get();
  LinuxPowerMonitor(const LinuxPowerMonitor&) = delete;
  LinuxPowerMonitor& operator=(const LinuxPowerMonitor&) = delete;
  void Current(base::OnceCallback<void(base::DictValue)> done);
  base::CallbackListSubscription Subscribe(Listener listener);

 private:
  class Properties;
  LinuxPowerMonitor();
  ~LinuxPowerMonitor();
  void Start();
  void Watch();
  void WatchMemory();
  void MemorySampled(LinuxMemorySample sample);
  void PropertiesChanged();
  void PropertiesAnswered();
  void Publish();

  scoped_refptr<base::SingleThreadTaskRunner> memory_runner_;
  scoped_refptr<dbus::Bus> bus_;
  std::unique_ptr<Properties> upower_;
  std::unique_ptr<Properties> display_;
  std::vector<std::unique_ptr<Properties>> profiles_;
  LinuxPowerTracker tracker_;
  size_t unanswered_ = 0;
  std::vector<base::OnceCallback<void(base::DictValue)>> waiting_;
  base::RepeatingCallbackList<void(const base::DictValue&)> listeners_;
  base::OneShotTimer answer_deadline_;
  bool started_ = false;
  base::WeakPtrFactory<LinuxPowerMonitor> weak_factory_{this};
};

}

#endif
