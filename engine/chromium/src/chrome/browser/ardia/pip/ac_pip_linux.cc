#include "chrome/browser/ardia/pip/ac_pip_mac.h"

#include <unistd.h>

#include <vector>

#include "ardia/core/ac_launch_switches.h"
#include "base/check.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/task/thread_pool.h"
#include "base/timer/timer.h"
#include "base/unguessable_token.h"
#include "chrome/browser/ardia/pip/ac_pip_hyprland.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"
#include "content/public/browser/browser_thread.h"
#include "content/public/browser/web_contents.h"
#include "ui/aura/env.h"
#include "ui/aura/window.h"
#include "ui/compositor/layer.h"
#include "ui/compositor/layer_animation_element.h"
#include "ui/compositor/scoped_layer_animation_settings.h"
#include "ui/events/event.h"
#include "ui/events/event_observer.h"
#include "ui/ozone/public/ozone_platform.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_observer.h"

namespace {

using ardia::pip_linux::Connection;
using ardia::pip_linux::Rectangle;

struct PlacementSnapshot {
  std::optional<Rectangle> bounds;
  Connection connection;
};

PlacementSnapshot InspectHyprland(const std::string& socket,
                                  const std::string& identity,
                                  int pid) {
  auto response = ardia::pip_linux::RequestHyprland(socket, "j/clients");
  auto parsed = response
                    ? base::JSONReader::Read(*response, base::JSON_PARSE_RFC)
                    : std::nullopt;
  if (!parsed || !parsed->is_list()) {
    return {};
  }
  PlacementSnapshot snapshot;
  for (const auto& entry : parsed->GetList()) {
    const auto* client = entry.GetIfDict();
    const auto* window_class = client ? client->FindString("class") : nullptr;
    if (!window_class || *window_class != identity ||
        client->FindInt("pid") != pid ||
        !client->FindBool("mapped").value_or(false) ||
        client->FindBool("hidden").value_or(true) ||
        !client->FindBool("floating").value_or(false)) {
      continue;
    }
    const auto* at = client->FindList("at");
    const auto* size = client->FindList("size");
    if (snapshot.bounds || !at || !size || at->size() != 2 ||
        size->size() != 2 || !(*at)[0].is_int() || !(*at)[1].is_int() ||
        !(*size)[0].is_int() || !(*size)[1].is_int() ||
        (*size)[0].GetInt() <= 0 || (*size)[1].GetInt() <= 0) {
      return {};
    }
    snapshot.bounds = Rectangle{(*at)[0].GetInt(), (*at)[1].GetInt(),
                                (*size)[0].GetInt(), (*size)[1].GetInt()};
  }
  if (snapshot.bounds) {
    snapshot.connection = ardia::pip_linux::ConnectHyprland(socket);
  }
  return snapshot;
}

class HyprlandPlacement : public views::WidgetObserver,
                          public ui::EventObserver {
 public:
  HyprlandPlacement(views::Widget* widget,
                    std::string socket,
                    std::string identity)
      : widget_(widget),
        socket_(std::move(socket)),
        identity_(std::move(identity)) {
    observation_.Observe(widget);
  }

 private:
  ~HyprlandPlacement() override { Stop(); }

  void Stop() {
    timer_.Stop();
    weak_factory_.InvalidateWeakPtrs();
    if (observing_input_) {
      if (aura::Env::HasInstance()) {
        aura::Env::GetInstance()->RemoveEventObserver(this);
      }
      observing_input_ = false;
    }
  }

  void OnWidgetVisibilityChanged(views::Widget*, bool visible) override {
    if (!visible) {
      Stop();
      started_ = false;
      previous_.reset();
      return;
    }
    if (started_) {
      return;
    }
    started_ = true;
    deadline_ = base::TimeTicks::Now() + base::Seconds(1);
    if (aura::Env::HasInstance()) {
      auto* env = aura::Env::GetInstance();
      env->AddEventObserver(
          this, env,
          {ui::EventType::kMousePressed, ui::EventType::kKeyPressed,
           ui::EventType::kTouchPressed, ui::EventType::kMousewheel,
           ui::EventType::kScroll});
      observing_input_ = true;
    }
    Schedule();
  }

  void OnWidgetDestroying(views::Widget*) override { Stop(); }
  void OnWidgetDestroyed(views::Widget*) override {
    observation_.Reset();
    delete this;
  }
  void OnWidgetUserDragStarted(views::Widget*) override { Stop(); }
  void OnWidgetUserResizeStarted(views::Widget*) override { Stop(); }
  void OnEvent(const ui::Event&) override { Stop(); }

  void Schedule() {
    if (base::TimeTicks::Now() >= deadline_) {
      Stop();
      return;
    }
    timer_.Start(FROM_HERE, base::Milliseconds(75),
                 base::BindOnce(&HyprlandPlacement::Inspect,
                                weak_factory_.GetWeakPtr()));
  }

  void Inspect() {
    base::ThreadPool::PostTaskAndReplyWithResult(
        FROM_HERE,
        {base::MayBlock(), base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN},
        base::BindOnce(&InspectHyprland, socket_, identity_, getpid()),
        base::BindOnce(&HyprlandPlacement::OnSnapshot,
                       weak_factory_.GetWeakPtr()));
  }

  void OnSnapshot(PlacementSnapshot snapshot) {
    if (!widget_->IsVisible() || base::TimeTicks::Now() >= deadline_) {
      Stop();
      return;
    }
    if (snapshot.bounds && snapshot.connection &&
        snapshot.bounds == previous_) {
      const auto command = ardia::pip_linux::PlacementCommand(
          identity_, getpid(), *snapshot.bounds);
      Stop();
      ardia::pip_linux::SendHyprland(std::move(snapshot.connection), command);
      return;
    }
    previous_ = snapshot.bounds;
    Schedule();
  }

  raw_ptr<views::Widget> widget_;
  const std::string socket_;
  const std::string identity_;
  bool started_ = false;
  bool observing_input_ = false;
  std::optional<Rectangle> previous_;
  base::TimeTicks deadline_;
  base::OneShotTimer timer_;
  base::ScopedObservation<views::Widget, views::WidgetObserver> observation_{
      this};
  base::WeakPtrFactory<HyprlandPlacement> weak_factory_{this};
};

constexpr char kBoundsKey[] = "ardia-picture-in-picture";

PrefService* WindowPrefs() {
  content::WebContents* contents =
      PictureInPictureWindowManager::GetInstance()->GetWebContents();
  if (!contents) {
    return nullptr;
  }
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  PrefService* service = profile->GetPrefs();
  return service->FindPreference(prefs::kAppWindowPlacement) ? service
                                                             : nullptr;
}

}

std::optional<gfx::Rect> LoadArdiaPictureInPictureBounds() {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  PrefService* service = WindowPrefs();
  if (!service) {
    return std::nullopt;
  }
  const base::ListValue* list =
      service->GetDict(prefs::kAppWindowPlacement).FindList(kBoundsKey);
  if (!list || list->size() != 4) {
    return std::nullopt;
  }
  for (const base::Value& value : *list) {
    if (!value.is_int()) {
      return std::nullopt;
    }
  }
  gfx::Rect bounds((*list)[0].GetInt(), (*list)[1].GetInt(),
                   (*list)[2].GetInt(), (*list)[3].GetInt());
  return bounds.IsEmpty() ? std::nullopt : std::make_optional(bounds);
}

void SaveArdiaPictureInPictureBounds(const gfx::Rect& bounds) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  PrefService* service = WindowPrefs();
  if (!service || bounds.IsEmpty()) {
    return;
  }
  ScopedDictPrefUpdate placement(service, prefs::kAppWindowPlacement);
  placement->Set(kBoundsKey, base::ListValue()
                                 .Append(bounds.x())
                                 .Append(bounds.y())
                                 .Append(bounds.width())
                                 .Append(bounds.height()));
}

void FadeOutArdiaPictureInPicture(gfx::NativeWindow window,
                                  base::TimeDelta duration) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  if (!window || !window->layer()) {
    return;
  }
  ui::Layer* layer = window->layer();
  ui::ScopedLayerAnimationSettings animation(layer->GetAnimator());
  animation.SetTransitionDuration(duration);
  animation.SetTweenType(gfx::Tween::EASE_OUT);
  animation.SetPreemptionStrategy(
      ui::LayerAnimator::IMMEDIATELY_ANIMATE_TO_NEW_TARGET);
  layer->SetOpacity(0.0f);
}

void ResetArdiaPictureInPictureFade(gfx::NativeWindow window) {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  if (!window || !window->layer()) {
    return;
  }
  window->layer()->GetAnimator()->StopAnimatingProperty(
      ui::LayerAnimationElement::OPACITY);
  window->layer()->SetOpacity(1.0f);
}

bool PresentArdiaPictureInPictureControls(
    gfx::NativeWindow window,
    const std::vector<ArdiaPipNativeControl>& controls) {
  return false;
}

void PrepareArdiaPictureInPicture(views::Widget* widget,
                                  views::Widget::InitParams* params) {
  if (ui::OzonePlatform::GetInstance()
          ->GetPlatformProperties()
          .supports_global_screen_coordinates) {
    return;
  }
  auto socket = ardia::pip_linux::HyprlandSocketPath(
      ardiacore::InstanceValue("hyprland-runtime-dir").value_or(""),
      ardiacore::InstanceValue("hyprland-instance").value_or(""));
  if (!socket) {
    return;
  }
  params->wayland_app_id =
      "ardia-pip-" + base::UnguessableToken::Create().ToString();
  new HyprlandPlacement(widget, *socket, params->wayland_app_id);
}
