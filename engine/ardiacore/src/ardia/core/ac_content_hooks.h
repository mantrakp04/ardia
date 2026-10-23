#ifndef ARDIA_CORE_AC_CONTENT_HOOKS_H_
#define ARDIA_CORE_AC_CONTENT_HOOKS_H_

#include <stddef.h>

#include <memory>
#include <string>
#include <string_view>

#include "base/functional/callback.h"
#include "base/functional/callback_helpers.h"
#include "extensions/common/extension_id.h"

class GURL;

namespace blink {
struct WebNavigationInfo;
namespace mojom {
class WindowFeatures;
}
}

namespace content {
class BrowserContext;
class DevToolsAgentHost;
class DevToolsAgentHostClient;
class DevToolsSocketFactory;
class RenderFrame;
class RenderFrameHost;
class WebContents;
namespace mojom {
class CreateNewWindowParams;
}

extern bool g_ardia_opacity_from_default_color;

bool ArdiaHasAccessedInitialMainDocument(WebContents* contents);
}

namespace extensions {
struct WebRequestInfo;
namespace declarative_net_request {
struct RequestAction;
}
}

extern const char* g_ardia_user_agent_brand;

extern int g_ardia_disk_space_check_seconds;

extern bool g_ardia_lazy_storage_usage;

extern bool g_ardia_script_loader_ready_at_once;

extern bool g_ardia_scripts_wait_at_response;

extern bool g_ardia_bluetooth_poll_on_demand;

extern bool g_ardia_hybrid_scan_on_demand;

void ArdiaSetHybridUiShown(const void* model, bool shown);

extern bool (*g_ardia_restricted_component_extension)(
    const extensions::ExtensionId& extension_id);

extern bool g_ardia_begin_frame_bridge;

extern void (*g_ardia_initial_main_document_accessed)(
    content::WebContents* contents);

extern bool (*g_ardia_open_navigation_in_browser)(
    content::RenderFrame* frame,
    const blink::WebNavigationInfo& info);

using ArdiaConsumeNewWindow = base::OnceCallback<void(
    blink::mojom::WindowFeatures,
    base::ScopedClosureRunner)>;

extern ArdiaConsumeNewWindow (*g_ardia_route_new_window)(
    content::WebContents* source,
    content::RenderFrameHost* opener,
    const content::mojom::CreateNewWindowParams& params,
    bool is_new_browsing_instance,
    bool has_user_gesture,
    base::OnceCallback<void(content::WebContents*)>* prepare_created_contents);

extern int (*g_ardia_permission_tab_shown)(content::WebContents*);

extern void (*g_ardia_dnr_rule_matched)(
    content::BrowserContext* browser_context,
    int tab_id,
    const extensions::declarative_net_request::RequestAction& action,
    const extensions::WebRequestInfo& request);

extern void (*g_ardia_dnr_rulesets_in_force)(
    content::BrowserContext* browser_context,
    const extensions::ExtensionId& extension_id,
    bool all_loaded);

extern bool (*g_ardia_devtools_token_factory)(
    const content::DevToolsSocketFactory* factory);

extern bool (*g_ardia_devtools_token_accepts)(
    const content::DevToolsSocketFactory* factory,
    std::string_view token);

extern void (*g_ardia_devtools_token_server)(
    const content::DevToolsSocketFactory* factory,
    std::string_view browser_path,
    int port,
    size_t connections);

extern bool (*g_ardia_devtools_active_target)(
    const content::DevToolsSocketFactory* factory,
    std::string_view token,
    std::string* target_id);

class ArdiaDevToolsTokenClient {
 public:
  virtual ~ArdiaDevToolsTokenClient() = default;
  virtual bool FilterCommand(std::string& message, std::string* reply) = 0;
  virtual bool FilterEvent(std::string& message) = 0;
  virtual bool ShouldClose() const = 0;
  virtual bool MayAttachToURL(const GURL& url, bool is_webui) = 0;
  virtual bool MayAttachToRenderFrameHost(
      content::RenderFrameHost* render_frame_host) = 0;
};

extern std::unique_ptr<ArdiaDevToolsTokenClient> (*g_ardia_devtools_token_client)(
    const content::DevToolsSocketFactory* factory,
    content::DevToolsAgentHostClient* client,
    content::DevToolsAgentHost* host);

extern bool (*g_ardia_devtools_may_attach)(
    content::DevToolsAgentHostClient* root_client,
    content::DevToolsAgentHost* host);

extern bool (*g_ardia_devtools_may_input)(
    content::DevToolsAgentHostClient* root_client,
    content::RenderFrameHost* frame);

#endif
