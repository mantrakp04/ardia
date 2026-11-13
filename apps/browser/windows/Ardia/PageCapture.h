#pragma once

#include <wincodec.h>
#include <wincrypt.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "windowscodecs.lib")

namespace Ardia {

namespace PageCapture {

inline constexpr UINT kPrintFullContent = 0x00000002;
inline constexpr double kSmallestScale = 0.5;
inline constexpr LONG kLargestSide = 16384;
inline constexpr int64_t kLargestPixels = 6144ll * 4096;

struct Target {
  HWND owner = nullptr;
  RECT screen{};
  double scale = 1;
};

inline LONG AreaOf(RECT const &rect) noexcept {
  return std::max<LONG>(0, rect.right - rect.left) * std::max<LONG>(0, rect.bottom - rect.top);
}

inline bool IsPageWindow(HWND window) noexcept {
  wchar_t name[64]{};
  if (!GetClassNameW(window, name, 64)) return false;
  return std::wstring_view{name}.rfind(L"Chrome_WidgetWin_", 0) == 0;
}

struct Search {
  HWND owner;
  RECT target;
  DWORD process;
  HWND best = nullptr;
  LONG area = 0;
};

inline BOOL CALLBACK Consider(HWND window, LPARAM context) noexcept {
  auto *search = reinterpret_cast<Search *>(context);
  DWORD process = 0;
  GetWindowThreadProcessId(window, &process);
  if (process != search->process || !IsWindowVisible(window) || GetWindow(window, GW_OWNER) != search->owner || !IsPageWindow(window)) return TRUE;
  RECT rect{};
  RECT shared{};
  if (!GetWindowRect(window, &rect) || !IntersectRect(&shared, &rect, &search->target)) return TRUE;
  LONG area = AreaOf(shared);
  if (area > search->area) {
    search->best = window;
    search->area = area;
  }
  return TRUE;
}

inline HWND PageWindow(HWND owner, RECT const &target) noexcept {
  Search search{owner, target, GetCurrentProcessId()};
  EnumWindows(&Consider, reinterpret_cast<LPARAM>(&search));
  return search.area * 2 >= AreaOf(target) ? search.best : nullptr;
}

inline std::optional<Target> TargetIn(HWND owner, double x, double y, double width, double height, double scale) noexcept {
  if (!owner || !IsWindow(owner) || IsIconic(owner) || !(width > 0) || !(height > 0)) return std::nullopt;
  double dpi = GetDpiForWindow(owner) / 96.0;
  POINT origin{static_cast<LONG>(std::lround(x * dpi)), static_cast<LONG>(std::lround(y * dpi))};
  if (!ClientToScreen(owner, &origin)) return std::nullopt;
  Target target;
  target.owner = owner;
  target.screen = {origin.x, origin.y, origin.x + static_cast<LONG>(std::lround(width * dpi)), origin.y + static_cast<LONG>(std::lround(height * dpi))};
  target.scale = std::clamp(scale, kSmallestScale, 1.0) / dpi;
  return target;
}

struct Pixels {
  UINT width = 0;
  UINT height = 0;
  std::vector<BYTE> bgra;
};

inline std::optional<Pixels> Print(HWND window, RECT const &wanted) noexcept {
  RECT rect{};
  if (!GetWindowRect(window, &rect)) return std::nullopt;
  RECT crop{};
  if (!IntersectRect(&crop, &rect, &wanted)) return std::nullopt;
  LONG width = rect.right - rect.left;
  LONG height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0 || width > kLargestSide || height > kLargestSide || static_cast<int64_t>(width) * height > kLargestPixels) return std::nullopt;
  HDC screen = GetDC(nullptr);
  HDC memory = CreateCompatibleDC(screen);
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  void *bits = nullptr;
  HBITMAP bitmap = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &bits, nullptr, 0);
  std::optional<Pixels> out;
  if (bitmap && memory && bits) {
    HGDIOBJ previous = SelectObject(memory, bitmap);
    if (PrintWindow(window, memory, kPrintFullContent)) {
      GdiFlush();
      Pixels pixels;
      pixels.width = static_cast<UINT>(crop.right - crop.left);
      pixels.height = static_cast<UINT>(crop.bottom - crop.top);
      pixels.bgra.resize(static_cast<size_t>(pixels.width) * pixels.height * 4);
      const BYTE *source = static_cast<const BYTE *>(bits);
      bool painted = false;
      for (UINT row = 0; row < pixels.height; row++) {
        const BYTE *from = source + (static_cast<size_t>(crop.top - rect.top + row) * width + (crop.left - rect.left)) * 4;
        BYTE *to = pixels.bgra.data() + static_cast<size_t>(row) * pixels.width * 4;
        memcpy(to, from, static_cast<size_t>(pixels.width) * 4);
        for (UINT i = 0; i < pixels.width * 4 && !painted; i += 4) painted = (to[i] | to[i + 1] | to[i + 2]) != 0;
      }
      if (painted) out = std::move(pixels);
    }
    SelectObject(memory, previous);
  }
  if (bitmap) DeleteObject(bitmap);
  if (memory) DeleteDC(memory);
  ReleaseDC(nullptr, screen);
  return out;
}

inline std::string Base64(std::vector<BYTE> const &bytes) {
  DWORD length = 0;
  DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
  if (bytes.empty() || !CryptBinaryToStringA(bytes.data(), static_cast<DWORD>(bytes.size()), flags, nullptr, &length)) return {};
  std::string out(length, '\0');
  if (!CryptBinaryToStringA(bytes.data(), static_cast<DWORD>(bytes.size()), flags, out.data(), &length)) return {};
  out.resize(length);
  while (!out.empty() && out.back() == '\0') out.pop_back();
  return out;
}

inline std::string Jpeg(Pixels const &pixels, double scale, float quality) noexcept {
  try {
    winrt::com_ptr<IWICImagingFactory> factory;
    if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(factory.put())))) return {};
    winrt::com_ptr<IWICBitmap> bitmap;
    if (FAILED(factory->CreateBitmapFromMemory(pixels.width, pixels.height, GUID_WICPixelFormat32bppBGR, pixels.width * 4, static_cast<UINT>(pixels.bgra.size()),
                                               const_cast<BYTE *>(pixels.bgra.data()), bitmap.put())))
      return {};
    UINT width = std::max<UINT>(1, static_cast<UINT>(std::lround(pixels.width * std::min(scale, 1.0))));
    UINT height = std::max<UINT>(1, static_cast<UINT>(std::lround(pixels.height * std::min(scale, 1.0))));
    winrt::com_ptr<IWICBitmapScaler> scaler;
    if (FAILED(factory->CreateBitmapScaler(scaler.put())) || FAILED(scaler->Initialize(bitmap.get(), width, height, WICBitmapInterpolationModeFant))) return {};
    winrt::com_ptr<IWICFormatConverter> converter;
    if (FAILED(factory->CreateFormatConverter(converter.put())) ||
        FAILED(converter->Initialize(scaler.get(), GUID_WICPixelFormat24bppBGR, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom)))
      return {};
    winrt::com_ptr<IStream> stream;
    if (FAILED(CreateStreamOnHGlobal(nullptr, TRUE, stream.put()))) return {};
    winrt::com_ptr<IWICBitmapEncoder> encoder;
    if (FAILED(factory->CreateEncoder(GUID_ContainerFormatJpeg, nullptr, encoder.put())) || FAILED(encoder->Initialize(stream.get(), WICBitmapEncoderNoCache))) return {};
    winrt::com_ptr<IWICBitmapFrameEncode> frame;
    winrt::com_ptr<IPropertyBag2> options;
    if (FAILED(encoder->CreateNewFrame(frame.put(), options.put()))) return {};
    PROPBAG2 option{};
    option.pstrName = const_cast<LPOLESTR>(L"ImageQuality");
    VARIANT value;
    VariantInit(&value);
    value.vt = VT_R4;
    value.fltVal = quality;
    options->Write(1, &option, &value);
    WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR;
    if (FAILED(frame->Initialize(options.get())) || FAILED(frame->SetSize(width, height)) || FAILED(frame->SetPixelFormat(&format)) ||
        FAILED(frame->WriteSource(converter.get(), nullptr)) || FAILED(frame->Commit()) || FAILED(encoder->Commit()))
      return {};
    HGLOBAL memory = nullptr;
    if (FAILED(GetHGlobalFromStream(stream.get(), &memory))) return {};
    STATSTG stat{};
    if (FAILED(stream->Stat(&stat, STATFLAG_NONAME))) return {};
    std::vector<BYTE> bytes(static_cast<size_t>(stat.cbSize.QuadPart));
    if (void *locked = GlobalLock(memory)) {
      memcpy(bytes.data(), locked, bytes.size());
      GlobalUnlock(memory);
    }
    return Base64(bytes);
  } catch (...) {
    return {};
  }
}

inline std::string Capture(Target const &target, double askedScale) noexcept {
  HWND page = PageWindow(target.owner, target.screen);
  if (!page) return {};
  auto pixels = Print(page, target.screen);
  if (!pixels) return {};
  return Jpeg(*pixels, target.scale, askedScale < 0.5 ? 0.55f : 0.75f);
}

}

}
