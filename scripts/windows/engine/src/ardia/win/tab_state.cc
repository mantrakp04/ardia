#include "ardia/win/tab_state.h"

#include <utility>

#include "ardia/win/api.h"
#include "ardia/win/host.h"
#include "ardia/win/page_links.h"
#include "ardia/win/tab_events.h"
#include "base/functional/bind.h"
#include "base/process/kill.h"
#include "base/strings/stringprintf.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "components/favicon/content/content_favicon_driver.h"
#include "components/sessions/content/session_tab_helper.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/web_contents.h"
#include "net/base/net_errors.h"
#include "net/http/http_response_headers.h"
#include "third_party/skia/include/core/SkColor.h"

namespace ardia_win {

TabState::TabState(content::WebContents* contents)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<TabState>(*contents) {}

TabState::~TabState() = default;

TabState* TabState::Bind(content::WebContents* contents, std::string key) {
  TabState::CreateForWebContents(contents);
  TabState* state = TabState::FromWebContents(contents);
  state->key_ = std::move(key);
  if (!state->favicon_observation_.IsObserving()) {
    if (favicon::ContentFaviconDriver* driver =
            favicon::ContentFaviconDriver::FromWebContents(contents)) {
      state->favicon_observation_.Observe(driver);
    }
  }
  PageLinks::Watch(contents);
  return state;
}

int TabState::IdOf(content::WebContents* contents) {
  return sessions::SessionTabHelper::IdForTab(contents).id();
}

void TabState::WatchOpeningBlank(int64_t navigation_id) {
  opening_navigation_id_ = navigation_id;
  content::NavigationController& controller = web_contents()->GetController();
  content::NavigationEntry* committed = controller.GetLastCommittedEntry();
  if (!navigation_id && controller.GetEntryCount() == 1 && committed &&
      !committed->IsInitialEntry() && committed->GetURL().IsAboutBlank()) {
    opening_entry_id_ = committed->GetUniqueID();
  }
}

bool TabState::IsOpeningBlank(const content::NavigationEntry* entry) const {
  return entry && opening_entry_id_ && entry->GetUniqueID() == opening_entry_id_;
}

bool TabState::OnlyShowedOpeningBlank() const {
  content::NavigationController& controller = web_contents()->GetController();
  return controller.GetEntryCount() == 1 &&
         IsOpeningBlank(controller.GetLastCommittedEntry());
}

GURL TabState::CommittedPageURL(content::WebContents* contents) {
  content::NavigationEntry* committed =
      contents->GetController().GetLastCommittedEntry();
  if (!committed || committed->IsInitialEntry()) {
    return GURL();
  }
  TabState* state = TabState::FromWebContents(contents);
  if (state && state->IsOpeningBlank(committed)) {
    return GURL();
  }
  return committed->GetURL();
}

void TabState::Send(std::string_view name, base::DictValue data) {
  if (key_.empty()) {
    return;
  }
  base::DictValue payload;
  payload.Set("key", key_);
  payload.Set("name", name);
  payload.Set("data", std::move(data));
  Emit("tab", std::move(payload));
}

void TabState::NoteNavigation() {
  if (navigation_pending_) {
    return;
  }
  navigation_pending_ = true;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&TabState::SendNavigation,
                                weak_factory_.GetWeakPtr()));
}

void TabState::SendNavigation() {
  navigation_pending_ = false;
  content::WebContents* contents = web_contents();
  if (!contents) {
    return;
  }
  content::NavigationController& controller = contents->GetController();
  const bool no_page = left_by_download_ && !contents->IsLoading();
  base::DictValue data;
  data.Set("url", no_page ? std::string() : contents->GetVisibleURL().spec());
  data.Set("title",
           no_page ? std::string() : base::UTF16ToUTF8(contents->GetTitle()));
  data.Set("canGoBack", controller.CanGoBack());
  data.Set("canGoForward", controller.CanGoForward());
  data.Set("isLoading", contents->ShouldShowLoadingUI());
  data.Set("committedUrl", contents->GetLastCommittedURL().spec());
  if (http_status_) {
    data.Set("httpStatus", http_status_);
  }
  if (std::optional<SkColor> color = contents->GetThemeColor()) {
    data.Set("themeColor",
             base::StringPrintf("#%02x%02x%02x", SkColorGetR(*color),
                                SkColorGetG(*color), SkColorGetB(*color)));
    data.Set("themeColorSource", "meta");
  } else {
    data.Set("themeColor", base::Value());
    data.Set("themeColorSource", base::Value());
  }
  Send("navigation", std::move(data));
}

void TabState::SendMedia() {
  content::WebContents* contents = web_contents();
  if (!contents) {
    return;
  }
  Send("media", TabEvents::MediaState(contents));
}

void TabState::DidStartNavigation(content::NavigationHandle* handle) {
  if (handle->IsInPrimaryMainFrame()) {
    left_by_download_ = false;
    NoteNavigation();
  }
}

void TabState::DidFinishNavigation(content::NavigationHandle* handle) {
  if (handle->HasCommitted() && !handle->IsSameDocument()) {
    if (PageLinks* links = PageLinks::FromWebContents(web_contents())) {
      links->FrameCommitted(handle->GetRenderFrameHost());
    }
  }
  if (!handle->IsInPrimaryMainFrame()) {
    return;
  }
  if (handle->HasCommitted() && !handle->IsSameDocument()) {
    const net::HttpResponseHeaders* headers = handle->GetResponseHeaders();
    http_status_ = headers ? headers->response_code() : 0;
  }
  if (opening_navigation_id_ &&
      handle->GetNavigationId() == opening_navigation_id_) {
    content::NavigationEntry* entry = handle->GetNavigationEntry();
    if (handle->HasCommitted() && entry && entry->GetURL().IsAboutBlank()) {
      opening_entry_id_ = entry->GetUniqueID();
    }
    opening_navigation_id_ = 0;
  }
  if (handle->HasCommitted() && handle->IsErrorPage()) {
    base::DictValue data;
    data.Set("url", handle->GetURL().spec());
    data.Set("code", static_cast<int>(handle->GetNetErrorCode()));
    data.Set("text", net::ErrorToShortString(handle->GetNetErrorCode()));
    Send("loadError", std::move(data));
  }
  left_by_download_ = handle->IsDownload() &&
                      CommittedPageURL(web_contents()).is_empty();
  NoteNavigation();
}

void TabState::DidOpenRequestedURL(
    content::WebContents* new_contents,
    content::RenderFrameHost* source_render_frame_host,
    const GURL& url,
    const content::Referrer& referrer,
    WindowOpenDisposition disposition,
    ui::PageTransition transition,
    bool started_from_context_menu,
    bool renderer_initiated) {
  if (new_contents && new_contents != web_contents() && renderer_initiated &&
      !tabs::TabInterface::MaybeGetFromContents(new_contents)) {
    OpenRequest::Note(new_contents);
  }
}

void TabState::DidStartLoading() {
  NoteNavigation();
}

void TabState::DidStopLoading() {
  NoteNavigation();
}

void TabState::LoadProgressChanged(double progress) {
  base::DictValue data;
  data.Set("progress", progress);
  Send("progress", std::move(data));
}

void TabState::TitleWasSet(content::NavigationEntry* entry) {
  NoteNavigation();
}

void TabState::DidChangeThemeColor() {
  NoteNavigation();
}

void TabState::NavigationListPruned(
    const content::PrunedDetails& pruned_details) {
  NoteNavigation();
}

void TabState::NavigationEntriesDeleted() {
  NoteNavigation();
}

void TabState::OnAudioStateChanged(bool audible) {}

void TabState::DidUpdateAudioMutingState(bool muted) {
  SendMedia();
}

void TabState::OnWebContentsFocused(
    content::RenderWidgetHost* render_widget_host) {
  Send("focus", base::DictValue());
}

void TabState::PrimaryMainFrameRenderProcessGone(
    base::TerminationStatus status) {
  if (status == base::TERMINATION_STATUS_NORMAL_TERMINATION ||
      status == base::TERMINATION_STATUS_STILL_RUNNING) {
    return;
  }
  base::DictValue data;
  data.Set("status", static_cast<int>(status));
  Send("crashed", std::move(data));
}

void TabState::WebContentsDestroyed() {
  favicon_observation_.Reset();
  Host::Get()->TabDestroyed(this);
}

void TabState::OnFaviconUpdated(favicon::FaviconDriver* favicon_driver,
                                NotificationIconType notification_icon_type,
                                const GURL& icon_url,
                                bool icon_url_changed,
                                const gfx::Image& image) {
  if (!icon_url.is_valid()) {
    return;
  }
  base::DictValue data;
  data.Set("url", icon_url.spec());
  base::ListValue urls;
  urls.Append(icon_url.spec());
  data.Set("urls", std::move(urls));
  Send("favicon", std::move(data));
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(TabState);

}
