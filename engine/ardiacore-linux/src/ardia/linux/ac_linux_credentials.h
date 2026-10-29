#ifndef ARDIA_LINUX_AC_LINUX_CREDENTIALS_H_
#define ARDIA_LINUX_AC_LINUX_CREDENTIALS_H_

#include <cstddef>
#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace ardia::linux_credentials {

inline constexpr size_t kMaxOriginBytes = 2048;
inline constexpr size_t kMaxUsernameBytes = 1024;
inline constexpr size_t kMaxSecretBytes = 4096;
inline constexpr size_t kMaxFieldBytes = 1024;
inline constexpr size_t kMaxIdBytes = 128;
inline constexpr size_t kMaxPathBytes = 4096;

inline constexpr char kPrivateCredentialsMessage[] =
    "Saved passwords and autofill data aren't available in a private window";
inline constexpr char kPasswordsEnabledPref[] = "credentials_enable_service";
inline constexpr char kAddressesEnabledPref[] = "autofill.profile_enabled";
inline constexpr char kCardsEnabledPref[] = "autofill.credit_card_enabled";

inline constexpr const char* kCapabilities[] = {
    "ArdiaPasswords.status", "ArdiaPasswords.unlock",   "ArdiaPasswords.reveal",
    "ArdiaPasswords.save",   "ArdiaPasswords.update",   "ArdiaPasswords.export",
    "ArdiaAutofill.status",  "ArdiaAutofill.saveCard",  "ArdiaAutofill.cardNumber"};

void Wipe(std::string& text);

class SecretText {
 public:
  SecretText() = default;
  explicit SecretText(std::string&& text);
  SecretText(SecretText&& other) noexcept;
  SecretText& operator=(SecretText&& other) noexcept;
  SecretText(const SecretText&) = delete;
  SecretText& operator=(const SecretText&) = delete;
  ~SecretText();

  const std::string& value() const { return text_; }
  const char* c_str() const { return text_.c_str(); }
  bool empty() const { return text_.empty(); }
  void Clear();

 private:
  std::string text_;
};

struct Arg {
  enum class Type { kAbsent, kNull, kString, kBool, kNumber, kObject, kOther };

  Arg();
  Arg(const Arg& other);
  Arg(Arg&& other) noexcept;
  Arg& operator=(const Arg& other);
  Arg& operator=(Arg&& other) noexcept;
  ~Arg();

  static Arg String(std::string_view text);
  static Arg Bool(bool flag);
  static Arg Number(double number);
  static Arg Null();
  static Arg Other();
  static Arg Object(std::vector<std::pair<std::string, Arg>> members);

  const Arg* Find(std::string_view key) const;
  bool is_string() const { return type == Type::kString; }

  Type type = Type::kAbsent;
  std::string text;
  bool flag = false;
  double number = 0;
  std::vector<std::pair<std::string, Arg>> object;
};

enum class Store { kPasswords, kAddresses, kCards };
enum class StoreError { kNone, kTemporary, kKeychain, kInactionable, kOther };
enum class Protection { kUnknown, kNone, kKeyring, kPortal, kObfuscated };

inline constexpr char kProtectionProbeText[] = "ardia protection probe";

Protection ProtectionFromCiphertext(std::string_view ciphertext);

struct Storage {
  std::string protection;
  bool fallback = false;
  std::string label;
};

Storage DescribeStorage(std::string_view backend, Protection protection);

struct Probe {
  bool private_profile = false;
  bool service = true;
  StoreError error = StoreError::kNone;
  bool encryption = true;
  bool decryption = true;
  Protection protection = Protection::kUnknown;
};

struct Availability {
  bool available = true;
  std::string reason;
  std::string code;
  std::string message;
};

Availability Assess(Store store, const Probe& probe);

inline constexpr int64_t kStoreReadyTimeoutMs = 10000;
inline constexpr int64_t kStoreReadyPollMs = 50;

bool AwaitsStore(StoreError error, int64_t waited_ms);

enum class Reply {
  kAsIs,
  kOk,
  kNull,
  kPassword,
  kUnlocked,
  kCardNumber,
  kExport,
  kPreferences,
  kPreference,
  kStatus,
};

struct Plan {
  bool ok() const { return code.empty(); }

  std::string code;
  std::string message;
  std::string service;
  SecretText args;
  Reply reply = Reply::kAsIs;
  std::vector<Store> requires_stores;
  std::vector<std::pair<std::string, bool>> writes;
  std::vector<std::pair<std::string, std::string>> reads;
  bool asks_for_path = false;
};

bool HandlesCall(std::string_view name);
bool HandlesInvoke(std::string_view method);
bool ClaimsInvoke(std::string_view method);
inline constexpr size_t kMaxProfileBytes = 256;

Plan PlanCall(std::string_view name, const Arg& input);
Plan PlanInvoke(std::string_view method, const std::vector<Arg>& values);
Plan PlanWindowInvoke(bool private_window, std::string_view method, const std::vector<Arg>& values);
Plan PlanExport(std::string_view path);

struct SyncedLoginPlans {
  bool storable = false;
  Plan remove;
  Plan save;
};

SyncedLoginPlans PlanSyncedLogin(std::string_view profile, std::string_view origin, std::string_view username,
                                 std::string_view password);
bool PasswordsSyncUsable(bool skip_undecryptable, bool service, StoreError error);

std::optional<std::string> NormalizeOrigin(std::string_view origin);

struct Failure {
  std::string code;
  std::string message;
};

Failure ClassifyEngineError(std::string_view engine_message);
std::string ReauthMessage(std::string_view reason);

bool ShouldRemoveFailedExport(std::string_view status, bool existed_before, bool exists_now);
bool RemoveFailedExport(const std::string& path, std::string_view status, bool existed_before);

}

#endif
