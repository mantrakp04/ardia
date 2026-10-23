#ifndef ARDIA_CORE_AC_NAVIGATION_ROUTING_H_
#define ARDIA_CORE_AC_NAVIGATION_ROUTING_H_

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/functional/callback.h"
#include "base/functional/callback_helpers.h"
#include "base/memory/weak_ptr.h"
#include "third_party/blink/public/mojom/window_features/window_features.mojom.h"
#include "ardia/core/ac_content_hooks.h"
#include "ui/base/window_open_disposition.h"

#if defined(__OBJC__)
@class NSDictionary;
#else
class NSDictionary;
#endif

class Profile;

namespace content {
class NavigationHandle;
class NavigationThrottleRegistry;
class RenderFrameHost;
class WebContents;
struct OpenURLParams;
namespace mojom {
class CreateNewWindowParams;
}
}

namespace ardiacore {

class WindowHost;

struct LinkDestination {
  enum class Kind { kLittle, kRecent, kSidebar };
  Kind kind = Kind::kLittle;
  std::string sidebar;
};

struct LinkRule {
  bool equals = false;
  std::string text;
  LinkDestination destination;
};

struct LinkRouting {
  std::vector<LinkRule> rules;
  LinkDestination default_destination;
  std::map<std::string, std::string> engines;
  std::string recent;
};

enum class LinkOrigin { kPage, kTyped, kExternal };
enum class LinkAction { kNoMatch, kSame, kTab, kLittle };

struct LinkDecision {
  LinkAction action = LinkAction::kNoMatch;
  std::string sidebar;
  std::string engine;
};

struct RoutedPlacement {
  std::string sidebar;
  std::string engine;
  bool little = false;
  WindowOpenDisposition disposition = WindowOpenDisposition::NEW_FOREGROUND_TAB;
  std::string url;
  std::optional<blink::mojom::WindowFeatures> features;
};

const LinkRule* MatchLinkRule(const LinkRouting& routing, std::string_view url);
std::optional<LinkDecision> DecideLink(const LinkRouting& routing,
                                       std::string_view url,
                                       LinkOrigin origin,
                                       const std::string& source_sidebar);

void InstallLinkRouting(NSDictionary* config, bool live);
std::shared_ptr<const LinkRouting> InstalledLinkRouting();
NSDictionary* LinkDecisionDictionary(const LinkDecision& decision);

void SetTabSidebar(content::WebContents* contents, const std::string& sidebar);
std::string TabSidebar(content::WebContents* contents);
std::optional<RoutedPlacement> TakeRoutedPlacement(content::WebContents* contents);
std::optional<WindowOpenDisposition> RoutedDisposition(content::WebContents* contents);
std::optional<blink::mojom::WindowFeatures> RoutedPopupFeatures(content::WebContents* contents);
void ClaimCreationSeed(content::WebContents* contents);

bool RouteOpenURL(WindowHost* host,
                  content::WebContents* source,
                  const content::OpenURLParams& params,
                  base::OnceCallback<void(content::NavigationHandle&)>* navigation_handle_callback);
void AddRedirectRouteThrottle(content::NavigationThrottleRegistry& registry);
void CancelRoutedOpens(content::WebContents* source);

ArdiaConsumeNewWindow RouteNewWindow(
    content::WebContents* source,
    content::RenderFrameHost* opener,
    const content::mojom::CreateNewWindowParams& params,
    bool is_new_browsing_instance,
    bool has_user_gesture,
    base::OnceCallback<void(content::WebContents*)>* prepare_created_contents);

void LoadLinkProfile(const std::string& engine, base::OnceCallback<void(Profile*)> done);

}

#endif
