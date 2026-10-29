#ifndef ARDIA_LINUX_AC_LINUX_IMPORT_CRYPTO_H_
#define ARDIA_LINUX_AC_LINUX_IMPORT_CRYPTO_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace ardia::linux_import {

class SecretBytes {
 public:
  SecretBytes();
  explicit SecretBytes(std::string value);
  SecretBytes(SecretBytes&& other);
  SecretBytes& operator=(SecretBytes&& other);
  SecretBytes(const SecretBytes&) = delete;
  SecretBytes& operator=(const SecretBytes&) = delete;
  ~SecretBytes();

  SecretBytes Copy() const;
  const std::string& value() const { return value_; }
  std::string& mutable_value() { return value_; }
  bool empty() const { return value_.empty(); }
  void Clear();

 private:
  std::string value_;
};

inline constexpr size_t kChromiumKeyBytes = 16;
inline constexpr size_t kMaxMozLz4Bytes = 256u * 1024 * 1024;

SecretBytes DeriveChromiumKey(std::string_view secret);

enum class ValueDecrypt { kOk, kKeyring, kPortal, kFailed };
ValueDecrypt DecryptChromiumBytes(std::string_view blob, const SecretBytes* keyring_key, std::string* plain);
ValueDecrypt DecryptChromiumValue(std::string_view blob, const SecretBytes* keyring_key, std::string_view host_key,
                                  std::string* plain);

bool Sha256(std::string_view data, std::string* digest);

struct DerNode {
  uint8_t tag = 0;
  std::string_view content;
  std::vector<DerNode> children;

  bool constructed() const { return (tag & 0x20) != 0; }
  std::string Oid() const;
  std::optional<uint64_t> Integer() const;
};

std::optional<DerNode> ParseDer(std::string_view data);

inline constexpr std::string_view kOidPbes2 = "1.2.840.113549.1.5.13";
inline constexpr std::string_view kOidPbkdf2 = "1.2.840.113549.1.5.12";
inline constexpr std::string_view kOidHmacSha256 = "1.2.840.113549.2.9";
inline constexpr std::string_view kOidSha1And3Des = "1.2.840.113549.1.12.5.1.3";
inline constexpr std::string_view kOidAes256Cbc = "2.16.840.1.101.3.4.1.42";
inline constexpr std::string_view kOid3DesCbc = "1.2.840.113549.3.7";
inline constexpr size_t kMaxPbkdf2Iterations = 10'000'000;

enum class PbeResult { kOk, kWrongPassword, kUnsupported, kMalformed };
PbeResult DecryptFirefoxPbe(std::string_view der, std::string_view global_salt, std::string_view primary_password,
                            SecretBytes* plain);

struct FirefoxKeyRow {
  std::string a11;
  std::string a102;
  std::string a3;
};

class FirefoxKeys {
 public:
  FirefoxKeys();
  ~FirefoxKeys();
  FirefoxKeys(FirefoxKeys&&);
  FirefoxKeys& operator=(FirefoxKeys&&);

  void Add(std::string id, SecretBytes key, bool preferred);
  const SecretBytes* For(std::string_view id) const;
  bool empty() const { return keys_.empty(); }

 private:
  std::vector<std::pair<std::string, SecretBytes>> keys_;
  size_t preferred_ = 0;
};

enum class FirefoxKey { kOk, kLocked, kUnsupported, kMalformed, kMissing };
FirefoxKey FirefoxMasterKeys(std::string_view global_salt, std::string_view password_check,
                             const std::vector<FirefoxKeyRow>& rows, std::string_view primary_password, FirefoxKeys* keys);

inline constexpr std::string_view kFirefoxLoginsKeyLabel = "as-logins-key";
inline constexpr std::string_view kFirefoxAutofillKeyLabel = "as-autofill-key";
inline constexpr size_t kGcmIvBytes = 12;
inline constexpr size_t kGcmTagBytes = 16;

FirefoxKey FirefoxPasswordState(std::string_view global_salt, std::string_view password_check,
                                std::string_view primary_password);
FirefoxKey FirefoxNamedKey(std::string_view global_salt, std::string_view password_check,
                           const std::vector<FirefoxKeyRow>& rows, std::string_view primary_password,
                           std::string_view label, SecretBytes* key);

bool Base64Decode(std::string_view text, std::string* out);
bool Base64UrlDecode(std::string_view text, std::string* out);
std::string Base64Encode(std::string_view data);
bool DecryptAesGcm(std::string_view key, std::string_view iv, std::string_view cipher, std::string_view tag,
                   std::string_view aad, std::string* plain);
bool DecryptFirefoxJwe(std::string_view compact, const SecretBytes& key, std::string* plain);
bool DecryptFirefoxOsKeyStore(std::string_view base64, const SecretBytes& key, std::string* plain);
std::optional<SecretBytes> FirefoxOsKeyStoreKey(std::string_view secret);
bool DecryptFirefoxField(std::string_view base64, const FirefoxKeys& keys, std::string* plain);

bool DecompressMozLz4(std::string_view data, std::string* out);
bool DecompressLz4Block(std::string_view source, size_t expected, std::string* out);

}

#endif
