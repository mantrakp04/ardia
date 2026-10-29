// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_REAUTH_LINUX_POLICY_H_
#define CHROME_BROWSER_ARDIA_AC_REAUTH_LINUX_POLICY_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace ardia::reauth_linux {

inline constexpr char kPolkitService[] = "org.freedesktop.PolicyKit1";
inline constexpr char kPolkitPath[] = "/org/freedesktop/PolicyKit1/Authority";
inline constexpr char kPolkitInterface[] = "org.freedesktop.PolicyKit1.Authority";
inline constexpr char kPolkitAction[] = "dev.ardia.linux.reauthenticate";
inline constexpr uint32_t kAllowUserInteraction = 1;
inline constexpr int64_t kPromptTimeoutMs = 120000;
inline constexpr int64_t kProbeTimeoutMs = 5000;

enum class Outcome { kGranted, kDenied, kCancelled, kExpired, kUnavailable };

enum class Availability { kAvailable, kBackground, kNoPolkit, kPolicyMissing, kNotPermitted, kUnavailable };

struct PolkitReply {
  bool responded = false;
  std::string error_name;
  std::string error_message;
  bool authorized = false;
  bool challenge = false;
  bool dismissed = false;
};

inline const char* OutcomeName(Outcome outcome) {
  switch (outcome) {
    case Outcome::kGranted:
      return "granted";
    case Outcome::kDenied:
      return "denied";
    case Outcome::kCancelled:
      return "cancelled";
    case Outcome::kExpired:
      return "expired";
    case Outcome::kUnavailable:
      return "unavailable";
  }
  return "unavailable";
}

inline Outcome Classify(const PolkitReply& reply) {
  constexpr std::string_view kExpiredErrors[] = {
      "org.freedesktop.DBus.Error.NoReply", "org.freedesktop.DBus.Error.Timeout",
      "org.freedesktop.DBus.Error.TimedOut"};
  if (!reply.error_name.empty()) {
    for (std::string_view expired : kExpiredErrors) {
      if (reply.error_name == expired) {
        return Outcome::kExpired;
      }
    }
    if (reply.error_name == "org.freedesktop.PolicyKit1.Error.Cancelled") {
      return Outcome::kCancelled;
    }
    return Outcome::kUnavailable;
  }
  if (!reply.responded) {
    return Outcome::kUnavailable;
  }
  if (reply.authorized && !reply.challenge) {
    return Outcome::kGranted;
  }
  if (reply.dismissed) {
    return Outcome::kCancelled;
  }
  if (reply.challenge) {
    return Outcome::kUnavailable;
  }
  return Outcome::kDenied;
}

inline const char* AvailabilityName(Availability availability) {
  switch (availability) {
    case Availability::kAvailable:
      return "available";
    case Availability::kBackground:
      return "background";
    case Availability::kNoPolkit:
      return "noPolkit";
    case Availability::kPolicyMissing:
      return "policyMissing";
    case Availability::kNotPermitted:
      return "notPermitted";
    case Availability::kUnavailable:
      return "unavailable";
  }
  return "unavailable";
}

inline Availability ClassifyProbe(const PolkitReply& reply) {
  if (reply.error_name == "org.freedesktop.DBus.Error.ServiceUnknown" ||
      reply.error_name == "org.freedesktop.DBus.Error.NameHasNoOwner") {
    return Availability::kNoPolkit;
  }
  if (!reply.error_name.empty()) {
    return reply.error_message.find("is not registered") != std::string::npos
               ? Availability::kPolicyMissing
               : Availability::kUnavailable;
  }
  if (!reply.responded) {
    return Availability::kUnavailable;
  }
  return reply.authorized || reply.challenge ? Availability::kAvailable
                                             : Availability::kNotPermitted;
}

class GrantWindow {
 public:
  void Grant(int64_t now_ms) { granted_at_ms_ = now_ms; }
  void Clear() { granted_at_ms_.reset(); }
  bool Covers(int64_t now_ms, int64_t validity_ms) const {
    return validity_ms > 0 && granted_at_ms_ && now_ms >= *granted_at_ms_ &&
           now_ms - *granted_at_ms_ < validity_ms;
  }

 private:
  std::optional<int64_t> granted_at_ms_;
};

}

#endif
