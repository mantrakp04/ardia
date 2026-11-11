#pragma once

#include <atomic>

#include "EngineApi.h"

namespace Ardia {

struct Host {
  winrt::Microsoft::ReactNative::ReactNativeHost reactHost;
  winrt::Microsoft::UI::Composition::Compositor compositor{nullptr};
  winrt::Microsoft::UI::Dispatching::DispatcherQueueController queue{nullptr};
  std::atomic<const ArdiaEngineApi *> engine{nullptr};

  static Host *&Current() noexcept {
    static Host *current = nullptr;
    return current;
  }

  static const ArdiaEngineApi *Engine() noexcept {
    Host *host = Current();
    return host ? host->engine.load() : nullptr;
  }
};

}
