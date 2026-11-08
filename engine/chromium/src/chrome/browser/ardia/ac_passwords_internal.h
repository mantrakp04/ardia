// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_PASSWORDS_INTERNAL_H_
#define CHROME_BROWSER_ARDIA_AC_PASSWORDS_INTERNAL_H_

#include <string>

#include "chrome/browser/extensions/api/passwords_private/passwords_private_delegate.h"
#include "chrome/common/extensions/api/passwords_private.h"
#include "components/password_manager/core/browser/export/export_progress_status.h"

namespace ardia {
namespace passwords_internal {

using Entries = extensions::PasswordsPrivateDelegate::UiEntries;

std::string WithoutSlash(std::string realm);

std::string OriginOf(
    const extensions::api::passwords_private::PasswordUiEntry& entry);

const extensions::api::passwords_private::PasswordUiEntry* Find(
    const Entries& entries,
    const std::string& origin,
    const std::string& username);

std::string ExceptionOrigin(
    const extensions::api::passwords_private::ExceptionEntry& entry);

const char* StatusName(password_manager::ExportProgressStatus status);

}
}

#endif
