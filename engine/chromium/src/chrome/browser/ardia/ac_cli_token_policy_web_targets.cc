// Copyright 2026 Ardia. Apache-2.0.

#include <string>
#include <string_view>

#include "ardia/core/ac_hooks.h"
#include "chrome/browser/ardia/ac_cli_token_policy_internal.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "content/public/browser/child_process_security_policy.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/security_principal.h"
#include "content/public/browser/site_instance.h"
#include "content/public/browser/web_contents.h"
#include "content/public/common/url_constants.h"
#include "extensions/browser/process_map.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "url/scheme_host_port.h"
#include "url/url_constants.h"

namespace ardia {
namespace cli_token_policy_internal {

namespace {

bool IsWebOrigin(const url::Origin& origin) {
  const url::SchemeHostPort& tuple = origin.GetTupleOrPrecursorTupleIfOpaque();
  if (!tuple.IsValid()) {
    return origin.opaque();
  }
  return tuple.scheme() == url::kHttpScheme ||
         tuple.scheme() == url::kHttpsScheme;
}

bool IsPrivilegedContents(content::WebContents* contents) {
  if (!contents) {
    return true;
  }
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser) {
    return true;
  }
  return g_ardia_hidden_from_extensions &&
         g_ardia_hidden_from_extensions(browser);
}

bool IsWebProcess(content::RenderProcessHost* process) {
  if (!process) {
    return false;
  }
  const int id = process->GetDeprecatedID();
  if (content::ChildProcessSecurityPolicy::GetInstance()->HasWebUIBindings(
          id)) {
    return false;
  }
  extensions::ProcessMap* extension_processes =
      extensions::ProcessMap::Get(process->GetBrowserContext());
  return extension_processes && !extension_processes->Contains(id);
}

bool IsWebSite(content::RenderFrameHost* frame, bool main_frame) {
  content::SiteInstance* site = frame->GetSiteInstance();
  if (!site) {
    return false;
  }
  const content::SecurityPrincipal& principal = site->GetSecurityPrincipal();
  if (principal.IsWebUI() || principal.IsGuest()) {
    return false;
  }
  if (principal.SchemeIs(url::kHttpScheme) ||
      principal.SchemeIs(url::kHttpsScheme) ||
      principal.SchemeIs(url::kDataScheme)) {
    return true;
  }
  return main_frame && (principal.GetDeprecatedSiteURL().is_empty() ||
                        principal.SchemeIs(content::kChromeErrorScheme));
}

content::RenderFrameHost* FrameWithToken(content::WebContents* contents,
                                         const std::string& token) {
  content::RenderFrameHost* found = nullptr;
  contents->ForEachRenderFrameHostWithAction(
      [&](content::RenderFrameHost* frame) {
        if (frame->GetDevToolsFrameToken().ToString() != token) {
          return content::RenderFrameHost::FrameIterationAction::kContinue;
        }
        found = frame;
        return content::RenderFrameHost::FrameIterationAction::kStop;
      });
  return found;
}

bool IsWebWorkerUrl(const GURL& url) {
  return url.SchemeIsHTTPOrHTTPS() || (url.SchemeIsBlob() && IsWebUrl(url));
}

}

bool IsWebUrl(const GURL& url) {
  if (url.SchemeIsHTTPOrHTTPS()) {
    return true;
  }
  if (url.SchemeIsBlob()) {
    url::Origin origin = url::Origin::Create(url);
    return !origin.opaque() && IsWebOrigin(origin);
  }
  if (url.SchemeIs(url::kDataScheme)) {
    return true;
  }
  return url.IsAboutBlank() || url.IsAboutSrcdoc();
}

bool IsWebDestination(std::string_view spec) {
  if (spec.empty()) {
    return true;
  }
  GURL url(spec);
  return url.is_valid() && IsWebUrl(url) && !url.IsAboutSrcdoc();
}

bool IsWebFrame(content::RenderFrameHost* frame) {
  if (!frame ||
      IsPrivilegedContents(content::WebContents::FromRenderFrameHost(frame)) ||
      !IsWebProcess(frame->GetProcess())) {
    return false;
  }
  if (!IsWebOrigin(frame->GetLastCommittedOrigin())) {
    return false;
  }
  const GURL& url = frame->GetLastCommittedURL();
  if (!url.is_empty()) {
    return IsWebUrl(url);
  }
  content::RenderFrameHost* parent = frame->GetParentOrOuterDocument();
  return IsWebSite(frame, !parent) && (!parent || IsWebFrame(parent));
}

bool IsPendingWebFrameHost(content::DevToolsAgentHost* host) {
  if (!host || host->GetType() != content::DevToolsAgentHost::kTypeFrame ||
      !host->GetURL().is_empty()) {
    return false;
  }
  content::WebContents* contents = host->GetWebContents();
  if (IsPrivilegedContents(contents) || !IsWebProcess(host->GetProcessHost())) {
    return false;
  }
  const std::string parent = host->GetParentFrameId();
  return !parent.empty() && IsWebFrame(FrameWithToken(contents, parent));
}

bool IsWebHost(content::DevToolsAgentHost* host) {
  if (!host) {
    return false;
  }
  const std::string type = host->GetType();
  if (type == content::DevToolsAgentHost::kTypeBrowser) {
    return true;
  }
  const GURL url = host->GetURL();
  if (type == content::DevToolsAgentHost::kTypePage ||
      type == content::DevToolsAgentHost::kTypeTab) {
    content::WebContents* contents = host->GetWebContents();
    return !IsPrivilegedContents(contents) &&
           (url.is_empty() || IsWebUrl(url)) &&
           IsWebFrame(contents->GetPrimaryMainFrame());
  }
  if (type == content::DevToolsAgentHost::kTypeFrame) {
    return !IsPrivilegedContents(host->GetWebContents()) && IsWebWorkerUrl(url);
  }
  if (type == content::DevToolsAgentHost::kTypeDedicatedWorker ||
      type == content::DevToolsAgentHost::kTypeSharedWorker ||
      type == content::DevToolsAgentHost::kTypeServiceWorker) {
    return IsWebWorkerUrl(url);
  }
  return false;
}

bool IsWebTarget(const std::string* target_id) {
  return target_id &&
         IsWebHost(content::DevToolsAgentHost::GetForId(*target_id).get());
}

}
}
