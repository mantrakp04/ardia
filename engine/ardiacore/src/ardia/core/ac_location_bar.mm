#include "ardia/core/ac_browser_window.h"

#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/browser.h"
#include "chrome/browser/ui/views/bubble_anchor_util_views.h"
#include "content/public/browser/web_contents.h"
#include "ui/gfx/geometry/rect.h"

namespace ardiacore {

ACLocationBar::ACLocationBar() : LocationBar(nullptr) {}
ACLocationBar::~ACLocationBar() = default;
OmniboxView* ACLocationBar::GetOmniboxView() {
  return nullptr;
}
OmniboxPopupView* ACLocationBar::GetOmniboxPopupView() {
  return nullptr;
}
OmniboxController* ACLocationBar::GetOmniboxController() {
  return nullptr;
}
bool ACLocationBar::ShouldCloseOmniboxPopup(ui::MouseEvent* event) {
  return false;
}
content::WebContents* ACLocationBar::GetWebContents() {
  return browser_ ? browser_->GetTabStripModel()->GetActiveWebContents()
                  : nullptr;
}
LocationBarModel* ACLocationBar::GetLocationBarModel() {
  return nullptr;
}
std::optional<bubble_anchor_util::AnchorConfiguration>
ACLocationBar::GetChipAnchor() {
  return std::nullopt;
}
ChipController* ACLocationBar::GetChipController() {
  return nullptr;
}
ui::TrackedElement* ACLocationBar::GetAnchorOrNull() {
  return nullptr;
}
BrowserWindowInterface* ACLocationBar::GetBrowser() {
  return browser_;
}
Profile* ACLocationBar::GetProfile() {
  return browser_ ? browser_->GetProfile() : nullptr;
}
bool ACLocationBar::IsInitialized() const {
  return true;
}
bool ACLocationBar::IsVisible() const {
  return false;
}
bool ACLocationBar::IsDrawn() const {
  return false;
}
bool ACLocationBar::IsFullscreen() const {
  return false;
}
bool ACLocationBar::IsEditingOrEmpty() const {
  return false;
}
bool ACLocationBar::IsMouseHovered() const {
  return false;
}
bool ACLocationBar::IsFocusWithin() const {
  return false;
}
gfx::Rect ACLocationBar::Bounds() const {
  return gfx::Rect();
}
gfx::Rect ACLocationBar::BoundsInScreen() const {
  return gfx::Rect();
}
gfx::Size ACLocationBar::MinimumSize() const {
  return gfx::Size();
}
gfx::Size ACLocationBar::PreferredSize() const {
  return gfx::Size();
}
bool ACLocationBar::HasSecurityStateChanged() {
  return false;
}
LocationBarTesting* ACLocationBar::GetLocationBarForTesting() {
  return nullptr;
}

}
