#pragma once

#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <thread>
#include <utility>

#include "NativeModules.h"

#include "EngineApi.h"
#include "Events.h"
#include "Host.h"
#include "LaunchLog.h"
#include "Paths.h"
#include "WindowManager.h"

namespace Ardia {

namespace EngineHostParts {

using Reply = winrt::Microsoft::ReactNative::ReactPromise<std::string>;

constexpr char NoEngine[] = "{\"error\":\"no engine\"}";

struct EventRoute {
  winrt::Microsoft::ReactNative::ReactContext context{nullptr};

  static EventRoute *&Installed() noexcept {
    static EventRoute *installed = nullptr;
    return installed;
  }
};

inline void OnReply(void *context, const char *json) noexcept {
  std::unique_ptr<Reply> reply{static_cast<Reply *>(context)};
  if (reply) reply->Resolve(std::string{json ? json : ""});
}

inline void OnEvent(void *context, const char *topic, const char *json) noexcept {
  auto *route = static_cast<EventRoute *>(context);
  if (!route || route != EventRoute::Installed()) return;
  winrt::Microsoft::ReactNative::JSValueObject payload;
  payload["topic"] = std::string{topic ? topic : ""};
  payload["json"] = std::string{json ? json : ""};
  EmitEvent(route->context, L"ArdiaEngineHost", L"event", std::move(payload));
}

inline void Install(EventRoute *route) noexcept {
  const ArdiaEngineApi *engine = Host::Engine();
  if (!engine) {
    delete route;
    return;
  }
  EventRoute::Installed() = route;
  engine->setEventSink(&OnEvent, route);
  LaunchLog::Write(L"engine", L"events reach the UI");
}

inline void Detach() noexcept {
  EventRoute::Installed() = nullptr;
  if (const ArdiaEngineApi *engine = Host::Engine()) engine->setEventSink(nullptr, nullptr);
}

inline void Remove(EventRoute *route) noexcept {
  if (EventRoute::Installed() == route) Detach();
  delete route;
}

constexpr std::string_view ProfileFolderPrefix = "Ardia ";
constexpr size_t LongestProfileFolder = 200;
constexpr wchar_t StagedSuffix[] = L" (removing)";

inline bool IsProfileFolderName(std::string_view folder) noexcept {
  if (folder.size() <= ProfileFolderPrefix.size() || folder.size() > LongestProfileFolder) return false;
  if (folder.substr(0, ProfileFolderPrefix.size()) != ProfileFolderPrefix) return false;
  for (char c : folder.substr(ProfileFolderPrefix.size())) {
    bool safe = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
    if (!safe) return false;
  }
  return true;
}

inline bool IsChromiumDataFolder(std::filesystem::path const &folder) noexcept {
  std::error_code error;
  return folder.is_absolute() && std::filesystem::is_directory(folder, error) && std::filesystem::is_regular_file(folder / L"Local State", error);
}

inline bool Gone(std::filesystem::path const &path) noexcept {
  std::error_code error;
  return !std::filesystem::exists(path, error) && !error;
}

inline std::wstring WithoutTrailingSeparators(std::wstring path) {
  while (!path.empty() && (path.back() == L'\\' || path.back() == L'/')) path.pop_back();
  return path;
}

inline std::filesystem::path ProfileDataRoot() noexcept {
  try {
    std::wstring scratch = WithoutTrailingSeparators(Paths::Environment(L"ARDIA_DATA_DIR"));
    if (!scratch.empty()) return std::filesystem::path{scratch} / L"Chromium";
    std::wstring localAppData = WithoutTrailingSeparators(Paths::Environment(L"LOCALAPPDATA"));
    if (localAppData.empty()) return {};
    return std::filesystem::path{localAppData} / L"Ardia" / L"User Data";
  } catch (...) {
    return {};
  }
}

inline std::string RemoveProfileFolder(std::string const &folder) noexcept {
  try {
    if (!IsProfileFolderName(folder)) return "refused";
    std::filesystem::path root = ProfileDataRoot();
    if (root.empty() || !IsChromiumDataFolder(root)) return "refused";
    std::filesystem::path target = root / Paths::Wide(folder);
    std::filesystem::path staged = root / (Paths::Wide(folder) + StagedSuffix);
    std::error_code error;
    if (!Gone(staged)) std::filesystem::remove_all(staged, error);
    if (!Gone(staged)) {
      LaunchLog::Write(L"engine", L"profile folder partly removed: " + Paths::Wide(folder) + L" (an earlier removal is left)");
      return "partial";
    }
    if (Gone(target)) return "absent";
    if (!MoveFileExW(target.c_str(), staged.c_str(), 0)) {
      DWORD moveError = GetLastError();
      LaunchLog::Write(L"engine", L"profile folder in use, not removed: " + Paths::Wide(folder) + L" (" + std::to_wstring(moveError) + L")");
      return "inUse";
    }
    std::filesystem::remove_all(staged, error);
    if (!Gone(staged) || !Gone(target)) {
      LaunchLog::Write(L"engine", L"profile folder partly removed: " + Paths::Wide(folder));
      return "partial";
    }
    LaunchLog::Write(L"engine", L"profile folder removed: " + Paths::Wide(folder));
    return "removed";
  } catch (...) {
    return "failed";
  }
}
}

REACT_MODULE(EngineHostModule, L"ArdiaEngineHost")
struct EngineHostModule {
  using Reply = EngineHostParts::Reply;

  EngineHostModule() noexcept = default;
  EngineHostModule(EngineHostModule const &) = delete;
  EngineHostModule &operator=(EngineHostModule const &) = delete;

  REACT_INIT(Initialize)
  void Initialize(winrt::Microsoft::ReactNative::ReactContext const &context) noexcept {
    m_context = context;
    if (!Host::Engine() || m_route) return;
    m_route = new EngineHostParts::EventRoute{context};
    EngineHostParts::EventRoute *route = m_route;
    RunOnUI(context, [route]() noexcept { EngineHostParts::Install(route); });
  }

  ~EngineHostModule() noexcept {
    EngineHostParts::EventRoute *route = m_route;
    m_route = nullptr;
    if (!route) return;
    auto dispatcher = m_context ? m_context.UIDispatcher() : winrt::Microsoft::ReactNative::ReactDispatcher{nullptr};
    if (!dispatcher) return;
    if (dispatcher.HasThreadAccess()) {
      EngineHostParts::Remove(route);
      return;
    }
    dispatcher.Post([route]() noexcept { EngineHostParts::Remove(route); });
  }

  REACT_SYNC_METHOD(available)
  bool available() noexcept {
    return Host::Engine() != nullptr;
  }

  REACT_METHOD(hostCall)
  void hostCall(std::string verb, std::string argsJson, std::string windowId, Reply reply) noexcept {
    RunOnUI(m_context, [verb = std::move(verb), argsJson = std::move(argsJson), windowId = std::move(windowId), reply]() noexcept {
      const ArdiaEngineApi *engine = Host::Engine();
      if (!engine) return reply.Resolve(std::string{EngineHostParts::NoEngine});
      HWND window = windowId.empty() ? nullptr : WindowManager::Shared().Hwnd(windowId);
      engine->hostCall(verb.c_str(), argsJson.c_str(), reinterpret_cast<uint64_t>(window), &EngineHostParts::OnReply, new Reply(reply));
    });
  }

  REACT_SYNC_METHOD(profileDataFolder)
  std::string profileDataFolder() noexcept {
    try {
      return Paths::Utf8(EngineHostParts::ProfileDataRoot().wstring());
    } catch (...) {
      return {};
    }
  }

  REACT_METHOD(removeProfileFolder)
  void removeProfileFolder(std::string folder, Reply reply) noexcept {
    try {
      std::thread([folder = std::move(folder), reply]() noexcept {
        reply.Resolve(EngineHostParts::RemoveProfileFolder(folder));
      }).detach();
    } catch (...) {
      reply.Resolve(std::string{"failed"});
    }
  }

  REACT_METHOD(engineCall)
  void engineCall(std::string name, std::string profileDir, std::string argsJson, Reply reply) noexcept {
    RunOnUI(m_context, [name = std::move(name), profileDir = std::move(profileDir), argsJson = std::move(argsJson), reply]() noexcept {
      const ArdiaEngineApi *engine = Host::Engine();
      if (!engine) return reply.Resolve(std::string{EngineHostParts::NoEngine});
      engine->engineCall(name.c_str(), profileDir.c_str(), argsJson.c_str(), &EngineHostParts::OnReply, new Reply(reply));
    });
  }

 private:
  winrt::Microsoft::ReactNative::ReactContext m_context{nullptr};
  EngineHostParts::EventRoute *m_route{nullptr};
};

}
