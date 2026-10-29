#ifndef ARDIA_LINUX_AC_LINUX_IMPORT_READERS_H_
#define ARDIA_LINUX_AC_LINUX_IMPORT_READERS_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/linux/ac_linux_import_crypto.h"
#include "ardia/linux/ac_linux_import_formats.h"
#include "base/values.h"

namespace ardia::linux_import {

inline constexpr size_t kMaxJsonBytes = 64u * 1024 * 1024;
inline constexpr size_t kMaxDatabaseBytes = 2048u * 1024 * 1024;
inline constexpr int kProgressStep = 1000;
inline constexpr int64_t kStaleScratchSeconds = 60 * 60;

enum class Family { kChromium, kFirefox };

struct BrowserDefinition {
  const char* id;
  const char* name;
  Family family;
  bool under_config;
  const char* path;
  bool root_is_profile;
};

const BrowserDefinition* FindBrowser(std::string_view id);
std::vector<const BrowserDefinition*> AllBrowsers();

struct Environment {
  std::string home;
  std::string config_home;
  std::string temp_root;
  std::string own_data_directory;
};

Environment MakeEnvironment(const char* home, const char* config_home, const char* temp_root,
                            std::string own_data_directory);
std::string DataDirectory(const Environment& environment, const BrowserDefinition& browser);
std::optional<std::string> ProfileDirectory(const Environment& environment, const BrowserDefinition& browser,
                                            std::string_view profile_id);
class Keyring;

base::ListValue ListBrowsers(const Environment& environment, Keyring* keyring = nullptr);

enum class FileRead { kOk, kMissing, kTooLarge, kUnreadable };
int RemoveStaleScratch(const std::string& temp_root, int64_t now, int64_t max_age_seconds);
FileRead ReadFileLimited(const std::string& path, size_t max_bytes, std::string* contents);

extern const unsigned char kChromiumBasicKey[16];
extern const unsigned char kChromiumEmptyKey[16];

enum class Decrypted { kOk, kKeyring, kFailed };
Decrypted DecryptChromiumPassword(std::string_view blob, std::string* password);

class ImportObserver {
 public:
  virtual ~ImportObserver() = default;
  virtual bool Cancelled() const = 0;
  virtual void Progress(std::string_view kind, std::string_view phase, int processed, std::optional<int> total) = 0;
};

struct ImportOptions {
  std::optional<int> history_limit;
  std::optional<double> history_since;
  std::optional<SecretBytes> chromium_key;
  std::optional<SecretBytes> firefox_primary_password;
  std::optional<SecretBytes> firefox_card_key;
  double now_ms = 0;
};

struct ImportedCookie;
struct ImportedAddress;
struct ImportedCard;

struct ImportOutcome {
  bool cancelled = false;
  bool withheld = false;
  std::string error_code;
  std::string error;
  base::DictValue result;
  std::vector<Credential> credentials;
  std::vector<ImportedCookie> cookies;
  std::vector<ImportedAddress> addresses;
  std::vector<ImportedCard> cards;

  ImportOutcome();
  ImportOutcome(ImportOutcome&&);
  ImportOutcome& operator=(ImportOutcome&&);
  ~ImportOutcome();
};

ImportOutcome ReadBrowserProfile(const Environment& environment, std::string_view browser_id,
                                 std::string_view profile_id, const std::vector<std::string>& kinds,
                                 const ImportOptions& options, ImportObserver& observer);

base::ListValue ListExtensions(const Environment& environment, std::string_view browser_id,
                               std::string_view profile_id);

struct FirefoxUnlock {
  std::string code;
  std::string message;
  std::optional<SecretBytes> primary_password;
  std::optional<SecretBytes> card_key;
  bool cards_locked = false;
};

FirefoxUnlock UnlockFirefox(const Environment& environment, std::string_view browser_id, SecretBytes primary_password,
                            const std::vector<std::string>& profile_ids, const std::vector<std::string>& kinds,
                            Keyring* keyring, int prompt_timeout_ms);

}

#endif
