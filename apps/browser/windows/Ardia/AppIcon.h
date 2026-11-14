#pragma once

#include <shobjidl_core.h>
#include <wincodec.h>

#include <filesystem>
#include <map>
#include <optional>
#include <string>

#include "AppImage.h"
#include "LaunchLog.h"
#include "Paths.h"
#include "resource.h"

#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "shell32.lib")

namespace Ardia {

struct AppIcon {
  static constexpr wchar_t kAppUserModelId[] = L"Ardia.Browser";
  static constexpr wchar_t kDisplayName[] = L"Ardia";

  static void ClaimAppUserModelId() noexcept {
    PWSTR previous = nullptr;
    std::wstring before = SUCCEEDED(GetCurrentProcessExplicitAppUserModelID(&previous)) && previous ? std::wstring{previous} : std::wstring{L"none"};
    if (previous) CoTaskMemFree(previous);
    HRESULT set = SetCurrentProcessExplicitAppUserModelID(kAppUserModelId);
    std::wstring message = std::wstring(L"app icon: AppUserModelID ").append(SUCCEEDED(set) ? L"is " : L"could not be set to ").append(kAppUserModelId).append(L", it was ").append(before);
    LaunchLog::Write(SUCCEEDED(set) ? L"info" : L"warning", message);
  }

  static HICON Sized(int pixels) noexcept {
    static std::map<int, HICON> loaded;
    if (auto found = loaded.find(pixels); found != loaded.end()) return found->second;
    HICON icon = static_cast<HICON>(LoadImageW(AppImage::Handle(), MAKEINTRESOURCEW(IDI_ICON1), IMAGE_ICON, pixels, pixels, LR_DEFAULTCOLOR));
    if (icon) loaded.emplace(pixels, icon);
    return icon;
  }

  static void Apply(HWND hwnd, std::string_view id) noexcept {
    if (!hwnd) return;
    UINT dpi = GetDpiForWindow(hwnd);
    if (dpi == 0) dpi = USER_DEFAULT_SCREEN_DPI;
    int bigPixels = GetSystemMetricsForDpi(SM_CXICON, dpi);
    int smallPixels = GetSystemMetricsForDpi(SM_CXSMICON, dpi);
    HICON largeIcon = Sized(bigPixels);
    HICON smallIcon = Sized(smallPixels);
    if (!largeIcon || !smallIcon) {
      LaunchLog::Write(L"warning", std::wstring(L"app icon: no icon for ").append(Paths::Wide(id)).append(L", resource ").append(std::to_wstring(IDI_ICON1)).append(L" did not load"));
      return;
    }
    SendMessageW(hwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(largeIcon));
    SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(smallIcon));
    LaunchLog::Write(L"info", std::wstring(L"app icon: set on ").append(Paths::Wide(id)).append(L" at ").append(std::to_wstring(bigPixels)).append(L" and ").append(std::to_wstring(smallPixels)).append(L" px"));
  }

  static std::optional<std::wstring> NotificationIconPath() noexcept {
    std::filesystem::path png = Paths::DataDirectory() / L"Ardia.png";
    std::error_code ignored;
    std::filesystem::path library = AppImage::Path();
    bool current = std::filesystem::exists(png, ignored) && std::filesystem::file_size(png, ignored) > 0 &&
                   std::filesystem::last_write_time(png, ignored) >= std::filesystem::last_write_time(library, ignored);
    if (!current && !WritePng(png, 256)) return std::nullopt;
    return png.wstring();
  }

  static bool WritePng(std::filesystem::path const &path, UINT pixels) noexcept {
    HICON icon = static_cast<HICON>(LoadImageW(AppImage::Handle(), MAKEINTRESOURCEW(IDI_ICON1), IMAGE_ICON, static_cast<int>(pixels), static_cast<int>(pixels), LR_DEFAULTCOLOR));
    if (!icon) return false;
    bool written = false;
    std::filesystem::path partial = path;
    partial += L".partial";
    {
      winrt::com_ptr<IWICImagingFactory> factory;
      winrt::com_ptr<IWICBitmap> bitmap;
      winrt::com_ptr<IWICStream> stream;
      winrt::com_ptr<IWICBitmapEncoder> encoder;
      winrt::com_ptr<IWICBitmapFrameEncode> frame;
      winrt::com_ptr<IPropertyBag2> properties;
      WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
      written = SUCCEEDED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.put()))) &&
                SUCCEEDED(factory->CreateBitmapFromHICON(icon, bitmap.put())) &&
                SUCCEEDED(factory->CreateStream(stream.put())) &&
                SUCCEEDED(stream->InitializeFromFilename(partial.c_str(), GENERIC_WRITE)) &&
                SUCCEEDED(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.put())) &&
                SUCCEEDED(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache)) &&
                SUCCEEDED(encoder->CreateNewFrame(frame.put(), properties.put())) &&
                SUCCEEDED(frame->Initialize(properties.get())) &&
                SUCCEEDED(frame->SetSize(pixels, pixels)) &&
                SUCCEEDED(frame->SetPixelFormat(&format)) &&
                SUCCEEDED(frame->WriteSource(bitmap.get(), nullptr)) &&
                SUCCEEDED(frame->Commit()) &&
                SUCCEEDED(encoder->Commit());
    }
    DestroyIcon(icon);
    std::error_code failed;
    if (written) std::filesystem::rename(partial, path, failed);
    if (!written || failed) {
      std::error_code ignored;
      std::filesystem::remove(partial, ignored);
      LaunchLog::Write(L"warning", L"app icon: the notification icon could not be written");
      return false;
    }
    return true;
  }
};

}
