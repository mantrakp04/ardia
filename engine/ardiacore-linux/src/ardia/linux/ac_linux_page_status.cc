#include "ardia/linux/ac_linux_page_status.h"

#include <memory>
#include <utility>
#include <vector>

#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "components/blocked_content/popup_blocker_tab_helper.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/result_codes.h"
#include "ui/base/window_open_disposition.h"
#include "url/origin.h"

namespace ardiacore {
namespace {

constexpr size_t kMaxBlockedPopups = 100;
constexpr size_t kMaxDeferredHangs = 64;

using HangId = std::pair<int, int>;
using Hangs = std::map<HangId, base::RepeatingClosure>;

class DeferredHangs;

std::map<const content::WebContents*, std::unique_ptr<DeferredHangs>>& Deferred() {
  static base::NoDestructor<std::map<const content::WebContents*, std::unique_ptr<DeferredHangs>>> deferred;
  return *deferred;
}

class DeferredHangs : public content::WebContentsObserver {
 public:
  explicit DeferredHangs(content::WebContents* contents) : content::WebContentsObserver(contents) {}
  Hangs hangs;

 private:
  void WebContentsDestroyed() override {
    const content::WebContents* contents = web_contents();
    Observe(nullptr);
    Deferred().erase(contents);
  }
};

std::optional<HangId> WidgetId(content::RenderWidgetHost* host) {
  if (!host || !host->GetProcess()) return std::nullopt;
  return HangId(host->GetProcess()->GetDeprecatedID(), host->GetRoutingID());
}

void PruneDeferred() {
  for (auto contents = Deferred().begin(); contents != Deferred().end();) {
    Hangs& hangs = contents->second->hangs;
    for (auto hang = hangs.begin(); hang != hangs.end();) {
      if (content::RenderWidgetHost::FromID(hang->first.first, hang->first.second)) ++hang;
      else hang = hangs.erase(hang);
    }
    if (hangs.empty()) contents = Deferred().erase(contents);
    else ++contents;
  }
}

base::DictValue PageEvent(std::string name, base::Value data) {
  return base::DictValue().Set("name", std::move(name)).Set("data", std::move(data));
}

}

bool LinuxRendererGone(base::TerminationStatus status) {
  return status != base::TERMINATION_STATUS_NORMAL_TERMINATION &&
         status != base::TERMINATION_STATUS_STILL_RUNNING;
}

std::string LinuxCrashReason(base::TerminationStatus status) {
  switch (status) {
    case base::TERMINATION_STATUS_ABNORMAL_TERMINATION: return "abnormal";
    case base::TERMINATION_STATUS_PROCESS_WAS_KILLED: return "killed";
    case base::TERMINATION_STATUS_PROCESS_CRASHED: return "crashed";
    case base::TERMINATION_STATUS_OOM: return "oom";
    case base::TERMINATION_STATUS_LAUNCH_FAILED: return "launchFailed";
    default: return "unknown";
  }
}

bool DeferLinuxHang(content::WebContents* contents, content::RenderWidgetHost* host,
                    base::RepeatingClosure restarter) {
  const auto id = WidgetId(host);
  if (!contents || !id) return false;
  PruneDeferred();
  auto& entry = Deferred()[contents];
  if (!entry) entry = std::make_unique<DeferredHangs>(contents);
  Hangs& hangs = entry->hangs;
  if (!hangs.contains(*id) && hangs.size() >= kMaxDeferredHangs) return false;
  hangs[*id] = std::move(restarter);
  return true;
}

bool ResolveDeferredLinuxHang(content::WebContents* contents, content::RenderWidgetHost* host) {
  const auto id = WidgetId(host);
  const auto found = Deferred().find(contents);
  if (!id || found == Deferred().end() || !found->second->hangs.erase(*id)) return false;
  if (found->second->hangs.empty()) Deferred().erase(found);
  return true;
}

void ForgetDeferredLinuxHangs(content::WebContents* contents) {
  Deferred().erase(contents);
}

size_t DeferredLinuxHangs(content::WebContents* contents) {
  const auto found = Deferred().find(contents);
  return found == Deferred().end() ? 0 : found->second->hangs.size();
}

LinuxPageStatus::LinuxPageStatus(base::WeakPtr<LinuxPageLease> lease)
    : content::WebContentsObserver(lease ? lease->observed_contents() : nullptr),
      lease_(lease) {
  if (auto* popups = Popups()) {
    popups->manager()->AddObserver(this);
    observing_popups_ = true;
    for (const auto& [id, url] : popups->GetBlockedPopupRequests()) RememberBlocked(id, url);
  }
}

LinuxPageStatus::~LinuxPageStatus() { Reset(); }

content::WebContents* LinuxPageStatus::Live() const {
  auto* contents = lease_ ? lease_->presentation_contents() : nullptr;
  return contents && contents == web_contents() ? contents : nullptr;
}

bool LinuxPageStatus::CurrentDocument(const content::WeakDocumentPtr& document) const {
  auto* contents = Live();
  auto* frame = document.AsRenderFrameHostIfValid();
  return contents && frame && frame == contents->GetPrimaryMainFrame();
}

bool LinuxPageStatus::Hung() const {
  for (const auto& [id, restarter] : hung_) {
    auto* host = content::RenderWidgetHost::FromID(id.first, id.second);
    if (host && host->IsCurrentlyUnresponsive()) return true;
  }
  return false;
}

blocked_content::PopupBlockerTabHelper* LinuxPageStatus::Popups() const {
  return web_contents() ? blocked_content::PopupBlockerTabHelper::FromWebContents(web_contents())
                        : nullptr;
}

bool LinuxPageStatus::Present(std::string name, base::Value data) {
  auto request = lease_ ? lease_->CapturePresentation() : std::nullopt;
  return request && request->lease &&
         request->lease->EmitPresentation(*request, std::move(name), std::move(data));
}

void LinuxPageStatus::AdoptDeferredHangs() {
  const auto found = Deferred().find(web_contents());
  if (found == Deferred().end()) return;
  Hangs hangs = std::move(found->second->hangs);
  Deferred().erase(found);
  for (auto& [id, restarter] : hangs) {
    auto* host = content::RenderWidgetHost::FromID(id.first, id.second);
    if (host && host->IsCurrentlyUnresponsive()) hung_[id] = std::move(restarter);
  }
}

void LinuxPageStatus::AppendSnapshot(base::ListValue& events) {
  auto* contents = Live();
  if (!contents) return;
  AdoptDeferredHangs();
  events.Append(PageEvent("fullscreen", base::Value(base::DictValue()
      .Set("fullscreen", contents->IsFullscreen()))));
  events.Append(PageEvent("status", base::Value(base::DictValue()
      .Set("text", CurrentDocument(status_document_) ? status_ : std::string()))));
  if (contents->IsCrashed() && LinuxRendererGone(contents->GetCrashedStatus())) {
    const int code = contents->GetCrashedErrorCode();
    events.Append(PageEvent("crashed", base::Value(base::DictValue()
        .Set("status", code).Set("reason", LinuxCrashReason(contents->GetCrashedStatus()))
        .Set("code", code))));
  }
  events.Append(PageEvent(Hung() ? "unresponsive" : "responsive", base::Value(base::DictValue())));
  auto* popups = Popups();
  const auto requests = popups ? popups->GetBlockedPopupRequests()
                               : blocked_content::PopupBlockerTabHelper::PopupIdMap();
  for (auto it = blocked_.begin(); it != blocked_.end();) {
    if (!CurrentDocument(it->second.document) || !requests.contains(it->first)) {
      it = blocked_.erase(it);
      continue;
    }
    events.Append(PageEvent("popupBlocked", base::Value(base::DictValue()
        .Set("id", base::NumberToString(it->first)).Set("url", it->second.url.spec())
        .Set("origin", it->second.origin))));
    ++it;
  }
}

bool LinuxPageStatus::TargetURL(const GURL& url) {
  auto* contents = Live();
  if (!contents || !contents->GetPrimaryMainFrame()) return false;
  std::string text = url.is_valid() ? url.spec() : std::string();
  if (text == status_ && CurrentDocument(status_document_)) return true;
  status_ = text;
  status_document_ = contents->GetPrimaryMainFrame()->GetWeakDocumentPtr();
  Present("status", base::Value(base::DictValue().Set("text", std::move(text))));
  return true;
}

bool LinuxPageStatus::Unresponsive(content::RenderWidgetHost* host,
                                   base::RepeatingClosure restarter) {
  if (!host || !host->GetProcess() || !Live()) return false;
  const auto id = std::make_pair(host->GetProcess()->GetDeprecatedID(), host->GetRoutingID());
  hung_[id] = std::move(restarter);
  const auto weak = weak_factory_.GetWeakPtr();
  if (Present("unresponsive", base::Value(base::DictValue()))) return true;
  if (!weak) return false;
  hung_.erase(id);
  return false;
}

bool LinuxPageStatus::Responsive(content::RenderWidgetHost* host) {
  if (!host || !host->GetProcess() ||
      !hung_.erase(std::make_pair(host->GetProcess()->GetDeprecatedID(), host->GetRoutingID()))) {
    return false;
  }
  if (hung_.empty()) Present("responsive", base::Value(base::DictValue()));
  return true;
}

void LinuxPageStatus::ReleaseHang(bool restart) {
  auto hung = std::move(hung_);
  hung_.clear();
  if (!restart) return;
  for (auto& [id, restarter] : hung) {
    if (restarter) restarter.Run();
  }
}

void LinuxPageStatus::DeferHangs() {
  auto hung = std::move(hung_);
  hung_.clear();
  auto* contents = web_contents();
  if (!contents || contents->IsBeingDestroyed()) return;
  for (auto& [id, restarter] : hung) {
    auto* host = content::RenderWidgetHost::FromID(id.first, id.second);
    if (host && host->IsCurrentlyUnresponsive()) DeferLinuxHang(contents, host, std::move(restarter));
  }
}

bool LinuxPageStatus::ResolveUnresponsive(const base::ListValue& args) {
  if (args.size() != 1 || !args[0].is_bool() || !Live()) return false;
  if (hung_.empty()) return true;
  if (!args[0].GetBool()) {
    ReleaseHang(true);
    return true;
  }
  std::vector<std::pair<int, int>> ids;
  for (const auto& [id, restarter] : hung_) ids.push_back(id);
  ReleaseHang(false);
  for (const auto& id : ids) {
    auto* host = content::RenderWidgetHost::FromID(id.first, id.second);
    if (host && host->GetProcess() && host->GetProcess()->IsInitializedAndNotDead())
      host->GetProcess()->Shutdown(content::RESULT_CODE_HUNG);
  }
  return true;
}

bool LinuxPageStatus::OpenBlockedPopup(const base::ListValue& args) {
  if (args.empty() || args.size() > 2 || !args[0].is_string() ||
      (args.size() == 2 && !args[1].is_bool())) return false;
  int32_t id = 0;
  if (!base::StringToInt(args[0].GetString(), &id)) return false;
  auto* contents = Live();
  auto* popups = Popups();
  const auto found = blocked_.find(id);
  if (!contents || !popups || found == blocked_.end() || !CurrentDocument(found->second.document) ||
      !popups->GetBlockedPopupRequests().contains(id)) return false;
  blocked_.erase(found);
  if (args.size() == 2 && args[1].GetBool()) {
    if (auto* settings = HostContentSettingsMapFactory::GetForProfile(contents->GetBrowserContext())) {
      settings->SetContentSettingDefaultScope(contents->GetLastCommittedURL(), GURL(),
                                              ContentSettingsType::POPUPS, CONTENT_SETTING_ALLOW);
    }
  }
  popups->ShowBlockedPopup(id, WindowOpenDisposition::NEW_FOREGROUND_TAB);
  return true;
}

void LinuxPageStatus::DidToggleFullscreenModeForTab(bool entered, bool) {
  Present("fullscreen", base::Value(base::DictValue().Set("fullscreen", entered)));
}

void LinuxPageStatus::PrimaryMainFrameRenderProcessGone(base::TerminationStatus status) {
  if (!LinuxRendererGone(status)) return;
  auto* contents = Live();
  status_.clear();
  status_document_ = content::WeakDocumentPtr();
  hung_.clear();
  if (!contents) return;
  const int code = contents->GetCrashedErrorCode();
  Present("crashed", base::Value(base::DictValue()
      .Set("status", code).Set("reason", LinuxCrashReason(status)).Set("code", code)));
}

const LinuxPageStatus::BlockedPopup* LinuxPageStatus::RememberBlocked(int32_t id, const GURL& url) {
  auto* contents = Live();
  if (!contents || !contents->GetPrimaryMainFrame()) return nullptr;
  if (!blocked_.contains(id) && blocked_.size() >= kMaxBlockedPopups) return nullptr;
  const GURL& committed = contents->GetLastCommittedURL();
  std::string origin = committed.SchemeIsHTTPOrHTTPS()
      ? url::Origin::Create(committed).Serialize() : std::string();
  return &(blocked_[id] = BlockedPopup{url, std::move(origin), contents->GetPrimaryMainFrame()->GetWeakDocumentPtr()});
}

void LinuxPageStatus::BlockedUrlAdded(int32_t id, const GURL& url) {
  const BlockedPopup* blocked = RememberBlocked(id, url);
  if (!blocked) return;
  std::string origin = blocked->origin;
  auto request = lease_ ? lease_->Capture() : std::nullopt;
  if (!request || !request->lease) return;
  request->lease->Emit(*request, "popupBlocked", base::Value(base::DictValue()
      .Set("id", base::NumberToString(id)).Set("url", url.spec()).Set("origin", std::move(origin))));
}

void LinuxPageStatus::StopObservingPopups() {
  if (!observing_popups_) return;
  observing_popups_ = false;
  if (auto* popups = Popups()) popups->manager()->RemoveObserver(this);
}

void LinuxPageStatus::WebContentsDestroyed() {
  hung_.clear();
  Reset();
}

void LinuxPageStatus::Reset() {
  weak_factory_.InvalidateWeakPtrs();
  StopObservingPopups();
  blocked_.clear();
  status_.clear();
  status_document_ = content::WeakDocumentPtr();
  lease_.reset();
  DeferHangs();
  Observe(nullptr);
}

}
