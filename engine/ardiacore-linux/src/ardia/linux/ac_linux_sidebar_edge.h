#ifndef ARDIA_LINUX_AC_LINUX_SIDEBAR_EDGE_H_
#define ARDIA_LINUX_AC_LINUX_SIDEBAR_EDGE_H_

#include <algorithm>
#include <optional>

namespace ardia::linux_window {

enum class SidebarSide { kLeft, kRight };

struct SidebarEdgeReport {
  bool over = false;
  double x = -1;
  double y = -1;
};

class SidebarEdgeWatch {
 public:
  static constexpr double kStrip = 8;
  static constexpr double kReach = 24;
  static constexpr double kLeaveReach = 48;
  static constexpr int kSettleMs = 90;

  bool watching() const { return watching_; }
  bool settling() const { return settling_; }

  std::optional<SidebarEdgeReport> Watch(double hold, SidebarSide side, bool active) {
    if (side != side_) {
      side_ = side;
      beside_ = !known_ && Beside(x_, y_);
      settling_ = false;
    }
    watching_ = true;
    hold_ = std::max(0.0, hold);
    fresh_ = true;
    return Report(beside_ ? active && !settling_ : known_ && Within(x_, y_));
  }

  void Stop() {
    watching_ = false;
    over_ = false;
    settling_ = false;
  }

  std::optional<SidebarEdgeReport> Moved(double x, double y, double width, double height) {
    Place(x, y, width, height);
    known_ = true;
    beside_ = false;
    settling_ = false;
    return Report(Within(x, y));
  }

  std::optional<SidebarEdgeReport> Exited(double x, double y, double width, double height, bool active) {
    Place(x, y, width, height);
    known_ = false;
    beside_ = Beside(x, y);
    settling_ = false;
    if (!beside_ || !active) return Report(false);
    if (over_) return std::nullopt;
    settling_ = watching_;
    return std::nullopt;
  }

  std::optional<SidebarEdgeReport> Settled(bool active) {
    if (!settling_) return std::nullopt;
    settling_ = false;
    return Report(beside_ && active);
  }

  std::optional<SidebarEdgeReport> ActivationChanged(bool active) {
    if (!beside_ || active) return std::nullopt;
    beside_ = false;
    settling_ = false;
    return Report(false);
  }

 private:
  double Inset(double x) const { return side_ == SidebarSide::kRight ? width_ - 1 - x : x; }

  bool Within(double x, double y) const {
    const double inset = Inset(x);
    return y >= 0 && y < height_ && inset >= -kReach && inset < std::max(hold_, kStrip);
  }

  bool Beside(double x, double y) const {
    const double inset = Inset(x);
    return y >= 0 && y < height_ && inset < kLeaveReach && inset <= std::min(y, height_ - y);
  }

  void Place(double x, double y, double width, double height) {
    x_ = x;
    y_ = y;
    width_ = width;
    height_ = height;
  }

  std::optional<SidebarEdgeReport> Report(bool over) {
    if (!watching_ || (!fresh_ && over == over_)) return std::nullopt;
    fresh_ = false;
    over_ = over;
    if (!known_ && !beside_) return SidebarEdgeReport{over, -1, -1};
    return SidebarEdgeReport{over, x_, y_};
  }

  SidebarSide side_ = SidebarSide::kLeft;
  bool watching_ = false;
  bool fresh_ = false;
  bool over_ = false;
  bool known_ = false;
  bool beside_ = false;
  bool settling_ = false;
  double hold_ = 0;
  double x_ = -1;
  double y_ = -1;
  double width_ = 0;
  double height_ = 0;
};

}

#endif
