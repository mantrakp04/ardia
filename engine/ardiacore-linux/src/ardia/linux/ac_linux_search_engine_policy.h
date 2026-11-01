#ifndef ARDIA_LINUX_AC_LINUX_SEARCH_ENGINE_POLICY_H_
#define ARDIA_LINUX_AC_LINUX_SEARCH_ENGINE_POLICY_H_

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace ardiacore::linux_search_engines {

inline constexpr char kOwnedEngineGuid[] = "5b8e2f4a-1c3d-4e6f-9a7b-0d2c4e6f8a1b";
inline constexpr char16_t kOwnedEngineKeyword[] = u"ardia-default-search-engine";
inline constexpr size_t kMaxNameLength = 256;
inline constexpr size_t kMaxKeywordLength = 256;
inline constexpr size_t kMaxUrlLength = 2048;

struct Request {
  std::string name;
  std::string keyword;
  std::string url;
};

struct Engine {
  std::string name;
  std::string host;
  bool selectable = false;
  bool owned = false;
};

enum class Step { kNothing, kNoMatch, kSelectExisting, kSelectOwned, kUpdateOwned, kAddOwned };

struct Plan {
  Step step = Step::kNothing;
  std::optional<size_t> engine;
  bool remove_owned = false;
};

inline char LowerAscii(char c) {
  return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c;
}

inline bool EqualsIgnoringCase(std::string_view a, std::string_view b) {
  if (a.size() != b.size()) return false;
  for (size_t i = 0; i < a.size(); ++i) {
    if (LowerAscii(a[i]) != LowerAscii(b[i])) return false;
  }
  return true;
}

inline bool StartsWithIgnoringCase(std::string_view text, std::string_view prefix) {
  return text.size() >= prefix.size() && EqualsIgnoringCase(text.substr(0, prefix.size()), prefix);
}

inline bool IsAsciiSpace(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}

inline bool Blank(std::string_view text) {
  for (const char c : text) {
    if (!IsAsciiSpace(c)) return false;
  }
  return true;
}

inline size_t CodePoints(std::string_view text) {
  size_t count = 0;
  for (const char c : text) {
    if ((static_cast<unsigned char>(c) & 0xC0) != 0x80) ++count;
  }
  return count;
}

inline bool HasControlCharacters(std::string_view text) {
  for (size_t i = 0; i < text.size(); ++i) {
    const unsigned char c = static_cast<unsigned char>(text[i]);
    if (c < 0x20 || c == 0x7F) return true;
    if (c == 0xC2 && i + 1 < text.size()) {
      const unsigned char next = static_cast<unsigned char>(text[i + 1]);
      if (next >= 0x80 && next <= 0x9F) return true;
    }
  }
  return false;
}

inline bool IsHttpUrl(std::string_view url) {
  return StartsWithIgnoringCase(url, "http://") || StartsWithIgnoringCase(url, "https://");
}

inline std::string HostOf(std::string_view url) {
  const size_t scheme = url.find("://");
  if (scheme == std::string_view::npos) return std::string();
  std::string_view authority = url.substr(scheme + 3);
  authority = authority.substr(0, authority.find_first_of("/?#"));
  if (const size_t at = authority.rfind('@'); at != std::string_view::npos) authority = authority.substr(at + 1);
  if (!authority.empty() && authority.front() == '[') {
    const size_t close = authority.find(']');
    authority = close == std::string_view::npos ? std::string_view() : authority.substr(0, close + 1);
  } else {
    authority = authority.substr(0, authority.find(':'));
  }
  std::string host;
  host.reserve(authority.size());
  for (const char c : authority) host.push_back(LowerAscii(c));
  return host;
}

inline std::optional<std::string> Validate(const Request& request) {
  if (Blank(request.name)) return "A search engine name is required";
  if (CodePoints(request.name) > kMaxNameLength) return "The search engine name is longer than 256 characters";
  if (CodePoints(request.keyword) > kMaxKeywordLength) return "The search engine keyword is longer than 256 characters";
  if (HasControlCharacters(request.name)) return "The search engine name contains control characters";
  if (HasControlCharacters(request.keyword)) return "The search engine keyword contains control characters";
  if (request.url.empty()) return std::nullopt;
  if (request.url.size() > kMaxUrlLength) return "The search engine URL is longer than 2048 characters";
  if (HasControlCharacters(request.url)) return "The search engine URL contains control characters";
  if (!IsHttpUrl(request.url) || HostOf(request.url).empty()) {
    return "The search engine URL must start with http:// or https:// and name a host";
  }
  if (request.url.find("%s") == std::string::npos) return "The search engine URL must contain %s where the search terms go";
  return std::nullopt;
}

inline std::string ChromeTemplate(std::string_view url) {
  std::string chrome;
  chrome.reserve(url.size() + 16);
  for (size_t i = 0; i < url.size(); ++i) {
    if (url[i] == '%' && i + 1 < url.size() && url[i + 1] == 's') {
      chrome += "{searchTerms}";
      ++i;
    } else if (url[i] == '{') {
      chrome += "%7B";
    } else if (url[i] == '}') {
      chrome += "%7D";
    } else {
      chrome.push_back(url[i]);
    }
  }
  return chrome;
}

inline Plan Decide(const Request& request, std::string_view host, const std::vector<Engine>& engines, bool owned_current) {
  std::optional<size_t> owned;
  for (size_t i = 0; i < engines.size(); ++i) {
    if (engines[i].owned) owned = i;
  }
  for (size_t i = 0; i < engines.size(); ++i) {
    const Engine& engine = engines[i];
    if (!engine.selectable || engine.owned || !EqualsIgnoringCase(engine.name, request.name)) continue;
    if (request.url.empty() || (!host.empty() && EqualsIgnoringCase(engine.host, host))) {
      return Plan{Step::kSelectExisting, i, owned.has_value()};
    }
  }
  if (request.url.empty()) {
    if (owned && engines[*owned].selectable && EqualsIgnoringCase(engines[*owned].name, request.name)) {
      return Plan{Step::kSelectOwned, owned, false};
    }
    return Plan{Step::kNoMatch, std::nullopt, false};
  }
  if (owned) return Plan{owned_current ? Step::kSelectOwned : Step::kUpdateOwned, owned, false};
  return Plan{Step::kAddOwned, std::nullopt, false};
}

}

#endif
