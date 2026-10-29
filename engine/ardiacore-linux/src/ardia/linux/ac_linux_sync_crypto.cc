#include "ardia/linux/ac_linux_sync_crypto.h"

#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <openssl/sha.h>

#include <algorithm>
#include <cstring>
#include <map>
#include <memory>

namespace ardia::linux_sync {
namespace {

constexpr char kBase32[] = "abcdefghijklmnopqrstuvwxyz234567";
constexpr char kBase64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
constexpr size_t kMagicBytes = sizeof(kMagic) - 1;

struct CipherContext {
  CipherContext() : context(EVP_CIPHER_CTX_new()) {}
  ~CipherContext() { EVP_CIPHER_CTX_free(context); }
  EVP_CIPHER_CTX* context;
};

void AppendU32(Bytes& out, size_t value) {
  out.push_back(static_cast<uint8_t>((value >> 24) & 0xff));
  out.push_back(static_cast<uint8_t>((value >> 16) & 0xff));
  out.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
  out.push_back(static_cast<uint8_t>(value & 0xff));
}

void Append(Bytes& out, std::string_view text) {
  out.insert(out.end(), text.begin(), text.end());
}

Bytes FramedPlain(const uint8_t* payload, size_t size, size_t padding) {
  Bytes plain;
  plain.reserve(4 + size + padding);
  AppendU32(plain, size);
  plain.insert(plain.end(), payload, payload + size);
  plain.resize(plain.size() + (padding - plain.size() % padding) % padding, 0);
  return plain;
}

bool GcmSeal(const std::array<uint8_t, 32>& key, const uint8_t* nonce, const Bytes& aad, const Bytes& plain,
             Bytes* out) {
  CipherContext cipher;
  if (!cipher.context) return false;
  const size_t start = out->size();
  out->resize(start + plain.size() + kTagBytes);
  int written = 0;
  int final_written = 0;
  if (EVP_EncryptInit_ex(cipher.context, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1 ||
      EVP_CIPHER_CTX_ctrl(cipher.context, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(kNonceBytes), nullptr) != 1 ||
      EVP_EncryptInit_ex(cipher.context, nullptr, nullptr, key.data(), nonce) != 1 ||
      EVP_EncryptUpdate(cipher.context, nullptr, &written, aad.data(), static_cast<int>(aad.size())) != 1 ||
      EVP_EncryptUpdate(cipher.context, out->data() + start, &written, plain.data(), static_cast<int>(plain.size())) != 1 ||
      EVP_EncryptFinal_ex(cipher.context, out->data() + start + written, &final_written) != 1 ||
      static_cast<size_t>(written + final_written) != plain.size() ||
      EVP_CIPHER_CTX_ctrl(cipher.context, EVP_CTRL_GCM_GET_TAG, static_cast<int>(kTagBytes),
                          out->data() + start + plain.size()) != 1) {
    out->resize(start);
    return false;
  }
  return true;
}

bool GcmOpen(const std::array<uint8_t, 32>& key, const uint8_t* nonce, const Bytes& aad, const uint8_t* sealed,
             size_t sealed_size, const uint8_t* tag, Bytes* plain) {
  CipherContext cipher;
  if (!cipher.context) return false;
  plain->assign(sealed_size, 0);
  uint8_t tag_copy[kTagBytes];
  std::memcpy(tag_copy, tag, kTagBytes);
  int written = 0;
  int final_written = 0;
  const bool ok =
      EVP_DecryptInit_ex(cipher.context, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1 &&
      EVP_CIPHER_CTX_ctrl(cipher.context, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(kNonceBytes), nullptr) == 1 &&
      EVP_DecryptInit_ex(cipher.context, nullptr, nullptr, key.data(), nonce) == 1 &&
      EVP_DecryptUpdate(cipher.context, nullptr, &written, aad.data(), static_cast<int>(aad.size())) == 1 &&
      EVP_DecryptUpdate(cipher.context, plain->data(), &written, sealed, static_cast<int>(sealed_size)) == 1 &&
      EVP_CIPHER_CTX_ctrl(cipher.context, EVP_CTRL_GCM_SET_TAG, static_cast<int>(kTagBytes), tag_copy) == 1 &&
      EVP_DecryptFinal_ex(cipher.context, plain->data() + written, &final_written) == 1 &&
      static_cast<size_t>(written + final_written) == sealed_size;
  if (!ok) {
    Wipe(*plain);
    plain->clear();
  }
  return ok;
}

OpenError Unframe(Bytes& plain, Bytes* payload) {
  if (plain.size() < 4) return OpenError::kFormat;
  const size_t length = (static_cast<size_t>(plain[0]) << 24) | (static_cast<size_t>(plain[1]) << 16) |
                        (static_cast<size_t>(plain[2]) << 8) | static_cast<size_t>(plain[3]);
  if (length > plain.size() - 4) return OpenError::kFormat;
  payload->assign(plain.begin() + 4, plain.begin() + 4 + static_cast<std::ptrdiff_t>(length));
  return OpenError::kNone;
}

Bytes FileAad(std::string_view chain, std::string_view scope, std::string_view file) {
  Bytes aad;
  Append(aad, kMagic);
  Append(aad, chain);
  aad.push_back('/');
  Append(aad, scope);
  aad.push_back('/');
  Append(aad, file);
  return aad;
}

Bytes PasswordAad(std::string_view origin, std::string_view username) {
  Bytes aad;
  Append(aad, kMagic);
  Append(aad, "password/");
  AppendU32(aad, origin.size());
  Append(aad, origin);
  Append(aad, username);
  return aad;
}

bool ValidUtf8(const uint8_t* data, size_t size) {
  size_t i = 0;
  while (i < size) {
    const uint8_t lead = data[i];
    size_t extra = 0;
    uint32_t point = 0;
    if (lead < 0x80) {
      ++i;
      continue;
    } else if ((lead & 0xe0) == 0xc0) {
      extra = 1;
      point = lead & 0x1f;
    } else if ((lead & 0xf0) == 0xe0) {
      extra = 2;
      point = lead & 0x0f;
    } else if ((lead & 0xf8) == 0xf0) {
      extra = 3;
      point = lead & 0x07;
    } else {
      return false;
    }
    if (i + extra >= size) return false;
    for (size_t k = 1; k <= extra; ++k) {
      if ((data[i + k] & 0xc0) != 0x80) return false;
      point = (point << 6) | (data[i + k] & 0x3f);
    }
    if ((extra == 1 && point < 0x80) || (extra == 2 && point < 0x800) || (extra == 3 && point < 0x10000) ||
        point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))
      return false;
    i += extra + 1;
  }
  return true;
}

bool SeparatorPoint(uint32_t point) {
  if (point < 0x80) return !(point >= 'a' && point <= 'z');
  if (point < 0xc0 || point == 0xd7 || point == 0xf7) return true;
  if (point >= 0x2000 && point <= 0x2bff) return true;
  if (point >= 0x3000 && point <= 0x303f) return true;
  if (point >= 0xfe30 && point <= 0xfe4f) return true;
  if (point >= 0xff00 && point <= 0xff20) return true;
  return point == 0xfeff;
}

const std::map<std::string, size_t, std::less<>>& WordIndex() {
  static const auto* index = [] {
    auto* map = new std::map<std::string, size_t, std::less<>>();
    for (size_t i = 0; i < kWordCount; ++i) map->emplace(kWordlist[i], i);
    return map;
  }();
  return *index;
}

const std::map<std::string, size_t, std::less<>>& PrefixIndex() {
  static const auto* index = [] {
    auto* map = new std::map<std::string, size_t, std::less<>>();
    for (size_t i = 0; i < kWordCount; ++i) map->emplace(std::string(kWordlist[i]).substr(0, 4), i);
    return map;
  }();
  return *index;
}

std::optional<size_t> WordOf(const std::string& token) {
  const auto& words = WordIndex();
  if (auto found = words.find(token); found != words.end()) return found->second;
  if (token.size() < 4) return std::nullopt;
  const auto& prefixes = PrefixIndex();
  const auto found = prefixes.find(std::string_view(token).substr(0, 4));
  if (found == prefixes.end()) return std::nullopt;
  if (std::string_view(kWordlist[found->second]).substr(0, token.size()) != token) return std::nullopt;
  return found->second;
}

}

void Wipe(void* data, size_t size) {
  if (data && size) OPENSSL_cleanse(data, size);
}

void Wipe(Bytes& bytes) {
  Wipe(bytes.data(), bytes.size());
}

void Wipe(std::string& text) {
  Wipe(text.data(), text.size());
}

bool RandomBytes(uint8_t* out, size_t size) {
  return RAND_bytes(out, static_cast<int>(size)) == 1;
}

std::optional<Bytes> NewEntropy() {
  Bytes entropy(kEntropyBytes);
  if (!RandomBytes(entropy.data(), entropy.size())) return std::nullopt;
  return entropy;
}

std::string Base32(const uint8_t* data, size_t size) {
  std::string out;
  uint32_t buffer = 0;
  int bits = 0;
  for (size_t i = 0; i < size; ++i) {
    buffer = (buffer << 8) | data[i];
    bits += 8;
    while (bits >= 5) {
      out.push_back(kBase32[(buffer >> (bits - 5)) & 31]);
      bits -= 5;
    }
    buffer &= (1u << bits) - 1;
  }
  if (bits > 0) out.push_back(kBase32[(buffer << (5 - bits)) & 31]);
  return out;
}

bool IsTag(std::string_view name) {
  return name.size() == kTagLength &&
         std::all_of(name.begin(), name.end(), [](char c) { return (c >= 'a' && c <= 'z') || (c >= '2' && c <= '7'); });
}

std::string NewFileId() {
  uint8_t bytes[16];
  if (!RandomBytes(bytes, sizeof(bytes))) return std::string();
  return Base32(bytes, sizeof(bytes));
}

std::string Base64Encode(const Bytes& data) {
  std::string out;
  out.reserve((data.size() + 2) / 3 * 4);
  size_t i = 0;
  for (; i + 2 < data.size(); i += 3) {
    const uint32_t n = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    out.push_back(kBase64[(n >> 18) & 63]);
    out.push_back(kBase64[(n >> 12) & 63]);
    out.push_back(kBase64[(n >> 6) & 63]);
    out.push_back(kBase64[n & 63]);
  }
  if (i + 1 == data.size()) {
    const uint32_t n = data[i] << 16;
    out.push_back(kBase64[(n >> 18) & 63]);
    out.push_back(kBase64[(n >> 12) & 63]);
    out.append("==");
  } else if (i + 2 == data.size()) {
    const uint32_t n = (data[i] << 16) | (data[i + 1] << 8);
    out.push_back(kBase64[(n >> 18) & 63]);
    out.push_back(kBase64[(n >> 12) & 63]);
    out.push_back(kBase64[(n >> 6) & 63]);
    out.push_back('=');
  }
  return out;
}

std::optional<Bytes> Base64Decode(std::string_view text) {
  if (text.size() % 4 != 0) return std::nullopt;
  auto value = [](char c) -> int {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
  };
  Bytes out;
  out.reserve(text.size() / 4 * 3);
  for (size_t i = 0; i < text.size(); i += 4) {
    const bool last = i + 4 == text.size();
    const int pad = last ? (text[i + 3] == '=') + (text[i + 2] == '=') : 0;
    if (pad == 1 && text[i + 2] == '=') return std::nullopt;
    uint32_t n = 0;
    for (int k = 0; k < 4; ++k) {
      if (k >= 4 - pad) {
        n <<= 6;
        continue;
      }
      const int v = value(text[i + k]);
      if (v < 0) return std::nullopt;
      n = (n << 6) | static_cast<uint32_t>(v);
    }
    out.push_back(static_cast<uint8_t>((n >> 16) & 0xff));
    if (pad < 2) out.push_back(static_cast<uint8_t>((n >> 8) & 0xff));
    if (pad < 1) out.push_back(static_cast<uint8_t>(n & 0xff));
  }
  return out;
}

std::array<uint8_t, 32> Sha256(const uint8_t* data, size_t size) {
  std::array<uint8_t, 32> digest{};
  SHA256(data, size, digest.data());
  return digest;
}

std::array<uint8_t, 32> HmacSha256(const uint8_t* key, size_t key_size, const uint8_t* data, size_t size) {
  std::array<uint8_t, 32> mac{};
  unsigned int length = 0;
  HMAC(EVP_sha256(), key, static_cast<int>(key_size), data, size, mac.data(), &length);
  return mac;
}

std::array<uint8_t, 32> Hkdf32(const Bytes& ikm, std::string_view salt, std::string_view info) {
  auto prk = HmacSha256(reinterpret_cast<const uint8_t*>(salt.data()), salt.size(), ikm.data(), ikm.size());
  Bytes block(info.begin(), info.end());
  block.push_back(1);
  auto okm = HmacSha256(prk.data(), prk.size(), block.data(), block.size());
  Wipe(prk.data(), prk.size());
  return okm;
}

SyncKeys::SyncKeys(const Bytes& entropy)
    : file_key_(Hkdf32(entropy, kSalt, "file-key")),
      name_key_(Hkdf32(entropy, kSalt, "name-key")),
      password_key_(Hkdf32(entropy, kSalt, "password-key")),
      password_nonce_key_(Hkdf32(entropy, kSalt, "password-nonce-key")),
      chain_tag_(Tag("chain")) {}

SyncKeys::~SyncKeys() {
  Wipe(file_key_.data(), file_key_.size());
  Wipe(name_key_.data(), name_key_.size());
  Wipe(password_key_.data(), password_key_.size());
  Wipe(password_nonce_key_.data(), password_nonce_key_.size());
}

std::string SyncKeys::Tag(std::string_view label) const {
  const auto mac = HmacSha256(name_key_.data(), name_key_.size(), reinterpret_cast<const uint8_t*>(label.data()),
                              label.size());
  return Base32(mac.data(), 16);
}

std::string SyncKeys::ScopeTag(std::string_view scope) const {
  return Tag("scope/" + std::string(scope));
}

std::optional<Bytes> SyncKeys::Seal(const Bytes& payload, std::string_view scope_tag, std::string_view file_id) const {
  uint8_t nonce[kNonceBytes];
  if (!RandomBytes(nonce, sizeof(nonce))) return std::nullopt;
  return SealWithNonce(payload, scope_tag, file_id, nonce);
}

std::optional<Bytes> SyncKeys::SealWithNonce(const Bytes& payload, std::string_view scope_tag,
                                             std::string_view file_id, const uint8_t* nonce) const {
  if (payload.size() > 0xffffffffu - kFilePadding) return std::nullopt;
  Bytes plain = FramedPlain(payload.data(), payload.size(), kFilePadding);
  Bytes out;
  out.reserve(kMagicBytes + kNonceBytes + plain.size() + kTagBytes);
  Append(out, kMagic);
  out.insert(out.end(), nonce, nonce + kNonceBytes);
  const bool sealed = GcmSeal(file_key_, nonce, FileAad(chain_tag_, scope_tag, file_id), plain, &out);
  Wipe(plain);
  if (!sealed) return std::nullopt;
  return out;
}

OpenError SyncKeys::Open(const Bytes& file, std::string_view scope_tag, std::string_view file_id,
                         Bytes* payload) const {
  if (file.size() < kMagicBytes + kNonceBytes + kTagBytes + 4 ||
      std::memcmp(file.data(), kMagic, kMagicBytes) != 0)
    return OpenError::kFormat;
  const uint8_t* nonce = file.data() + kMagicBytes;
  const uint8_t* sealed = nonce + kNonceBytes;
  const size_t sealed_size = file.size() - kMagicBytes - kNonceBytes - kTagBytes;
  Bytes plain;
  if (!GcmOpen(file_key_, nonce, FileAad(chain_tag_, scope_tag, file_id), sealed, sealed_size,
               sealed + sealed_size, &plain))
    return OpenError::kAuthentication;
  const OpenError result = Unframe(plain, payload);
  Wipe(plain);
  return result;
}

std::optional<std::string> SyncKeys::SealPassword(std::string_view password, std::string_view origin,
                                                  std::string_view username) const {
  if (password.size() > 0xffffu || origin.size() > 0xffffu || username.size() > 0xffffu) return std::nullopt;
  Bytes plain = FramedPlain(reinterpret_cast<const uint8_t*>(password.data()), password.size(), kPasswordPadding);
  const Bytes aad = PasswordAad(origin, username);
  Bytes synthetic;
  AppendU32(synthetic, aad.size());
  synthetic.insert(synthetic.end(), aad.begin(), aad.end());
  synthetic.insert(synthetic.end(), plain.begin(), plain.end());
  const auto mac = HmacSha256(password_nonce_key_.data(), password_nonce_key_.size(), synthetic.data(),
                              synthetic.size());
  Wipe(synthetic);
  Bytes out;
  out.push_back(kPasswordVersion);
  out.insert(out.end(), mac.begin(), mac.begin() + kNonceBytes);
  const bool sealed = GcmSeal(password_key_, mac.data(), aad, plain, &out);
  Wipe(plain);
  if (!sealed) return std::nullopt;
  return Base64Encode(out);
}

OpenError SyncKeys::OpenPassword(std::string_view sealed, std::string_view origin, std::string_view username,
                                 std::string* password) const {
  const auto data = Base64Decode(sealed);
  if (!data || data->size() < 1 + kNonceBytes + kTagBytes + 4 || (*data)[0] != kPasswordVersion)
    return OpenError::kFormat;
  const uint8_t* nonce = data->data() + 1;
  const uint8_t* body = nonce + kNonceBytes;
  const size_t body_size = data->size() - 1 - kNonceBytes - kTagBytes;
  Bytes plain;
  if (!GcmOpen(password_key_, nonce, PasswordAad(origin, username), body, body_size, body + body_size, &plain))
    return OpenError::kAuthentication;
  Bytes payload;
  OpenError result = Unframe(plain, &payload);
  Wipe(plain);
  if (result == OpenError::kNone && !ValidUtf8(payload.data(), payload.size())) result = OpenError::kFormat;
  if (result == OpenError::kNone) password->assign(payload.begin(), payload.end());
  Wipe(payload);
  return result;
}

std::vector<std::string> PhraseWords(const Bytes& entropy) {
  std::vector<std::string> words;
  if (entropy.size() != kEntropyBytes) return words;
  const auto checksum = Sha256(entropy.data(), entropy.size());
  Bytes stream(entropy);
  stream.push_back(checksum[0]);
  for (size_t word = 0; word < kPhraseWords; ++word) {
    size_t index = 0;
    for (size_t bit = word * 11; bit < word * 11 + 11; ++bit) {
      index = (index << 1) | ((stream[bit / 8] >> (7 - bit % 8)) & 1);
    }
    words.emplace_back(kWordlist[index]);
  }
  Wipe(stream);
  return words;
}

std::vector<std::string> PhraseTokens(std::string_view text) {
  std::vector<std::string> tokens;
  std::string current;
  size_t i = 0;
  auto flush = [&] {
    if (!current.empty()) tokens.push_back(std::move(current));
    current.clear();
  };
  while (i < text.size()) {
    const uint8_t lead = static_cast<uint8_t>(text[i]);
    size_t length = 1;
    uint32_t point = lead;
    if (lead >= 0x80) {
      length = (lead & 0xe0) == 0xc0 ? 2 : (lead & 0xf0) == 0xe0 ? 3 : (lead & 0xf8) == 0xf0 ? 4 : 1;
      if (length == 1 || i + length > text.size()) {
        flush();
        ++i;
        continue;
      }
      point = lead & (0x7f >> length);
      for (size_t k = 1; k < length; ++k) point = (point << 6) | (static_cast<uint8_t>(text[i + k]) & 0x3f);
    } else if (lead >= 'A' && lead <= 'Z') {
      point = lead - 'A' + 'a';
    }
    if (SeparatorPoint(point)) {
      flush();
    } else if (length == 1) {
      current.push_back(static_cast<char>(point));
    } else {
      current.append(text.substr(i, length));
    }
    i += length;
  }
  flush();
  return tokens;
}

PhraseProblem EntropyFromPhrase(std::string_view text, Bytes* entropy) {
  PhraseProblem problem;
  std::vector<std::string> tokens = PhraseTokens(text);
  if (tokens.size() != kPhraseWords) {
    problem.kind = PhraseProblem::Kind::kWordCount;
    problem.count = tokens.size();
    for (auto& token : tokens) Wipe(token);
    return problem;
  }
  Bytes stream(kEntropyBytes + 1, 0);
  size_t bit = 0;
  for (auto& token : tokens) {
    const auto index = WordOf(token);
    if (!index) {
      problem.kind = PhraseProblem::Kind::kUnknownWord;
      problem.word = token;
      break;
    }
    for (int k = 10; k >= 0; --k, ++bit) {
      if ((*index >> k) & 1) stream[bit / 8] |= static_cast<uint8_t>(1 << (7 - bit % 8));
    }
  }
  for (auto& token : tokens) Wipe(token);
  if (problem.kind == PhraseProblem::Kind::kNone) {
    Bytes candidate(stream.begin(), stream.begin() + kEntropyBytes);
    if (Sha256(candidate.data(), candidate.size())[0] != stream[kEntropyBytes]) {
      problem.kind = PhraseProblem::Kind::kChecksum;
      Wipe(candidate);
    } else {
      *entropy = std::move(candidate);
    }
  }
  Wipe(stream);
  return problem;
}

}
