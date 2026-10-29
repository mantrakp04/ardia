// Copyright 2026 Ardia. Apache-2.0.

#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/json/values_util.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/time/time.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/performance_manager/public/user_tuning/user_performance_tuning_manager.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/profiles/profile_manager_observer.h"
#include "components/performance_manager/public/user_tuning/prefs.h"
#include "components/prefs/pref_service.h"
#include "components/url_matcher/url_util.h"
#include "content/public/browser/browser_thread.h"

namespace ardia {
namespace {

namespace tuning = performance_manager::user_tuning::prefs;

using tuning::MemorySaverModeAggressiveness;
using tuning::MemorySaverModeState;

struct ModeName {
  const char* name;
  MemorySaverModeAggressiveness mode;
};

constexpr ModeName kModes[] = {
    {"moderate", MemorySaverModeAggressiveness::kConservative},
    {"balanced", MemorySaverModeAggressiveness::kMedium},
    {"maximum", MemorySaverModeAggressiveness::kAggressive},
};

std::optional<MemorySaverModeAggressiveness> ModeNamed(const std::string& name) {
  for (const ModeName& entry : kModes) {
    if (name == entry.name) {
      return entry.mode;
    }
  }
  return std::nullopt;
}

const char* NameOfMode(int value) {
  for (const ModeName& entry : kModes) {
    if (static_cast<int>(entry.mode) == value) {
      return entry.name;
    }
  }
  return "balanced";
}

bool IsValidSite(const std::string& site) {
  url_matcher::util::FilterComponents components;
  return !site.empty() &&
         url_matcher::util::FilterToComponents(
             site, &components.scheme, &components.host,
             &components.match_subdomains, &components.port, &components.path,
             &components.query);
}

class KeptActiveSites : public ProfileManagerObserver {
 public:
  static KeptActiveSites& Get() {
    static base::NoDestructor<KeptActiveSites> sites;
    return *sites;
  }

  void Set(std::vector<std::string> sites) {
    sites_ = std::move(sites);
    ProfileManager* manager =
        g_browser_process ? g_browser_process->profile_manager() : nullptr;
    if (!manager) {
      return;
    }
    if (!observation_.IsObserving()) {
      observation_.Observe(manager);
    }
    for (Profile* profile : manager->GetLoadedProfiles()) {
      Apply(profile);
    }
  }

  void OnProfileAdded(Profile* profile) override { Apply(profile); }

  void OnProfileManagerDestroying() override { observation_.Reset(); }

 private:
  void Apply(Profile* profile) {
    if (!sites_ || !profile || !profile->IsRegularProfile()) {
      return;
    }
    PrefService* prefs = profile->GetPrefs();
    const base::DictValue& current =
        prefs->GetDict(tuning::kTabDiscardingExceptionsWithTime);
    base::DictValue next;
    for (const std::string& site : *sites_) {
      const base::Value* added = current.Find(site);
      next.Set(site,
               added ? added->Clone() : base::TimeToValue(base::Time::Now()));
    }
    if (next != current) {
      prefs->SetDict(tuning::kTabDiscardingExceptionsWithTime,
                     std::move(next));
    }
  }

  std::optional<std::vector<std::string>> sites_;
  base::ScopedObservation<ProfileManager, ProfileManagerObserver> observation_{
      this};
};

}
}

AC_PROFILE_CALL(ac_memory_saver) {
  ardia::Reply out = call.TakeReply();
  const base::DictValue& args = call.args();
  PrefService* local_state =
      g_browser_process ? g_browser_process->local_state() : nullptr;
  if (!local_state) {
    return out.Error("no local state");
  }
  if (const std::string* validate = args.FindString("validate")) {
    return out.Send(
        base::DictValue().Set("valid", ardia::IsValidSite(*validate)));
  }
  if (const std::string* state = args.FindString("state")) {
    if (*state != "on" && *state != "off") {
      return out.Error("state is on or off");
    }
    local_state->SetInteger(
        ardia::tuning::kMemorySaverModeState,
        static_cast<int>(*state == "on"
                             ? ardia::tuning::MemorySaverModeState::kEnabled
                             : ardia::tuning::MemorySaverModeState::kDisabled));
  }
  if (const std::string* name = args.FindString("aggressiveness")) {
    std::optional<ardia::tuning::MemorySaverModeAggressiveness> mode =
        ardia::ModeNamed(*name);
    if (!mode) {
      return out.Error("aggressiveness is moderate, balanced or maximum");
    }
    local_state->SetInteger(ardia::tuning::kMemorySaverModeAggressiveness,
                            static_cast<int>(*mode));
  }
  base::ListValue invalid;
  if (const base::ListValue* sites = args.FindList("sites")) {
    std::vector<std::string> kept;
    for (const base::Value& site : *sites) {
      const std::string* text = site.GetIfString();
      if (text && ardia::IsValidSite(*text)) {
        kept.push_back(*text);
      } else if (text) {
        invalid.Append(*text);
      }
    }
    ardia::KeptActiveSites::Get().Set(std::move(kept));
  }
  base::ListValue applied;
  for (const auto entry : call.profile()->GetPrefs()->GetDict(
           ardia::tuning::kTabDiscardingExceptionsWithTime)) {
    applied.Append(entry.first);
  }
  using performance_manager::user_tuning::UserPerformanceTuningManager;
  const bool active =
      UserPerformanceTuningManager::HasInstance() &&
      UserPerformanceTuningManager::GetInstance()->IsMemorySaverModeActive();
  out.Send(base::DictValue()
               .Set("state",
                    local_state->GetInteger(
                        ardia::tuning::kMemorySaverModeState) ==
                            static_cast<int>(
                                ardia::tuning::MemorySaverModeState::kEnabled)
                        ? "on"
                        : "off")
               .Set("aggressiveness",
                    ardia::NameOfMode(local_state->GetInteger(
                        ardia::tuning::kMemorySaverModeAggressiveness)))
               .Set("active", active)
               .Set("sites", std::move(applied))
               .Set("invalid", std::move(invalid)));
}
