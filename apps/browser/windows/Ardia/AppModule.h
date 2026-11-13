#pragma once

#include <winver.h>
#include <psapi.h>
#include <shellscalingapi.h>
#include <d3d11.h>
#include <intrin.h>

#include <algorithm>
#include <cstring>
#include <filesystem>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

#include "NativeModules.h"

#include "AppImage.h"
#include "LaunchLog.h"
#include "Paths.h"

#pragma comment(lib, "version.lib")
#pragma comment(lib, "shcore.lib")
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "advapi32.lib")

namespace Ardia {

namespace AppLaunch {

inline bool Background() noexcept {
  return Paths::Environment(L"ARDIA_BACKGROUND") == L"1";
}

inline void Note(std::wstring_view message) noexcept {
  std::wstring line{L"[ardia] "};
  line.append(message).append(L"\n");
  OutputDebugStringW(line.c_str());
  LaunchLog::Write(L"info", message);
}

inline std::string Trimmed(std::string_view text) noexcept {
  size_t start = text.find_first_not_of(" \t");
  if (start == std::string_view::npos) return {};
  size_t end = text.find_last_not_of(" \t");
  return std::string{text.substr(start, end - start + 1)};
}

inline std::vector<std::string> Pieces(std::string_view text) noexcept {
  std::vector<std::string> pieces;
  size_t start = 0;
  while (true) {
    size_t comma = text.find(',', start);
    pieces.emplace_back(text.substr(start, comma == std::string_view::npos ? std::string_view::npos : comma - start));
    if (comma == std::string_view::npos) break;
    start = comma + 1;
  }
  return pieces;
}

inline bool Contains(std::vector<std::string_view> const &list, std::string_view value) noexcept {
  return std::find(list.begin(), list.end(), value) != list.end();
}

inline bool Truthy(std::string_view value) noexcept {
  return !value.empty() && value != "0" && value != "off" && value != "false";
}

inline std::vector<std::string_view> const &InstanceKeys() noexcept {
  static const std::vector<std::string_view> keys{
      "jsLocation", "chromiumSwitches", "downloadsDir", "updateFeed", "allowAudio", "allowOcclusion", "releaseNotes",
      "cliHome", "cliBinDir", "cliUrl", "syncFolder", "sharedFolders", "importSourceDir", "importSafariHome",
  };
  return keys;
}

inline std::vector<std::string_view> const &TestKeys() noexcept {
  static const std::vector<std::string_view> keys{
      "keychain", "keychainHiddenReads", "keychainFail", "safeStorageAnswer", "reauth", "bluetoothChooser",
      "externalProtocolNoLaunch", "externalProtocolApp", "mediaRouteProvider", "systemMediaPermission", "applyProfileGate", "contextMenu",
      "loginsDelay", "loginsReleaseAfter", "cdpTabsVisible",
      "pipSelfTest", "pipHover", "fakeFullScreenMs", "shadersKeyWindow", "peekStrict", "importSecret", "importDiaBundleId", "importDiaWindows",
      "cliInstallScript", "legacySource", "legacyCrashAfter", "bangsUrl", "onboarding", "whatsNew", "telemetry",
      "liveMock", "calendarFixture", "appMenu", "appDialog", "loginsTimeout",
  };
  return keys;
}

inline std::vector<std::string_view> const &KeysWhoseValuesHoldCommas() noexcept {
  static const std::vector<std::string_view> keys{
      "chromiumSwitches", "downloadsDir", "updateFeed", "cliHome", "cliBinDir", "cliUrl", "syncFolder", "sharedFolders", "importSourceDir",
      "importSafariHome", "importSecret", "cliInstallScript", "legacySource", "bangsUrl", "liveMock",
  };
  return keys;
}

inline std::vector<std::string_view> const &TraceAreas() noexcept {
  static const std::vector<std::string_view> areas{"visibility", "pip", "pipZoom", "trafficLights", "profileGate"};
  return areas;
}

inline std::map<std::string, std::string> KeyedEntries(std::string_view text, std::vector<std::string_view> const &known, std::wstring_view variable) noexcept {
  std::map<std::string, std::string> entries;
  if (text.empty()) return entries;
  std::vector<std::string> pieces;
  std::string previousKey;
  for (std::string const &piece : Pieces(text)) {
    std::string head = Trimmed(std::string_view{piece}.substr(0, piece.find('=')));
    if (!pieces.empty() && !Contains(known, head) && Contains(KeysWhoseValuesHoldCommas(), previousKey)) {
      pieces.back().append(",").append(piece);
      continue;
    }
    pieces.push_back(piece);
    previousKey = head;
  }
  for (std::string const &piece : pieces) {
    size_t equals = piece.find('=');
    std::string key = Trimmed(std::string_view{piece}.substr(0, equals));
    if (key.empty()) continue;
    if (!Contains(known, key)) {
      std::wstring message{variable};
      Note(message.append(L": unknown key ").append(Paths::Wide(key)).append(L" ignored"));
      continue;
    }
    entries[key] = equals == std::string::npos ? std::string{"1"} : Trimmed(std::string_view{piece}.substr(equals + 1));
  }
  return entries;
}

inline std::map<std::string, bool> SwitchEntries(std::string_view text) noexcept {
  std::map<std::string, bool> entries;
  for (std::string const &piece : Pieces(text)) {
    size_t equals = piece.find('=');
    if (equals == std::string::npos || piece.find('=', equals + 1) != std::string::npos) continue;
    std::string name = Trimmed(std::string_view{piece}.substr(0, equals));
    std::string value = Trimmed(std::string_view{piece}.substr(equals + 1));
    if (name.empty()) continue;
    if (value == "on" || value == "1" || value == "true") entries[name] = true;
    else if (value == "off" || value == "0" || value == "false") entries[name] = false;
  }
  return entries;
}

inline std::set<std::string> AreaEntries(std::string_view text) noexcept {
  std::set<std::string> areas;
  for (std::string const &piece : Pieces(text)) {
    std::string area = Trimmed(piece);
    if (area.empty()) continue;
    if (Contains(TraceAreas(), area)) areas.insert(area);
    else Note(std::wstring{L"ARDIA_TRACE: unknown area "}.append(Paths::Wide(area)).append(L" ignored"));
  }
  return areas;
}

struct Config {
  std::string dataDirectory;
  std::string configDirectory;
  bool background = false;
  bool isolated = false;
  bool testInstance = false;
  std::map<std::string, std::string> instance;
  std::map<std::string, bool> switches;
  std::set<std::string> trace;
  std::map<std::string, std::string> test;
  std::string feedbackURL;

  bool InstanceFlag(std::string_view key) const noexcept {
    auto found = instance.find(std::string{key});
    return found != instance.end() && Truthy(found->second);
  }

  winrt::Microsoft::ReactNative::JSValue Snapshot() const noexcept {
    using winrt::Microsoft::ReactNative::JSValue;
    using winrt::Microsoft::ReactNative::JSValueArray;
    using winrt::Microsoft::ReactNative::JSValueObject;
    JSValueObject instanceObject;
    for (auto const &[key, value] : instance) instanceObject[key] = JSValue{std::string{value}};
    JSValueObject switchesObject;
    for (auto const &[name, on] : switches) switchesObject[name] = JSValue{on};
    JSValueArray traceArray;
    if (testInstance)
      for (std::string const &area : trace) traceArray.push_back(JSValue{std::string{area}});
    JSValueObject testObject;
    if (testInstance)
      for (auto const &[key, value] : test) testObject[key] = JSValue{std::string{value}};
    JSValueObject snapshot;
    snapshot["dataDirectory"] = dataDirectory.empty() ? JSValue{nullptr} : JSValue{std::string{dataDirectory}};
    snapshot["configDirectory"] = JSValue{std::string{configDirectory}};
    snapshot["background"] = JSValue{background};
    snapshot["isolated"] = JSValue{isolated};
    snapshot["testInstance"] = JSValue{testInstance};
    snapshot["instance"] = JSValue{std::move(instanceObject)};
    snapshot["switches"] = JSValue{std::move(switchesObject)};
    snapshot["trace"] = JSValue{std::move(traceArray)};
    snapshot["test"] = JSValue{std::move(testObject)};
    snapshot["feedbackURL"] = feedbackURL.empty() ? JSValue{nullptr} : JSValue{std::string{feedbackURL}};
    return JSValue{std::move(snapshot)};
  }
};

inline Config Read() noexcept {
  Config config;
  if (Paths::HasCustomDataDirectory()) {
    std::error_code ignored;
    std::filesystem::path absolute = std::filesystem::absolute(Paths::DataDirectory(), ignored);
    config.dataDirectory = Paths::Utf8((absolute.empty() ? Paths::DataDirectory() : absolute).lexically_normal().wstring());
  }
  config.configDirectory = Paths::Utf8(Paths::ConfigDirectory().wstring());
  config.background = Background();
  config.isolated = !config.dataDirectory.empty();
  config.testInstance = config.isolated;
  config.instance = KeyedEntries(Paths::Utf8(Paths::Environment(L"ARDIA_INSTANCE")), InstanceKeys(), L"ARDIA_INSTANCE");
  config.switches = SwitchEntries(Paths::Utf8(Paths::Environment(L"ARDIA_SWITCHES")));
  config.trace = AreaEntries(Paths::Utf8(Paths::Environment(L"ARDIA_TRACE")));
  config.test = KeyedEntries(Paths::Utf8(Paths::Environment(L"ARDIA_TEST")), TestKeys(), L"ARDIA_TEST");
  config.feedbackURL = Paths::Utf8(Paths::Environment(L"ARDIA_FEEDBACK_URL"));
  if ((!config.trace.empty() || !config.test.empty()) && !config.testInstance)
    Note(L"ARDIA_TEST and ARDIA_TRACE ignored: not a test instance (no scratch ARDIA_DATA_DIR)");
  return config;
}

inline Config const &Shared() noexcept {
  static const Config config = Read();
  return config;
}

}

namespace AppShell {

template <class TWork>
bool RunOnShellThread(TWork &&work) noexcept {
  try {
    std::thread([work = std::forward<TWork>(work)]() mutable noexcept {
      HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
      try {
        work();
      } catch (...) {
      }
      if (SUCCEEDED(initialized)) CoUninitialize();
    }).detach();
    return true;
  } catch (...) {
    return false;
  }
}

inline std::wstring ExecutablePath() noexcept {
  return AppImage::PathOf(nullptr);
}

inline bool Execute(std::wstring const &target) noexcept {
  HINSTANCE result = ShellExecuteW(nullptr, L"open", target.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  return reinterpret_cast<INT_PTR>(result) > 32;
}

inline std::string Lowercase(std::string text) noexcept {
  for (char &c : text)
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  return text;
}

inline bool IsExternalURL(std::string const &url) noexcept {
  std::string lower = Lowercase(url);
  bool allowedScheme = lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:");
  bool hasControl = std::any_of(url.begin(), url.end(), [](char c) { return static_cast<unsigned char>(c) < 0x20 || c == 0x7F; });
  return allowedScheme && !hasControl;
}

}

namespace AppDiagnostics {

inline double UnixMilliseconds(FILETIME time) noexcept {
  ULARGE_INTEGER value{};
  value.LowPart = time.dwLowDateTime;
  value.HighPart = time.dwHighDateTime;
  constexpr uint64_t unixEpochInFileTime = 116444736000000000ull;
  if (value.QuadPart < unixEpochInFileTime) return 0;
  return static_cast<double>(value.QuadPart - unixEpochInFileTime) / 10000.0;
}

inline std::optional<double> ProcessStart() noexcept {
  static const std::optional<double> start = []() -> std::optional<double> {
    FILETIME creation{}, exit{}, kernel{}, user{};
    if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) return std::nullopt;
    double milliseconds = UnixMilliseconds(creation);
    return milliseconds > 0 ? std::optional<double>{milliseconds} : std::nullopt;
  }();
  return start;
}

inline std::optional<double> BootTime() noexcept {
  static const std::optional<double> boot = []() -> std::optional<double> {
    FILETIME now{};
    GetSystemTimePreciseAsFileTime(&now);
    double milliseconds = UnixMilliseconds(now) - static_cast<double>(GetTickCount64());
    return milliseconds > 0 ? std::optional<double>{milliseconds} : std::nullopt;
  }();
  return boot;
}

struct ExecutableVersion {
  std::string version = "0.0.0";
  std::string build = "0";
};

inline ExecutableVersion ReadExecutableVersion() noexcept {
  ExecutableVersion found;
  std::wstring path = AppImage::Path();
  if (path.empty()) return found;
  DWORD ignored = 0;
  DWORD size = GetFileVersionInfoSizeW(path.c_str(), &ignored);
  if (size == 0) return found;
  std::vector<BYTE> block(size);
  if (!GetFileVersionInfoW(path.c_str(), 0, size, block.data())) return found;
  std::string productVersion;
  struct Translation {
    WORD language;
    WORD codePage;
  };
  Translation *translations = nullptr;
  UINT translationsLength = 0;
  if (VerQueryValueW(block.data(), L"\\VarFileInfo\\Translation", reinterpret_cast<LPVOID *>(&translations), &translationsLength) && translations &&
      translationsLength >= sizeof(Translation)) {
    wchar_t key[64]{};
    swprintf_s(key, L"\\StringFileInfo\\%04x%04x\\ProductVersion", translations[0].language, translations[0].codePage);
    wchar_t *text = nullptr;
    UINT textLength = 0;
    if (VerQueryValueW(block.data(), key, reinterpret_cast<LPVOID *>(&text), &textLength) && text && textLength > 0)
      productVersion = AppLaunch::Trimmed(Paths::Utf8(std::wstring_view{text, wcsnlen(text, textLength)}));
  }
  VS_FIXEDFILEINFO *fixed = nullptr;
  UINT fixedLength = 0;
  if (VerQueryValueW(block.data(), L"\\", reinterpret_cast<LPVOID *>(&fixed), &fixedLength) && fixed && fixedLength >= sizeof(VS_FIXEDFILEINFO)) {
    if (productVersion.empty())
      productVersion = std::to_string(HIWORD(fixed->dwProductVersionMS)) + "." + std::to_string(LOWORD(fixed->dwProductVersionMS)) + "." +
                       std::to_string(HIWORD(fixed->dwProductVersionLS));
    found.build = std::to_string(LOWORD(fixed->dwFileVersionLS));
  }
  if (!productVersion.empty()) found.version = productVersion;
  return found;
}

inline ExecutableVersion const &Version() noexcept {
  static const ExecutableVersion version = ReadExecutableVersion();
  return version;
}

inline std::string ProcessorName() noexcept {
  wchar_t name[256]{};
  DWORD bytes = sizeof(name);
  if (RegGetValueW(HKEY_LOCAL_MACHINE, L"HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0", L"ProcessorNameString", RRF_RT_REG_SZ, nullptr, name, &bytes) ==
      ERROR_SUCCESS) {
    std::string trimmed = AppLaunch::Trimmed(Paths::Utf8(name));
    if (!trimmed.empty()) return trimmed;
  }
#if defined(_M_X64)
  int registers[4]{};
  __cpuid(registers, static_cast<int>(0x80000000));
  if (static_cast<unsigned int>(registers[0]) >= 0x80000004u) {
    char brand[49]{};
    for (int leaf = 0; leaf < 3; leaf++) {
      __cpuid(registers, static_cast<int>(0x80000002u + leaf));
      memcpy(brand + leaf * 16, registers, 16);
    }
    return AppLaunch::Trimmed(brand);
  }
#endif
  return {};
}

inline std::string PrimaryGpuName() noexcept {
  std::string fallback;
  for (DWORD index = 0; index < 16; index++) {
    DISPLAY_DEVICEW device{};
    device.cb = sizeof(device);
    if (!EnumDisplayDevicesW(nullptr, index, &device, 0)) break;
    std::string name = AppLaunch::Trimmed(Paths::Utf8(device.DeviceString));
    if (name.empty()) continue;
    if (device.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE) return name;
    if (fallback.empty() && (device.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP)) fallback = name;
  }
  return fallback;
}

struct MonitorTally {
  int count = 0;
  double maxScale = 0;
};

inline BOOL CALLBACK CountMonitor(HMONITOR monitor, HDC, LPRECT, LPARAM data) noexcept {
  auto *tally = reinterpret_cast<MonitorTally *>(data);
  tally->count++;
  UINT dpiX = 0, dpiY = 0;
  if (SUCCEEDED(GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &dpiX, &dpiY)) && dpiX > 0) tally->maxScale = std::max(tally->maxScale, dpiX / 96.0);
  return TRUE;
}

inline MonitorTally Monitors() noexcept {
  MonitorTally tally;
  EnumDisplayMonitors(nullptr, nullptr, CountMonitor, reinterpret_cast<LPARAM>(&tally));
  return tally;
}

inline uint64_t KernelVersion() noexcept {
  using RtlGetVersionFunction = LONG(WINAPI *)(OSVERSIONINFOW *);
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return 0;
  auto getVersion = reinterpret_cast<RtlGetVersionFunction>(reinterpret_cast<void *>(GetProcAddress(ntdll, "RtlGetVersion")));
  if (!getVersion) return 0;
  OSVERSIONINFOW version{};
  version.dwOSVersionInfoSize = sizeof(version);
  if (getVersion(&version) != 0) return 0;
  return (uint64_t{version.dwMajorVersion & 0xFFFF} << 48) | (uint64_t{version.dwMinorVersion & 0xFFFF} << 32) | (uint64_t{version.dwBuildNumber & 0xFFFF} << 16);
}

inline uint64_t PhysicalMemory() noexcept {
  MEMORYSTATUSEX memory{};
  memory.dwLength = sizeof(memory);
  return GlobalMemoryStatusEx(&memory) ? memory.ullTotalPhys : 0;
}

struct DecodedOnTheGpu {
  bool av1 = false;
  bool vp9 = false;
  bool hevc = false;
  bool h264 = false;
};

inline constexpr GUID kDecodesH264{0x1b81be68, 0xa0c7, 0x11d3, {0xb9, 0x84, 0x00, 0xc0, 0x4f, 0x2e, 0x73, 0xc5}};
inline constexpr GUID kDecodesHevcMain{0x5b11d51b, 0x2f4c, 0x4452, {0xbc, 0xc3, 0x09, 0xf2, 0xa1, 0x16, 0x0c, 0xc0}};
inline constexpr GUID kDecodesVp9Profile0{0x463707f8, 0xa1d0, 0x4585, {0x87, 0x6d, 0x83, 0xaa, 0x6d, 0x60, 0xb8, 0x9e}};
inline constexpr GUID kDecodesAv1Profile0{0xb8be4ccb, 0xcf53, 0x46ba, {0x8d, 0x59, 0xd6, 0xb8, 0xa6, 0xda, 0x5d, 0x2a}};

inline DecodedOnTheGpu ProbeGpuDecoding() noexcept {
  DecodedOnTheGpu decoded;
  winrt::com_ptr<ID3D11Device> device;
  if (FAILED(D3D11CreateDevice(
          nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, D3D11_CREATE_DEVICE_VIDEO_SUPPORT, nullptr, 0, D3D11_SDK_VERSION, device.put(), nullptr,
          nullptr)) ||
      !device)
    return decoded;
  winrt::com_ptr<ID3D11VideoDevice> video;
  if (FAILED(device->QueryInterface(IID_PPV_ARGS(video.put()))) || !video) return decoded;
  UINT profiles = video->GetVideoDecoderProfileCount();
  for (UINT index = 0; index < profiles; index++) {
    GUID profile{};
    if (FAILED(video->GetVideoDecoderProfile(index, &profile))) continue;
    if (IsEqualGUID(profile, kDecodesAv1Profile0)) decoded.av1 = true;
    if (IsEqualGUID(profile, kDecodesVp9Profile0)) decoded.vp9 = true;
    if (IsEqualGUID(profile, kDecodesHevcMain)) decoded.hevc = true;
    if (IsEqualGUID(profile, kDecodesH264)) decoded.h264 = true;
  }
  return decoded;
}

inline DecodedOnTheGpu const &GpuDecoding() noexcept {
  static const DecodedOnTheGpu decoded = ProbeGpuDecoding();
  return decoded;
}

inline winrt::Microsoft::ReactNative::JSValue Hardware() noexcept {
  using winrt::Microsoft::ReactNative::JSValue;
  using winrt::Microsoft::ReactNative::JSValueObject;
  MonitorTally monitors = Monitors();
  JSValueObject decode;
  DecodedOnTheGpu const &decoded = GpuDecoding();
  decode["av1"] = JSValue{decoded.av1};
  decode["vp9"] = JSValue{decoded.vp9};
  decode["hevc"] = JSValue{decoded.hevc};
  decode["h264"] = JSValue{decoded.h264};
  JSValueObject info;
  info["chip"] = JSValue{ProcessorName()};
  std::string gpu = PrimaryGpuName();
  if (!gpu.empty()) info["gpu"] = JSValue{std::move(gpu)};
  info["memoryGB"] = JSValue{static_cast<int64_t>((PhysicalMemory() + (1ull << 29)) >> 30)};
  info["displays"] = JSValue{static_cast<int64_t>(monitors.count)};
  info["maxScale"] = JSValue{monitors.maxScale};
  info["hardwareDecode"] = JSValue{std::move(decode)};
  return JSValue{std::move(info)};
}

inline winrt::Microsoft::ReactNative::JSValue Sample() noexcept {
  using winrt::Microsoft::ReactNative::JSValue;
  using winrt::Microsoft::ReactNative::JSValueObject;
  JSValueObject sample;
  PROCESS_MEMORY_COUNTERS_EX counters{};
  counters.cb = sizeof(counters);
  if (GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS *>(&counters), sizeof(counters)))
    sample["footprintMB"] = JSValue{static_cast<int64_t>(counters.PrivateUsage / 1048576)};
  ULARGE_INTEGER available{};
  if (GetDiskFreeSpaceExW(Paths::DataDirectory().c_str(), &available, nullptr, nullptr))
    sample["freeDiskGB"] = JSValue{static_cast<double>(available.QuadPart / 107374182ull) / 10.0};
  return JSValue{std::move(sample)};
}

}

REACT_STRUCT(SystemInfo)
struct SystemInfo {
  REACT_FIELD(appName)
  std::string appName;
  REACT_FIELD(appVersion)
  std::string appVersion;
  REACT_FIELD(appBuild)
  std::string appBuild;
  REACT_FIELD(bundleId)
  std::string bundleId;
  REACT_FIELD(configuration)
  std::string configuration;
  REACT_FIELD(osVersion)
  std::string osVersion;
  REACT_FIELD(osBuild)
  std::string osBuild;
  REACT_FIELD(arch)
  std::string arch;
  REACT_FIELD(model)
  std::string model;
  REACT_FIELD(memoryGB)
  double memoryGB;
  REACT_FIELD(locale)
  std::string locale;
  REACT_FIELD(isolatedInstance)
  bool isolatedInstance;
  REACT_FIELD(forceReleaseNotes)
  bool forceReleaseNotes;
  REACT_FIELD(feedbackURL)
  std::optional<std::string> feedbackURL;
  REACT_FIELD(processStart)
  std::optional<double> processStart;
  REACT_FIELD(bootTime)
  std::optional<double> bootTime;
};

REACT_MODULE(AppModule, L"ArdiaApp")
struct AppModule {
  REACT_CONSTANT(windowsApiVersion)
  const int windowsApiVersion = 11;

  REACT_SYNC_METHOD(systemInfo)
  SystemInfo systemInfo() noexcept {
    uint64_t packed = 0;
    try {
      packed = wcstoull(winrt::Windows::System::Profile::AnalyticsInfo::VersionInfo().DeviceFamilyVersion().c_str(), nullptr, 10);
    } catch (...) {
    }
    if (packed == 0) packed = AppDiagnostics::KernelVersion();
    uint64_t major = (packed >> 48) & 0xFFFF;
    uint64_t minor = (packed >> 32) & 0xFFFF;
    uint64_t build = (packed >> 16) & 0xFFFF;
    uint64_t revision = packed & 0xFFFF;

    wchar_t localeName[LOCALE_NAME_MAX_LENGTH]{};
    GetUserDefaultLocaleName(localeName, LOCALE_NAME_MAX_LENGTH);

    AppLaunch::Config const &config = AppLaunch::Shared();
    AppDiagnostics::ExecutableVersion const &version = AppDiagnostics::Version();

    SystemInfo info;
    info.appName = "Ardia";
    info.appVersion = version.version;
    info.appBuild = version.build;
    info.bundleId = "com.ardia.browser";
#if _DEBUG
    info.configuration = "Debug";
#else
    info.configuration = "Release";
#endif
    info.osVersion = std::to_string(major) + "." + std::to_string(minor) + "." + std::to_string(build);
    info.osBuild = std::to_string(build) + "." + std::to_string(revision);
#if defined(_M_ARM64)
    info.arch = "arm64";
#elif defined(_M_X64)
    info.arch = "x64";
#else
    info.arch = "x86";
#endif
    info.model = "PC";
    info.memoryGB = static_cast<double>(AppDiagnostics::PhysicalMemory()) / 1073741824.0;
    info.locale = Paths::Utf8(localeName);
    info.isolatedInstance = config.isolated;
    info.forceReleaseNotes = config.InstanceFlag("releaseNotes");
    if (!config.feedbackURL.empty()) info.feedbackURL = config.feedbackURL;
    info.processStart = AppDiagnostics::ProcessStart();
    info.bootTime = AppDiagnostics::BootTime();
    return info;
  }

  REACT_SYNC_METHOD(launchConfig)
  winrt::Microsoft::ReactNative::JSValue launchConfig() noexcept {
    return AppLaunch::Shared().Snapshot();
  }

  REACT_METHOD(openExternalURL)
  void openExternalURL(std::string url, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    if (!AppShell::IsExternalURL(url)) return promise.Resolve(false);
    if (AppLaunch::Background()) {
      AppLaunch::Note(L"ArdiaApp: background instance, not opening an external URL");
      return promise.Resolve(true);
    }
    std::wstring target = Paths::Wide(url);
    if (!AppShell::RunOnShellThread([target, promise]() noexcept { promise.Resolve(AppShell::Execute(target)); })) promise.Resolve(false);
  }

  REACT_METHOD(hardwareInfo)
  void hardwareInfo(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    try {
      std::thread([promise]() noexcept { promise.Resolve(AppDiagnostics::Hardware()); }).detach();
    } catch (...) {
      promise.Resolve(AppDiagnostics::Hardware());
    }
  }

  REACT_METHOD(diagnosticsSample)
  void diagnosticsSample(winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    promise.Resolve(AppDiagnostics::Sample());
  }

  REACT_METHOD(crashReports)
  void crashReports(double, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    promise.Resolve(winrt::Microsoft::ReactNative::JSValue{winrt::Microsoft::ReactNative::JSValueArray{}});
  }

  REACT_METHOD(appIcons)
  void appIcons(double, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    promise.Resolve(winrt::Microsoft::ReactNative::JSValue{winrt::Microsoft::ReactNative::JSValueArray{}});
  }

  REACT_METHOD(appIcon)
  void appIcon(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    promise.Resolve(std::string{});
  }

  REACT_METHOD(isInDock)
  void isInDock(winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    promise.Resolve(false);
  }

  REACT_METHOD(setWindowActivity)
  void setWindowActivity(
      std::string,
      winrt::Microsoft::ReactNative::JSValue,
      winrt::Microsoft::ReactNative::JSValue,
      winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    promise.Resolve();
  }
};

}
