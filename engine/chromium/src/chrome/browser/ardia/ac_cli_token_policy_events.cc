// Copyright 2026 Ardia. Apache-2.0.

#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/no_destructor.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_cli_token_policy_internal.h"
#include "url/gurl.h"

namespace ardia {
namespace cli_token_policy_internal {

namespace {

std::string_view ReplySession(std::string_view view) {
  constexpr std::string_view kKey = R"(,"sessionId":")";
  if (view.size() < kKey.size() + 2 || !view.ends_with("\"}")) {
    return std::string_view();
  }
  const size_t end = view.size() - 2;
  const size_t open = view.rfind('"', end - 1);
  if (open == std::string_view::npos || open + 1 < kKey.size() ||
      view.substr(open + 1 - kKey.size(), kKey.size()) != kKey) {
    return std::string_view();
  }
  return view.substr(open + 1, end - open - 1);
}

std::optional<int> ParseResponseId(std::string_view view) {
  constexpr std::string_view kResponse = R"({"id":)";
  if (!view.starts_with(kResponse)) {
    return std::nullopt;
  }
  size_t end = kResponse.size();
  if (end < view.size() && view[end] == '-') {
    ++end;
  }
  while (end < view.size() && base::IsAsciiDigit(view[end])) {
    ++end;
  }
  int id = 0;
  if (end >= view.size() || (view[end] != ',' && view[end] != '}') ||
      !base::StringToInt(view.substr(kResponse.size(), end - kResponse.size()),
                         &id)) {
    return std::nullopt;
  }
  return id;
}

const std::set<std::string_view>& SecretHeaders() {
  static const base::NoDestructor<std::set<std::string_view>> headers({
      "authorization",
      "cookie",
      "cookie2",
      "proxy-authorization",
      "set-cookie",
      "set-cookie2",
  });
  return *headers;
}

const std::set<std::string_view>& SecretFields() {
  static const base::NoDestructor<std::set<std::string_view>> fields({
      "associatedCookies",
      "blockedCookies",
      "exemptedCookies",
      "headersText",
      "requestHeadersText",
  });
  return *fields;
}

void StripSecrets(base::Value& value) {
  if (base::ListValue* list = value.GetIfList()) {
    for (base::Value& item : *list) {
      StripSecrets(item);
    }
    return;
  }
  base::DictValue* dict = value.GetIfDict();
  if (!dict) {
    return;
  }
  std::vector<std::string> removed;
  for (auto [key, item] : *dict) {
    if (SecretFields().contains(key)) {
      removed.push_back(key);
      continue;
    }
    if ((key == "headers" || key == "requestHeaders") && item.is_dict()) {
      std::vector<std::string> secret;
      for (auto [name, header] : item.GetDict()) {
        if (SecretHeaders().contains(base::ToLowerASCII(name))) {
          secret.push_back(name);
        }
      }
      for (const std::string& name : secret) {
        item.GetDict().Remove(name);
      }
      continue;
    }
    StripSecrets(item);
  }
  for (const std::string& key : removed) {
    dict->Remove(key);
  }
}

}

bool TokenClient::FilterEvent(std::string& message) {
  std::string_view view(message);
  constexpr std::string_view kEvent = R"({"method":")";
  if (view.starts_with(kEvent)) {
    size_t end = view.find('"', kEvent.size());
    if (end == std::string_view::npos) {
      return false;
    }
    std::string_view method = view.substr(kEvent.size(), end - kEvent.size());
    if (method.starts_with("Network.")) {
      return FilterNetworkEvent(method, message);
    }
    if (method.starts_with("Runtime.")) {
      return FilterRuntimeEvent(method, message);
    }
    if (method == "Target.targetCreated" ||
        method == "Target.targetInfoChanged" ||
        method == "Target.attachedToTarget" ||
        method == "Target.detachedFromTarget") {
      return FilterTargetEvent(method, message);
    }
    if (method == "Page.frameNavigated" || method == "Page.documentOpened" ||
        method == "Page.navigatedWithinDocument" ||
        method == "Page.frameRequestedNavigation" ||
        method == "Page.frameScheduledNavigation" ||
        method == "Page.frameStartedNavigating") {
      return FilterPageEvent(message);
    }
    if (method == "Inspector.targetCrashed" || method == "Inspector.detached") {
      ForgetSessionOf(message);
    }
    return method != "Target.receivedMessageFromTarget";
  }
  if (outstanding_.empty()) {
    return true;
  }
  std::optional<int> id = ParseResponseId(view);
  std::string session;
  if (id) {
    session = std::string(ReplySession(view));
  } else {
    std::optional<base::Value> parsed =
        base::JSONReader::Read(message, base::JSON_PARSE_RFC);
    if (!parsed || !parsed->is_dict()) {
      return false;
    }
    id = parsed->GetDict().FindInt("id");
    if (!id) {
      return !parsed->GetDict().Find("id");
    }
    if (const std::string* found = parsed->GetDict().FindString("sessionId")) {
      session = *found;
    }
  }
  auto it = outstanding_.find({session, *id});
  if (it == outstanding_.end()) {
    return true;
  }
  const std::string method = std::move(it->second);
  outstanding_.erase(it);
  if (method.empty()) {
    return true;
  }
  return FilterResponse(*id, method, message);
}

void TokenClient::ForgetSession(const std::string& session) {
  std::erase_if(outstanding_, [&](const auto& entry) {
    return entry.first.first == session;
  });
}

void TokenClient::ForgetSessionOf(const std::string& message) {
  std::optional<base::Value> parsed =
      base::JSONReader::Read(message, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) {
    return;
  }
  const std::string* session = parsed->GetDict().FindString("sessionId");
  ForgetSession(session ? *session : std::string());
}

bool TokenClient::FilterResponse(int id,
                                 const std::string& method,
                                 std::string& message) {
  std::optional<base::Value> parsed =
      base::JSONReader::Read(message, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) {
    return false;
  }
  base::DictValue& response = parsed->GetDict();
  const std::string* session_id = response.FindString("sessionId");
  const std::string session = session_id ? *session_id : std::string();
  base::DictValue* result = response.FindDict("result");
  if (!result) {
    return true;
  }
  if (method == "Target.getTargets") {
    if (base::ListValue* infos = result->FindList("targetInfos")) {
      infos->EraseIf([](const base::Value& info) {
        return !info.is_dict() ||
               !IsWebTarget(info.GetDict().FindString("targetId"));
      });
      message = base::WriteJson(response).value_or(std::string());
    }
    return !message.empty();
  }
  if (method == "Target.getTargetInfo") {
    const base::DictValue* info = result->FindDict("targetInfo");
    if (info && !IsWebTarget(info->FindString("targetId"))) {
      message = ErrorReply(id, session, kRefused,
                           "ardia: Target.getTargetInfo on that target "
                           "isn't allowed for the ardia command");
    }
    return true;
  }
  if (method == "Page.createIsolatedWorld") {
    if (std::optional<int> context = result->FindInt("executionContextId")) {
      AllowContext(session, *context);
    }
    return true;
  }
  if (method == "Runtime.evaluate") {
    LearnDefaultContext(session, result->FindDict("result"));
  } else if (method == "DOM.resolveNode") {
    LearnDefaultContext(session, result->FindDict("object"));
  }
  return true;
}

bool TokenClient::FilterNetworkEvent(std::string_view method,
                                     std::string& message) {
  if (method.ends_with("ExtraInfo") ||
      method == "Network.responseReceivedEarlyHints" ||
      method == "Network.requestIntercepted") {
    return false;
  }
  std::optional<base::Value> parsed =
      base::JSONReader::Read(message, base::JSON_PARSE_RFC);
  if (!parsed) {
    return false;
  }
  StripSecrets(*parsed);
  message = base::WriteJson(*parsed).value_or(std::string());
  return !message.empty();
}

bool TokenClient::FilterRuntimeEvent(std::string_view method,
                                     std::string& message) {
  std::optional<base::Value> parsed =
      base::JSONReader::Read(message, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) {
    return false;
  }
  const base::DictValue& event = parsed->GetDict();
  const std::string* session_id = event.FindString("sessionId");
  const std::string session = session_id ? *session_id : std::string();
  const base::DictValue* params = event.FindDict("params");
  if (!params) {
    return false;
  }
  if (method == "Runtime.executionContextCreated") {
    const base::DictValue* context = params->FindDict("context");
    std::optional<int> context_id =
        context ? context->FindInt("id") : std::nullopt;
    if (!context_id) {
      return false;
    }
    const base::DictValue* aux = context->FindDict("auxData");
    if (aux && aux->FindBool("isDefault") != true) {
      return false;
    }
    AllowContext(session, *context_id);
    if (const std::string* unique = context->FindString("uniqueId")) {
      sessions_[session].unique_ids.insert(*unique);
    }
    return true;
  }
  if (method == "Runtime.executionContextDestroyed") {
    std::optional<int> context_id = params->FindInt("executionContextId");
    if (!ContextAllowed(session, context_id)) {
      return false;
    }
    sessions_[session].ids.erase(*context_id);
    if (const std::string* unique =
            params->FindString("executionContextUniqueId")) {
      sessions_[session].unique_ids.erase(*unique);
    }
    return true;
  }
  if (method == "Runtime.executionContextsCleared") {
    sessions_.erase(session);
    return true;
  }
  if (method == "Runtime.exceptionThrown") {
    const base::DictValue* details = params->FindDict("exceptionDetails");
    return details &&
           ContextAllowed(session, details->FindInt("executionContextId"));
  }
  if (method == "Runtime.consoleAPICalled" ||
      method == "Runtime.inspectRequested" ||
      method == "Runtime.bindingCalled") {
    return ContextAllowed(session, params->FindInt("executionContextId"));
  }
  return true;
}

bool TokenClient::FilterTargetEvent(std::string_view method,
                                    const std::string& message) {
  std::optional<base::Value> parsed =
      base::JSONReader::Read(message, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) {
    return false;
  }
  const base::DictValue* params = parsed->GetDict().FindDict("params");
  if (method == "Target.detachedFromTarget") {
    if (const std::string* child =
            params ? params->FindString("sessionId") : nullptr) {
      targets_.erase(*child);
      sessions_.erase(*child);
      ForgetSession(*child);
    }
    return true;
  }
  const base::DictValue* info =
      params ? params->FindDict("targetInfo") : nullptr;
  const std::string* target_id = info ? info->FindString("targetId") : nullptr;
  if (method == "Target.attachedToTarget") {
    const std::string* child =
        params ? params->FindString("sessionId") : nullptr;
    if (!target_id || !child) {
      return false;
    }
    targets_[*child] = *target_id;
    return true;
  }
  return IsWebTarget(target_id);
}

bool TokenClient::FilterPageEvent(const std::string& message) {
  std::optional<base::Value> parsed =
      base::JSONReader::Read(message, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) {
    return false;
  }
  const base::DictValue* params = parsed->GetDict().FindDict("params");
  if (!params) {
    return false;
  }
  const base::DictValue* frame = params->FindDict("frame");
  const std::string* url =
      frame ? frame->FindString("url") : params->FindString("url");
  return !url || url->empty() || IsWebUrl(GURL(*url));
}

}
}
