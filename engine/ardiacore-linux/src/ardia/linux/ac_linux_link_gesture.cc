#include "ardia/linux/ac_linux_link_gesture.h"

#include <utility>

namespace ardiacore {

int LinuxLinkKeyFlags(std::string_view key) {
  if (key == "alt") return kLinuxLinkAlt;
  if (key == "shift") return kLinuxLinkShift;
  if (key == "altShift") return kLinuxLinkAlt | kLinuxLinkShift;
  if (key == "altMeta") return kLinuxLinkAlt | kLinuxLinkMeta;
  return 0;
}

bool LinuxInputActivity::Note(double now) {
  if (last_ >= 0 && now >= last_ && now - last_ < kInterval) return false;
  last_ = now;
  return true;
}

void LinuxLinkGestureGate::NotePress(uintptr_t surface) {
  if (!surface) return;
  pressed_since_up_ = true;
  pressed_since_drop_ = true;
  press_surface_ = surface;
  press_open_ = true;
  dropped_on_ = 0;
}

void LinuxLinkGestureGate::NoteDrop(uintptr_t target) {
  if (press_open_) dropped_on_ = target;
}

void LinuxLinkGestureGate::NoteDragEnded(uintptr_t surface, double now) {
  if (!surface || !press_open_ || surface != press_surface_) return;
  press_open_ = false;
  drop_surface_ = surface;
  drop_over_ = dropped_on_ == surface;
  dropped_on_ = 0;
  drop_at_ = now;
  drop_used_ = false;
  pressed_since_drop_ = false;
}

std::string LinuxLinkGestureGate::AcceptLinkDrop(uintptr_t surface, bool visible, double now) {
  if (!surface || !drop_surface_ || drop_at_ < 0) return "no drag from this page ended";
  if (drop_surface_ != surface) return "the drag ended on another page";
  if (drop_used_) return "that drag already opened a link";
  if (pressed_since_drop_) return "the mouse was pressed again since the drag ended";
  if (now < drop_at_ || now - drop_at_ > kDropLifetime) return "the drag ended too long ago";
  if (!drop_over_) return "the drag ended outside the page";
  if (!visible) return "page not shown";
  drop_used_ = true;
  return std::string();
}

void LinuxLinkGestureGate::NoteRelease(uintptr_t surface, int flags, double now,
                                       std::optional<LinuxLinkPoint> point, bool ends_drag) {
  if (!surface || ends_drag) return;
  up_surface_ = surface;
  up_flags_ = flags & (kLinuxLinkAlt | kLinuxLinkShift | kLinuxLinkControl | kLinuxLinkMeta);
  up_at_ = now;
  up_point_ = point;
  pressed_since_up_ = false;
  press_open_ = false;
  ++up_sequence_;
}

void LinuxLinkGestureGate::Forget(uintptr_t surface) {
  if (!surface) return;
  if (surface == press_surface_) {
    press_surface_ = 0;
    press_open_ = false;
  }
  if (surface == dropped_on_) dropped_on_ = 0;
  if (surface == drop_surface_) {
    drop_surface_ = 0;
    drop_at_ = -1;
  }
  if (surface != up_surface_) return;
  up_surface_ = 0;
  up_point_.reset();
}

LinuxLinkDecision LinuxLinkGestureGate::Decide(const LinuxLinkRequest& request, const LinuxPageOptions& options) {
  const auto action = options.ActionFor(request.key);
  const int flags = LinuxLinkKeyFlags(request.key);
  const double since = up_at_ < 0 ? -1 : request.now - up_at_;
  std::string refused;
  if (!action) refused = "that key opens nothing now";
  else if (!request.visible) refused = "page not shown";
  else if (!request.http) refused = "not http(s)";
  else if (up_at_ < 0) refused = "no left mouse-up yet";
  else if (up_sequence_ == used_sequence_) refused = "that mouse-up already opened a peek";
  else if (pressed_since_up_) refused = "the mouse was pressed again since that mouse-up";
  else if (since < 0 || since > kGestureLifetime) refused = "the last mouse-up is too old";
  else if (!request.surface || up_surface_ != request.surface) refused = "the mouse-up wasn't over this page";
  else if (up_flags_ != flags) refused = "the mouse-up's keys aren't the page's key alone";
  if (!refused.empty()) return FallBack(request, options, std::move(refused));
  used_sequence_ = up_sequence_;
  LinuxLinkDecision decision;
  decision.outcome = *action == "split" ? LinuxLinkOutcome::kSplit : LinuxLinkOutcome::kPeek;
  if (decision.outcome == LinuxLinkOutcome::kPeek) decision.point = up_point_;
  return decision;
}

LinuxLinkDecision LinuxLinkGestureGate::FallBack(const LinuxLinkRequest& request, const LinuxPageOptions& options,
                                                 std::string reason) {
  LinuxLinkDecision decision;
  decision.refused = std::move(reason);
  const int flags = LinuxLinkKeyFlags(request.key);
  const bool split = options.ActionFor(request.key) == std::optional<std::string>("split");
  const double since = up_at_ < 0 ? -1 : request.now - up_at_;
  const bool fresh = since >= 0 && since <= kFallbackLifetime && !pressed_since_up_;
  const bool user_clicked = fresh && up_sequence_ != used_sequence_ && request.surface &&
                            up_surface_ == request.surface && up_flags_ == flags;
  if (split && user_clicked) used_sequence_ = up_sequence_;
  if (split || !flags || !request.http || !user_clicked) return decision;
  used_sequence_ = up_sequence_;
  if (flags == kLinuxLinkShift) decision.outcome = LinuxLinkOutcome::kWindow;
  else if (request.same_origin) decision.outcome = LinuxLinkOutcome::kDownload;
  else decision.outcome = LinuxLinkOutcome::kBackground;
  return decision;
}

}
