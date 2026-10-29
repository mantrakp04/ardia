#include "ardia/linux/ac_linux_document_reducer.h"

#include <set>
#include <utility>

#include "ardia/linux/ac_linux_documents.h"

namespace ardia {
namespace {

const std::string* Text(const base::DictValue& value, std::string_view key) {
  return value.FindString(key);
}

bool Same(const base::Value* current, const base::Value* expected) {
  return expected && (current ? *current == *expected : expected->is_none());
}

void SetRecord(base::DictValue& root, const std::string& key,
               const std::string& id, const base::Value* value) {
  auto record = root.FindDict(key) ? root.FindDict(key)->Clone() : base::DictValue();
  if (value && !value->is_none()) record.Set(id, value->Clone());
  else record.Remove(id);
  root.Set(key, std::move(record));
}

bool Existing(const base::DictValue& envelope, const base::DictValue& op) {
  auto* id = Text(op, "id");
  auto* incarnation = Text(op, "incarnation");
  return id && incarnation && envelope.FindDict("payload")->FindDict("folders")->contains(*id) &&
         envelope.FindDict("incarnations")->FindString(*id) &&
         *envelope.FindDict("incarnations")->FindString(*id) == *incarnation;
}

bool Advance(base::DictValue& envelope, const std::string& id) {
  auto generations = envelope.FindDict("generations")->Clone();
  if (!AdvanceLinuxLiveGeneration(generations, id)) return false;
  envelope.Set("generations", std::move(generations));
  return true;
}

std::string EntryId(const base::Value& entry, bool completed) {
  if (!entry.is_dict()) return {};
  const auto* item = completed ? entry.GetDict().FindDict("item") : &entry.GetDict();
  return item && item->FindString("id") ? *item->FindString("id") : "";
}

std::string ApplyOne(base::DictValue& envelope, const base::DictValue& op,
                     const std::string& client, int observed) {
  const auto* type = Text(op, "type");
  if (!type) return "invalid";
  auto payload = envelope.FindDict("payload")->Clone();
  const auto* id = Text(op, "id");
  const auto* target = Text(op, "target");
  bool folder_change = false;
  bool global_change = false;
  if (*type == "create") {
    const auto* incarnation = Text(op, "incarnation");
    const auto* value = op.FindDict("value");
    if (op.size() != 4 || !id || id->empty() || id->size() > 128 || !incarnation ||
        incarnation->empty() || incarnation->size() > 160 || !value) return "invalid";
    if (payload.FindDict("folders")->contains(*id) || envelope.FindDict("tombstones")->contains(*id)) return "conflict";
    SetRecord(payload, "folders", *id, op.Find("value"));
    auto order = payload.Find("folderOrder")->GetList().Clone();
    order.Append(base::Value(std::string(*id)));
    payload.Set("folderOrder", base::Value(std::move(order)));
    SetRecord(envelope, "incarnations", *id, op.Find("incarnation"));
    folder_change = true;
  } else if (*type == "delete") {
    if (op.size() != 3 || !id || !Text(op, "incarnation")) return "invalid";
    if (!Existing(envelope, op)) return "conflict";
    for (auto key : {"folders", "items", "hidden", "completed", "known", "unread", "expandedStacks"}) SetRecord(payload, key, *id, nullptr);
    base::ListValue order;
    for (const auto& entry : payload.Find("folderOrder")->GetList()) if (entry.GetString() != *id) order.Append(entry.Clone());
    payload.Set("folderOrder", base::Value(std::move(order)));
    auto tombstones = envelope.FindDict("tombstones")->Clone();
    tombstones.Set(*id, *Text(op, "incarnation"));
    envelope.Set("tombstones", std::move(tombstones));
    SetRecord(envelope, "incarnations", *id, nullptr);
    SetRecord(envelope, "owners", *id, nullptr);
    folder_change = true;
  } else if (*type == "claim" || *type == "refresh") {
    if (!Existing(envelope, op)) return *type == "refresh" ? "stale" : "conflict";
    if (*type == "claim") {
      if (op.size() != 3) return "invalid";
      const auto* owner = envelope.FindDict("owners")->FindString(*id);
      if (owner && *owner != client) return "notOwner";
      auto owners = envelope.FindDict("owners")->Clone();
      owners.Set(*id, client);
      envelope.Set("owners", std::move(owners));
      if (!Advance(envelope, *id)) return "limit";
      return {};
    }
    const auto* owner = envelope.FindDict("owners")->FindString(*id);
    const auto* operations = op.Find("operations");
    if ((op.size() != 6 && op.size() != 7) || !Text(op, "owner") || !operations || !operations->is_list() ||
        operations->GetList().size() > kLinuxLiveMaxOperations) return "invalid";
    if (!owner || *owner != client || *Text(op, "owner") != client ||
        LinuxDocumentInteger(op, "generation") != LinuxDocumentInteger(*envelope.FindDict("generations"), *id, 0)) return "stale";
    auto refreshed = envelope.Clone();
    for (const auto& nested : operations->GetList()) {
      if (!nested.is_dict() || !Text(nested.GetDict(), "type") ||
          !Text(nested.GetDict(), "id") || *Text(nested.GetDict(), "id") != *id ||
          (*Text(nested.GetDict(), "type") != "entry" && *Text(nested.GetDict(), "type") != "member")) return "invalid";
      auto outcome = ApplyOne(refreshed, nested.GetDict(), client, observed);
      if (!outcome.empty()) return outcome == "conflict" ? "stale" : outcome;
    }
    if (const auto* orders = op.Find("orders")) {
      if (!orders->is_dict() || orders->GetDict().size() > 3) return "invalid";
      auto updated = refreshed.FindDict("payload")->Clone();
      for (const auto& [target_name, ids] : orders->GetDict()) {
        if ((target_name != "items" && target_name != "hidden" && target_name != "completed") || !ids.is_list()) return "invalid";
        auto entries = updated.FindDict(target_name)->Clone();
        auto* current = entries.Find(*id);
        if (ids.GetList().size() != (current ? current->GetList().size() : 0)) return "stale";
        std::set<std::string> seen;
        base::ListValue ordered;
        for (const auto& entry_id : ids.GetList()) {
          if (!entry_id.is_string() || !seen.insert(entry_id.GetString()).second) return "invalid";
          bool found = false;
          if (current) for (const auto& entry : current->GetList()) {
            if (EntryId(entry, target_name == "completed") != entry_id.GetString()) continue;
            ordered.Append(entry.Clone()); found = true; break;
          }
          if (!found) return "stale";
        }
        entries.Set(*id, base::Value(std::move(ordered)));
        updated.Set(target_name, std::move(entries));
      }
      refreshed.Set("payload", std::move(updated));
    }
    envelope = std::move(refreshed);
    return {};
  } else if (*type == "field") {
    auto* field = Text(op, "field");
    auto* expected = op.Find("expected");
    auto* value = op.Find("value");
    if (!target || !field || !value || !expected) return "invalid";
    std::string key;
    if (*target == "folder") {
      if (op.size() != 7 || !Existing(envelope, op)) return "conflict";
      if (std::set<std::string>{"name", "icon", "collapsed", "sources", "filters.authored", "filters.reviewRequests", "groupStacks", "showCompleted", "after"}.count(*field) == 0) return "invalid";
      auto folder = payload.FindDict("folders")->FindDict(*id)->Clone();
      if (field->starts_with("filters.")) {
        auto filters = folder.FindDict("filters")->Clone();
        const auto filter = field->substr(8);
        if (!Same(filters.Find(filter), expected)) return "conflict";
        filters.Set(filter, value->Clone());
        folder.Set("filters", std::move(filters));
      } else {
        if (!Same(folder.Find(*field), expected)) return "conflict";
        folder.Set(*field, value->Clone());
      }
      auto folders = payload.FindDict("folders")->Clone();
      folders.Set(*id, std::move(folder));
      payload.Set("folders", std::move(folders));
      folder_change = true;
    } else {
      if (*target == "calendar" || *target == "config") {
        if (op.size() != 5 || *field == "hiddenCalendarIds") return "invalid";
        key = *target;
      } else {
        if (op.size() != 6 || !id || *field != "value") return "invalid";
        if (*target == "account") key = "accounts";
        else if (*target == "meetingGroup") key = "meetingGroups";
        else if (*target == "expandedStack") key = "expandedStacks";
        else if (*target == "dismissedNow") key = "dismissedNow";
        else return "invalid";
      }
      auto record = payload.FindDict(key)->Clone();
      const auto& name = id ? *id : *field;
      if (!Same(record.Find(name), expected)) return "conflict";
      if (value->is_none()) record.Remove(name); else record.Set(name, value->Clone());
      payload.Set(key, std::move(record));
      global_change = key == "accounts" || key == "config";
    }
  } else if (*type == "member") {
    const auto* member = Text(op, "member");
    const auto* present = op.Find("present");
    if (!target || !member || member->empty() || member->size() > 1024 || !present || !present->is_bool()) return "invalid";
    std::string key;
    base::DictValue container;
    if (*target == "known" || *target == "unread") {
      if (op.size() != 6 || !Existing(envelope, op)) return "conflict";
      key = *id;
      container = payload.FindDict(*target)->Clone();
      folder_change = true;
    } else if (*target == "hiddenCalendarIds") {
      if (op.size() != 4) return "invalid";
      key = *target;
      container = payload.FindDict("calendar")->Clone();
    } else if (*target == "dismissedAlerts") {
      if (op.size() != 4) return "invalid";
      key = *target;
      container = payload.Clone();
    } else return "invalid";
    base::ListValue members;
    const auto* current = container.Find(key);
    if (current) for (const auto& entry : current->GetList()) if (entry.GetString() != *member) members.Append(entry.Clone());
    if (present->GetBool()) members.Append(base::Value(std::string(*member)));
    container.Set(key, base::Value(std::move(members)));
    if (*target == "dismissedAlerts") payload = std::move(container);
    else payload.Set(*target == "hiddenCalendarIds" ? "calendar" : *target, std::move(container));
  } else if (*type == "entry") {
    const auto* key = Text(op, "key");
    const auto* value = op.Find("value");
    if (op.size() != 7 || !id || !target || !key || !value || !op.Find("expected") ||
        (*target != "items" && *target != "hidden" && *target != "completed")) return "invalid";
    if (!Existing(envelope, op)) return "conflict";
    if (!value->is_none() && EntryId(*value, *target == "completed") != *key) return "invalid";
    auto entries = payload.FindDict(*target)->Clone();
    const auto* previous = entries.Find(*id);
    const base::Value* matching = nullptr;
    base::ListValue next;
    if (previous) for (const auto& entry : previous->GetList()) {
      if (EntryId(entry, *target == "completed") == *key) matching = &entry;
      else next.Append(entry.Clone());
    }
    if (!Same(matching, op.Find("expected"))) return "conflict";
    if (!value->is_none()) next.Append(value->Clone());
    entries.Set(*id, base::Value(std::move(next)));
    payload.Set(*target, std::move(entries));
    folder_change = true;
  } else if (*type == "place") {
    const auto* after = op.Find("after");
    if (op.size() != 5 || !id || !after || (!after->is_none() && !after->is_string()) || !op.Find("expected")) return "invalid";
    if (!Existing(envelope, op)) return "conflict";
    if (after->is_string() && (*id == after->GetString() || !payload.FindDict("folders")->contains(after->GetString()))) return "conflict";
    const auto& order = payload.Find("folderOrder")->GetList();
    base::Value predecessor;
    for (const auto& entry : order) {
      if (entry.GetString() == *id) break;
      predecessor = entry.Clone();
    }
    if (!Same(&predecessor, op.Find("expected"))) return "conflict";
    base::ListValue next;
    if (after->is_none()) next.Append(base::Value(std::string(*id)));
    for (const auto& entry : order) {
      if (entry.GetString() == *id) continue;
      next.Append(entry.Clone());
      if (entry == *after) next.Append(base::Value(std::string(*id)));
    }
    payload.Set("folderOrder", base::Value(std::move(next)));
  } else return "invalid";
  auto normalized = NormalizeLinuxLive(payload);
  if (!normalized) return "invalid";
  envelope.Set("payload", std::move(*normalized));
  if (folder_change && !Advance(envelope, *id)) return "limit";
  if (global_change) for (const auto& [folder, record] : *envelope.FindDict("payload")->FindDict("folders")) if (!Advance(envelope, std::string(folder))) return "limit";
  return {};
}

}

std::string ApplyLinuxLiveOperations(base::DictValue& envelope,
                                    const base::ListValue& operations,
                                    const std::string& client,
                                    int observed_revision) {
  if (!ValidLinuxLiveOperations(operations)) return "invalid";
  if (observed_revision > LinuxDocumentInteger(envelope, "revision")) return "invalid";
  bool superseded = false;
  for (const auto& op : operations) {
    if (!op.is_dict()) return "invalid";
    auto outcome = ApplyOne(envelope, op.GetDict(), client, observed_revision);
    if (outcome == "stale") superseded = true;
    else if (!outcome.empty()) return outcome;
  }
  return superseded ? "superseded" : "";
}

}
