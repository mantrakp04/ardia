#pragma once

#include <atomic>
#include <chrono>
#include <cwchar>
#include <cwctype>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include <winhttp.h>
#include <wtsapi32.h>

#include "NativeModules.h"
#include "DialogsModule.h"
#include "Events.h"
#include "LaunchLog.h"
#include "Paths.h"

#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "wtsapi32.lib")

namespace Ardia {

REACT_STRUCT(ShellBangListReply)
struct ShellBangListReply {
  REACT_FIELD(status)
  int status = 0;
  REACT_FIELD(etag)
  std::optional<std::string> etag;
  REACT_FIELD(contentType)
  std::optional<std::string> contentType;
  REACT_FIELD(body)
  std::optional<std::string> body;
  REACT_FIELD(bytes)
  int bytes = 0;
};

namespace ShellParts {

enum class AppearanceMode : int { Auto = 0, Light = 1, Dark = 2 };

inline std::atomic<int> &AppearanceSetting() noexcept {
  static std::atomic<int> mode{static_cast<int>(AppearanceMode::Auto)};
  return mode;
}

inline bool SystemUsesDarkApps() noexcept {
  DWORD value = 1;
  DWORD size = sizeof(value);
  LSTATUS status = RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &value, &size);
  return status == ERROR_SUCCESS && value == 0;
}

inline bool EffectiveDark() noexcept {
  switch (static_cast<AppearanceMode>(AppearanceSetting().load())) {
    case AppearanceMode::Light: return false;
    case AppearanceMode::Dark: return true;
    default: return SystemUsesDarkApps();
  }
}

struct ShellState {
  winrt::Microsoft::ReactNative::ReactContext context{nullptr};
  std::atomic<bool> alive{true};
  std::mutex appearanceLock;
  bool lastDark = false;
  HWND watcher = nullptr;
  bool sessionRegistered = false;

  void EmitAppEvent(winrt::Microsoft::ReactNative::JSValueObject &&payload) noexcept {
    if (!alive.load()) return;
    EmitEvent(context, L"ArdiaShell", L"onAppEvent", std::move(payload));
  }

  void EmitType(const char *type) noexcept {
    EmitAppEvent(winrt::Microsoft::ReactNative::JSValueObject{{"type", type}});
  }

  void NoteAppearance() noexcept {
    bool dark = EffectiveDark();
    {
      std::scoped_lock lock{appearanceLock};
      if (dark == lastDark) return;
      lastDark = dark;
    }
    if (context) RunOnUI(context, [dark]() noexcept { WindowManager::Shared().SetDark(dark); });
    EmitAppEvent(winrt::Microsoft::ReactNative::JSValueObject{{"type", "appearance"}, {"dark", dark}});
  }

  void NoteLocked() noexcept {
    EmitType("lockedOrAsleep");
    if (DialogParts::OpenCount().load() == 0) EmitType("screenLocked");
  }
};

constexpr wchar_t WatcherClassName[] = L"ArdiaShellSystemWatcher";

inline LRESULT CALLBACK WatcherProcedure(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) noexcept {
  if (message == WM_NCCREATE) {
    auto *create = reinterpret_cast<CREATESTRUCTW *>(lParam);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }
  auto *holder = reinterpret_cast<std::shared_ptr<ShellState> *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCDESTROY) {
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
    delete holder;
    return DefWindowProcW(hwnd, message, wParam, lParam);
  }
  if (!holder || !*holder) return DefWindowProcW(hwnd, message, wParam, lParam);
  ShellState &state = **holder;
  switch (message) {
    case WM_SETTINGCHANGE:
      if (lParam && wcscmp(reinterpret_cast<LPCWSTR>(lParam), L"ImmersiveColorSet") == 0) state.NoteAppearance();
      break;
    case WM_WTSSESSION_CHANGE:
      if (wParam == WTS_SESSION_LOCK) state.NoteLocked();
      else if (wParam == WTS_CONSOLE_DISCONNECT || wParam == WTS_REMOTE_DISCONNECT) state.EmitType("lockedOrAsleep");
      break;
    case WM_POWERBROADCAST:
      if (wParam == PBT_APMSUSPEND) state.EmitType("lockedOrAsleep");
      return TRUE;
    default:
      break;
  }
  return DefWindowProcW(hwnd, message, wParam, lParam);
}

inline HWND CreateWatcher(std::shared_ptr<ShellState> const &state) noexcept {
  HINSTANCE instance = GetModuleHandleW(nullptr);
  WNDCLASSEXW windowClass{};
  windowClass.cbSize = sizeof(windowClass);
  windowClass.lpfnWndProc = WatcherProcedure;
  windowClass.hInstance = instance;
  windowClass.lpszClassName = WatcherClassName;
  if (!RegisterClassExW(&windowClass) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return nullptr;
  auto *holder = new std::shared_ptr<ShellState>(state);
  HWND hwnd = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, WatcherClassName, L"", WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, instance, holder);
  return hwnd;
}

inline void DestroyWatcher(ShellState &state) noexcept {
  if (!state.watcher) return;
  if (state.sessionRegistered) WTSUnRegisterSessionNotification(state.watcher);
  state.sessionRegistered = false;
  DestroyWindow(state.watcher);
  state.watcher = nullptr;
}

inline bool OpenClipboardWithRetry(HWND owner) noexcept {
  for (int attempt = 0; attempt < 20; attempt++) {
    if (OpenClipboard(owner)) return true;
    Sleep(10);
  }
  return false;
}

inline bool WriteClipboardText(HWND owner, std::wstring const &text) noexcept {
  if (!OpenClipboardWithRetry(owner)) return false;
  bool written = false;
  if (EmptyClipboard()) {
    size_t bytes = (text.size() + 1) * sizeof(wchar_t);
    if (HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, bytes)) {
      if (void *locked = GlobalLock(memory)) {
        memcpy(locked, text.c_str(), bytes);
        GlobalUnlock(memory);
        written = SetClipboardData(CF_UNICODETEXT, memory) != nullptr;
      }
      if (!written) GlobalFree(memory);
    }
  }
  CloseClipboard();
  return written;
}

inline std::wstring ReadClipboardText(HWND owner) noexcept {
  std::wstring text;
  if (!IsClipboardFormatAvailable(CF_UNICODETEXT)) return text;
  if (!OpenClipboardWithRetry(owner)) return text;
  if (HANDLE memory = GetClipboardData(CF_UNICODETEXT)) {
    if (auto *locked = static_cast<const wchar_t *>(GlobalLock(memory))) {
      size_t limit = GlobalSize(memory) / sizeof(wchar_t);
      size_t length = 0;
      while (length < limit && locked[length]) length++;
      text.assign(locked, length);
      GlobalUnlock(memory);
    }
  }
  CloseClipboard();
  return text;
}

constexpr size_t BangListMaxBytes = 5'000'000;
constexpr wchar_t BangListUrl[] = L"https://services.helium.imput.net/bangs.json";

inline std::wstring BangListAddress() noexcept {
#if _DEBUG
  if (Paths::HasCustomDataDirectory()) {
    std::wstring requested = Paths::Environment(L"ARDIA_TEST");
    constexpr std::wstring_view key = L"bangsUrl=";
    size_t at = requested.find(key);
    while (at != std::wstring::npos && at != 0 && requested[at - 1] != L',') at = requested.find(key, at + 1);
    if (at != std::wstring::npos) {
      std::wstring value = requested.substr(at + key.size());
      size_t cut = std::wstring::npos;
      for (size_t comma = value.find(L','); comma != std::wstring::npos; comma = value.find(L',', comma + 1)) {
        size_t start = comma + 1;
        size_t end = start;
        while (end < value.size() && iswalnum(value[end])) end++;
        if (end > start && iswalpha(value[start]) && (end == value.size() || value[end] == L'=' || value[end] == L',')) {
          cut = comma;
          break;
        }
      }
      if (cut != std::wstring::npos) value.resize(cut);
      while (!value.empty() && iswspace(value.back())) value.pop_back();
      while (!value.empty() && iswspace(value.front())) value.erase(value.begin());
      if (!value.empty()) return value;
    }
  }
#endif
  return BangListUrl;
}

inline bool UsableEtag(std::string const &etag) noexcept {
  if (etag.empty()) return false;
  std::wstring wide = Paths::Wide(etag);
  if (wide.empty() || wide.size() > 200) return false;
  for (wchar_t c : wide)
    if (c == L'\n' || c == L'\r' || c == L'\v' || c == L'\f' || c == 0x85 || c == 0x2028 || c == 0x2029) return false;
  return true;
}

inline std::optional<std::string> QueryHeader(HINTERNET request, DWORD info) noexcept {
  DWORD size = 0;
  WinHttpQueryHeaders(request, info, WINHTTP_HEADER_NAME_BY_INDEX, WINHTTP_NO_OUTPUT_BUFFER, &size, WINHTTP_NO_HEADER_INDEX);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || size == 0) return std::nullopt;
  std::wstring value(size / sizeof(wchar_t) + 1, L'\0');
  if (!WinHttpQueryHeaders(request, info, WINHTTP_HEADER_NAME_BY_INDEX, value.data(), &size, WINHTTP_NO_HEADER_INDEX)) return std::nullopt;
  value.resize(size / sizeof(wchar_t));
  return Paths::Utf8(value);
}

struct InternetHandle {
  HINTERNET handle = nullptr;
  explicit InternetHandle(HINTERNET value) noexcept : handle(value) {}
  ~InternetHandle() noexcept {
    if (handle) WinHttpCloseHandle(handle);
  }
  InternetHandle(InternetHandle const &) = delete;
  InternetHandle &operator=(InternetHandle const &) = delete;
  explicit operator bool() const noexcept { return handle != nullptr; }
};

struct BangListOutcome {
  std::optional<ShellBangListReply> reply;
  std::string failure;
};

inline std::string LastErrorText(const char *step) noexcept {
  return std::string{step} + " failed (" + std::to_string(GetLastError()) + ")";
}

inline BangListOutcome FetchBangList(std::optional<std::string> etag) noexcept {
  BangListOutcome outcome;
  std::wstring address = BangListAddress();
  URL_COMPONENTS parts{};
  parts.dwStructSize = sizeof(parts);
  parts.dwSchemeLength = static_cast<DWORD>(-1);
  parts.dwHostNameLength = static_cast<DWORD>(-1);
  parts.dwUrlPathLength = static_cast<DWORD>(-1);
  parts.dwExtraInfoLength = static_cast<DWORD>(-1);
  if (!WinHttpCrackUrl(address.c_str(), static_cast<DWORD>(address.size()), 0, &parts)) {
    outcome.failure = "bad URL";
    return outcome;
  }
  std::wstring host{parts.lpszHostName, parts.dwHostNameLength};
  std::wstring path{parts.lpszUrlPath, parts.dwUrlPathLength};
  if (parts.lpszExtraInfo) path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
  if (path.empty()) path = L"/";
  bool secure = parts.nScheme == INTERNET_SCHEME_HTTPS;

  InternetHandle session{WinHttpOpen(L"Ardia", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0)};
  if (!session) session.handle = WinHttpOpen(L"Ardia", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!session) {
    outcome.failure = LastErrorText("WinHttpOpen");
    return outcome;
  }
  WinHttpSetTimeouts(session.handle, 30000, 30000, 30000, 30000);
  DWORD decompression = WINHTTP_DECOMPRESSION_FLAG_ALL;
  WinHttpSetOption(session.handle, WINHTTP_OPTION_DECOMPRESSION, &decompression, sizeof(decompression));

  InternetHandle connection{WinHttpConnect(session.handle, host.c_str(), parts.nPort, 0)};
  if (!connection) {
    outcome.failure = LastErrorText("WinHttpConnect");
    return outcome;
  }
  InternetHandle request{WinHttpOpenRequest(connection.handle, L"GET", path.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_REFRESH | (secure ? WINHTTP_FLAG_SECURE : 0))};
  if (!request) {
    outcome.failure = LastErrorText("WinHttpOpenRequest");
    return outcome;
  }
  DWORD redirectPolicy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
  WinHttpSetOption(request.handle, WINHTTP_OPTION_REDIRECT_POLICY, &redirectPolicy, sizeof(redirectPolicy));
  DWORD disabled = WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_AUTHENTICATION;
  WinHttpSetOption(request.handle, WINHTTP_OPTION_DISABLE_FEATURE, &disabled, sizeof(disabled));

  std::wstring headers = L"Accept: application/json\r\n";
  if (etag && UsableEtag(*etag)) headers += L"If-None-Match: " + Paths::Wide(*etag) + L"\r\n";
  if (!WinHttpSendRequest(request.handle, headers.c_str(), static_cast<DWORD>(headers.size()), WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) {
    outcome.failure = LastErrorText("WinHttpSendRequest");
    return outcome;
  }
  if (!WinHttpReceiveResponse(request.handle, nullptr)) {
    outcome.failure = LastErrorText("WinHttpReceiveResponse");
    return outcome;
  }

  DWORD status = 0;
  DWORD statusSize = sizeof(status);
  if (!WinHttpQueryHeaders(request.handle, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX)) {
    outcome.failure = "no response";
    return outcome;
  }
  if (std::optional<std::string> length = QueryHeader(request.handle, WINHTTP_QUERY_CONTENT_LENGTH)) {
    if (_strtoui64(length->c_str(), nullptr, 10) > BangListMaxBytes) {
      outcome.failure = "too large";
      return outcome;
    }
  }

  auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(60);
  std::string body;
  while (true) {
    if (std::chrono::steady_clock::now() > deadline) {
      outcome.failure = "timed out";
      return outcome;
    }
    DWORD available = 0;
    if (!WinHttpQueryDataAvailable(request.handle, &available)) {
      outcome.failure = LastErrorText("WinHttpQueryDataAvailable");
      return outcome;
    }
    if (available == 0) break;
    if (body.size() + available > BangListMaxBytes) {
      outcome.failure = "too large";
      return outcome;
    }
    size_t offset = body.size();
    body.resize(offset + available);
    DWORD read = 0;
    if (!WinHttpReadData(request.handle, body.data() + offset, available, &read)) {
      outcome.failure = LastErrorText("WinHttpReadData");
      return outcome;
    }
    body.resize(offset + read);
    if (read == 0) break;
  }

  ShellBangListReply reply;
  reply.status = static_cast<int>(status);
  reply.etag = QueryHeader(request.handle, WINHTTP_QUERY_ETAG);
  reply.contentType = QueryHeader(request.handle, WINHTTP_QUERY_CONTENT_TYPE);
  reply.bytes = static_cast<int>(body.size());
  if (status == 200) {
    bool utf8 = body.empty() || MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, body.data(), static_cast<int>(body.size()), nullptr, 0) > 0;
    if (!utf8) {
      outcome.failure = "not UTF-8";
      return outcome;
    }
    reply.body = std::move(body);
  }
  outcome.reply = std::move(reply);
  return outcome;
}

}

REACT_MODULE(ShellModule, L"ArdiaShell")
struct ShellModule {
  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_state->context = context;
    m_state->lastDark = ShellParts::EffectiveDark();
    std::shared_ptr<ShellParts::ShellState> state = m_state;
    RunOnUI(context, [state]() noexcept {
      WindowManager::Shared().SetDark(ShellParts::EffectiveDark());
      if (!state->alive.load() || state->watcher) return;
      state->watcher = ShellParts::CreateWatcher(state);
      if (!state->watcher) {
        LaunchLog::Write(L"warning", L"ArdiaShell: system watcher window not created");
        return;
      }
      state->sessionRegistered = WTSRegisterSessionNotification(state->watcher, NOTIFY_FOR_THIS_SESSION) != FALSE;
      state->NoteAppearance();
    });
  }

  ~ShellModule() noexcept {
    std::shared_ptr<ShellParts::ShellState> state = m_state;
    state->alive = false;
    auto dispatcher = state->context ? state->context.UIDispatcher() : winrt::Microsoft::ReactNative::ReactDispatcher{nullptr};
    if (!dispatcher) return;
    if (dispatcher.HasThreadAccess()) {
      ShellParts::DestroyWatcher(*state);
      return;
    }
    dispatcher.Post([state]() noexcept { ShellParts::DestroyWatcher(*state); });
  }

  static bool EffectiveDark() noexcept {
    return ShellParts::EffectiveDark();
  }

  REACT_METHOD(setAppearance)
  void setAppearance(std::string mode, winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    ShellParts::AppearanceMode chosen = mode == "light" ? ShellParts::AppearanceMode::Light : mode == "dark" ? ShellParts::AppearanceMode::Dark : ShellParts::AppearanceMode::Auto;
    ShellParts::AppearanceSetting() = static_cast<int>(chosen);
    m_state->NoteAppearance();
    promise.Resolve();
  }

  REACT_METHOD(isDarkAppearance)
  void isDarkAppearance(winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    promise.Resolve(ShellParts::EffectiveDark());
  }

  REACT_METHOD(startDictation)
  void startDictation() noexcept {}

  REACT_METHOD(fetchBangList)
  void fetchBangList(std::optional<std::string> etag, winrt::Microsoft::ReactNative::ReactPromise<ShellBangListReply> promise) noexcept {
    try {
      std::thread([etag, promise]() noexcept {
        ShellParts::BangListOutcome outcome = ShellParts::FetchBangList(etag);
        if (outcome.reply) {
          promise.Resolve(*outcome.reply);
          return;
        }
        winrt::Microsoft::ReactNative::ReactError error;
        error.Code = "ERR_BANG_LIST";
        error.Message = outcome.failure.empty() ? std::string{"failed"} : outcome.failure;
        promise.Reject(error);
      }).detach();
    } catch (...) {
      promise.Reject("could not start the bang list fetch");
    }
  }

  REACT_SYNC_METHOD(copyText)
  bool copyText(std::string text) noexcept {
    std::shared_ptr<ShellParts::ShellState> state = m_state;
    std::wstring wide = Paths::Wide(text);
    RunOnUI(state->context, [state, wide]() noexcept {
      if (!ShellParts::WriteClipboardText(state->watcher, wide)) LaunchLog::Write(L"warning", L"ArdiaShell.copyText: clipboard not written");
    });
    return true;
  }

  REACT_METHOD(readText)
  void readText(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    std::shared_ptr<ShellParts::ShellState> state = m_state;
    RunOnUI(state->context, [state, promise]() noexcept {
      promise.Resolve(Paths::Utf8(ShellParts::ReadClipboardText(state->watcher)));
    });
  }

 private:
  std::shared_ptr<ShellParts::ShellState> m_state = std::make_shared<ShellParts::ShellState>();
};

}
