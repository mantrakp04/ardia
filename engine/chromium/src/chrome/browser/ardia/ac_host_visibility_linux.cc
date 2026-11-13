// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_host_visibility.h"

#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_user_data.h"

namespace ardiacore {

namespace {

class ShownSlot : public content::WebContentsUserData<ShownSlot> {
 private:
  explicit ShownSlot(content::WebContents* contents)
      : content::WebContentsUserData<ShownSlot>(*contents) {}
  friend class content::WebContentsUserData<ShownSlot>;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(ShownSlot);

void (*g_shown_slot_watcher)(content::WebContents*) = nullptr;

}

void NoteTabInShownSlot(content::WebContents* contents) {
  if (!contents || ShownSlot::FromWebContents(contents)) {
    return;
  }
  ShownSlot::CreateForWebContents(contents);
  if (g_shown_slot_watcher) {
    g_shown_slot_watcher(contents);
  }
}

bool TabWasInShownSlot(content::WebContents* contents) {
  return contents && ShownSlot::FromWebContents(contents);
}

void WatchTabsInShownSlot(void (*watcher)(content::WebContents*)) {
  g_shown_slot_watcher = watcher;
}

}
