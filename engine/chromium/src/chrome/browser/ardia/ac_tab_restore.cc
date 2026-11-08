// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_tab_restore.h"

#include <limits>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/values.h"
#include "chrome/browser/ardia/ac_engine.h"
#include "chrome/browser/ardia/ac_tab_restore_internal.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/sessions/tab_restore_service_factory.h"
#include "components/sessions/core/serialized_navigation_entry.h"
#include "components/sessions/core/session_id.h"
#include "components/sessions/core/tab_restore_service.h"
#include "components/sessions/core/tab_restore_service_observer.h"
#include "components/sessions/core/tab_restore_types.h"

namespace ardia {

namespace {

using tab_restore_internal::kTabKey;
using tab_restore_internal::PackNavigations;

using sessions::tab_restore::Entry;
using sessions::tab_restore::Group;
using sessions::tab_restore::Tab;
using sessions::tab_restore::Type;
using sessions::tab_restore::Window;

bool HasKey(const Tab& tab, const std::string& key) {
  for (const auto& navigation : tab.navigations) {
    auto it = navigation.extended_info_map().find(kTabKey);
    if (it != navigation.extended_info_map().end() && it->second == key) {
      return true;
    }
  }
  return false;
}

struct Candidate {
  const Tab* tab = nullptr;
  bool top_level = false;
};

void Collect(const Entry& entry, std::vector<Candidate>* out) {
  switch (entry.type) {
    case Type::TAB:
      out->push_back({static_cast<const Tab*>(&entry), true});
      break;
    case Type::WINDOW:
      for (const auto& tab : static_cast<const Window&>(entry).tabs) {
        out->push_back({tab.get(), false});
      }
      break;
    case Type::GROUP:
      for (const auto& tab : static_cast<const Group&>(entry).tabs) {
        out->push_back({tab.get(), false});
      }
      break;
    default:
      break;
  }
}

std::string NavigationState(const Tab& tab) {
  return PackNavigations(tab.normalized_navigation_index(), tab.navigations);
}

void Take(sessions::TabRestoreService* service,
          const std::string& key,
          bool keep,
          Reply reply) {
  std::vector<Candidate> candidates;
  for (const auto& entry : service->entries()) {
    Collect(*entry, &candidates);
  }
  const Candidate* best = nullptr;
  for (const auto& candidate : candidates) {
    const Tab& tab = *candidate.tab;
    if (!tab.navigations.empty() && HasKey(tab, key) &&
        (!best || tab.timestamp > best->tab->timestamp)) {
      best = &candidate;
    }
  }
  if (!best) {
    return reply.Send(base::DictValue().Set("state", base::Value()));
  }
  std::string state = NavigationState(*best->tab);
  base::DictValue taken;
  if (keep) {
    taken.Set("entry", best->top_level
                           ? base::Value(best->tab->id.id())
                           : base::Value());
  } else if (best->top_level) {
    service->RemoveEntryById(best->tab->id);
  }
  taken.Set("state", std::move(state));
  reply.Send(std::move(taken));
}

void Forget(sessions::TabRestoreService* service, SessionID entry) {
  for (const auto& candidate : service->entries()) {
    if (candidate->type == Type::TAB && candidate->id == entry) {
      service->RemoveEntryById(entry);
      return;
    }
  }
}

class WhenLoaded : public sessions::TabRestoreServiceObserver {
 public:
  static void Run(sessions::TabRestoreService* service,
                  base::OnceClosure then) {
    if (service->IsLoaded()) {
      return std::move(then).Run();
    }
    new WhenLoaded(service, std::move(then));
    service->LoadTabsFromLastSession();
  }

  void TabRestoreServiceLoaded(sessions::TabRestoreService*) override {
    Finish();
  }
  void TabRestoreServiceDestroyed(sessions::TabRestoreService*) override {
    observation_.Reset();
    delete this;
  }

 private:
  WhenLoaded(sessions::TabRestoreService* service, base::OnceClosure then)
      : then_(std::move(then)) {
    observation_.Observe(service);
  }

  void Finish() {
    observation_.Reset();
    base::OnceClosure then = std::move(then_);
    delete this;
    std::move(then).Run();
  }

  base::OnceClosure then_;
  base::ScopedObservation<sessions::TabRestoreService,
                          sessions::TabRestoreServiceObserver>
      observation_{this};
};

sessions::TabRestoreService* ServiceFor(Profile* profile) {
  return profile && !profile->IsOffTheRecord()
             ? TabRestoreServiceFactory::GetForProfile(profile)
             : nullptr;
}

}

}

using ardia::Call;
using ardia::Reply;

AC_PROFILE_CALL(ac_tab_restore_take) {
  sessions::TabRestoreService* service = ardia::ServiceFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no tab restore service");
  }
  const std::string key = call.String("key");
  if (key.empty()) {
    return call.TakeReply().Error("no key");
  }
  base::WeakPtr<Profile> profile = call.profile()->GetWeakPtr();
  ardia::WhenLoaded::Run(
      service,
      base::BindOnce(
          [](base::WeakPtr<Profile> profile, std::string key, bool keep,
             Reply reply) {
            auto* service =
                profile ? ardia::ServiceFor(profile.get()) : nullptr;
            if (!service) {
              return reply.Error("profile went away");
            }
            ardia::Take(service, key, keep, std::move(reply));
          },
          profile, key, call.Bool("keep"), call.TakeReply()));
}

AC_PROFILE_CALL(ac_tab_restore_forget) {
  sessions::TabRestoreService* service = ardia::ServiceFor(call.profile());
  const double entry = call.Double("entry", -1);
  if (!service || !service->IsLoaded()) {
    return call.TakeReply().Error("no loaded tab restore service");
  }
  if (entry <= 0 || entry > std::numeric_limits<SessionID::id_type>::max() ||
      entry != static_cast<SessionID::id_type>(entry)) {
    return call.TakeReply().Error("no entry");
  }
  ardia::Forget(service, SessionID::FromSerializedValue(
                             static_cast<SessionID::id_type>(entry)));
  call.TakeReply().Send(base::DictValue());
}
