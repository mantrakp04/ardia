#include "ardia/linux/ac_linux_document_reducer.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <string_view>
#include <utility>
#include <vector>

namespace ardia {
namespace {

bool Shape(const base::DictValue& value, std::string_view fields) {
  for (const auto& [key, entry] : value) {
    if (fields.find("|" + std::string(key) + "|") == std::string_view::npos) return false;
    if (entry.is_blob()) return false;
  }
  return true;
}

bool Strings(const base::Value& value) {
  if (!value.is_list() || value.GetList().size() > 20000) return false;
  std::set<std::string> seen;
  for (const auto& entry : value.GetList())
    if (!entry.is_string() || entry.GetString().size() > 1024 ||
        !seen.insert(entry.GetString()).second) return false;
  return true;
}

bool JsonSafe(const base::Value& value, size_t depth, size_t& nodes) {
  if (depth > 32 || ++nodes > 100000 || value.is_blob()) return false;
  if (value.is_double() && !std::isfinite(value.GetDouble())) return false;
  if (value.is_string()) return value.GetString().size() <= 262144;
  if (value.is_dict()) {
    for (const auto& [key, child] : value.GetDict()) {
      if (key == "__proto__" || key == "constructor" || key == "prototype" ||
          key == "token" || key == "password" || key == "authorization" ||
          key == "accessToken" || key == "refreshToken" || key == "secret" ||
          !JsonSafe(child, depth + 1, nodes)) return false;
    }
  }
  if (value.is_list()) for (const auto& child : value.GetList())
    if (!JsonSafe(child, depth + 1, nodes)) return false;
  return true;
}

bool Fields(const base::DictValue& value, std::string_view strings,
            std::string_view booleans, std::string_view numbers) {
  for (const auto& [key, entry] : value) {
    const auto token = "|" + std::string(key) + "|";
    if (strings.find(token) != std::string_view::npos && !entry.is_string() && !entry.is_none()) return false;
    if (booleans.find(token) != std::string_view::npos && !entry.is_bool()) return false;
    if (numbers.find(token) != std::string_view::npos && !entry.is_int() && !entry.is_double() && !entry.is_none()) return false;
  }
  return true;
}

bool Number(const base::Value& value) {
  return (value.is_int() || value.is_double()) && std::isfinite(value.GetDouble());
}

bool CountdownLead(const base::Value& value) {
  return Number(value) && value.GetDouble() > 0 && value.GetDouble() <= kLinuxLiveMaxCountdownLead;
}

bool DismissedNowEnd(const base::Value& value) {
  return Number(value) && value.GetDouble() >= 0;
}

std::optional<base::DictValue> DismissedNow(const base::DictValue& dismissed) {
  std::vector<std::pair<double, std::string>> ends;
  for (const auto& [occurrence, end] : dismissed) {
    if (occurrence.empty() || occurrence.size() > kLinuxLiveMaxOccurrence || !DismissedNowEnd(end)) return std::nullopt;
    ends.emplace_back(end.GetDouble(), std::string(occurrence));
  }
  if (ends.size() <= kLinuxLiveMaxDismissedNow) return dismissed.Clone();
  std::sort(ends.begin(), ends.end(), [](const auto& a, const auto& b) { return a.first != b.first ? a.first > b.first : a.second < b.second; });
  base::DictValue kept;
  for (size_t index = 0; index < kLinuxLiveMaxDismissedNow; ++index)
    kept.Set(ends[index].second, dismissed.Find(ends[index].second)->Clone());
  return kept;
}

bool Item(const base::Value& entry) {
  if (!entry.is_dict()) return false;
  const auto& item = entry.GetDict();
  if (!Shape(item, "|id|source|url|title|subtitle|icon|updatedAt|section|pr|doc|") ||
      !item.FindString("id") || !item.FindString("source") ||
      !Fields(item, "|id|source|url|title|subtitle|icon|section|", "", "|updatedAt|")) return false;
  const auto* pr = item.FindDict("pr");
  if (item.Find("pr") && !pr) return false;
  if (pr) {
    if (!Shape(*pr, "|number|repo|author|authorAvatar|draft|headRef|baseRef|review|mergeable|checks|comments|unresolvedThreads|additions|deletions|changedFiles|stack|") ||
        !Fields(*pr, "|repo|author|authorAvatar|headRef|baseRef|review|mergeable|", "|draft|", "|number|comments|unresolvedThreads|additions|deletions|changedFiles|")) return false;
    if (auto* stack = pr->Find("stack"); stack && !stack->is_none()) {
      if (!stack->is_dict() || !Shape(stack->GetDict(), "|id|position|size|") ||
          !Fields(stack->GetDict(), "|id|", "", "|position|size|")) return false;
    }
    if (auto* checks = pr->Find("checks")) {
      if (!checks->is_list()) return false;
      for (const auto& check : checks->GetList())
        if (!check.is_dict() || !Shape(check.GetDict(), "|name|state|url|") ||
            !Fields(check.GetDict(), "|name|state|url|", "", "")) return false;
    }
  }
  auto* doc = item.Find("doc");
  return !doc || (doc->is_dict() && Shape(doc->GetDict(), "|kind|editedBy|place|") &&
                  Fields(doc->GetDict(), "|kind|editedBy|place|", "", ""));
}

bool Folder(base::DictValue& folder, const std::string& id) {
  if (!Shape(folder, "|id|profileId|kind|name|icon|collapsed|sources|filters|groupStacks|showCompleted|createdAt|after|") ||
      !folder.FindString("id") || *folder.FindString("id") != id ||
      !folder.FindString("profileId") || !folder.FindString("kind") ||
      !Fields(folder, "|id|profileId|kind|name|icon|after|", "|collapsed|groupStacks|showCompleted|", "|createdAt|")) return false;
  auto* sources = folder.Find("sources");
  auto* filters = folder.FindDict("filters");
  if (!sources || !Strings(*sources) || !filters ||
      !Shape(*filters, "|authored|reviewRequests|") ||
      !Fields(*filters, "", "|authored|reviewRequests|", "")) return false;
  if (!folder.Find("groupStacks")) folder.Set("groupStacks", base::Value(true));
  if (!folder.Find("showCompleted")) folder.Set("showCompleted", base::Value(true));
  return true;
}

}

int LinuxDocumentInteger(const base::DictValue& value, std::string_view key,
                         int fallback) {
  auto* number = value.Find(key);
  return number && number->is_int() ? number->GetInt() : fallback;
}

std::optional<base::DictValue> NormalizeLinuxLive(const base::DictValue& payload) {
  int version = LinuxDocumentInteger(payload, "version", 0);
  if (version < 0 || version > 1 || (payload.Find("version") && !payload.Find("version")->is_int()) ||
      !Shape(payload, "|version|folders|folderOrder|items|known|unread|hidden|completed|expandedStacks|accounts|config|calendar|meetingGroups|dismissedAlerts|dismissedNow|")) return std::nullopt;
  size_t nodes = 0;
  if (!JsonSafe(base::Value(payload.Clone()), 0, nodes)) return std::nullopt;
  base::DictValue result;
  result.Set("version", base::Value(1));
  for (auto key : {"folders", "items", "known", "unread", "hidden", "completed", "expandedStacks", "accounts", "config", "calendar", "meetingGroups", "dismissedNow"}) {
    if (payload.Find(key) && !payload.FindDict(key)) return std::nullopt;
    result.Set(key, payload.FindDict(key) ? payload.FindDict(key)->Clone() : base::DictValue());
  }
  for (auto key : {"folderOrder", "dismissedAlerts"}) {
    if (payload.Find(key) && !Strings(*payload.Find(key))) return std::nullopt;
    result.Set(key, payload.Find(key) ? payload.Find(key)->Clone() : base::Value(base::ListValue()));
  }
  auto folders = result.FindDict("folders")->Clone();
  for (const auto& [id, entry] : *result.FindDict("folders")) {
    if (!entry.is_dict()) return std::nullopt;
    auto folder = entry.GetDict().Clone();
    if (!Folder(folder, std::string(id))) return std::nullopt;
    folders.Set(id, std::move(folder));
  }
  result.Set("folders", std::move(folders));
  for (const auto& id : result.Find("folderOrder")->GetList())
    if (!result.FindDict("folders")->contains(id.GetString())) return std::nullopt;
  for (auto key : {"items", "hidden", "completed", "known", "unread"}) {
    for (const auto& [id, entries] : *result.FindDict(key)) {
      if (!result.FindDict("folders")->contains(id) || !entries.is_list()) return std::nullopt;
      if (std::string_view(key) == "known" || std::string_view(key) == "unread") {
        if (!Strings(entries)) return std::nullopt;
        continue;
      }
      std::set<std::string> ids;
      for (const auto& entry : entries.GetList()) {
        const base::Value* item = &entry;
        if (std::string_view(key) == "completed") {
          if (!entry.is_dict() || !Shape(entry.GetDict(), "|item|state|at|") ||
              !Fields(entry.GetDict(), "|state|", "", "|at|")) return std::nullopt;
          item = entry.GetDict().Find("item");
        }
        if (!item || !Item(*item) || !ids.insert(*item->GetDict().FindString("id")).second) return std::nullopt;
      }
    }
  }
  for (const auto& [id, entry] : *result.FindDict("expandedStacks")) if (!entry.is_bool()) return std::nullopt;
  for (const auto& [id, entry] : *result.FindDict("accounts")) {
    if (std::set<std::string_view>{"github", "bitbucket", "notion", "confluence", "gdrive"}.count(id) == 0 ||
        !entry.is_dict() || !Shape(entry.GetDict(), "|login|name|avatar|connectedAt|") ||
        !Fields(entry.GetDict(), "|login|name|avatar|", "", "|connectedAt|")) return std::nullopt;
  }
  for (const auto& [id, entry] : *result.FindDict("meetingGroups")) {
    if (!entry.is_dict() || !Shape(entry.GetDict(), "|groupId|callTabId|occurrence|title|start|end|endedAt|") ||
        !Fields(entry.GetDict(), "|groupId|callTabId|occurrence|title|", "", "|start|end|endedAt|")) return std::nullopt;
  }
  auto dismissed = DismissedNow(*result.FindDict("dismissedNow"));
  if (!dismissed) return std::nullopt;
  result.Set("dismissedNow", std::move(*dismissed));
  auto config = result.FindDict("config")->Clone();
  if (!Shape(config, "|githubClientId|bitbucketUser|confluenceSite|confluenceEmail|googleClientId|")) return std::nullopt;
  for (auto field : {"githubClientId", "bitbucketUser", "confluenceSite", "confluenceEmail", "googleClientId"}) {
    if (config.Find(field) && !config.FindString(field)) return std::nullopt;
    if (!config.Find(field)) config.Set(field, "");
  }
  result.Set("config", std::move(config));
  auto calendar = result.FindDict("calendar")->Clone();
  if (!Shape(calendar, "|alertLead|alertCondition|showPreview|showTimeToNext|countdownLead|hiddenCalendarIds|prompted|") ||
      !Fields(calendar, "|alertLead|alertCondition|", "|showPreview|showTimeToNext|prompted|", "")) return std::nullopt;
  if (calendar.Find("hiddenCalendarIds") && !Strings(*calendar.Find("hiddenCalendarIds"))) return std::nullopt;
  if (calendar.Find("countdownLead") && !CountdownLead(*calendar.Find("countdownLead"))) return std::nullopt;
  if (!calendar.Find("countdownLead")) calendar.Set("countdownLead", base::Value(kLinuxLiveDefaultCountdownLead));
  if (!calendar.Find("hiddenCalendarIds")) calendar.Set("hiddenCalendarIds", base::Value(base::ListValue()));
  if (!calendar.Find("alertLead")) calendar.Set("alertLead", "1");
  if (!calendar.Find("alertCondition")) calendar.Set("alertCondition", "always");
  for (auto field : {"showPreview", "showTimeToNext", "prompted"})
    if (!calendar.Find(field)) calendar.Set(field, base::Value(std::string_view(field) != "prompted"));
  result.Set("calendar", std::move(calendar));
  return result;
}

namespace {

bool Identifier(const base::DictValue& op, std::string_view key, size_t limit = 160) {
  auto* value = op.FindString(key);
  return value && !value->empty() && value->size() <= limit;
}

bool NullableString(const base::Value* value) {
  return value && (value->is_none() || (value->is_string() && value->GetString().size() <= 1024));
}

bool Entry(const base::Value& value, bool completed, const std::string& key) {
  if (value.is_none()) return true;
  const base::Value* item = &value;
  if (completed) {
    if (!value.is_dict() || !Shape(value.GetDict(), "|item|state|at|")) return false;
    auto* state = value.GetDict().FindString("state");
    auto* at = value.GetDict().Find("at");
    if (!state || (*state != "closed" && *state != "merged" && *state != "reviewed") ||
        !at || (!at->is_int() && !at->is_double())) return false;
    item = value.GetDict().Find("item");
  }
  return item && Item(*item) && *item->GetDict().FindString("id") == key;
}

bool FieldValue(const std::string& target, const std::string& field,
                const std::string& id, const base::Value& value) {
  if (target == "folder") {
    if (field == "name") return value.is_string();
    if (field == "icon" || field == "after") return NullableString(&value);
    if (field == "sources") return Strings(value);
    return std::set<std::string>{"collapsed", "groupStacks", "showCompleted", "filters.authored", "filters.reviewRequests"}.contains(field) && value.is_bool();
  }
  if (target == "calendar") {
    if (field == "alertLead") return value.is_string();
    if (field == "countdownLead") return CountdownLead(value);
    if (field == "alertCondition") return value.is_string() && (value.GetString() == "always" || value.GetString() == "activeOnly");
    return std::set<std::string>{"showPreview", "showTimeToNext", "prompted"}.contains(field) && value.is_bool();
  }
  if (target == "config") return std::set<std::string>{"githubClientId", "bitbucketUser", "confluenceSite", "confluenceEmail", "googleClientId"}.contains(field) && value.is_string();
  if (field != "value" || id.empty()) return false;
  if (target == "expandedStack") return value.is_none() || value.is_bool();
  if (target == "dismissedNow") return value.is_none() || DismissedNowEnd(value);
  if (target != "account" && target != "meetingGroup") return false;
  if (value.is_none()) return true;
  base::DictValue payload;
  base::DictValue entries;
  entries.Set(id, value.Clone());
  payload.Set(target == "account" ? "accounts" : "meetingGroups", std::move(entries));
  return NormalizeLinuxLive(payload).has_value();
}

bool Operation(const base::DictValue& op, bool nested) {
  const auto* type = op.FindString("type");
  if (!type) return false;
  const auto* target = op.FindString("target");
  if (*type == "create") {
    if (nested || op.size() != 4 || !Shape(op, "|type|id|incarnation|value|") ||
        !Identifier(op, "id", 128) || !Identifier(op, "incarnation") || !op.FindDict("value")) return false;
    auto folder = op.FindDict("value")->Clone();
    return Folder(folder, *op.FindString("id"));
  }
  if (*type == "delete" || *type == "claim") return !nested && op.size() == 3 && Shape(op, "|type|id|incarnation|") && Identifier(op, "id", 128) && Identifier(op, "incarnation");
  if (*type == "refresh") {
    if (nested || (op.size() != 6 && op.size() != 7) || !Shape(op, "|type|id|incarnation|generation|owner|operations|orders|") ||
        !Identifier(op, "id", 128) || !Identifier(op, "incarnation") || !Identifier(op, "owner", 128) ||
        LinuxDocumentInteger(op, "generation") < 0 || LinuxDocumentInteger(op, "generation") > kLinuxLiveMaxGeneration) return false;
    const auto* operations = op.Find("operations");
    if (!operations || !operations->is_list() || operations->GetList().size() > 2048) return false;
    for (const auto& child : operations->GetList()) {
      if (!child.is_dict() || !Operation(child.GetDict(), true) ||
          !child.GetDict().FindString("id") || *child.GetDict().FindString("id") != *op.FindString("id") ||
          !child.GetDict().FindString("incarnation") || *child.GetDict().FindString("incarnation") != *op.FindString("incarnation")) return false;
    }
    if (const auto* orders = op.Find("orders")) {
      if (!orders->is_dict() || !Shape(orders->GetDict(), "|items|hidden|completed|")) return false;
      for (const auto& [key, ids] : orders->GetDict()) if (!Strings(ids)) return false;
    }
    return true;
  }
  if (*type == "field") {
    const auto* field = op.FindString("field");
    const auto* value = op.Find("value");
    const auto* expected = op.Find("expected");
    if (nested || !target || !field || !value || !expected || !Shape(op, "|type|target|id|incarnation|field|expected|value|")) return false;
    const auto* id = op.FindString("id");
    if (*target == "folder") {
      if (op.size() != 7 || !Identifier(op, "id", 128) || !Identifier(op, "incarnation")) return false;
    } else if (*target == "calendar" || *target == "config") {
      if (op.size() != 5) return false;
    } else if (op.size() != 6 || !Identifier(op, "id", *target == "dismissedNow" ? kLinuxLiveMaxOccurrence : 128)) return false;
    return FieldValue(*target, *field, id ? *id : "", *value) &&
           (expected->is_none() || FieldValue(*target, *field, id ? *id : "", *expected));
  }
  if (*type == "member") {
    const auto* present = op.Find("present");
    if (!target || !Identifier(op, "member", 1024) || !present || !present->is_bool() || !Shape(op, "|type|target|id|incarnation|member|present|")) return false;
    if (*target == "known" || *target == "unread") return op.size() == 6 && Identifier(op, "id", 128) && Identifier(op, "incarnation");
    return !nested && op.size() == 4 && (*target == "hiddenCalendarIds" || *target == "dismissedAlerts");
  }
  if (*type == "entry") {
    const auto* value = op.Find("value");
    const auto* expected = op.Find("expected");
    return op.size() == 7 && Shape(op, "|type|target|id|incarnation|key|expected|value|") &&
      target && (*target == "items" || *target == "hidden" || *target == "completed") &&
      Identifier(op, "id", 128) && Identifier(op, "incarnation") && Identifier(op, "key", 1024) && value && expected &&
      Entry(*value, *target == "completed", *op.FindString("key")) && Entry(*expected, *target == "completed", *op.FindString("key"));
  }
  return !nested && *type == "place" && op.size() == 5 && Shape(op, "|type|id|incarnation|after|expected|") && Identifier(op, "id", 128) && Identifier(op, "incarnation") && NullableString(op.Find("after")) && NullableString(op.Find("expected"));
}

}

bool ValidLinuxLiveOperations(const base::ListValue& operations) {
  if (operations.size() > 2048) return false;
  size_t nodes = 0;
  if (!JsonSafe(base::Value(operations.Clone()), 0, nodes)) return false;
  for (const auto& operation : operations)
    if (!operation.is_dict() || !Operation(operation.GetDict(), false)) return false;
  return true;
}

bool AdvanceLinuxLiveGeneration(base::DictValue& generations, std::string_view id, int floor) {
  const int current = LinuxDocumentInteger(generations, id, 0);
  if (current < 0 || current >= kLinuxLiveMaxGeneration || floor < 0 || floor > kLinuxLiveMaxGeneration) return false;
  generations.Set(id, base::Value(std::max(current + 1, floor)));
  return true;
}

bool ValidLinuxLiveEnvelope(const base::DictValue& envelope) {
  if (LinuxDocumentInteger(envelope, "format") != 1 ||
      LinuxDocumentInteger(envelope, "revision") < 0 || !envelope.FindString("epoch") ||
      envelope.FindString("epoch")->empty() || !envelope.FindDict("payload")) return false;
  for (auto key : {"incarnations", "tombstones", "generations", "owners", "clients"})
    if (!envelope.FindDict(key)) return false;
  auto normalized = NormalizeLinuxLive(*envelope.FindDict("payload"));
  if (!normalized || *normalized != *envelope.FindDict("payload") || envelope.size() != 9) return false;
  const auto* folders = normalized->FindDict("folders");
  const auto* incarnations = envelope.FindDict("incarnations");
  if (folders->size() != incarnations->size()) return false;
  for (const auto& [id, incarnation] : *incarnations)
    if (!folders->contains(id) || !incarnation.is_string() || incarnation.GetString().empty()) return false;
  for (const auto& [id, tombstone] : *envelope.FindDict("tombstones"))
    if (folders->contains(id) || !tombstone.is_string() || tombstone.GetString().empty()) return false;
  for (const auto& [id, generation] : *envelope.FindDict("generations"))
    if (!generation.is_int() || generation.GetInt() < 0 || generation.GetInt() > 2147483000) return false;
  for (const auto& [id, owner] : *envelope.FindDict("owners"))
    if (!folders->contains(id) || !owner.is_string() || owner.GetString().empty()) return false;
  if (envelope.FindDict("clients")->size() > 256) return false;
  for (const auto& [id, receipt] : *envelope.FindDict("clients")) {
    if (id.empty() || id.size() > 128 || !receipt.is_dict() || receipt.GetDict().size() != 3 ||
        LinuxDocumentInteger(receipt.GetDict(), "sequence") < 1 ||
        LinuxDocumentInteger(receipt.GetDict(), "sequence") > 2147483000 ||
        !receipt.GetDict().FindString("requestId") ||
        *receipt.GetDict().FindString("requestId") != std::string(id) + ":" + std::to_string(LinuxDocumentInteger(receipt.GetDict(), "sequence")) ||
        !receipt.GetDict().Find("operations") || !receipt.GetDict().Find("operations")->is_list() ||
        !ValidLinuxLiveOperations(receipt.GetDict().Find("operations")->GetList())) return false;
  }
  size_t nodes = 0;
  return JsonSafe(base::Value(envelope.Clone()), 0, nodes);
}

}
