#include "ardia/linux/ac_linux_download_service.h"

#include <cassert>
#include <cstdio>
#include <optional>

using ardia::linux_downloads::DownloadsReady;

namespace {

std::optional<bool> Wait(content::DownloadManager* manager) {
  std::optional<bool> ready;
  DownloadsReady::Wait(manager, [&ready](bool value) { ready = value; });
  return ready;
}

}

int main() {
  assert(Wait(nullptr) == false);

  content::DownloadManager initialized;
  initialized.initialized = true;
  assert(Wait(&initialized) == true);
  assert(initialized.observers.empty());

  content::DownloadManager late;
  std::optional<bool> late_ready;
  DownloadsReady::Wait(&late, [&late_ready](bool value) { late_ready = value; });
  assert(!late_ready && late.observers.size() == 1 && base::g_started_timer);
  late.Initialize();
  assert(late_ready == true && late.observers.empty() && !base::g_started_timer);

  content::DownloadManager stuck;
  std::optional<bool> stuck_ready;
  DownloadsReady::Wait(&stuck, [&stuck_ready](bool value) { stuck_ready = value; });
  assert(!stuck_ready && base::g_started_timer);
  base::g_started_timer->Fire();
  assert(stuck_ready == false);
  assert(stuck.observers.empty() && !base::g_started_timer);

  content::DownloadManager ending;
  std::optional<bool> ending_ready;
  DownloadsReady::Wait(&ending, [&ending_ready](bool value) { ending_ready = value; });
  ending.GoDown();
  assert(ending_ready == false && ending.observers.empty() && !base::g_started_timer);

  std::puts("download service scenarios passed");
}
