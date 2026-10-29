#ifndef ARDIA_LINUX_AC_LINUX_SUGGEST_POLICY_H_
#define ARDIA_LINUX_AC_LINUX_SUGGEST_POLICY_H_

#include <algorithm>
#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace ardia::linux_suggest_policy {

inline constexpr std::string_view kEndpoints[] = {
    "https://suggestqueries.google.com/complete/search",
    "https://api.bing.com/osjson.aspx",
    "https://duckduckgo.com/ac/",
    "https://ac.ecosia.org/autocomplete",
    "https://search.brave.com/api/suggest",
    "https://www.startpage.com/osuggestions",
    "https://search.yahoo.com/sugg/ff",
    "https://www.baidu.com/su",
    "https://suggest.yandex.com/suggest-ff.cgi",
};

inline constexpr size_t kMaxRequestLength = 2048;
inline constexpr size_t kMaxReplyBytes = 64 * 1024;
inline constexpr int kTimeoutSeconds = 5;
inline constexpr int kMaxInFlightPerWindow = 4;

inline bool ValidRequestId(std::string_view id) {
  if (id.empty() || id.size() > 64) {
    return false;
  }
  for (const char c : id) {
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') || c == '-' || c == '_')) {
      return false;
    }
  }
  return true;
}

class SuggestionSlots {
 public:
  std::vector<std::string> Admit(std::string_view id) {
    std::vector<std::string> evicted;
    if (Remove(id)) {
      evicted.emplace_back(id);
    }
    order_.emplace_back(id);
    while (order_.size() > static_cast<size_t>(kMaxInFlightPerWindow)) {
      evicted.push_back(order_.front());
      order_.erase(order_.begin());
    }
    return evicted;
  }
  bool Remove(std::string_view id) {
    const auto found = std::find(order_.begin(), order_.end(), id);
    if (found == order_.end()) {
      return false;
    }
    order_.erase(found);
    return true;
  }
  bool Contains(std::string_view id) const {
    return std::find(order_.begin(), order_.end(), id) != order_.end();
  }
  size_t size() const { return order_.size(); }

 private:
  std::vector<std::string> order_;
};

enum class SuggestionsSetting { kUnknown, kOn, kOff };

inline SuggestionsSetting SettingFrom(std::optional<bool> stored) {
  return stored.value_or(true) ? SuggestionsSetting::kOn : SuggestionsSetting::kOff;
}

inline bool Allowed(SuggestionsSetting setting) {
  return setting == SuggestionsSetting::kOn;
}

inline bool RequestAllowed(std::string_view url) {
  if (url.empty() || url.size() > kMaxRequestLength) {
    return false;
  }
  for (const char c : url) {
    const unsigned char byte = static_cast<unsigned char>(c);
    if (byte <= 0x20 || byte >= 0x7f || c == '#' || c == '\\') {
      return false;
    }
  }
  for (const std::string_view endpoint : kEndpoints) {
    if (url.size() > endpoint.size() + 1 && url.starts_with(endpoint) &&
        url[endpoint.size()] == '?') {
      return true;
    }
  }
  return false;
}

inline bool ValidUtf8(std::string_view text) {
  size_t at = 0;
  while (at < text.size()) {
    const unsigned char lead = static_cast<unsigned char>(text[at]);
    size_t extra = 0;
    unsigned int point = 0;
    if (lead < 0x80) {
      ++at;
      continue;
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      extra = 1;
      point = lead & 0x1f;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      extra = 2;
      point = lead & 0x0f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      extra = 3;
      point = lead & 0x07;
    } else {
      return false;
    }
    if (extra > text.size() - at - 1) {
      return false;
    }
    for (size_t i = 1; i <= extra; ++i) {
      const unsigned char next = static_cast<unsigned char>(text[at + i]);
      if ((next & 0xc0) != 0x80) {
        return false;
      }
      point = (point << 6) | (next & 0x3f);
    }
    if ((extra == 2 && (point < 0x800 || (point >= 0xd800 && point <= 0xdfff))) ||
        (extra == 3 && (point < 0x10000 || point > 0x10ffff))) {
      return false;
    }
    at += extra + 1;
  }
  return true;
}

inline bool ReplyAcceptable(int status, std::string_view body) {
  if (status != 200 || body.empty() || body.size() > kMaxReplyBytes ||
      !ValidUtf8(body)) {
    return false;
  }
  for (const char c : body) {
    if (c == ' ' || c == '\n' || c == '\r' || c == '\t') {
      continue;
    }
    return c == '[';
  }
  return false;
}

}

#endif
