#ifndef ARDIA_LINUX_AC_LINUX_PRIVATE_SERVICES_H_
#define ARDIA_LINUX_AC_LINUX_PRIVATE_SERVICES_H_

#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_profiles.h"

namespace ardiacore::linux_private_services {

struct PrivateCall {
  std::string_view name;
  std::string_view service;
};

inline constexpr PrivateCall kPrivateSessionCalls[] = {
    {"sites.settings", "ac_site_settings_get"},
    {"sites.setSetting", "ac_site_settings_set"},
    {"sites.origins", "ac_site_settings_origins"},
    {"sites.reset", "ac_site_settings_reset"},
    {"sites.clearData", "ac_site_data_clear"},
    {"sites.zoomLevels", "ac_zoom_list"},
    {"sites.setZoom", "ac_zoom_set"},
};

inline constexpr std::string_view kOffTheRecordKey = "offTheRecord";

inline constexpr bool ServesPrivateSession(std::string_view name) {
  for (const auto& call : kPrivateSessionCalls) {
    if (call.name == name) return true;
  }
  return false;
}

inline constexpr bool PrivateRequest(bool private_page, linux_profiles::ProfileKind requested) {
  return private_page || requested == linux_profiles::ProfileKind::kPrivate;
}

struct PrivatePage {
  bool off_the_record = false;
  bool ending = false;
  bool hosts_requested = false;
};

inline linux_profiles::ProfileError RoutePrivateCall(std::string_view name, const PrivatePage& page) {
  using linux_profiles::ProfileError;
  if (!ServesPrivateSession(name)) return ProfileError::kPrivateService;
  if (!page.off_the_record) return ProfileError::kWindowMismatch;
  if (page.ending) return ProfileError::kPrivateEnding;
  if (!page.hosts_requested) return ProfileError::kWindowMismatch;
  return ProfileError::kNone;
}

struct Failure {
  std::string code;
  std::string message;
};

inline Failure EngineFailure(std::string_view error) {
  if (error == "no private session") return {"ERR_PROFILE_ENDING", "This private session is closing"};
  if (error == "no engine data for a private profile") {
    return {"ERR_PROFILE_PRIVATE", "This service is unavailable in private windows"};
  }
  return {"ERR_ENGINE", error.empty() ? "Engine service failed" : std::string(error)};
}

}

#endif
