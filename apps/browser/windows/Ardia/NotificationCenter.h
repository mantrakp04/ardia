#pragma once

#include <chrono>
#include <memory>
#include <mutex>
#include <iterator>
#include <optional>
#include <string>
#include <thread>
#include <type_traits>
#include <vector>

#include <objbase.h>
#include <shlwapi.h>
#include <urlmon.h>
#include <wincrypt.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Microsoft.Windows.AppLifecycle.h>
#include <winrt/Microsoft.Windows.AppNotifications.h>
#include <winrt/Microsoft.Windows.AppNotifications.Builder.h>

#include "AppIcon.h"
#include "Events.h"
#include "Host.h"
#include "LaunchLog.h"
#include "NotificationJson.h"
#include "Paths.h"
#include "WindowManager.h"

#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "urlmon.lib")

namespace Ardia::NotificationParts {

enum class Authorization { NotDetermined, Denied, Granted };

inline const char *AuthorizationName(Authorization authorization) noexcept {
  switch (authorization) {
    case Authorization::Granted: return "granted";
    case Authorization::Denied: return "denied";
    default: return "notDetermined";
  }
}

inline std::wstring HexCode(int32_t code) noexcept {
  wchar_t buffer[16]{};
  swprintf_s(buffer, L"%08X", static_cast<unsigned int>(code));
  return buffer;
}

struct NotificationRequest {
  std::string id;
  std::string title;
  std::string body;
  std::optional<std::string> subtitle;
  bool silent{false};
  std::optional<std::string> icon;
  std::optional<std::string> tabId;
  std::optional<std::string> windowId;
  std::optional<std::string> origin;
  bool dismissible{false};
  std::string dataJson;

  static std::optional<std::string> StringField(winrt::Microsoft::ReactNative::JSValue const &options, std::string_view name) noexcept {
    auto field = options.TryGetObjectProperty(name);
    if (!field) return std::nullopt;
    auto text = field->TryGetString();
    if (!text || text->empty()) return std::nullopt;
    return *text;
  }

  static bool FlagField(winrt::Microsoft::ReactNative::JSValue const &options, std::string_view name) noexcept {
    auto field = options.TryGetObjectProperty(name);
    auto flag = field ? field->TryGetBoolean() : nullptr;
    return flag && *flag;
  }

  static NotificationRequest From(winrt::Microsoft::ReactNative::JSValue const &options) noexcept {
    NotificationRequest request;
    request.id = StringField(options, "id").value_or(std::string{});
    request.title = StringField(options, "title").value_or(std::string{});
    request.body = StringField(options, "body").value_or(std::string{});
    request.subtitle = StringField(options, "subtitle");
    request.silent = FlagField(options, "silent");
    request.icon = StringField(options, "icon");
    request.tabId = StringField(options, "tabId");
    request.windowId = StringField(options, "windowId");
    request.origin = StringField(options, "origin");
    request.dismissible = FlagField(options, "dismissible");
    if (auto data = options.TryGetObjectProperty("data"); data && !data->IsNull()) request.dataJson = ToJson(*data);
    return request;
  }
};

struct NotificationResponse {
  std::string id;
  std::string action;
  std::optional<std::string> tabId;
  std::optional<std::string> windowId;
  std::string dataJson;
};

struct ToastCenter {
  virtual ~ToastCenter() noexcept = default;
  virtual Authorization Status() noexcept = 0;
  virtual bool RequestAuthorization() noexcept = 0;
  virtual std::optional<std::string> Post(NotificationRequest const &request) noexcept = 0;
  virtual void Remove(std::vector<std::string> const &ids) noexcept = 0;
};

struct UnregisteredToastCenter final : ToastCenter {
  Authorization Status() noexcept override {
    return Authorization::NotDetermined;
  }

  bool RequestAuthorization() noexcept override {
    return false;
  }

  std::optional<std::string> Post(NotificationRequest const &) noexcept override {
    return std::nullopt;
  }

  void Remove(std::vector<std::string> const &) noexcept override {}
};

inline std::string NewNotificationId() noexcept {
  GUID guid{};
  if (FAILED(CoCreateGuid(&guid))) return std::to_string(GetTickCount64());
  wchar_t buffer[64]{};
  int length = StringFromGUID2(guid, buffer, static_cast<int>(std::size(buffer)));
  if (length < 3) return std::to_string(GetTickCount64());
  std::wstring text(buffer + 1, static_cast<size_t>(length) - 3);
  return Paths::Utf8(text);
}

inline uint64_t Fnv1a(std::string_view text) noexcept {
  uint64_t hash = 14695981039346656037ull;
  for (char c : text) {
    hash ^= static_cast<unsigned char>(c);
    hash *= 1099511628211ull;
  }
  return hash;
}

inline winrt::hstring ToastTag(std::string const &id) noexcept {
  std::wstring wide = Paths::Wide(id);
  if (!wide.empty() && wide.size() <= 64) return winrt::hstring{wide};
  wchar_t buffer[24]{};
  swprintf_s(buffer, L"h%016llx", static_cast<unsigned long long>(Fnv1a(id)));
  return winrt::hstring{buffer};
}

inline std::wstring TempIconPath(std::string const &id, const wchar_t *extension) noexcept {
  wchar_t folder[MAX_PATH + 1]{};
  DWORD length = GetTempPathW(MAX_PATH + 1, folder);
  if (length == 0 || length > MAX_PATH) return {};
  wchar_t name[48]{};
  swprintf_s(name, L"ac-notification-%016llx.", static_cast<unsigned long long>(Fnv1a(id)));
  return std::wstring(folder).append(name).append(extension);
}

inline std::optional<std::wstring> FileUrlOf(std::wstring const &path) noexcept {
  wchar_t url[4096]{};
  DWORD size = static_cast<DWORD>(std::size(url));
  if (FAILED(UrlCreateFromPathW(path.c_str(), url, &size, 0))) return std::nullopt;
  return std::wstring(url);
}

inline std::optional<std::wstring> DataUriIcon(std::string const &icon, std::string const &id) noexcept {
  size_t marker = icon.find(";base64,");
  if (marker == std::string::npos) return std::nullopt;
  std::string_view mime = std::string_view{icon}.substr(5, marker - 5);
  const wchar_t *extension = mime == "image/jpeg" ? L"jpg" : mime == "image/gif" ? L"gif" : L"png";
  std::string_view encoded = std::string_view{icon}.substr(marker + 8);
  DWORD size = 0;
  if (!CryptStringToBinaryA(encoded.data(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64, nullptr, &size, nullptr, nullptr) || size == 0) return std::nullopt;
  std::vector<BYTE> bytes(size);
  if (!CryptStringToBinaryA(encoded.data(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64, bytes.data(), &size, nullptr, nullptr)) return std::nullopt;
  std::wstring path = TempIconPath(id, extension);
  if (path.empty()) return std::nullopt;
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY, nullptr);
  if (file == INVALID_HANDLE_VALUE) return std::nullopt;
  DWORD written = 0;
  BOOL ok = WriteFile(file, bytes.data(), size, &written, nullptr);
  CloseHandle(file);
  if (!ok || written != size) return std::nullopt;
  return FileUrlOf(path);
}

inline std::optional<std::wstring> IconUrl(std::string const &icon, std::string const &id) noexcept {
  if (icon.starts_with("file:")) return Paths::Wide(icon);
  if (icon.starts_with("data:image/")) return DataUriIcon(icon, id);
  if (icon.starts_with("https://") || icon.starts_with("http://")) {
    std::wstring path = TempIconPath(id, L"png");
    if (path.empty()) return std::nullopt;
    if (FAILED(URLDownloadToFileW(nullptr, Paths::Wide(icon).c_str(), path.c_str(), 0, nullptr))) return std::nullopt;
    return FileUrlOf(path);
  }
  if (icon.size() > 2 && (icon[1] == ':' || icon.starts_with("\\\\"))) return FileUrlOf(Paths::Wide(icon));
  return std::nullopt;
}

struct AppNotificationsCenter final : ToastCenter {
  explicit AppNotificationsCenter(bool showToasts) noexcept : m_showToasts(showToasts) {}

  Authorization Status() noexcept override {
    try {
      auto setting = winrt::Microsoft::Windows::AppNotifications::AppNotificationManager::Default().Setting();
      return setting == winrt::Microsoft::Windows::AppNotifications::AppNotificationSetting::Enabled ? Authorization::Granted : Authorization::Denied;
    } catch (...) {
      return Authorization::NotDetermined;
    }
  }

  bool RequestAuthorization() noexcept override {
    return Status() == Authorization::Granted;
  }

  std::optional<std::string> Post(NotificationRequest const &request) noexcept override {
    std::string id = request.id.empty() ? NewNotificationId() : request.id;
    if (!m_showToasts) {
      LaunchLog::Write(L"info", L"notifications: a toast was posted and not shown (background instance)");
      return id;
    }
    try {
      winrt::Microsoft::Windows::AppNotifications::Builder::AppNotificationBuilder builder;
      builder.AddArgument(L"ardiaId", Paths::Wide(id));
      if (request.tabId) builder.AddArgument(L"tabId", Paths::Wide(*request.tabId));
      if (request.windowId) builder.AddArgument(L"windowId", Paths::Wide(*request.windowId));
      if (!request.dataJson.empty()) builder.AddArgument(L"data", Paths::Wide(request.dataJson));
      builder.AddText(Paths::Wide(request.title.empty() ? std::string{" "} : request.title));
      if (request.subtitle) builder.AddText(Paths::Wide(*request.subtitle));
      if (!request.body.empty()) builder.AddText(Paths::Wide(request.body));
      if (request.silent) builder.MuteAudio();
      if (request.icon) {
        if (std::optional<std::wstring> logo = IconUrl(*request.icon, id)) {
          try {
            builder.SetAppLogoOverride(winrt::Windows::Foundation::Uri{*logo});
          } catch (...) {
          }
        }
      }
      auto notification = builder.BuildNotification();
      notification.Tag(ToastTag(id));
      winrt::Microsoft::Windows::AppNotifications::AppNotificationManager::Default().Show(notification);
      if (notification.Id() == 0) {
        LaunchLog::Write(L"warning", L"notifications: Windows did not take the toast (no id)");
        return std::nullopt;
      }
      std::call_once(m_firstShown, [] { LaunchLog::Write(L"info", L"notifications: the first toast was shown through Windows App SDK"); });
      return id;
    } catch (winrt::hresult_error const &error) {
      LaunchLog::Write(L"warning", std::wstring(L"notifications: a toast could not be shown, 0x").append(HexCode(error.code())).append(L": ").append(error.message()));
    } catch (...) {
      LaunchLog::Write(L"warning", L"notifications: a toast could not be shown");
    }
    return std::nullopt;
  }

  void Remove(std::vector<std::string> const &ids) noexcept override {
    if (!m_showToasts) {
      LaunchLog::Write(L"info", std::wstring(L"notifications: ").append(std::to_wstring(ids.size())).append(L" toasts removed (background instance, none shown)"));
      return;
    }
    for (std::string const &id : ids) {
      try {
        winrt::Microsoft::Windows::AppNotifications::AppNotificationManager::Default().RemoveByTagAsync(ToastTag(id)).get();
      } catch (...) {
      }
    }
  }

 private:
  bool m_showToasts;
  std::once_flag m_firstShown;
};

template <class TWork>
void RunOffThread(TWork &&work) noexcept {
  std::shared_ptr<std::decay_t<TWork>> shared;
  try {
    shared = std::make_shared<std::decay_t<TWork>>(std::forward<TWork>(work));
    std::thread([shared]() noexcept {
      bool initialized = false;
      try {
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
        initialized = true;
      } catch (...) {
      }
      (*shared)();
      if (initialized) winrt::uninit_apartment();
    }).detach();
  } catch (...) {
    if (shared) (*shared)();
  }
}

struct NotificationHub {
  static NotificationHub &Shared() noexcept {
    static NotificationHub *shared = new NotificationHub();
    return *shared;
  }

  void Install() noexcept {
    if (m_installed) return;
    m_installed = true;
    bool background = Paths::Environment(L"ARDIA_BACKGROUND") == L"1";
    try {
      using winrt::Microsoft::Windows::AppNotifications::AppNotificationManager;
      if (!AppNotificationManager::IsSupported()) {
        Fallback(L"app notifications are not supported on this system");
        return;
      }
      AppNotificationManager manager = AppNotificationManager::Default();
      m_invoked = manager.NotificationInvoked([](auto const &, auto const &args) noexcept {
        std::optional<NotificationResponse> response = ResponseFrom(args);
        if (!response) return;
        Host *host = Host::Current();
        if (!host || !host->queue) return;
        try {
          host->queue.DispatcherQueue().TryEnqueue([response = *response]() noexcept { NotificationHub::Shared().Received(response, false); });
        } catch (...) {
        }
      });
      RegisterWithAppIdentity(manager);
      SetCenter(std::make_shared<AppNotificationsCenter>(!background), "appNotifications");
      LaunchLog::Write(L"info", background ? L"notifications: registered with Windows App SDK app notifications; a background instance logs toasts instead of showing them"
                                           : L"notifications: registered with Windows App SDK app notifications; toasts are on");
    } catch (winrt::hresult_error const &error) {
      Fallback(std::wstring(L"Windows App SDK registration failed, 0x").append(HexCode(error.code())).append(L": ").append(error.message()));
      return;
    } catch (...) {
      Fallback(L"Windows App SDK registration failed");
      return;
    }
    ReadColdStart();
  }

  static void RegisterWithAppIdentity(winrt::Microsoft::Windows::AppNotifications::AppNotificationManager const &manager) {
    if (std::optional<std::wstring> icon = AppIcon::NotificationIconUrl()) {
      try {
        manager.Register(AppIcon::kDisplayName, winrt::Windows::Foundation::Uri{*icon});
        LaunchLog::Write(L"info", L"notifications: registered as Ardia with Ardia's icon");
        return;
      } catch (winrt::hresult_error const &error) {
        LaunchLog::Write(L"warning", std::wstring(L"notifications: registering with Ardia's name and icon failed, 0x").append(HexCode(error.code())).append(L": ").append(error.message()));
      }
    }
    manager.Register();
    LaunchLog::Write(L"warning", L"notifications: registered with the name and icon Windows found for the process");
  }

  std::shared_ptr<ToastCenter> Center() noexcept {
    std::scoped_lock lock{m_mutex};
    return m_center;
  }

  std::string Path() noexcept {
    std::scoped_lock lock{m_mutex};
    return m_path;
  }

  void Attach(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
    if (!m_pending.empty() && !Flush()) ScheduleFlush();
  }

  void Received(NotificationResponse const &response, bool coldStart) noexcept {
    LaunchLog::Write(L"info", coldStart ? L"notifications: the app was launched by a toast click" : L"notifications: a toast was clicked");
    if (!coldStart && Paths::Environment(L"ARDIA_BACKGROUND") != L"1") BringAppForward();
    m_pending.push_back(response);
    if (!Flush()) ScheduleFlush();
  }

 private:
  static constexpr int kFlushTicks = 480;

  template <class TArgs>
  static std::optional<NotificationResponse> ResponseFrom(TArgs const &args) noexcept {
    try {
      auto arguments = args.Arguments();
      if (!arguments || !arguments.HasKey(L"ardiaId")) return std::nullopt;
      NotificationResponse response;
      response.id = winrt::to_string(arguments.Lookup(L"ardiaId"));
      response.action = "click";
      if (arguments.HasKey(L"tabId")) response.tabId = winrt::to_string(arguments.Lookup(L"tabId"));
      if (arguments.HasKey(L"windowId")) response.windowId = winrt::to_string(arguments.Lookup(L"windowId"));
      if (arguments.HasKey(L"data")) response.dataJson = winrt::to_string(arguments.Lookup(L"data"));
      return response;
    } catch (...) {
      return std::nullopt;
    }
  }

  void ReadColdStart() noexcept {
    try {
      auto activated = winrt::Microsoft::Windows::AppLifecycle::AppInstance::GetCurrent().GetActivatedEventArgs();
      if (!activated || activated.Kind() != winrt::Microsoft::Windows::AppLifecycle::ExtendedActivationKind::AppNotification) return;
      auto args = activated.Data().as<winrt::Microsoft::Windows::AppNotifications::AppNotificationActivatedEventArgs>();
      if (std::optional<NotificationResponse> response = ResponseFrom(args)) Received(*response, true);
    } catch (winrt::hresult_error const &error) {
      LaunchLog::Write(L"warning", std::wstring(L"notifications: the launch activation could not be read, 0x").append(HexCode(error.code())));
    } catch (...) {
    }
  }

  void SetCenter(std::shared_ptr<ToastCenter> center, std::string path) noexcept {
    std::scoped_lock lock{m_mutex};
    m_center = std::move(center);
    m_path = std::move(path);
  }

  void Fallback(std::wstring const &reason) noexcept {
    SetCenter(std::make_shared<UnregisteredToastCenter>(), "unregistered: " + Paths::Utf8(reason));
    LaunchLog::Write(L"warning", std::wstring(L"notifications: ").append(reason).append(L"; notifications answer as not set up"));
  }

  static void BringAppForward() noexcept {
    HWND hwnd = WindowManager::Shared().ActiveHwnd();
    if (!hwnd) return;
    if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
    SetForegroundWindow(hwnd);
  }

  winrt::Microsoft::ReactNative::JSValueObject EventFor(NotificationResponse const &response) const noexcept {
    winrt::Microsoft::ReactNative::JSValueObject event;
    event["id"] = response.id;
    event["action"] = response.action;
    event["tabId"] = response.tabId ? winrt::Microsoft::ReactNative::JSValue{*response.tabId} : winrt::Microsoft::ReactNative::JSValue{nullptr};
    event["windowId"] = response.windowId ? winrt::Microsoft::ReactNative::JSValue{*response.windowId} : winrt::Microsoft::ReactNative::JSValue{nullptr};
    event["data"] = response.dataJson.empty() ? winrt::Microsoft::ReactNative::JSValue{nullptr} : FromJson(response.dataJson);
    return event;
  }

  bool Flush() noexcept {
    if (m_pending.empty()) return true;
    if (!m_context || WindowManager::Shared().Ids().empty()) return false;
    for (NotificationResponse const &response : m_pending) EmitEvent(m_context, L"ArdiaNotifications", L"onNotificationResponse", EventFor(response));
    m_pending.clear();
    return true;
  }

  void ScheduleFlush() noexcept {
    if (m_flushing) return;
    Host *host = Host::Current();
    if (!host || !host->queue) return;
    try {
      if (!m_timer) {
        m_timer = host->queue.DispatcherQueue().CreateTimer();
        m_timer.Interval(std::chrono::milliseconds(250));
        m_timer.IsRepeating(true);
        m_timer.Tick([this](auto const &, auto const &) noexcept { FlushTick(); });
      }
      m_ticks = 0;
      m_flushing = true;
      m_timer.Start();
    } catch (...) {
      m_flushing = false;
    }
  }

  void FlushTick() noexcept {
    bool done = Flush();
    if (!done && ++m_ticks < kFlushTicks) return;
    if (!done) {
      LaunchLog::Write(L"warning", std::wstring(L"notifications: ").append(std::to_wstring(m_pending.size())).append(L" toast clicks were dropped: no window opened"));
      m_pending.clear();
    }
    m_flushing = false;
    try {
      m_timer.Stop();
    } catch (...) {
    }
  }

  std::mutex m_mutex;
  std::shared_ptr<ToastCenter> m_center = std::make_shared<UnregisteredToastCenter>();
  std::string m_path{"unregistered: not installed"};
  bool m_installed{false};
  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
  std::vector<NotificationResponse> m_pending;
  winrt::Microsoft::UI::Dispatching::DispatcherQueueTimer m_timer{nullptr};
  winrt::event_token m_invoked{};
  bool m_flushing{false};
  int m_ticks{0};
};

}
