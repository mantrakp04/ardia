// Copyright 2026 Ardia. Apache-2.0.

#include "chrome/browser/ardia/ac_engine.h"

#include <cmath>

#include "base/callback_list.h"
#include "base/functional/bind.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/host_zoom_map.h"
#include "third_party/blink/public/common/page/page_zoom.h"

namespace ardia {
namespace {

content::HostZoomMap* ZoomMap(Profile* profile) {
  return content::HostZoomMap::GetDefaultForBrowserContext(profile);
}

Profile* ZoomProfile(const Call& call) {
  std::optional<int> tab = call.args().FindInt("tab");
  if (!tab) {
    return call.profile();
  }
  content::WebContents* contents = TabWithId(*tab);
  if (!contents) {
    return nullptr;
  }
  Profile* found = Profile::FromBrowserContext(contents->GetBrowserContext());
  if (call.profile()->IsOffTheRecord()) {
    return found == call.profile() ? found : nullptr;
  }
  return found->GetOriginalProfile() == call.profile() ? found : nullptr;
}

class ZoomState : public ProfileState {
 public:
  explicit ZoomState(Profile* profile) : ProfileState(profile) {
    subscription_ = ZoomMap(profile)->AddZoomLevelChangedCallback(
        base::BindRepeating(&ZoomState::Changed, base::Unretained(this)));
  }

 private:
  void Release() override { subscription_ = {}; }

  void Changed(const content::HostZoomMap::ZoomLevelChange& change) {
    if (change.mode != content::HostZoomMap::ZOOM_CHANGED_FOR_HOST) {
      return;
    }
    Emit("zoom.changed", profile(),
         base::DictValue()
             .Set("host", change.host)
             .Set("level", change.zoom_level));
  }

  base::CallbackListSubscription subscription_;
};

}
}

AC_PROFILE_CALL(ac_zoom_list, ardia::OffTheRecord::kAllow) {
  Profile* profile = ardia::ZoomProfile(call);
  if (!profile) {
    return call.TakeReply().Error("no such tab");
  }
  ardia::StateFor<ardia::ZoomState>(profile);
  content::HostZoomMap* map = ardia::ZoomMap(profile);
  const double fallback = map->GetDefaultZoomLevel();
  base::DictValue levels;
  for (const auto& entry : map->GetAllZoomLevels()) {
    if (entry.mode == content::HostZoomMap::ZOOM_CHANGED_FOR_HOST &&
        !blink::ZoomValuesEqual(entry.zoom_level, fallback)) {
      levels.Set(entry.host, entry.zoom_level);
    }
  }
  call.TakeReply().Send(base::DictValue().Set("levels", std::move(levels)));
}

AC_PROFILE_CALL(ac_zoom_set, ardia::OffTheRecord::kAllow) {
  Profile* profile = ardia::ZoomProfile(call);
  if (!profile) {
    return call.TakeReply().Error("no such tab");
  }
  ardia::StateFor<ardia::ZoomState>(profile);
  const std::string host = call.String("host");
  const double level = call.Double("level");
  if (host.empty() || !std::isfinite(level)) {
    return call.TakeReply().Error("host and level required");
  }
  content::HostZoomMap* map = ardia::ZoomMap(profile);
  map->SetZoomLevelForHost(
      host, blink::ZoomValuesEqual(level, 0) ? map->GetDefaultZoomLevel()
                                             : level);
  call.TakeReply().Ok();
}
