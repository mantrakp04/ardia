// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_AC_HOST_VISIBILITY_H_
#define ARDIA_CORE_AC_HOST_VISIBILITY_H_

#include <optional>

class BrowserWindowInterface;

namespace content {
class WebContents;
}

namespace ardiacore {

void NoteTabShownByHost(content::WebContents* contents, bool shown);

std::optional<bool> ShownByHost(content::WebContents* contents);

void NoteTabInShownSlot(content::WebContents* contents);

bool TabWasInShownSlot(content::WebContents* contents);

bool IsAutomationWindow(const BrowserWindowInterface* browser);

bool InAutomationWindow(content::WebContents* contents);

void StartHostVisibility();

}

#endif
