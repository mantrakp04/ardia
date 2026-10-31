#include "ardia/linux/ac_linux_session.h"

#include <cmath>
#include <map>
#include <set>
#include <string>
#include <string_view>
#include <utility>

#include "base/json/json_writer.h"

namespace ardia {
namespace {

bool PrototypeKey(std::string_view key) {
  return key == "__proto__" || key == "prototype" || key == "constructor";
}

struct Budget {
  size_t nodes = 0;
  size_t bytes = 0;
};

bool ValidValue(const base::Value& value, size_t depth, Budget& budget);

bool ValidDictionary(const base::DictValue& dict, size_t depth, Budget& budget) {
  if (depth > kLinuxSessionMaxDepth) return false;
  for (const auto& [key, value] : dict) {
    budget.bytes += key.size();
    if (budget.bytes > kLinuxSessionMaxBytes ||
        !ValidValue(value, depth + 1, budget)) return false;
  }
  return true;
}

bool ValidValue(const base::Value& value, size_t depth, Budget& budget) {
  if (depth > kLinuxSessionMaxDepth ||
      ++budget.nodes > kLinuxSessionMaxNodes) return false;
  if (value.is_string()) budget.bytes += value.GetString().size();
  if (budget.bytes > kLinuxSessionMaxBytes || value.is_blob() ||
      (value.is_double() && !std::isfinite(value.GetDouble()))) return false;
  if (value.is_dict()) return ValidDictionary(value.GetDict(), depth, budget);
  if (value.is_list()) {
    for (const base::Value& item : value.GetList()) {
      if (!ValidValue(item, depth + 1, budget)) return false;
    }
  }
  return true;
}

base::Value SafeClone(const base::Value& value);

base::DictValue SafeDictionary(const base::DictValue& dict) {
  base::DictValue result;
  for (const auto& [key, value] : dict) {
    if (!PrototypeKey(key)) result.Set(key, SafeClone(value));
  }
  return result;
}

base::Value SafeClone(const base::Value& value) {
  if (value.is_dict()) return base::Value(SafeDictionary(value.GetDict()));
  if (value.is_list()) {
    base::ListValue result;
    for (const base::Value& item : value.GetList()) result.Append(SafeClone(item));
    return base::Value(std::move(result));
  }
  return value.Clone();
}

bool Equivalent(const base::Value* left, const base::Value* right) {
  if (!left || !right) return left == right;
  if ((left->is_int() || left->is_double()) &&
      (right->is_int() || right->is_double())) {
    return left->GetDouble() == right->GetDouble();
  }
  if (left->type() != right->type()) return false;
  if (left->is_dict()) {
    if (left->GetDict().size() != right->GetDict().size()) return false;
    for (const auto& [key, value] : left->GetDict()) {
      if (!Equivalent(&value, right->GetDict().Find(key))) return false;
    }
    return true;
  }
  if (left->is_list()) {
    const auto& first = left->GetList();
    const auto& second = right->GetList();
    if (first.size() != second.size()) return false;
    for (size_t index = 0; index < first.size(); ++index) {
      if (!Equivalent(&first[index], &second[index])) return false;
    }
    return true;
  }
  return *left == *right;
}

class SessionMerger {
 public:
  std::optional<base::Value> Merge(const base::Value* base,
                                  const base::Value* local,
                                  const base::Value* current) {
    if (Equivalent(local, base)) {
      return current ? std::make_optional(current->Clone()) : std::nullopt;
    }
    if (!local) return std::nullopt;
    if (local->is_dict() && current && current->is_dict() &&
        (!base || base->is_dict())) {
      return base::Value(MergeDictionary(base ? &base->GetDict() : nullptr,
                                         local->GetDict(), current->GetDict()));
    }
    if (local->is_list() && (!base || base->is_list())) {
      return base::Value(MergeList(base ? &base->GetList() : nullptr,
                                  local->GetList(),
                                  current && current->is_list() ? &current->GetList() : nullptr));
    }
    return local->Clone();
  }

  bool ok() const { return ok_; }

 private:
  using Index = std::map<std::string, const base::Value*, std::less<>>;

  std::string Identity(const base::Value& item) {
    if (item.is_dict()) {
      if (const std::string* id = item.GetDict().FindString("id")) return "id:" + *id;
      const base::DictValue* tab = item.GetDict().FindDict("tab");
      if (tab) {
        if (const std::string* id = tab->FindString("id")) return "tab:" + *id;
      }
    }
    const auto json = base::WriteJsonWithOptions(
        item, base::OPTIONS_OMIT_DOUBLE_TYPE_PRESERVATION, kLinuxSessionMaxDepth);
    if (!json) {
      ok_ = false;
      return {};
    }
    return "json:" + *json;
  }

  Index Items(const base::ListValue* list) {
    Index result;
    if (list) {
      for (const base::Value& item : *list) result.try_emplace(Identity(item), &item);
    }
    return result;
  }

  base::DictValue MergeDictionary(const base::DictValue* base,
                                  const base::DictValue& local,
                                  const base::DictValue& current) {
    base::DictValue result = current.Clone();
    std::set<std::string, std::less<>> keys;
    if (base) {
      for (const auto& [key, value] : *base) keys.emplace(key);
    }
    for (const auto& [key, value] : local) keys.emplace(key);
    for (const std::string& key : keys) {
      const auto value = Merge(base ? base->Find(key) : nullptr,
                               local.Find(key), current.Find(key));
      if (value) result.Set(key, value->Clone());
      else result.Remove(key);
    }
    return result;
  }

  base::ListValue MergeList(const base::ListValue* base,
                            const base::ListValue& local,
                            const base::ListValue* current) {
    const Index original = Items(base);
    const Index remote = Items(current);
    const Index submitted = Items(&local);
    base::ListValue result;
    std::set<std::string, std::less<>> seen;
    for (const base::Value& item : local) {
      const std::string id = Identity(item);
      if (!seen.insert(id).second) continue;
      const auto old = original.find(id);
      const auto now = remote.find(id);
      auto merged = Merge(old == original.end() ? nullptr : old->second,
                           &item, now == remote.end() ? nullptr : now->second);
      if (merged) result.Append(std::move(*merged));
    }
    if (current) {
      for (const base::Value& item : *current) {
        const std::string id = Identity(item);
        if (!original.contains(id) && !submitted.contains(id) && seen.insert(id).second) {
          result.Append(item.Clone());
        }
      }
    }
    return result;
  }

  bool ok_ = true;
};

bool PrivateProfileId(const base::Value& value) {
  return value.is_string() && value.GetString().starts_with("incognito:");
}

bool ContainsPrivateIdentity(const base::Value& value) {
  if (value.is_list()) {
    for (const base::Value& item : value.GetList()) {
      if (ContainsPrivateIdentity(item)) return true;
    }
    return false;
  }
  if (!value.is_dict()) return false;
  for (const auto& [key, item] : value.GetDict()) {
    if ((key == "profileId" || key == "lastProfileId") && PrivateProfileId(item)) return true;
    if (ContainsPrivateIdentity(item)) return true;
  }
  return false;
}

bool ContainsPrivateSessionData(const base::DictValue& session) {
  for (const std::string_view table : {"profiles", "parkedPins", "pinChoices", "pinSync"}) {
    const base::DictValue* entries = session.FindDict(table);
    if (!entries) continue;
    for (const auto& [key, value] : *entries) {
      if (key.starts_with("incognito:")) return true;
    }
  }
  if (const base::Value* order = session.Find("profileOrder"); order && order->is_list()) {
    for (const base::Value& id : order->GetList()) {
      if (PrivateProfileId(id)) return true;
    }
  }
  if (const base::DictValue* windows = session.FindDict("windows")) {
    for (const auto& [id, window] : *windows) {
      if (!window.is_dict()) continue;
      const base::Value* incognito = window.GetDict().Find("incognito");
      if (incognito && incognito->is_bool() && incognito->GetBool()) return true;
      if (window.GetDict().Find("originalProfileId")) return true;
      const std::string* kind = window.GetDict().FindString("kind");
      if (kind && *kind == "private") return true;
    }
  }
  for (const auto& [key, value] : session) {
    if ((key == "lastProfileId" && PrivateProfileId(value)) || ContainsPrivateIdentity(value)) return true;
  }
  return false;
}

}

bool ValidLinuxSession(const base::DictValue& session) {
  Budget budget{1, 0};
  return ValidDictionary(session, 0, budget) && !ContainsPrivateSessionData(session);
}

std::optional<base::DictValue> MergeLinuxSession(
    const base::DictValue& base,
    const base::DictValue& local,
    const base::DictValue& current) {
  if (!ValidLinuxSession(base) || !ValidLinuxSession(local) ||
      !ValidLinuxSession(current)) return std::nullopt;
  const base::Value original(SafeDictionary(base));
  const base::Value submitted(SafeDictionary(local));
  const base::Value canonical(SafeDictionary(current));
  SessionMerger merger;
  auto result = merger.Merge(&original, &submitted, &canonical);
  if (!merger.ok() || !result || !result->is_dict() ||
      !ValidLinuxSession(result->GetDict())) return std::nullopt;
  const auto json = base::WriteJsonWithOptions(
      *result, base::OPTIONS_OMIT_DOUBLE_TYPE_PRESERVATION,
      kLinuxSessionMaxDepth);
  if (!json || json->size() > kLinuxSessionMaxBytes) return std::nullopt;
  return std::move(*result).TakeDict();
}

}
