#ifndef ARDIA_LINUX_AC_LINUX_PICKER_SLOTS_H_
#define ARDIA_LINUX_AC_LINUX_PICKER_SLOTS_H_

#include <map>

namespace ardia::linux_files {

enum class PickerAdmission { kOpen, kAlreadyShowing, kReplaceStale };

template <typename Window, typename Picker>
class PickerSlots {
 public:
  template <typename Showing>
  PickerAdmission Admit(Window window, Showing showing) const {
    const auto found = slots_.find(window);
    if (found == slots_.end()) return PickerAdmission::kOpen;
    return showing(found->second, window) ? PickerAdmission::kAlreadyShowing : PickerAdmission::kReplaceStale;
  }

  Picker* Held(Window window) const {
    const auto found = slots_.find(window);
    return found == slots_.end() ? nullptr : found->second;
  }

  void Hold(Window window, Picker* picker) { slots_[window] = picker; }

  void Release(Window window, const Picker* picker) {
    const auto found = slots_.find(window);
    if (found != slots_.end() && found->second == picker) slots_.erase(found);
  }

  bool empty() const { return slots_.empty(); }

 private:
  std::map<Window, Picker*> slots_;
};

}

#endif
