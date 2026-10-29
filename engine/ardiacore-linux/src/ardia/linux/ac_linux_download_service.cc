#include "ardia/linux/ac_linux_download_service.h"

#include <algorithm>
#include <utility>

#include "base/functional/bind.h"
#include "base/location.h"

namespace ardia::linux_downloads {
namespace {

template <typename Visit>
void ForEachListed(content::DownloadManager* manager, ListedDownload listed, Visit visit) {
  if (!manager) return;
  content::DownloadManager::DownloadVector items;
  manager->GetAllDownloads(&items);
  for (download::DownloadItem* item : items) {
    if (listed(item)) visit(item);
  }
}

download::DownloadItem* ListedById(content::DownloadManager* manager, ListedDownload listed,
                                   const std::string& id) {
  download::DownloadItem* item = manager ? manager->GetDownloadByGuid(id) : nullptr;
  return item && listed(item) ? item : nullptr;
}

}

std::vector<std::string> DownloadTargets(content::DownloadManager* manager, ListedDownload listed,
                                         bool complete_only) {
  std::vector<std::string> targets;
  ForEachListed(manager, listed, [&](download::DownloadItem* item) {
    if (item->IsDangerous() || item->IsInsecure()) return;
    if (complete_only && item->GetState() != download::DownloadItem::COMPLETE) return;
    targets.push_back(item->GetTargetFilePath().value());
  });
  return targets;
}

std::string RemoveDownload(content::DownloadManager* manager, ListedDownload listed, const std::string& id) {
  download::DownloadItem* item = ListedById(manager, listed, id);
  if (!item) return "no such download";
  if (item->GetState() == download::DownloadItem::IN_PROGRESS) return "download in progress";
  item->Remove();
  return {};
}

size_t ClearDownloads(content::DownloadManager* manager, ListedDownload listed,
                      const std::vector<std::string>& keep, double before_ms) {
  std::vector<std::string> doomed;
  ForEachListed(manager, listed, [&](download::DownloadItem* item) {
    if (item->GetState() == download::DownloadItem::IN_PROGRESS) return;
    if (item->GetStartTime().InMillisecondsFSinceUnixEpoch() > before_ms) return;
    if (std::find(keep.begin(), keep.end(), item->GetGuid()) != keep.end()) return;
    doomed.push_back(item->GetGuid());
  });
  size_t removed = 0;
  for (const auto& id : doomed) {
    download::DownloadItem* item = ListedById(manager, listed, id);
    if (!item || item->GetState() == download::DownloadItem::IN_PROGRESS) continue;
    item->Remove();
    ++removed;
  }
  return removed;
}

void DownloadsReady::Wait(content::DownloadManager* manager, base::OnceCallback<void(bool)> done) {
  if (!manager) return std::move(done).Run(false);
  if (manager->IsManagerInitialized()) return std::move(done).Run(true);
  auto* waiter = new DownloadsReady(manager, std::move(done));
  waiter->timeout_.Start(FROM_HERE, kTimeout, base::BindOnce(&DownloadsReady::Finish, base::Unretained(waiter), true));
}

DownloadsReady::DownloadsReady(content::DownloadManager* manager, base::OnceCallback<void(bool)> done)
    : done_(std::move(done)) {
  observation_.Observe(manager);
}

DownloadsReady::~DownloadsReady() = default;

void DownloadsReady::OnManagerInitialized() {
  Finish(true);
}

void DownloadsReady::ManagerGoingDown(content::DownloadManager*) {
  Finish(false);
}

void DownloadsReady::Finish(bool ready) {
  auto done = std::move(done_);
  observation_.Reset();
  delete this;
  if (done) std::move(done).Run(ready);
}

}
