#ifndef ARDIA_LINUX_AC_LINUX_IMPORT_SECRETS_H_
#define ARDIA_LINUX_AC_LINUX_IMPORT_SECRETS_H_

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/linux/ac_linux_import_crypto.h"
#include "ardia/linux/ac_linux_import_formats.h"
#include "ardia/linux/ac_linux_import_readers.h"
#include "ardia/linux/ac_linux_import_storage.h"
#include "base/values.h"

namespace ardia::linux_import {

inline constexpr size_t kMaxCookies = 200000;
inline constexpr size_t kMaxAutofillItems = 5000;
inline constexpr size_t kCookieBatch = 500;
inline constexpr size_t kAutofillBatch = 500;

struct ImportedCookie {
  std::string domain;
  std::string name;
  std::string path = "/";
  SecretBytes value;
  double created = 0;
  double expires = 0;
  double last_access = 0;
  bool secure = false;
  bool http_only = false;
  std::string same_site = "unspecified";
  std::string priority = "medium";
  bool partitioned = false;
  std::string partition_site;
  bool partition_cross_site = false;
  std::string source_scheme = "unset";
  int source_port = -1;
};

struct ImportedAddress {
  std::string name;
  std::string organization;
  std::string street;
  std::string city;
  std::string state;
  std::string postal_code;
  std::string country;
  std::string phone;
  std::string email;

  bool Empty() const;
  bool operator==(const ImportedAddress& other) const = default;
};

struct ImportedCard {
  std::string name;
  SecretBytes number;
  int exp_month = 0;
  int exp_year = 0;
  std::string nickname;
};

struct CookieRead {
  std::vector<ImportedCookie> cookies;
  int undecryptable = 0;
  int keyring = 0;
  int portal = 0;
  int skipped = 0;
};

struct AutofillRead {
  std::vector<ImportedAddress> addresses;
  std::vector<ImportedCard> cards;
  int undecryptable = 0;
  int locked_cards = 0;
  int keyring_cards = 0;
  int portal = 0;
  std::vector<std::string> notes;
};

struct FirefoxLoginsRead {
  std::vector<Credential> credentials;
  int undecryptable = 0;
  std::vector<std::string> notes;
};

struct FirefoxKeyDatabase {
  std::string global_salt;
  std::string check;
  std::vector<FirefoxKeyRow> rows;
};

enum class FirefoxLock { kNone, kPrimaryPassword, kOpened };

std::optional<Failure> ReadChromiumCookies(const std::string& directory, ScratchDirectory& scratch,
                                           ImportObserver& observer, const SecretBytes* key, double now_ms,
                                           CookieRead* out, bool* cancelled);
std::optional<Failure> ReadFirefoxCookies(const std::string& directory, ScratchDirectory& scratch,
                                          ImportObserver& observer, double now_ms, CookieRead* out, bool* cancelled);
std::optional<Failure> ReadChromiumAutofill(const std::string& directory, ScratchDirectory& scratch,
                                            ImportObserver& observer, const SecretBytes* key, AutofillRead* out,
                                            bool* cancelled);
std::optional<Failure> ReadFirefoxLogins(const std::string& directory, ScratchDirectory& scratch,
                                         ImportObserver& observer, std::string_view primary_password,
                                         FirefoxLoginsRead* out, bool* cancelled);
std::optional<Failure> ReadFirefoxAutofill(const std::string& directory, ScratchDirectory& scratch,
                                           ImportObserver& observer, std::string_view primary_password,
                                           const SecretBytes* card_key, AutofillRead* out, bool* cancelled);
FirefoxLock FirefoxProfileLock(const std::string& directory, ScratchDirectory& scratch, const ImportObserver& observer,
                               std::string_view primary_password);
bool FirefoxCardsNeedKeyring(const std::string& directory, ScratchDirectory& scratch, const ImportObserver& observer);

struct ImportedData {
  std::vector<ImportedCookie> cookies;
  std::vector<ImportedAddress> addresses;
  std::vector<ImportedCard> cards;
  bool empty() const { return cookies.empty() && addresses.empty() && cards.empty(); }
};

class ImportedVault {
 public:
  ImportedVault();
  ~ImportedVault();
  ImportedVault(const ImportedVault&) = delete;
  ImportedVault& operator=(const ImportedVault&) = delete;

  bool Put(std::string_view owner, std::string_view token, ImportedData data, double now);
  std::optional<ImportedData> Take(std::string_view owner, std::string_view token, double now);
  bool Discard(std::string_view owner, std::string_view token);
  void DiscardOwner(std::string_view owner);
  void Expire(double now);
  void Clear();
  size_t size() const { return entries_.size(); }

 private:
  struct Entry {
    std::string owner;
    std::string token;
    ImportedData data;
    double at = 0;
  };
  std::vector<Entry> entries_;
};

class UnlockedKeys {
 public:
  UnlockedKeys();
  ~UnlockedKeys();
  UnlockedKeys(const UnlockedKeys&) = delete;
  UnlockedKeys& operator=(const UnlockedKeys&) = delete;

  void Set(std::string_view owner, std::string_view browser, SecretBytes secret, double now);
  std::optional<SecretBytes> Copy(std::string_view owner, std::string_view browser, double now) const;
  void Forget(std::string_view owner);
  void Expire(double now);
  void Clear();
  size_t size() const { return entries_.size(); }

 private:
  struct Entry {
    std::string owner;
    std::string browser;
    SecretBytes secret;
    double at = 0;
  };
  std::vector<Entry> entries_;
};

bool ReplyLeaksImported(const base::Value& reply, const std::vector<ImportedCookie>& cookies,
                        const std::vector<ImportedCard>& cards);

bool OutcomeLeaks(const ImportOutcome& outcome);

bool FirefoxPartitionSite(std::string_view key, std::string* site, bool* cross_site);
bool CardDigits(std::string_view number, std::string* digits);

void AppendJsonString(std::string_view text, std::string* out);
SecretBytes CookiesPayload(const std::vector<ImportedCookie>& cookies, size_t begin, size_t end, int* dropped);
SecretBytes AutofillPayload(const std::vector<ImportedAddress>& addresses, const std::vector<ImportedCard>& cards,
                            size_t begin, size_t end);

}

#endif
