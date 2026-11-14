#pragma once

#include <array>
#include <cstring>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "Paths.h"
#include "SyncCrypto.h"
#include "SyncWordlist.h"

namespace Ardia::SyncPhrase {

using SyncCrypto::WipedBytes;
using SyncCrypto::WipedString;

constexpr size_t WordCount = 24;

struct Problem {
  std::string error;
  size_t count = 0;
  std::string word;
};

inline std::map<std::string_view, size_t> const &Lookup() {
  static const std::map<std::string_view, size_t> lookup = [] {
    std::map<std::string_view, size_t> built;
    auto const &words = SyncWordlist::English();
    for (size_t i = 0; i < words.size(); i++) built.emplace(words[i], i);
    return built;
  }();
  return lookup;
}

inline std::map<std::string_view, size_t> const &Prefixes() {
  static const std::map<std::string_view, size_t> prefixes = [] {
    std::map<std::string_view, size_t> built;
    auto const &words = SyncWordlist::English();
    for (size_t i = 0; i < words.size(); i++) built[words[i].substr(0, 4)] = i;
    return built;
  }();
  return prefixes;
}

inline std::optional<std::vector<std::string>> Words(WipedBytes const &entropy) {
  if (entropy.size() != SyncCrypto::KeyBytes) return std::nullopt;
  std::optional<std::array<uint8_t, 32>> digest = SyncCrypto::Sha256(entropy.view());
  if (!digest) return std::nullopt;
  WipedBytes bits(entropy.size() + 1);
  memcpy(bits.data(), entropy.data(), entropy.size());
  bits.data()[entropy.size()] = (*digest)[0];
  std::vector<std::string> out;
  auto const &words = SyncWordlist::English();
  for (size_t word = 0; word < WordCount; word++) {
    size_t index = 0;
    for (size_t bit = word * 11; bit < word * 11 + 11; bit++) index = (index << 1) | ((bits.data()[bit / 8] >> (7 - bit % 8)) & 1);
    out.emplace_back(words[index]);
  }
  return out;
}

inline std::vector<WipedString> Tokens(std::string_view text) {
  std::wstring wide = Paths::Wide(text);
  std::vector<WipedString> tokens;
  if (!wide.empty()) {
    int size = LCMapStringEx(LOCALE_NAME_INVARIANT, LCMAP_LOWERCASE, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr, 0);
    std::wstring lower(static_cast<size_t>(size > 0 ? size : 0), L'\0');
    if (size > 0) LCMapStringEx(LOCALE_NAME_INVARIANT, LCMAP_LOWERCASE, wide.data(), static_cast<int>(wide.size()), lower.data(), size, nullptr, nullptr, 0);
    std::vector<WORD> kinds(lower.size());
    if (!lower.empty()) GetStringTypeW(CT_CTYPE1, lower.data(), static_cast<int>(lower.size()), kinds.data());
    std::wstring current;
    auto finish = [&]() {
      if (!current.empty()) tokens.emplace_back(Paths::Utf8(current));
      SecureZeroMemory(current.data(), current.size() * sizeof(wchar_t));
      current.clear();
    };
    for (size_t i = 0; i < lower.size(); i++) {
      bool letter = (kinds[i] & C1_LOWER) && (kinds[i] & C1_ALPHA);
      if (letter) current.push_back(lower[i]);
      else finish();
    }
    finish();
    SecureZeroMemory(lower.data(), lower.size() * sizeof(wchar_t));
  }
  SecureZeroMemory(wide.data(), wide.size() * sizeof(wchar_t));
  return tokens;
}

inline std::optional<size_t> IndexOf(std::string const &token) {
  auto exact = Lookup().find(token);
  if (exact != Lookup().end()) return exact->second;
  if (token.size() < 4) return std::nullopt;
  auto prefixed = Prefixes().find(std::string_view{token}.substr(0, 4));
  if (prefixed == Prefixes().end()) return std::nullopt;
  std::string_view word = SyncWordlist::English()[prefixed->second];
  return word.rfind(token, 0) == 0 ? std::optional<size_t>{prefixed->second} : std::nullopt;
}

inline std::variant<WipedBytes, Problem> Entropy(std::string_view text) {
  std::vector<WipedString> tokens = Tokens(text);
  if (tokens.size() != WordCount) return Problem{"wordCount", tokens.size(), {}};
  WipedBytes bits(WordCount * 11 / 8);
  for (size_t word = 0; word < WordCount; word++) {
    std::optional<size_t> index = IndexOf(tokens[word].text());
    if (!index) return Problem{"unknownWord", 0, tokens[word].text()};
    for (size_t bit = 0; bit < 11; bit++) {
      size_t at = word * 11 + bit;
      if ((*index >> (10 - bit)) & 1) bits.data()[at / 8] |= static_cast<uint8_t>(1 << (7 - at % 8));
    }
  }
  WipedBytes entropy(bits.data(), SyncCrypto::KeyBytes);
  std::optional<std::array<uint8_t, 32>> digest = SyncCrypto::Sha256(entropy.view());
  if (!digest || (*digest)[0] != bits.data()[SyncCrypto::KeyBytes]) return Problem{"checksum", 0, {}};
  return std::move(entropy);
}

}
