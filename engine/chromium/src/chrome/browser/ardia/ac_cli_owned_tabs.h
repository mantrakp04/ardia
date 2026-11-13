// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_CLI_OWNED_TABS_H_
#define CHROME_BROWSER_ARDIA_AC_CLI_OWNED_TABS_H_

#include <string>

namespace content {
class WebContents;
}

namespace ardia {

enum class CliTabOwner { kNobody, kCommand, kUser };

void NoteCliOwnedTarget(const std::string& target_id);
void ForgetCliOwnedTarget(const std::string& target_id);
CliTabOwner CliOwnerOfTarget(const std::string& target_id);
void ExpectCliActivation(const std::string& target_id);
void CliTabShownToUser(content::WebContents* contents);
void CliTabPinChanged(content::WebContents* contents);
void CliTabsMoved();

}

#endif
