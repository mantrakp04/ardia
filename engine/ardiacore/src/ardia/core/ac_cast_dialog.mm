#include "ardia/core/ac_cast_dialog.h"

#import <Foundation/Foundation.h>

#include <map>
#include <memory>
#include <string>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/media/router/media_router_feature.h"
#include "chrome/browser/ui/media_router/cast_dialog_controller.h"
#include "chrome/browser/ui/media_router/cast_dialog_model.h"
#include "chrome/browser/ui/media_router/media_router_ui.h"
#include "chrome/browser/ui/media_router/ui_media_sink.h"
#include "components/media_router/browser/media_router_dialog_controller.h"
#include "components/media_router/browser/media_router_metrics.h"
#include "chrome/browser/ui/media_router/media_cast_mode.h"
#include "content/public/browser/web_contents.h"
#include "base/scoped_observation.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "components/media_router/browser/media_router.h"
#include "components/media_router/browser/media_router_factory.h"
#include "components/media_router/browser/media_routes_observer.h"
#include "components/media_router/common/media_route.h"
#include <vector>
#include "ardia/core/ac_browser.h"
#include "ardia/core/ac_test_media_route_provider.h"

namespace ardiacore {

namespace {

NSString* SinkState(media_router::UIMediaSinkState state) {
  switch (state) {
    case media_router::UIMediaSinkState::AVAILABLE:
      return @"available";
    case media_router::UIMediaSinkState::CONNECTING:
      return @"connecting";
    case media_router::UIMediaSinkState::CONNECTED:
      return @"connected";
    case media_router::UIMediaSinkState::DISCONNECTING:
      return @"disconnecting";
    case media_router::UIMediaSinkState::UNAVAILABLE:
      return @"unavailable";
  }
  return @"unavailable";
}

class CastDialog;

std::map<int, std::unique_ptr<CastDialog>>& Live() {
  static base::NoDestructor<std::map<int, std::unique_ptr<CastDialog>>> live;
  return *live;
}

class CastDialog : public media_router::CastDialogController::Observer {
 public:
  CastDialog(content::WebContents* initiator,
             media_router::MediaRouterUI* ui,
             base::ScopedClosureRunner fullscreen_blocker)
      : initiator_(initiator->GetWeakPtr()),
        ui_(ui->GetWeakPtr()),
        fullscreen_blocker_(std::move(fullscreen_blocker)) {
    static int last_id = 0;
    id_ = ++last_id;
  }
  ~CastDialog() override { Detach(); }

  int id() const { return id_; }

  void Start() {
    if (ui_) {
      ui_->AddObserver(this);
    }
    announced_ = true;
    Notify();
  }

  void StartCasting(const std::string& sink_id, int cast_mode) {
    if (ui_) {
      ui_->StartCasting(sink_id, static_cast<media_router::MediaCastMode>(cast_mode));
    }
  }

  void StopCasting(const std::string& route_id) {
    if (ui_) {
      ui_->StopCasting(route_id);
    }
  }

  void Close() {
    if (!open_) {
      return;
    }
    if (initiator_) {
      media_router::MediaRouterDialogController::GetOrCreateForWebContents(
          initiator_.get())
          ->HideMediaRouterDialog();
    }
    if (open_) {
      Detach();
      Notify();
      Forget();
    }
  }

  void OnModelUpdated(const media_router::CastDialogModel& model) override {
    NSMutableArray* sinks = [NSMutableArray array];
    for (const auto& sink : model.media_sinks()) {
      int modes = 0;
      for (auto mode : sink.cast_modes) {
        modes |= static_cast<int>(mode);
      }
      [sinks addObject:@{
        @"id" : base::SysUTF8ToNSString(sink.id),
        @"name" : base::SysUTF16ToNSString(sink.friendly_name),
        @"status" : base::SysUTF16ToNSString(sink.GetStatusTextForDisplay()),
        @"state" : SinkState(sink.state),
        @"icon" : @(static_cast<int>(sink.icon_type)),
        @"modes" : @(modes),
        @"routeId" : sink.route ? base::SysUTF8ToNSString(sink.route->media_route_id()) : @"",
        @"issue" : sink.issue ? base::SysUTF8ToNSString(sink.issue->info().title) : @"",
      }];
    }
    header_ = base::SysUTF16ToNSString(model.dialog_header());
    permission_rejected_ = model.is_permission_rejected();
    sinks_ = sinks;
    Notify();
  }

  void OnCastingStarted() override {
    casting_started_ = true;
    Notify();
  }

  void OnControllerDestroying() override {
    ui_.reset();
    Detach();
    Notify();
    Forget();
  }

 private:
  NSDictionary* State() const {
    return @{
      @"id" : @(id_),
      @"open" : @(open_),
      @"header" : header_ ?: @"",
      @"permissionRejected" : @(permission_rejected_),
      @"castingStarted" : @(casting_started_),
      @"sinks" : sinks_ ?: @[],
    };
  }

  void Notify() {
    if (announced_ && initiator_) {
      HostCastDialog(initiator_.get(), State());
    }
  }

  void Detach() {
    if (ui_) {
      ui_->RemoveObserver(this);
      ui_.reset();
    }
    open_ = false;
    fullscreen_blocker_.RunAndReset();
  }

  void Forget() {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce([](int id) { Live().erase(id); }, id_));
  }

  base::WeakPtr<content::WebContents> initiator_;
  base::WeakPtr<media_router::MediaRouterUI> ui_;
  base::ScopedClosureRunner fullscreen_blocker_;
  int id_;
  bool open_ = true;
  bool announced_ = false;
  bool casting_started_ = false;
  bool permission_rejected_ = false;
  NSString* __strong header_;
  NSArray* __strong sinks_;
};

CastDialog* Find(int id) {
  auto it = Live().find(id);
  return it == Live().end() ? nullptr : it->second.get();
}

class RoutesWatcher : public media_router::MediaRoutesObserver,
                      public ProfileObserver {
 public:
  RoutesWatcher(media_router::MediaRouter* router, Profile* profile)
      : media_router::MediaRoutesObserver(router), profile_(profile) {
    profile_observation_.Observe(profile);
  }

  void OnRoutesUpdated(const std::vector<media_router::MediaRoute>& routes) override {
    NSMutableArray* list = [NSMutableArray array];
    for (const auto& route : routes) {
      [list addObject:@{
        @"id" : base::SysUTF8ToNSString(route.media_route_id()),
        @"sink" : base::SysUTF8ToNSString(route.media_sink_id()),
        @"description" : base::SysUTF8ToNSString(route.description()),
        @"source" : base::SysUTF8ToNSString(route.media_source().id()),
      }];
    }
    HostCastRoutes(profile_, list);
  }

  void OnProfileWillBeDestroyed(Profile* profile) override;

  media_router::MediaRouter* media_router() const { return router(); }

 private:
  raw_ptr<Profile> profile_;
  base::ScopedObservation<Profile, ProfileObserver> profile_observation_{this};
};

std::map<Profile*, std::unique_ptr<RoutesWatcher>>& Watchers() {
  static base::NoDestructor<std::map<Profile*, std::unique_ptr<RoutesWatcher>>> watchers;
  return *watchers;
}

void RoutesWatcher::OnProfileWillBeDestroyed(Profile* profile) {
  profile_observation_.Reset();
  Watchers().erase(profile);
}

}

void WatchCastRoutes(Profile* profile) {
  MaybeRegisterTestMediaRouteProvider(profile);
  if (!profile || Watchers().contains(profile) ||
      !media_router::MediaRouterEnabled(profile)) {
    return;
  }
  media_router::MediaRouter* router =
      media_router::MediaRouterFactory::GetApiForBrowserContext(profile);
  if (!router) {
    return;
  }
  Watchers()[profile] = std::make_unique<RoutesWatcher>(router, profile);
  Watchers()[profile]->OnRoutesUpdated(router->GetCurrentRoutes());
}

void TerminateCastRoute(const std::string& route_id) {
  for (auto& [profile, watcher] : Watchers()) {
    for (const auto& route : watcher->media_router()->GetCurrentRoutes()) {
      if (route.media_route_id() == route_id) {
        watcher->media_router()->TerminateRoute(route_id);
        return;
      }
    }
  }
}

bool WantsCastDialog(content::WebContents* initiator) {
  return WindowHost::ForContents(initiator);
}

bool HandleCastDialog(content::WebContents* initiator,
                      media_router::MediaRouterUI* ui,
                      base::ScopedClosureRunner* fullscreen_blocker) {
  if (!ui || !fullscreen_blocker || !WantsCastDialog(initiator)) {
    return false;
  }
  auto dialog =
      std::make_unique<CastDialog>(initiator, ui, std::move(*fullscreen_blocker));
  CastDialog* raw = dialog.get();
  Live()[raw->id()] = std::move(dialog);
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](int id) {
                       if (CastDialog* dialog = Find(id)) {
                         dialog->Start();
                       }
                     },
                     raw->id()));
  return true;
}

bool ShowCastDialog(content::WebContents* contents) {
  if (!contents || !media_router::MediaRouterEnabled(contents->GetBrowserContext())) {
    return false;
  }
  MaybeRegisterTestMediaRouteProvider(
      Profile::FromBrowserContext(contents->GetBrowserContext()));
  media_router::MediaRouterDialogController::GetOrCreateForWebContents(contents)
      ->ShowMediaRouterDialog(
          media_router::MediaRouterDialogActivationLocation::TOOLBAR);
  return true;
}

void StartCasting(int dialog_id, const std::string& sink_id, int cast_mode) {
  if (CastDialog* dialog = Find(dialog_id)) {
    dialog->StartCasting(sink_id, cast_mode);
  }
}

void StopCasting(int dialog_id, const std::string& route_id) {
  if (CastDialog* dialog = Find(dialog_id)) {
    dialog->StopCasting(route_id);
  }
}

void CloseCastDialog(int dialog_id) {
  if (CastDialog* dialog = Find(dialog_id)) {
    dialog->Close();
  }
}

}
