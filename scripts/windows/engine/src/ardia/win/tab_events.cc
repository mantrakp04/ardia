#include "ardia/win/tab_events.h"

#include <algorithm>
#include <cmath>
#include <string>

#include "ardia/win/tab_state.h"
#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/json/json_writer.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/stringprintf.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/ui/recently_audible_helper.h"
#include "components/find_in_page/find_notification_details.h"
#include "components/find_in_page/find_tab_helper.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/render_widget_host.h"
#include "content/public/browser/ssl_status.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/result_codes.h"
#include "net/cert/cert_status_flags.h"
#include "net/cert/x509_certificate.h"
#include "net/ssl/ssl_connection_status_flags.h"
#include "third_party/blink/public/common/page/page_zoom.h"

namespace ardia_win {

namespace {

constexpr net::CertStatus kCertErrorMask =
    net::CERT_STATUS_ALL_ERRORS &
    ~(net::CERT_STATUS_NO_REVOCATION_MECHANISM |
      net::CERT_STATUS_UNABLE_TO_CHECK_REVOCATION);

std::string Hex(base::span<const uint8_t> bytes) {
  std::string text;
  for (uint8_t byte : bytes) {
    if (!text.empty()) {
      text += ":";
    }
    text += base::StringPrintf("%02X", byte);
  }
  return text;
}

base::DictValue Principal(const net::CertPrincipal& principal) {
  base::ListValue organizations;
  for (const std::string& organization : principal.organization_names) {
    organizations.Append(organization);
  }
  base::DictValue result;
  result.Set("commonName", principal.common_name);
  result.Set("displayName", principal.GetDisplayName());
  result.Set("organizations", std::move(organizations));
  result.Set("country", principal.country_name);
  return result;
}

base::ListValue CertErrorNames(net::CertStatus status) {
  static const std::pair<net::CertStatus, const char*> kErrors[] = {
      {net::CERT_STATUS_COMMON_NAME_INVALID, "nameMismatch"},
      {net::CERT_STATUS_DATE_INVALID, "dateInvalid"},
      {net::CERT_STATUS_AUTHORITY_INVALID, "authorityInvalid"},
      {net::CERT_STATUS_REVOKED, "revoked"},
      {net::CERT_STATUS_INVALID, "invalid"},
      {net::CERT_STATUS_WEAK_SIGNATURE_ALGORITHM, "weakSignature"},
      {net::CERT_STATUS_NON_UNIQUE_NAME, "nonUniqueName"},
      {net::CERT_STATUS_WEAK_KEY, "weakKey"},
      {net::CERT_STATUS_PINNED_KEY_MISSING, "pinnedKeyMissing"},
      {net::CERT_STATUS_NAME_CONSTRAINT_VIOLATION, "nameConstraint"},
      {net::CERT_STATUS_VALIDITY_TOO_LONG, "validityTooLong"},
      {net::CERT_STATUS_CERTIFICATE_TRANSPARENCY_REQUIRED,
       "certificateTransparency"},
  };
  base::ListValue names;
  for (const auto& [bit, name] : kErrors) {
    if (status & bit) {
      names.Append(name);
    }
  }
  return names;
}

base::DictValue CertificateInfo(const net::X509Certificate* cert) {
  const net::SHA256HashValue sha256 =
      net::X509Certificate::CalculateFingerprint256(cert->cert_buffer());
  base::DictValue info;
  info.Set("subject", Principal(cert->subject()));
  info.Set("issuer", Principal(cert->issuer()));
  info.Set("validFrom", cert->valid_start().InMillisecondsFSinceUnixEpoch());
  info.Set("validUntil",
           cert->valid_expiry().InMillisecondsFSinceUnixEpoch());
  info.Set("chainLength",
           static_cast<int>(cert->intermediate_buffers().size() + 1));
  info.Set("serialNumber", Hex(cert->serial_number()));
  info.Set("sha256", Hex(sha256));
  return info;
}

const char* TLSVersion(int connection_status) {
  switch (net::SSLConnectionStatusToVersion(connection_status)) {
    case net::SSL_CONNECTION_VERSION_TLS1:
      return "TLS 1.0";
    case net::SSL_CONNECTION_VERSION_TLS1_1:
      return "TLS 1.1";
    case net::SSL_CONNECTION_VERSION_TLS1_2:
      return "TLS 1.2";
    case net::SSL_CONNECTION_VERSION_TLS1_3:
      return "TLS 1.3";
    case net::SSL_CONNECTION_VERSION_QUIC:
      return "QUIC";
    default:
      return nullptr;
  }
}

std::string OriginOf(const GURL& url) {
  if (!url.SchemeIsHTTPOrHTTPS() || url.host().empty()) {
    return std::string();
  }
  std::string origin =
      std::string(url.scheme()) + "://" + std::string(url.host());
  if (url.has_port()) {
    origin += ":" + std::string(url.port());
  }
  return origin;
}

}

TabEvents::TabEvents(content::WebContents* contents)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<TabEvents>(*contents),
      discarded_(contents->WasDiscarded()) {}

TabEvents::~TabEvents() = default;

void TabEvents::Attach(content::WebContents* contents) {
  if (!contents) {
    return;
  }
  CreateForWebContents(contents);
  FromWebContents(contents)->Observe();
}

base::DictValue TabEvents::MediaState(content::WebContents* contents) {
  base::DictValue data;
  if (!contents) {
    data.Set("playing", false);
    data.Set("audible", false);
    data.Set("muted", false);
    return data;
  }
  bool playing = contents->IsCurrentlyAudible();
  if (auto* helper = RecentlyAudibleHelper::FromWebContents(contents)) {
    playing = helper->WasRecentlyAudible();
  }
  data.Set("playing", playing);
  data.Set("audible", contents->IsCurrentlyAudible());
  data.Set("muted", contents->IsAudioMuted());
  return data;
}

base::DictValue TabEvents::SecurityInfo(content::WebContents* contents) {
  base::DictValue info;
  if (!contents) {
    info.Set("level", "none");
    return info;
  }
  content::NavigationEntry* entry =
      contents->GetController().GetVisibleEntry();
  const GURL url = entry ? entry->GetURL() : contents->GetVisibleURL();
  const std::string origin = OriginOf(url);
  info.Set("url", url.spec());
  info.Set("origin", origin.empty() ? base::Value() : base::Value(origin));
  if (url.SchemeIs("http") || url.SchemeIs("ws")) {
    info.Set("level", "insecure");
    return info;
  }
  if (!url.SchemeIs("https") && !url.SchemeIs("wss")) {
    info.Set("level", !url.is_empty() && url != GURL("about:blank") ? "local"
                                                                    : "none");
    return info;
  }
  if (!entry) {
    info.Set("level", "none");
    return info;
  }
  const content::SSLStatus& ssl = entry->GetSSL();
  const net::CertStatus errors = ssl.cert_status & kCertErrorMask;
  const int content_status = ssl.content_status;
  const char* level = "secure";
  if (errors || !ssl.certificate) {
    level = "certificateError";
  } else if (content_status &
             (content::SSLStatus::RAN_INSECURE_CONTENT |
              content::SSLStatus::DISPLAYED_INSECURE_CONTENT |
              content::SSLStatus::RAN_CONTENT_WITH_CERT_ERRORS |
              content::SSLStatus::DISPLAYED_CONTENT_WITH_CERT_ERRORS)) {
    level = "mixed";
  }
  info.Set("level", level);
  info.Set("certificateErrors", CertErrorNames(errors));
  if (content_status & (content::SSLStatus::RAN_INSECURE_CONTENT |
                        content::SSLStatus::RAN_CONTENT_WITH_CERT_ERRORS)) {
    info.Set("mixedContent", "ran");
  } else if (content_status &
             (content::SSLStatus::DISPLAYED_INSECURE_CONTENT |
              content::SSLStatus::DISPLAYED_CONTENT_WITH_CERT_ERRORS)) {
    info.Set("mixedContent", "displayed");
  } else {
    info.Set("mixedContent", base::Value());
  }
  info.Set("isEV", (ssl.cert_status & net::CERT_STATUS_IS_EV) != 0);
  if (const char* tls = TLSVersion(ssl.connection_status)) {
    info.Set("protocol", tls);
  }
  if (const net::X509Certificate* cert = ssl.certificate.get()) {
    info.Set("certificate", CertificateInfo(cert));
  }
  return info;
}

double TabEvents::ZoomFactor(content::WebContents* contents) {
  return contents
             ? blink::ZoomLevelToZoomFactor(
                   zoom::ZoomController::GetZoomLevelForWebContents(contents))
             : 1;
}

void TabEvents::SendZoom(bool user) {
  const double zoom = ZoomFactor(web_contents());
  base::DictValue data;
  data.Set("zoom", std::round(zoom * 100) / 100);
  data.Set("host", std::string(web_contents()->GetVisibleURL().host()));
  data.Set("isDefault", std::fabs(zoom - 1) < 0.001);
  data.Set("pinchScale",
           pinch_scale_ > 0 ? std::min<double>(pinch_scale_, 100) : 1.0);
  data.Set("user", user);
  Send("zoom", std::move(data));
}

void TabEvents::TargetURLChanged(const GURL& url) {
  base::DictValue data;
  data.Set("text", url.spec());
  Send("status", std::move(data));
}

void TabEvents::RendererUnresponsive(content::RenderWidgetHost* host,
                                     base::RepeatingClosure restarter) {
  if (host) {
    unresponsive_ = std::make_pair(host->GetProcess()->GetDeprecatedID(),
                                   host->GetRoutingID());
  }
  hang_monitor_restarter_ = std::move(restarter);
  Send("unresponsive", base::DictValue());
}

void TabEvents::RendererResponsive(content::RenderWidgetHost* host) {
  if (!unresponsive_ ||
      (host &&
       *unresponsive_ != std::make_pair(host->GetProcess()->GetDeprecatedID(),
                                        host->GetRoutingID()))) {
    return;
  }
  unresponsive_.reset();
  hang_monitor_restarter_.Reset();
  Send("responsive", base::DictValue());
}

void TabEvents::ResolveUnresponsive(bool terminate) {
  content::RenderWidgetHost* host =
      unresponsive_ ? content::RenderWidgetHost::FromID(unresponsive_->first,
                                                         unresponsive_->second)
                    : nullptr;
  base::RepeatingClosure restarter = std::move(hang_monitor_restarter_);
  hang_monitor_restarter_.Reset();
  if (terminate) {
    unresponsive_.reset();
    if (host && host->GetProcess()->IsInitializedAndNotDead()) {
      host->GetProcess()->Shutdown(content::RESULT_CODE_HUNG);
    }
  } else if (restarter) {
    restarter.Run();
  }
}

void TabEvents::DidStartNavigation(content::NavigationHandle* handle) {
  if (discarded_ && handle->IsInPrimaryMainFrame() &&
      !web_contents()->WasDiscarded()) {
    discarded_ = false;
    Send("ready", base::DictValue());
  }
}

void TabEvents::DidFinishNavigation(content::NavigationHandle* handle) {
  Observe();
  if (!handle->IsInPrimaryMainFrame()) {
    return;
  }
  base::WeakPtr<TabEvents> alive = weak_factory_.GetWeakPtr();
  if (handle->IsDownload()) {
    base::DictValue data;
    data.Set("url", handle->GetURL().spec());
    data.Set("committedUrl", web_contents()->GetVisibleURL().spec());
    data.Set("skipped", false);
    Send("downloadNavigation", std::move(data));
    if (!alive) {
      return;
    }
  }
  if (handle->HasCommitted()) {
    CheckSecurity();
  }
}

void TabEvents::DidStartLoading() {
  Observe();
}

void TabEvents::DidStopLoading() {
  CheckSecurity();
}

void TabEvents::DidChangeVisibleSecurityState() {
  CheckSecurity();
}

void TabEvents::WasDiscarded() {
  discarded_ = true;
  base::DictValue data;
  data.Set("url", web_contents()->GetVisibleURL().spec());
  Send("discarded", std::move(data));
}

void TabEvents::OnPageScaleFactorChanged(float page_scale_factor) {
  pinch_scale_ = page_scale_factor;
  SendZoom(false);
}

void TabEvents::OnVisibilityChanged(content::Visibility visibility) {
  if (visibility == content::Visibility::VISIBLE) {
    frozen_ = false;
  }
}

void TabEvents::DidToggleFullscreenModeForTab(bool entered_fullscreen,
                                              bool will_cause_resize) {
  if (entered_fullscreen == fullscreen_) {
    return;
  }
  fullscreen_ = entered_fullscreen;
  base::DictValue data;
  data.Set("fullscreen", entered_fullscreen);
  Send("fullscreen", std::move(data));
}

void TabEvents::WebContentsDestroyed() {
  audible_subscription_ = {};
  if (popups_) {
    popups_->manager()->RemoveObserver(this);
    popups_ = nullptr;
  }
  if (zoom_) {
    zoom_->RemoveObserver(this);
    zoom_ = nullptr;
  }
  if (find_helper_) {
    find_helper_->RemoveObserver(this);
    find_helper_ = nullptr;
  }
}

void TabEvents::OnZoomChanged(
    const zoom::ZoomController::ZoomChangedEventData& data) {
  if (data.web_contents == web_contents()) {
    SendZoom(false);
  }
}

void TabEvents::OnZoomControllerDestroyed(
    zoom::ZoomController* zoom_controller) {
  zoom_controller->RemoveObserver(this);
  zoom_ = nullptr;
}

void TabEvents::BlockedUrlAdded(int32_t popup_id, const GURL& url) {
  base::DictValue popup;
  popup.Set("id", base::NumberToString(popup_id));
  popup.Set("url", url.spec());
  popup.Set("origin", OriginOf(web_contents()->GetLastCommittedURL()));
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&TabEvents::SendBlockedPopup,
                                weak_factory_.GetWeakPtr(), popup_id,
                                std::move(popup)));
}

void TabEvents::OnFindResultAvailable(content::WebContents* web_contents) {
  if (!find_helper_) {
    return;
  }
  const find_in_page::FindNotificationDetails& result =
      find_helper_->find_result();
  base::DictValue data;
  data.Set("count", result.number_of_matches());
  data.Set("active", result.active_match_ordinal());
  data.Set("final", result.final_update());
  Send("find", std::move(data));
}

void TabEvents::OnFindTabHelperDestroyed(find_in_page::FindTabHelper* helper) {
  helper->RemoveObserver(this);
  find_helper_ = nullptr;
}

void TabEvents::Observe() {
  content::WebContents* contents = web_contents();
  if (!contents) {
    return;
  }
  if (!find_helper_) {
    find_helper_ = find_in_page::FindTabHelper::FromWebContents(contents);
    if (find_helper_) {
      find_helper_->AddObserver(this);
    }
  }
  if (!zoom_) {
    zoom_ = zoom::ZoomController::FromWebContents(contents);
    if (zoom_) {
      zoom_->AddObserver(this);
    }
  }
  if (!popups_) {
    popups_ = blocked_content::PopupBlockerTabHelper::FromWebContents(contents);
    if (popups_) {
      popups_->manager()->AddObserver(this);
    }
  }
  if (!audible_subscription_) {
    if (auto* helper = RecentlyAudibleHelper::FromWebContents(contents)) {
      audible_subscription_ = helper->RegisterRecentlyAudibleChangedCallback(
          base::BindRepeating(&TabEvents::OnRecentlyAudibleChanged,
                              base::Unretained(this)));
    }
  }
}

bool TabEvents::Listened() const {
  TabState* state = TabState::FromWebContents(web_contents());
  return state && !state->key().empty();
}

void TabEvents::Send(std::string_view name, base::DictValue data) {
  if (TabState* state = TabState::FromWebContents(web_contents())) {
    state->Send(name, std::move(data));
  }
}

void TabEvents::CheckSecurity() {
  if (!Listened()) {
    return;
  }
  base::DictValue info = SecurityInfo(web_contents());
  std::string json = base::WriteJson(info).value_or("{}");
  if (json == security_) {
    return;
  }
  security_ = std::move(json);
  Send("security", std::move(info));
}

void TabEvents::SendBlockedPopup(int32_t popup_id, base::DictValue popup) {
  if (!popups_ || !popups_->GetBlockedPopupRequests().contains(popup_id)) {
    return;
  }
  Send("popupBlocked", std::move(popup));
}

void TabEvents::OnRecentlyAudibleChanged(bool was_recently_audible) {
  Send("media", MediaState(web_contents()));
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(TabEvents);

}
