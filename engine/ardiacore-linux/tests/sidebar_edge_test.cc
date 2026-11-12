#include <cassert>
#include <optional>
#include <string_view>

#include "ardia/linux/ac_linux_sidebar_edge.h"

using ardia::linux_window::SidebarEdgeReport;
using ardia::linux_window::SidebarEdgeWatch;
using ardia::linux_window::SidebarSide;

namespace {

constexpr double kWidth = 1920;
constexpr double kHeight = 1000;
constexpr double kHold = 5 + 227.5 + 24;

double At(SidebarSide side, double x) {
  return side == SidebarSide::kRight ? kWidth - 1 - x : x;
}

bool Over(const std::optional<SidebarEdgeReport>& report) {
  assert(report);
  return report->over;
}

void Strip(SidebarSide side) {
  SidebarEdgeWatch edge;
  assert(!Over(edge.Watch(0, side, true)));
  assert(Over(edge.Moved(At(side, 3), 300, kWidth, kHeight)));
  assert(!edge.Moved(At(side, 7.5), 300, kWidth, kHeight));
  assert(!Over(edge.Moved(At(side, 8), 300, kWidth, kHeight)));
  assert(Over(edge.Moved(At(side, -4), 300, kWidth, kHeight)));
  assert(!Over(edge.Moved(At(side, -SidebarEdgeWatch::kReach - 1), 300, kWidth, kHeight)));
  assert(Over(edge.Moved(At(side, 0), 300, kWidth, kHeight)));
  assert(!Over(edge.Moved(At(side, 0), -1, kWidth, kHeight)));
  assert(!edge.Moved(At(side, 0), kHeight, kWidth, kHeight));
  const auto report = edge.Moved(At(side, 2), 400, kWidth, kHeight);
  assert(report && report->over && report->x == At(side, 2) && report->y == 400);
}

void HoldCoversThePageBesideThePeek(SidebarSide side) {
  SidebarEdgeWatch edge;
  edge.Watch(0, side, true);
  edge.Moved(At(side, 2), 300, kWidth, kHeight);
  assert(Over(edge.Watch(kHold, side, true)));
  for (double x = 2; x < kHold; x += 7) assert(!edge.Moved(At(side, x), 300, kWidth, kHeight));
  assert(!Over(edge.Moved(At(side, kHold), 300, kWidth, kHeight)));
  assert(Over(edge.Moved(At(side, kHold - 1), 300, kWidth, kHeight)));
}

void FreshWatchReportsTheLastPosition(SidebarSide side) {
  SidebarEdgeWatch edge;
  edge.Moved(At(side, 120), 300, kWidth, kHeight);
  assert(!Over(edge.Watch(0, side, true)));
  assert(Over(edge.Watch(kHold, side, true)));
  edge.Stop();
  assert(!edge.Moved(At(side, 3), 300, kWidth, kHeight));
  assert(Over(edge.Watch(0, side, true)));
}

void LeavingPastTheSidebarEdgeSettlesIntoAPeek(SidebarSide side) {
  SidebarEdgeWatch edge;
  edge.Watch(0, side, true);
  edge.Moved(At(side, 40), 300, kWidth, kHeight);
  assert(!edge.Exited(At(side, 12), 300, kWidth, kHeight, true));
  assert(edge.settling());
  const auto report = edge.Settled(true);
  assert(report && report->over && report->x == At(side, 12));
  assert(!edge.settling());
  assert(!Over(edge.Moved(At(side, 600), 300, kWidth, kHeight)));
}

void AFastLeaveKeepsItsLastSampleInsideTheWindow(SidebarSide side) {
  SidebarEdgeWatch edge;
  edge.Watch(0, side, true);
  edge.Moved(At(side, 300), 300, kWidth, kHeight);
  assert(!edge.Exited(At(side, 40), 300, kWidth, kHeight, true));
  assert(edge.settling());
  assert(Over(edge.Settled(true)));
}

void FocusMovingToTheNeighbourPastTheEdgeCancelsTheSettle(SidebarSide side) {
  SidebarEdgeWatch edge;
  edge.Watch(0, side, true);
  edge.Moved(At(side, 40), 300, kWidth, kHeight);
  assert(!edge.Exited(At(side, 5), 300, kWidth, kHeight, true));
  assert(!edge.ActivationChanged(false));
  assert(!edge.settling());
  assert(!edge.Settled(false));
  assert(!edge.Settled(true));
  assert(!Over(edge.Watch(0, side, true)));
}

void ASettleThatEndsInactiveStaysHidden(SidebarSide side) {
  SidebarEdgeWatch edge;
  edge.Watch(0, side, true);
  edge.Exited(At(side, 5), 300, kWidth, kHeight, true);
  assert(!edge.Settled(false));
}

void LeavingAnyOtherWayIsNotOver(SidebarSide side) {
  for (const auto [x, y] : {std::pair{600.0, -1.0}, {600.0, kHeight}, {1500.0, 300.0}, {SidebarEdgeWatch::kLeaveReach, 300.0}, {4.0, -1.0}, {20.0, 6.0}, {20.0, kHeight - 6}}) {
    SidebarEdgeWatch edge;
    edge.Watch(kHold, side, true);
    assert(Over(edge.Moved(At(side, 100), 300, kWidth, kHeight)));
    assert(!Over(edge.Exited(At(side, x), y, kWidth, kHeight, true)));
    assert(!edge.settling());
    const auto fresh = edge.Watch(kHold, side, true);
    assert(fresh && !fresh->over && fresh->x == -1 && fresh->y == -1);
  }
}

void APeekStaysOutWhileThePointerIsJustPastTheEdge(SidebarSide side) {
  SidebarEdgeWatch edge;
  edge.Watch(kHold, side, true);
  assert(Over(edge.Moved(At(side, 30), 300, kWidth, kHeight)));
  assert(!edge.Exited(At(side, 3), 300, kWidth, kHeight, true));
  assert(!edge.settling());
  assert(Over(edge.Watch(kHold, side, true)));
  assert(!Over(edge.ActivationChanged(false)));
  assert(!edge.ActivationChanged(true));
}

void AnInactiveWindowGetsNoReachBeyondItsEdge(SidebarSide side) {
  SidebarEdgeWatch edge;
  edge.Watch(0, side, false);
  edge.Moved(At(side, 40), 300, kWidth, kHeight);
  assert(!edge.Exited(At(side, 5), 300, kWidth, kHeight, false));
  assert(!edge.settling());
  assert(Over(edge.Moved(At(side, 3), 300, kWidth, kHeight)));
}

void NothingIsReportedWhileNotWatching(SidebarSide side) {
  SidebarEdgeWatch edge;
  assert(!edge.Moved(At(side, 3), 300, kWidth, kHeight));
  assert(!edge.Exited(At(side, 3), 300, kWidth, kHeight, true));
  assert(!edge.settling());
  assert(!edge.Settled(true));
  assert(Over(edge.Watch(0, side, true)));
}

void WatchingDuringASettleWaitsForIt(SidebarSide side) {
  SidebarEdgeWatch edge;
  edge.Watch(0, side, true);
  edge.Exited(At(side, 5), 300, kWidth, kHeight, true);
  assert(!Over(edge.Watch(kHold, side, true)));
  assert(edge.settling());
  assert(Over(edge.Settled(true)));
}

void TheRightStripCoversTheSamePixelsAsTheLeft(SidebarSide) {
  SidebarEdgeWatch edge;
  assert(!Over(edge.Watch(0, SidebarSide::kRight, true)));
  assert(Over(edge.Moved(kWidth - 8, 300, kWidth, kHeight)));
  assert(!Over(edge.Moved(kWidth - 9, 300, kWidth, kHeight)));
  assert(Over(edge.Moved(kWidth + SidebarEdgeWatch::kReach - 1, 300, kWidth, kHeight)));
  assert(!Over(edge.Moved(kWidth + SidebarEdgeWatch::kReach, 300, kWidth, kHeight)));
  assert(Over(edge.Moved(kWidth - 1, 300, kWidth, kHeight)));
  assert(!Over(edge.Moved(7, 300, kWidth, kHeight)));
}

void SwitchingSidesReevaluatesThePointerAndDropsASettle(SidebarSide) {
  SidebarEdgeWatch edge;
  assert(!Over(edge.Watch(0, SidebarSide::kLeft, true)));
  assert(!edge.Moved(kWidth - 3, 300, kWidth, kHeight));
  const auto right = edge.Watch(0, SidebarSide::kRight, true);
  assert(right && right->over && right->x == kWidth - 3 && right->y == 300);
  assert(!Over(edge.Watch(0, SidebarSide::kLeft, true)));
  assert(Over(edge.Moved(2, 300, kWidth, kHeight)));
  assert(!Over(edge.Watch(0, SidebarSide::kRight, true)));
  assert(!edge.Exited(kWidth - 5, 300, kWidth, kHeight, true));
  assert(edge.settling());
  assert(!Over(edge.Watch(0, SidebarSide::kLeft, true)));
  assert(!edge.settling());
  assert(!edge.Settled(true));
  assert(!edge.Exited(5, 300, kWidth, kHeight, true));
  assert(edge.settling());
  assert(Over(edge.Settled(true)));
}

}

int main(int argc, char** argv) {
  assert(argc == 3);
  const std::string_view name = argv[1];
  const std::string_view side_name = argv[2];
  assert(side_name == "left" || side_name == "right");
  const SidebarSide side = side_name == "right" ? SidebarSide::kRight : SidebarSide::kLeft;
  if (name == "strip") Strip(side);
  else if (name == "hold") HoldCoversThePageBesideThePeek(side);
  else if (name == "fresh") FreshWatchReportsTheLastPosition(side);
  else if (name == "settle") LeavingPastTheSidebarEdgeSettlesIntoAPeek(side);
  else if (name == "fast-leave") AFastLeaveKeepsItsLastSampleInsideTheWindow(side);
  else if (name == "focus-away") FocusMovingToTheNeighbourPastTheEdgeCancelsTheSettle(side);
  else if (name == "settle-inactive") ASettleThatEndsInactiveStaysHidden(side);
  else if (name == "other-exits") LeavingAnyOtherWayIsNotOver(side);
  else if (name == "peek-beside") APeekStaysOutWhileThePointerIsJustPastTheEdge(side);
  else if (name == "inactive") AnInactiveWindowGetsNoReachBeyondItsEdge(side);
  else if (name == "unwatched") NothingIsReportedWhileNotWatching(side);
  else if (name == "watch-settling") WatchingDuringASettleWaitsForIt(side);
  else if (name == "right-pixels") TheRightStripCoversTheSamePixelsAsTheLeft(side);
  else if (name == "side-switch") SwitchingSidesReevaluatesThePointerAndDropsASettle(side);
  else return 2;
  return 0;
}
