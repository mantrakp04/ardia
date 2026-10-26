#include "ardia/core/ac_page_channel.h"

#include <map>
#include <optional>
#include <string_view>
#include <utility>
#include <vector>

#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/values.h"
#include "content/public/browser/page.h"
#include "content/public/browser/render_frame_host.h"

namespace ardiacore {

namespace {

constexpr size_t kMaxHeld = 64;
constexpr size_t kMaxHeldBytes = 16 * 1024;
constexpr size_t kMaxHeldTotalBytes = 256 * 1024;


const std::vector<std::string_view>* HeldFields(const std::string& kind) {
  static const base::NoDestructor<std::map<std::string, std::vector<std::string_view>>>
      fields({
          {"hello", {"top", "url"}},
          {"theme", {"color", "source"}},
          {"media", {"frame", "playing"}},
          {"nowPlaying",
           {"frame", "title", "artist", "album", "artwork", "playbackState",
            "position", "duration", "playbackRate", "hasVideo", "actions",
            "controllable", "timestamp"}},
      });
  auto it = fields->find(kind);
  return it == fields->end() ? nullptr : &it->second;
}

}

void PageChannel::Hold(content::RenderFrameHost& frame,
                       const std::string& kind,
                       const std::string& json) {
  if (!frame.GetPage().IsPrimary()) {
    return;
  }
  const std::vector<std::string_view>* fields = HeldFields(kind);
  if (!fields || json.size() > kMaxHeldBytes) {
    return;
  }
  std::optional<base::Value> value =
      base::JSONReader::Read(json, base::JSON_PARSE_RFC);
  if (kind == "nowPlaying" && value && value->is_none()) {
    const std::string cleared = base::StrCat({FrameId(&frame), "|", kind});
    if (auto it = held_.find(cleared); it != held_.end()) {
      held_bytes_ -= it->second.json.size();
      held_.erase(it);
    }
    return;
  }
  if (!value || !value->is_dict()) {
    return;
  }
  base::DictValue kept;
  for (std::string_view field : *fields) {
    if (const base::Value* found = value->GetDict().Find(field)) {
      kept.Set(field, found->Clone());
    }
  }
  std::string kept_json;
  if (!base::JSONWriter::Write(kept, &kept_json) ||
      kept_json.size() > kMaxHeldBytes) {
    return;
  }
  const std::string frame_id = FrameId(&frame);
  std::string key = base::StrCat({frame_id, "|", kind});
  if (kind == "media") {
    const std::string* media_frame = kept.FindString("frame");
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
  if (held_bytes_ - replaced + kept_json.size() > kMaxHeldTotalBytes) {
    return;
  }
  held_bytes_ = held_bytes_ - replaced + kept_json.size();
  held_[key] = Held{frame_id, kind, std::move(kept_json)};
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
  for (const char* kind : {"hello", "theme", "media", "nowPlaying"}) {
    for (const auto& [key, entry] : held) {
      if (entry.kind != kind) {
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
