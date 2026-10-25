#include "ardia/core/ac_navigation_routing.h"

#import <Foundation/Foundation.h>

#include <algorithm>
#include <utility>

#include "base/auto_reset.h"
#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/string_util.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/navigator/browser_navigator.h"
#include "chrome/browser/ui/navigator/browser_navigator_params.h"
#include "components/webapps/browser/navigation_data.h"
#include "content/common/frame.mojom.h"
#include "content/public/browser/document_user_data.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_handle_user_data.h"
#include "content/public/browser/navigation_throttle.h"
#include "content/public/browser/navigation_throttle_registry.h"
#include "content/public/browser/page_navigator.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/site_instance.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "content/public/common/referrer_type_converters.h"
#include "net/base/schemeful_site.h"
#include "ui/base/page_transition_types.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "ardia/core/ac_browser.h"
#include "ardia/core/ardiacore_internal.h"

namespace ardiacore {

namespace {

constexpr std::string_view kHttp = "http://";
constexpr std::string_view kHttps = "https://";
constexpr std::string_view kFile = "file:";

bool StartsWithASCII(std::string_view text, std::string_view prefix) {
  return base::StartsWith(text, prefix, base::CompareCase::INSENSITIVE_ASCII);
}

bool IsWebURL(std::string_view url) {
  return StartsWithASCII(url, kHttp) || StartsWithASCII(url, kHttps);
}

std::string EqualsForm(std::string_view text) {
  std::string form = base::ToLowerASCII(text);
  for (std::string_view scheme : {kHttp, kHttps}) {
    if (form.starts_with(scheme)) {
      form.erase(0, scheme.size());
      break;
    }
  }
  if (const size_t cut = form.find_first_of("?#"); cut != std::string::npos) {
    form.resize(cut);
  }
  if (!form.empty() && form.back() == '/') {
    form.pop_back();
  }
  return form;
}

std::string Text(id value) {
  return [value isKindOfClass:NSString.class] ? base::SysNSStringToUTF8(value) : std::string();
}

std::optional<LinkDestination> DestinationFrom(id value) {
  if (![value isKindOfClass:NSDictionary.class]) {
    return std::nullopt;
  }
  const std::string kind = Text(value[@"kind"]);
  LinkDestination destination;
  if (kind == "little") {
    destination.kind = LinkDestination::Kind::kLittle;
  } else if (kind == "recent") {
    destination.kind = LinkDestination::Kind::kRecent;
  } else if (kind == "profile") {
    destination.kind = LinkDestination::Kind::kSidebar;
    destination.sidebar = Text(value[@"profileId"]);
    if (destination.sidebar.empty()) {
      return std::nullopt;
    }
  } else {
    return std::nullopt;
  }
  return destination;
}

LinkRouting RoutingFrom(NSDictionary* config) {
  LinkRouting routing;
  NSDictionary* profiles = [config[@"profiles"] isKindOfClass:NSDictionary.class] ? config[@"profiles"] : @{};
  for (id sidebar in profiles) {
    if ([sidebar isKindOfClass:NSString.class] && [profiles[sidebar] isKindOfClass:NSString.class]) {
      routing.engines[base::SysNSStringToUTF8(sidebar)] = base::SysNSStringToUTF8(profiles[sidebar]);
    }
  }
  routing.recent = Text(config[@"recent"]);
  NSArray* rules = [config[@"rules"] isKindOfClass:NSArray.class] ? config[@"rules"] : @[];
  for (id value in rules) {
    if (![value isKindOfClass:NSDictionary.class]) {
      continue;
    }
    const std::string match = Text(value[@"match"]);
    if (match != "contains" && match != "equals") {
      continue;
    }
    const std::string text = Text(value[@"text"]);
    std::optional<LinkDestination> destination = DestinationFrom(value[@"destination"]);
    if (base::TrimWhitespaceASCII(text, base::TRIM_ALL).empty() || !destination ||
        (destination->kind == LinkDestination::Kind::kSidebar && !routing.engines.contains(destination->sidebar))) {
      continue;
    }
    LinkRule rule;
    rule.equals = match == "equals";
    rule.text = rule.equals ? EqualsForm(text) : base::ToLowerASCII(text);
    if (rule.text.empty()) {
      continue;
    }
    rule.destination = std::move(*destination);
    routing.rules.push_back(std::move(rule));
  }
  std::optional<LinkDestination> fallback = DestinationFrom(config[@"defaultDestination"]);
  routing.default_destination = fallback.value_or(LinkDestination());
  if (routing.default_destination.kind == LinkDestination::Kind::kSidebar &&
      !routing.engines.contains(routing.default_destination.sidebar)) {
    routing.default_destination = {LinkDestination::Kind::kRecent, std::string()};
  }
  return routing;
}

std::shared_ptr<const LinkRouting>& Installed() {
  static base::NoDestructor<std::shared_ptr<const LinkRouting>> routing(std::make_shared<LinkRouting>());
  return *routing;
}

bool g_live_routing = false;

const std::string* EngineOf(const LinkRouting& routing, const std::string& sidebar) {
  auto it = routing.engines.find(sidebar);
  return it == routing.engines.end() ? nullptr : &it->second;
}

class LinkIdentity : public content::WebContentsUserData<LinkIdentity> {
 public:
  ~LinkIdentity() override = default;

  std::string sidebar;
  std::optional<RoutedPlacement> placement;

 private:
  friend class content::WebContentsUserData<LinkIdentity>;
  explicit LinkIdentity(content::WebContents* contents)
      : content::WebContentsUserData<LinkIdentity>(*contents) {}
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(LinkIdentity);

LinkIdentity* IdentityFor(content::WebContents* contents) {
  LinkIdentity::CreateForWebContents(contents);
  return LinkIdentity::FromWebContents(contents);
}

void SeedPlacement(content::WebContents* contents, const RoutedPlacement& placement) {
  LinkIdentity* identity = IdentityFor(contents);
  identity->sidebar = placement.sidebar;
  identity->placement = placement;
}

WindowOpenDisposition PlacementDisposition(WindowOpenDisposition disposition) {
  switch (disposition) {
    case WindowOpenDisposition::NEW_BACKGROUND_TAB:
    case WindowOpenDisposition::NEW_WINDOW:
    case WindowOpenDisposition::NEW_POPUP:
      return disposition;
    default:
      return WindowOpenDisposition::NEW_FOREGROUND_TAB;
  }
}

bool RoutableDisposition(WindowOpenDisposition disposition) {
  switch (disposition) {
    case WindowOpenDisposition::CURRENT_TAB:
    case WindowOpenDisposition::NEW_FOREGROUND_TAB:
    case WindowOpenDisposition::NEW_BACKGROUND_TAB:
    case WindowOpenDisposition::NEW_WINDOW:
    case WindowOpenDisposition::NEW_POPUP:
      return true;
    default:
      return false;
  }
}

WindowHost* HostOf(content::WebContents* contents) {
  return WindowHost::ForBrowser(GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents));
}

std::optional<LinkDecision> DecidePage(content::WebContents* source, std::string_view url) {
  if (Profile::FromBrowserContext(source->GetBrowserContext())->IsOffTheRecord()) {
    return LinkDecision();
  }
  const std::string sidebar = TabSidebar(source);
  if (sidebar.empty()) {
    return LinkDecision();
  }
  return DecideLink(*InstalledLinkRouting(), url, LinkOrigin::kPage, sidebar);
}

struct RoutedOwner {
  base::WeakPtr<WindowHost> host;
  std::string sidebar;

  bool Owns(content::WebContents* source) const {
    WindowHost* current = host.get();
    return source && current && !current->closing() && HostOf(source) == current && TabSidebar(source) == sidebar;
  }
};

std::optional<RoutedOwner> OwnerOf(content::WebContents* source) {
  WindowHost* host = HostOf(source);
  if (!host || host->closing()) {
    return std::nullopt;
  }
  return RoutedOwner{host->GetWeakPtr(), TabSidebar(source)};
}

class RoutedOpen {
 public:
  RoutedOpen(content::WebContents* source,
             RoutedOwner owner,
             LinkDecision decision,
             RoutedPlacement placement,
             content::OpenURLParams params,
             blink::mojom::WindowFeatures features,
             base::ScopedClosureRunner fullscreen_block,
             std::optional<content::WeakDocumentPtr> source_document = std::nullopt)
      : source_(source->GetWeakPtr()),
        owner_(std::move(owner)),
        decision_(std::move(decision)),
        placement_(std::move(placement)),
        params_(std::move(params)),
        features_(std::move(features)),
        fullscreen_block_(std::move(fullscreen_block)),
        source_document_(std::move(source_document)) {}
  RoutedOpen(const RoutedOpen&) = delete;
  RoutedOpen& operator=(const RoutedOpen&) = delete;

  base::WeakPtr<RoutedOpen> GetWeakPtr() { return weak_factory_.GetWeakPtr(); }

  void LoadProfile();

 private:
  std::unique_ptr<RoutedOpen> Release();
  bool SourceCurrent(content::WebContents* source) const;
  void ProfileReady(Profile* profile);
  void Open(content::WebContents* source, Profile* profile);

  base::WeakPtr<content::WebContents> source_;
  RoutedOwner owner_;
  LinkDecision decision_;
  RoutedPlacement placement_;
  content::OpenURLParams params_;
  blink::mojom::WindowFeatures features_;
  base::ScopedClosureRunner fullscreen_block_;
  std::optional<content::WeakDocumentPtr> source_document_;
  base::WeakPtrFactory<RoutedOpen> weak_factory_{this};
};

class RoutedOpens : public content::WebContentsUserData<RoutedOpens>,
                    public content::WebContentsObserver {
 public:
  ~RoutedOpens() override = default;

  RoutedOpen* Add(std::unique_ptr<RoutedOpen> open) {
    opens_.push_back(std::move(open));
    return opens_.back().get();
  }

  std::unique_ptr<RoutedOpen> Take(RoutedOpen* open) {
    auto it = std::find_if(opens_.begin(), opens_.end(),
                           [open](const std::unique_ptr<RoutedOpen>& each) { return each.get() == open; });
    if (it == opens_.end()) {
      return nullptr;
    }
    std::unique_ptr<RoutedOpen> taken = std::move(*it);
    opens_.erase(it);
    return taken;
  }

  void CancelAll() { opens_.clear(); }

  void DidFinishNavigation(content::NavigationHandle* handle) override {
    if (handle->IsInPrimaryMainFrame() && handle->HasCommitted() && !handle->IsSameDocument()) {
      CancelAll();
    }
  }

 private:
  friend class content::WebContentsUserData<RoutedOpens>;
  explicit RoutedOpens(content::WebContents* contents)
      : content::WebContentsUserData<RoutedOpens>(*contents),
        content::WebContentsObserver(contents) {}

  std::vector<std::unique_ptr<RoutedOpen>> opens_;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(RoutedOpens);

void StartRoutedOpen(content::WebContents* source, std::unique_ptr<RoutedOpen> open) {
  RoutedOpens::CreateForWebContents(source);
  RoutedOpen* added = RoutedOpens::FromWebContents(source)->Add(std::move(open));
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&RoutedOpen::LoadProfile, added->GetWeakPtr()));
}

std::unique_ptr<RoutedOpen> RoutedOpen::Release() {
  content::WebContents* source = source_.get();
  RoutedOpens* opens = source ? RoutedOpens::FromWebContents(source) : nullptr;
  return opens ? opens->Take(this) : nullptr;
}

bool RoutedOpen::SourceCurrent(content::WebContents* source) const {
  return owner_.Owns(source) &&
         (!source_document_ || source_document_->AsRenderFrameHostIfValid() == source->GetPrimaryMainFrame());
}

void RoutedOpen::LoadProfile() {
  if (!SourceCurrent(source_.get())) {
    Release();
    return;
  }
  LoadLinkProfile(decision_.engine, base::BindOnce(&RoutedOpen::ProfileReady, GetWeakPtr()));
}

void RoutedOpen::ProfileReady(Profile* profile) {
  std::unique_ptr<RoutedOpen> self = Release();
  content::WebContents* source = source_.get();
  if (!self || !SourceCurrent(source)) {
    return;
  }
  const std::string* engine = EngineOf(*InstalledLinkRouting(), decision_.sidebar);
  if (!profile || profile->IsOffTheRecord() || IsProfileDying(profile) || IsProfileDeleting(profile) || !engine ||
      *engine != decision_.engine || !source->GetDelegate()) {
    return;
  }
  Open(source, profile);
}

void RoutedOpen::Open(content::WebContents* source, Profile* profile) {
  WindowHost* host = owner_.host.get();
  Browser* browser = host->BrowserFor(profile);
  if (!browser) {
    return;
  }
  NavigateParams navigate(browser, params_.url, params_.transition);
  navigate.FillNavigateParamsFromOpenURLParams(params_);
  navigate.source_contents = source;
  navigate.frame_tree_node_id = content::FrameTreeNodeId();
  navigate.disposition = placement_.disposition == WindowOpenDisposition::NEW_BACKGROUND_TAB
                             ? WindowOpenDisposition::NEW_BACKGROUND_TAB
                             : WindowOpenDisposition::NEW_FOREGROUND_TAB;
  navigate.window_action = NavigateParams::WindowAction::kNoAction;
  navigate.window_features = features_;
  navigate.web_app_navigation_data.emplace();
  navigate.web_app_navigation_data->SetNavigationCapturingForceOff(true);
  RoutedPlacement placement = placement_;
  if (placement.disposition == WindowOpenDisposition::NEW_POPUP) {
    placement.features = features_;
  }
  WindowHost::PendingOpen pending_open{placement.disposition, source->GetWeakPtr(), std::move(placement), profile};
  base::AutoReset<WindowHost::PendingOpen> pending(&host->pending_open(), std::move(pending_open));
  Navigate(&navigate);
}

class RoutedWithoutGesture : public content::DocumentUserData<RoutedWithoutGesture> {
 public:
  ~RoutedWithoutGesture() override = default;

 private:
  friend class content::DocumentUserData<RoutedWithoutGesture>;
  explicit RoutedWithoutGesture(content::RenderFrameHost* document)
      : content::DocumentUserData<RoutedWithoutGesture>(document) {}
  DOCUMENT_USER_DATA_KEY_DECL();
};

DOCUMENT_USER_DATA_KEY_IMPL(RoutedWithoutGesture);

struct RedirectRoute {
  base::WeakPtr<content::WebContents> source;
  RoutedOwner owner;
  content::WeakDocumentPtr document;
  url::Origin origin;
  content::OpenURLParams params;
};

class RedirectRouteTag : public content::NavigationHandleUserData<RedirectRouteTag> {
 public:
  const RedirectRoute& route() const { return route_; }

  static RedirectRoute Take(content::NavigationHandle& handle) {
    RedirectRoute route = std::move(GetForNavigationHandle(handle)->route_);
    DeleteForNavigationHandle(handle);
    return route;
  }

 private:
  friend NavigationHandleUserData;
  RedirectRouteTag(content::NavigationHandle&, RedirectRoute route) : route_(std::move(route)) {}

  RedirectRoute route_;
  NAVIGATION_HANDLE_USER_DATA_KEY_DECL();
};

NAVIGATION_HANDLE_USER_DATA_KEY_IMPL(RedirectRouteTag);

void WatchRedirects(content::WebContents* source,
                    RoutedOwner owner,
                    const content::OpenURLParams& params,
                    base::OnceCallback<void(content::NavigationHandle&)>* navigation_handle_callback) {
  content::RenderFrameHost* document = source->GetPrimaryMainFrame();
  RedirectRoute route{source->GetWeakPtr(), std::move(owner), document->GetWeakDocumentPtr(),
                      document->GetLastCommittedOrigin(), params};
  *navigation_handle_callback = base::BindOnce(
      [](RedirectRoute route, base::OnceCallback<void(content::NavigationHandle&)> original,
         content::NavigationHandle& handle) {
        RedirectRouteTag::CreateForNavigationHandle(handle, std::move(route));
        if (original) {
          std::move(original).Run(handle);
        }
      },
      std::move(route), std::move(*navigation_handle_callback));
}

bool RouteRedirect(content::NavigationHandle& handle) {
  RedirectRouteTag* tag = RedirectRouteTag::GetForNavigationHandle(handle);
  if (!tag) {
    return false;
  }
  if (!handle.IsInPrimaryMainFrame() || handle.IsPost()) {
    RedirectRouteTag::Take(handle);
    return false;
  }
  const GURL& url = handle.GetURL();
  if (!url.SchemeIsHTTPOrHTTPS() || net::SchemefulSite(url) == net::SchemefulSite(tag->route().origin)) {
    return false;
  }
  content::WebContents* source = tag->route().source.get();
  if (source != handle.GetWebContents() || !tag->route().owner.Owns(source) ||
      tag->route().document.AsRenderFrameHostIfValid() != source->GetPrimaryMainFrame()) {
    RedirectRouteTag::Take(handle);
    return true;
  }
  std::optional<LinkDecision> decision = DecidePage(source, url.spec());
  if (decision && (decision->action == LinkAction::kNoMatch || decision->action == LinkAction::kSame)) {
    return false;
  }
  RedirectRoute route = RedirectRouteTag::Take(handle);
  if (!decision) {
    return true;
  }
  route.params.url = url;
  route.params.referrer = content::Referrer(handle.GetReferrer());
  route.params.redirect_chain = handle.GetRedirectChain();
  route.params.redirect_chain.pop_back();
  RoutedPlacement placement{decision->sidebar, decision->engine, decision->action == LinkAction::kLittle,
                            PlacementDisposition(route.params.disposition), url.spec()};
  StartRoutedOpen(source, std::make_unique<RoutedOpen>(source, std::move(route.owner), std::move(*decision),
                                                       std::move(placement), std::move(route.params),
                                                       blink::mojom::WindowFeatures(), base::ScopedClosureRunner(),
                                                       std::move(route.document)));
  return true;
}

class RedirectRouteThrottle : public content::NavigationThrottle {
 public:
  explicit RedirectRouteThrottle(content::NavigationThrottleRegistry& registry)
      : content::NavigationThrottle(registry) {}

  ThrottleCheckResult WillRedirectRequest() override {
    return RouteRedirect(*navigation_handle()) ? CANCEL_AND_IGNORE : PROCEED;
  }

  const char* GetNameForLogging() override { return "ACRedirectRouteThrottle"; }
};

}

const LinkRule* MatchLinkRule(const LinkRouting& routing, std::string_view url) {
  const std::string lower = base::ToLowerASCII(url);
  const std::string equals = EqualsForm(url);
  for (const LinkRule& rule : routing.rules) {
    if (rule.equals ? equals == rule.text : lower.find(rule.text) != std::string::npos) {
      return &rule;
    }
  }
  return nullptr;
}

std::optional<LinkDecision> DecideLink(const LinkRouting& routing,
                                       std::string_view url,
                                       LinkOrigin origin,
                                       const std::string& source_sidebar) {
  const bool web = IsWebURL(url);
  const bool external = origin == LinkOrigin::kExternal;
  if (!external && (!web || source_sidebar.empty())) {
    return LinkDecision();
  }
  const LinkRule* rule = web ? MatchLinkRule(routing, url) : nullptr;
  if (!rule && !external) {
    return LinkDecision();
  }
  LinkDestination destination = rule ? rule->destination : routing.default_destination;
  if (!web && destination.kind == LinkDestination::Kind::kLittle && !StartsWithASCII(url, kFile)) {
    destination = {LinkDestination::Kind::kRecent, std::string()};
  }
  LinkDecision decision;
  switch (destination.kind) {
    case LinkDestination::Kind::kLittle:
      decision.action = LinkAction::kLittle;
      decision.sidebar = external ? routing.recent : source_sidebar;
      break;
    case LinkDestination::Kind::kRecent:
      decision.action = LinkAction::kTab;
      decision.sidebar = routing.recent;
      break;
    case LinkDestination::Kind::kSidebar:
      decision.action = LinkAction::kTab;
      decision.sidebar = destination.sidebar;
      break;
  }
  const std::string* engine = EngineOf(routing, decision.sidebar);
  if (!engine) {
    return std::nullopt;
  }
  decision.engine = *engine;
  if (!external && decision.action == LinkAction::kTab && decision.sidebar == source_sidebar) {
    decision.action = LinkAction::kSame;
  }
  return decision;
}

void InstallLinkRouting(NSDictionary* config, bool live) {
  if (!live && g_live_routing) {
    return;
  }
  g_live_routing = g_live_routing || live;
  Installed() = std::make_shared<const LinkRouting>(
      RoutingFrom([config isKindOfClass:NSDictionary.class] ? config : @{}));
}

std::shared_ptr<const LinkRouting> InstalledLinkRouting() {
  return Installed();
}

NSDictionary* LinkDecisionDictionary(const LinkDecision& decision) {
  switch (decision.action) {
    case LinkAction::kNoMatch:
      return @{@"action" : @"none"};
    case LinkAction::kSame:
    case LinkAction::kTab:
    case LinkAction::kLittle:
      break;
  }
  NSString* action = decision.action == LinkAction::kSame ? @"same"
                     : decision.action == LinkAction::kTab ? @"tab"
                                                           : @"little";
  return @{
    @"action" : action,
    @"profileId" : base::SysUTF8ToNSString(decision.sidebar),
    @"engine" : base::SysUTF8ToNSString(decision.engine),
  };
}

void SetTabSidebar(content::WebContents* contents, const std::string& sidebar) {
  if (!contents) {
    return;
  }
  LinkIdentity* identity = IdentityFor(contents);
  if (identity->sidebar == sidebar) {
    return;
  }
  identity->sidebar = sidebar;
  CancelRoutedOpens(contents);
}

std::string TabSidebar(content::WebContents* contents) {
  LinkIdentity* identity = contents ? LinkIdentity::FromWebContents(contents) : nullptr;
  return identity ? identity->sidebar : std::string();
}

std::optional<RoutedPlacement> TakeRoutedPlacement(content::WebContents* contents) {
  LinkIdentity* identity = contents ? LinkIdentity::FromWebContents(contents) : nullptr;
  if (!identity || !identity->placement) {
    return std::nullopt;
  }
  std::optional<RoutedPlacement> placement = std::move(identity->placement);
  identity->placement.reset();
  return placement;
}

std::optional<WindowOpenDisposition> RoutedDisposition(content::WebContents* contents) {
  LinkIdentity* identity = contents ? LinkIdentity::FromWebContents(contents) : nullptr;
  return identity && identity->placement ? std::optional(identity->placement->disposition) : std::nullopt;
}

std::optional<blink::mojom::WindowFeatures> RoutedPopupFeatures(content::WebContents* contents) {
  LinkIdentity* identity = contents ? LinkIdentity::FromWebContents(contents) : nullptr;
  return identity && identity->placement ? identity->placement->features : std::nullopt;
}

void ClaimCreationSeed(content::WebContents* contents) {
  if (!contents || contents->GetOuterWebContents()) {
    return;
  }
  for (WindowHost* host : WindowHost::All()) {
    WindowHost::PendingOpen& open = host->pending_open();
    if ((!open.placement && open.sidebar.empty()) || open.seed_context != contents->GetBrowserContext()) {
      continue;
    }
    if (open.placement) {
      SeedPlacement(contents, *open.placement);
    } else {
      IdentityFor(contents)->sidebar = open.sidebar;
    }
    open.placement.reset();
    open.sidebar.clear();
    return;
  }
}

bool RouteOpenURL(WindowHost* host,
                  content::WebContents* source,
                  const content::OpenURLParams& params,
                  base::OnceCallback<void(content::NavigationHandle&)>* navigation_handle_callback) {
  if (!host || !source || !params.is_renderer_initiated || !params.url.SchemeIsHTTPOrHTTPS() ||
      params.is_form_submission || params.post_data || !RoutableDisposition(params.disposition) ||
      ui::PageTransitionCoreTypeIs(params.transition, ui::PAGE_TRANSITION_RELOAD) ||
      (params.transition & ui::PAGE_TRANSITION_FORWARD_BACK) ||
      (params.disposition != WindowOpenDisposition::CURRENT_TAB && !params.user_gesture)) {
    return false;
  }
  if (params.disposition == WindowOpenDisposition::CURRENT_TAB &&
      (params.should_replace_current_entry ||
       (params.frame_tree_node_id &&
        params.frame_tree_node_id != source->GetPrimaryMainFrame()->GetFrameTreeNodeId()))) {
    return false;
  }
  std::optional<RoutedOwner> owner = OwnerOf(source);
  if (!owner) {
    return false;
  }
  std::optional<LinkDecision> decision = DecidePage(source, params.url.spec());
  if (!decision) {
    return true;
  }
  if (decision->action == LinkAction::kNoMatch || decision->action == LinkAction::kSame) {
    if (params.disposition == WindowOpenDisposition::CURRENT_TAB && params.user_gesture && navigation_handle_callback &&
        !Profile::FromBrowserContext(source->GetBrowserContext())->IsOffTheRecord() && !owner->sidebar.empty()) {
      WatchRedirects(source, std::move(*owner), params, navigation_handle_callback);
    }
    return false;
  }
  if (!params.user_gesture) {
    content::RenderFrameHost* document = source->GetPrimaryMainFrame();
    if (RoutedWithoutGesture::GetForCurrentDocument(document)) {
      return false;
    }
    RoutedWithoutGesture::CreateForCurrentDocument(document);
  }
  RoutedPlacement placement{decision->sidebar, decision->engine, decision->action == LinkAction::kLittle,
                            PlacementDisposition(params.disposition), params.url.spec()};
  StartRoutedOpen(source, std::make_unique<RoutedOpen>(source, std::move(*owner), std::move(*decision),
                                                       std::move(placement), params, blink::mojom::WindowFeatures(),
                                                       base::ScopedClosureRunner()));
  return true;
}

void AddRedirectRouteThrottle(content::NavigationThrottleRegistry& registry) {
  if (registry.GetNavigationHandle().IsInPrimaryMainFrame()) {
    registry.AddThrottle(std::make_unique<RedirectRouteThrottle>(registry));
  }
}

void CancelRoutedOpens(content::WebContents* source) {
  if (RoutedOpens* opens = source ? RoutedOpens::FromWebContents(source) : nullptr) {
    opens->CancelAll();
  }
}

ArdiaConsumeNewWindow RouteNewWindow(
    content::WebContents* source,
    content::RenderFrameHost* opener,
    const content::mojom::CreateNewWindowParams& params,
    bool is_new_browsing_instance,
    bool has_user_gesture,
    base::OnceCallback<void(content::WebContents*)>* prepare_created_contents) {
  if (!source || !opener || !params.target_url.SchemeIsHTTPOrHTTPS() || params.is_form_submission ||
      params.form_submission_post_data || params.pip_options || !RoutableDisposition(params.disposition) ||
      params.disposition == WindowOpenDisposition::CURRENT_TAB || !has_user_gesture) {
    return ArdiaConsumeNewWindow();
  }
  std::optional<RoutedOwner> owner = OwnerOf(source);
  if (!owner) {
    return ArdiaConsumeNewWindow();
  }
  std::optional<LinkDecision> decision = DecidePage(source, params.target_url.spec());
  if (!decision) {
    return base::BindOnce([](blink::mojom::WindowFeatures, base::ScopedClosureRunner) {});
  }
  if (decision->action == LinkAction::kNoMatch || decision->action == LinkAction::kSame) {
    return ArdiaConsumeNewWindow();
  }
  RoutedPlacement placement{decision->sidebar, decision->engine, decision->action == LinkAction::kLittle,
                            PlacementDisposition(params.disposition), params.target_url.spec()};
  const std::string* source_engine = EngineOf(*InstalledLinkRouting(), TabSidebar(source));
  if (source_engine && *source_engine == decision->engine) {
    if (prepare_created_contents) {
      *prepare_created_contents = base::BindOnce(
          [](RoutedPlacement placement, content::WebContents* created) {
            if (created) {
              SeedPlacement(created, placement);
            }
          },
          std::move(placement));
    }
    return ArdiaConsumeNewWindow();
  }
  content::OpenURLParams open(params.target_url, params.referrer ? params.referrer.To<content::Referrer>() : content::Referrer(),
                              content::FrameTreeNodeId(), params.disposition, ui::PAGE_TRANSITION_LINK, true);
  open.initiator_origin = opener->GetLastCommittedOrigin();
  open.initiator_frame_token = opener->GetFrameToken();
  open.initiator_process_id = opener->GetProcess()->GetDeprecatedID();
  open.source_site_instance = opener->GetSiteInstance();
  open.source_render_frame_id = opener->GetRoutingID();
  open.source_render_process_id = opener->GetProcess()->GetDeprecatedID();
  open.user_gesture = has_user_gesture;
  open.started_by_ad = params.started_by_ad;
  open.download_policy = params.download_policy;
  return base::BindOnce(
      [](base::WeakPtr<content::WebContents> weak_source, RoutedOwner owner, LinkDecision decision,
         RoutedPlacement placement, content::OpenURLParams open, blink::mojom::WindowFeatures features,
         base::ScopedClosureRunner fullscreen_block) {
        content::WebContents* source = weak_source.get();
        if (!owner.Owns(source)) {
          return;
        }
        StartRoutedOpen(source, std::make_unique<RoutedOpen>(source, std::move(owner), std::move(decision),
                                                             std::move(placement), std::move(open),
                                                             std::move(features), std::move(fullscreen_block)));
      },
      source->GetWeakPtr(), std::move(*owner), std::move(*decision), std::move(placement), std::move(open));
}

}
