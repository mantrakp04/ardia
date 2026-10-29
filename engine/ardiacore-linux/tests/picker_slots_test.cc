#include <cassert>
#include <cstdio>
#include <string_view>

#include "ardia/linux/ac_linux_picker_slots.h"

using ardia::linux_files::PickerAdmission;
using ardia::linux_files::PickerSlots;

namespace {

struct Picker {
  bool showing = true;
};

const auto kShowing = [](const Picker* picker, int) { return picker->showing; };

void PerWindow() {
  PickerSlots<int, Picker> slots;
  Picker first;
  assert(slots.Admit(1, kShowing) == PickerAdmission::kOpen);
  slots.Hold(1, &first);
  assert(slots.Admit(1, kShowing) == PickerAdmission::kAlreadyShowing);
  assert(slots.Admit(2, kShowing) == PickerAdmission::kOpen);
  Picker second;
  slots.Hold(2, &second);
  slots.Release(1, &first);
  assert(slots.Admit(1, kShowing) == PickerAdmission::kOpen);
  assert(slots.Admit(2, kShowing) == PickerAdmission::kAlreadyShowing);
}

void StaleIsReplaced() {
  PickerSlots<int, Picker> slots;
  Picker stuck;
  slots.Hold(1, &stuck);
  stuck.showing = false;
  assert(slots.Admit(1, kShowing) == PickerAdmission::kReplaceStale);
  assert(slots.Held(1) == &stuck);
  Picker fresh;
  slots.Hold(1, &fresh);
  slots.Release(1, &stuck);
  assert(slots.Held(1) == &fresh);
  slots.Release(1, &fresh);
  assert(slots.empty());
}

}

int main(int argc, char** argv) {
  assert(argc == 2);
  const std::string_view name = argv[1];
  if (name == "per-window") PerWindow();
  else if (name == "stale") StaleIsReplaced();
  else return 2;
  return 0;
}
