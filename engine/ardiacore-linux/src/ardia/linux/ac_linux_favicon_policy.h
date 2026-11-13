#ifndef ARDIA_LINUX_AC_LINUX_FAVICON_POLICY_H_
#define ARDIA_LINUX_AC_LINUX_FAVICON_POLICY_H_

#include <algorithm>
#include <array>
#include <cstdint>
#include <optional>
#include <string_view>
#include <utility>
#include <vector>

namespace ardiacore::linux_favicons {

inline constexpr int kPixels = 64;
inline constexpr int64_t kMaxBytes = 2 * 1024 * 1024;
inline constexpr size_t kMaxUrlLength = 2 * 1024 * 1024;
inline constexpr int kTimeoutSeconds = 30;

enum class Source { kPage, kNetwork };

inline bool StartsWithLowercase(std::string_view text, std::string_view prefix) {
  if (text.size() < prefix.size()) return false;
  for (size_t i = 0; i < prefix.size(); ++i) {
    char c = text[i];
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    if (c != prefix[i]) return false;
  }
  return true;
}

inline bool Allowed(std::string_view url, Source source) {
  if (url.empty() || url.size() > kMaxUrlLength) return false;
  if (StartsWithLowercase(url, "https://") || StartsWithLowercase(url, "http://")) return true;
  return source == Source::kPage && StartsWithLowercase(url, "data:image/");
}

inline std::optional<std::array<int, 4>> Ipv4(std::string_view host) {
  std::array<int, 4> parts{};
  size_t index = 0;
  int value = -1;
  for (char c : host) {
    if (c == '.') {
      if (value < 0 || index >= 3) return std::nullopt;
      parts[index++] = value;
      value = -1;
    } else if (c >= '0' && c <= '9') {
      value = (value < 0 ? 0 : value * 10) + (c - '0');
      if (value > 255) return std::nullopt;
    } else {
      return std::nullopt;
    }
  }
  if (value < 0 || index != 3) return std::nullopt;
  parts[3] = value;
  return parts;
}

inline bool PublicIpv4(const std::array<int, 4>& ip) {
  const int a = ip[0], b = ip[1];
  if (a == 0 || a == 10 || a == 127 || a >= 224) return false;
  if (a == 100 && b >= 64 && b <= 127) return false;
  if (a == 169 && b == 254) return false;
  if (a == 172 && b >= 16 && b <= 31) return false;
  if (a == 192 && (b == 168 || (b == 0 && ip[2] == 0))) return false;
  if (a == 198 && (b == 18 || b == 19)) return false;
  return true;
}

inline std::optional<std::vector<int>> Ipv6(std::string_view host) {
  std::vector<int> head, tail;
  bool gap = false;
  size_t start = 0;
  if (host.starts_with("::")) { gap = true; start = 2; }
  while (start < host.size()) {
    const size_t end = std::min(host.find(':', start), host.size());
    const std::string_view group = host.substr(start, end - start);
    if (group.empty() || group.size() > 4) {
      if (!group.empty() || gap) return std::nullopt;
      gap = true;
      start = end + 1;
      continue;
    }
    int value = 0;
    for (char c : group) {
      const int digit = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10
                      : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1;
      if (digit < 0) return std::nullopt;
      value = value * 16 + digit;
    }
    (gap ? tail : head).push_back(value);
    if (end == host.size()) break;
    start = end + 1;
    if (start < host.size() && host[start] == ':') {
      if (gap) return std::nullopt;
      gap = true;
      ++start;
    }
  }
  if (head.size() + tail.size() > 8 || (!gap && head.size() != 8)) return std::nullopt;
  std::vector<int> groups = head;
  groups.resize(8 - tail.size(), 0);
  groups.insert(groups.end(), tail.begin(), tail.end());
  return groups;
}

inline bool PublicIpv6(const std::vector<int>& ip) {
  bool zero_prefix = true;
  for (size_t i = 0; i < 5; ++i) zero_prefix = zero_prefix && ip[i] == 0;
  if (zero_prefix && (ip[5] == 0 || ip[5] == 0xffff)) {
    if (ip[5] == 0 && ip[6] == 0 && ip[7] <= 1) return false;
    return PublicIpv4({ip[6] >> 8, ip[6] & 255, ip[7] >> 8, ip[7] & 255});
  }
  if ((ip[0] & 0xfe00) == 0xfc00 || (ip[0] & 0xffc0) == 0xfe80 || (ip[0] & 0xffc0) == 0xfec0) return false;
  if ((ip[0] & 0xff00) == 0xff00) return false;
  if (ip[0] == 0x64 && ip[1] == 0xff9b) return false;
  if (ip[0] == 0x2001 && ip[1] == 0x0db8) return false;
  return true;
}

inline bool PublicHost(std::string_view host) {
  if (host.empty()) return false;
  if (host.front() == '[') {
    if (host.size() < 3 || host.back() != ']') return false;
    const auto ip = Ipv6(host.substr(1, host.size() - 2));
    return ip && PublicIpv6(*ip);
  }
  if (host.back() == '.') host.remove_suffix(1);
  if (host.empty()) return false;
  if (const auto ip = Ipv4(host)) return PublicIpv4(*ip);
  for (std::string_view name : {"localhost", "localhost.localdomain"}) {
    if (StartsWithLowercase(host, name) && host.size() == name.size()) return false;
  }
  for (std::string_view suffix : {".localhost", ".local", ".internal", ".home.arpa"}) {
    if (host.size() > suffix.size() && StartsWithLowercase(host.substr(host.size() - suffix.size()), suffix)) return false;
  }
  return true;
}

inline int Pick(const std::vector<std::pair<int, int>>& sizes, int pixels = kPixels) {
  int best = -1;
  int best_size = 0;
  for (size_t i = 0; i < sizes.size(); ++i) {
    if (sizes[i].first <= 0 || sizes[i].second <= 0) continue;
    const int size = std::max(sizes[i].first, sizes[i].second);
    const bool better = best < 0 ||
        (best_size < pixels ? size > best_size : (size >= pixels && size < best_size));
    if (better) {
      best = static_cast<int>(i);
      best_size = size;
    }
  }
  return best;
}

inline std::pair<int, int> Fit(int width, int height, int pixels = kPixels) {
  if (width <= 0 || height <= 0) return {0, 0};
  const int longest = std::max(width, height);
  if (longest <= pixels) return {width, height};
  const auto scale = [&](int side) {
    return std::max(1, static_cast<int>((static_cast<int64_t>(side) * pixels + longest / 2) / longest));
  };
  return {scale(width), scale(height)};
}

}

#endif
