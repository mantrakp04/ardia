#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "NativeModules.h"
#include "Events.h"
#include "LaunchLog.h"
#include "NotificationCenter.h"
#include "LaunchConfig.h"
#include "Paths.h"

#pragma comment(lib, "shell32.lib")

namespace Ardia {

REACT_MODULE(NotificationsModule, L"ArdiaNotifications")
struct NotificationsModule {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
    RunOnUI(context, [context]() noexcept { NotificationParts::NotificationHub::Shared().Attach(context); });
  }

  REACT_METHOD(notificationPermission)
  void notificationPermission(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    NotificationParts::RunOffThread([promise]() noexcept {
      promise.Resolve(NotificationParts::AuthorizationName(NotificationParts::NotificationHub::Shared().Center()->Status()));
    });
  }

  REACT_METHOD(requestNotificationPermission)
  void requestNotificationPermission(winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    NotificationParts::RunOffThread([promise]() noexcept { promise.Resolve(NotificationParts::NotificationHub::Shared().Center()->RequestAuthorization()); });
  }

  REACT_METHOD(postNotification)
  void postNotification(winrt::Microsoft::ReactNative::JSValue options, winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    NotificationParts::NotificationRequest request = NotificationParts::NotificationRequest::From(options);
    NotificationParts::RunOffThread([request, promise]() noexcept { promise.Resolve(NotificationParts::NotificationHub::Shared().Center()->Post(request)); });
  }

  REACT_METHOD(removeNotifications)
  void removeNotifications(std::vector<std::string> ids, winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    NotificationParts::RunOffThread([ids, promise]() noexcept {
      NotificationParts::NotificationHub::Shared().Center()->Remove(ids);
      promise.Resolve();
    });
  }

  REACT_SYNC_METHOD(notificationCenterPath)
  std::string notificationCenterPath() noexcept {
    return NotificationParts::NotificationHub::Shared().Path();
  }

  REACT_METHOD(openNotificationSettings)
  void openNotificationSettings(winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    if (AppLaunch::Background()) {
      LaunchLog::Write(L"info", L"ArdiaNotifications.openNotificationSettings (not shown): ms-settings:notifications");
      promise.Resolve();
      return;
    }
    RunOnUI(m_context, [promise]() noexcept {
      ShellExecuteW(nullptr, L"open", L"ms-settings:notifications", nullptr, nullptr, SW_SHOWNORMAL);
      promise.Resolve();
    });
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
};

}
