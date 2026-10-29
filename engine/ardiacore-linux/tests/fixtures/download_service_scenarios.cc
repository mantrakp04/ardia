#include <cassert>
#include <cstdio>
#include <string>
#include <vector>

#include "ardia/linux/ac_linux_download_service.h"

using namespace ardia::linux_downloads;
using download::DownloadItem;

namespace {

bool FixtureListed(DownloadItem* item) {
  return item->listed();
}

std::string Id(int n) {
  char id[37];
  std::snprintf(id, sizeof(id), "3f2504e0-4f89-41d3-9a0c-%012d", n);
  return id;
}

std::vector<std::string> Ids(content::DownloadManager& manager) {
  std::vector<std::string> ids;
  for (const auto& item : manager.items) ids.push_back(item->GetGuid());
  return ids;
}

void ListWaitsForHistory() {
  content::DownloadManager manager;
  std::vector<bool> results;
  DownloadsReady::Wait(&manager, [&](bool ready) { results.push_back(ready); });
  DownloadsReady::Wait(&manager, [&](bool ready) { results.push_back(ready); });
  assert(results.empty());
  assert(manager.observers.size() == 2);
  assert(base::LiveTimers().size() == 2);
  assert(base::LiveTimers()[0]->delay().InMilliseconds() == DownloadsReady::kTimeout.InMilliseconds());
  manager.Initialize();
  assert((results == std::vector<bool>{true, true}));
  assert(manager.observers.empty());
  assert(base::LiveTimers().empty());
  DownloadsReady::Wait(&manager, [&](bool ready) { results.push_back(ready); });
  assert(results.size() == 3 && results.back());
  assert(manager.observers.empty());

  content::DownloadManager closing;
  DownloadsReady::Wait(&closing, [&](bool ready) { results.push_back(ready); });
  closing.GoDown();
  assert(results.size() == 4 && !results.back());
  assert(closing.observers.empty() && base::LiveTimers().empty());

  content::DownloadManager slow;
  DownloadsReady::Wait(&slow, [&](bool ready) { results.push_back(ready); });
  assert(base::LiveTimers().size() == 1);
  base::LiveTimers()[0]->Fire();
  assert(results.size() == 5 && results.back());
  assert(slow.observers.empty() && base::LiveTimers().empty());
  slow.Initialize();
  assert(results.size() == 5);
}

void Targets() {
  content::DownloadManager manager;
  manager.Add({Id(1), DownloadItem::COMPLETE, "/d/done.zip"});
  manager.Add({Id(2), DownloadItem::IN_PROGRESS, "/d/live.zip"});
  manager.Add({Id(3), DownloadItem::COMPLETE, "/d/danger.exe", 0, true});
  manager.Add({Id(4), DownloadItem::COMPLETE, "/d/insecure.zip", 0, false, true});
  manager.Add({Id(5), DownloadItem::COMPLETE, "/d/extension.crx", 0, false, false, false});
  manager.Add({Id(6), DownloadItem::CANCELLED, "/d/cancelled.zip"});
  assert((DownloadTargets(&manager, &FixtureListed, true) == std::vector<std::string>{"/d/done.zip"}));
  assert((DownloadTargets(&manager, &FixtureListed, false) ==
          std::vector<std::string>{"/d/done.zip", "/d/live.zip", "/d/cancelled.zip"}));
  assert(DownloadTargets(nullptr, &FixtureListed, false).empty());
}

void Removal() {
  content::DownloadManager manager;
  manager.Add({Id(1), DownloadItem::COMPLETE, "/d/1"});
  manager.Add({Id(2), DownloadItem::IN_PROGRESS, "/d/2"});
  manager.Add({Id(3), DownloadItem::INTERRUPTED, "/d/3"});
  manager.Add({Id(4), DownloadItem::COMPLETE, "/d/4", 0, false, false, false});
  assert(RemoveDownload(&manager, &FixtureListed, Id(9)) == "no such download");
  assert(RemoveDownload(&manager, &FixtureListed, Id(4)) == "no such download");
  assert(RemoveDownload(&manager, &FixtureListed, Id(2)) == "download in progress");
  assert(RemoveDownload(&manager, &FixtureListed, Id(3)).empty());
  assert(RemoveDownload(&manager, &FixtureListed, Id(1)).empty());
  assert((Ids(manager) == std::vector<std::string>{Id(2), Id(4)}));
}

void Clearing() {
  content::DownloadManager manager;
  for (int n = 1; n <= 150; ++n) manager.Add({Id(n), DownloadItem::COMPLETE, "/d/" + std::to_string(n), 1000.0 + n});
  manager.Add({Id(200), DownloadItem::IN_PROGRESS, "/d/live", 500});
  manager.Add({Id(201), DownloadItem::INTERRUPTED, "/d/failed", 600});
  manager.Add({Id(202), DownloadItem::CANCELLED, "/d/cancelled", 700});
  manager.Add({Id(203), DownloadItem::COMPLETE, "/d/extension", 800, false, false, false});
  manager.Add({Id(204), DownloadItem::COMPLETE, "/d/new", 99999});
  std::vector<std::string> keep;
  for (int n = 51; n <= 150; ++n) keep.push_back(Id(n));
  assert(ClearDownloads(&manager, &FixtureListed, keep, 5000) == 52);
  std::vector<std::string> expected = keep;
  expected.insert(expected.end(), {Id(200), Id(203), Id(204)});
  assert(Ids(manager) == expected);
  assert(ClearDownloads(&manager, &FixtureListed, {}, 100000) == 101);
  assert((Ids(manager) == std::vector<std::string>{Id(200), Id(203)}));
  assert(ClearDownloads(nullptr, &FixtureListed, {}, 100000) == 0);
}

}

int main() {
  ListWaitsForHistory();
  Targets();
  Removal();
  Clearing();
  std::puts("download service scenarios passed");
  return 0;
}
