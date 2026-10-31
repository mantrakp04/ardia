#include "chrome/browser/ardia/ac_input_frame_rate.h"

#include <set>

#include "base/check.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/timer/timer.h"
#include "chrome/browser/performance_manager/public/user_tuning/battery_saver_mode_manager.h"
#include "content/public/browser/browser_thread.h"
#include "ui/aura/env.h"
#include "ui/aura/env_observer.h"
#include "ui/events/event.h"
#include "ui/events/event_observer.h"

namespace ardia {
namespace {

using performance_manager::user_tuning::BatterySaverModeManager;

class InputFrameRate : public ui::EventObserver, public aura::EnvObserver {
 public:
  void Observe() {
    if (observing_ || !aura::Env::HasInstance()) {
      return;
    }
    aura::Env* env = aura::Env::GetInstance();
    env->AddObserver(this);
    env->AddEventObserver(
        this, env,
        {ui::EventType::kKeyPressed, ui::EventType::kKeyReleased,
         ui::EventType::kMousePressed, ui::EventType::kMouseReleased,
         ui::EventType::kMouseDragged, ui::EventType::kMouseMoved,
         ui::EventType::kMouseCaptureChanged, ui::EventType::kMousewheel,
         ui::EventType::kScroll,
         ui::EventType::kScrollFlingStart, ui::EventType::kScrollFlingCancel,
         ui::EventType::kTouchPressed, ui::EventType::kTouchMoved,
         ui::EventType::kTouchReleased, ui::EventType::kTouchCancelled,
         ui::EventType::kGestureScrollUpdate, ui::EventType::kCancelMode});
    observing_ = true;
  }

 private:
  void OnEvent(const ui::Event& event) override {
    if (event.type() == ui::EventType::kCancelMode ||
        event.type() == ui::EventType::kMouseCaptureChanged) {
      Clear();
      return;
    }
    if (event.type() == ui::EventType::kKeyPressed) {
      keys_.insert(event.AsKeyEvent()->key_code());
    } else if (event.type() == ui::EventType::kKeyReleased) {
      keys_.erase(event.AsKeyEvent()->key_code());
    } else if (event.type() == ui::EventType::kMousePressed) {
      buttons_ |= event.AsMouseEvent()->changed_button_flags();
    } else if (event.type() == ui::EventType::kMouseReleased) {
      buttons_ &= ~event.AsMouseEvent()->changed_button_flags();
    }
    Report();
    const base::TimeTicks now = base::TimeTicks::Now();
    if (now - last_hold_ >= base::Milliseconds(100) &&
        BatterySaverModeManager::HasInstance()) {
      last_hold_ = now;
      BatterySaverModeManager::GetInstance()->HoldFullFrameRateForInput();
    }
  }

  void Report() {
    const bool active = buttons_ || !keys_.empty();
    if (active == reported_) {
      return;
    }
    reported_ = active;
    if (active) {
      longest_span_.Start(FROM_HERE, base::Seconds(30),
                          base::BindOnce(&InputFrameRate::Clear,
                                         base::Unretained(this)));
    } else {
      longest_span_.Stop();
    }
    if (BatterySaverModeManager::HasInstance()) {
      BatterySaverModeManager::GetInstance()->SetFullFrameRateInputInProgress(
          active);
    }
  }

  void Clear() {
    keys_.clear();
    buttons_ = 0;
    Report();
  }

  void OnWillDestroyEnv() override {
    aura::Env* env = aura::Env::GetInstance();
    env->RemoveEventObserver(this);
    env->RemoveObserver(this);
    observing_ = false;
    Clear();
  }

  bool observing_ = false;
  bool reported_ = false;
  int buttons_ = 0;
  std::set<ui::KeyboardCode> keys_;
  base::TimeTicks last_hold_;
  base::OneShotTimer longest_span_;
};

}

void HoldFullFrameRateDuringInput() {
  CHECK(content::BrowserThread::CurrentlyOn(content::BrowserThread::UI));
  static base::NoDestructor<InputFrameRate> observer;
  observer->Observe();
}

}
