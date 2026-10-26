// Copyright 2026 Ardia. Apache-2.0.

#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "base/strings/string_number_conversions.h"
#include "base/strings/string_split.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_cli_token_policy_internal.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/render_process_host.h"

namespace ardia {
namespace cli_token_policy_internal {

namespace {

std::optional<int> ContextOfObjectId(std::string_view object_id) {
  std::vector<std::string_view> parts = base::SplitStringPiece(
      object_id, ".", base::KEEP_WHITESPACE, base::SPLIT_WANT_ALL);
  int64_t isolate = 0;
  int context = 0;
  int64_t serial = 0;
  if (parts.size() != 3 || !base::StringToInt64(parts[0], &isolate) ||
      !base::StringToInt(parts[1], &context) ||
      !base::StringToInt64(parts[2], &serial)) {
    return std::nullopt;
  }
  return context;
}

int ProcessOf(content::DevToolsAgentHost* host) {
  content::RenderProcessHost* process = host ? host->GetProcessHost() : nullptr;
  return process ? process->GetDeprecatedID() : -1;
}

}

content::DevToolsAgentHost* TokenClient::HostOf(const std::string& session) {
  if (session.empty()) {
    return root_host_.get();
  }
  auto it = targets_.find(session);
  return it == targets_.end()
             ? nullptr
             : content::DevToolsAgentHost::GetForId(it->second).get();
}

int TokenClient::CurrentProcess(const std::string& session) {
  return ProcessOf(HostOf(session));
}

void TokenClient::AllowContext(const std::string& session, int context) {
  int process = CurrentProcess(session);
  if (process >= 0) {
    sessions_[session].ids[context] = process;
  }
}

bool TokenClient::ContextAllowed(const std::string& session,
                                 std::optional<int> context) {
  if (!context) {
    return false;
  }
  auto session_it = sessions_.find(session);
  if (session_it == sessions_.end()) {
    return false;
  }
  auto it = session_it->second.ids.find(*context);
  return it != session_it->second.ids.end() &&
         it->second == CurrentProcess(session);
}

bool TokenClient::ObjectAllowed(const std::string& session,
                                const std::string& object_id) {
  return ContextAllowed(session, ContextOfObjectId(object_id));
}

bool TokenClient::ObjectIdsAllowed(const std::string& session,
                                   const base::Value& value) {
  if (const base::ListValue* list = value.GetIfList()) {
    for (const base::Value& item : *list) {
      if (!ObjectIdsAllowed(session, item)) {
        return false;
      }
    }
    return true;
  }
  const base::DictValue* dict = value.GetIfDict();
  if (!dict) {
    return true;
  }
  for (auto [key, item] : *dict) {
    if (key == "objectId" || key == "promiseObjectId" ||
        key == "prototypeObjectId") {
      if (!item.is_string() || !ObjectAllowed(session, item.GetString())) {
        return false;
      }
      continue;
    }
    if (!ObjectIdsAllowed(session, item)) {
      return false;
    }
  }
  return true;
}

void TokenClient::LearnDefaultContext(const std::string& session,
                                      const base::DictValue* remote_object) {
  const std::string* object_id =
      remote_object ? remote_object->FindString("objectId") : nullptr;
  if (std::optional<int> context =
          object_id ? ContextOfObjectId(*object_id) : std::nullopt) {
    AllowContext(session, *context);
  }
}

}
}
