#include "ardia/win/page_links.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <utility>

#include "ardia/win/host.h"
#include "ardia/win/page_links_script.h"
#include "ardia/win/tab_state.h"
#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/functional/callback_helpers.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/time/time.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "ui/events/event.h"
#include "ui/events/event_constants.h"
#include "ui/events/types/event_type.h"
#include "url/origin.h"

namespace ardia_win {

namespace {

constexpr char kWorld[] = "ardia-links";
constexpr char kBinding[] = "ardiaPeekSend";
constexpr char kOtherSiteKey[] = "site";
constexpr int kAlt = 1;
constexpr int kShift = 2;
constexpr int kControl = 4;
constexpr int kMeta = 8;
constexpr base::TimeDelta kGestureLifetime = base::Seconds(10);
constexpr base::TimeDelta kFallbackLifetime = base::Seconds(60);
constexpr size_t kLongestUrl = 8192;
constexpr base::TimeDelta kNewTabLinkLifetime = base::Seconds(2);
constexpr size_t kNewTabLinksKept = 4;

struct LinkKeys {
  std::string peek = "shift";
  std::string split = "altShift";
  std::set<std::string> other_site_pages;
};

struct MouseUp {
  int keys = 0;
  std::optional<base::TimeTicks> at;
  std::string page;
  gfx::PointF point;
  uint64_t seq = 0;
  uint64_t used_seq = 0;
  bool pressed_since = false;
};

LinkKeys& Keys() {
  static base::NoDestructor<LinkKeys> keys;
  return *keys;
}

MouseUp& LastUp() {
  static base::NoDestructor<MouseUp> up;
  return *up;
}

std::set<PageLinks*>& Live() {
  static base::NoDestructor<std::set<PageLinks*>> live;
  return *live;
}

int KeysOf(int flags) {
  int keys = 0;
  if (flags & ui::EF_ALT_DOWN) {
    keys |= kAlt;
  }
  if (flags & ui::EF_SHIFT_DOWN) {
    keys |= kShift;
  }
  if (flags & ui::EF_CONTROL_DOWN) {
    keys |= kControl;
  }
  if (flags & ui::EF_COMMAND_DOWN) {
    keys |= kMeta;
  }
  return keys;
}

int LinkKeyFlags(const std::string& key) {
  if (key == "alt") {
    return kAlt;
  }
  if (key == "shift") {
    return kShift;
  }
  if (key == "altShift") {
    return kAlt | kShift;
  }
  if (key == "altMeta") {
    return kAlt | kMeta;
  }
  return 0;
}

std::string SplitLinkKey() {
  return Keys().split == "alt" && Keys().peek != "alt" ? "alt" : "altShift";
}

std::string LinkKeyAction(const std::string& key) {
  if (!LinkKeyFlags(key)) {
    return "";
  }
  if (key == Keys().peek) {
    return "peek";
  }
  if (key == "altShift" || key == "altMeta" || key == SplitLinkKey()) {
    return "split";
  }
  return "";
}

std::string Field(const base::DictValue& dict,
                  std::string_view key,
                  size_t longest) {
  const std::string* value = dict.FindString(key);
  if (!value || value->size() > longest) {
    return "";
  }
  return *value;
}

bool Finite(const base::DictValue& dict, std::string_view key, double* out) {
  std::optional<double> value = dict.FindDouble(key);
  if (!value || !std::isfinite(*value)) {
    return false;
  }
  *out = *value;
  return true;
}

bool Web(const GURL& url) {
  return url.is_valid() && url.SchemeIsHTTPOrHTTPS();
}

bool Scriptable(const GURL& url) {
  return Web(url) || url.SchemeIsFile();
}

base::DictValue PointValue(gfx::PointF point) {
  base::DictValue value;
  value.Set("x", point.x());
  value.Set("y", point.y());
  return value;
}

}

PageLinks::PageLinks(content::WebContents* contents)
    : content::WebContentsUserData<PageLinks>(*contents) {
  Live().insert(this);
}

PageLinks::~PageLinks() {
  Live().erase(this);
  if (host_) {
    host_->DetachClient(this);
  }
}

void PageLinks::Watch(content::WebContents* contents) {
  if (PageLinks::FromWebContents(contents)) {
    return;
  }
  PageLinks::CreateForWebContents(contents);
  PageLinks* links = PageLinks::FromWebContents(contents);
  contents->GetPrimaryMainFrame()->ForEachRenderFrameHost(
      [links](content::RenderFrameHost* frame) {
        links->FrameCommitted(frame);
      });
}

void PageLinks::Configure(const base::DictValue& args) {
  if (const std::string* peek = args.FindString("peek")) {
    Keys().peek = *peek == "alt" || *peek == "shift" ? *peek : "off";
  }
  if (const std::string* split = args.FindString("split")) {
    Keys().split = *split == "alt" ? "alt" : "altShift";
  }
  if (const base::ListValue* pages = args.FindList("otherSitePages")) {
    Keys().other_site_pages.clear();
    for (const base::Value& page : *pages) {
      if (page.is_string()) {
        Keys().other_site_pages.insert(page.GetString());
      }
    }
  }
  for (PageLinks* links : Live()) {
    links->PushConfig();
  }
}

base::DictValue PageLinks::Config() {
  base::DictValue config;
  config.Set("peek", Keys().peek);
  config.Set("split", SplitLinkKey());
  base::ListValue pages;
  for (const std::string& page : Keys().other_site_pages) {
    pages.Append(page);
  }
  config.Set("otherSitePages", std::move(pages));
  return config;
}

void PageLinks::NoteMouse(const ui::MouseEvent& event,
                          const std::string& page) {
  if (!(event.changed_button_flags() & ui::EF_LEFT_MOUSE_BUTTON)) {
    return;
  }
  MouseUp& up = LastUp();
  if (event.type() == ui::EventType::kMousePressed) {
    up.pressed_since = true;
    return;
  }
  if (event.type() != ui::EventType::kMouseReleased) {
    return;
  }
  up.keys = KeysOf(event.flags());
  up.at = base::TimeTicks::Now();
  up.page = page;
  up.point = event.root_location_f();
  up.pressed_since = false;
  ++up.seq;
}

std::optional<gfx::PointF> PageLinks::RecentClickPoint(
    const std::string& page) {
  const MouseUp& up = LastUp();
  if (page.empty() || up.page != page || !up.at ||
      base::TimeTicks::Now() - *up.at > kGestureLifetime) {
    return std::nullopt;
  }
  return up.point;
}

void PageLinks::FrameCommitted(content::RenderFrameHost* frame) {
  if (!frame) {
    return;
  }
  const content::GlobalRenderFrameHostId id = frame->GetGlobalId();
  std::erase_if(contexts_, [&id](const auto& entry) {
    return entry.second.frame == id;
  });
  if (!Scriptable(frame->GetLastCommittedURL()) ||
      !frame->IsRenderFrameLive()) {
    return;
  }
  Install(frame);
}

bool PageLinks::Attach() {
  if (host_) {
    return true;
  }
  host_ = content::DevToolsAgentHost::GetOrCreateFor(&GetWebContents());
  if (!host_ || !host_->AttachClient(this)) {
    host_ = nullptr;
    return false;
  }
  return true;
}

void PageLinks::Install(content::RenderFrameHost* frame) {
  if (!Attach()) {
    return;
  }
  base::DictValue params;
  params.Set("frameId", frame->GetDevToolsFrameToken().ToString());
  params.Set("worldName", kWorld);
  params.Set("grantUniveralAccess", false);
  Call("Page.createIsolatedWorld", std::move(params),
       base::BindOnce(&PageLinks::WorldMade, weak_factory_.GetWeakPtr(),
                      frame->GetGlobalId(), frame->IsInPrimaryMainFrame()));
}

void PageLinks::WorldMade(content::GlobalRenderFrameHostId frame,
                          bool main,
                          std::optional<base::DictValue> world) {
  std::optional<int> context =
      world ? world->FindInt("executionContextId") : std::nullopt;
  if (!context) {
    return;
  }
  base::DictValue params;
  params.Set("name", kBinding);
  params.Set("executionContextId", *context);
  Call("Runtime.addBinding", std::move(params),
       base::BindOnce(&PageLinks::BindingAdded, weak_factory_.GetWeakPtr(),
                      frame, main, *context));
}

void PageLinks::BindingAdded(content::GlobalRenderFrameHostId frame,
                             bool main,
                             int context,
                             std::optional<base::DictValue> added) {
  if (!added || !content::RenderFrameHost::FromID(frame)) {
    return;
  }
  contexts_[context] = Context{frame, main};
  Evaluate(context, std::string(kLinkScript) + "\nardiaPeek.config(" +
                        ConfigJson() + ");");
}

void PageLinks::Call(const std::string& method,
                     base::DictValue params,
                     Answer answer) {
  if (!Attach()) {
    std::move(answer).Run(std::nullopt);
    return;
  }
  const int id = next_id_++;
  base::DictValue message;
  message.Set("id", id);
  message.Set("method", method);
  message.Set("params", std::move(params));
  std::optional<std::string> json = base::WriteJson(message);
  if (!json) {
    std::move(answer).Run(std::nullopt);
    return;
  }
  pending_[id] = std::move(answer);
  scoped_refptr<content::DevToolsAgentHost> host = host_;
  host->DispatchProtocolMessage(this, base::as_byte_span(*json));
}

void PageLinks::Evaluate(int context, const std::string& expression) {
  base::DictValue params;
  params.Set("expression", expression);
  params.Set("contextId", context);
  params.Set("silent", true);
  Call("Runtime.evaluate", std::move(params), base::DoNothing());
}

void PageLinks::DispatchProtocolMessage(content::DevToolsAgentHost* agent_host,
                                        base::span<const uint8_t> message) {
  std::optional<base::DictValue> parsed = base::JSONReader::ReadDict(
      base::as_string_view(message), base::JSON_PARSE_CHROMIUM_EXTENSIONS);
  if (!parsed) {
    return;
  }
  if (std::optional<int> id = parsed->FindInt("id")) {
    auto it = pending_.find(*id);
    if (it == pending_.end()) {
      return;
    }
    Answer answer = std::move(it->second);
    pending_.erase(it);
    if (parsed->FindDict("error")) {
      std::move(answer).Run(std::nullopt);
      return;
    }
    base::DictValue* result = parsed->FindDict("result");
    std::move(answer).Run(result ? std::move(*result) : base::DictValue());
    return;
  }
  const std::string* method = parsed->FindString("method");
  const base::DictValue* params = parsed->FindDict("params");
  if (!method || !params || *method != "Runtime.bindingCalled") {
    return;
  }
  const std::string* name = params->FindString("name");
  const std::string* payload = params->FindString("payload");
  std::optional<int> context = params->FindInt("executionContextId");
  if (!name || *name != kBinding || !payload || !context) {
    return;
  }
  Heard(*context, *payload);
}

void PageLinks::AgentHostClosed(content::DevToolsAgentHost* agent_host) {
  host_ = nullptr;
  contexts_.clear();
  std::map<int, Answer> pending = std::move(pending_);
  pending_.clear();
  for (auto& entry : pending) {
    std::move(entry.second).Run(std::nullopt);
  }
}

bool PageLinks::MayAttachToURL(const GURL& url, bool is_webui) {
  return true;
}

bool PageLinks::IsTrusted() {
  return true;
}

bool PageLinks::MayReadLocalFiles() {
  return false;
}

std::string PageLinks::PageKey() {
  TabState* state = TabState::FromWebContents(&GetWebContents());
  return state ? state->key() : std::string();
}

bool PageLinks::PeeksOtherSites() {
  const std::string key = PageKey();
  return !key.empty() && Keys().other_site_pages.contains(key);
}

std::string PageLinks::ConfigJson() {
  base::DictValue config;
  config.Set("modifier", Keys().peek);
  config.Set("split", SplitLinkKey());
  config.Set("otherSites", PeeksOtherSites());
  return base::WriteJson(config).value_or("{}");
}

void PageLinks::PushConfig() {
  const std::string call = "ardiaPeek.config(" + ConfigJson() + ");";
  for (const auto& entry : contexts_) {
    Evaluate(entry.first, call);
  }
}

void PageLinks::Heard(int context, const std::string& payload) {
  auto found = contexts_.find(context);
  if (found == contexts_.end() ||
      !content::RenderFrameHost::FromID(found->second.frame)) {
    return;
  }
  std::optional<base::DictValue> message =
      base::JSONReader::ReadDict(payload, base::JSON_PARSE_RFC);
  if (!message) {
    return;
  }
  const std::string* kind = message->FindString("kind");
  const base::DictValue* data = message->FindDict("data");
  if (kind && data && *kind == "peek") {
    PeekLink(*data, context, found->second.main);
  } else if (kind && data && *kind == "newTabLink") {
    NoteNewTabLink(*data);
  }
}

void PageLinks::NoteNewTabLink(const base::DictValue& data) {
  const GURL url(Field(data, "url", kLongestUrl));
  if (!Web(url)) {
    return;
  }
  DropStaleNewTabLinks();
  new_tab_links_.push_back(NewTabLink{url, base::TimeTicks::Now()});
  if (new_tab_links_.size() > kNewTabLinksKept) {
    new_tab_links_.erase(new_tab_links_.begin());
  }
}

void PageLinks::DropStaleNewTabLinks() {
  const base::TimeTicks now = base::TimeTicks::Now();
  std::erase_if(new_tab_links_, [now](const NewTabLink& link) {
    return now - link.at > kNewTabLinkLifetime;
  });
}

bool PageLinks::TakeNewTabLink(const std::vector<GURL>& urls) {
  DropStaleNewTabLinks();
  for (auto it = new_tab_links_.begin(); it != new_tab_links_.end(); ++it) {
    if (std::find(urls.begin(), urls.end(), it->url) != urls.end()) {
      new_tab_links_.erase(it);
      return true;
    }
  }
  return false;
}

void PageLinks::PeekLink(const base::DictValue& data, int context, bool main) {
  const GURL url(Field(data, "url", kLongestUrl));
  const std::string key = Field(data, "key", 8);
  const bool other_site = key == kOtherSiteKey;
  const std::string action =
      other_site ? (PeeksOtherSites() ? "peek" : "") : LinkKeyAction(key);
  const std::string page = PageKey();
  MouseUp& up = LastUp();
  const base::TimeTicks now = base::TimeTicks::Now();
  std::string refused;
  if (action.empty()) {
    refused = "that key opens nothing now";
  } else if (other_site && !main) {
    refused = "only the page itself peeks links to other sites";
  } else if (page.empty() || !Host::Get()->Shows(page)) {
    refused = "page not shown";
  } else if (!Web(url)) {
    refused = "not http(s)";
  } else if (!up.at) {
    refused = "no left mouse-up yet";
  } else if (up.seq == up.used_seq) {
    refused = "that mouse-up already opened a peek";
  } else if (up.pressed_since) {
    refused = "the mouse was pressed again since that mouse-up";
  } else if (now - *up.at > kGestureLifetime) {
    refused = "the last mouse-up is too old";
  } else if (up.page != page) {
    refused = "the mouse-up wasn't over this page";
  } else if (up.keys != (other_site ? 0 : LinkKeyFlags(key))) {
    refused = "the mouse-up's keys aren't the page's key alone";
  }
  if (!refused.empty()) {
    LOG(WARNING) << "[ardia links] no peek: " << refused;
    FallBack(data, url, context, refused);
    return;
  }
  up.used_seq = up.seq;
  if (action == "split") {
    base::DictValue payload;
    payload.Set("url", url.spec());
    payload.Set("disposition", "split");
    payload.Set("userGesture", true);
    OpenWindow(std::move(payload));
    return;
  }
  gfx::PointF point = up.point;
  double x = 0;
  double y = 0;
  if (main && Finite(data, "x", &x) && Finite(data, "y", &y)) {
    content::RenderWidgetHostView* view =
        GetWebContents().GetRenderWidgetHostView();
    const float scale =
        view && view->GetDeviceScaleFactor() > 0 ? view->GetDeviceScaleFactor()
                                                 : 1;
    point = gfx::PointF(x / scale, y / scale);
  }
  base::DictValue payload;
  payload.Set("url", url.spec());
  payload.Set("disposition", "peek");
  payload.Set("userGesture", true);
  payload.Set("site", other_site);
  payload.Set("point", PointValue(ClampedToPage(point)));
  OpenWindow(std::move(payload));
}

void PageLinks::FallBack(const base::DictValue& data,
                         const GURL& url,
                         int context,
                         const std::string& reason) {
  const std::string key = Field(data, "key", 8);
  if (key == kOtherSiteKey) {
    base::DictValue refusal;
    refusal.Set("url", url.spec());
    refusal.Set("reason", reason);
    refusal.Set("follow", true);
    Refuse(context, std::move(refusal));
    return;
  }
  const int page_flag = LinkKeyFlags(key);
  const bool split = LinkKeyAction(key) == "split";
  MouseUp& up = LastUp();
  const bool fresh = up.at &&
                     base::TimeTicks::Now() - *up.at <= kFallbackLifetime &&
                     !up.pressed_since;
  const bool user_clicked = fresh && up.seq != up.used_seq &&
                            up.page == PageKey() && up.keys == page_flag;
  if (split && user_clicked) {
    up.used_seq = up.seq;
  }
  if (split || !page_flag || !Web(url) || !user_clicked) {
    return;
  }
  up.used_seq = up.seq;
  if (page_flag == kShift) {
    base::DictValue payload;
    payload.Set("url", url.spec());
    payload.Set("disposition", "window");
    payload.Set("userGesture", true);
    OpenWindow(std::move(payload));
    return;
  }
  const GURL origin(Field(data, "origin", 1024));
  if (origin.is_valid() &&
      url::Origin::Create(origin).IsSameOriginWith(url::Origin::Create(url))) {
    base::DictValue refusal;
    refusal.Set("url", url.spec());
    refusal.Set("reason", reason);
    refusal.Set("download", true);
    Refuse(context, std::move(refusal));
    return;
  }
  base::DictValue payload;
  payload.Set("url", url.spec());
  payload.Set("disposition", "background");
  payload.Set("userGesture", true);
  OpenWindow(std::move(payload));
}

void PageLinks::Refuse(int context, base::DictValue refusal) {
  Evaluate(context, "ardiaPeek.refused(" +
                        base::WriteJson(refusal).value_or("null") + ");");
}

void PageLinks::OpenWindow(base::DictValue payload) {
  if (TabState* state = TabState::FromWebContents(&GetWebContents())) {
    state->Send("openWindow", std::move(payload));
  }
}

gfx::PointF PageLinks::ClampedToPage(gfx::PointF point) {
  content::RenderWidgetHostView* view =
      GetWebContents().GetRenderWidgetHostView();
  if (!view) {
    return point;
  }
  const gfx::Size size = view->GetViewBounds().size();
  return gfx::PointF(
      std::clamp(point.x(), 0.0f, static_cast<float>(size.width())),
      std::clamp(point.y(), 0.0f, static_cast<float>(size.height())));
}

OpenRequest::OpenRequest(content::WebContents* contents)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<OpenRequest>(*contents) {}

OpenRequest::~OpenRequest() = default;

void OpenRequest::Note(content::WebContents* opened) {
  if (opened && !OpenRequest::FromWebContents(opened)) {
    OpenRequest::CreateForWebContents(opened);
  }
}

void OpenRequest::DidStartNavigation(content::NavigationHandle* handle) {
  if (started_ || !handle->IsInPrimaryMainFrame() || !Web(handle->GetURL())) {
    return;
  }
  started_ = true;
  gesture_ = handle->HasUserGesture();
  form_ = handle->IsFormSubmission();
  url_ = handle->GetURL();
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(PageLinks);
WEB_CONTENTS_USER_DATA_KEY_IMPL(OpenRequest);

}
