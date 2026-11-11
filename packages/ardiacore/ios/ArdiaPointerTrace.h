#pragma once

#include <cstddef>
#include <cstdio>
#include <mutex>
#include <string>
#include <vector>

namespace ardia_pointer {

constexpr std::size_t kHistoryLength = 16;
constexpr double kLongLoopSeconds = 5;

struct Entry {
  double at = 0;
  bool down = false;
  long window = 0;
  long level = 0;
  std::string hit;
  std::string swallowedBy;
};

class Trace {
 public:
  void Record(const Entry &entry) {
    std::lock_guard<std::mutex> lock(mutex_);
    history_.push_back(entry);
    if (history_.size() > kHistoryLength) history_.erase(history_.begin());
  }

  bool Merge(double at, bool down, const std::string &swallowedBy) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (history_.empty() || history_.back().at != at || history_.back().down != down) return false;
    if (!swallowedBy.empty()) history_.back().swallowedBy = swallowedBy;
    return true;
  }

  unsigned long BeginLoop(const std::string &name, double now) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (depth_++ > 0) return generation_;
    name_ = name;
    startedAt_ = now;
    logged_ = false;
    return ++generation_;
  }

  void EndLoop(double now) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (depth_ == 0 || --depth_ > 0) return;
    const double length = now - startedAt_;
    finished_++;
    if (length > longest_) {
      longest_ = length;
      longestName_ = name_;
    }
    name_.clear();
  }

  bool TakeLongLoop(unsigned long generation, double now, std::string *name) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (depth_ == 0 || generation != generation_ || logged_ || now - startedAt_ < kLongLoopSeconds) return false;
    logged_ = true;
    if (name) *name = name_;
    return true;
  }

  std::string LoopLine(double now) const {
    std::lock_guard<std::mutex> lock(mutex_);
    char text[256];
    int length = depth_ > 0 ? std::snprintf(text, sizeof text, "press loop open %s for %.1fs%s", name_.c_str(), now - startedAt_,
                                            logged_ ? " (logged)" : "")
                            : std::snprintf(text, sizeof text, "press loop none");
    if (length < 0) return "press loop unknown";
    std::string line(text);
    if (finished_ > 0) {
      std::snprintf(text, sizeof text, ", finished %lu, longest %s %.1fs", finished_, longestName_.c_str(), longest_);
      line += text;
    }
    return line;
  }

  std::vector<std::string> HistoryLines(double now) const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<std::string> lines;
    for (const Entry &entry : history_) {
      char text[320];
      std::snprintf(text, sizeof text, "click %.1fs ago %s window#%ld level %ld hit %s %s", now - entry.at, entry.down ? "down" : "up",
                    entry.window, entry.level, entry.hit.c_str(),
                    entry.swallowedBy.empty() ? "passed" : ("swallowed by " + entry.swallowedBy).c_str());
      lines.emplace_back(text);
    }
    return lines;
  }

 private:
  mutable std::mutex mutex_;
  std::vector<Entry> history_;
  int depth_ = 0;
  unsigned long generation_ = 0;
  std::string name_;
  double startedAt_ = 0;
  bool logged_ = false;
  unsigned long finished_ = 0;
  double longest_ = 0;
  std::string longestName_;
};

}
