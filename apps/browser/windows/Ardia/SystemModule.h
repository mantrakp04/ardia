#pragma once

#include <shlobj.h>
#include <shobjidl.h>
#include <wincodec.h>

#include <filesystem>
#include <optional>
#include <string>
#include <cwctype>
#include <vector>

#include "NativeModules.h"

#include "AppModule.h"
#include "Paths.h"

#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "uuid.lib")

namespace Ardia {

namespace SystemShell {

constexpr wchar_t RunKey[] = L"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
constexpr wchar_t StartupApprovedKey[] = L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
constexpr wchar_t LaunchAtLoginValue[] = L"Ardia";
constexpr wchar_t UrlAssociationsKey[] = L"Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\";
constexpr wchar_t ArdiaProgId[] = L"ArdiaHTM";
constexpr wchar_t ArdiaProgIdCommandKey[] = L"Software\\Classes\\ArdiaHTM\\shell\\open\\command";
constexpr wchar_t RegisteredApplicationName[] = L"Ardia";
constexpr DWORD FirstBuildWithAppDefaultsPage = 22000;

inline bool Exists(std::wstring const &path) noexcept {
  if (path.empty()) return false;
  std::error_code ignored;
  return std::filesystem::exists(std::filesystem::path(path), ignored);
}

inline std::wstring NativePath(std::string const &path) noexcept {
  std::wstring wide = Paths::Wide(path);
  for (wchar_t &c : wide)
    if (c == L'/') c = L'\\';
  return wide;
}

inline std::optional<std::wstring> RegistryString(HKEY root, wchar_t const *key, wchar_t const *value) noexcept {
  DWORD bytes = 0;
  if (RegGetValueW(root, key, value, RRF_RT_REG_SZ, nullptr, nullptr, &bytes) != ERROR_SUCCESS || bytes == 0) return std::nullopt;
  std::wstring text(bytes / sizeof(wchar_t) + 1, L'\0');
  bytes = static_cast<DWORD>(text.size() * sizeof(wchar_t));
  if (RegGetValueW(root, key, value, RRF_RT_REG_SZ, nullptr, text.data(), &bytes) != ERROR_SUCCESS) return std::nullopt;
  text.resize(wcsnlen(text.c_str(), text.size()));
  return text;
}

inline bool StartupDisabledByUser() noexcept {
  BYTE state[12]{};
  DWORD bytes = sizeof(state);
  if (RegGetValueW(HKEY_CURRENT_USER, StartupApprovedKey, LaunchAtLoginValue, RRF_RT_REG_BINARY, nullptr, state, &bytes) != ERROR_SUCCESS) return false;
  return bytes > 0 && (state[0] & 1) != 0;
}

inline std::string LaunchAtLoginStatus() noexcept {
  if (AppShell::ExecutablePath().empty()) return "notFound";
  if (!RegistryString(HKEY_CURRENT_USER, RunKey, LaunchAtLoginValue)) return "notRegistered";
  return StartupDisabledByUser() ? "requiresApproval" : "enabled";
}

inline LSTATUS SetLaunchAtLogin(bool enabled) noexcept {
  if (!enabled) {
    LSTATUS removed = RegDeleteKeyValueW(HKEY_CURRENT_USER, RunKey, LaunchAtLoginValue);
    return removed == ERROR_FILE_NOT_FOUND ? ERROR_SUCCESS : removed;
  }
  std::wstring executable = AppShell::ExecutablePath();
  if (executable.empty()) return ERROR_FILE_NOT_FOUND;
  std::wstring command = L"\"" + executable + L"\"";
  return RegSetKeyValueW(
      HKEY_CURRENT_USER, RunKey, LaunchAtLoginValue, REG_SZ, command.c_str(), static_cast<DWORD>((command.size() + 1) * sizeof(wchar_t)));
}

inline std::optional<std::wstring> ChosenProgId(std::wstring const &scheme) noexcept {
  for (wchar_t const *choice : {L"\\UserChoiceLatest", L"\\UserChoice"}) {
    std::wstring key = UrlAssociationsKey + scheme + choice;
    std::optional<std::wstring> progId = RegistryString(HKEY_CURRENT_USER, key.c_str(), L"ProgId");
    if (progId && !progId->empty()) return progId;
  }
  return std::nullopt;
}

inline std::wstring Folded(std::wstring text) noexcept {
  for (wchar_t &c : text) c = static_cast<wchar_t>(towlower(c));
  for (wchar_t &c : text)
    if (c == L'/') c = L'\\';
  return text;
}

inline std::optional<std::wstring> RegisteredCommand() noexcept {
  return RegistryString(HKEY_CURRENT_USER, ArdiaProgIdCommandKey, nullptr);
}

inline bool RegisteredForThisApp(std::optional<std::wstring> const &command) noexcept {
  std::wstring executable = AppShell::ExecutablePath();
  if (!command || executable.empty()) return false;
  std::wstring quoted = L"\"" + Folded(executable) + L"\"";
  std::wstring folded = Folded(*command);
  return folded.rfind(quoted, 0) == 0 && folded.find(L"--single-argument %1") != std::wstring::npos;
}

inline bool ChosenForScheme(std::wstring const &scheme) noexcept {
  std::optional<std::wstring> progId = ChosenProgId(scheme);
  return progId && _wcsicmp(progId->c_str(), ArdiaProgId) == 0;
}

inline bool IsDefaultBrowser() noexcept {
  return ChosenForScheme(L"http") && ChosenForScheme(L"https") && RegisteredForThisApp(RegisteredCommand());
}

inline std::wstring DefaultAppsPage() noexcept {
  DWORD build = static_cast<DWORD>((AppDiagnostics::KernelVersion() >> 16) & 0xFFFF);
  if (build >= FirstBuildWithAppDefaultsPage && RegisteredForThisApp(RegisteredCommand())) return std::wstring{L"ms-settings:defaultapps?registeredAppUser="} + RegisteredApplicationName;
  return L"ms-settings:defaultapps";
}

inline bool Reveal(std::wstring const &path) noexcept {
  PIDLIST_ABSOLUTE item = nullptr;
  if (FAILED(SHParseDisplayName(path.c_str(), nullptr, &item, 0, nullptr)) || !item) return false;
  HRESULT opened = SHOpenFolderAndSelectItems(item, 0, nullptr, 0);
  CoTaskMemFree(item);
  return SUCCEEDED(opened);
}

struct RecycleOrRefuse : winrt::implements<RecycleOrRefuse, ::IFileOperationProgressSink> {
  IFACEMETHODIMP StartOperations() noexcept override { return S_OK; }
  IFACEMETHODIMP FinishOperations(HRESULT) noexcept override { return S_OK; }
  IFACEMETHODIMP PreRenameItem(DWORD, IShellItem *, LPCWSTR) noexcept override { return S_OK; }
  IFACEMETHODIMP PostRenameItem(DWORD, IShellItem *, LPCWSTR, HRESULT, IShellItem *) noexcept override { return S_OK; }
  IFACEMETHODIMP PreMoveItem(DWORD, IShellItem *, IShellItem *, LPCWSTR) noexcept override { return S_OK; }
  IFACEMETHODIMP PostMoveItem(DWORD, IShellItem *, IShellItem *, LPCWSTR, HRESULT, IShellItem *) noexcept override { return S_OK; }
  IFACEMETHODIMP PreCopyItem(DWORD, IShellItem *, IShellItem *, LPCWSTR) noexcept override { return S_OK; }
  IFACEMETHODIMP PostCopyItem(DWORD, IShellItem *, IShellItem *, LPCWSTR, HRESULT, IShellItem *) noexcept override { return S_OK; }
  IFACEMETHODIMP PreDeleteItem(DWORD flags, IShellItem *) noexcept override { return (flags & TSF_DELETE_RECYCLE_IF_POSSIBLE) ? S_OK : E_ABORT; }
  IFACEMETHODIMP PostDeleteItem(DWORD, IShellItem *, HRESULT, IShellItem *) noexcept override { return S_OK; }
  IFACEMETHODIMP PreNewItem(DWORD, IShellItem *, LPCWSTR) noexcept override { return S_OK; }
  IFACEMETHODIMP PostNewItem(DWORD, IShellItem *, LPCWSTR, LPCWSTR, DWORD, HRESULT, IShellItem *) noexcept override { return S_OK; }
  IFACEMETHODIMP UpdateProgress(UINT, UINT) noexcept override { return S_OK; }
  IFACEMETHODIMP ResetTimer() noexcept override { return S_OK; }
  IFACEMETHODIMP PauseTimer() noexcept override { return S_OK; }
  IFACEMETHODIMP ResumeTimer() noexcept override { return S_OK; }
};

inline bool Recycle(std::wstring const &path) noexcept {
  winrt::com_ptr<IFileOperation> operation;
  if (FAILED(CoCreateInstance(CLSID_FileOperation, nullptr, CLSCTX_ALL, IID_PPV_ARGS(operation.put())))) return false;
  DWORD flags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI | FOF_NOCONFIRMMKDIR | FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE;
  if (FAILED(operation->SetOperationFlags(flags))) return false;
  winrt::com_ptr<IShellItem> item;
  if (FAILED(SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(item.put())))) return false;
  winrt::com_ptr<::IFileOperationProgressSink> recycleOrRefuse;
  try {
    recycleOrRefuse = winrt::make_self<RecycleOrRefuse>().as<::IFileOperationProgressSink>();
  } catch (...) {
    return false;
  }
  if (FAILED(operation->DeleteItem(item.get(), recycleOrRefuse.get()))) return false;
  if (FAILED(operation->PerformOperations())) return false;
  BOOL aborted = FALSE;
  operation->GetAnyOperationsAborted(&aborted);
  return !aborted && !Exists(path);
}

inline std::string Base64(std::vector<BYTE> const &bytes) noexcept {
  static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string encoded;
  encoded.reserve((bytes.size() + 2) / 3 * 4);
  size_t index = 0;
  for (; index + 2 < bytes.size(); index += 3) {
    uint32_t triple = (uint32_t{bytes[index]} << 16) | (uint32_t{bytes[index + 1]} << 8) | uint32_t{bytes[index + 2]};
    encoded.push_back(alphabet[(triple >> 18) & 63]);
    encoded.push_back(alphabet[(triple >> 12) & 63]);
    encoded.push_back(alphabet[(triple >> 6) & 63]);
    encoded.push_back(alphabet[triple & 63]);
  }
  size_t remaining = bytes.size() - index;
  if (remaining > 0) {
    uint32_t triple = uint32_t{bytes[index]} << 16;
    if (remaining == 2) triple |= uint32_t{bytes[index + 1]} << 8;
    encoded.push_back(alphabet[(triple >> 18) & 63]);
    encoded.push_back(alphabet[(triple >> 12) & 63]);
    encoded.push_back(remaining == 2 ? alphabet[(triple >> 6) & 63] : '=');
    encoded.push_back('=');
  }
  return encoded;
}

inline std::optional<std::string> PngDataUrl(IWICImagingFactory *factory, IWICBitmapSource *source, UINT pixels) noexcept {
  UINT width = 0, height = 0;
  if (FAILED(source->GetSize(&width, &height)) || width == 0 || height == 0) return std::nullopt;
  winrt::com_ptr<IWICBitmapScaler> scaler;
  IWICBitmapSource *sized = source;
  if (width != pixels || height != pixels) {
    if (FAILED(factory->CreateBitmapScaler(scaler.put()))) return std::nullopt;
    if (FAILED(scaler->Initialize(source, pixels, pixels, WICBitmapInterpolationModeFant))) return std::nullopt;
    sized = scaler.get();
  }
  winrt::com_ptr<IWICFormatConverter> converter;
  if (FAILED(factory->CreateFormatConverter(converter.put()))) return std::nullopt;
  if (FAILED(converter->Initialize(sized, GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom)))
    return std::nullopt;
  winrt::com_ptr<IStream> stream;
  if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, stream.put()))) return std::nullopt;
  winrt::com_ptr<IWICBitmapEncoder> encoder;
  if (FAILED(factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, encoder.put()))) return std::nullopt;
  if (FAILED(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache))) return std::nullopt;
  winrt::com_ptr<IWICBitmapFrameEncode> frame;
  winrt::com_ptr<IPropertyBag2> properties;
  if (FAILED(encoder->CreateNewFrame(frame.put(), properties.put()))) return std::nullopt;
  if (FAILED(frame->Initialize(properties.get()))) return std::nullopt;
  if (FAILED(frame->SetSize(pixels, pixels))) return std::nullopt;
  WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
  if (FAILED(frame->SetPixelFormat(&format))) return std::nullopt;
  if (FAILED(frame->WriteSource(converter.get(), nullptr))) return std::nullopt;
  if (FAILED(frame->Commit()) || FAILED(encoder->Commit())) return std::nullopt;
  STATSTG stat{};
  if (FAILED(stream->Stat(&stat, STATFLAG_NONAME)) || stat.cbSize.QuadPart == 0 || stat.cbSize.QuadPart > (64ull << 20)) return std::nullopt;
  LARGE_INTEGER start{};
  if (FAILED(stream->Seek(start, STREAM_SEEK_SET, nullptr))) return std::nullopt;
  std::vector<BYTE> png(static_cast<size_t>(stat.cbSize.QuadPart));
  ULONG read = 0;
  if (FAILED(stream->Read(png.data(), static_cast<ULONG>(png.size()), &read)) || read != png.size()) return std::nullopt;
  return std::string{"data:image/png;base64,"} + Base64(png);
}

inline winrt::com_ptr<IWICBitmapSource> ShellItemIcon(IWICImagingFactory *factory, std::wstring const &path, UINT pixels) noexcept {
  winrt::com_ptr<IWICBitmapSource> source;
  winrt::com_ptr<IShellItemImageFactory> images;
  if (FAILED(SHCreateItemFromParsingName(path.c_str(), nullptr, IID_PPV_ARGS(images.put())))) return source;
  HBITMAP bitmap = nullptr;
  SIZE size{static_cast<LONG>(pixels), static_cast<LONG>(pixels)};
  if (FAILED(images->GetImage(size, SIIGBF_ICONONLY, &bitmap)) || !bitmap) return source;
  winrt::com_ptr<IWICBitmap> made;
  if (SUCCEEDED(factory->CreateBitmapFromHBITMAP(bitmap, nullptr, WICBitmapUsePremultipliedAlpha, made.put()))) source.copy_from(made.get());
  DeleteObject(bitmap);
  return source;
}

inline winrt::com_ptr<IWICBitmapSource> TypeIcon(IWICImagingFactory *factory, std::wstring const &path) noexcept {
  winrt::com_ptr<IWICBitmapSource> source;
  std::wstring extension = std::filesystem::path(path).extension().wstring();
  std::wstring probe = extension.empty() ? std::wstring{L"file"} : L"file" + extension;
  SHFILEINFOW info{};
  if (!SHGetFileInfoW(probe.c_str(), FILE_ATTRIBUTE_NORMAL, &info, sizeof(info), SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES) || !info.hIcon)
    return source;
  winrt::com_ptr<IWICBitmap> made;
  if (SUCCEEDED(factory->CreateBitmapFromHICON(info.hIcon, made.put()))) source.copy_from(made.get());
  DestroyIcon(info.hIcon);
  return source;
}

inline std::optional<std::string> FileIcon(std::wstring const &path, double points) noexcept {
  double clamped = points > 0 && points < 256 ? points : 32;
  UINT pixels = static_cast<UINT>(clamped * 2 + 0.5);
  winrt::com_ptr<IWICImagingFactory> factory;
  if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.put())))) return std::nullopt;
  winrt::com_ptr<IWICBitmapSource> source;
  if (Exists(path)) source = ShellItemIcon(factory.get(), path, pixels);
  if (!source) source = TypeIcon(factory.get(), path);
  if (!source) return std::nullopt;
  return PngDataUrl(factory.get(), source.get(), pixels);
}

inline winrt::Microsoft::ReactNative::JSValue OptionalString(std::optional<std::string> value) noexcept {
  if (!value) return winrt::Microsoft::ReactNative::JSValue{nullptr};
  return winrt::Microsoft::ReactNative::JSValue{std::move(*value)};
}

}

REACT_MODULE(SystemModule, L"ArdiaSystem")
struct SystemModule {
  REACT_CONSTANT(backgroundInstance)
  const bool backgroundInstance = AppLaunch::Background();

  REACT_METHOD(isDefaultBrowser)
  void isDefaultBrowser(winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    promise.Resolve(SystemShell::IsDefaultBrowser());
  }

  REACT_METHOD(setAsDefaultBrowser)
  void setAsDefaultBrowser(winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    if (AppLaunch::Background()) {
      AppLaunch::Note(L"ArdiaSystem: background instance, not setting the default browser");
      return promise.Resolve(false);
    }
    std::wstring page = SystemShell::DefaultAppsPage();
    AppLaunch::Note(L"ArdiaSystem: opening " + page);
    AppShell::RunOnShellThread([page]() noexcept { AppShell::Execute(page); });
    promise.Resolve(false);
  }

  REACT_SYNC_METHOD(defaultBrowserState)
  winrt::Microsoft::ReactNative::JSValue defaultBrowserState() noexcept {
    using winrt::Microsoft::ReactNative::JSValue;
    auto text = [](std::optional<std::wstring> const &value) { return value ? JSValue{Paths::Utf8(*value)} : JSValue{nullptr}; };
    std::optional<std::wstring> command = SystemShell::RegisteredCommand();
    winrt::Microsoft::ReactNative::JSValueObject state;
    state["progId"] = JSValue{Paths::Utf8(SystemShell::ArdiaProgId)};
    state["command"] = text(command);
    state["registeredHere"] = JSValue{SystemShell::RegisteredForThisApp(command)};
    state["http"] = text(SystemShell::ChosenProgId(L"http"));
    state["https"] = text(SystemShell::ChosenProgId(L"https"));
    state["page"] = JSValue{Paths::Utf8(SystemShell::DefaultAppsPage())};
    state["isDefault"] = JSValue{SystemShell::IsDefaultBrowser()};
    return JSValue{std::move(state)};
  }

  REACT_METHOD(launchAtLoginStatus)
  void launchAtLoginStatus(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept {
    promise.Resolve(SystemShell::LaunchAtLoginStatus());
  }

  REACT_METHOD(setLaunchAtLogin)
  void setLaunchAtLogin(bool enabled, winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    if (AppLaunch::Background()) {
      AppLaunch::Note(L"ArdiaSystem: background instance, not changing launch at login");
      return promise.Resolve();
    }
    if (Paths::HasCustomDataDirectory()) {
      AppLaunch::Note(L"ArdiaSystem: custom data directory, not changing launch at login");
      return promise.Resolve();
    }
    LSTATUS status = SystemShell::SetLaunchAtLogin(enabled);
    if (status != ERROR_SUCCESS) return promise.Reject((std::string{"Couldn't change launch at login (error "} + std::to_string(status) + ")").c_str());
    promise.Resolve();
  }

  REACT_SYNC_METHOD(fileExists)
  bool fileExists(std::string path) noexcept {
    return SystemShell::Exists(SystemShell::NativePath(path));
  }

  REACT_METHOD(openFile)
  void openFile(std::string path, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    std::wstring target = SystemShell::NativePath(path);
    if (!SystemShell::Exists(target)) return promise.Resolve(false);
    if (AppLaunch::Background()) {
      AppLaunch::Note(L"ArdiaSystem: background instance, not opening " + target);
      return promise.Resolve(true);
    }
    if (!AppShell::RunOnShellThread([target, promise]() noexcept { promise.Resolve(AppShell::Execute(target)); })) promise.Resolve(false);
  }

  REACT_METHOD(revealFile)
  void revealFile(std::string path, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    std::wstring target = SystemShell::NativePath(path);
    if (!SystemShell::Exists(target)) return promise.Resolve(false);
    if (AppLaunch::Background()) {
      AppLaunch::Note(L"ArdiaSystem: background instance, not revealing " + target);
      return promise.Resolve(true);
    }
    if (!AppShell::RunOnShellThread([target, promise]() noexcept { promise.Resolve(SystemShell::Reveal(target)); })) promise.Resolve(false);
  }

  REACT_METHOD(moveToTrash)
  void moveToTrash(std::string path, winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept {
    std::wstring target = SystemShell::NativePath(path);
    if (!SystemShell::Exists(target)) return promise.Resolve(false);
    if (!AppShell::RunOnShellThread([target, promise]() noexcept { promise.Resolve(SystemShell::Recycle(target)); }))
      promise.Resolve(false);
  }

  REACT_METHOD(fileIcon)
  void fileIcon(std::string path, double size, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    std::wstring target = SystemShell::NativePath(path);
    if (!AppShell::RunOnShellThread([target, size, promise]() noexcept { promise.Resolve(SystemShell::OptionalString(SystemShell::FileIcon(target, size))); }))
      promise.Resolve(winrt::Microsoft::ReactNative::JSValue{nullptr});
  }

  REACT_METHOD(runningAppIcon)
  void runningAppIcon(double, double, winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValue> promise) noexcept {
    promise.Resolve(winrt::Microsoft::ReactNative::JSValue{nullptr});
  }

  REACT_METHOD(hapticTick)
  void hapticTick() noexcept {}

  REACT_METHOD(setThinScrollBars)
  void setThinScrollBars(bool, winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept {
    promise.Resolve();
  }
};

}
