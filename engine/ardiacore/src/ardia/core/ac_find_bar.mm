#include "ardia/core/ac_browser_window.h"

#include "chrome/browser/ui/find_bar/find_bar.h"
#include "chrome/browser/ui/find_bar/find_bar_controller.h"
#include "ui/gfx/range/range.h"

namespace ardiacore {

ACFindBar::ACFindBar() = default;
ACFindBar::~ACFindBar() = default;
FindBarController* ACFindBar::GetFindBarController() const {
  return controller_;
}
void ACFindBar::SetFindBarController(FindBarController* controller) {
  controller_ = controller;
}
void ACFindBar::Show(bool animate, bool focus) {
  visible_ = true;
}
void ACFindBar::Hide(bool animate) {
  visible_ = false;
}
void ACFindBar::SetFindTextAndSelectedRange(const std::u16string& find_text,
                                            const gfx::Range& selected_range) {
  find_text_ = find_text;
}
std::u16string_view ACFindBar::GetFindText() const {
  return find_text_;
}
gfx::Range ACFindBar::GetSelectedRange() const {
  return gfx::Range();
}
bool ACFindBar::IsFindBarVisible() const {
  return visible_;
}
bool ACFindBar::HasGlobalFindPasteboard() const {
  return true;
}
bool ACFindBar::CanPopulateFromSelectedText() {
  return true;
}
const FindBarTesting* ACFindBar::GetFindBarTesting() const {
  return nullptr;
}
bool ACFindBar::HasFocus() const {
  return false;
}
views::Widget* ACFindBar::GetHostWidget() {
  return nullptr;
}

}
