#include <cassert>
#include <cstdio>
#include <cerrno>
#include <fcntl.h>
#include <poll.h>
#include <string>
#include <unistd.h>

#include "ardia/linux/ac_linux_memory_pressure.h"

using namespace ardiacore;

namespace {

std::string Psi(double some10, unsigned long long some, double full10, unsigned long long full) {
  char text[256];
  std::snprintf(text, sizeof(text),
                "some avg10=%.2f avg60=0.00 avg300=0.00 total=%llu\nfull avg10=%.2f avg60=0.00 avg300=0.00 total=%llu\n",
                some10, some, full10, full);
  return text;
}

void Write(const std::string& path, const std::string& text) {
  FILE* file = std::fopen(path.c_str(), "w");
  assert(file);
  std::fputs(text.c_str(), file);
  std::fclose(file);
}

void Parse() {
  auto totals = ParseLinuxPsi(Psi(1.5, 9452739, 0.25, 9342175));
  assert(totals && totals->some == 9452739 && totals->full == 9342175u);
  assert(totals->some_avg10 == 1.5 && totals->full_avg10 == 0.25);
  auto some_only = ParseLinuxPsi("some avg10=0.00 avg60=0.00 avg300=0.00 total=12\n");
  assert(some_only && some_only->some == 12 && !some_only->full && !some_only->full_avg10);
  assert(!ParseLinuxPsi(""));
  assert(!ParseLinuxPsi("full avg10=0.00 avg60=0.00 avg300=0.00 total=12\n"));
  assert(!ParseLinuxPsi("some avg10=x avg60=0.00 avg300=0.00 total=12\n"));
  assert(!ParseLinuxPsi("some avg10=0.00 avg60=0.00 avg300=0.00 total=-1\n"));
  assert(!ParseLinuxPsi("some avg10=0.00 avg60=0.00 avg300=0.00\n"));
  assert(!ParseLinuxPsi("some avg10=200.00 avg60=0.00 avg300=0.00 total=1\n"));
}

void Cgroup() {
  assert(LinuxOwnCgroup("0::/user.slice/app-ardia.scope\n") == "/user.slice/app-ardia.scope");
  assert(LinuxOwnCgroup("12:memory:/legacy\n0::/unified\n") == "/unified");
  assert(LinuxOwnCgroup("0::/\n") == "/");
  assert(!LinuxOwnCgroup("12:memory:/legacy\n"));
  assert(!LinuxOwnCgroup("0::relative\n"));
  assert(!LinuxOwnCgroup("0::/a/../b\n"));
  auto files = LinuxMemoryPressureFiles("/sys/fs/cgroup", "/proc", "0::/user.slice/app.scope\n");
  assert(files.size() == 2 && files[0] == "/sys/fs/cgroup/user.slice/app.scope/memory.pressure" &&
         files[1] == "/proc/pressure/memory");
  files = LinuxMemoryPressureFiles("/sys/fs/cgroup", "/proc", "0::/\n");
  assert(files.size() == 1 && files[0] == "/proc/pressure/memory");
  files = LinuxMemoryPressureFiles("/sys/fs/cgroup", "/proc", "");
  assert(files.size() == 1 && files[0] == "/proc/pressure/memory");
}

void Levels() {
  assert(LinuxMemoryLevelName(LinuxMemoryLevel::kNormal) == "normal");
  assert(LinuxMemoryLevelName(LinuxMemoryLevel::kWarning) == "warning");
  assert(LinuxMemoryLevelName(LinuxMemoryLevel::kCritical) == "critical");
  LinuxMemoryPressureTracker tracker;
  assert(tracker.Observe(*ParseLinuxPsi(Psi(0, 1000, 0, 0)), 0, false) == LinuxMemoryLevel::kNormal);
  assert(tracker.NextWaitMs(true) == 30000 && tracker.NextWaitMs(false) == 5000);
  assert(tracker.Observe(*ParseLinuxPsi(Psi(0, 1000 + 150000, 0, 0)), 1000000, false) == LinuxMemoryLevel::kWarning);
  assert(tracker.NextWaitMs(true) == 2000 && tracker.NextWaitMs(false) == 2000);
  assert(tracker.Observe(*ParseLinuxPsi(Psi(0, 1150000 + 160000, 0, 120000)), 2000000, false) ==
         LinuxMemoryLevel::kCritical);
  assert(tracker.Observe(*ParseLinuxPsi(Psi(0, 1310000 + 250000, 0, 120000 + 60000)), 3000000, false) ==
         LinuxMemoryLevel::kCritical);
  assert(tracker.Observe(*ParseLinuxPsi(Psi(0, 1560000 + 150000, 0, 180000 + 10000)), 4000000, false) ==
         LinuxMemoryLevel::kWarning);
  assert(tracker.Observe(*ParseLinuxPsi(Psi(0, 1710000 + 70000, 0, 190000)), 5000000, false) ==
         LinuxMemoryLevel::kWarning);
  assert(tracker.Observe(*ParseLinuxPsi(Psi(0, 1780000 + 10000, 0, 190000)), 6000000, false) ==
         LinuxMemoryLevel::kNormal);
  assert(tracker.Observe(*ParseLinuxPsi(Psi(0, 1790000 + 400000, 0, 190000)), 6100000, false) ==
         LinuxMemoryLevel::kNormal);
  assert(tracker.Observe(*ParseLinuxPsi(Psi(0, 2190000, 0, 190000)), 36100000, true) == LinuxMemoryLevel::kWarning);
  assert(tracker.NextWaitMs(true) == 1000);
  assert(tracker.Observe(*ParseLinuxPsi(Psi(0, 2190000 + 5000, 0, 190000)), 37100000, false) == LinuxMemoryLevel::kNormal);
  LinuxMemoryPressureTracker first;
  assert(first.Observe(*ParseLinuxPsi(Psi(55.0, 1, 2.0, 1)), 0, false) == LinuxMemoryLevel::kCritical);
  LinuxMemoryPressureTracker averages;
  assert(averages.Observe(*ParseLinuxPsi(Psi(12.0, 1, 0, 1)), 0, false) == LinuxMemoryLevel::kWarning);
  LinuxMemoryPressureTracker restart;
  restart.Observe(*ParseLinuxPsi(Psi(0, 5000000, 0, 0)), 1000000, false);
  assert(restart.Observe(*ParseLinuxPsi(Psi(0, 10, 0, 0)), 2000000, false) == LinuxMemoryLevel::kNormal);
}

void Sources(const char* directory) {
  const std::string first = std::string(directory) + "/cgroup.pressure";
  const std::string second = std::string(directory) + "/system.pressure";
  const std::string missing = std::string(directory) + "/missing.pressure";
  const std::string broken = std::string(directory) + "/broken.pressure";
  Write(first, Psi(0, 1000, 0, 0));
  Write(second, Psi(0, 1000, 0, 0));
  Write(broken, "not psi\n");
  auto none = LinuxMemoryPressureWatch::Open({missing, broken});
  assert(!none.available() && none.signal() == "meminfo");
  auto watch = LinuxMemoryPressureWatch::Open({missing, first, second});
  assert(watch.available() && watch.signal() == "psi" && !watch.armed());
  assert(watch.Sample(0) == LinuxMemoryLevel::kNormal);
  Write(second, Psi(0, 1000 + 200000, 0, 0));
  assert(watch.Sample(1000000) == LinuxMemoryLevel::kWarning);
  Write(first, Psi(0, 1000 + 500000, 0, 150000));
  Write(second, Psi(0, 1200000, 0, 0));
  assert(watch.Sample(2000000) == LinuxMemoryLevel::kCritical);
  assert(watch.NextWaitMs() == 2000);
  Write(first, Psi(0, 501000, 0, 150000));
  Write(second, Psi(0, 1200000, 0, 0));
  assert(watch.Sample(3000000) == LinuxMemoryLevel::kNormal);
  assert(watch.NextWaitMs() == 5000);
  watch.Wait(0);
  unlink(first.c_str());
  unlink(second.c_str());
  unlink(broken.c_str());
}

int failures = 0;
int FailingPoll(pollfd*, nfds_t, int) {
  ++failures;
  errno = EINVAL;
  return -1;
}

void PollFailures() {
  if (access("/proc/pressure/memory", R_OK | W_OK) != 0) return;
  auto watch = LinuxMemoryPressureWatch::Open({"/proc/pressure/memory"});
  if (!watch.available() || !watch.armed()) return;
  assert(!watch.Wait(0, &FailingPoll) && watch.available());
  assert(!watch.Wait(0, &FailingPoll) && watch.available());
  assert(!watch.Wait(0, &FailingPoll));
  assert(failures == 3 && !watch.available() && watch.signal() == "meminfo");
  assert(watch.Wait(0, &FailingPoll) && failures == 3);
}

void Kernel() {
  if (access("/proc/pressure/memory", R_OK | W_OK) != 0) return;
  auto watch = LinuxMemoryPressureWatch::Open({"/proc/pressure/memory"});
  if (!watch.available()) return;
  assert(watch.armed());
  watch.Sample(LinuxMonotonicMicroseconds());
  watch.Wait(0);
  assert(watch.NextWaitMs() == 30000 || watch.NextWaitMs() == 2000 || watch.NextWaitMs() == 1000);
}

}

int main(int argc, char** argv) {
  assert(argc >= 2);
  const std::string mode = argv[1];
  if (mode == "parse") Parse();
  else if (mode == "cgroup") Cgroup();
  else if (mode == "levels") Levels();
  else if (mode == "sources") Sources(argv[2]);
  else if (mode == "kernel") Kernel();
  else if (mode == "poll-failures") PollFailures();
  else return 2;
}
