#include <windows.h>

#include <shellapi.h>

#include <string>
#include <string_view>

#include "../Ardia/EngineApi.h"

#pragma comment(lib, "shell32.lib")

namespace {

constexpr int kNoOwnPath = 20;
constexpr int kAppLibraryMissing = 21;
constexpr int kAppLibraryIncomplete = 22;

std::wstring OwnDirectory() {
  std::wstring path(MAX_PATH, L'\0');
  while (true) {
    DWORD written = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (written == 0) return {};
    if (written < path.size()) {
      path.resize(written);
      break;
    }
    if (path.size() >= 32768) return {};
    path.resize(path.size() * 2);
  }
  size_t slash = path.find_last_of(L"\\/");
  if (slash == std::wstring::npos) return {};
  path.resize(slash + 1);
  return path;
}

std::wstring LogFileFromCommandLine() {
  int count = 0;
  LPWSTR *arguments = CommandLineToArgvW(GetCommandLineW(), &count);
  if (!arguments) return {};
  constexpr std::wstring_view logFileSwitch = L"--log-file=";
  std::wstring found;
  for (int i = 1; i < count; i++) {
    std::wstring_view argument{arguments[i]};
    if (found.empty() && argument.substr(0, logFileSwitch.size()) == logFileSwitch) found = argument.substr(logFileSwitch.size());
  }
  LocalFree(arguments);
  return found;
}

unsigned long long ElapsedMs() {
  FILETIME created{}, exited{}, kernel{}, user{}, now{};
  GetSystemTimeAsFileTime(&now);
  if (!GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel, &user)) return 0;
  ULARGE_INTEGER started{}, current{};
  started.LowPart = created.dwLowDateTime;
  started.HighPart = created.dwHighDateTime;
  current.LowPart = now.dwLowDateTime;
  current.HighPart = now.dwHighDateTime;
  return current.QuadPart > started.QuadPart ? (current.QuadPart - started.QuadPart) / 10000 : 0;
}

std::string Utf8(std::wstring_view wide) {
  if (wide.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string utf8(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), utf8.data(), size, nullptr, nullptr);
  return utf8;
}

bool Background() {
  wchar_t value[4]{};
  DWORD length = GetEnvironmentVariableW(L"ARDIA_BACKGROUND", value, 4);
  return length == 1 && value[0] == L'1';
}

int Fail(int code, std::wstring message, DWORD error) {
  if (error != 0) message.append(L" (error ").append(std::to_wstring(error)).append(L")");
  OutputDebugStringW(std::wstring(L"Ardia: ").append(message).append(L"\n").c_str());
  std::wstring logFile = LogFileFromCommandLine();
  if (logFile.empty()) {
    if (!Background()) MessageBoxW(nullptr, message.c_str(), L"Ardia", MB_OK | MB_ICONERROR);
    return code;
  }
  HANDLE file = CreateFileW(logFile.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return code;
  std::string line = "fatal " + std::to_string(ElapsedMs()) + " " + Utf8(message) + "\n";
  DWORD written = 0;
  WriteFile(file, line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
  CloseHandle(file);
  return code;
}

}

_Use_decl_annotations_ int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  std::wstring directory = OwnDirectory();
  if (directory.empty()) return Fail(kNoOwnPath, L"Ardia could not find its own folder", GetLastError());
  std::wstring library = directory + L"ArdiaApp.dll";
  HMODULE app = LoadLibraryExW(library.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
  if (!app) return Fail(kAppLibraryMissing, L"Ardia could not load ArdiaApp.dll from its folder", GetLastError());
  auto run = reinterpret_cast<ArdiaAppRunFunction>(reinterpret_cast<void *>(GetProcAddress(app, "ArdiaAppRun")));
  if (!run) return Fail(kAppLibraryIncomplete, L"ArdiaApp.dll has no ArdiaAppRun", GetLastError());
  return run();
}
