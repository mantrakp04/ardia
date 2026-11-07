#ifndef ARDIA_LINUX_AC_LINUX_LEFT_EDGE_H_
#define ARDIA_LINUX_AC_LINUX_LEFT_EDGE_H_

#include <algorithm>
#include <optional>

namespace ardia::linux_window {

struct LeftEdgeReport {
  bool over = false;
  double x = -1;
  double y = -1;
};

class LeftEdgeWatch {
 public:
  static constexpr double kStrip = 8;
  static constexpr double kReach = 24;
  static constexpr double kLeaveReach = 48;
  static constexpr int kSettleMs = 90;

  bool watching() const { return watching_; }
  bool settling() const { return settling_; }

  std::optional<LeftEdgeReport> Watch(double hold, bool active) {
    watching_ = true;
    hold_ = std::max(0.0, hold);
    fresh_ = true;
    return Report(beside_ ? active && !settling_ : known_ && Within(x_, y_, height_));
  }

  void Stop() {
    watching_ = false;
    over_ = false;
    settling_ = false;
  }

  std::optional<LeftEdgeReport> Moved(double x, double y, double height) {
    Place(x, y, height);
    known_ = true;
    beside_ = false;
    settling_ = false;
    return Report(Within(x, y, height));
  }

  std::optional<LeftEdgeReport> Exited(double x, double y, double height, bool active) {
    Place(x, y, height);
    known_ = false;
    beside_ = y >= 0 && y < height && x < kLeaveReach && x <= std::min(y, height - y);
    settling_ = false;
    if (!beside_ || !active) return Report(false);
    if (over_) return std::nullopt;
    settling_ = watching_;
    return std::nullopt;
  }

  std::optional<LeftEdgeReport> Settled(bool active) {
    if (!settling_) return std::nullopt;
    settling_ = false;
    return Report(beside_ && active);
  }

  std::optional<LeftEdgeReport> ActivationChanged(bool active) {
    if (!beside_ || active) return std::nullopt;
    beside_ = false;
    settling_ = false;
    return Report(false);
  }

 private:
  bool Within(double x, double y, double height) const {
    return y >= 0 && y < height && x >= -kReach && x < std::max(hold_, kStrip);
  }

  void Place(double x, double y, double height) {
    x_ = x;
    y_ = y;
    height_ = height;
  }

  std::optional<LeftEdgeReport> Report(bool over) {
    if (!watching_ || (!fresh_ && over == over_)) return std::nullopt;
    fresh_ = false;
    over_ = over;
    if (!known_ && !beside_) return LeftEdgeReport{over, -1, -1};
    return LeftEdgeReport{over, x_, y_};
  }

  bool watching_ = false;
  bool fresh_ = false;
  bool over_ = false;
  bool known_ = false;
  bool beside_ = false;
  bool settling_ = false;
  double hold_ = 0;
  double x_ = -1;
  double y_ = -1;
  double height_ = 0;
};

}

#endif
