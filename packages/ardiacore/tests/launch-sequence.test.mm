#import "../ios/ArdiaLaunchSequence.h"

#include <cstdio>
#include <string>
#include <vector>

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

struct Host {
  ArdiaLaunchSequence *launch = [ArdiaLaunchSequence new];
  std::vector<std::string> log;

  void run() {
    ArdiaLaunchSequence *l = launch;
    std::vector<std::string> *out = &log;
    [l after:ArdiaLaunchEngineStarted | ArdiaLaunchAppKitDidFinish
          do:^{
            out->push_back(std::string("earlyWindow") + (l.launchedHidden ? " hidden" : "") + (l.launchedForDocuments ? " documents" : ""));
          }];
  }

  void engineStarted() {
    launch.engineRunning = YES;
    log.push_back("setup");
    [launch reach:ArdiaLaunchEngineStarted];
  }

  void launchApp(bool urls) {
    std::vector<std::string> *out = &log;
    if (urls) [launch after:ArdiaLaunchJSStarted do:^{ out->push_back("parkLinks"); }];
    if (![launch reached:ArdiaLaunchAppKitDidFinish]) {
      if (urls) [launch after:ArdiaLaunchAppKitDidFinish do:^{ out->push_back("deliverURLs"); }];
      return;
    }
    if (urls) log.push_back("deliverURLs");
  }

  void appKitFinished(bool hidden = false, bool documents = false) { [launch appKitFinishedHidden:hidden forDocuments:documents]; }

  void jsStarted() {
    [launch reach:ArdiaLaunchJSStarted];
    log.push_back("launchTab");
  }
};

static bool Is(const std::vector<std::string> &log, std::vector<std::string> expected) { return log == expected; }

int main() {
  @autoreleasepool {
    {
      Host h;
      h.run();
      h.engineStarted();
      CHECK(Is(h.log, {"setup"}));
      h.launchApp(false);
      h.appKitFinished();
      h.jsStarted();
      CHECK(Is(h.log, {"setup", "earlyWindow", "launchTab"}));
    }
    {
      Host h;
      h.run();
      h.appKitFinished();
      CHECK(h.log.empty());
      h.engineStarted();
      CHECK(Is(h.log, {"setup", "earlyWindow"}));
      h.launchApp(true);
      h.jsStarted();
      CHECK(Is(h.log, {"setup", "earlyWindow", "deliverURLs", "parkLinks", "launchTab"}));
    }
    {
      Host h;
      h.run();
      h.engineStarted();
      h.launchApp(true);
      CHECK(Is(h.log, {"setup"}));
      h.appKitFinished();
      CHECK(Is(h.log, {"setup", "earlyWindow", "deliverURLs"}));
      h.jsStarted();
      CHECK(Is(h.log, {"setup", "earlyWindow", "deliverURLs", "parkLinks", "launchTab"}));
    }
    {
      Host h;
      h.run();
      h.engineStarted();
      h.appKitFinished();
      h.jsStarted();
      h.launchApp(true);
      CHECK(Is(h.log, {"setup", "earlyWindow", "launchTab", "parkLinks", "deliverURLs"}));
    }
    {
      Host h;
      h.run();
      h.engineStarted();
      h.appKitFinished(true, false);
      h.jsStarted();
      CHECK(Is(h.log, {"setup", "earlyWindow hidden", "launchTab"}));
    }
    {
      Host h;
      h.run();
      h.appKitFinished(false, true);
      h.engineStarted();
      CHECK(Is(h.log, {"setup", "earlyWindow documents"}));
    }
    {
      ArdiaLaunchSequence *l = [ArdiaLaunchSequence new];
      __block int outer = 0, inner = 0;
      [l after:ArdiaLaunchEngineStarted
            do:^{
              outer++;
              [l after:ArdiaLaunchEngineStarted do:^{ inner++; }];
              [l reach:ArdiaLaunchEngineStarted];
            }];
      [l reach:ArdiaLaunchEngineStarted];
      [l reach:ArdiaLaunchEngineStarted];
      CHECK(outer == 1 && inner == 1);
    }
    {
      ArdiaLaunchSequence *l = [ArdiaLaunchSequence new];
      __block int ran = 0;
      l.engineRunning = YES;
      [l after:ArdiaLaunchJSStarted do:^{ ran++; }];
      [l engineShutDown];
      [l reach:ArdiaLaunchJSStarted];
      [l after:0 do:^{ ran++; }];
      CHECK(ran == 0 && !l.engineRunning && ![l reached:ArdiaLaunchJSStarted]);
    }
  }
  if (failures) return 1;
  std::printf("launch-sequence: ok\n");
  return 0;
}
