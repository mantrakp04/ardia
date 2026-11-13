#pragma once

#include <array>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "ImportFiles.h"
#include "ImportSecrets.h"

namespace Ardia {

namespace ImportNss {

using ImportSecrets::Wiped;

inline constexpr std::string_view kOidPbes2 = "1.2.840.113549.1.5.13";
inline constexpr std::string_view kOidPbkdf2 = "1.2.840.113549.1.5.12";
inline constexpr std::string_view kOidSha1And3Des = "1.2.840.113549.1.12.5.1.3";
inline constexpr std::string_view kOidAes256Cbc = "2.16.840.1.101.3.4.1.42";
inline constexpr std::string_view kOid3DesCbc = "1.2.840.113549.3.7";
inline constexpr std::string_view kPasswordCheck = "password-check";
inline constexpr std::string_view kLoginsDatabaseLabel = "as-logins-key";
inline constexpr size_t kSha1Bytes = 20;
inline constexpr size_t kAesBlock = 16;
inline constexpr size_t kDesBlock = 8;
inline constexpr int kDerDepth = 16;

enum class Code { ok, locked, unsupported, unreadable, notFound };

struct Problem {
  Code code = Code::ok;
  const char *message = "";
  explicit operator bool() const noexcept { return code != Code::ok; }
};

inline Problem Fail(Code code, const char *message) noexcept { return Problem{code, message}; }

inline const char *CodeName(Code code) noexcept {
  switch (code) {
    case Code::locked: return "locked";
    case Code::unsupported: return "unsupported";
    case Code::notFound: return "notFound";
    case Code::unreadable: return "unreadable";
    default: return "ok";
  }
}

struct Der {
  uint8_t tag = 0;
  std::string_view content;
  std::vector<Der> children;

  std::string Oid() const {
    if (tag != 0x06 || content.empty()) return {};
    uint8_t first = static_cast<uint8_t>(content[0]);
    std::string out = std::to_string(first / 40) + "." + std::to_string(first % 40);
    uint64_t value = 0;
    for (size_t i = 1; i < content.size(); i++) {
      uint8_t byte = static_cast<uint8_t>(content[i]);
      if (value > (UINT64_MAX >> 7)) return {};
      value = (value << 7) | (byte & 0x7f);
      if (!(byte & 0x80)) {
        out.append(".").append(std::to_string(value));
        value = 0;
      }
    }
    return out;
  }

  std::optional<uint64_t> Integer() const noexcept {
    if (content.empty() || content.size() > 8) return std::nullopt;
    uint64_t value = 0;
    for (char c : content) value = (value << 8) | static_cast<uint8_t>(c);
    return value;
  }

  const uint8_t *Bytes() const noexcept { return reinterpret_cast<const uint8_t *>(content.data()); }
};

inline bool ReadDer(std::string_view data, size_t &at, int depth, Der &node) {
  if (depth >= kDerDepth || at + 2 > data.size()) return false;
  node.tag = static_cast<uint8_t>(data[at]);
  size_t length = static_cast<uint8_t>(data[at + 1]);
  at += 2;
  if (length & 0x80) {
    size_t bytes = length & 0x7f;
    if (bytes == 0 || bytes > 4 || at + bytes > data.size()) return false;
    length = 0;
    for (size_t i = 0; i < bytes; i++) length = (length << 8) | static_cast<uint8_t>(data[at + i]);
    at += bytes;
  }
  if (length > data.size() - at) return false;
  node.content = data.substr(at, length);
  at += length;
  if (node.tag & 0x20) {
    size_t inner = 0;
    while (inner < node.content.size()) {
      Der child;
      if (!ReadDer(node.content, inner, depth + 1, child)) return false;
      node.children.push_back(std::move(child));
    }
  }
  return true;
}

inline std::optional<Der> ParseDer(std::string_view data) {
  Der node;
  size_t at = 0;
  if (!ReadDer(data, at, 0, node)) return std::nullopt;
  return node;
}

inline bool Sha1(std::string_view a, std::string_view b, uint8_t (&digest)[kSha1Bytes]) noexcept {
  BCRYPT_HASH_HANDLE hash = nullptr;
  if (BCryptCreateHash(BCRYPT_SHA1_ALG_HANDLE, &hash, nullptr, 0, nullptr, 0, 0) != 0) return false;
  bool ok = BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char *>(a.data())), static_cast<ULONG>(a.size()), 0) == 0 &&
            BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char *>(b.data())), static_cast<ULONG>(b.size()), 0) == 0 &&
            BCryptFinishHash(hash, digest, kSha1Bytes, 0) == 0;
  BCryptDestroyHash(hash);
  return ok;
}

inline bool HmacSha1(std::string_view key, std::string_view a, std::string_view b, uint8_t (&digest)[kSha1Bytes]) noexcept {
  BCRYPT_HASH_HANDLE hash = nullptr;
  if (BCryptCreateHash(BCRYPT_HMAC_SHA1_ALG_HANDLE, &hash, nullptr, 0, reinterpret_cast<PUCHAR>(const_cast<char *>(key.data())), static_cast<ULONG>(key.size()), 0) != 0)
    return false;
  bool ok = BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char *>(a.data())), static_cast<ULONG>(a.size()), 0) == 0 &&
            BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char *>(b.data())), static_cast<ULONG>(b.size()), 0) == 0 &&
            BCryptFinishHash(hash, digest, kSha1Bytes, 0) == 0;
  BCryptDestroyHash(hash);
  return ok;
}

inline bool Pbkdf2Sha256(std::string_view password, std::string_view salt, uint64_t rounds, uint8_t *out, size_t size) noexcept {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, BCRYPT_ALG_HANDLE_HMAC_FLAG) != 0) return false;
  bool ok = BCryptDeriveKeyPBKDF2(algorithm, reinterpret_cast<PUCHAR>(const_cast<char *>(password.data())), static_cast<ULONG>(password.size()),
                                  reinterpret_cast<PUCHAR>(const_cast<char *>(salt.data())), static_cast<ULONG>(salt.size()), rounds, out, static_cast<ULONG>(size), 0) == 0;
  BCryptCloseAlgorithmProvider(algorithm, 0);
  return ok;
}

inline bool Cbc(const wchar_t *algorithmName, std::string_view key, std::string_view iv, std::string_view cipher, Wiped &out) noexcept {
  size_t block = std::wstring_view{algorithmName} == BCRYPT_AES_ALGORITHM ? kAesBlock : kDesBlock;
  if (cipher.empty() || cipher.size() % block != 0 || iv.size() != block || cipher.size() > 0x7fffffff) return false;
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_KEY_HANDLE handle = nullptr;
  bool ok = false;
  if (BCryptOpenAlgorithmProvider(&algorithm, algorithmName, nullptr, 0) == 0) {
    auto mode = const_cast<wchar_t *>(BCRYPT_CHAIN_MODE_CBC);
    if (BCryptSetProperty(algorithm, BCRYPT_CHAINING_MODE, reinterpret_cast<PUCHAR>(mode), sizeof(BCRYPT_CHAIN_MODE_CBC), 0) == 0 &&
        BCryptGenerateSymmetricKey(algorithm, &handle, nullptr, 0, reinterpret_cast<PUCHAR>(const_cast<char *>(key.data())), static_cast<ULONG>(key.size()), 0) == 0) {
      std::array<uint8_t, kAesBlock> vector{};
      memcpy(vector.data(), iv.data(), iv.size());
      try {
        out.Resize(cipher.size());
        ULONG written = 0;
        ok = BCryptDecrypt(handle, reinterpret_cast<PUCHAR>(const_cast<char *>(cipher.data())), static_cast<ULONG>(cipher.size()), nullptr, vector.data(),
                           static_cast<ULONG>(iv.size()), out.Data(), static_cast<ULONG>(out.Size()), &written, 0) == 0 &&
             written == cipher.size();
      } catch (...) {
        ok = false;
      }
      SecureZeroMemory(vector.data(), vector.size());
    }
  }
  if (handle) BCryptDestroyKey(handle);
  if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
  if (!ok) out.Wipe();
  return ok;
}

inline size_t PaddingOf(Wiped const &plain, size_t block) noexcept {
  if (plain.Size() == 0) return 0;
  std::string_view view = plain.View();
  uint8_t last = static_cast<uint8_t>(view.back());
  if (last == 0 || last > block || last > view.size()) return 0;
  for (size_t i = view.size() - last; i < view.size(); i++)
    if (static_cast<uint8_t>(view[i]) != last) return 0;
  return last;
}

inline void Truncate(Wiped &plain, size_t keep) {
  if (keep >= plain.Size()) return;
  SecureZeroMemory(plain.Data() + keep, plain.Size() - keep);
  plain.Resize(keep);
}

inline bool CbcStrict(const wchar_t *algorithm, std::string_view key, std::string_view iv, std::string_view cipher, Wiped &out) noexcept {
  if (!Cbc(algorithm, key, iv, cipher, out)) return false;
  size_t pad = PaddingOf(out, std::wstring_view{algorithm} == BCRYPT_AES_ALGORITHM ? kAesBlock : kDesBlock);
  if (!pad) {
    out.Wipe();
    return false;
  }
  Truncate(out, out.Size() - pad);
  return true;
}

inline bool GcmOpen(std::string_view key, std::string_view nonce, std::string_view cipher, std::string_view tag, std::string_view aad, Wiped &out) noexcept {
  if (key.size() < 32 || nonce.size() != ImportSecrets::kNonceBytes || tag.size() != ImportSecrets::kTagBytes || cipher.size() > 0x7fffffff) return false;
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_KEY_HANDLE handle = nullptr;
  bool ok = false;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_AES_ALGORITHM, nullptr, 0) == 0) {
    auto mode = const_cast<wchar_t *>(BCRYPT_CHAIN_MODE_GCM);
    if (BCryptSetProperty(algorithm, BCRYPT_CHAINING_MODE, reinterpret_cast<PUCHAR>(mode), sizeof(BCRYPT_CHAIN_MODE_GCM), 0) == 0 &&
        BCryptGenerateSymmetricKey(algorithm, &handle, nullptr, 0, reinterpret_cast<PUCHAR>(const_cast<char *>(key.data())), 32, 0) == 0) {
      BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
      BCRYPT_INIT_AUTH_MODE_INFO(info);
      info.pbNonce = reinterpret_cast<PUCHAR>(const_cast<char *>(nonce.data()));
      info.cbNonce = static_cast<ULONG>(nonce.size());
      info.pbTag = reinterpret_cast<PUCHAR>(const_cast<char *>(tag.data()));
      info.cbTag = static_cast<ULONG>(tag.size());
      info.pbAuthData = reinterpret_cast<PUCHAR>(const_cast<char *>(aad.data()));
      info.cbAuthData = static_cast<ULONG>(aad.size());
      try {
        out.Resize(cipher.size());
        ULONG written = 0;
        ok = BCryptDecrypt(handle, reinterpret_cast<PUCHAR>(const_cast<char *>(cipher.data())), static_cast<ULONG>(cipher.size()), &info, nullptr, 0,
                           cipher.empty() ? nullptr : out.Data(), static_cast<ULONG>(cipher.size()), &written, 0) == 0 &&
             written == cipher.size();
      } catch (...) {
        ok = false;
      }
    }
  }
  if (handle) BCryptDestroyKey(handle);
  if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0);
  if (!ok) out.Wipe();
  return ok;
}

inline bool LegacyKey(std::string_view globalSalt, std::string_view password, std::string_view entrySalt, Wiped &key, Wiped &iv) noexcept {
  try {
    uint8_t hp[kSha1Bytes]{};
    uint8_t chp[kSha1Bytes]{};
    uint8_t k1[kSha1Bytes]{};
    uint8_t tk[kSha1Bytes]{};
    uint8_t k2[kSha1Bytes]{};
    std::string pes{entrySalt};
    if (pes.size() < kSha1Bytes) pes.resize(kSha1Bytes, '\0');
    auto view = [](uint8_t (&bytes)[kSha1Bytes]) { return std::string_view{reinterpret_cast<const char *>(bytes), kSha1Bytes}; };
    bool ok = Sha1(globalSalt, password, hp) && Sha1(view(hp), entrySalt, chp) && HmacSha1(view(chp), pes, entrySalt, k1) &&
              HmacSha1(view(chp), pes, {}, tk) && HmacSha1(view(chp), view(tk), entrySalt, k2);
    if (ok) {
      key.Wipe();
      key.Append(k1, kSha1Bytes);
      key.Append(k2, 4);
      iv.Wipe();
      iv.Append(k2 + kSha1Bytes - kDesBlock, kDesBlock);
    }
    for (auto *bytes : {hp, chp, k1, tk, k2}) SecureZeroMemory(bytes, kSha1Bytes);
    return ok;
  } catch (...) {
    return false;
  }
}

inline Problem DecryptPbe(Der const &node, std::string_view globalSalt, std::string_view password, Wiped &out) {
  if (node.children.size() < 2 || node.children[0].children.size() < 2) return Fail(Code::unreadable, "Unexpected PBE structure");
  std::string algorithm = node.children[0].children[0].Oid();
  Der const &params = node.children[0].children[1];
  std::string_view cipher = node.children[1].content;
  if (algorithm == kOidPbes2) {
    if (params.children.size() < 2 || params.children[0].children.size() < 2 || params.children[0].children[0].Oid() != kOidPbkdf2 ||
        params.children[0].children[1].children.size() < 3 || params.children[1].children.size() < 2)
      return Fail(Code::unreadable, "Unexpected PBES2 parameters");
    Der const &kdf = params.children[0].children[1];
    auto iterations = kdf.children[1].Integer();
    auto length = kdf.children[2].Integer();
    std::string_view ivTail = params.children[1].children[1].content;
    if (!iterations || *iterations == 0 || *iterations > 10'000'000 || length != 32u) return Fail(Code::unsupported, "Unsupported PBES2 key size");
    if (ivTail.size() != kAesBlock - 2) return Fail(Code::unreadable, "Unexpected PBES2 parameters");
    uint8_t hashed[kSha1Bytes]{};
    std::array<uint8_t, 32> key{};
    bool derived = Sha1(globalSalt, password, hashed) &&
                   Pbkdf2Sha256({reinterpret_cast<const char *>(hashed), kSha1Bytes}, kdf.children[0].content, *iterations, key.data(), key.size());
    SecureZeroMemory(hashed, sizeof(hashed));
    std::string iv{"\x04\x0e", 2};
    iv.append(ivTail);
    bool opened = derived && Cbc(BCRYPT_AES_ALGORITHM, {reinterpret_cast<const char *>(key.data()), key.size()}, iv, cipher, out);
    SecureZeroMemory(key.data(), key.size());
    if (!opened) return Fail(Code::locked, "PBES2 decryption failed");
    if (size_t pad = PaddingOf(out, kAesBlock)) Truncate(out, out.Size() - pad);
    return {};
  }
  if (algorithm == kOidSha1And3Des) {
    if (params.children.empty()) return Fail(Code::unreadable, "Unexpected 3DES PBE parameters");
    Wiped key;
    Wiped iv;
    if (!LegacyKey(globalSalt, password, params.children[0].content, key, iv) || !Cbc(BCRYPT_3DES_ALGORITHM, key.View(), iv.View(), cipher, out))
      return Fail(Code::locked, "3DES PBE decryption failed");
    if (size_t pad = PaddingOf(out, kDesBlock)) Truncate(out, out.Size() - pad);
    return {};
  }
  return Fail(Code::unsupported, "Unsupported PBE algorithm");
}

inline std::string_view Blob(sqlite3_stmt *row, int column) noexcept {
  if (column < 0 || sqlite3_column_type(row, column) == SQLITE_NULL) return {};
  auto data = static_cast<const char *>(sqlite3_column_blob(row, column));
  int size = sqlite3_column_bytes(row, column);
  return data && size > 0 ? std::string_view{data, static_cast<size_t>(size)} : std::string_view{};
}

inline Problem MasterKey(sqlite3 *db, std::string_view password, std::optional<std::string_view> label, Wiped &key) {
  if (!ImportFiles::TableExists(db, "metaData") || !ImportFiles::TableExists(db, "nssPrivate")) return Fail(Code::unsupported, "key4.db has an unexpected layout");
  std::string globalSalt;
  std::string check;
  {
    ImportFiles::Statement meta{db, "SELECT item1, item2 FROM metaData WHERE id = 'password'"};
    if (!meta || sqlite3_step(meta.Get()) != SQLITE_ROW || sqlite3_column_type(meta.Get(), 0) == SQLITE_NULL || sqlite3_column_type(meta.Get(), 1) == SQLITE_NULL)
      return Fail(Code::unreadable, "key4.db has no password entry");
    globalSalt = std::string{Blob(meta.Get(), 0)};
    check = std::string{Blob(meta.Get(), 1)};
  }
  Wiped clear;
  auto checkNode = ParseDer(check);
  if (!checkNode || DecryptPbe(*checkNode, globalSalt, password, clear) || clear.View().substr(0, kPasswordCheck.size()) != kPasswordCheck)
    return Fail(Code::locked, "Wrong Firefox primary password");
  std::string sealed;
  bool found = false;
  {
    ImportFiles::Statement keys{db, "SELECT a11, a102, a3 FROM nssPrivate"};
    if (!keys) return Fail(Code::unreadable, "key4.db holds no login key");
    std::string_view ckaId{"\xf8\0\0\0\0\0\0\0\0\0\0\0\0\0\0\x01", 16};
    while (sqlite3_step(keys.Get()) == SQLITE_ROW) {
      sqlite3_stmt *row = keys.Get();
      if (sqlite3_column_type(row, 0) == SQLITE_NULL) continue;
      std::string_view a11 = Blob(row, 0);
      std::string_view id = Blob(row, 1);
      std::string_view name = Blob(row, 2);
      if (label) {
        if (name == *label) {
          sealed = std::string{a11};
          found = true;
          break;
        }
        continue;
      }
      if (name == kLoginsDatabaseLabel) continue;
      if (!found || id == ckaId) {
        sealed = std::string{a11};
        found = true;
      }
      if (id == ckaId) break;
    }
  }
  if (!found) return label ? Fail(Code::notFound, "key4.db has no key for logins.db") : Fail(Code::unreadable, "key4.db holds no login key");
  auto keyNode = ParseDer(sealed);
  if (!keyNode) return Fail(Code::unreadable, "Unexpected PBE structure");
  if (Problem problem = DecryptPbe(*keyNode, globalSalt, password, key)) return problem;
  if (key.Size() < (label ? 32u : 24u)) {
    key.Wipe();
    return Fail(Code::unreadable, "key4.db login key is malformed");
  }
  return {};
}

}

}
