// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_CLI_TOKEN_POLICY_INTERNAL_H_
#define CHROME_BROWSER_ARDIA_AC_CLI_TOKEN_POLICY_INTERNAL_H_

#include <cstddef>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>

#include "base/memory/raw_ptr.h"
#include "base/memory/scoped_refptr.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_cli_token_policy.h"
#include "content/public/browser/devtools_agent_host.h"

class GURL;

namespace content {
class DevToolsAgentHostClient;
class RenderFrameHost;
}

namespace ardia {
namespace cli_token_policy_internal {

inline constexpr int kMethodNotAllowed = -32601;
inline constexpr int kInvalidRequest = -32600;
inline constexpr int kParseError = -32700;
inline constexpr int kRefused = -32000;
inline constexpr size_t kMaxPending = 4096;

const std::set<std::string_view>& AllowedMethods();
bool NeedsResponse(const std::string& method, const base::DictValue& params);
bool EditingCommandsAllowed(const base::Value* commands);

bool IsWebUrl(const GURL& url);
bool IsWebDestination(std::string_view spec);
bool IsWebFrame(content::RenderFrameHost* frame);
bool IsPendingWebFrameHost(content::DevToolsAgentHost* host);
bool IsWebHost(content::DevToolsAgentHost* host);
bool IsWebTarget(const std::string* target_id);

std::string ErrorReply(int id,
                       const std::string& session,
                       int code,
                       const std::string& message);

class TokenClient;

std::map<content::DevToolsAgentHostClient*, TokenClient*>& Registry();

class TokenClient : public ArdiaDevToolsTokenClient {
 public:
  TokenClient(content::DevToolsAgentHostClient* client,
              content::DevToolsAgentHost* host);
  ~TokenClient() override;

  bool FilterCommand(std::string& message, std::string* reply) override;
  bool FilterEvent(std::string& message) override;
  bool ShouldClose() const override;
  bool MayAttachToURL(const GURL& url, bool is_webui) override;
  bool MayAttachToRenderFrameHost(content::RenderFrameHost* frame) override;

 private:
  struct Contexts {
    std::map<int, int> ids;
    std::set<std::string> unique_ids;
  };

  void ForgetSession(const std::string& session);
  void ForgetSessionOf(const std::string& message);
  content::DevToolsAgentHost* HostOf(const std::string& session);
  int CurrentProcess(const std::string& session);
  void AllowContext(const std::string& session, int context);
  bool ContextAllowed(const std::string& session, std::optional<int> context);
  bool ObjectAllowed(const std::string& session, const std::string& object_id);
  bool ObjectIdsAllowed(const std::string& session, const base::Value& value);
  std::string Refusal(const std::string& method,
                      const std::string& session,
                      base::DictValue& params);
  void LearnDefaultContext(const std::string& session,
                           const base::DictValue* remote_object);
  bool FilterResponse(int id, const std::string& method, std::string& message);
  bool FilterNetworkEvent(std::string_view method, std::string& message);
  bool FilterRuntimeEvent(std::string_view method, std::string& message);
  bool FilterTargetEvent(std::string_view method, const std::string& message);
  bool FilterPageEvent(const std::string& message);

  const raw_ptr<content::DevToolsAgentHostClient> client_;
  const scoped_refptr<content::DevToolsAgentHost> root_host_;
  std::map<std::string, std::string> targets_;
  std::map<std::string, Contexts> sessions_;
  std::map<std::pair<std::string, int>, std::string> outstanding_;
  bool wedged_ = false;
};

}
}

#endif
