#pragma once

#include "NativeModules.h"

namespace Ardia {

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
};

REACT_MODULE(AppModule, L"ArdiaApp")
struct AppModule {
  REACT_CONSTANT(windowsApiVersion)
  const int windowsApiVersion = 1;

  REACT_SYNC_METHOD(systemInfo)
  SystemInfo systemInfo() noexcept {
    uint64_t packed = wcstoull(winrt::Windows::System::Profile::AnalyticsInfo::VersionInfo().DeviceFamilyVersion().c_str(), nullptr, 10);
    uint64_t major = (packed >> 48) & 0xFFFF;
    uint64_t minor = (packed >> 32) & 0xFFFF;
    uint64_t build = (packed >> 16) & 0xFFFF;
    uint64_t revision = packed & 0xFFFF;

    MEMORYSTATUSEX memory{};
    memory.dwLength = sizeof(memory);
    GlobalMemoryStatusEx(&memory);

    wchar_t localeName[LOCALE_NAME_MAX_LENGTH]{};
    GetUserDefaultLocaleName(localeName, LOCALE_NAME_MAX_LENGTH);

    SystemInfo info;
    info.appName = "Ardia";
    info.appVersion = "0.0.0";
    info.appBuild = "0";
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
    info.memoryGB = static_cast<double>((memory.ullTotalPhys + (1ull << 29)) >> 30);
    info.locale = winrt::to_string(localeName);
    return info;
  }
};

}
