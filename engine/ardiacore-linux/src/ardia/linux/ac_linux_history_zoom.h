#ifndef ARDIA_LINUX_AC_LINUX_HISTORY_ZOOM_H_
#define ARDIA_LINUX_AC_LINUX_HISTORY_ZOOM_H_

#include <string_view>

#include "ardia/linux/ac_linux_page_lease.h"
#include "components/zoom/zoom_observer.h"

namespace ardiacore {

inline constexpr const char* kLinuxZoomDomainRoutes[] = {"sites.zoomLevels", "sites.setZoom"};
bool IsLinuxZoomDomainRoute(std::string_view name);

struct LinuxZoomDomainRequest {
  std::string service;
  base::DictValue args;
};

std::optional<LinuxZoomDomainRequest> PrepareLinuxZoomDomain(
    std::string_view method, const base::DictValue& args);
std::optional<base::Value> CompleteLinuxZoomDomain(
    std::string_view method, const base::DictValue& reply);

class LinuxHistoryZoom : public content::WebContentsObserver,
                         public zoom::ZoomObserver {
 public:
  explicit LinuxHistoryZoom(base::WeakPtr<LinuxPageLease> lease);
  ~LinuxHistoryZoom() override;
  bool GoToOffset(const base::ListValue& args);
  bool ZoomStep(const base::ListValue& args);
  std::optional<base::DictValue> Snapshot() const;
  bool Emit();
  void Reset();

 private:
  void PrimaryPageChanged(content::Page& page) override;
  void DidFinishNavigation(content::NavigationHandle* navigation) override;
  void OnPageScaleFactorChanged(float scale) override;
  void OnZoomChanged(const zoom::ZoomController::ZoomChangedEventData& data) override;
  void OnZoomControllerDestroyed(zoom::ZoomController* controller) override;
  void WebContentsDestroyed() override;
  base::WeakPtr<LinuxPageLease> lease_;
  zoom::ZoomController* controller_ = nullptr;
  std::optional<double> pinch_scale_;
  std::optional<LinuxPageRequest> pinch_request_;
};

}

#endif
