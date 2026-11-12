#pragma once

#include <string>

namespace Ardia {

struct AppImage {
  static HMODULE &Handle() noexcept {
    static HMODULE handle = nullptr;
    return handle;
  }

  static std::wstring PathOf(HMODULE image) noexcept {
    std::wstring path(MAX_PATH, L'\0');
    while (true) {
      DWORD written = GetModuleFileNameW(image, path.data(), static_cast<DWORD>(path.size()));
      if (written == 0) return {};
      if (written < path.size()) {
        path.resize(written);
        return path;
      }
      if (path.size() >= 32768) return {};
      path.resize(path.size() * 2);
    }
  }

  static std::wstring Path() noexcept {
    return PathOf(Handle());
  }

  static std::wstring Directory() noexcept {
    std::wstring path = Path();
    size_t slash = path.find_last_of(L"\\/");
    return slash == std::wstring::npos ? std::wstring{} : path.substr(0, slash);
  }
};

}
