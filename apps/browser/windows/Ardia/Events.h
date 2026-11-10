#pragma once

#include <string>
#include <string_view>
#include <utility>

#include "NativeModules.h"

namespace Ardia {

template <class TPayload>
void EmitEvent(winrt::Microsoft::ReactNative::ReactContext const &context, std::wstring_view module, std::wstring_view event, TPayload &&payload) noexcept {
  if (!context) return;
  std::wstring name{module};
  name.append(L":").append(event);
  context.EmitJSEvent(L"RCTDeviceEventEmitter", name, std::forward<TPayload>(payload));
}

template <class TWork>
void RunOnUI(winrt::Microsoft::ReactNative::ReactContext const &context, TWork &&work) noexcept {
  context.UIDispatcher().Post(std::forward<TWork>(work));
}

}
