#include "ardia/linux/ac_linux_history_zoom.h"

#include <cmath>
#include <cstdint>
#include <limits>
#include <utility>

#include "components/zoom/page_zoom.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/web_contents.h"
#include "third_party/blink/public/common/page/page_zoom.h"
#include "url/gurl.h"

namespace ardiacore {
namespace {

std::optional<int> Integer(const base::ListValue& args) {
  if (args.size() != 1 || (!args[0].is_double() && !args[0].is_int())) return std::nullopt;
  const double value = args[0].GetDouble();
  if (!std::isfinite(value) || std::trunc(value) != value ||
      value < std::numeric_limits<int>::min() || value > std::numeric_limits<int>::max()) return std::nullopt;
  return static_cast<int>(value);
}

std::optional<std::string> Host(std::string_view host) {
  if (host.empty() || host.size() > 253 || host.find_first_of("/\\?#@ \t\r\n") != std::string_view::npos) return std::nullopt;
  if (host.find(':') != std::string_view::npos && !(host.front() == '[' && host.back() == ']')) return std::nullopt;
  GURL url("https://" + std::string(host) + "/");
  if (!url.is_valid() || url.host().empty() || url.has_port() || url.host().size() > 253) return std::nullopt;
  return std::string(url.host());
}

}

bool IsLinuxZoomDomainRoute(std::string_view name) {
  for (const char* route : kLinuxZoomDomainRoutes) {
    if (name == route) return true;
  }
  return false;
}

std::optional<LinuxZoomDomainRequest> PrepareLinuxZoomDomain(
    std::string_view method, const base::DictValue& args) {
  if (args.Find("tab")) return std::nullopt;
  if (method == "sites.zoomLevels") {
    if (!args.empty()) return std::nullopt;
    return LinuxZoomDomainRequest{"ac_zoom_list", base::DictValue()};
  }
  if (method != "sites.setZoom" || args.size() != 2) return std::nullopt;
  auto* host = args.FindString("host");
  auto zoom = args.FindDouble("zoom");
  auto normalized = host ? Host(*host) : std::nullopt;
  if (!normalized || !zoom || !std::isfinite(*zoom) || *zoom < blink::kMinimumBrowserZoomFactor ||
      *zoom > blink::kMaximumBrowserZoomFactor) return std::nullopt;
  auto level = blink::ZoomFactorToZoomLevel(*zoom);
  if (!std::isfinite(level)) return std::nullopt;
  return LinuxZoomDomainRequest{"ac_zoom_set", base::DictValue()
      .Set("host", std::move(*normalized)).Set("level", level)};
}

std::optional<base::Value> CompleteLinuxZoomDomain(
    std::string_view method, const base::DictValue& reply) {
  if (method == "sites.setZoom") return base::Value();
  if (method != "sites.zoomLevels") return std::nullopt;
  const auto* levels = reply.FindDict("levels");
  if (!levels) return std::nullopt;
  base::DictValue factors;
  for (const auto item : *levels) {
    if (!item.second.is_double() && !item.second.is_int()) return std::nullopt;
    auto host = Host(item.first);
    const double level = item.second.GetDouble();
    if (!host || !std::isfinite(level)) continue;
    const double rounded = std::round(blink::ZoomLevelToZoomFactor(level) * 100) / 100;
    if (!std::isfinite(rounded) || rounded <= 0) continue;
    factors.Set(*host, rounded);
  }
  return base::Value(std::move(factors));
}

LinuxHistoryZoom::LinuxHistoryZoom(base::WeakPtr<LinuxPageLease> lease)
    : content::WebContentsObserver(lease ? lease->observed_contents() : nullptr), lease_(lease) {
  controller_ = web_contents() ? zoom::ZoomController::FromWebContents(web_contents()) : nullptr;
  if (controller_) controller_->AddObserver(this);
}

LinuxHistoryZoom::~LinuxHistoryZoom() { Reset(); }

bool LinuxHistoryZoom::GoToOffset(const base::ListValue& args) {
  auto offset = Integer(args);
  auto* contents = lease_ ? lease_->presentation_contents() : nullptr;
  if (!offset || !contents) return false;
  if (*offset == 0) return true;
  auto& controller = contents->GetController();
  const auto destination = static_cast<std::int64_t>(controller.GetCurrentEntryIndex()) + *offset;
  if (destination < 0 || destination >= controller.GetEntryCount()) return true;
  if (controller.CanGoToOffset(*offset)) controller.GoToOffset(*offset);
  return true;
}

bool LinuxHistoryZoom::ZoomStep(const base::ListValue& args) {
  auto step = Integer(args);
  auto* contents = lease_ ? lease_->presentation_contents() : nullptr;
  if (!step || *step < -1 || *step > 1 || !contents || !controller_) return false;
  zoom::PageZoom::Zoom(contents, static_cast<content::PageZoom>(*step));
  return true;
}

std::optional<base::DictValue> LinuxHistoryZoom::Snapshot() const {
  auto* contents = lease_ ? lease_->contents() : nullptr;
  if (!contents || !controller_) return std::nullopt;
  const auto factor = blink::ZoomLevelToZoomFactor(controller_->GetZoomLevel());
  auto scale = controller_->PageScaleFactorIsOne() ? std::optional<double>(1) :
      pinch_request_ && pinch_request_->Valid() ? pinch_scale_ : std::nullopt;
  if (!scale || !std::isfinite(*scale) || *scale <= 0 || !std::isfinite(factor) || factor <= 0) return std::nullopt;
  return base::DictValue().Set("zoom", factor).Set("host", contents->GetLastCommittedURL().host())
      .Set("isDefault", controller_->IsAtDefaultZoom()).Set("pinchScale", *scale);
}

bool LinuxHistoryZoom::Emit() {
  auto request = lease_ ? lease_->Capture() : std::nullopt;
  auto snapshot = Snapshot();
  if (!request || !snapshot) return false;
  return request->lease && request->lease->Emit(*request, "zoom", base::Value(std::move(*snapshot)));
}

void LinuxHistoryZoom::Reset() {
  lease_.reset();
  Observe(nullptr);
  if (controller_) { auto* controller = std::exchange(controller_, nullptr); controller->RemoveObserver(this); }
  pinch_scale_.reset();
  pinch_request_.reset();
}

void LinuxHistoryZoom::DidFinishNavigation(content::NavigationHandle* navigation) {
  if (navigation->IsInPrimaryMainFrame()) Emit();
}

void LinuxHistoryZoom::PrimaryPageChanged(content::Page&) {
  pinch_scale_.reset();
  pinch_request_.reset();
}

void LinuxHistoryZoom::OnPageScaleFactorChanged(float scale) {
  pinch_scale_ = std::isfinite(scale) && scale > 0 ? std::optional<double>(scale) : std::nullopt;
  pinch_request_ = lease_ ? lease_->Capture() : std::nullopt;
  Emit();
}

void LinuxHistoryZoom::OnZoomChanged(const zoom::ZoomController::ZoomChangedEventData&) { Emit(); }

void LinuxHistoryZoom::OnZoomControllerDestroyed(zoom::ZoomController* controller) {
  if (controller != controller_) return;
  controller_ = nullptr;
  controller->RemoveObserver(this);
}

void LinuxHistoryZoom::WebContentsDestroyed() { Reset(); }

}
