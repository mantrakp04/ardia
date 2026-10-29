#ifndef ARDIA_LINUX_AC_LINUX_SYNC_CRYPTO_H_
#define ARDIA_LINUX_AC_LINUX_SYNC_CRYPTO_H_

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace ardia::linux_sync {

using Bytes = std::vector<uint8_t>;

inline constexpr size_t kEntropyBytes = 32;
inline constexpr size_t kPhraseWords = 24;
inline constexpr size_t kWordCount = 2048;
inline constexpr size_t kTagLength = 26;
inline constexpr size_t kNonceBytes = 12;
inline constexpr size_t kTagBytes = 16;
inline constexpr size_t kFilePadding = 1024;
inline constexpr size_t kPasswordPadding = 32;
inline constexpr uint8_t kPasswordVersion = 1;
inline constexpr char kMagic[] = "NNS1";
inline constexpr char kSalt[] = "netnyahoo-sync/v1";

extern const char* const kWordlist[kWordCount];

void Wipe(void* data, size_t size);
void Wipe(Bytes& bytes);
void Wipe(std::string& text);

bool RandomBytes(uint8_t* out, size_t size);
std::optional<Bytes> NewEntropy();
std::string Base32(const uint8_t* data, size_t size);
bool IsTag(std::string_view name);
std::string NewFileId();

std::string Base64Encode(const Bytes& data);
std::optional<Bytes> Base64Decode(std::string_view text);

std::array<uint8_t, 32> Sha256(const uint8_t* data, size_t size);
std::array<uint8_t, 32> HmacSha256(const uint8_t* key, size_t key_size, const uint8_t* data, size_t size);
std::array<uint8_t, 32> Hkdf32(const Bytes& ikm, std::string_view salt, std::string_view info);

enum class OpenError { kNone, kFormat, kAuthentication };

class SyncKeys {
 public:
  explicit SyncKeys(const Bytes& entropy);
  SyncKeys(const SyncKeys&) = delete;
  SyncKeys& operator=(const SyncKeys&) = delete;
  ~SyncKeys();

  const std::string& chain_tag() const { return chain_tag_; }
  std::string ScopeTag(std::string_view scope) const;
  std::string Tag(std::string_view label) const;

  std::optional<Bytes> Seal(const Bytes& payload, std::string_view scope_tag, std::string_view file_id) const;
  std::optional<Bytes> SealWithNonce(const Bytes& payload, std::string_view scope_tag, std::string_view file_id,
                                     const uint8_t* nonce) const;
  OpenError Open(const Bytes& file, std::string_view scope_tag, std::string_view file_id, Bytes* payload) const;

  std::optional<std::string> SealPassword(std::string_view password, std::string_view origin,
                                          std::string_view username) const;
  OpenError OpenPassword(std::string_view sealed, std::string_view origin, std::string_view username,
                         std::string* password) const;

 private:
  std::array<uint8_t, 32> file_key_{};
  std::array<uint8_t, 32> name_key_{};
  std::array<uint8_t, 32> password_key_{};
  std::array<uint8_t, 32> password_nonce_key_{};
  std::string chain_tag_;
};

std::vector<std::string> PhraseWords(const Bytes& entropy);
std::vector<std::string> PhraseTokens(std::string_view text);

struct PhraseProblem {
  enum class Kind { kNone, kWordCount, kUnknownWord, kChecksum };
  Kind kind = Kind::kNone;
  size_t count = 0;
  std::string word;
};

PhraseProblem EntropyFromPhrase(std::string_view text, Bytes* entropy);

}

#endif
