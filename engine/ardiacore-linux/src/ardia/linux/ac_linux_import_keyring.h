#ifndef ARDIA_LINUX_AC_LINUX_IMPORT_KEYRING_H_
#define ARDIA_LINUX_AC_LINUX_IMPORT_KEYRING_H_

#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/linux/ac_linux_import_crypto.h"

namespace ardia::linux_import {

inline constexpr std::string_view kSecretSchemaV2 = "chrome_libsecret_os_crypt_password_v2";
inline constexpr std::string_view kSecretSchemaV1 = "chrome_libsecret_os_crypt_password";
inline constexpr std::string_view kFirefoxSecretSchema = "mozilla.firefox";
inline constexpr std::string_view kKWalletAppId = "Ardia";
inline constexpr int kKeyringProbeTimeoutMs = 3000;
inline constexpr int kKeyringPromptTimeoutMs = 120000;

struct SafeStorageItem {
  std::string application;
  std::string kwallet_folder;
  std::string kwallet_key;
  std::string secret_schema;
  std::string secret_label;
};

std::optional<SafeStorageItem> SafeStorageFor(std::string_view browser_id);
std::optional<SafeStorageItem> FirefoxStorageFor(std::string_view browser_id);

enum class KeyringStatus { kOk, kMissing, kLocked, kDenied, kUnavailable };
std::string_view KeyringErrorCode(KeyringStatus status);
std::string KeyringErrorMessage(KeyringStatus status, std::string_view browser_name);

struct KeyringLookup {
  KeyringStatus status = KeyringStatus::kUnavailable;
  SecretBytes secret;
  std::string backend;
};

class Keyring {
 public:
  virtual ~Keyring() = default;
  virtual KeyringStatus Exists(const SafeStorageItem& item, int timeout_ms) = 0;
  virtual KeyringLookup Read(const SafeStorageItem& item, int timeout_ms) = 0;
};

std::unique_ptr<Keyring> SystemKeyring();

}

#endif
