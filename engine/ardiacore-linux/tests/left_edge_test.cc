#include <cassert>
#include <optional>
#include <string_view>

#include "ardia/linux/ac_linux_left_edge.h"

using ardia::linux_window::LeftEdgeReport;
using ardia::linux_window::LeftEdgeWatch;

namespace {

constexpr double kHeight = 1000;
constexpr double kHold = 5 + 227.5 + 24;

bool Over(const std::optional<LeftEdgeReport>& report) {
  assert(report);
  return report->over;
}

void Strip() {
  LeftEdgeWatch edge;
  assert(!Over(edge.Watch(0, true)));
  assert(Over(edge.Moved(3, 300, kHeight)));
  assert(!edge.Moved(7.5, 300, kHeight));
  assert(!Over(edge.Moved(8, 300, kHeight)));
  assert(Over(edge.Moved(-4, 300, kHeight)));
  assert(!Over(edge.Moved(-LeftEdgeWatch::kReach - 1, 300, kHeight)));
  assert(Over(edge.Moved(0, 300, kHeight)));
  assert(!Over(edge.Moved(0, -1, kHeight)));
  assert(!edge.Moved(0, kHeight, kHeight));
  const auto report = edge.Moved(2, 400, kHeight);
  assert(report && report->over && report->x == 2 && report->y == 400);
}

void HoldCoversThePageBesideThePeek() {
  LeftEdgeWatch edge;
  edge.Watch(0, true);
  edge.Moved(2, 300, kHeight);
  assert(Over(edge.Watch(kHold, true)));
  for (double x = 2; x < kHold; x += 7) assert(!edge.Moved(x, 300, kHeight));
  assert(!Over(edge.Moved(kHold, 300, kHeight)));
  assert(Over(edge.Moved(kHold - 1, 300, kHeight)));
}

void FreshWatchReportsTheLastPosition() {
  LeftEdgeWatch edge;
  edge.Moved(120, 300, kHeight);
  assert(!Over(edge.Watch(0, true)));
  assert(Over(edge.Watch(kHold, true)));
  edge.Stop();
  assert(!edge.Moved(3, 300, kHeight));
  assert(Over(edge.Watch(0, true)));
}

void LeavingPastTheLeftEdgeSettlesIntoAPeek() {
  LeftEdgeWatch edge;
  edge.Watch(0, true);
  edge.Moved(40, 300, kHeight);
  assert(!edge.Exited(12, 300, kHeight, true));
  assert(edge.settling());
  const auto report = edge.Settled(true);
  assert(report && report->over && report->x == 12);
  assert(!edge.settling());
  assert(!Over(edge.Moved(600, 300, kHeight)));
}

void AFastLeaveKeepsItsLastSampleInsideTheWindow() {
  LeftEdgeWatch edge;
  edge.Watch(0, true);
  edge.Moved(300, 300, kHeight);
  assert(!edge.Exited(40, 300, kHeight, true));
  assert(edge.settling());
  assert(Over(edge.Settled(true)));
}

void FocusMovingToAWindowOnTheLeftCancelsTheSettle() {
  LeftEdgeWatch edge;
  edge.Watch(0, true);
  edge.Moved(40, 300, kHeight);
  assert(!edge.Exited(5, 300, kHeight, true));
  assert(!edge.ActivationChanged(false));
  assert(!edge.settling());
  assert(!edge.Settled(false));
  assert(!edge.Settled(true));
  assert(!Over(edge.Watch(0, true)));
}

void ASettleThatEndsInactiveStaysHidden() {
  LeftEdgeWatch edge;
  edge.Watch(0, true);
  edge.Exited(5, 300, kHeight, true);
  assert(!edge.Settled(false));
}

void LeavingAnyOtherWayIsNotOver() {
  for (const auto [x, y] : {std::pair{600.0, -1.0}, {600.0, kHeight}, {1500.0, 300.0}, {LeftEdgeWatch::kLeaveReach, 300.0}, {4.0, -1.0}, {20.0, 6.0}, {20.0, kHeight - 6}}) {
    LeftEdgeWatch edge;
    edge.Watch(kHold, true);
    assert(Over(edge.Moved(100, 300, kHeight)));
    assert(!Over(edge.Exited(x, y, kHeight, true)));
    assert(!edge.settling());
    const auto fresh = edge.Watch(kHold, true);
    assert(fresh && !fresh->over && fresh->x == -1 && fresh->y == -1);
  }
}

void APeekStaysOutWhileThePointerIsJustPastTheLeftEdge() {
  LeftEdgeWatch edge;
  edge.Watch(kHold, true);
  assert(Over(edge.Moved(30, 300, kHeight)));
  assert(!edge.Exited(3, 300, kHeight, true));
  assert(!edge.settling());
  assert(Over(edge.Watch(kHold, true)));
  assert(!Over(edge.ActivationChanged(false)));
  assert(!edge.ActivationChanged(true));
}

void AnInactiveWindowGetsNoReachBeyondItsEdge() {
  LeftEdgeWatch edge;
  edge.Watch(0, false);
  edge.Moved(40, 300, kHeight);
  assert(!edge.Exited(5, 300, kHeight, false));
  assert(!edge.settling());
  assert(Over(edge.Moved(3, 300, kHeight)));
}

void NothingIsReportedWhileNotWatching() {
  LeftEdgeWatch edge;
  assert(!edge.Moved(3, 300, kHeight));
  assert(!edge.Exited(3, 300, kHeight, true));
  assert(!edge.settling());
  assert(!edge.Settled(true));
  assert(Over(edge.Watch(0, true)));
}

void WatchingDuringASettleWaitsForIt() {
  LeftEdgeWatch edge;
  edge.Watch(0, true);
  edge.Exited(5, 300, kHeight, true);
  assert(!Over(edge.Watch(kHold, true)));
  assert(edge.settling());
  assert(Over(edge.Settled(true)));
}

}

int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string_view name = argv[1];
  if (name == "strip") Strip();
  else if (name == "hold") HoldCoversThePageBesideThePeek();
  else if (name == "fresh") FreshWatchReportsTheLastPosition();
  else if (name == "settle") LeavingPastTheLeftEdgeSettlesIntoAPeek();
  else if (name == "fast-leave") AFastLeaveKeepsItsLastSampleInsideTheWindow();
  else if (name == "focus-left") FocusMovingToAWindowOnTheLeftCancelsTheSettle();
  else if (name == "settle-inactive") ASettleThatEndsInactiveStaysHidden();
  else if (name == "other-exits") LeavingAnyOtherWayIsNotOver();
  else if (name == "peek-beside") APeekStaysOutWhileThePointerIsJustPastTheLeftEdge();
  else if (name == "inactive") AnInactiveWindowGetsNoReachBeyondItsEdge();
  else if (name == "unwatched") NothingIsReportedWhileNotWatching();
  else if (name == "watch-settling") WatchingDuringASettleWaitsForIt();
  else return 2;
  return 0;
}
