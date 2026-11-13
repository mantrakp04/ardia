#pragma once

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include <shlobj.h>
#include <winrt/Windows.Data.Pdf.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Storage.Streams.h>

#include "NativeModules.h"

#include "EngineApi.h"
#include "Events.h"
#include "Host.h"
#include "Paths.h"
#include "SyncCrypto.h"
#include "SyncLogins.h"

namespace Ardia::SyncSystem {

using SyncCrypto::WipedString;
using Answer = std::function<void(std::shared_ptr<WipedString>)>;

struct EngineReply {
  Answer done;
};

inline void OnEngineReply(void *context, const char *json) noexcept {
  std::unique_ptr<EngineReply> reply{static_cast<EngineReply *>(context)};
  if (!reply) return;
  auto text = std::make_shared<WipedString>(std::string{json ? json : ""});
  try {
    reply->done(text);
  } catch (...) {
  }
}

inline void CallEngine(winrt::Microsoft::ReactNative::ReactContext const &context, std::string name, std::string profile, std::shared_ptr<WipedString> args, Answer done) noexcept {
  RunOnUI(context, [name = std::move(name), profile = std::move(profile), args, done]() noexcept {
    const ArdiaEngineApi *engine = Host::Engine();
    if (!engine) return done(nullptr);
    engine->engineCall(name.c_str(), profile.c_str(), args->text().c_str(), &OnEngineReply, new EngineReply{done});
  });
}

inline bool Succeeded(std::shared_ptr<WipedString> const &reply) {
  if (!reply) return false;
  std::optional<SyncLogins::Node> root = SyncLogins::Reader(reply->text()).Document();
  return root && root->kind == SyncLogins::Node::Kind::Object && !SyncLogins::Member(*root, "error");
}

inline std::shared_ptr<WipedString> LoginArgs(std::string_view origin, std::string_view username, std::string_view password, bool withPassword) {
  auto args = std::make_shared<WipedString>();
  std::string &out = args->text();
  out = "{\"origin\":";
  SyncLogins::Quote(out, origin);
  out += ",\"username\":";
  SyncLogins::Quote(out, username);
  if (withPassword) {
    out += ",\"password\":";
    SyncLogins::Quote(out, password);
  }
  out += "}";
  return args;
}

inline std::shared_ptr<WipedString> SavedPassword(std::shared_ptr<WipedString> const &reply, std::string const &origin, std::string const &username) {
  if (!reply) return nullptr;
  std::string_view text = reply->text();
  std::optional<SyncLogins::Node> root = SyncLogins::Reader(text).Document();
  if (!root || root->kind != SyncLogins::Node::Kind::Object) return nullptr;
  SyncLogins::Node const *logins = SyncLogins::Member(*root, "logins");
  if (!logins || logins->kind != SyncLogins::Node::Kind::Array) return nullptr;
  for (SyncLogins::Node const &login : logins->items) {
    if (login.kind != SyncLogins::Node::Kind::Object) continue;
    SyncLogins::Node const *realm = SyncLogins::Member(login, "realm");
    SyncLogins::Node const *user = SyncLogins::Member(login, "username");
    SyncLogins::Node const *password = SyncLogins::Member(login, "password");
    if (!realm || !user || !password) continue;
    auto realmText = SyncLogins::Reader::Decoded(text, *realm);
    auto userText = SyncLogins::Reader::Decoded(text, *user);
    if (!realmText || !userText || userText->text() != username) continue;
    std::optional<std::string> loginOrigin = SyncLogins::LoginOrigin(realmText->text());
    if (!loginOrigin || *loginOrigin != origin) continue;
    auto found = SyncLogins::Reader::Decoded(text, *password);
    if (found) return std::make_shared<WipedString>(std::move(found->text()));
  }
  return nullptr;
}

inline void ReplacePassword(winrt::Microsoft::ReactNative::ReactContext const &context, std::string profile, std::string origin, std::string username, std::shared_ptr<WipedString> password,
                            std::function<void(bool)> done) {
  CallEngine(context, "ac_passwords_logins", profile, std::make_shared<WipedString>(std::string{"{}"}), [=](std::shared_ptr<WipedString> logins) {
    if (!logins) return done(false);
    std::shared_ptr<WipedString> previous = SavedPassword(logins, origin, username);
    logins->text().clear();
    CallEngine(context, "ac_passwords_remove", profile, LoginArgs(origin, username, {}, false), [=](std::shared_ptr<WipedString> removed) {
      if (!Succeeded(removed)) return done(false);
      CallEngine(context, "ac_passwords_add", profile, LoginArgs(origin, username, password->text(), true), [=](std::shared_ptr<WipedString> added) {
        if (Succeeded(added)) return done(true);
        if (!previous) return done(false);
        CallEngine(context, "ac_passwords_add", profile, LoginArgs(origin, username, previous->text(), true), [=](std::shared_ptr<WipedString>) { done(false); });
      });
    });
  });
}

inline void AddPassword(winrt::Microsoft::ReactNative::ReactContext const &context, std::string profile, std::string origin, std::string username, std::shared_ptr<WipedString> password,
                        std::function<void(bool)> done) {
  CallEngine(context, "ac_passwords_add", profile, LoginArgs(origin, username, password->text(), true), [done](std::shared_ptr<WipedString> added) { done(Succeeded(added)); });
}

inline UINT Format(wchar_t const *name) noexcept { return RegisterClipboardFormatW(name); }

inline bool PutGlobal(UINT format, void const *data, size_t size) noexcept {
  HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, size);
  if (!memory) return false;
  void *target = GlobalLock(memory);
  if (!target) {
    GlobalFree(memory);
    return false;
  }
  memcpy(target, data, size);
  GlobalUnlock(memory);
  if (SetClipboardData(format, memory)) return true;
  GlobalFree(memory);
  return false;
}

inline bool CopyConcealedText(HWND owner, std::string_view text) noexcept {
  std::wstring wide = Paths::Wide(text);
  if (!OpenClipboard(owner)) return false;
  bool ok = EmptyClipboard() != FALSE;
  DWORD no = 0;
  ok = ok && PutGlobal(CF_UNICODETEXT, wide.c_str(), (wide.size() + 1) * sizeof(wchar_t));
  ok = ok && PutGlobal(Format(L"ExcludeClipboardContentFromMonitorProcessing"), &no, sizeof(no));
  ok = ok && PutGlobal(Format(L"CanIncludeInClipboardHistory"), &no, sizeof(no));
  ok = ok && PutGlobal(Format(L"CanUploadToCloudClipboard"), &no, sizeof(no));
  CloseClipboard();
  SecureZeroMemory(wide.data(), wide.size() * sizeof(wchar_t));
  return ok;
}

inline bool CopyFileItem(HWND owner, std::wstring const &path) noexcept {
  std::vector<BYTE> drop(sizeof(DROPFILES) + (path.size() + 2) * sizeof(wchar_t), 0);
  auto *header = reinterpret_cast<DROPFILES *>(drop.data());
  header->pFiles = sizeof(DROPFILES);
  header->fWide = TRUE;
  memcpy(drop.data() + sizeof(DROPFILES), path.c_str(), path.size() * sizeof(wchar_t));
  DWORD effect = DROPEFFECT_COPY;
  if (!OpenClipboard(owner)) return false;
  bool ok = EmptyClipboard() && PutGlobal(CF_HDROP, drop.data(), drop.size()) && PutGlobal(Format(CFSTR_PREFERREDDROPEFFECT), &effect, sizeof(effect));
  CloseClipboard();
  return ok;
}

inline std::optional<std::string> RenderPdfPage(std::string_view pdf, double width, double scale) noexcept {
  try {
    using namespace winrt::Windows::Storage::Streams;
    using namespace winrt::Windows::Data::Pdf;
    InMemoryRandomAccessStream input;
    DataWriter writer(input);
    writer.WriteBytes(winrt::array_view<uint8_t const>(reinterpret_cast<uint8_t const *>(pdf.data()), static_cast<uint32_t>(pdf.size())));
    writer.StoreAsync().get();
    writer.DetachStream();
    input.Seek(0);
    PdfDocument document = PdfDocument::LoadFromStreamAsync(input).get();
    if (document.PageCount() == 0) return std::nullopt;
    PdfPage page = document.GetPage(0);
    PdfPageRenderOptions options;
    options.DestinationWidth(static_cast<uint32_t>(width * scale));
    options.BitmapEncoderId(winrt::Windows::Graphics::Imaging::BitmapEncoder::PngEncoderId());
    InMemoryRandomAccessStream output;
    page.RenderToStreamAsync(output, options).get();
    uint32_t size = static_cast<uint32_t>(output.Size());
    output.Seek(0);
    DataReader reader(output);
    reader.LoadAsync(size).get();
    std::string png(size, '\0');
    reader.ReadBytes(winrt::array_view<uint8_t>(reinterpret_cast<uint8_t *>(png.data()), size));
    return "data:image/png;base64," + SyncCrypto::Base64(png);
  } catch (...) {
    return std::nullopt;
  }
}

inline std::string ComputerName() noexcept {
  wchar_t name[256]{};
  DWORD size = 256;
  if (GetComputerNameExW(ComputerNamePhysicalDnsHostname, name, &size) && size) return Paths::Utf8(std::wstring_view{name, size});
  return "This PC";
}

inline std::string OneDriveFolder() noexcept {
  for (wchar_t const *variable : {L"OneDrive", L"OneDriveConsumer", L"OneDriveCommercial"}) {
    std::wstring folder = Paths::Environment(variable);
    DWORD attributes = folder.empty() ? INVALID_FILE_ATTRIBUTES : GetFileAttributesW(folder.c_str());
    if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & FILE_ATTRIBUTE_DIRECTORY)) return Paths::Utf8(folder);
  }
  return {};
}

inline std::string DocumentsFolder() noexcept {
  try {
    return Paths::Utf8(Paths::KnownFolder(FOLDERID_Documents).wstring());
  } catch (...) {
    return {};
  }
}

inline std::wstring KitFolder() {
  wchar_t temp[MAX_PATH + 1]{};
  DWORD size = GetTempPathW(MAX_PATH, temp);
  std::wstring base = size ? std::wstring{temp, size} : std::wstring{};
  while (!base.empty() && (base.back() == L'\\' || base.back() == L'/')) base.pop_back();
  return base + L"\\Ardia Recovery Kit";
}

}
