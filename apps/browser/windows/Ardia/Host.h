#pragma once

namespace Ardia {

struct Host {
  winrt::Microsoft::ReactNative::ReactNativeHost reactHost;
  winrt::Microsoft::UI::Composition::Compositor compositor{nullptr};
  winrt::Microsoft::UI::Dispatching::DispatcherQueueController queue{nullptr};

  static Host *&Current() noexcept {
    static Host *current = nullptr;
    return current;
  }
};

}
