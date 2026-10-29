#include "ardia/linux/ac_linux_find.h"

#include <algorithm>
#include <utility>

#include "components/find_in_page/find_tab_helper.h"
#include "components/find_in_page/find_types.h"
#include "content/public/browser/web_contents.h"

namespace ardiacore {

LinuxFind::LinuxFind(content::WebContents* contents,
                     base::RepeatingCallback<bool()> is_current,
                     base::RepeatingCallback<void(base::DictValue)> emit)
    : contents_(contents->GetWeakPtr()),
      is_current_(std::move(is_current)),
      emit_(std::move(emit)) {}

LinuxFind::~LinuxFind() {
  Reset();
}

bool LinuxFind::Start(const std::u16string& text, bool forward) {
  if (!contents_ || !is_current_.Run())
    return false;
  auto* helper = find_in_page::FindTabHelper::FromWebContents(contents_.get());
  if (!helper)
    return false;
  if (text.empty()) {
    Stop(true);
    Emit(0, 0, true);
    return true;
  }
  if (!observed_) {
    helper->StopFinding(find_in_page::SelectionAction::kClear);
    observed_ = helper;
    helper->AddObserver(this);
  }
  helper->StartFinding(text, forward, false, true);
  return true;
}

bool LinuxFind::Stop(bool clear_selection) {
  if (!contents_ || !is_current_.Run()) {
    Reset();
    return false;
  }
  auto* helper = find_in_page::FindTabHelper::FromWebContents(contents_.get());
  if (!helper)
    return false;
  if (observed_) {
    observed_->RemoveObserver(this);
    observed_ = nullptr;
  }
  helper->StopFinding(clear_selection ? find_in_page::SelectionAction::kClear
                                      : find_in_page::SelectionAction::kKeep);
  return true;
}

void LinuxFind::Reset() {
  if (observed_) {
    auto* helper = observed_.get();
    observed_ = nullptr;
    helper->RemoveObserver(this);
    helper->StopFinding(find_in_page::SelectionAction::kClear);
  }
}

void LinuxFind::OnFindResultAvailable(content::WebContents* contents) {
  if (!observed_ || contents != contents_.get())
    return;
  const auto& result = observed_->find_result();
  Emit(result.number_of_matches(), result.active_match_ordinal(),
       result.final_update());
}

void LinuxFind::OnFindEmptyText(content::WebContents* contents) {
  if (observed_ && contents == contents_.get())
    Emit(0, 0, true);
}

void LinuxFind::OnFindTabHelperDestroyed(find_in_page::FindTabHelper* helper) {
  if (observed_ != helper)
    return;
  observed_ = nullptr;
  helper->RemoveObserver(this);
}

void LinuxFind::Emit(int count, int active, bool final) {
  if (!contents_ || !is_current_.Run()) {
    Reset();
    return;
  }
  auto emit = emit_;
  emit.Run(base::DictValue()
               .Set("type", "findResult")
               .Set("value", base::DictValue()
                                 .Set("count", std::max(0, count))
                                 .Set("active", std::max(0, active))
                                 .Set("final", final)));
}

}
