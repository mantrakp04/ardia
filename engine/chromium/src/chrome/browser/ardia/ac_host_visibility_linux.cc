// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_host_visibility.h"

#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_user_data.h"

namespace ardiacore {

namespace {

constexpr base::TimeDelta kRestoreDeadline = base::Milliseconds(250);

class ShownSlot : public content::WebContentsUserData<ShownSlot> {
 public:
  bool restoring() const { return restoring_; }

  void BeginRestore() {
    restoring_ = true;
    GetWebContents().GetPrimaryMainFrame()->InsertVisualStateCallback(
        base::BindOnce(&ShownSlot::Restored, weak_.GetWeakPtr()));
    deadline_.Start(FROM_HERE, kRestoreDeadline,
                    base::BindOnce(&ShownSlot::Restored,
                                   base::Unretained(this), false));
  }

  void WhenRestored(base::OnceClosure restored) {
    if (!restoring_) {
      std::move(restored).Run();
      return;
    }
    waiting_.push_back(std::move(restored));
  }

 private:
  explicit ShownSlot(content::WebContents* contents)
      : content::WebContentsUserData<ShownSlot>(*contents) {}
  friend class content::WebContentsUserData<ShownSlot>;
  WEB_CONTENTS_USER_DATA_KEY_DECL();

  void Restored(bool drawn) {
    if (!restoring_) {
      return;
    }
    restoring_ = false;
    deadline_.Stop();
    std::vector<base::OnceClosure> waiting = std::move(waiting_);
    waiting_.clear();
    for (base::OnceClosure& restored : waiting) {
      std::move(restored).Run();
    }
  }

  bool restoring_ = false;
  base::OneShotTimer deadline_;
  std::vector<base::OnceClosure> waiting_;
  base::WeakPtrFactory<ShownSlot> weak_{this};
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(ShownSlot);

bool (*g_shown_slot_resized)(content::WebContents*) = nullptr;

}

bool NoteTabInShownSlot(content::WebContents* contents) {
  if (!contents) {
    return false;
  }
  ShownSlot* slot = ShownSlot::FromWebContents(contents);
  if (!slot) {
    ShownSlot::CreateForWebContents(contents);
    slot = ShownSlot::FromWebContents(contents);
    if (g_shown_slot_resized && g_shown_slot_resized(contents)) {
      slot->BeginRestore();
    }
  }
  return slot->restoring();
}

void WhenTabSizeRestored(content::WebContents* contents,
                         base::OnceClosure restored) {
  ShownSlot* slot = contents ? ShownSlot::FromWebContents(contents) : nullptr;
  if (!slot) {
    std::move(restored).Run();
    return;
  }
  slot->WhenRestored(std::move(restored));
}

bool TabWasInShownSlot(content::WebContents* contents) {
  return contents && ShownSlot::FromWebContents(contents);
}

void WatchTabsInShownSlot(bool (*resized)(content::WebContents*)) {
  g_shown_slot_resized = resized;
}

}
