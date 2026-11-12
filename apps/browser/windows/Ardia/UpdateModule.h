#pragma once

#include <winhttp.h>

#include <algorithm>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include "NativeModules.h"

#include "AppImage.h"
#include "AppModule.h"
#include "DocumentsModule.h"
#include "LaunchLog.h"
#include "Paths.h"

#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "bcrypt.lib")

namespace Ardia {

namespace AppUpdate {

inline constexpr std::wstring_view kPublishedUnder = L"https://github.com/ardia-browser/ardia/releases/download/";
inline constexpr uint64_t kLargestManifestBytes = 64 * 1024;
inline constexpr uint64_t kLargestInstallerBytes = 1ull << 30;
inline constexpr size_t kLargestBuildFileBytes = 4096;

inline std::string Cpu() noexcept {
#if defined(_M_ARM64)
  return "arm64";
#else
  return "x64";
#endif
}

inline std::filesystem::path AppFolder() noexcept {
  try {
    return std::filesystem::path(AppImage::Directory());
  } catch (...) {
    return {};
  }
}

inline bool Installed() noexcept {
  try {
    std::filesystem::path folder = AppFolder();
    if (folder.empty()) return false;
    DWORD attributes = GetFileAttributesW((folder / L"unins000.exe").c_str());
    return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY);
  } catch (...) {
    return false;
  }
}

inline std::string BuildFile() noexcept {
  try {
    std::filesystem::path folder = AppFolder();
    if (folder.empty()) return {};
    auto contents = Files::ReadAll(folder / L"Ardia.build.json");
    if (!contents || contents->size() > kLargestBuildFileBytes || !Files::IsValidUtf8(*contents)) return {};
    return *contents;
  } catch (...) {
    return {};
  }
}

inline std::wstring FeedOverride() noexcept {
  if (!Paths::HasCustomDataDirectory()) return {};
  try {
    auto const &settings = AppLaunch::Shared().instance;
    auto found = settings.find("updateFeed");
    return found == settings.end() ? std::wstring{} : Paths::Wide(found->second);
  } catch (...) {
    return {};
  }
}

inline bool StartsWith(std::wstring_view text, std::wstring_view prefix) noexcept {
  return text.size() >= prefix.size() && text.substr(0, prefix.size()) == prefix;
}

inline bool Allowed(std::wstring_view url) noexcept {
  if (url.find(L"..") != std::wstring_view::npos || url.find_first_of(L"%\\?#@ ") != std::wstring_view::npos) return false;
  if (StartsWith(url, kPublishedUnder)) return true;
  std::wstring feed = FeedOverride();
  size_t folderEnd = feed.find_last_of(L'/');
  if (folderEnd == std::wstring::npos || folderEnd < 8) return false;
  return StartsWith(url, std::wstring_view(feed).substr(0, folderEnd + 1));
}

struct Connection {
  HINTERNET handle = nullptr;
  explicit Connection(HINTERNET value) noexcept : handle(value) {}
  ~Connection() noexcept {
    if (handle) WinHttpCloseHandle(handle);
  }
  Connection(Connection const &) = delete;
  Connection &operator=(Connection const &) = delete;
  explicit operator bool() const noexcept { return handle != nullptr; }
};

inline std::string Failed(const char *step) noexcept {
  try {
    return std::string{step} + " failed (" + std::to_string(GetLastError()) + ")";
  } catch (...) {
    return {};
  }
}

using Received = std::function<bool(const BYTE *, DWORD)>;

inline std::string Fetch(std::wstring const &address, uint64_t largest, Received const &received) noexcept {
  try {
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    parts.dwSchemeLength = static_cast<DWORD>(-1);
    parts.dwHostNameLength = static_cast<DWORD>(-1);
    parts.dwUrlPathLength = static_cast<DWORD>(-1);
    parts.dwExtraInfoLength = static_cast<DWORD>(-1);
    if (!WinHttpCrackUrl(address.c_str(), static_cast<DWORD>(address.size()), 0, &parts)) return "the address could not be read";
    std::wstring host{parts.lpszHostName, parts.dwHostNameLength};
    std::wstring path{parts.lpszUrlPath, parts.dwUrlPathLength};
    if (parts.lpszExtraInfo) path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
    if (path.empty()) path = L"/";
    bool secure = parts.nScheme == INTERNET_SCHEME_HTTPS;

    Connection session{WinHttpOpen(L"Ardia", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0)};
    if (!session) session.handle = WinHttpOpen(L"Ardia", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) return Failed("WinHttpOpen");
    WinHttpSetTimeouts(session.handle, 30000, 30000, 30000, 60000);
    Connection server{WinHttpConnect(session.handle, host.c_str(), parts.nPort, 0)};
    if (!server) return Failed("WinHttpConnect");
    Connection request{
        WinHttpOpenRequest(server.handle, L"GET", path.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_REFRESH | (secure ? WINHTTP_FLAG_SECURE : 0))};
    if (!request) return Failed("WinHttpOpenRequest");
    DWORD disabled = WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_AUTHENTICATION;
    WinHttpSetOption(request.handle, WINHTTP_OPTION_DISABLE_FEATURE, &disabled, sizeof(disabled));
    if (!WinHttpSendRequest(request.handle, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) return Failed("WinHttpSendRequest");
    if (!WinHttpReceiveResponse(request.handle, nullptr)) return Failed("WinHttpReceiveResponse");
    DWORD status = 0;
    DWORD statusSize = sizeof(status);
    if (!WinHttpQueryHeaders(request.handle, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &statusSize, WINHTTP_NO_HEADER_INDEX))
      return "the server gave no status";
    if (status != 200) return "the server answered " + std::to_string(status);
    std::vector<BYTE> buffer(64 * 1024);
    uint64_t total = 0;
    for (;;) {
      DWORD read = 0;
      if (!WinHttpReadData(request.handle, buffer.data(), static_cast<DWORD>(buffer.size()), &read)) return Failed("WinHttpReadData");
      if (read == 0) return {};
      total += read;
      if (total > largest) return "the download is larger than it should be";
      if (!received(buffer.data(), read)) return "the download could not be kept";
    }
  } catch (...) {
    return "the download failed";
  }
}

class Sha256 {
 public:
  Sha256() noexcept {
    if (BCryptOpenAlgorithmProvider(&m_algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) != 0) {
      m_algorithm = nullptr;
      return;
    }
    if (BCryptCreateHash(m_algorithm, &m_hash, nullptr, 0, nullptr, 0, 0) != 0) m_hash = nullptr;
  }

  ~Sha256() noexcept {
    if (m_hash) BCryptDestroyHash(m_hash);
    if (m_algorithm) BCryptCloseAlgorithmProvider(m_algorithm, 0);
  }

  Sha256(Sha256 const &) = delete;
  Sha256 &operator=(Sha256 const &) = delete;

  bool Add(const BYTE *bytes, DWORD count) noexcept {
    return m_hash && BCryptHashData(m_hash, const_cast<PUCHAR>(bytes), count, 0) == 0;
  }

  std::string Hex() noexcept {
    BYTE digest[32]{};
    if (!m_hash || BCryptFinishHash(m_hash, digest, sizeof(digest), 0) != 0) return {};
    static constexpr char digits[] = "0123456789abcdef";
    std::string hex;
    try {
      hex.reserve(sizeof(digest) * 2);
      for (BYTE byte : digest) {
        hex.push_back(digits[byte >> 4]);
        hex.push_back(digits[byte & 0xF]);
      }
    } catch (...) {
      return {};
    }
    return hex;
  }

 private:
  BCRYPT_ALG_HANDLE m_algorithm = nullptr;
  BCRYPT_HASH_HANDLE m_hash = nullptr;
};

inline bool IsSha256(std::string_view text) noexcept {
  if (text.size() != 64) return false;
  return std::all_of(text.begin(), text.end(), [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}

inline std::filesystem::path UpdatesFolder() {
  return Paths::DataDirectory() / L"Updates";
}

inline std::string HashOfOpenFile(HANDLE file) noexcept {
  try {
    Sha256 hash;
    std::vector<BYTE> buffer(256 * 1024);
    LARGE_INTEGER start{};
    if (!SetFilePointerEx(file, start, nullptr, FILE_BEGIN)) return {};
    for (;;) {
      DWORD read = 0;
      if (!ReadFile(file, buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr)) return {};
      if (read == 0) return hash.Hex();
      if (!hash.Add(buffer.data(), read)) return {};
    }
  } catch (...) {
    return {};
  }
}

inline HANDLE OpenUnchanging(std::filesystem::path const &path) noexcept {
  return CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
}

inline bool AlreadyHere(std::filesystem::path const &path, std::string const &sha256) noexcept {
  HANDLE file = OpenUnchanging(path);
  if (file == INVALID_HANDLE_VALUE) return false;
  bool same = HashOfOpenFile(file) == sha256;
  CloseHandle(file);
  return same;
}

struct Downloaded {
  std::string path;
  std::string failure;
};

inline Downloaded Download(std::wstring const &address, std::string const &sha256, uint64_t bytes) noexcept {
  Downloaded result;
  try {
    std::filesystem::path folder = UpdatesFolder();
    std::error_code ignored;
    std::filesystem::create_directories(folder, ignored);
    std::filesystem::path target = folder / (L"Ardia-Setup-" + Paths::Wide(sha256.substr(0, 16)) + L".exe");
    if (AlreadyHere(target, sha256)) {
      result.path = Paths::Utf8(target.wstring());
      return result;
    }
    for (auto const &entry : std::filesystem::directory_iterator(folder, ignored)) {
      std::error_code unremoved;
      std::filesystem::remove(entry.path(), unremoved);
    }
    std::filesystem::path partial = target;
    partial += L".part";
    HANDLE file = CreateFileW(partial.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
      result.failure = Failed("creating the download");
      return result;
    }
    Sha256 hash;
    uint64_t written = 0;
    std::string failure = Fetch(address, bytes, [&](const BYTE *data, DWORD count) {
      DWORD stored = 0;
      if (!WriteFile(file, data, count, &stored, nullptr) || stored != count) return false;
      written += count;
      return hash.Add(data, count);
    });
    bool flushed = FlushFileBuffers(file) != FALSE;
    CloseHandle(file);
    if (failure.empty() && !flushed) failure = "the download could not be saved";
    if (failure.empty() && written != bytes) failure = "the download is " + std::to_string(written) + " bytes, not " + std::to_string(bytes);
    if (failure.empty() && hash.Hex() != sha256) failure = "the download is not the published file";
    if (failure.empty() && !MoveFileExW(partial.c_str(), target.c_str(), MOVEFILE_REPLACE_EXISTING)) failure = Failed("keeping the download");
    if (!failure.empty()) {
      DeleteFileW(partial.c_str());
      result.failure = failure;
      return result;
    }
    result.path = Paths::Utf8(target.wstring());
    return result;
  } catch (...) {
    result.failure = "the download failed";
    return result;
  }
}

inline std::string RunInstaller(std::string const &chosen, std::string const &sha256) noexcept {
  try {
    std::filesystem::path path{Paths::Wide(chosen)};
    std::error_code compared;
    if (!std::filesystem::equivalent(path.parent_path(), UpdatesFolder(), compared) || compared) return "the installer is not in the updates folder";
    HANDLE file = OpenUnchanging(path);
    if (file == INVALID_HANDLE_VALUE) return Failed("opening the installer");
    std::string failure;
    if (HashOfOpenFile(file) != sha256) failure = "the installer is not the published file";
    if (failure.empty()) {
      std::wstring command = L"\"" + path.wstring() + L"\" /SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /FORCECLOSEAPPLICATIONS /relaunch=1";
      STARTUPINFOW startup{};
      startup.cb = sizeof(startup);
      PROCESS_INFORMATION process{};
      if (CreateProcessW(path.c_str(), command.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &startup, &process)) {
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
      } else {
        failure = Failed("starting the installer");
      }
    }
    CloseHandle(file);
    return failure;
  } catch (...) {
    return "the installer could not be started";
  }
}

}

REACT_MODULE(UpdateModule, L"ArdiaWindowsUpdate")
struct UpdateModule {
  REACT_CONSTANT(cpu)
  const std::string cpu = AppUpdate::Cpu();

  REACT_CONSTANT(installed)
  const bool installed = AppUpdate::Installed();

  REACT_CONSTANT(buildFile)
  const std::string buildFile = AppUpdate::BuildFile();

  REACT_CONSTANT(feedOverride)
  const std::string feedOverride = Paths::Utf8(AppUpdate::FeedOverride());

  REACT_METHOD(fetchText)
  void fetchText(std::string url, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    std::wstring address = Paths::Wide(url);
    if (!AppUpdate::Allowed(address)) return promise.Reject("Updates do not come from that address");
    OnAThread(promise, [address, promise]() noexcept {
      std::string text;
      std::string failure;
      try {
        failure = AppUpdate::Fetch(address, AppUpdate::kLargestManifestBytes, [&text](const BYTE *data, DWORD count) {
          text.append(reinterpret_cast<const char *>(data), count);
          return true;
        });
      } catch (...) {
        failure = "the download failed";
      }
      if (failure.empty() && !Files::IsValidUtf8(text)) failure = "the answer is not text";
      if (!failure.empty()) return promise.Reject(failure.c_str());
      promise.Resolve(text);
    });
  }

  REACT_METHOD(download)
  void download(std::string url, std::string sha256, double bytes, winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    std::wstring address = Paths::Wide(url);
    if (!AppUpdate::Allowed(address)) return promise.Reject("Updates do not come from that address");
    if (!AppUpdate::IsSha256(sha256)) return promise.Reject("The update has no usable SHA-256");
    if (!(bytes >= 1) || bytes > static_cast<double>(AppUpdate::kLargestInstallerBytes)) return promise.Reject("The update has no usable size");
    uint64_t size = static_cast<uint64_t>(bytes);
    OnAThread(promise, [address, sha256, size, promise]() noexcept {
      AppUpdate::Downloaded downloaded = AppUpdate::Download(address, sha256, size);
      if (!downloaded.failure.empty()) return promise.Reject(downloaded.failure.c_str());
      promise.Resolve(downloaded.path);
    });
  }

  REACT_METHOD(install)
  void install(std::string path, std::string sha256, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    if (!AppUpdate::IsSha256(sha256)) return promise.Reject("The update has no usable SHA-256");
    if (AppLaunch::Background()) {
      AppLaunch::Note(L"ArdiaWindowsUpdate: background instance, not running the installer");
      return promise.Resolve(false);
    }
    OnAThread(promise, [path, sha256, promise]() noexcept {
      std::string failure = AppUpdate::RunInstaller(path, sha256);
      if (!failure.empty()) return promise.Reject(failure.c_str());
      promise.Resolve(true);
    });
  }

 private:
  template <class TPromise, class TWork>
  static void OnAThread(TPromise const &promise, TWork &&work) noexcept {
    try {
      std::thread(std::forward<TWork>(work)).detach();
    } catch (...) {
      promise.Reject("The update could not start");
    }
  }
};

}
