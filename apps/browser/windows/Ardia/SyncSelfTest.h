#pragma once

#include <array>
#include <optional>
#include <string>
#include <variant>

#include "NativeModules.h"

#include "SyncCrypto.h"
#include "SyncLogins.h"
#include "SyncPhrase.h"
#include "SyncSecrets.h"
#include "SyncHandles.h"
#include "SyncVault.h"

namespace Ardia::SyncSelfTest {

using SyncCrypto::Keys;
using SyncCrypto::WipedBytes;

inline std::string Hex(uint8_t const *data, size_t size) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string out;
  for (size_t i = 0; i < size; i++) {
    out.push_back(digits[data[i] >> 4]);
    out.push_back(digits[data[i] & 15]);
  }
  return out;
}

inline bool GcmKnownAnswer() {
  std::string key(32, '\0');
  std::string nonce(12, '\0');
  std::array<uint8_t, 16> block{};
  std::array<uint8_t, 16> tag{};
  if (!SyncCrypto::Gcm(true, key, nonce, {}, block.data(), block.size(), tag.data())) return false;
  bool sealed = Hex(block.data(), 16) == "cea7403d4d606b6e074ec5d3baf39d18" && Hex(tag.data(), 16) == "d0d1c8a799996bf0265b98b5d48ab919";
  std::array<uint8_t, 16> copy = block;
  std::array<uint8_t, 16> bent = tag;
  bent[0] ^= 1;
  bool refused = !SyncCrypto::Gcm(false, key, nonce, {}, copy.data(), copy.size(), bent.data());
  bool opened = SyncCrypto::Gcm(false, key, nonce, {}, block.data(), block.size(), tag.data()) && block == std::array<uint8_t, 16>{};
  return sealed && refused && opened;
}

inline bool KdfKnownAnswer() {
  std::string ikm(22, '\x0b');
  std::string salt;
  for (int i = 0; i <= 12; i++) salt.push_back(static_cast<char>(i));
  std::string info;
  for (int i = 0xf0; i <= 0xf9; i++) info.push_back(static_cast<char>(i));
  WipedBytes okm = SyncCrypto::Hkdf32(ikm, salt, info);
  return !okm.empty() && Hex(okm.data(), okm.size()) == "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf";
}

inline bool HmacKnownAnswer() {
  uint8_t mac[32];
  return SyncCrypto::Hmac("Jefe", {"what do ya want ", "for nothing?"}, mac) && Hex(mac, 32) == "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";
}

inline std::optional<Keys> ZeroKeys() { return Keys::Derive(std::string(32, '\0')); }

inline bool TagsKnownAnswer() {
  std::optional<Keys> keys = ZeroKeys();
  return keys && keys->ChainTag() == "gbcx4r55mk3rlaegbggknyx4ta" && keys->ScopeTag("app") == std::optional<std::string>{"nr4ncp5iyqzqgjn6ol4zksqtne"};
}

inline std::string Repeated(std::string const &word, size_t times, std::string const &last) {
  std::string out;
  for (size_t i = 0; i < times; i++) out += word + " ";
  return out + last;
}

inline bool WordsKnownAnswer() {
  WipedBytes zero(32);
  std::optional<std::vector<std::string>> words = SyncPhrase::Words(zero);
  if (!words || words->size() != 24 || words->front() != "abandon" || words->back() != "art") return false;
  auto parsed = SyncPhrase::Entropy("ABANDON, " + Repeated("aban", 22, "art"));
  bool decoded = std::holds_alternative<WipedBytes>(parsed) && std::get<WipedBytes>(parsed).view() == zero.view();
  auto checksum = SyncPhrase::Entropy(Repeated("abandon", 23, "abandon"));
  auto unknown = SyncPhrase::Entropy(Repeated("abandon", 23, "zzzz"));
  auto count = SyncPhrase::Entropy("abandon art");
  bool problems = std::holds_alternative<SyncPhrase::Problem>(checksum) && std::get<SyncPhrase::Problem>(checksum).error == "checksum" &&
      std::holds_alternative<SyncPhrase::Problem>(unknown) && std::get<SyncPhrase::Problem>(unknown).word == "zzzz" &&
      std::holds_alternative<SyncPhrase::Problem>(count) && std::get<SyncPhrase::Problem>(count).count == 2;
  WipedBytes full(32);
  memset(full.data(), 0xff, 32);
  std::optional<std::vector<std::string>> zoo = SyncPhrase::Words(full);
  return decoded && problems && zoo && zoo->front() == "zoo" && zoo->back() == "vote";
}

inline bool PaddingRoundTrips() {
  std::optional<Keys> keys = ZeroKeys();
  if (!keys) return false;
  for (size_t size : {size_t{0}, size_t{1}, size_t{1019}, size_t{1020}, size_t{1021}, size_t{2048}}) {
    std::string payload(size, 'x');
    std::optional<std::string> file = keys->Seal(payload, "scope", "file");
    if (!file || (file->size() - 32) % 1024 != 0) return false;
    std::optional<WipedBytes> back = keys->Open(*file, "scope", "file");
    if (!back || back->view() != payload) return false;
    std::string bent = *file;
    bent[bent.size() / 2] ^= 1;
    if (keys->Open(bent, "scope", "file") || keys->Open(*file, "scope", "other")) return false;
  }
  for (size_t size : {size_t{0}, size_t{27}, size_t{28}, size_t{29}}) {
    std::string password(size, 'p');
    std::optional<std::string> sealed = keys->SealPassword(password, "https://\xc3\xbcn\xc3\xaf" "code.example", "ada\xf0\x9f\x94\x91");
    if (!sealed || sealed != keys->SealPassword(password, "https://\xc3\xbcn\xc3\xaf" "code.example", "ada\xf0\x9f\x94\x91")) return false;
    std::optional<WipedBytes> opened = keys->OpenPassword(*sealed, "https://\xc3\xbcn\xc3\xaf" "code.example", "ada\xf0\x9f\x94\x91");
    if (!opened || opened->view() != password || keys->OpenPassword(*sealed, "https://unicode.example", "ada\xf0\x9f\x94\x91")) return false;
  }
  return true;
}

inline bool LoginsStayHidden() {
  std::optional<Keys> keys = ZeroKeys();
  if (!keys) return false;
  std::string document = R"({"records":{"pw:1":{"k":"pw:1","v":{"o":"https://a.example","u":"ada","p":"correct horse","n":1731500000000123}}},)"
                         R"("pw:2":{"v":{"o":"https://b.example","u":"grace","p":"battery staple"}},"pw:3":"gone","list":[{"k":"pw:4","v":{"o":5,"p":"stays secret"}}],)"
                         R"("note":"\ud800 lone"})";
  std::optional<std::string> hidden = SyncLogins::Hide(document, *keys);
  if (!hidden) return false;
  for (std::string_view secret : {"correct horse", "battery staple", "stays secret", "gone"}) {
    if (hidden->find(secret) != std::string::npos) return false;
  }
  if (hidden->find("1731500000000123") == std::string::npos) return false;
  std::optional<SyncCrypto::WipedString> restored = SyncLogins::Restore(*hidden, *keys);
  return restored && restored->text().find("correct horse") != std::string::npos && restored->text().find("battery staple") != std::string::npos &&
      restored->text().find("\"s\":") == std::string::npos && !SyncLogins::Hide("{\"pw:1\":{\"v\":{\"o\":\"x\",\"u\":\"y\",\"p\":", *keys);
}

inline std::string FileSteps(std::string const &folder) {
  std::string report = "{";
  auto note = [&report](char const *key, std::string const &value) {
    if (report.size() > 1) report += ",";
    report += std::string{"\""} + key + "\":" + SyncFiles::Quoted(value);
  };
  std::wstring root = Paths::Wide(folder);
  CreateDirectoryW(root.c_str(), nullptr);
  SyncHandles::OpenedFolder held = SyncHandles::OpenRoot(root);
  note("root", std::to_string(static_cast<int>(held.state)));
  if (held.state != SyncHandles::Folder::Directory) return report + "}";
  SyncHandles::OpenedFolder scope = SyncHandles::OpenFolderAt(held.handle.get(), L"scope", true);
  note("scope", std::to_string(static_cast<int>(scope.state)));
  if (scope.state != SyncHandles::Folder::Directory) return report + "}";
  std::wstring name = L"aaaaaaaaaaaaaaaaaaaaaaaaaa.nns";
  try {
    SyncHandles::PublishAt(scope.handle.get(), name, "hello");
    note("publish", "ok");
  } catch (SyncFiles::Failure const &failure) {
    note("publish", failure.message);
  }
  note("inScope", GetFileAttributesW((root + L"\\scope\\" + name).c_str()) != INVALID_FILE_ATTRIBUTES ? "yes" : "no");
  note("inWorkingFolder", GetFileAttributesW(name.c_str()) != INVALID_FILE_ATTRIBUTES ? "yes" : "no");
  try {
    note("list", SyncHandles::ListJson(scope.handle.get()));
  } catch (SyncFiles::Failure const &failure) {
    note("list", failure.message);
  }
  try {
    SyncFiles::Read read = SyncHandles::ReadAt(scope.handle.get(), name);
    note("read", std::to_string(static_cast<int>(read.state)) + ":" + read.bytes);
    note("remove", SyncHandles::RemoveAt(scope.handle.get(), name));
  } catch (SyncFiles::Failure const &failure) {
    note("read", failure.message);
  }
  note("afterRemove", GetFileAttributesW((root + L"\\scope\\" + name).c_str()) != INVALID_FILE_ATTRIBUTES ? "present" : "gone");
  scope.handle = SyncHandles::Handle{};
  note("removeFolder", SyncHandles::RemoveFolderAt(held.handle.get(), L"scope") ? "ok" : "failed");
  return report + "}";
}

inline winrt::Microsoft::ReactNative::JSValue Primitives() {
  winrt::Microsoft::ReactNative::JSValueObject report;
  report["aead"] = GcmKnownAnswer();
  report["kdf"] = KdfKnownAnswer();
  report["hmac"] = HmacKnownAnswer();
  report["tags"] = TagsKnownAnswer();
  report["words"] = WordsKnownAnswer();
  report["padding"] = PaddingRoundTrips();
  report["logins"] = LoginsStayHidden();
  report["protectedStorage"] = SyncSecrets::ProtectedStorageRoundTrip();
  return winrt::Microsoft::ReactNative::JSValue{std::move(report)};
}

inline std::optional<std::string> With(std::string const &entropyHex, std::string const &action, std::string const &first, std::string const &second, std::string const &third) {
  std::optional<WipedBytes> entropy = SyncVault::FromHex(entropyHex);
  if (!entropy) return std::nullopt;
  std::optional<Keys> keys = Keys::Derive(entropy->view());
  if (!keys) return std::nullopt;
  if (action == "chainTag") return keys->ChainTag();
  if (action == "scopeTag") return keys->ScopeTag(first);
  if (action == "sealPassword") return keys->SealPassword(first, second, third);
  if (action == "words") {
    std::optional<std::vector<std::string>> words = SyncPhrase::Words(*entropy);
    if (!words) return std::nullopt;
    std::string joined;
    for (std::string const &word : *words) joined += (joined.empty() ? "" : " ") + word;
    return joined;
  }
  if (action == "open" || action == "openLocal") {
    std::optional<WipedBytes> file = SyncCrypto::FromBase64(action == "open" ? third : first);
    if (!file) return std::nullopt;
    std::optional<std::string> tag = action == "open" ? keys->ScopeTag(first) : std::optional<std::string>{"local"};
    SyncVault::Opened opened = SyncVault::OpenSealed(*keys, *tag, action == "open" ? second : "state", file->view());
    return opened.state == "data" ? opened.payload : opened.state + ":";
  }
  if (action == "seal") {
    std::optional<std::string> tag = keys->ScopeTag(first);
    if (!tag) return std::nullopt;
    return SyncCrypto::Base64(SyncVault::SealForVault(*keys, *tag, second, third));
  }
  return std::nullopt;
}

}
