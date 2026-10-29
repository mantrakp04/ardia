#ifndef ARDIA_LINUX_AC_LINUX_DOWNLOAD_SERVICE_H_
#define ARDIA_LINUX_AC_LINUX_DOWNLOAD_SERVICE_H_

#include <cstddef>
#include <string>
#include <vector>

#include "base/functional/callback.h"
#include "base/scoped_observation.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "components/download/public/common/download_item.h"
#include "content/public/browser/download_manager.h"

namespace ardia::linux_downloads {

using ListedDownload = bool (*)(download::DownloadItem*);

std::vector<std::string> DownloadTargets(content::DownloadManager* manager, ListedDownload listed,
                                         bool complete_only);
std::string RemoveDownload(content::DownloadManager* manager, ListedDownload listed, const std::string& id);
size_t ClearDownloads(content::DownloadManager* manager, ListedDownload listed,
                      const std::vector<std::string>& keep, double before_ms);

class DownloadsReady : public content::DownloadManager::Observer {
 public:
  static constexpr base::TimeDelta kTimeout = base::Seconds(10);

  static void Wait(content::DownloadManager* manager, base::OnceCallback<void(bool)> done);

  DownloadsReady(const DownloadsReady&) = delete;
  DownloadsReady& operator=(const DownloadsReady&) = delete;
  ~DownloadsReady() override;

 private:
  DownloadsReady(content::DownloadManager* manager, base::OnceCallback<void(bool)> done);

  void OnManagerInitialized() override;
  void ManagerGoingDown(content::DownloadManager* manager) override;
  void Finish(bool ready);

  base::OnceCallback<void(bool)> done_;
  base::OneShotTimer timeout_;
  base::ScopedObservation<content::DownloadManager, content::DownloadManager::Observer> observation_{this};
};

}

#endif
