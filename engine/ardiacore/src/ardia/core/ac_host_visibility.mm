// Copyright 2026 Ardia. Apache-2.0.

#include "ardia/core/ac_host_visibility.h"

#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "chrome/browser/ui/tabs/public/tab_dialog_manager.h"
#include "chrome/browser/ui/tabs/public/tab_features.h"
#include "components/permissions/permission_request_manager.h"
#include "components/tabs/public/tab_interface.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_user_data.h"
#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_picture_in_picture.h"
#include "ardia/core/ac_video_upscaling.h"

namespace ardiacore {

namespace {

class HostVisibility : public content::WebContentsUserData<HostVisibility> {
 public:
  bool shown() const { return shown_; }
  void set_shown(bool shown) { shown_ = shown; }

 private:
  explicit HostVisibility(content::WebContents* contents)
      : content::WebContentsUserData<HostVisibility>(*contents) {}
  friend class content::WebContentsUserData<HostVisibility>;
  WEB_CONTENTS_USER_DATA_KEY_DECL();

  bool shown_ = false;
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(HostVisibility);

class ShownSlot : public content::WebContentsUserData<ShownSlot> {
 public:
  using Restored = base::OnceCallback<void(const std::string&)>;

  bool restoring() const { return restoring_; }

  void BeginRestore() {
    restoring_ = true;
    content::ArdiaWhenRestoredFrameDisplayed(
        &GetWebContents(),
        base::BindOnce(&ShownSlot::FrameDisplayed, weak_.GetWeakPtr()));
  }

  void WhenRestored(Restored restored) {
    if (!restoring_) {
      std::move(restored).Run(std::string());
      return;
    }
    waiting_.push_back(std::move(restored));
  }

 private:
  explicit ShownSlot(content::WebContents* contents)
      : content::WebContentsUserData<ShownSlot>(*contents) {}
  friend class content::WebContentsUserData<ShownSlot>;
  WEB_CONTENTS_USER_DATA_KEY_DECL();

  void FrameDisplayed(const std::string& proof) {
    if (!restoring_) {
      return;
    }
    restoring_ = false;
    std::vector<Restored> waiting = std::move(waiting_);
    waiting_.clear();
    for (Restored& restored : waiting) {
      std::move(restored).Run(proof);
    }
  }

  bool restoring_ = false;
  std::vector<Restored> waiting_;
  base::WeakPtrFactory<ShownSlot> weak_{this};
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(ShownSlot);

bool (*g_shown_slot_emulated)(content::WebContents*) = nullptr;

int Answer(content::WebContents* contents) {
  std::optional<bool> shown = ShownByHost(contents);
  return shown ? *shown : -1;
}

}

std::optional<bool> ShownByHost(content::WebContents* contents) {
  HostVisibility* state = contents ? HostVisibility::FromWebContents(contents) : nullptr;
  return state ? std::optional<bool>(state->shown()) : std::nullopt;
}

void NoteTabShownByHost(content::WebContents* contents, bool shown) {
  if (!contents || ShownByHost(contents) == shown) {
    return;
  }
  HostVisibility::CreateForWebContents(contents);
  HostVisibility::FromWebContents(contents)->set_shown(shown);
  VideoUpscalingInputsChanged();
  TraceAutoPictureInPictureInputs(contents, shown ? "host shows tab" : "host hides tab");
  ArdiaAutoPictureInPictureHostVisibilityChanged(contents);
  if (auto* prompts = permissions::PermissionRequestManager::FromWebContents(contents)) {
    prompts->OnVisibilityChanged(contents->GetVisibility());
  }
  if (auto* tab = tabs::TabInterface::MaybeGetFromContents(contents)) {
    if (auto* features = tab->GetTabFeatures()) {
      if (auto* dialogs = features->tab_dialog_manager()) {
        if (dialogs->UpdateDialogVisibility()) {
          dialogs->UpdateModalDialogBounds();
        }
      }
    }
  }
}

bool NoteTabInShownSlot(content::WebContents* contents) {
  if (!contents) {
    return false;
  }
  ShownSlot* slot = ShownSlot::FromWebContents(contents);
  if (!slot) {
    ShownSlot::CreateForWebContents(contents);
    slot = ShownSlot::FromWebContents(contents);
    if (g_shown_slot_emulated && g_shown_slot_emulated(contents)) {
      slot->BeginRestore();
    }
  }
  return slot->restoring();
}

void WhenTabSizeRestored(
    content::WebContents* contents,
    base::OnceCallback<void(const std::string&)> restored) {
  ShownSlot* slot = contents ? ShownSlot::FromWebContents(contents) : nullptr;
  if (!slot) {
    std::move(restored).Run(std::string());
    return;
  }
  slot->WhenRestored(std::move(restored));
}

bool TabWasInShownSlot(content::WebContents* contents) {
  return contents && ShownSlot::FromWebContents(contents);
}

void WatchTabsInShownSlot(bool (*emulated)(content::WebContents*)) {
  g_shown_slot_emulated = emulated;
}

void StartHostVisibility() {
  g_ardia_tab_shown_by_host = &Answer;
  g_ardia_permission_tab_shown = &Answer;
}

}
