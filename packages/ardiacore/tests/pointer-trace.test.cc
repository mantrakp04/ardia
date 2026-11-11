#include "../ios/ArdiaPointerTrace.h"

#include <cstdio>
#include <cstdlib>
#include <string>

using namespace ardia_pointer;

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

static bool Contains(const std::string &text, const std::string &part) { return text.find(part) != std::string::npos; }

int main() {
  {
    Trace trace;
    CHECK(trace.HistoryLines(10).empty());
    CHECK(trace.LoopLine(10) == "press loop none");
  }
  {
    Trace trace;
    trace.Record({100.0, true, 12, 0, "NSView", ""});
    trace.Record({100.2, false, 12, 0, "NSView", "windowDragRegion"});
    const auto lines = trace.HistoryLines(103);
    CHECK(lines.size() == 2);
    CHECK(lines[0] == "click 3.0s ago down window#12 level 0 hit NSView passed");
    CHECK(lines[1] == "click 2.8s ago up window#12 level 0 hit NSView swallowed by windowDragRegion");
  }
  {
    Trace trace;
    for (int i = 0; i < 40; i++) trace.Record({double(i), i % 2 == 0, 7, 3, "Hit", ""});
    const auto lines = trace.HistoryLines(40);
    CHECK(lines.size() == kHistoryLength);
    CHECK(Contains(lines.front(), "click 16.0s ago"));
    CHECK(Contains(lines.back(), "click 1.0s ago"));
  }
  {
    Trace trace;
    trace.Record({5.0, true, 1, 0, "NSView", ""});
    CHECK(trace.Merge(5.0, true, "pip"));
    CHECK(Contains(trace.HistoryLines(6)[0], "swallowed by pip"));
    CHECK(trace.Merge(5.0, true, ""));
    CHECK(Contains(trace.HistoryLines(6)[0], "swallowed by pip"));
    CHECK(!trace.Merge(5.0, false, "pip"));
    CHECK(!trace.Merge(5.5, true, "pip"));
    CHECK(trace.HistoryLines(6).size() == 1);
  }
  {
    Trace trace;
    CHECK(!trace.Merge(1.0, true, "pip"));
    CHECK(trace.HistoryLines(2).empty());
  }
  {
    Trace trace;
    const unsigned long first = trace.BeginLoop("windowDragRegion", 100);
    CHECK(trace.LoopLine(102.5) == "press loop open windowDragRegion for 2.5s");
    std::string name;
    CHECK(!trace.TakeLongLoop(first, 104.9, &name));
    CHECK(trace.TakeLongLoop(first, 105.1, &name));
    CHECK(name == "windowDragRegion");
    CHECK(!trace.TakeLongLoop(first, 106, &name));
    CHECK(trace.LoopLine(106) == "press loop open windowDragRegion for 6.0s (logged)");
    trace.EndLoop(107);
    CHECK(trace.LoopLine(108) == "press loop none, finished 1, longest windowDragRegion 7.0s");
    CHECK(!trace.TakeLongLoop(first, 200, &name));
  }
  {
    Trace trace;
    const unsigned long outer = trace.BeginLoop("windowMove", 10);
    const unsigned long inner = trace.BeginLoop("windowDragRegion", 11);
    CHECK(outer == inner);
    trace.EndLoop(12);
    CHECK(Contains(trace.LoopLine(13), "press loop open windowMove for 3.0s"));
    trace.EndLoop(14);
    CHECK(Contains(trace.LoopLine(15), "press loop none, finished 1, longest windowMove 4.0s"));
    trace.EndLoop(16);
    CHECK(Contains(trace.LoopLine(17), "finished 1"));
  }
  {
    Trace trace;
    const unsigned long first = trace.BeginLoop("windowMove", 0);
    trace.EndLoop(1);
    const unsigned long second = trace.BeginLoop("windowMove", 50);
    CHECK(second != first);
    CHECK(!trace.TakeLongLoop(first, 51, nullptr));
    CHECK(!trace.TakeLongLoop(first, 60, nullptr));
    CHECK(trace.TakeLongLoop(second, 60, nullptr));
  }
  {
    Trace trace;
    trace.BeginLoop("windowMove", 0);
    trace.EndLoop(0.3);
    trace.BeginLoop("windowDragRegion", 10);
    trace.EndLoop(18);
    trace.BeginLoop("windowMove", 20);
    trace.EndLoop(20.3);
    CHECK(trace.LoopLine(30) == "press loop none, finished 3, longest windowDragRegion 8.0s");
  }

  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return EXIT_FAILURE;
  }
  std::printf("pointer trace ok\n");
  return EXIT_SUCCESS;
}
