#include "ardia/linux/ac_linux_private_services.h"

#include <cassert>
#include <cstdio>

using namespace ardiacore::linux_private_services;
using ardiacore::linux_profiles::ProfileError;
using ardiacore::linux_profiles::ProfileKind;

int main() {
  for (const char* served : {"sites.settings", "sites.setSetting", "sites.origins", "sites.reset", "sites.clearData",
                             "sites.zoomLevels", "sites.setZoom"}) {
    assert(ServesPrivateSession(served));
  }
  for (const char* refused : {"history.query", "history.add", "bookmarks.tree", "favicons.get", "downloads.settings",
                              "profiles.clearBrowsingData", "extensions.list", "passwords.list", "documents.read", ""}) {
    assert(!ServesPrivateSession(refused));
    assert(RoutePrivateCall(refused, {true, false, true}) == ProfileError::kPrivateService);
  }
  assert(RoutePrivateCall("sites.settings", {true, false, true}) == ProfileError::kNone);
  assert(RoutePrivateCall("sites.setZoom", {true, false, true}) == ProfileError::kNone);
  assert(RoutePrivateCall("sites.settings", {false, false, true}) == ProfileError::kWindowMismatch);
  assert(RoutePrivateCall("sites.settings", {false, false, false}) == ProfileError::kWindowMismatch);
  assert(RoutePrivateCall("sites.settings", {true, false, false}) == ProfileError::kWindowMismatch);
  assert(RoutePrivateCall("sites.settings", {true, true, true}) == ProfileError::kPrivateEnding);
  assert(RoutePrivateCall("sites.zoomLevels", {true, true, false}) == ProfileError::kPrivateEnding);
  assert(RoutePrivateCall("sites.zoomLevels", {false, true, true}) == ProfileError::kWindowMismatch);
  assert(EngineFailure("no private session").code == "ERR_PROFILE_ENDING");
  assert(EngineFailure("no engine data for a private profile").code == "ERR_PROFILE_PRIVATE");
  assert(EngineFailure("not for a private session").code == "ERR_ENGINE");
  assert(EngineFailure("profile not loaded").code == "ERR_ENGINE");
  assert(EngineFailure("profile not loaded").message == "profile not loaded");
  assert(EngineFailure("").message == "Engine service failed");
  static_assert(ServesPrivateSession("sites.origins") && !ServesPrivateSession("history.query"));
  for (const ProfileKind kind : {ProfileKind::kDefault, ProfileKind::kIsolated, ProfileKind::kPrivate}) {
    assert(PrivateRequest(true, kind));
  }
  assert(PrivateRequest(false, ProfileKind::kPrivate));
  assert(!PrivateRequest(false, ProfileKind::kDefault));
  assert(!PrivateRequest(false, ProfileKind::kIsolated));
  static_assert(PrivateRequest(true, ProfileKind::kDefault) && !PrivateRequest(false, ProfileKind::kDefault));
  std::puts("private services scenarios passed");
}
