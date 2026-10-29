#include "ardia/linux/ac_linux_import_crypto.h"

#include <algorithm>
#include <cstring>
#include <iterator>
#include <utility>

#include "ardia/linux/ac_linux_import_formats.h"
#include "third_party/boringssl/src/include/openssl/evp.h"
#include "third_party/boringssl/src/include/openssl/hmac.h"
#include "third_party/boringssl/src/include/openssl/sha.h"

namespace ardia::linux_import {

namespace {

constexpr std::string_view kChromiumSalt = "saltysalt";
constexpr unsigned char kChromiumIv[16] = {' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
                                           ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' '};
constexpr unsigned char kBasicKey[16] = {0xfd, 0x62, 0x1f, 0xe5, 0xa2, 0xb4, 0x02, 0x53,
                                         0x9d, 0xfa, 0x14, 0x7c, 0xa9, 0x27, 0x27, 0x78};
constexpr unsigned char kEmptyKey[16] = {0xd0, 0xd0, 0xec, 0x9c, 0x7d, 0x77, 0xd4, 0x3a,
                                         0xc5, 0x41, 0x87, 0xfa, 0x48, 0x18, 0xd1, 0x7f};
constexpr std::string_view kPasswordCheck = "password-check";
constexpr unsigned char kCkaId[16] = {0xf8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01};
constexpr int kMaxDerDepth = 16;

const unsigned char* Bytes(std::string_view text) {
  return reinterpret_cast<const unsigned char*>(text.data());
}

bool Cipher(const EVP_CIPHER* cipher, std::string_view key, std::string_view iv, std::string_view input, bool padding,
            std::string* out) {
  out->clear();
  if (input.empty() || static_cast<size_t>(EVP_CIPHER_iv_length(cipher)) != iv.size() ||
      static_cast<size_t>(EVP_CIPHER_key_length(cipher)) != key.size() ||
      input.size() % static_cast<size_t>(EVP_CIPHER_block_size(cipher)) != 0) {
    return false;
  }
  std::string plain(input.size() + 32, '\0');
  int first = 0;
  int last = 0;
  EVP_CIPHER_CTX* context = EVP_CIPHER_CTX_new();
  const bool ok = context && EVP_DecryptInit_ex(context, cipher, nullptr, Bytes(key), Bytes(iv)) == 1 &&
                  EVP_CIPHER_CTX_set_padding(context, padding ? 1 : 0) == 1 &&
                  EVP_DecryptUpdate(context, reinterpret_cast<unsigned char*>(plain.data()), &first, Bytes(input),
                                    static_cast<int>(input.size())) == 1 &&
                  EVP_DecryptFinal_ex(context, reinterpret_cast<unsigned char*>(plain.data()) + first, &last) == 1;
  EVP_CIPHER_CTX_free(context);
  if (!ok || first < 0 || last < 0) {
    Wipe(plain);
    return false;
  }
  out->assign(plain, 0, static_cast<size_t>(first + last));
  Wipe(plain);
  return true;
}

void UnpadLeniently(std::string* data, size_t block) {
  if (data->empty()) return;
  const unsigned char pad = static_cast<unsigned char>(data->back());
  if (pad == 0 || pad > block || pad > data->size()) return;
  for (size_t i = data->size() - pad; i < data->size(); ++i) {
    if (static_cast<unsigned char>((*data)[i]) != pad) return;
  }
  std::fill(data->end() - pad, data->end(), '\0');
  data->resize(data->size() - pad);
}

bool Sha1(std::string_view data, std::string* digest) {
  digest->assign(SHA_DIGEST_LENGTH, '\0');
  SHA1(Bytes(data), data.size(), reinterpret_cast<unsigned char*>(digest->data()));
  return true;
}

bool HmacSha1(std::string_view key, std::string_view data, std::string* out) {
  out->assign(SHA_DIGEST_LENGTH, '\0');
  unsigned int length = 0;
  return HMAC(EVP_sha1(), key.data(), static_cast<int>(key.size()), Bytes(data), data.size(),
              reinterpret_cast<unsigned char*>(out->data()), &length) != nullptr &&
         length == SHA_DIGEST_LENGTH;
}

bool ValidUtf8Text(std::string_view text) {
  return ValidUtf8(text);
}

bool ReadDer(std::string_view data, size_t* offset, int depth, DerNode* node) {
  if (depth > kMaxDerDepth || *offset + 2 > data.size()) return false;
  node->tag = static_cast<uint8_t>(data[*offset]);
  size_t length = static_cast<uint8_t>(data[*offset + 1]);
  *offset += 2;
  if (length & 0x80) {
    const size_t count = length & 0x7f;
    if (count == 0 || count > 4 || *offset + count > data.size()) return false;
    length = 0;
    for (size_t i = 0; i < count; ++i) length = (length << 8) | static_cast<uint8_t>(data[*offset + i]);
    *offset += count;
  }
  if (length > data.size() - *offset) return false;
  node->content = data.substr(*offset, length);
  *offset += length;
  node->children.clear();
  if (node->constructed()) {
    size_t inner = 0;
    while (inner < node->content.size()) {
      DerNode child;
      if (!ReadDer(node->content, &inner, depth + 1, &child)) return false;
      node->children.push_back(std::move(child));
    }
  }
  return true;
}

bool ChromiumDecrypt(const unsigned char* key, std::string_view cipher, std::string* plain) {
  return Cipher(EVP_aes_128_cbc(), std::string_view(reinterpret_cast<const char*>(key), kChromiumKeyBytes),
                std::string_view(reinterpret_cast<const char*>(kChromiumIv), sizeof(kChromiumIv)), cipher, true, plain);
}

PbeResult DecryptPbes2(const DerNode& params, std::string_view cipher, std::string_view global_salt,
                       std::string_view password, SecretBytes* plain) {
  if (params.children.size() < 2) return PbeResult::kMalformed;
  const DerNode& kdf = params.children[0];
  const DerNode& scheme = params.children[1];
  if (kdf.children.size() < 2 || kdf.children[0].Oid() != kOidPbkdf2 || kdf.children[1].children.size() < 2 ||
      scheme.children.size() < 2) {
    return PbeResult::kMalformed;
  }
  const DerNode& kdf_params = kdf.children[1];
  const std::string_view salt = kdf_params.children[0].content;
  const std::optional<uint64_t> iterations = kdf_params.children[1].Integer();
  std::optional<uint64_t> key_length = 32;
  size_t next = 2;
  if (kdf_params.children.size() > next && kdf_params.children[next].tag == 0x02) {
    key_length = kdf_params.children[next].Integer();
    ++next;
  }
  if (kdf_params.children.size() > next) {
    const DerNode& prf = kdf_params.children[next];
    if (prf.children.empty() || prf.children[0].Oid() != kOidHmacSha256) return PbeResult::kUnsupported;
  }
  if (!iterations || *iterations == 0 || *iterations > kMaxPbkdf2Iterations || key_length != 32u) {
    return PbeResult::kUnsupported;
  }
  if (scheme.children[0].Oid() != kOidAes256Cbc) return PbeResult::kUnsupported;
  std::string iv(scheme.children[1].content);
  if (iv.size() == 14) iv.insert(0, std::string("\x04\x0e", 2));
  if (iv.size() != 16) return PbeResult::kMalformed;
  std::string seed(global_salt);
  seed.append(password);
  std::string hashed;
  if (global_salt.size() == SHA384_DIGEST_LENGTH) {
    hashed.assign(SHA384_DIGEST_LENGTH, '\0');
    SHA384(Bytes(seed), seed.size(), reinterpret_cast<unsigned char*>(hashed.data()));
  } else {
    Sha1(seed, &hashed);
  }
  Wipe(seed);
  std::string key(32, '\0');
  const bool derived =
      PKCS5_PBKDF2_HMAC(hashed.data(), hashed.size(), Bytes(salt), salt.size(), static_cast<int>(*iterations),
                        EVP_sha256(), key.size(), reinterpret_cast<unsigned char*>(key.data())) == 1;
  Wipe(hashed);
  std::string clear;
  const bool ok = derived && Cipher(EVP_aes_256_cbc(), key, iv, cipher, false, &clear);
  Wipe(key);
  if (!ok) return PbeResult::kWrongPassword;
  UnpadLeniently(&clear, 16);
  *plain = SecretBytes(std::move(clear));
  return PbeResult::kOk;
}

PbeResult DecryptLegacy3Des(const DerNode& params, std::string_view cipher, std::string_view global_salt,
                            std::string_view password, SecretBytes* plain) {
  if (params.children.empty()) return PbeResult::kMalformed;
  const std::string_view entry_salt = params.children[0].content;
  std::string seed(global_salt);
  seed.append(password);
  std::string hp;
  Sha1(seed, &hp);
  Wipe(seed);
  std::string pes(entry_salt);
  if (pes.size() < 20) pes.append(20 - pes.size(), '\0');
  std::string chp;
  Sha1(hp + std::string(entry_salt), &chp);
  Wipe(hp);
  std::string k1;
  std::string tk;
  std::string k2;
  const bool macs = HmacSha1(chp, pes + std::string(entry_salt), &k1) && HmacSha1(chp, pes, &tk) &&
                    HmacSha1(chp, tk + std::string(entry_salt), &k2);
  Wipe(chp);
  std::string k = k1 + k2;
  Wipe(k1);
  Wipe(k2);
  Wipe(tk);
  std::string clear;
  const bool ok = macs && Cipher(EVP_des_ede3_cbc(), std::string_view(k).substr(0, 24),
                                 std::string_view(k).substr(k.size() - 8), cipher, false, &clear);
  Wipe(k);
  if (!ok) return PbeResult::kWrongPassword;
  UnpadLeniently(&clear, 8);
  *plain = SecretBytes(std::move(clear));
  return PbeResult::kOk;
}

int Base64Value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+' || c == '-') return 62;
  if (c == '/' || c == '_') return 63;
  return -1;
}

}

SecretBytes::SecretBytes() = default;
SecretBytes::SecretBytes(std::string value) : value_(std::move(value)) {}
SecretBytes::SecretBytes(SecretBytes&& other) : value_(std::move(other.value_)) {
  other.Clear();
}
SecretBytes& SecretBytes::operator=(SecretBytes&& other) {
  if (this != &other) {
    Clear();
    value_ = std::move(other.value_);
    other.Clear();
  }
  return *this;
}
SecretBytes::~SecretBytes() {
  Clear();
}
SecretBytes SecretBytes::Copy() const {
  return SecretBytes(value_);
}
void SecretBytes::Clear() {
  Wipe(value_);
}

SecretBytes DeriveChromiumKey(std::string_view secret) {
  std::string key(kChromiumKeyBytes, '\0');
  if (PKCS5_PBKDF2_HMAC(secret.data(), secret.size(), Bytes(kChromiumSalt), kChromiumSalt.size(), 1, EVP_sha1(),
                        key.size(), reinterpret_cast<unsigned char*>(key.data())) != 1) {
    Wipe(key);
  }
  return SecretBytes(std::move(key));
}

bool Sha256(std::string_view data, std::string* digest) {
  digest->assign(SHA256_DIGEST_LENGTH, '\0');
  SHA256(Bytes(data), data.size(), reinterpret_cast<unsigned char*>(digest->data()));
  return true;
}

ValueDecrypt DecryptChromiumBytes(std::string_view blob, const SecretBytes* keyring_key, std::string* plain) {
  plain->clear();
  const std::string_view prefix = blob.substr(0, 3);
  if (prefix == "v12") return ValueDecrypt::kPortal;
  if (prefix != "v10" && prefix != "v11") return ValueDecrypt::kFailed;
  const bool keyed = keyring_key && keyring_key->value().size() == kChromiumKeyBytes;
  if (prefix == "v11" && !keyed) return ValueDecrypt::kKeyring;
  const std::string_view cipher = blob.substr(3);
  if (cipher.empty() || cipher.size() % 16 != 0) return ValueDecrypt::kFailed;
  bool ok = false;
  if (prefix == "v10") {
    ok = ChromiumDecrypt(kBasicKey, cipher, plain) || ChromiumDecrypt(kEmptyKey, cipher, plain);
    if (!ok && keyring_key && keyring_key->value().size() == kChromiumKeyBytes) {
      ok = ChromiumDecrypt(reinterpret_cast<const unsigned char*>(keyring_key->value().data()), cipher, plain);
    }
  } else {
    if (!keyring_key || keyring_key->value().size() != kChromiumKeyBytes) return ValueDecrypt::kKeyring;
    ok = ChromiumDecrypt(reinterpret_cast<const unsigned char*>(keyring_key->value().data()), cipher, plain);
  }
  return ok ? ValueDecrypt::kOk : ValueDecrypt::kFailed;
}

ValueDecrypt DecryptChromiumValue(std::string_view blob, const SecretBytes* keyring_key, std::string_view host_key,
                                  std::string* plain) {
  plain->clear();
  const std::string_view prefix = blob.substr(0, 3);
  if (prefix != "v10" && prefix != "v11" && prefix != "v12") {
    if (blob.empty() || !ValidUtf8Text(blob)) return ValueDecrypt::kFailed;
    plain->assign(blob);
    return ValueDecrypt::kOk;
  }
  std::string clear;
  const ValueDecrypt result = DecryptChromiumBytes(blob, keyring_key, &clear);
  if (result != ValueDecrypt::kOk) return result;
  size_t start = 0;
  if (!host_key.empty()) {
    std::string digest;
    Sha256(host_key, &digest);
    if (clear.size() < digest.size() || clear.compare(0, digest.size(), digest) != 0) {
      Wipe(clear);
      return ValueDecrypt::kFailed;
    }
    start = digest.size();
  }
  if (!ValidUtf8Text(std::string_view(clear).substr(start))) {
    Wipe(clear);
    return ValueDecrypt::kFailed;
  }
  plain->assign(clear, start, std::string::npos);
  Wipe(clear);
  return ValueDecrypt::kOk;
}

std::string DerNode::Oid() const {
  if (tag != 0x06 || content.empty()) return std::string();
  const uint8_t first = static_cast<uint8_t>(content[0]);
  std::string out = std::to_string(first / 40) + "." + std::to_string(first % 40);
  uint64_t value = 0;
  for (size_t i = 1; i < content.size(); ++i) {
    const uint8_t byte = static_cast<uint8_t>(content[i]);
    if (value > (UINT64_MAX >> 7)) return std::string();
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) {
      out += "." + std::to_string(value);
      value = 0;
    }
  }
  return out;
}

std::optional<uint64_t> DerNode::Integer() const {
  if (tag != 0x02 || content.empty() || content.size() > 8) return std::nullopt;
  uint64_t value = 0;
  for (const char c : content) value = (value << 8) | static_cast<uint8_t>(c);
  return value;
}

std::optional<DerNode> ParseDer(std::string_view data) {
  DerNode node;
  size_t offset = 0;
  if (!ReadDer(data, &offset, 0, &node)) return std::nullopt;
  return node;
}

PbeResult DecryptFirefoxPbe(std::string_view der, std::string_view global_salt, std::string_view primary_password,
                            SecretBytes* plain) {
  const std::optional<DerNode> node = ParseDer(der);
  if (!node || node->children.size() < 2 || node->children[0].children.size() < 2) return PbeResult::kMalformed;
  const DerNode& algorithm = node->children[0];
  const std::string oid = algorithm.children[0].Oid();
  const std::string_view cipher = node->children[1].content;
  if (oid == kOidPbes2) return DecryptPbes2(algorithm.children[1], cipher, global_salt, primary_password, plain);
  if (oid == kOidSha1And3Des) return DecryptLegacy3Des(algorithm.children[1], cipher, global_salt, primary_password, plain);
  return PbeResult::kUnsupported;
}

FirefoxKeys::FirefoxKeys() = default;
FirefoxKeys::~FirefoxKeys() = default;
FirefoxKeys::FirefoxKeys(FirefoxKeys&&) = default;
FirefoxKeys& FirefoxKeys::operator=(FirefoxKeys&&) = default;

void FirefoxKeys::Add(std::string id, SecretBytes key, bool preferred) {
  if (preferred || keys_.empty()) preferred_ = keys_.size();
  keys_.emplace_back(std::move(id), std::move(key));
}

const SecretBytes* FirefoxKeys::For(std::string_view id) const {
  for (const auto& [key_id, key] : keys_) {
    if (key_id == id) return &key;
  }
  return keys_.empty() ? nullptr : &keys_[preferred_].second;
}

namespace {

std::string_view KeyLabel(std::string_view label) {
  while (!label.empty() && label.back() == '\0') label.remove_suffix(1);
  return label;
}

bool IsApplicationServicesKey(std::string_view label) {
  const std::string_view name = KeyLabel(label);
  return name == kFirefoxLoginsKeyLabel || name == kFirefoxAutofillKeyLabel;
}

FirefoxKey CheckFirefoxPassword(std::string_view global_salt, std::string_view password_check,
                                std::string_view primary_password) {
  SecretBytes check;
  const PbeResult checked = DecryptFirefoxPbe(password_check, global_salt, primary_password, &check);
  if (checked == PbeResult::kUnsupported) return FirefoxKey::kUnsupported;
  if (checked == PbeResult::kMalformed) return FirefoxKey::kMalformed;
  if (checked != PbeResult::kOk || check.value().compare(0, kPasswordCheck.size(), kPasswordCheck) != 0) {
    return FirefoxKey::kLocked;
  }
  return FirefoxKey::kOk;
}

}

FirefoxKey FirefoxMasterKeys(std::string_view global_salt, std::string_view password_check,
                             const std::vector<FirefoxKeyRow>& rows, std::string_view primary_password, FirefoxKeys* keys) {
  const FirefoxKey checked = CheckFirefoxPassword(global_salt, password_check, primary_password);
  if (checked != FirefoxKey::kOk) return checked;
  const std::string_view cka_id(reinterpret_cast<const char*>(kCkaId), sizeof(kCkaId));
  bool unsupported = false;
  bool candidates = false;
  for (const FirefoxKeyRow& row : rows) {
    if (row.a11.empty() || IsApplicationServicesKey(row.a3)) continue;
    candidates = true;
    SecretBytes decrypted;
    const PbeResult result = DecryptFirefoxPbe(row.a11, global_salt, primary_password, &decrypted);
    if (result == PbeResult::kUnsupported) unsupported = true;
    if (result != PbeResult::kOk || decrypted.value().size() < 24) continue;
    keys->Add(row.a102, std::move(decrypted), row.a102 == cka_id);
  }
  if (!keys->empty()) return FirefoxKey::kOk;
  if (!candidates) return FirefoxKey::kMissing;
  return unsupported ? FirefoxKey::kUnsupported : FirefoxKey::kMalformed;
}

bool Base64Decode(std::string_view text, std::string* out) {
  out->clear();
  uint32_t buffer = 0;
  int bits = 0;
  size_t padding = 0;
  for (const char c : text) {
    if (c == '\n' || c == '\r' || c == ' ') continue;
    if (c == '=') {
      ++padding;
      continue;
    }
    if (padding) return false;
    const int value = Base64Value(c);
    if (value < 0) return false;
    buffer = (buffer << 6) | static_cast<uint32_t>(value);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out->push_back(static_cast<char>((buffer >> bits) & 0xff));
    }
  }
  return padding <= 2 && bits < 6;
}

bool DecryptFirefoxField(std::string_view base64, const FirefoxKeys& keys, std::string* plain) {
  plain->clear();
  std::string raw;
  if (!Base64Decode(base64, &raw)) return false;
  const std::optional<DerNode> node = ParseDer(raw);
  if (!node || node->children.size() < 3 || node->children[1].children.size() < 2) return false;
  const std::string oid = node->children[1].children[0].Oid();
  const std::string_view iv = node->children[1].children[1].content;
  const std::string_view cipher = node->children[2].content;
  const SecretBytes* key = keys.For(node->children[0].content);
  if (!key) return false;
  const std::string& material = key->value();
  bool ok = false;
  if (oid == kOid3DesCbc && material.size() >= 24) {
    ok = Cipher(EVP_des_ede3_cbc(), std::string_view(material).substr(0, 24), iv, cipher, true, plain);
  } else if (oid == kOidAes256Cbc && material.size() >= 32) {
    ok = Cipher(EVP_aes_256_cbc(), std::string_view(material).substr(0, 32), iv, cipher, true, plain);
  }
  if (!ok || !ValidUtf8Text(*plain)) {
    Wipe(*plain);
    plain->clear();
    return false;
  }
  return true;
}

bool DecompressLz4Block(std::string_view source, size_t expected, std::string* out) {
  out->clear();
  if (expected > kMaxMozLz4Bytes) return false;
  out->reserve(expected);
  size_t in = 0;
  const auto byte = [&](uint8_t* value) {
    if (in >= source.size()) return false;
    *value = static_cast<uint8_t>(source[in++]);
    return true;
  };
  const auto extended = [&](size_t* length) {
    uint8_t next = 255;
    while (next == 255) {
      if (!byte(&next)) return false;
      *length += next;
      if (*length > expected) return false;
    }
    return true;
  };
  while (in < source.size()) {
    uint8_t token = 0;
    if (!byte(&token)) return false;
    size_t literals = token >> 4;
    if (literals == 15 && !extended(&literals)) return false;
    if (literals > source.size() - in || out->size() + literals > expected) return false;
    out->append(source.substr(in, literals));
    in += literals;
    if (in == source.size()) break;
    uint8_t low = 0;
    uint8_t high = 0;
    if (!byte(&low) || !byte(&high)) return false;
    const size_t offset = static_cast<size_t>(low) | (static_cast<size_t>(high) << 8);
    if (offset == 0 || offset > out->size()) return false;
    size_t match = token & 0x0f;
    if (match == 15 && !extended(&match)) return false;
    match += 4;
    if (out->size() + match > expected) return false;
    const size_t from = out->size() - offset;
    for (size_t i = 0; i < match; ++i) out->push_back((*out)[from + i]);
  }
  return out->size() == expected;
}

bool DecompressMozLz4(std::string_view data, std::string* out) {
  constexpr std::string_view kMagic("mozLz40\0", 8);
  if (data.size() <= 12 || data.substr(0, 8) != kMagic) return false;
  const size_t size = static_cast<uint8_t>(data[8]) | (static_cast<size_t>(static_cast<uint8_t>(data[9])) << 8) |
                      (static_cast<size_t>(static_cast<uint8_t>(data[10])) << 16) |
                      (static_cast<size_t>(static_cast<uint8_t>(data[11])) << 24);
  if (size == 0 || size > kMaxMozLz4Bytes) return false;
  return DecompressLz4Block(data.substr(12), size, out);
}

FirefoxKey FirefoxPasswordState(std::string_view global_salt, std::string_view password_check,
                                std::string_view primary_password) {
  return CheckFirefoxPassword(global_salt, password_check, primary_password);
}

FirefoxKey FirefoxNamedKey(std::string_view global_salt, std::string_view password_check,
                           const std::vector<FirefoxKeyRow>& rows, std::string_view primary_password,
                           std::string_view label, SecretBytes* key) {
  const FirefoxKey checked = CheckFirefoxPassword(global_salt, password_check, primary_password);
  if (checked != FirefoxKey::kOk) return checked;
  bool unsupported = false;
  bool found = false;
  for (const FirefoxKeyRow& row : rows) {
    if (row.a11.empty() || KeyLabel(row.a3) != label) continue;
    found = true;
    SecretBytes decrypted;
    const PbeResult result = DecryptFirefoxPbe(row.a11, global_salt, primary_password, &decrypted);
    if (result == PbeResult::kUnsupported) unsupported = true;
    if (result != PbeResult::kOk || decrypted.value().size() != 32) continue;
    *key = std::move(decrypted);
    return FirefoxKey::kOk;
  }
  if (!found) return FirefoxKey::kMissing;
  return unsupported ? FirefoxKey::kUnsupported : FirefoxKey::kMalformed;
}

std::string Base64Encode(std::string_view data) {
  static constexpr char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve((data.size() + 2) / 3 * 4);
  size_t i = 0;
  for (; i + 2 < data.size(); i += 3) {
    const uint32_t triple = (static_cast<uint8_t>(data[i]) << 16) | (static_cast<uint8_t>(data[i + 1]) << 8) |
                            static_cast<uint8_t>(data[i + 2]);
    out.push_back(kAlphabet[(triple >> 18) & 63]);
    out.push_back(kAlphabet[(triple >> 12) & 63]);
    out.push_back(kAlphabet[(triple >> 6) & 63]);
    out.push_back(kAlphabet[triple & 63]);
  }
  if (i < data.size()) {
    const bool two = i + 1 < data.size();
    const uint32_t triple = (static_cast<uint8_t>(data[i]) << 16) | (two ? static_cast<uint8_t>(data[i + 1]) << 8 : 0);
    out.push_back(kAlphabet[(triple >> 18) & 63]);
    out.push_back(kAlphabet[(triple >> 12) & 63]);
    out.push_back(two ? kAlphabet[(triple >> 6) & 63] : '=');
    out.push_back('=');
  }
  return out;
}

bool Base64UrlDecode(std::string_view text, std::string* out) {
  std::string standard(text);
  for (char& c : standard) {
    if (c == '-') c = '+';
    else if (c == '_') c = '/';
    else if (c == '+' || c == '/' || c == '=') return false;
  }
  const bool ok = Base64Decode(standard, out);
  Wipe(standard);
  return ok;
}

bool DecryptAesGcm(std::string_view key, std::string_view iv, std::string_view cipher, std::string_view tag,
                   std::string_view aad, std::string* plain) {
  plain->clear();
  const EVP_CIPHER* algorithm = key.size() == 16 ? EVP_aes_128_gcm() : key.size() == 32 ? EVP_aes_256_gcm() : nullptr;
  if (!algorithm || iv.size() != kGcmIvBytes || tag.size() != kGcmTagBytes) return false;
  std::string out(cipher.size() + 16, '\0');
  int written = 0;
  int last = 0;
  int ignored = 0;
  std::string expected(tag);
  EVP_CIPHER_CTX* context = EVP_CIPHER_CTX_new();
  const bool ok =
      context && EVP_DecryptInit_ex(context, algorithm, nullptr, nullptr, nullptr) == 1 &&
      EVP_CIPHER_CTX_ctrl(context, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(iv.size()), nullptr) == 1 &&
      EVP_DecryptInit_ex(context, nullptr, nullptr, Bytes(key), Bytes(iv)) == 1 &&
      (aad.empty() || EVP_DecryptUpdate(context, nullptr, &ignored, Bytes(aad), static_cast<int>(aad.size())) == 1) &&
      EVP_DecryptUpdate(context, reinterpret_cast<unsigned char*>(out.data()), &written, Bytes(cipher),
                        static_cast<int>(cipher.size())) == 1 &&
      EVP_CIPHER_CTX_ctrl(context, EVP_CTRL_GCM_SET_TAG, static_cast<int>(expected.size()), expected.data()) == 1 &&
      EVP_DecryptFinal_ex(context, reinterpret_cast<unsigned char*>(out.data()) + written, &last) == 1;
  EVP_CIPHER_CTX_free(context);
  if (!ok || written < 0 || last < 0) {
    Wipe(out);
    return false;
  }
  plain->assign(out, 0, static_cast<size_t>(written + last));
  Wipe(out);
  return true;
}

bool DecryptFirefoxJwe(std::string_view compact, const SecretBytes& key, std::string* plain) {
  plain->clear();
  std::vector<std::string_view> parts;
  size_t start = 0;
  while (parts.size() < 6) {
    const size_t dot = compact.find('.', start);
    parts.push_back(compact.substr(start, dot == std::string_view::npos ? std::string_view::npos : dot - start));
    if (dot == std::string_view::npos) break;
    start = dot + 1;
  }
  if (parts.size() != 5 || !parts[1].empty() || key.value().size() != 32) return false;
  std::string header;
  std::string iv;
  std::string cipher;
  std::string tag;
  if (!Base64UrlDecode(parts[0], &header) || !Base64UrlDecode(parts[2], &iv) || !Base64UrlDecode(parts[3], &cipher) ||
      !Base64UrlDecode(parts[4], &tag)) {
    return false;
  }
  std::string compactHeader;
  for (const char c : header) {
    if (c != ' ' && c != '\n' && c != '\r' && c != '\t') compactHeader.push_back(c);
  }
  if (compactHeader.find("\"alg\":\"dir\"") == std::string::npos ||
      compactHeader.find("\"enc\":\"A256GCM\"") == std::string::npos) {
    return false;
  }
  const bool ok = DecryptAesGcm(key.value(), iv, cipher, tag, parts[0], plain) && ValidUtf8Text(*plain);
  if (!ok) {
    Wipe(*plain);
    plain->clear();
  }
  return ok;
}

bool DecryptFirefoxOsKeyStore(std::string_view base64, const SecretBytes& key, std::string* plain) {
  plain->clear();
  std::string raw;
  if (!Base64Decode(base64, &raw) || raw.size() < kGcmIvBytes + kGcmTagBytes) return false;
  const std::string_view bytes(raw);
  const bool ok = DecryptAesGcm(key.value(), bytes.substr(0, kGcmIvBytes),
                                bytes.substr(kGcmIvBytes, bytes.size() - kGcmIvBytes - kGcmTagBytes),
                                bytes.substr(bytes.size() - kGcmTagBytes), std::string_view(), plain) &&
                  ValidUtf8Text(*plain);
  Wipe(raw);
  if (!ok) {
    Wipe(*plain);
    plain->clear();
  }
  return ok;
}

std::optional<SecretBytes> FirefoxOsKeyStoreKey(std::string_view secret) {
  std::string raw;
  if (!Base64Decode(secret, &raw) || (raw.size() != 16 && raw.size() != 32)) {
    Wipe(raw);
    return std::nullopt;
  }
  return SecretBytes(std::move(raw));
}

}
