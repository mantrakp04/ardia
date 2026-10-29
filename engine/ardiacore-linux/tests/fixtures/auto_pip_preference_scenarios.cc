#include "ardia/linux/ac_linux_auto_pip.h"

#include <cassert>
#include <cstdio>
#include <map>
#include <optional>
#include <string>

struct FakeProfile {
  std::string name;
  bool otr = false;
  std::optional<bool> setting;
  int writes = 0;
};

int main() {
  using ardiacore::linux_auto_pip::Preference;
  Preference<FakeProfile> preference(
      [](FakeProfile* profile, bool enabled) {
        profile->setting = enabled;
        ++profile->writes;
      },
      [](FakeProfile* profile) { return !profile->otr; });
  FakeProfile app{"Default", false, std::nullopt, 0};
  FakeProfile work{"Profile work", false, std::nullopt, 0};
  FakeProfile otr{"Default OTR", true, std::nullopt, 0};
  preference.Added(&work);
  assert(!work.setting && work.writes == 0);
  preference.Set(false, {&app, &work, &otr, nullptr});
  assert(app.setting == false && work.setting == false && !otr.setting && otr.writes == 0);
  FakeProfile later{"Profile later", false, std::nullopt, 0};
  preference.Added(&later);
  assert(later.setting == false);
  preference.Added(&otr);
  preference.Added(nullptr);
  assert(otr.writes == 0);
  preference.Set(true, {&app, &work, &later});
  assert(app.setting == true && work.setting == true && later.setting == true);
  FakeProfile isolated{"Profile isolated", false, std::nullopt, 0};
  preference.Added(&isolated);
  assert(isolated.setting == true && isolated.writes == 1);
  assert(preference.enabled() == true);
  std::puts("auto pip preference scenarios passed");
}
