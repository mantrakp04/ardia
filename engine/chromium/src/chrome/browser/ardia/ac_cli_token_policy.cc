// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_cli_token_policy.h"

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>

#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_cli_token_policy_internal.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/devtools_agent_host_client.h"
#include "url/gurl.h"

namespace ardia {
namespace cli_token_policy_internal {

std::string ErrorReply(int id,
                       const std::string& session,
                       int code,
                       const std::string& message) {
  base::DictValue error;
  error.Set("code", code);
  error.Set("message", message);
  base::DictValue reply;
  reply.Set("id", id);
  if (!session.empty()) {
    reply.Set("sessionId", session);
  }
  reply.Set("error", std::move(error));
  return base::WriteJson(reply).value_or("{}");
}

std::map<content::DevToolsAgentHostClient*, TokenClient*>& Registry() {
  static base::NoDestructor<
      std::map<content::DevToolsAgentHostClient*, TokenClient*>>
      registry;
  return *registry;
}

TokenClient::TokenClient(content::DevToolsAgentHostClient* client,
                         content::DevToolsAgentHost* host)
    : client_(client), root_host_(host) {
  Registry()[client_] = this;
}

TokenClient::~TokenClient() {
  Registry().erase(client_);
}

bool TokenClient::FilterCommand(std::string& message, std::string* reply) {
  std::optional<base::Value> parsed =
      base::JSONReader::Read(message, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) {
    *reply = ErrorReply(0, std::string(), kParseError,
                        "ardia: a command must be a JSON object");
    return false;
  }
  base::DictValue& command = parsed->GetDict();
  const std::string* session_id = command.FindString("sessionId");
  const std::string session = session_id ? *session_id : std::string();
  std::optional<int> id = command.FindInt("id");
  const std::string* method = command.FindString("method");
  if (!id || !method || (command.Find("sessionId") && !session_id)) {
    *reply = ErrorReply(id.value_or(0), session, kInvalidRequest,
                        "ardia: a command needs an id and a method");
    return false;
  }
  for (auto [key, value] : command) {
    if (key != "id" && key != "method" && key != "params" &&
        key != "sessionId") {
      *reply = ErrorReply(*id, session, kInvalidRequest,
                          base::StrCat({"ardia: a command can't carry ", key}));
      return false;
    }
  }
  if (session_id && !targets_.contains(session)) {
    *reply = ErrorReply(*id, std::string(), kInvalidRequest,
                        "ardia: no attached session has that sessionId");
    return false;
  }
  if (!AllowedMethods().contains(*method)) {
    *reply = ErrorReply(*id, session, kMethodNotAllowed,
                        base::StrCat({"ardia: ", *method,
                                      " isn't allowed for the ardia command"}));
    return false;
  }
  if (command.Find("params") && !command.FindDict("params")) {
    *reply = ErrorReply(*id, session, kInvalidRequest,
                        "ardia: params must be an object");
    return false;
  }
  base::DictValue& params = *command.EnsureDict("params");
  std::string refusal = Refusal(*method, session, params);
  if (!refusal.empty()) {
    *reply = ErrorReply(*id, session, kRefused,
                        base::StrCat({"ardia: ", *method, " ", refusal,
                                      " isn't allowed for the ardia command"}));
    return false;
  }
  const std::pair<std::string, int> key(session, *id);
  if (outstanding_.contains(key)) {
    *reply = ErrorReply(*id, session, kInvalidRequest,
                        "ardia: a command with that id is still waiting for "
                        "its reply");
    return false;
  }
  if (outstanding_.size() >= kMaxPending) {
    *reply = ErrorReply(*id, session, kRefused,
                        "ardia: too many commands are waiting for replies; "
                        "closing the connection");
    wedged_ = true;
    return false;
  }
  outstanding_[key] = NeedsResponse(*method, params) ? *method : std::string();
  message = base::WriteJson(command).value_or(std::string());
  return !message.empty();
}

bool TokenClient::ShouldClose() const {
  return wedged_;
}

bool TokenClient::MayAttachToURL(const GURL& url, bool is_webui) {
  return !is_webui && IsWebUrl(url);
}

bool TokenClient::MayAttachToRenderFrameHost(content::RenderFrameHost* frame) {
  return IsWebFrame(frame);
}

std::string TokenClient::Refusal(const std::string& method,
                                 const std::string& session,
                                 base::DictValue& params) {
  for (const char* key : {"contextId", "executionContextId"}) {
    if (const base::Value* value = params.Find(key)) {
      if (!value->is_int() || !ContextAllowed(session, value->GetInt())) {
        return "in that execution context";
      }
    }
  }
  if (const base::Value* value = params.Find("uniqueContextId")) {
    if (!value->is_string() ||
        !sessions_[session].unique_ids.contains(value->GetString())) {
      return "in that execution context";
    }
  }
  if (method != "Runtime.releaseObject" &&
      !ObjectIdsAllowed(session, base::Value(params.Clone()))) {
    return "on that object";
  }
  if (method == "Target.attachToTarget") {
    if (params.FindBool("flatten") != true) {
      return "without flatten";
    }
    if (!IsWebTarget(params.FindString("targetId"))) {
      return "to that target";
    }
  } else if (method == "Target.setAutoAttach") {
    if (params.FindBool("autoAttach") != false &&
        params.FindBool("flatten") != true) {
      return "without flatten";
    }
  } else if (method == "Target.createTarget") {
    const std::string* url = params.FindString("url");
    if (!url || !IsWebDestination(*url)) {
      return "to that URL";
    }
    if (params.Find("browserContextId")) {
      return "in another browser context";
    }
  } else if (method == "Target.activateTarget" ||
             method == "Target.closeTarget") {
    if (!IsWebTarget(params.FindString("targetId"))) {
      return "on that target";
    }
  } else if (method == "Target.getTargetInfo") {
    if (params.Find("targetId") &&
        !IsWebTarget(params.FindString("targetId"))) {
      return "on that target";
    }
  } else if (method == "Page.navigate") {
    const std::string* url = params.FindString("url");
    if (!url || url->empty() || !IsWebDestination(*url)) {
      return "to that URL";
    }
  } else if (method == "Page.createIsolatedWorld") {
    params.Set("grantUniveralAccess", false);
  } else if (method == "Page.addScriptToEvaluateOnNewDocument") {
    const base::Value* world = params.Find("worldName");
    if (world && !(world->is_string() && world->GetString().empty())) {
      return "in a named world";
    }
  } else if (method == "Page.printToPDF") {
    const std::string* mode = params.FindString("transferMode");
    if (params.Find("transferMode") && (!mode || *mode != "ReturnAsBase64")) {
      return "as a stream";
    }
  } else if (method == "Runtime.evaluate") {
    if (params.FindBool("includeCommandLineAPI").value_or(false)) {
      return "with the command line API";
    }
  } else if (method == "Input.dispatchKeyEvent") {
    if (!EditingCommandsAllowed(params.Find("commands"))) {
      return "with those editing commands";
    }
    params.Remove("nativeVirtualKeyCode");
    params.Remove("isSystemKey");
  }
  return std::string();
}

}

std::unique_ptr<ArdiaDevToolsTokenClient> CreateTokenClient(
    content::DevToolsAgentHostClient* client,
    content::DevToolsAgentHost* host) {
  return std::make_unique<cli_token_policy_internal::TokenClient>(client, host);
}

bool TokenClientMayAttach(content::DevToolsAgentHostClient* root_client,
                          content::DevToolsAgentHost* host) {
  return !cli_token_policy_internal::Registry().contains(root_client) ||
         cli_token_policy_internal::IsWebHost(host) ||
         cli_token_policy_internal::IsPendingWebFrameHost(host);
}

bool TokenClientMayInput(content::DevToolsAgentHostClient* root_client,
                         content::RenderFrameHost* frame) {
  return !cli_token_policy_internal::Registry().contains(root_client) ||
         cli_token_policy_internal::IsWebFrame(frame);
}

}
