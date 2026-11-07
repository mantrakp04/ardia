#include "ardia/linux/ac_linux_navigation_hold.h"

#include <map>
#include <memory>
#include <utility>
#include <vector>

#include "ardia/linux/ac_linux_site_controls.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle.h"
#include "content/public/browser/navigation_throttle_registry.h"
#include "content/public/browser/web_contents.h"
#include "url/gurl.h"

extern void (*g_ardia_linux_navigation_throttles)(content::NavigationThrottleRegistry& registry);

namespace ardia {
namespace {

namespace controls = linux_site_controls;

class HoldThrottle;

class Hold : public ProfileObserver {
 public:
  explicit Hold(Profile* profile) : profile_(profile) {
    observation_.Observe(profile);
    deadline_.Start(FROM_HERE, base::Milliseconds(controls::kHoldDeadlineMs),
                    base::BindOnce(&Hold::Release, base::Unretained(this), std::string("timed out")));
  }

  void Defer(base::WeakPtr<HoldThrottle> throttle) { throttles_.push_back(std::move(throttle)); }

  void Release(std::string why);

  void OnProfileWillBeDestroyed(Profile* profile) override;

 private:
  raw_ptr<Profile> profile_;
  std::vector<base::WeakPtr<HoldThrottle>> throttles_;
  base::OneShotTimer deadline_;
  base::ScopedObservation<Profile, ProfileObserver> observation_{this};
};

std::map<Profile*, std::unique_ptr<Hold>>& Holds() {
  static base::NoDestructor<std::map<Profile*, std::unique_ptr<Hold>>> holds;
  return *holds;
}

Hold* HoldFor(content::BrowserContext* context) {
  if (Holds().empty() || !context) return nullptr;
  auto found = Holds().find(Profile::FromBrowserContext(context)->GetOriginalProfile());
  return found == Holds().end() ? nullptr : found->second.get();
}

class HoldThrottle : public content::NavigationThrottle {
 public:
  explicit HoldThrottle(content::NavigationThrottleRegistry& registry) : content::NavigationThrottle(registry) {}

  ThrottleCheckResult WillStartRequest() override {
    Hold* hold = HoldFor(navigation_handle()->GetWebContents()->GetBrowserContext());
    if (!hold || !controls::HoldsNavigationTo(navigation_handle()->GetURL().scheme())) return PROCEED;
    hold->Defer(weak_factory_.GetWeakPtr());
    return DEFER;
  }

  const char* GetNameForLogging() override { return "ArdiaLinuxContentBlockerHold"; }

  void ResumeHeld() { Resume(); }

 private:
  base::WeakPtrFactory<HoldThrottle> weak_factory_{this};
};

void Hold::Release(std::string why) {
  auto found = Holds().find(profile_);
  CHECK(found != Holds().end() && found->second.get() == this);
  std::unique_ptr<Hold> self = std::move(found->second);
  Holds().erase(found);
  if (!why.empty()) {
    LOG(WARNING) << "Ardia content blocker: " << throttles_.size()
                 << " held navigations go ahead without its blocking: " << why;
  }
  for (base::WeakPtr<HoldThrottle>& throttle : throttles_) {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&HoldThrottle::ResumeHeld, std::move(throttle)));
  }
}

void Hold::OnProfileWillBeDestroyed(Profile*) {
  observation_.Reset();
  deadline_.Stop();
  auto found = Holds().find(profile_);
  if (found == Holds().end() || found->second.get() != this) return;
  std::unique_ptr<Hold> self = std::move(found->second);
  Holds().erase(found);
}

void MaybeAddHoldThrottle(content::NavigationThrottleRegistry& registry) {
  content::WebContents* contents = registry.GetNavigationHandle().GetWebContents();
  if (contents && HoldFor(contents->GetBrowserContext())) {
    registry.AddThrottle(std::make_unique<HoldThrottle>(registry));
  }
}

}

void InstallLinuxNavigationHold() {
  g_ardia_linux_navigation_throttles = &MaybeAddHoldThrottle;
}

void HoldLinuxNavigations(Profile* profile) {
  if (!profile) return;
  Profile* original = profile->GetOriginalProfile();
  if (Holds().contains(original)) return;
  Holds()[original] = std::make_unique<Hold>(original);
}

void ReleaseLinuxNavigations(Profile* profile, const std::string& why) {
  if (!profile || Holds().empty()) return;
  auto found = Holds().find(profile->GetOriginalProfile());
  if (found != Holds().end()) found->second->Release(why);
}

bool LinuxNavigationsHeld(Profile* profile) {
  return profile && Holds().contains(profile->GetOriginalProfile());
}

}
