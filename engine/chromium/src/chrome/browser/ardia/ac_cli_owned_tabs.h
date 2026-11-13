// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_CLI_OWNED_TABS_H_
#define CHROME_BROWSER_ARDIA_AC_CLI_OWNED_TABS_H_

#include <string>

namespace content {
class WebContents;
}

namespace ardia {

void NoteCliOwnedTarget(const std::string& target_id, const void* owner);
void ClaimCliOwnedTarget(const std::string& target_id, const void* owner);
void ReleaseCliOwnedTargets(const void* owner);
void ForgetCliOwnedTarget(const std::string& target_id);
bool IsCliOwnedTab(content::WebContents* contents);
std::string CliEmulationRefusal(const std::string& target_id);

}

#endif
