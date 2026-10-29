#include "ardia/core/ac_page_channel.h"

#include <algorithm>
#include <iterator>
#include <map>
#include <optional>
#include <string_view>
#include <utility>

#include "base/json/json_reader.h"
#include "base/strings/strcat.h"
#include "base/values.h"
#include "content/public/browser/page.h"
#include "content/public/browser/render_frame_host.h"

namespace ardiacore {

namespace {

constexpr size_t kMaxHeld = 64;
constexpr size_t kMaxHeldBytes = 16 * 1024;
constexpr size_t kMaxHeldTotalBytes = 256 * 1024;

struct HeldKind {
  std::string_view kind;
  bool keyed_by_frame = false;
  bool cleared_by_null = false;
};

constexpr HeldKind kHeldKinds[] = {
    {.kind = "hello"},
    {.kind = "theme"},
    {.kind = "media", .keyed_by_frame = true},
    {.kind = "nowPlaying", .cleared_by_null = true},
};

const HeldKind* HeldKindNamed(std::string_view kind) {
  const auto* found = std::ranges::find(kHeldKinds, kind, &HeldKind::kind);
  return found == std::end(kHeldKinds) ? nullptr : found;
}

}

void PageChannel::Hold(content::RenderFrameHost& frame,
                       const std::string& kind,
                       const std::string& json) {
  if (!frame.GetPage().IsPrimary()) {
    return;
  }
  const HeldKind* held_kind = HeldKindNamed(kind);
  if (!held_kind || json.size() > kMaxHeldBytes) {
    return;
  }
  std::optional<base::Value> value =
      base::JSONReader::Read(json, base::JSON_PARSE_RFC);
  const std::string frame_id = FrameId(&frame);
  std::string key = base::StrCat({frame_id, "|", kind});
  if (held_kind->cleared_by_null && value && value->is_none()) {
    if (auto it = held_.find(key); it != held_.end()) {
      held_bytes_ -= it->second.json.size();
      held_.erase(it);
    }
    return;
  }
  if (!value || !value->is_dict()) {
    return;
  }
  if (held_kind->keyed_by_frame) {
    const std::string* media_frame = value->GetDict().FindString("frame");
    if (!media_frame || media_frame->size() > 64) {
      return;
    }
    key = base::StrCat({key, "|", *media_frame});
  }
  auto it = held_.find(key);
  const size_t replaced = it == held_.end() ? 0 : it->second.json.size();
  if (it == held_.end() && held_.size() >= kMaxHeld) {
    return;
  }
  if (held_bytes_ - replaced + json.size() > kMaxHeldTotalBytes) {
    return;
  }
  held_bytes_ = held_bytes_ - replaced + json.size();
  held_[key] = Held{frame_id, kind, json};
}

void PageChannel::ForgetHeld(const std::string& frame_id) {
  std::erase_if(held_, [&](const auto& entry) {
    if (entry.second.frame_id != frame_id) {
      return false;
    }
    held_bytes_ -= entry.second.json.size();
    return true;
  });
}

void PageChannel::DeliverHeld() {
  std::map<std::string, Held> held = std::move(held_);
  held_.clear();
  held_bytes_ = 0;
  for (const HeldKind& held_kind : kHeldKinds) {
    for (const auto& [key, entry] : held) {
      if (entry.kind != held_kind.kind) {
        continue;
      }
      content::RenderFrameHost* frame = FindFrame(entry.frame_id);
      if (frame && frame->IsRenderFrameLive() && frame->GetPage().IsPrimary() &&
          !Deliver(*frame, entry.kind, entry.json)) {
        Hold(*frame, entry.kind, entry.json);
      }
    }
  }
}

}
