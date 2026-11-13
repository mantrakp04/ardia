// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_passwords_internal.h"

#include "base/strings/string_util.h"

namespace ardia {
namespace passwords_internal {

namespace pp = extensions::api::passwords_private;

std::string WithoutSlash(std::string realm) {
  if (base::EndsWith(realm, "/")) {
    realm.pop_back();
  }
  return realm;
}

std::string OriginOf(const pp::PasswordUiEntry& entry) {
  return entry.affiliated_domains.empty()
             ? std::string()
             : WithoutSlash(entry.affiliated_domains[0].signon_realm);
}

const pp::PasswordUiEntry* Find(const Entries& entries,
                                const std::string& origin,
                                const std::string& username) {
  for (const pp::PasswordUiEntry& entry : entries) {
    if (!entry.is_passkey && entry.username == username &&
        OriginOf(entry) == origin) {
      return &entry;
    }
  }
  return nullptr;
}

std::string ExceptionOrigin(const pp::ExceptionEntry& entry) {
  return WithoutSlash(entry.urls.signon_realm.empty() ? entry.urls.link
                                                      : entry.urls.signon_realm);
}

const char* StatusName(password_manager::ExportProgressStatus status) {
  switch (status) {
    case password_manager::ExportProgressStatus::kNotStarted:
      return "notStarted";
    case password_manager::ExportProgressStatus::kInProgress:
      return "inProgress";
    case password_manager::ExportProgressStatus::kSucceeded:
      return "succeeded";
    case password_manager::ExportProgressStatus::kFailedCancelled:
      return "cancelled";
    case password_manager::ExportProgressStatus::kFailedWrite:
      return "writeFailed";
  }
  return "unknown";
}

}
}
