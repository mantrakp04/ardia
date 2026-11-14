#pragma once

#include <algorithm>
#include <cstring>
#include <cwchar>
#include <cwctype>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include <ole2.h>
#include <shellapi.h>

#include "NativeModules.h"
#include "Paths.h"

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shell32.lib")

namespace Ardia::FileDropParts {

enum class AcceptMode { Links, LinksAndText, ExtensionPackages };

inline AcceptMode AcceptModeNamed(std::string_view name) noexcept {
  if (name == "linksAndText") return AcceptMode::LinksAndText;
  if (name == "extensionPackages") return AcceptMode::ExtensionPackages;
  return AcceptMode::Links;
}

struct DroppedItem {
  std::string kind;
  std::string value;
};

struct DropPayload {
  std::vector<std::wstring> files;
  std::vector<std::wstring> urls;
  std::optional<std::wstring> text;

  bool Empty() const noexcept {
    return files.empty() && urls.empty() && !text;
  }
};

constexpr size_t kMaxItems = 50;
constexpr size_t kMaxSearchText = 2048;
constexpr size_t kMaxUrlLength = 8192;
constexpr size_t kMaxHostLikeLength = 2048;
constexpr ULONGLONG kMaxLinkFileSize = 64 * 1024;
constexpr size_t kMaxDroppedFiles = 4096;

inline bool IsSpace(wchar_t character) noexcept {
  return std::iswspace(static_cast<wint_t>(character)) != 0;
}

inline std::wstring Trimmed(std::wstring_view text) noexcept {
  size_t start = 0;
  size_t end = text.size();
  while (start < end && IsSpace(text[start])) start++;
  while (end > start && IsSpace(text[end - 1])) end--;
  return std::wstring{text.substr(start, end - start)};
}

inline std::wstring Lowered(std::wstring_view text) noexcept {
  std::wstring lowered{text};
  for (wchar_t &character : lowered) character = static_cast<wchar_t>(std::towlower(static_cast<wint_t>(character)));
  return lowered;
}

inline bool HasSpaceOrControl(std::wstring_view text) noexcept {
  return std::any_of(text.begin(), text.end(), [](wchar_t character) noexcept {
    return IsSpace(character) || std::iswcntrl(static_cast<wint_t>(character)) != 0;
  });
}

inline std::optional<std::wstring> WebUrl(std::wstring_view raw) noexcept {
  std::wstring text = Trimmed(raw);
  if (text.empty() || text.size() >= kMaxUrlLength || HasSpaceOrControl(text)) return std::nullopt;
  size_t colon = text.find(L':');
  if (colon == std::wstring::npos) return std::nullopt;
  std::wstring scheme = Lowered(std::wstring_view{text}.substr(0, colon));
  if (scheme != L"http" && scheme != L"https") return std::nullopt;
  std::wstring_view rest = std::wstring_view{text}.substr(colon + 1);
  if (!rest.starts_with(L"//")) return std::nullopt;
  rest.remove_prefix(2);
  std::wstring_view authority = rest.substr(0, rest.find_first_of(L"/?#"));
  size_t at = authority.rfind(L'@');
  if (at != std::wstring_view::npos) authority.remove_prefix(at + 1);
  std::wstring_view host = authority;
  if (host.starts_with(L"[")) {
    size_t close = host.find(L']');
    if (close == std::wstring_view::npos) return std::nullopt;
    host = host.substr(1, close - 1);
  } else {
    host = host.substr(0, host.find(L':'));
  }
  if (host.empty()) return std::nullopt;
  return text;
}

inline bool IsSchemeCharacter(wchar_t character) noexcept {
  return std::iswalnum(static_cast<wint_t>(character)) != 0 || character == L'+' || character == L'.' || character == L'-';
}

inline std::optional<std::wstring> HostLike(std::wstring_view raw) noexcept {
  std::wstring text = Trimmed(raw);
  if (text.empty() || text.size() >= kMaxHostLikeLength) return std::nullopt;
  if (std::any_of(text.begin(), text.end(), IsSpace)) return std::nullopt;
  size_t colon = text.find(L':');
  if (colon != std::wstring::npos) {
    std::wstring_view scheme = std::wstring_view{text}.substr(0, colon);
    bool schemeLike = !scheme.empty() && std::all_of(scheme.begin(), scheme.end(), IsSchemeCharacter) && scheme.find(L'.') == std::wstring_view::npos;
    if (schemeLike) return WebUrl(text);
  }
  if (text.find(L'.') != std::wstring::npos) return text;
  return std::nullopt;
}

inline std::wstring ExtensionOf(std::wstring_view path) noexcept {
  size_t slash = path.find_last_of(L"\\/");
  std::wstring_view name = slash == std::wstring_view::npos ? path : path.substr(slash + 1);
  size_t dot = name.rfind(L'.');
  if (dot == std::wstring_view::npos || dot == 0) return {};
  return Lowered(name.substr(dot + 1));
}

inline DWORD AttributesOf(std::wstring const &path) noexcept {
  return GetFileAttributesW(path.c_str());
}

inline bool Exists(std::wstring const &path) noexcept {
  return AttributesOf(path) != INVALID_FILE_ATTRIBUTES;
}

inline bool IsRegularFile(std::wstring const &path) noexcept {
  DWORD attributes = AttributesOf(path);
  return attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

inline std::string PercentEncodedPath(std::string_view utf8) noexcept {
  static constexpr char digits[] = "0123456789ABCDEF";
  static constexpr std::string_view kept = "-._~/:!$&'()*+,;=@";
  std::string encoded;
  encoded.reserve(utf8.size());
  for (char raw : utf8) {
    auto byte = static_cast<unsigned char>(raw);
    bool plain = (byte >= 'a' && byte <= 'z') || (byte >= 'A' && byte <= 'Z') || (byte >= '0' && byte <= '9') || kept.find(raw) != std::string_view::npos;
    if (plain) {
      encoded.push_back(raw);
    } else {
      encoded.push_back('%');
      encoded.push_back(digits[byte >> 4]);
      encoded.push_back(digits[byte & 0xF]);
    }
  }
  return encoded;
}

inline std::string FileUrl(std::wstring const &path) noexcept {
  std::string utf8 = Paths::Utf8(path);
  std::replace(utf8.begin(), utf8.end(), '\\', '/');
  DWORD attributes = AttributesOf(path);
  if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0 && !utf8.empty() && utf8.back() != '/') utf8.push_back('/');
  if (utf8.starts_with("//")) return "file:" + PercentEncodedPath(utf8);
  return "file:///" + PercentEncodedPath(utf8);
}

inline std::optional<std::string> ReadSmallFile(std::wstring const &path) noexcept {
  WIN32_FILE_ATTRIBUTE_DATA data{};
  if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &data)) return std::nullopt;
  if ((data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) return std::nullopt;
  ULONGLONG size = (static_cast<ULONGLONG>(data.nFileSizeHigh) << 32) | data.nFileSizeLow;
  if (size > kMaxLinkFileSize) return std::nullopt;
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return std::nullopt;
  std::string bytes(static_cast<size_t>(size), '\0');
  DWORD read = 0;
  BOOL ok = bytes.empty() ? TRUE : ReadFile(file, bytes.data(), static_cast<DWORD>(bytes.size()), &read, nullptr);
  CloseHandle(file);
  if (!ok) return std::nullopt;
  bytes.resize(read);
  return bytes;
}

inline std::wstring DecodedText(std::string const &bytes) noexcept {
  if (bytes.size() >= 2 && static_cast<unsigned char>(bytes[0]) == 0xFF && static_cast<unsigned char>(bytes[1]) == 0xFE) {
    std::wstring text((bytes.size() - 2) / sizeof(wchar_t), L'\0');
    if (!text.empty()) memcpy(text.data(), bytes.data() + 2, text.size() * sizeof(wchar_t));
    return text;
  }
  std::string_view utf8{bytes};
  if (utf8.starts_with("\xEF\xBB\xBF")) utf8.remove_prefix(3);
  if (utf8.empty()) return {};
  auto convert = [utf8](UINT codePage, DWORD flags) noexcept -> std::wstring {
    int length = MultiByteToWideChar(codePage, flags, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
    if (length <= 0) return {};
    std::wstring text(static_cast<size_t>(length), L'\0');
    MultiByteToWideChar(codePage, flags, utf8.data(), static_cast<int>(utf8.size()), text.data(), length);
    return text;
  };
  std::wstring text = convert(CP_UTF8, MB_ERR_INVALID_CHARS);
  return text.empty() ? convert(28591, 0) : text;
}

inline std::vector<std::wstring_view> Lines(std::wstring_view text) noexcept {
  std::vector<std::wstring_view> lines;
  size_t start = 0;
  while (start <= text.size()) {
    size_t end = text.find_first_of(L"\r\n", start);
    if (end == std::wstring_view::npos) end = text.size();
    lines.push_back(text.substr(start, end - start));
    start = end + 1;
  }
  return lines;
}

inline std::wstring XmlUnescaped(std::wstring_view text) noexcept {
  std::wstring out;
  out.reserve(text.size());
  for (size_t i = 0; i < text.size(); i++) {
    if (text[i] != L'&') {
      out.push_back(text[i]);
      continue;
    }
    std::wstring_view rest = text.substr(i);
    auto take = [&](std::wstring_view entity, wchar_t character) noexcept {
      if (!rest.starts_with(entity)) return false;
      out.push_back(character);
      i += entity.size() - 1;
      return true;
    };
    if (take(L"&amp;", L'&') || take(L"&lt;", L'<') || take(L"&gt;", L'>') || take(L"&quot;", L'"') || take(L"&apos;", L'\'')) continue;
    out.push_back(L'&');
  }
  return out;
}

inline std::optional<std::wstring> PlistUrl(std::wstring_view text) noexcept {
  size_t key = text.find(L"<key>URL</key>");
  if (key == std::wstring_view::npos) return std::nullopt;
  size_t open = text.find(L"<string>", key);
  if (open == std::wstring_view::npos) return std::nullopt;
  open += 8;
  size_t close = text.find(L"</string>", open);
  if (close == std::wstring_view::npos) return std::nullopt;
  return XmlUnescaped(text.substr(open, close - open));
}

inline std::optional<std::wstring> LinkTarget(std::wstring const &file) noexcept {
  std::optional<std::string> bytes = ReadSmallFile(file);
  if (!bytes) return std::nullopt;
  std::wstring text = DecodedText(*bytes);
  if (ExtensionOf(file) == L"url") {
    for (std::wstring_view line : Lines(text)) {
      if (Lowered(line.substr(0, 4)) == L"url=") return WebUrl(line.substr(4));
    }
    return std::nullopt;
  }
  std::optional<std::wstring> raw = PlistUrl(text);
  return raw ? WebUrl(*raw) : std::nullopt;
}

inline bool IsLinkFileExtension(std::wstring_view extension) noexcept {
  return extension == L"webloc" || extension == L"inetloc" || extension == L"url";
}

inline std::string CollapsedWords(std::wstring_view text) noexcept {
  std::wstring words;
  bool pendingSpace = false;
  for (wchar_t character : text) {
    if (IsSpace(character)) {
      pendingSpace = !words.empty();
      continue;
    }
    if (pendingSpace) words.push_back(L' ');
    pendingSpace = false;
    words.push_back(character);
  }
  if (words.size() > kMaxSearchText) {
    size_t cut = kMaxSearchText;
    if (IS_HIGH_SURROGATE(words[cut - 1])) cut--;
    words.resize(cut);
  }
  return Paths::Utf8(words);
}

inline std::vector<DroppedItem> Items(DropPayload const &payload, bool anyText) noexcept {
  std::vector<DroppedItem> items;
  if (!payload.files.empty()) {
    size_t count = std::min(payload.files.size(), kMaxItems);
    for (size_t i = 0; i < count; i++) {
      std::wstring const &file = payload.files[i];
      if (IsLinkFileExtension(ExtensionOf(file))) {
        if (std::optional<std::wstring> target = LinkTarget(file)) items.push_back({"url", Paths::Utf8(*target)});
        continue;
      }
      if (Exists(file)) items.push_back({"file", FileUrl(file)});
    }
    return items;
  }
  for (std::wstring const &raw : payload.urls) {
    if (items.size() >= kMaxItems) break;
    if (std::optional<std::wstring> url = WebUrl(raw)) items.push_back({"url", Paths::Utf8(*url)});
  }
  if (!items.empty() || !payload.text) return items;
  if (std::optional<std::wstring> candidate = HostLike(*payload.text)) {
    if (std::optional<std::wstring> url = WebUrl(*candidate)) return {{"url", Paths::Utf8(*url)}};
    return {{"text", Paths::Utf8(*candidate)}};
  }
  std::string words = CollapsedWords(*payload.text);
  if (anyText && !words.empty()) return {{"text", std::move(words)}};
  return {};
}

inline std::vector<DroppedItem> ExtensionPackages(DropPayload const &payload) noexcept {
  if (payload.files.empty() || payload.files.size() > kMaxItems) return {};
  bool allPackages = std::all_of(payload.files.begin(), payload.files.end(), [](std::wstring const &file) noexcept {
    return ExtensionOf(file) == L"crx" && IsRegularFile(file);
  });
  if (!allPackages) return {};
  std::vector<DroppedItem> items;
  for (std::wstring const &file : payload.files) items.push_back({"file", FileUrl(file)});
  return items;
}

inline std::vector<DroppedItem> ItemsFor(DropPayload const &payload, AcceptMode mode) noexcept {
  switch (mode) {
    case AcceptMode::ExtensionPackages: return ExtensionPackages(payload);
    case AcceptMode::LinksAndText: return Items(payload, true);
    default: return Items(payload, false);
  }
}

inline winrt::Microsoft::ReactNative::JSValueArray ItemsJson(std::vector<DroppedItem> const &items) noexcept {
  winrt::Microsoft::ReactNative::JSValueArray array;
  for (DroppedItem const &item : items) {
    winrt::Microsoft::ReactNative::JSValueObject object;
    object["kind"] = item.kind;
    object[item.kind == "text" ? "text" : "url"] = item.value;
    array.push_back(std::move(object));
  }
  return array;
}

inline CLIPFORMAT ClipboardFormatNamed(const wchar_t *name) noexcept {
  return static_cast<CLIPFORMAT>(RegisterClipboardFormatW(name));
}

inline std::optional<std::wstring> HGlobalText(IDataObject *data, CLIPFORMAT format, bool wide) noexcept {
  FORMATETC request{format, nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL};
  STGMEDIUM medium{};
  if (FAILED(data->GetData(&request, &medium))) return std::nullopt;
  std::optional<std::wstring> text;
  if (medium.tymed == static_cast<DWORD>(TYMED_HGLOBAL) && medium.hGlobal) {
    SIZE_T size = GlobalSize(medium.hGlobal);
    if (const void *locked = GlobalLock(medium.hGlobal)) {
      if (wide) {
        auto characters = static_cast<const wchar_t *>(locked);
        text = std::wstring(characters, wcsnlen(characters, size / sizeof(wchar_t)));
      } else {
        auto characters = static_cast<const char *>(locked);
        size_t length = strnlen(characters, size);
        int count = length ? MultiByteToWideChar(CP_ACP, 0, characters, static_cast<int>(length), nullptr, 0) : 0;
        std::wstring converted(static_cast<size_t>(count > 0 ? count : 0), L'\0');
        if (count > 0) MultiByteToWideChar(CP_ACP, 0, characters, static_cast<int>(length), converted.data(), count);
        text = std::move(converted);
      }
      GlobalUnlock(medium.hGlobal);
    }
  }
  ReleaseStgMedium(&medium);
  return text;
}

inline std::vector<std::wstring> DroppedFiles(IDataObject *data) noexcept {
  std::vector<std::wstring> files;
  FORMATETC request{static_cast<CLIPFORMAT>(CF_HDROP), nullptr, DVASPECT_CONTENT, -1, TYMED_HGLOBAL};
  STGMEDIUM medium{};
  if (FAILED(data->GetData(&request, &medium))) return files;
  if (medium.tymed == static_cast<DWORD>(TYMED_HGLOBAL) && medium.hGlobal) {
    auto drop = static_cast<HDROP>(medium.hGlobal);
    UINT count = DragQueryFileW(drop, 0xFFFFFFFF, nullptr, 0);
    for (UINT i = 0; i < count && files.size() < kMaxDroppedFiles; i++) {
      UINT length = DragQueryFileW(drop, i, nullptr, 0);
      if (length == 0) continue;
      std::wstring path(static_cast<size_t>(length) + 1, L'\0');
      UINT copied = DragQueryFileW(drop, i, path.data(), length + 1);
      path.resize(copied);
      if (!path.empty()) files.push_back(std::move(path));
    }
  }
  ReleaseStgMedium(&medium);
  return files;
}

inline DropPayload PayloadFrom(IDataObject *data) noexcept {
  DropPayload payload;
  if (!data) return payload;
  try {
    payload.files = DroppedFiles(data);
    std::optional<std::wstring> url = HGlobalText(data, ClipboardFormatNamed(L"UniformResourceLocatorW"), true);
    if (!url) url = HGlobalText(data, ClipboardFormatNamed(L"UniformResourceLocator"), false);
    if (url && !url->empty()) payload.urls.push_back(*url);
    payload.text = HGlobalText(data, static_cast<CLIPFORMAT>(CF_UNICODETEXT), true);
    if (!payload.text) payload.text = HGlobalText(data, static_cast<CLIPFORMAT>(CF_TEXT), false);
  } catch (...) {
  }
  return payload;
}

}
