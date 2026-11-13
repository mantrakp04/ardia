#pragma once
#include <algorithm>
#include <utility>
#include <vector>
#include "base/functional/callback.h"
#include "base/time/time.h"
namespace base {
class OneShotTimer {
 public:
  static inline std::vector<OneShotTimer*> running;
  ~OneShotTimer() { Stop(); }
  void Start(int, TimeDelta, OnceClosure task) {
    Stop();
    task_ = std::move(task);
    running.push_back(this);
  }
  void Stop() {
    task_ = OnceClosure();
    std::erase(running, this);
  }
  static void FireAll() {
    std::vector<OneShotTimer*> fired = running;
    running.clear();
    for (OneShotTimer* timer : fired) {
      OnceClosure task = std::move(timer->task_);
      if (task) std::move(task).Run();
    }
  }

 private:
  OnceClosure task_;
};
}
