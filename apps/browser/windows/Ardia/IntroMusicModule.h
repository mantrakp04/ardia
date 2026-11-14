#pragma once

#include "NativeModules.h"

#include "AppModule.h"
#include "IntroMusic.h"

namespace Ardia {

REACT_MODULE(IntroMusicModule, L"ArdiaIntroMusic")
struct IntroMusicModule {
  REACT_METHOD(play)
  void play(bool muted) noexcept {
    AppLaunch::Config const &config = AppLaunch::Shared();
    bool silent = config.background && !config.InstanceFlag("allowAudio");
    IntroMusic::Queue::Shared().Post([muted, silent]() noexcept { IntroMusic::Player::Shared().Play(muted, silent); });
  }

  REACT_METHOD(setMuted)
  void setMuted(bool muted) noexcept {
    IntroMusic::Queue::Shared().Post([muted]() noexcept { IntroMusic::Player::Shared().SetMuted(muted); });
  }

  REACT_METHOD(stop)
  void stop(double fade) noexcept {
    IntroMusic::Queue::Shared().Post([fade]() noexcept { IntroMusic::Player::Shared().Stop(fade); });
  }

  REACT_SYNC_METHOD(embeddedSeconds)
  double embeddedSeconds() noexcept {
    return IntroMusic::EmbeddedSeconds();
  }
};

}
