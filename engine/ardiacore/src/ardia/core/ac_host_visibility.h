// Copyright 2026 Ardia. Apache-2.0.

#ifndef ARDIA_CORE_AC_HOST_VISIBILITY_H_
#define ARDIA_CORE_AC_HOST_VISIBILITY_H_

#include <optional>

#include "base/functional/callback.h"

namespace content {
class WebContents;
}

namespace ardiacore {

void NoteTabShownByHost(content::WebContents* contents, bool shown);

std::optional<bool> ShownByHost(content::WebContents* contents);

bool NoteTabInShownSlot(content::WebContents* contents);

bool TabWasInShownSlot(content::WebContents* contents);

void WhenTabSizeRestored(content::WebContents* contents,
                         base::OnceClosure restored);

void WatchTabsInShownSlot(bool (*resized)(content::WebContents*));

void StartHostVisibility();

}

#endif
