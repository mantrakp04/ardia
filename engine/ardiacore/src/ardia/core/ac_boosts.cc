// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_boosts.h"

#include <cmath>
#include <limits>
#include <set>
#include <utility>

#include "base/json/json_reader.h"
#include "base/strings/string_util.h"
#include "base/values.h"
#include "net/base/registry_controlled_domains/registry_controlled_domain.h"
#include "url/gurl.h"

namespace ardiacore {

namespace {

constexpr size_t kMaxBoosts = 1000;
constexpr size_t kMaxBoostListBytes = 32 * 1024 * 1024;
constexpr size_t kMaxBoostSourceBytes = 1024 * 1024;
constexpr size_t kMaxBoostIdBytes = 128;
constexpr size_t kMaxBoostDomainBytes = 253;
constexpr int kBoostZooms[] = {90, 100, 110, 125, 150};

std::string BareHost(std::string_view host) {
  std::string bare = base::ToLowerASCII(base::TrimWhitespaceASCII(host, base::TRIM_ALL));
  if (bare.ends_with('.')) {
    bare.pop_back();
  }
  if (bare.starts_with("www.")) {
    bare.erase(0, 4);
  }
  return bare;
}

bool BoostableDomain(const std::string& domain) {
  return domain == "localhost" ||
         !net::registry_controlled_domains::GetDomainAndRegistry(
              domain, net::registry_controlled_domains::INCLUDE_PRIVATE_REGISTRIES)
              .empty();
}

std::optional<Boost> BoostFromValue(const base::Value& value) {
  const base::DictValue* dict = value.GetIfDict();
  if (!dict) {
    return std::nullopt;
  }
  const std::string* id = dict->FindString("id");
  const std::string* domain = dict->FindString("domain");
  const std::string* css = dict->FindString("css");
  const std::string* js = dict->FindString("js");
  std::optional<bool> subdomains = dict->FindBool("subdomains");
  std::optional<double> zoom = dict->FindDouble("zoom");
  if (!id || !domain || !css || !js || !subdomains || !zoom) {
    return std::nullopt;
  }
  if (id->empty() || id->size() > kMaxBoostIdBytes || domain->size() > kMaxBoostDomainBytes ||
      !BoostableDomain(BareHost(*domain)) || css->size() > kMaxBoostSourceBytes ||
      js->size() > kMaxBoostSourceBytes) {
    return std::nullopt;
  }
  Boost boost;
  boost.id = *id;
  boost.domain = BareHost(*domain);
  boost.subdomains = *subdomains;
  boost.css = *css;
  boost.js = *js;
  bool known_zoom = false;
  for (int allowed : kBoostZooms) {
    known_zoom |= *zoom == allowed;
  }
  if (!known_zoom) {
    return std::nullopt;
  }
  boost.zoom = static_cast<int>(*zoom);
  if (const base::Value* color = dict->Find("color"); color && !color->is_none()) {
    const base::ListValue* list = color->GetIfList();
    if (!list || list->size() != 20) {
      return std::nullopt;
    }
    std::array<float, 20> matrix;
    for (size_t i = 0; i < matrix.size(); ++i) {
      if (!(*list)[i].is_double() && !(*list)[i].is_int()) {
        return std::nullopt;
      }
      const double entry = (*list)[i].GetDouble();
      if (!std::isfinite(entry) || std::abs(entry) > std::numeric_limits<float>::max()) {
        return std::nullopt;
      }
      matrix[i] = static_cast<float>(entry);
    }
    boost.color = matrix;
  }
  if (const base::Value* scheme = dict->Find("scheme"); scheme && !scheme->is_none()) {
    if (!scheme->is_int() || scheme->GetInt() < 0 || scheme->GetInt() > 1) {
      return std::nullopt;
    }
    boost.scheme = scheme->GetInt();
  }
  return boost;
}

}

std::optional<Boost> ParseBoost(std::string_view json) {
  if (json.size() > kMaxBoostListBytes) {
    return std::nullopt;
  }
  std::optional<base::Value> value = base::JSONReader::Read(json, base::JSON_PARSE_RFC);
  return value ? BoostFromValue(*value) : std::nullopt;
}

std::optional<Boosts> ParseBoosts(std::string_view json) {
  if (json.size() > kMaxBoostListBytes) {
    return std::nullopt;
  }
  std::optional<base::Value> value = base::JSONReader::Read(json, base::JSON_PARSE_RFC);
  if (!value || !value->is_list() || value->GetList().size() > kMaxBoosts) {
    return std::nullopt;
  }
  Boosts boosts;
  std::set<std::string> ids;
  for (const base::Value& entry : value->GetList()) {
    std::optional<Boost> boost = BoostFromValue(entry);
    if (!boost || !ids.insert(boost->id).second) {
      return std::nullopt;
    }
    boosts.push_back(std::move(*boost));
  }
  return boosts;
}

bool BoostMatchesHost(const Boost& boost, std::string_view host) {
  const std::string h = base::ToLowerASCII(base::TrimWhitespaceASCII(host, base::TRIM_ALL));
  std::string_view trimmed = h;
  if (trimmed.ends_with('.')) {
    trimmed.remove_suffix(1);
  }
  if (boost.domain.empty() || trimmed.empty()) {
    return false;
  }
  if (trimmed == boost.domain) {
    return true;
  }
  if (trimmed.size() == boost.domain.size() + 4 && trimmed.starts_with("www.") &&
      trimmed.ends_with(boost.domain)) {
    return true;
  }
  return boost.subdomains && trimmed.size() > boost.domain.size() + 1 &&
         trimmed.ends_with(boost.domain) &&
         trimmed[trimmed.size() - boost.domain.size() - 1] == '.';
}

BoostEffect EffectOfBoosts(const Boosts& boosts, const Boost* preview, const GURL& url) {
  BoostEffect effect;
  if (!url.SchemeIsHTTPOrHTTPS()) {
    return effect;
  }
  auto add = [&](const Boost& boost) {
    if (!BoostMatchesHost(boost, url.host())) {
      return;
    }
    effect.css += boost.css;
    effect.css += '\n';
    if (!boost.js.empty()) {
      effect.scripts.push_back(boost.js);
    }
    if (boost.zoom != 100) {
      effect.zoom = boost.zoom;
    }
    if (boost.color) {
      effect.color = boost.color;
    }
    if (boost.scheme) {
      effect.scheme = boost.scheme;
    }
  };
  bool previewed = false;
  for (const Boost& boost : boosts) {
    if (preview && boost.id == preview->id) {
      add(*preview);
      previewed = true;
    } else {
      add(boost);
    }
  }
  if (preview && !previewed) {
    add(*preview);
  }
  return effect;
}

}
