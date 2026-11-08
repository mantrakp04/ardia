#pragma once
#include <deque>
#include <memory>
#include <utility>
#include "base/functional/callback.h"
#include "base/time/time.h"
#define FROM_HERE 0
namespace base {
class SequencedTaskRunner {
 public:
  static SequencedTaskRunner* GetCurrentDefault() {
    static SequencedTaskRunner runner;
    return &runner;
  }
  void PostTask(int, OnceClosure task) { tasks_.push_back(std::move(task)); }
  void PostDelayedTask(int, OnceClosure task, TimeDelta) {
    ++delayed_;
    tasks_.push_back(std::move(task));
  }
  template <typename T>
  void DeleteSoon(int, std::unique_ptr<T> owned) {
    tasks_.push_back(OnceClosure([owned = std::move(owned)]() mutable { owned.reset(); }));
  }
  bool RunOne() {
    if (tasks_.empty()) return false;
    OnceClosure task = std::move(tasks_.front());
    tasks_.pop_front();
    std::move(task).Run();
    return true;
  }
  void RunAll() {
    while (RunOne()) {
    }
  }
  int delayed() const { return delayed_; }

 private:
  std::deque<OnceClosure> tasks_;
  int delayed_ = 0;
};
}
