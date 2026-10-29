#ifndef ARDIA_LINUX_AC_LINUX_IMPORT_FORMATS_H_
#define ARDIA_LINUX_AC_LINUX_IMPORT_FORMATS_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "base/values.h"

namespace ardia::linux_import {

inline constexpr size_t kMaxBookmarksHtmlBytes = 32u * 1024 * 1024;
inline constexpr size_t kMaxPasswordsCsvBytes = 16u * 1024 * 1024;
inline constexpr size_t kMaxBookmarkNodes = 250000;
inline constexpr int kMaxBookmarkDepth = 64;
inline constexpr size_t kMaxCredentials = 50000;
inline constexpr size_t kMaxPathBytes = 4096;
inline constexpr double kVaultLifetimeMs = 10 * 60 * 1000;
inline constexpr size_t kVaultEntriesPerOwner = 8;
inline constexpr double kChosenFileLifetimeMs = 10 * 60 * 1000;
inline constexpr size_t kChosenFiles = 16;
inline constexpr size_t kPasswordChunk = 500;

inline constexpr const char* kImportCapabilities[] = {
    "ArdiaImport.listBrowsers",  "ArdiaImport.startImport",     "ArdiaImport.cancelImport",
    "ArdiaImport.writePasswords", "ArdiaImport.discardPasswords", "ArdiaImport.chooseImportFile",
    "ArdiaImport.importBookmarksHTML", "ArdiaImport.importPasswordsCSV", "ArdiaImport.listExtensions",
    "ArdiaImport.forgetUnlockedKeys", "ArdiaImport.cancelChooser", "ArdiaImport.unlockBrowser",
    "ArdiaImport.writeImported", "ArdiaImport.discardImported"};

void Wipe(std::string& secret);

class Credential {
 public:
  Credential();
  Credential(Credential&& other);
  Credential& operator=(Credential&& other);
  Credential(const Credential&) = delete;
  Credential& operator=(const Credential&) = delete;
  ~Credential();

  std::string url;
  std::string username;
  std::string password;
  std::string realm;
  std::string title;
  std::string note;
  double created = 0;
  double last_used = 0;
  int times_used = 0;
};

std::string OriginOf(std::string_view url);
std::string CredentialKey(const Credential& credential, bool compare_passwords);
size_t RemoveDuplicateCredentials(std::vector<Credential>& credentials, bool compare_passwords);
bool ParseInt64(std::string_view text, int64_t* value);

bool ValidUtf8(std::string_view text);
std::string Latin1ToUtf8(std::string_view text);
std::string DecodeText(std::string_view bytes);

struct BookmarksParse {
  std::optional<base::DictValue> root;
  int links = 0;
  int folders = 0;
  bool truncated = false;
  std::string error_code;
  std::string error;
};

BookmarksParse ParseNetscapeBookmarks(std::string_view html);
int CountBookmarkLinks(const base::DictValue& node);

struct CsvParse {
  std::vector<Credential> credentials;
  int rows = 0;
  int duplicates = 0;
  int invalid = 0;
  std::string error_code;
  std::string error;
};

std::vector<std::vector<std::string>> ParseCsvRows(std::string_view text);
CsvParse ParsePasswordsCsv(std::string_view text);
base::ListValue CredentialSummaries(const std::vector<Credential>& credentials);
bool ReplyLeaksSecret(const base::Value& reply, const std::vector<Credential>& credentials);

std::string ExistingKey(std::string_view url, std::string_view username, std::string_view password);
size_t CountExisting(const std::vector<Credential>& chunk, const std::set<std::string>& existing);

struct PasswordTally {
  int added = 0;
  int existing = 0;
  int conflicts = 0;
  int invalid = 0;
  void AddChunk(size_t number_imported, size_t existing_in_chunk, int chunk_conflicts, int chunk_invalid);
  base::DictValue ToValue() const;
};

struct FirefoxProfileEntry {
  std::string name;
  std::string path;
  bool relative = true;
  bool is_default = false;
};

std::vector<FirefoxProfileEntry> ParseProfilesIni(std::string_view ini);

enum class ProfileTarget { kDefault, kPrivate, kIsolated, kInvalid };
ProfileTarget ClassifyProfile(std::string_view engine_profile);
std::string ProfileErrorCode(ProfileTarget target);

bool ValidJobId(std::string_view id);
bool ValidBrowserId(std::string_view id);
bool ValidProfileId(std::string_view id);
bool ValidToken(std::string_view token);
bool ValidKind(std::string_view kind);
std::vector<std::string> RequestedKinds(const base::ListValue* kinds);
bool ValidChooserKind(std::string_view kind);
bool ValidLocalFile(std::string_view path);

class ChosenFiles {
 public:
  ChosenFiles();
  ~ChosenFiles();

  void Remember(std::string_view owner, std::string_view kind, std::string_view path, double now);
  bool Take(std::string_view owner, std::string_view kind, std::string_view path, double now);
  void Forget(std::string_view owner);
  size_t size() const { return entries_.size(); }

 private:
  struct Entry {
    std::string owner;
    std::string kind;
    std::string path;
    double at = 0;
  };
  std::vector<Entry> entries_;
};

class CredentialVault {
 public:
  CredentialVault();
  ~CredentialVault();
  CredentialVault(const CredentialVault&) = delete;
  CredentialVault& operator=(const CredentialVault&) = delete;

  bool Put(std::string_view owner, std::string_view token, std::vector<Credential> credentials, double now);
  bool Contains(std::string_view owner, std::string_view token, double now);
  std::optional<double> NextExpiry() const;
  std::optional<std::vector<Credential>> Take(std::string_view owner, std::string_view token, double now);
  bool Discard(std::string_view owner, std::string_view token);
  void DiscardOwner(std::string_view owner);
  void Expire(double now);
  void Clear();
  size_t size() const { return entries_.size(); }

 private:
  struct Entry {
    std::string owner;
    std::string token;
    std::vector<Credential> credentials;
    double at = 0;
  };
  std::vector<Entry> entries_;
};

}

#endif
