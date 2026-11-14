// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_AC_BOOSTS_H_
#define ARDIA_CORE_AC_BOOSTS_H_

#include <array>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

class GURL;

namespace ardiacore {

struct Boost {
  std::string id;
  std::string domain;
  bool subdomains = false;
  std::string css;
  std::string js;
  int zoom = 100;
  std::optional<std::array<float, 20>> color;
  std::optional<int> scheme;
};

using Boosts = std::vector<Boost>;

struct BoostEffect {
  std::string css;
  std::vector<std::string> scripts;
  int zoom = 100;
  std::optional<std::array<float, 20>> color;
  std::optional<int> scheme;
};

std::optional<Boosts> ParseBoosts(std::string_view json);
std::optional<Boost> ParseBoost(std::string_view json);

bool BoostMatchesHost(const Boost& boost, std::string_view host);

BoostEffect EffectOfBoosts(const Boosts& boosts, const Boost* preview, const GURL& url);

}

#endif
