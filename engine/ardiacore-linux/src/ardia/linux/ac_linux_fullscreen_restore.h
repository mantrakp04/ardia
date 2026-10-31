#ifndef ARDIA_LINUX_AC_LINUX_FULLSCREEN_RESTORE_H_
#define ARDIA_LINUX_AC_LINUX_FULLSCREEN_RESTORE_H_

#include <optional>
#include <set>
#include <string>
#include <vector>

namespace ardia::linux_window {

class FullScreenRestore {
 public:
  bool Begin(const std::vector<std::string>& ids, const std::string& focus);
  bool Wants(const std::string& id) const;
  bool Enter(const std::string& id, bool already_fullscreen);
  void Entered(const std::string& id);
  bool Forget(const std::string& id);
  std::vector<std::string> Expire();
  std::optional<std::string> Finish();
  bool active() const { return begun_ && !finished_; }

 private:
  bool Settled() const { return waiting_.empty() && entering_.empty(); }

  bool begun_ = false;
  bool finished_ = false;
  bool toggled_ = false;
  std::string focus_;
  std::vector<std::string> waiting_;
  std::set<std::string> entering_;
};

}

#endif
