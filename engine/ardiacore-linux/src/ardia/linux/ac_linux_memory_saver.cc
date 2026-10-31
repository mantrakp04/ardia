#include "ardia/linux/ac_linux_memory_saver.h"

#include <string>
#include <utility>

namespace ardiacore {
namespace {

constexpr std::string_view kStates[] = {"on", "off"};
constexpr std::string_view kModes[] = {"moderate", "balanced", "maximum"};

template <std::size_t N>
bool OneOf(const base::Value* value, const std::string_view (&names)[N]) {
  if (!value || !value->is_string()) return false;
  for (const std::string_view name : names) {
    if (value->GetString() == name) return true;
  }
  return false;
}

bool SiteText(std::string_view site) {
  if (site.empty() || site.size() > kLinuxKeepActiveSiteLength) return false;
  for (const char c : site) {
    if (static_cast<unsigned char>(c) < 0x20 || c == 0x7f) return false;
  }
  return true;
}

std::optional<base::ListValue> Strings(const base::Value* value) {
  if (!value || !value->is_list()) return std::nullopt;
  base::ListValue strings;
  for (const base::Value& item : value->GetList()) {
    if (!item.is_string()) return std::nullopt;
    strings.Append(item.Clone());
  }
  return strings;
}

std::optional<base::DictValue> PrepareSettings(const base::DictValue& args) {
  base::DictValue prepared;
  for (const auto [key, value] : args) {
    if (key == "state" && OneOf(&value, kStates)) {
      prepared.Set(key, value.Clone());
    } else if (key == "aggressiveness" && OneOf(&value, kModes)) {
      prepared.Set(key, value.Clone());
    } else if (key == "sites" && value.is_list() && value.GetList().size() <= kLinuxKeepActiveSiteLimit) {
      base::ListValue sites;
      for (const base::Value& site : value.GetList()) {
        if (!site.is_string()) return std::nullopt;
        if (SiteText(site.GetString())) sites.Append(site.Clone());
      }
      prepared.Set(key, base::Value(std::move(sites)));
    } else {
      return std::nullopt;
    }
  }
  return prepared;
}

}

bool IsLinuxMemorySaverRoute(std::string_view name) {
  for (const char* route : kLinuxMemorySaverRoutes) {
    if (name == route) return true;
  }
  return false;
}

std::optional<base::DictValue> PrepareLinuxMemorySaver(std::string_view method, const base::DictValue& args) {
  if (method == "engine.memorySaver") return PrepareSettings(args);
  if (method != "engine.validateKeepActiveSite" || args.size() != 1) return std::nullopt;
  const std::string* site = args.FindString("site");
  if (!site || !SiteText(*site)) return std::nullopt;
  return base::DictValue().Set("validate", *site);
}

std::optional<base::DictValue> CompleteLinuxMemorySaver(std::string_view method, const base::DictValue& reply) {
  if (method == "engine.validateKeepActiveSite") {
    const base::Value* valid = reply.Find("valid");
    if (!valid || !valid->is_bool()) return std::nullopt;
    return base::DictValue().Set("valid", base::Value(valid->GetBool()));
  }
  if (method != "engine.memorySaver") return std::nullopt;
  const base::Value* state = reply.Find("state");
  const base::Value* mode = reply.Find("aggressiveness");
  const base::Value* active = reply.Find("active");
  auto sites = Strings(reply.Find("sites"));
  auto invalid = Strings(reply.Find("invalid"));
  if (!OneOf(state, kStates) || !OneOf(mode, kModes) || !active || !active->is_bool() || !sites || !invalid) {
    return std::nullopt;
  }
  return base::DictValue()
      .Set("state", state->Clone())
      .Set("aggressiveness", mode->Clone())
      .Set("active", base::Value(active->GetBool()))
      .Set("sites", base::Value(std::move(*sites)))
      .Set("invalid", base::Value(std::move(*invalid)));
}

}
