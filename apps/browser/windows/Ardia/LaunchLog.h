#pragma once

namespace Ardia {

struct LaunchLog {
  static void OpenFromCommandLine() noexcept {
    int count = 0;
    LPWSTR *arguments = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!arguments) return;
    constexpr std::wstring_view logFileSwitch = L"--log-file=";
    for (int i = 1; i < count; i++) {
      std::wstring_view argument{arguments[i]};
      if (argument.starts_with(logFileSwitch)) Open(std::wstring{argument.substr(logFileSwitch.size())});
    }
    LocalFree(arguments);
  }

  static void Write(std::wstring_view level, std::wstring_view message) noexcept {
    std::scoped_lock lock{Mutex()};
    FILE *file = File();
    if (!file) return;
    std::string line = winrt::to_string(level) + " " + winrt::to_string(message) + "\n";
    fwrite(line.data(), 1, line.size(), file);
    fflush(file);
  }

 private:
  static void Open(const std::wstring &path) noexcept {
    std::scoped_lock lock{Mutex()};
    if (File()) return;
    _wfopen_s(&File(), path.c_str(), L"ab");
  }

  static FILE *&File() noexcept {
    static FILE *file = nullptr;
    return file;
  }

  static std::mutex &Mutex() noexcept {
    static std::mutex mutex;
    return mutex;
  }
};

}
