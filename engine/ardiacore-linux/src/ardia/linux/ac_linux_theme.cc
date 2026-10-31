#include "ardia/linux/ac_linux_theme.h"

#include <utility>

#include "base/strings/stringprintf.h"
#include "content/public/browser/web_contents.h"
#include "third_party/skia/include/core/SkColor.h"

namespace ardiacore {

LinuxTheme::LinuxTheme(base::WeakPtr<LinuxPageLease> lease, NavigationSnapshot navigation)
    : content::WebContentsObserver(lease ? lease->observed_contents() : nullptr),
      lease_(lease), navigation_(std::move(navigation)) {}

LinuxTheme::~LinuxTheme() { Reset(); }

base::DictValue LinuxTheme::Snapshot() const {
  auto* contents = lease_ ? lease_->contents() : nullptr;
  auto color = contents ? contents->GetThemeColor() : std::nullopt;
  if (!color && contents && sampled_ && sampled_document_.AsRenderFrameHostIfValid() == contents->GetPrimaryMainFrame())
    return base::DictValue().Set("themeColor", sampled_->first).Set("themeColorSource", sampled_->second);
  if (!color) return base::DictValue().Set("themeColor", base::Value()).Set("themeColorSource", base::Value());
  return base::DictValue().Set("themeColor", base::StringPrintf("#%02x%02x%02x",
      SkColorGetR(*color), SkColorGetG(*color), SkColorGetB(*color))).Set("themeColorSource", "meta");
}

bool LinuxTheme::Emit() {
  auto request = lease_ ? lease_->Capture() : std::nullopt;
  if (!request || !navigation_) return false;
  auto weak = weak_factory_.GetWeakPtr();
  auto callback = navigation_;
  auto state = callback.Run();
  if (!weak || !request->Valid()) return false;
  state.Merge(Snapshot());
  return request->lease && request->lease->Emit(*request, "navigation", base::Value(std::move(state)));
}

bool LinuxTheme::SetSampled(std::optional<Sample> sample, content::WeakDocumentPtr document) {
  auto* contents = lease_ ? lease_->contents() : nullptr;
  auto* frame = document.AsRenderFrameHostIfValid();
  if (!contents || !frame || frame != contents->GetPrimaryMainFrame()) return false;
  sampled_ = std::move(sample);
  sampled_document_ = std::move(document);
  return Emit();
}

void LinuxTheme::Reset() {
  sampled_.reset();
  sampled_document_ = content::WeakDocumentPtr();
  weak_factory_.InvalidateWeakPtrs();
  navigation_.Reset();
  lease_.reset();
  Observe(nullptr);
}

void LinuxTheme::DidChangeThemeColor() { Emit(); }
void LinuxTheme::WebContentsDestroyed() { Reset(); }

}
