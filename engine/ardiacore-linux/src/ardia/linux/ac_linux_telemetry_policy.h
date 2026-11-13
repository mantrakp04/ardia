#ifndef ARDIA_LINUX_AC_LINUX_TELEMETRY_POLICY_H_
#define ARDIA_LINUX_AC_LINUX_TELEMETRY_POLICY_H_

#include <cstddef>
#include <string_view>

namespace ardia::linux_telemetry_policy {

inline constexpr std::string_view kEndpoint = "https://ardia.dev/otel/v1/logs";
inline constexpr size_t kMaxBodyBytes = 524288;
inline constexpr size_t kMaxReplyBytes = 4096;
inline constexpr int kTimeoutSeconds = 30;
inline constexpr int kMaxInFlight = 4;
inline constexpr size_t kKeyHexDigits = 24;

inline bool IngestKeyAcceptable(std::string_view key) {
  constexpr std::string_view kPrefix = "ak_";
  if (key.size() < kPrefix.size() + 1 + 1 + kKeyHexDigits || key.substr(0, kPrefix.size()) != kPrefix) {
    return false;
  }
  const std::string_view hex = key.substr(key.size() - kKeyHexDigits);
  for (const char c : hex) {
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) {
      return false;
    }
  }
  const std::string_view kind = key.substr(kPrefix.size(), key.size() - kPrefix.size() - kKeyHexDigits);
  if (kind.size() < 2 || kind.back() != '_') {
    return false;
  }
  for (const char c : kind.substr(0, kind.size() - 1)) {
    if (c < 'a' || c > 'z') {
      return false;
    }
  }
  return true;
}

inline bool BodyAcceptable(std::string_view body) {
  return !body.empty() && body.size() <= kMaxBodyBytes && body.front() == '{';
}

inline bool PostAcceptable(std::string_view body, std::string_view key) {
  return BodyAcceptable(body) && IngestKeyAcceptable(key);
}

inline bool AdmitPost(int in_flight) {
  return in_flight >= 0 && in_flight < kMaxInFlight;
}

inline int ReportedStatus(bool network_ok, int http_status) {
  if (!network_ok || http_status < 200 || http_status > 599 || (http_status >= 300 && http_status < 400)) {
    return 0;
  }
  return http_status;
}

}

#endif
