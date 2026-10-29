#ifndef ARDIA_LINUX_AC_LINUX_SYNC_KEYSTORE_H_
#define ARDIA_LINUX_AC_LINUX_SYNC_KEYSTORE_H_

#include <memory>
#include <string>
#include <string_view>

#include "ardia/linux/ac_linux_sync_crypto.h"

namespace ardia::linux_sync {

enum class KeyStatus { kOk, kNotFound, kLocked, kUnavailable };

std::string_view KeyStatusName(KeyStatus status);

class KeyStore {
 public:
  virtual ~KeyStore() = default;
  virtual std::string_view kind() const = 0;
  virtual KeyStatus Load(std::string_view account, Bytes* secret) = 0;
  virtual KeyStatus Save(std::string_view account, const Bytes& secret) = 0;
  virtual KeyStatus Delete(std::string_view account) = 0;
  virtual KeyStatus Probe() = 0;
  virtual bool WritesWithoutPrompt() = 0;
};

inline constexpr char kSecretSchema[] = "dev.ardia.linux.SyncKey";
inline constexpr char kSecretLabel[] = "Ardia Sync Key";
inline constexpr char kSecretLibrary[] = "libsecret-1.so.0";
inline constexpr char kProbeAccount[] = "aaaaaaaaaaaaaaaaaaaaaaaaaa";

struct KeySchema {
  const char* name;
  const char* label;
  const char* file_prefix;
  bool (*valid_account)(std::string_view account);
  size_t max_bytes;
};

const KeySchema& SyncKeySchema();

std::unique_ptr<KeyStore> MakeFileKeyStore(std::string directory, const KeySchema& schema = SyncKeySchema());
std::unique_ptr<KeyStore> MakeSecretServiceKeyStore(std::string library = kSecretLibrary,
                                                    const KeySchema& schema = SyncKeySchema());

KeyStatus ClassifySecretError(std::string_view domain, int code);
bool UseFileKeyStore(bool background, bool explicit_user_data_dir, std::string_view user_data_dir,
                     std::string_view default_user_data_dir);

bool HexDecode(std::string_view text, Bytes* out);
std::string HexEncode(const Bytes& data);

}

#endif
