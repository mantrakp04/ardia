#pragma once

#include "LaunchLog.h"

namespace Ardia {

struct LoggedErrors : winrt::implements<LoggedErrors, winrt::Microsoft::ReactNative::IRedBoxHandler> {
  void ShowNewError(winrt::Microsoft::ReactNative::IRedBoxErrorInfo const &info, winrt::Microsoft::ReactNative::RedBoxErrorType) noexcept {
    LaunchLog::Write(L"js-error", info.Message());
    uint32_t written = 0;
    for (auto const &frame : info.Callstack()) {
      if (written++ == 16) break;
      std::wstring line = std::wstring{L"  at "} + frame.Method().c_str() + L" (" + frame.File().c_str() + L":" + std::to_wstring(frame.Line()) + L":" + std::to_wstring(frame.Column()) + L")";
      LaunchLog::Write(L"js-error", line);
    }
  }

  bool IsDevSupportEnabled() noexcept { return true; }

  void UpdateError(winrt::Microsoft::ReactNative::IRedBoxErrorInfo const &) noexcept {}

  void DismissRedBox() noexcept {}
};

}
