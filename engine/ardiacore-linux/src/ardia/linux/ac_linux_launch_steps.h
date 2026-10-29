#ifndef ARDIA_LINUX_AC_LINUX_LAUNCH_STEPS_H_
#define ARDIA_LINUX_AC_LINUX_LAUNCH_STEPS_H_

#include <set>
#include <string>
#include <string_view>
#include <vector>

namespace ardia::linux_launch {

inline constexpr std::string_view kSteps[] = {
    "version", "versionUpdated", "onboarding", "releaseNotes", "defaultBrowserOffer",
};

inline bool ValidStep(std::string_view step) {
  for (const std::string_view known : kSteps) {
    if (step == known) {
      return true;
    }
  }
  return false;
}

class LaunchSteps {
 public:
  bool Complete(std::string_view step) {
    return ValidStep(step) && done_.emplace(step).second;
  }
  bool Done(std::string_view step) const {
    return done_.contains(std::string(step));
  }
  std::vector<std::string> List() const {
    return {done_.begin(), done_.end()};
  }

 private:
  std::set<std::string> done_;
};

}

#endif
