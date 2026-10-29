#pragma once
#include <deque>
#include <string>
#include <utility>
#include "base/functional/callback.h"
#define FROM_HERE 0
namespace base {
class SequencedTaskRunner {
 public:
  template <typename Task, typename Reply>
  void PostTaskAndReplyWithResult(int, Task task, Reply reply) {
    tasks_.emplace_back([task = std::move(task), reply = std::move(reply)]() mutable { reply(task()); });
  }
  bool RunOne() {
    if (tasks_.empty()) return false;
    auto task = std::move(tasks_.front());
    tasks_.pop_front();
    std::move(task).Run();
    return true;
  }
  size_t pending() const { return tasks_.size(); }

 private:
  std::deque<OnceCallback<void()>> tasks_;
};
}
