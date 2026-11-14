#pragma once

#include <array>
#include <cstdint>
#include <cstring>
#include <initializer_list>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <bcrypt.h>
#include <wincrypt.h>

namespace Ardia::SyncCrypto {

class WipedBytes {
 public:
  WipedBytes() = default;
  explicit WipedBytes(size_t size) : m_bytes(size) {}
  WipedBytes(uint8_t const *data, size_t size) : m_bytes(data, data + size) {}
  WipedBytes(WipedBytes const &) = delete;
  WipedBytes &operator=(WipedBytes const &) = delete;
  WipedBytes(WipedBytes &&other) noexcept : m_bytes(std::move(other.m_bytes)) { other.m_bytes.clear(); }
  WipedBytes &operator=(WipedBytes &&other) noexcept {
    if (this != &other) {
      Wipe();
      m_bytes = std::move(other.m_bytes);
      other.m_bytes.clear();
    }
    return *this;
  }
  ~WipedBytes() { Wipe(); }

  void Wipe() noexcept {
    if (!m_bytes.empty()) SecureZeroMemory(m_bytes.data(), m_bytes.size());
    m_bytes.clear();
  }

  uint8_t *data() noexcept { return m_bytes.data(); }
  uint8_t const *data() const noexcept { return m_bytes.data(); }
  size_t size() const noexcept { return m_bytes.size(); }
  bool empty() const noexcept { return m_bytes.empty(); }
  std::string_view view() const noexcept { return {reinterpret_cast<char const *>(m_bytes.data()), m_bytes.size()}; }

 private:
  std::vector<uint8_t> m_bytes;
};

inline void WipeString(std::string &text) noexcept {
  if (text.capacity()) {
    text.resize(text.capacity());
    SecureZeroMemory(text.data(), text.size());
  }
  text.clear();
}

class WipedString {
 public:
  WipedString() = default;
  explicit WipedString(std::string &&text) noexcept : m_text(std::move(text)) { WipeString(text); }
  WipedString(WipedString const &) = delete;
  WipedString &operator=(WipedString const &) = delete;
  WipedString(WipedString &&other) noexcept : m_text(std::move(other.m_text)) { WipeString(other.m_text); }
  ~WipedString() { WipeString(m_text); }

  std::string &text() noexcept { return m_text; }
  std::string const &text() const noexcept { return m_text; }

 private:
  std::string m_text;
};

constexpr size_t KeyBytes = 32;
constexpr size_t NonceBytes = 12;
constexpr size_t TagBytes = 16;
constexpr size_t FilePadding = 1024;
constexpr size_t PasswordPadding = 32;
constexpr uint8_t PasswordVersion = 1;
constexpr std::string_view Magic = "NNS1";
constexpr std::string_view Salt = "netnyahoo-sync/v1";
constexpr std::string_view Base32Alphabet = "abcdefghijklmnopqrstuvwxyz234567";

inline std::string_view Bytes(void const *data, size_t size) noexcept { return {static_cast<char const *>(data), size}; }

inline PUCHAR Writable(std::string_view bytes) noexcept { return reinterpret_cast<PUCHAR>(const_cast<char *>(bytes.data())); }

inline bool RandomBytes(uint8_t *out, size_t size) noexcept {
  return BCryptGenRandom(nullptr, out, static_cast<ULONG>(size), BCRYPT_USE_SYSTEM_PREFERRED_RNG) == 0;
}

inline std::optional<std::array<uint8_t, 32>> Sha256(std::string_view data) noexcept {
  std::array<uint8_t, 32> out{};
  if (BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0, Writable(data), static_cast<ULONG>(data.size()), out.data(), 32) != 0) return std::nullopt;
  return out;
}

inline bool Hmac(std::string_view key, std::initializer_list<std::string_view> parts, uint8_t *out) noexcept {
  BCRYPT_HASH_HANDLE hash = nullptr;
  if (BCryptCreateHash(BCRYPT_HMAC_SHA256_ALG_HANDLE, &hash, nullptr, 0, Writable(key), static_cast<ULONG>(key.size()), 0) != 0) return false;
  bool ok = true;
  for (std::string_view part : parts) ok = ok && BCryptHashData(hash, Writable(part), static_cast<ULONG>(part.size()), 0) == 0;
  ok = ok && BCryptFinishHash(hash, out, 32, 0) == 0;
  BCryptDestroyHash(hash);
  return ok;
}

inline WipedBytes Hkdf32(std::string_view input, std::string_view salt, std::string_view info) noexcept {
  WipedBytes prk(32);
  WipedBytes okm(32);
  uint8_t counter = 1;
  if (!Hmac(salt, {input}, prk.data()) || !Hmac(prk.view(), {info, Bytes(&counter, 1)}, okm.data())) return WipedBytes{};
  return okm;
}

inline std::string BigEndian32(size_t value) {
  uint32_t n = static_cast<uint32_t>(value);
  char out[4] = {static_cast<char>(n >> 24), static_cast<char>(n >> 16), static_cast<char>(n >> 8), static_cast<char>(n)};
  return std::string(out, 4);
}

inline std::string Base32(uint8_t const *data, size_t size) {
  std::string out;
  uint32_t buffer = 0;
  int bits = 0;
  for (size_t i = 0; i < size; i++) {
    buffer = (buffer << 8) | data[i];
    bits += 8;
    while (bits >= 5) {
      out.push_back(Base32Alphabet[(buffer >> (bits - 5)) & 31]);
      bits -= 5;
    }
    buffer &= (1u << bits) - 1;
  }
  if (bits > 0) out.push_back(Base32Alphabet[(buffer << (5 - bits)) & 31]);
  return out;
}

inline bool IsTag(std::string_view name) noexcept {
  if (name.size() != 26) return false;
  for (char c : name) {
    if (Base32Alphabet.find(c) == std::string_view::npos) return false;
  }
  return true;
}

inline std::string Base64(std::string_view bytes) {
  if (bytes.empty()) return {};
  DWORD size = 0;
  DWORD flags = CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF;
  if (!CryptBinaryToStringA(reinterpret_cast<BYTE const *>(bytes.data()), static_cast<DWORD>(bytes.size()), flags, nullptr, &size)) return {};
  std::string out(size, '\0');
  if (!CryptBinaryToStringA(reinterpret_cast<BYTE const *>(bytes.data()), static_cast<DWORD>(bytes.size()), flags, out.data(), &size)) return {};
  out.resize(size);
  while (!out.empty() && (out.back() == '\0' || out.back() == '\r' || out.back() == '\n')) out.pop_back();
  return out;
}

inline std::optional<WipedBytes> FromBase64(std::string_view text) noexcept {
  if (text.empty()) return WipedBytes{};
  DWORD size = 0;
  if (!CryptStringToBinaryA(text.data(), static_cast<DWORD>(text.size()), CRYPT_STRING_BASE64, nullptr, &size, nullptr, nullptr)) return std::nullopt;
  WipedBytes out(size);
  if (!CryptStringToBinaryA(text.data(), static_cast<DWORD>(text.size()), CRYPT_STRING_BASE64, out.data(), &size, nullptr, nullptr)) return std::nullopt;
  if (size != out.size()) return std::nullopt;
  return std::move(out);
}

inline bool Gcm(bool sealing, std::string_view key, std::string_view nonce, std::string_view aad, uint8_t *data, size_t size, uint8_t *tag) noexcept {
  BCRYPT_KEY_HANDLE handle = nullptr;
  if (BCryptGenerateSymmetricKey(BCRYPT_AES_GCM_ALG_HANDLE, &handle, nullptr, 0, Writable(key), static_cast<ULONG>(key.size()), 0) != 0) return false;
  BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
  BCRYPT_INIT_AUTH_MODE_INFO(info);
  info.pbNonce = Writable(nonce);
  info.cbNonce = static_cast<ULONG>(nonce.size());
  info.pbAuthData = Writable(aad);
  info.cbAuthData = static_cast<ULONG>(aad.size());
  info.pbTag = tag;
  info.cbTag = static_cast<ULONG>(TagBytes);
  ULONG done = 0;
  NTSTATUS status = sealing ? BCryptEncrypt(handle, data, static_cast<ULONG>(size), &info, nullptr, 0, data, static_cast<ULONG>(size), &done, 0)
                            : BCryptDecrypt(handle, data, static_cast<ULONG>(size), &info, nullptr, 0, data, static_cast<ULONG>(size), &done, 0);
  BCryptDestroyKey(handle);
  return status == 0 && done == size;
}

inline WipedBytes Padded(std::string_view payload, size_t block) {
  size_t length = 4 + payload.size();
  WipedBytes plain(length + (block - length % block) % block);
  std::string prefix = BigEndian32(payload.size());
  memcpy(plain.data(), prefix.data(), 4);
  if (!payload.empty()) memcpy(plain.data() + 4, payload.data(), payload.size());
  return plain;
}

inline std::optional<WipedBytes> Unpadded(WipedBytes const &plain) {
  if (plain.size() < 4) return std::nullopt;
  uint8_t const *p = plain.data();
  size_t length = (size_t{p[0]} << 24) | (size_t{p[1]} << 16) | (size_t{p[2]} << 8) | size_t{p[3]};
  if (length > plain.size() - 4) return std::nullopt;
  return WipedBytes(p + 4, length);
}

inline std::optional<WipedBytes> OpenBox(std::string_view key, std::string_view box, std::string_view aad) {
  if (box.size() < NonceBytes + TagBytes) return std::nullopt;
  std::string_view nonce = box.substr(0, NonceBytes);
  std::string_view cipher = box.substr(NonceBytes, box.size() - NonceBytes - TagBytes);
  std::array<uint8_t, TagBytes> tag{};
  memcpy(tag.data(), box.data() + box.size() - TagBytes, TagBytes);
  WipedBytes plain(reinterpret_cast<uint8_t const *>(cipher.data()), cipher.size());
  if (!Gcm(false, key, nonce, aad, plain.data(), plain.size(), tag.data())) return std::nullopt;
  return std::move(plain);
}

inline bool IsUtf8(std::string_view text) noexcept {
  return text.empty() || MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0) > 0;
}

class Keys {
 public:
  static std::optional<Keys> Derive(std::string_view entropy) {
    if (entropy.size() != KeyBytes) return std::nullopt;
    Keys keys;
    keys.m_file = Hkdf32(entropy, Salt, "file-key");
    keys.m_name = Hkdf32(entropy, Salt, "name-key");
    keys.m_password = Hkdf32(entropy, Salt, "password-key");
    keys.m_passwordNonce = Hkdf32(entropy, Salt, "password-nonce-key");
    if (keys.m_file.empty() || keys.m_name.empty() || keys.m_password.empty() || keys.m_passwordNonce.empty()) return std::nullopt;
    std::optional<std::string> chain = keys.Tag("chain");
    if (!chain) return std::nullopt;
    keys.m_chainTag = *chain;
    return std::move(keys);
  }

  std::string const &ChainTag() const noexcept { return m_chainTag; }

  std::optional<std::string> Tag(std::string_view label) const {
    uint8_t mac[32];
    if (!Hmac(m_name.view(), {label}, mac)) return std::nullopt;
    std::string tag = Base32(mac, 16);
    SecureZeroMemory(mac, sizeof(mac));
    return tag;
  }

  std::optional<std::string> ScopeTag(std::string_view scope) const { return Tag(std::string{"scope/"} + std::string{scope}); }

  std::string FileAad(std::string_view scopeTag, std::string_view fileId) const {
    return std::string{Magic} + m_chainTag + "/" + std::string{scopeTag} + "/" + std::string{fileId};
  }

  std::optional<std::string> Seal(std::string_view payload, std::string_view scopeTag, std::string_view fileId) const {
    WipedBytes plain = Padded(payload, FilePadding);
    std::array<uint8_t, NonceBytes> nonce{};
    std::array<uint8_t, TagBytes> tag{};
    if (!RandomBytes(nonce.data(), nonce.size())) return std::nullopt;
    if (!Gcm(true, m_file.view(), Bytes(nonce.data(), nonce.size()), FileAad(scopeTag, fileId), plain.data(), plain.size(), tag.data())) return std::nullopt;
    std::string file;
    file.reserve(Magic.size() + NonceBytes + plain.size() + TagBytes);
    file.append(Magic).append(Bytes(nonce.data(), nonce.size())).append(plain.view()).append(Bytes(tag.data(), tag.size()));
    return file;
  }

  std::optional<WipedBytes> Open(std::string_view file, std::string_view scopeTag, std::string_view fileId) const {
    if (file.size() < Magic.size() + NonceBytes + TagBytes + 4 || file.substr(0, Magic.size()) != Magic) return std::nullopt;
    std::optional<WipedBytes> plain = OpenBox(m_file.view(), file.substr(Magic.size()), FileAad(scopeTag, fileId));
    if (!plain) return std::nullopt;
    return Unpadded(*plain);
  }

  static std::string PasswordAad(std::string_view origin, std::string_view username) {
    return std::string{Magic} + "password/" + BigEndian32(origin.size()) + std::string{origin} + std::string{username};
  }

  std::optional<std::string> SealPassword(std::string_view password, std::string_view origin, std::string_view username) const {
    WipedBytes plain = Padded(password, PasswordPadding);
    std::string aad = PasswordAad(origin, username);
    uint8_t synthetic[32];
    if (!Hmac(m_passwordNonce.view(), {BigEndian32(aad.size()), aad, plain.view()}, synthetic)) return std::nullopt;
    std::array<uint8_t, TagBytes> tag{};
    std::string_view nonce = Bytes(synthetic, NonceBytes);
    if (!Gcm(true, m_password.view(), nonce, aad, plain.data(), plain.size(), tag.data())) return std::nullopt;
    std::string sealed;
    sealed.reserve(1 + NonceBytes + plain.size() + TagBytes);
    sealed.push_back(static_cast<char>(PasswordVersion));
    sealed.append(nonce).append(plain.view()).append(Bytes(tag.data(), tag.size()));
    SecureZeroMemory(synthetic, sizeof(synthetic));
    return Base64(sealed);
  }

  std::optional<WipedBytes> OpenPassword(std::string_view sealed, std::string_view origin, std::string_view username) const {
    std::optional<WipedBytes> data = FromBase64(sealed);
    if (!data || data->size() < 1 + NonceBytes + TagBytes + 4 || data->data()[0] != PasswordVersion) return std::nullopt;
    std::optional<WipedBytes> plain = OpenBox(m_password.view(), data->view().substr(1), PasswordAad(origin, username));
    if (!plain) return std::nullopt;
    std::optional<WipedBytes> password = Unpadded(*plain);
    if (!password || !IsUtf8(password->view())) return std::nullopt;
    return password;
  }

 private:
  Keys() = default;

  WipedBytes m_file;
  WipedBytes m_name;
  WipedBytes m_password;
  WipedBytes m_passwordNonce;
  std::string m_chainTag;
};

}
