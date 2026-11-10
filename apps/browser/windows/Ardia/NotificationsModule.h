#pragma once

#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "NativeModules.h"
#include "Events.h"
#include "LaunchLog.h"
#include "Paths.h"

#pragma comment(lib, "shell32.lib")

namespace Ardia {

REACT_STRUCT(NotificationPostOptions)
struct NotificationPostOptions {
  REACT_FIELD(id)
  std::optional<std::string> id;
  REACT_FIELD(title)
  std::string title;
  REACT_FIELD(body)
  std::optional<std::string> body;
  REACT_FIELD(subtitle)
  std::optional<std::string> subtitle;
  REACT_FIELD(silent)
  std::optional<bool> silent;
  REACT_FIELD(icon)
  std::optional<std::string> icon;
  REACT_FIELD(tabId)
  std::optional<std::string> tabId;
  REACT_FIELD(windowId)
  std::optional<std::string> windowId;
  REACT_FIELD(origin)
  std::optional<std::string> origin;
  REACT_FIELD(dismissible)
  std::optional<bool> dismissible;
};

namespace NotificationParts {

enum class Authorization { NotDetermined, Denied, Granted };

inline const char *AuthorizationName(Authorization authorization) noexcept {
  switch (authorization) {
    case Authorization::Granted: return "granted";
    case Authorization::Denied: return "denied";
    default: return "notDetermined";
  }
}

struct ToastCenter {
  virtual ~ToastCenter() noexcept = default;
  virtual Authorization Status() noexcept = 0;
  virtual bool RequestAuthorization() noexcept = 0;
  virtual std::optional<std::string> Post(NotificationPostOptions const &options) noexcept = 0;
  virtual void Remove(std::vector<std::string> const &ids) noexcept = 0;
};

struct UnregisteredToastCenter final : ToastCenter {
  Authorization Status() noexcept override {
    return Authorization::NotDetermined;
  }

  bool RequestAuthorization() noexcept override {
    return false;
  }

  std::optional<std::string> Post(NotificationPostOptions const &) noexcept override {
    return std::nullopt;
  }

  void Remove(std::vector<std::string> const &) noexcept override {}
};

inline std::unique_ptr<ToastCenter> MakeToastCenter() noexcept {
  return std::make_unique<UnregisteredToastCenter>();
}

}

REACT_MODULE(NotificationsModule, L"ArdiaNotifications")
struct NotificationsModule {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
  }

  REACT_METHOD(notificationPermission)
  void notificationPermission(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    promise.Resolve(NotificationParts::AuthorizationName(m_center->Status()));
  }

  REACT_METHOD(requestNotificationPermission)
  void requestNotificationPermission(winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    promise.Resolve(m_center->RequestAuthorization());
  }

  REACT_METHOD(postNotification)
  void postNotification(NotificationPostOptions options, winrt::Microsoft::ReactNative::ReactPromise<std::optional<std::string>> promise) noexcept {
    promise.Resolve(m_center->Post(options));
  }

  REACT_METHOD(removeNotifications)
  void removeNotifications(std::vector<std::string> ids, winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    m_center->Remove(ids);
    promise.Resolve();
  }

  REACT_METHOD(openNotificationSettings)
  void openNotificationSettings(winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    if (Paths::Environment(L"ARDIA_BACKGROUND") == L"1") {
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
  std::unique_ptr<NotificationParts::ToastCenter> m_center = NotificationParts::MakeToastCenter();
};

}
