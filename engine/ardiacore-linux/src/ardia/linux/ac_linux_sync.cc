#include "ardia/linux/ac_linux_sync.h"

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <set>
#include <utility>

#include "ardia/linux/ac_linux_sync_vault.h"

namespace ardia::linux_sync {
namespace {

constexpr char kLockedMessage[] = "Sync isn't set up on this device.";
constexpr int64_t kHeldKeyRetrySeconds = 30;
constexpr char kUnreadableMessage[] =
    "This device's sync state couldn't be read safely, so sync is paused to keep it.";

Outcome Argument(std::string_view what) {
  return Outcome::Error("ERR_SYNC_ARGUMENT", std::string(what));
}

const JsonValue* ArgAt(const std::vector<JsonValue>& args, size_t index) {
  return index < args.size() ? &args[index] : nullptr;
}

bool KeyringClosed(KeyStatus status) {
  return status == KeyStatus::kLocked || status == KeyStatus::kUnavailable;
}

const std::string* StringArg(const std::vector<JsonValue>& args, size_t index, size_t limit) {
  const JsonValue* value = ArgAt(args, index);
  if (!value || !value->is_string() || value->text.size() > limit) return nullptr;
  return &value->text;
}

const std::string* FolderArg(const std::vector<JsonValue>& args, size_t index) {
  const std::string* folder = StringArg(args, index, kMaxFolderPathBytes);
  return folder && ValidFolderPath(*folder) ? folder : nullptr;
}

const std::string* AccountArg(const std::vector<JsonValue>& args, size_t index) {
  const std::string* account = StringArg(args, index, kTagLength);
  return account && IsTag(*account) ? account : nullptr;
}

std::optional<std::vector<std::string>> IdList(const std::vector<JsonValue>& args, size_t index) {
  const JsonValue* value = ArgAt(args, index);
  if (!value || !value->is_array() || value->items.size() > kMaxKnownIds) return std::nullopt;
  std::vector<std::string> ids;
  ids.reserve(value->items.size());
  for (const auto& item : value->items) {
    if (!item.is_string() || item.text.size() > 64) return std::nullopt;
    ids.push_back(item.text);
  }
  return ids;
}

JsonValue Strings(const std::vector<std::string>& list) {
  JsonValue array = JsonValue::Array();
  for (const auto& text : list) array.Append(JsonValue::String(text));
  return array;
}

std::string Parent(const std::string& path) {
  const size_t slash = path.find_last_of('/');
  if (slash == std::string::npos || slash == 0) return "/";
  return path.substr(0, slash);
}

bool WriteFileAtomically(const std::string& path, const std::string& contents) {
  const std::string staging = path + ".ardia-staging";
  unlink(staging.c_str());
  const int fd = open(staging.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
  if (fd < 0) return false;
  size_t written = 0;
  bool ok = true;
  while (ok && written < contents.size()) {
    const ssize_t n = write(fd, contents.data() + written, contents.size() - written);
    if (n < 0 && errno == EINTR) continue;
    ok = n > 0;
    if (ok) written += static_cast<size_t>(n);
  }
  ok = ok && fsync(fd) == 0;
  ok = close(fd) == 0 && ok;
  ok = ok && rename(staging.c_str(), path.c_str()) == 0;
  if (!ok) unlink(staging.c_str());
  return ok;
}

}

namespace {

void TakeSecret(std::string& into, std::string& from) {
  Wipe(into);
  into.assign(from.data(), from.size());
  Wipe(from);
  from.clear();
}

}

StoredLogin::StoredLogin(std::string realm, std::string username, std::string&& password, double created_ms)
    : realm(std::move(realm)), username(std::move(username)), created_ms(created_ms) {
  TakeSecret(this->password, password);
}

StoredLogin::StoredLogin(StoredLogin&& other) noexcept
    : realm(std::move(other.realm)), username(std::move(other.username)), created_ms(other.created_ms) {
  TakeSecret(password, other.password);
}

StoredLogin& StoredLogin::operator=(StoredLogin&& other) noexcept {
  if (this != &other) {
    realm = std::move(other.realm);
    username = std::move(other.username);
    created_ms = other.created_ms;
    TakeSecret(password, other.password);
  }
  return *this;
}

StoredLogin::~StoredLogin() {
  Wipe(password);
}

std::optional<std::string> LoginOrigin(std::string_view realm) {
  if (!realm.empty() && realm.back() == '/') realm.remove_suffix(1);
  if (realm.size() > kMaxLoginOriginBytes) return std::nullopt;
  std::string_view host;
  if (realm.starts_with("https://")) {
    host = realm.substr(8);
  } else if (realm.starts_with("http://")) {
    host = realm.substr(7);
  } else {
    return std::nullopt;
  }
  if (host.empty()) return std::nullopt;
  for (const char c : host) {
    const unsigned char byte = static_cast<unsigned char>(c);
    if (c == '/' || byte <= 0x20 || byte == 0x7f) return std::nullopt;
  }
  return std::string(realm);
}

std::optional<std::string> ReadPasswordsProfile(const std::vector<JsonValue>& args) {
  const std::string* profile = StringArg(args, 0, kMaxProfileBytes);
  if (!profile || profile->empty()) return std::nullopt;
  return *profile;
}

std::optional<PasswordSave> ParsePasswordSave(const std::vector<JsonValue>& args) {
  auto profile = ReadPasswordsProfile(args);
  const std::string* origin = StringArg(args, 1, kMaxSyncedFieldBytes);
  const std::string* username = StringArg(args, 2, kMaxSyncedFieldBytes);
  const std::string* sealed = StringArg(args, 3, kMaxSealedPasswordBytes);
  const JsonValue* replacing = ArgAt(args, 4);
  if (!profile || !origin || !username || !sealed || !replacing || replacing->type != JsonValue::Type::kBool) {
    return std::nullopt;
  }
  const bool holdable = LoginOrigin(*origin) == *origin && username->size() <= kMaxLoginUsernameBytes;
  return PasswordSave{std::move(*profile), *origin, *username, *sealed, replacing->flag, holdable};
}

std::optional<Route> RouteOf(std::string_view method) {
  for (const auto& entry : kMethods) {
    if (method == entry.name) return entry.route;
  }
  return std::nullopt;
}

Outcome Outcome::Value(JsonValue value) {
  Outcome outcome;
  outcome.value = std::move(value);
  return outcome;
}

Outcome Outcome::Error(std::string code, std::string message) {
  Outcome outcome;
  outcome.ok = false;
  outcome.code = std::move(code);
  outcome.message = std::move(message);
  return outcome;
}

bool AuthorityLease::Claim(std::string_view caller, int64_t now_ms) {
  if (caller.empty()) return false;
  if (!holder_.empty() && holder_ != caller && now_ms < expires_ms_) return false;
  holder_ = std::string(caller);
  expires_ms_ = now_ms + kAuthorityLeaseMs;
  return true;
}

void AuthorityLease::Release(std::string_view caller) {
  if (!caller.empty() && holder_ == caller) {
    holder_.clear();
    expires_ms_ = 0;
  }
}

bool AuthorityLease::Holds(std::string_view caller, int64_t now_ms) const {
  return !caller.empty() && holder_ == caller && now_ms < expires_ms_;
}

SyncCore::SyncCore(std::unique_ptr<KeyStore> store, CoreOptions options)
    : store_(std::move(store)), options_(std::move(options)) {
  if (options_.device_name.empty()) options_.device_name = HostDeviceName();
}

SyncCore::~SyncCore() {
  SetEntropy(std::nullopt);
}

void SyncCore::SetEntropy(std::optional<Bytes> entropy, std::string account) {
  Wipe(entropy_);
  entropy_.clear();
  keys_.reset();
  key_account_.clear();
  unreadable_ = false;
  ++generation_;
  if (entropy) {
    entropy_ = std::move(*entropy);
    keys_ = std::make_unique<SyncKeys>(entropy_);
    key_account_ = std::move(account);
  }
}

bool SyncCore::HoldsKeyFor(const std::string& account) const {
  return keys_ && !account.empty() && account == key_account_;
}

void SyncCore::SaveHeldKey(int64_t now_seconds) {
  if (unsaved_account_.empty() || !keys_ || now_seconds < next_held_key_save_) return;
  if (unsaved_account_ != key_account_) {
    unsaved_account_.clear();
    return;
  }
  next_held_key_save_ = now_seconds + kHeldKeyRetrySeconds;
  if (!store_->WritesWithoutPrompt()) return;
  last_key_status_ = store_->Save(unsaved_account_, entropy_);
  if (last_key_status_ == KeyStatus::kOk) unsaved_account_.clear();
}

Outcome SyncCore::Dispatch(std::string_view method, const std::vector<JsonValue>& args, int64_t now_seconds) {
  SaveHeldKey(now_seconds);
  if (method == "ArdiaSync.folderInfo") return FolderInfo(args);
  if (method == "ArdiaSync.deviceName") return Outcome::Value(JsonValue::String(options_.device_name));
  if (method == "ArdiaSync.status") return Status();
  if (method == "ArdiaSync.createPhrase") return CreatePhrase(args);
  if (method == "ArdiaSync.enterPhrase") return EnterPhrase(args);
  if (method == "ArdiaSync.unlock") return Unlock(args);
  if (method == "ArdiaSync.forget") return Forget(args);
  if (method == "ArdiaSync.chainStatus") return ChainStatus(args);
  if (method == "ArdiaSync.createChain") return CreateChain(args);
  if (method == "ArdiaSync.write") return Write(args);
  if (method == "ArdiaSync.read") return Read(args, now_seconds);
  if (method == "ArdiaSync.remove") return Remove(args);
  if (method == "ArdiaSync.deleteChain") return DeleteChain(args);
  if (method == "ArdiaSync.sealLocal") return SealLocal(args);
  if (method == "ArdiaSync.openLocal") return OpenLocal(args);
  if (method == "ArdiaSync.recoveryWords") return RecoveryWords();
  return Outcome::Error("ERR_UNKNOWN_CALL", "Unknown sync operation");
}

Outcome SyncCore::FolderInfo(const std::vector<JsonValue>& args) {
  const JsonValue* given = ArgAt(args, 0);
  std::string path = options_.default_folder;
  if (given && given->is_string()) {
    if (!ValidFolderPath(given->text)) return Argument("The sync folder must be an absolute path");
    path = given->text;
  } else if (given && given->type != JsonValue::Type::kNull) {
    return Argument("The sync folder must be a path or null");
  }
  const FolderFacts facts = InspectFolder(path);
  return Outcome::Value(JsonValue::Object({
      {"path", JsonValue::String(path)},
      {"defaultPath", JsonValue::String(options_.default_folder)},
      {"iCloudAvailable", JsonValue::Bool(DirectoryExists(Parent(options_.default_folder)))},
      {"inICloud", JsonValue::Bool(false)},
      {"exists", JsonValue::Bool(facts.exists)},
      {"writable", JsonValue::Bool(facts.writable)},
      {"hasSyncData", JsonValue::Bool(facts.has_sync_data)},
  }));
}

Outcome SyncCore::CreatePhrase(const std::vector<JsonValue>& args) {
  const std::string* account = AccountArg(args, 0);
  if (!account) return Argument("A sync device id is required");
  auto entropy = NewEntropy();
  if (!entropy) return Outcome::Value(JsonValue::Bool(false));
  last_key_status_ = store_->Save(*account, *entropy);
  if (last_key_status_ != KeyStatus::kOk) {
    Wipe(*entropy);
    return Outcome::Value(JsonValue::Bool(false));
  }
  SetEntropy(std::move(entropy), *account);
  unreadable_account_.clear();
  unsaved_account_.clear();
  return Outcome::Value(JsonValue::Bool(true));
}

Outcome SyncCore::EnterPhrase(const std::vector<JsonValue>& args) {
  const std::string* account = AccountArg(args, 0);
  const std::string* text = StringArg(args, 1, kMaxPhraseBytes);
  const std::string* folder = FolderArg(args, 2);
  if (!account || !text || !folder) return Argument("A device id, phrase and folder are required");
  if (text->empty()) return ResumeFromKeyring(*account, *folder);
  Bytes entropy;
  const PhraseProblem problem = EntropyFromPhrase(*text, &entropy);
  switch (problem.kind) {
    case PhraseProblem::Kind::kWordCount:
      return Outcome::Value(JsonValue::Object({{"error", JsonValue::String("wordCount")},
                                               {"count", JsonValue::Number(static_cast<double>(problem.count))}}));
    case PhraseProblem::Kind::kUnknownWord:
      return Outcome::Value(JsonValue::Object({{"error", JsonValue::String("unknownWord")},
                                               {"word", JsonValue::String(problem.word)}}));
    case PhraseProblem::Kind::kChecksum:
      return Outcome::Value(JsonValue::Object({{"error", JsonValue::String("checksum")}}));
    case PhraseProblem::Kind::kNone:
      break;
  }
  bool matches = false;
  {
    const SyncKeys keys(entropy);
    matches = Vault(*folder, keys).ChainExists();
  }
  if (!matches) {
    Wipe(entropy);
    return Outcome::Value(JsonValue::Object({{"error", JsonValue::String(HasSyncData(*folder) ? "mismatch" : "noData")}}));
  }
  last_key_status_ = store_->Save(*account, entropy);
  const bool hold = last_key_status_ != KeyStatus::kOk && KeyringClosed(last_key_status_) && *account == unreadable_account_;
  if (last_key_status_ != KeyStatus::kOk && !hold) {
    Wipe(entropy);
    return Outcome::Value(JsonValue::Object({{"error", JsonValue::String("keychain")}}));
  }
  SetEntropy(std::move(entropy), *account);
  unreadable_account_.clear();
  unsaved_account_ = hold ? *account : std::string();
  next_held_key_save_ = 0;
  return Outcome::Value(JsonValue::Object({{"ok", JsonValue::Bool(true)}}));
}

Outcome SyncCore::ResumeFromKeyring(const std::string& account, const std::string& folder) {
  auto refuse = [] { return Outcome::Value(JsonValue::Object({{"error", JsonValue::String("keychain")}})); };
  auto mismatch = [&folder] {
    return Outcome::Value(JsonValue::Object({{"error", JsonValue::String(HasSyncData(folder) ? "mismatch" : "noData")}}));
  };
  if (HoldsKeyFor(account))
    return Vault(folder, *keys_).ChainExists() ? Outcome::Value(JsonValue::Object({{"ok", JsonValue::Bool(true)}})) : mismatch();
  if (account != unreadable_account_) return refuse();
  Bytes entropy;
  last_key_status_ = store_->Load(account, &entropy);
  if (last_key_status_ != KeyStatus::kOk || entropy.size() != kEntropyBytes) {
    Wipe(entropy);
    return refuse();
  }
  bool matches = false;
  {
    const SyncKeys keys(entropy);
    matches = Vault(folder, keys).ChainExists();
  }
  if (!matches) {
    Wipe(entropy);
    return mismatch();
  }
  SetEntropy(std::move(entropy), account);
  unreadable_account_.clear();
  return Outcome::Value(JsonValue::Object({{"ok", JsonValue::Bool(true)}}));
}

Outcome SyncCore::Unlock(const std::vector<JsonValue>& args) {
  const std::string* account = AccountArg(args, 0);
  if (!account) return Outcome::Value(JsonValue::Bool(false));
  if (HoldsKeyFor(*account)) return Outcome::Value(JsonValue::Bool(true));
  Bytes entropy;
  last_key_status_ = store_->Load(*account, &entropy);
  if (last_key_status_ != KeyStatus::kOk || entropy.size() != kEntropyBytes) {
    Wipe(entropy);
    if (KeyringClosed(last_key_status_)) unreadable_account_ = *account;
    return Outcome::Value(JsonValue::Bool(false));
  }
  SetEntropy(std::move(entropy), *account);
  unreadable_account_.clear();
  return Outcome::Value(JsonValue::Bool(true));
}

Outcome SyncCore::Forget(const std::vector<JsonValue>& args) {
  if (const std::string* account = AccountArg(args, 0)) store_->Delete(*account);
  SetEntropy(std::nullopt);
  unreadable_account_.clear();
  unsaved_account_.clear();
  return Outcome::Value(JsonValue::Null());
}

Outcome SyncCore::ChainStatus(const std::vector<JsonValue>& args) {
  if (!keys_) return Outcome::Error("locked", kLockedMessage);
  const std::string* folder = FolderArg(args, 0);
  if (!folder) return Argument("The sync folder must be an absolute path");
  if (!DirectoryExists(*folder)) return Outcome::Value(JsonValue::String("unavailable"));
  return Outcome::Value(JsonValue::String(Vault(*folder, *keys_).ChainExists() ? "ok" : "missing"));
}

Outcome SyncCore::CreateChain(const std::vector<JsonValue>& args) {
  const std::string* folder = FolderArg(args, 0);
  if (!folder) return Argument("The sync folder must be an absolute path");
  if (!keys_) return Outcome::Error("locked", kLockedMessage);
  const VaultError error = Vault(*folder, *keys_).CreateChain();
  if (!error.ok()) return Outcome::Error("ERR_SYNC_FOLDER", error.message);
  return Outcome::Value(JsonValue::Null());
}

Outcome SyncCore::Write(const std::vector<JsonValue>& args) {
  if (unreadable_) return Outcome::Error("unreadable", kUnreadableMessage);
  if (!keys_) return Outcome::Error("locked", kLockedMessage);
  const std::string* folder = FolderArg(args, 0);
  const std::string* scope = StringArg(args, 1, kMaxScopeBytes);
  const std::string* payload = StringArg(args, 2, kMaxPayloadBytes);
  if (!folder || !scope || !payload) return Argument("A folder, scope and payload are required");
  auto restored = RestoreLegacyPasswords(*payload, *keys_);
  if (!restored) return Outcome::Error("ERR_SYNC_LEGACY", "A legacy saved password couldn't be opened for writing");
  Bytes bytes(restored->begin(), restored->end());
  Wipe(*restored);
  std::string id;
  const VaultError error = Vault(*folder, *keys_).Write(*scope, bytes, &id);
  Wipe(bytes);
  if (!error.ok()) return Outcome::Error("ERR_SYNC_FOLDER", error.message);
  return Outcome::Value(JsonValue::String(id));
}

Outcome SyncCore::Read(const std::vector<JsonValue>& args, int64_t now_seconds) {
  if (!keys_) return Outcome::Error("locked", kLockedMessage);
  const std::string* folder = FolderArg(args, 0);
  const std::string* scope = StringArg(args, 1, kMaxScopeBytes);
  auto known = IdList(args, 2);
  if (!folder || !scope || !known) return Argument("A folder, scope and known file list are required");
  Listing listing = Vault(*folder, *keys_).Read(*scope, *known, now_seconds);
  JsonValue files = JsonValue::Array();
  JsonValue damaged = JsonValue::Array();
  for (const auto& entry : listing.damaged) {
    damaged.Append(JsonValue::Object({{"id", JsonValue::String(entry.id)},
                                      {"age", JsonValue::Number(entry.age_seconds * 1000)}}));
  }
  for (auto& file : listing.files) {
    std::string text = LossyUtf8(file.payload);
    Wipe(file.payload);
    auto hidden = HideLegacyPasswords(text, *keys_);
    Wipe(text);
    if (!hidden) {
      damaged.Append(JsonValue::Object({{"id", JsonValue::String(file.id)}, {"age", JsonValue::Number(0)}}));
      continue;
    }
    files.Append(JsonValue::Object({{"id", JsonValue::String(file.id)}, {"payload", JsonValue::String(std::move(*hidden))}}));
  }
  return Outcome::Value(JsonValue::Object({{"files", std::move(files)},
                                           {"pending", Strings(listing.pending)},
                                           {"damaged", std::move(damaged)},
                                           {"present", Strings(listing.present)}}));
}

Outcome SyncCore::Remove(const std::vector<JsonValue>& args) {
  if (!keys_) return Outcome::Error("locked", kLockedMessage);
  const std::string* folder = FolderArg(args, 0);
  const std::string* scope = StringArg(args, 1, kMaxScopeBytes);
  auto ids = IdList(args, 2);
  if (!folder || !scope || !ids) return Argument("A folder, scope and file list are required");
  Vault(*folder, *keys_).Remove(*scope, *ids);
  return Outcome::Value(JsonValue::Null());
}

Outcome SyncCore::DeleteChain(const std::vector<JsonValue>& args) {
  if (!keys_) return Outcome::Error("locked", kLockedMessage);
  const std::string* folder = FolderArg(args, 0);
  if (!folder) return Argument("The sync folder must be an absolute path");
  const VaultError error = Vault(*folder, *keys_).DeleteChain();
  if (!error.ok()) return Outcome::Error("ERR_SYNC_FOLDER", error.message);
  return Outcome::Value(JsonValue::Null());
}

Outcome SyncCore::SealLocal(const std::vector<JsonValue>& args) {
  if (unreadable_) return Outcome::Error("unreadable", kUnreadableMessage);
  if (!keys_) return Outcome::Error("locked", kLockedMessage);
  const std::string* text = StringArg(args, 0, kMaxPayloadBytes);
  if (!text) return Argument("Text to seal is required");
  const Bytes plain(text->begin(), text->end());
  auto sealed = keys_->Seal(plain, kLocalScopeTag, kLocalFileId);
  if (!sealed) return Outcome::Error("ERR_SYNC_SEAL", "Couldn't seal this device's sync state");
  return Outcome::Value(JsonValue::String(Base64Encode(*sealed)));
}

Outcome SyncCore::OpenLocal(const std::vector<JsonValue>& args) {
  const std::string* sealed = StringArg(args, 0, kMaxPayloadBytes * 2);
  if (!keys_ || !sealed) return Outcome::Value(JsonValue::Null());
  auto data = Base64Decode(*sealed);
  if (!data) return Outcome::Value(JsonValue::Null());
  Bytes plain;
  if (keys_->Open(*data, kLocalScopeTag, kLocalFileId, &plain) != OpenError::kNone)
    return Outcome::Value(JsonValue::Null());
  std::string text = LossyUtf8(plain);
  Wipe(plain);
  auto hidden = HideLegacyPasswords(text, *keys_);
  Wipe(text);
  if (!hidden) {
    unreadable_ = true;
    return Outcome::Value(JsonValue::Null());
  }
  return Outcome::Value(JsonValue::String(std::move(*hidden)));
}

Outcome SyncCore::RecoveryWords() {
  if (!keys_) return Outcome::Error("locked", kLockedMessage);
  return Outcome::Value(Strings(PhraseWords(entropy_)));
}

Outcome SyncCore::Status() {
  return Outcome::Value(JsonValue::Object({
      {"keyStore", JsonValue::String(std::string(store_->kind()))},
      {"keyStoreStatus", JsonValue::String(std::string(KeyStatusName(store_->Probe())))},
      {"lastKeyStatus", JsonValue::String(std::string(KeyStatusName(last_key_status_)))},
      {"unlocked", JsonValue::Bool(keys_ != nullptr)},
      {"unreadable", JsonValue::Bool(unreadable_)},
      {"passwords", JsonValue::Bool(true)},
  }));
}

Outcome SyncCore::SaveKit(const std::string& path, std::string_view created) {
  if (!keys_) return Outcome::Error("locked", kLockedMessage);
  if (!ValidFolderPath(path)) return Argument("The kit path must be absolute");
  std::vector<std::string> words = PhraseWords(entropy_);
  std::string text = KitText(words, created, options_.device_name);
  for (auto& word : words) Wipe(word);
  const bool saved = WriteFileAtomically(path, text);
  Wipe(text);
  if (!saved) return Outcome::Error("ERR_SYNC_KIT", "Couldn't save the Recovery Kit");
  return Outcome::Value(JsonValue::String(path));
}

Outcome SyncCore::SealLogins(LoginRead read) {
  if (!keys_ || !read.complete) return Outcome::Value(JsonValue::Null());
  JsonValue logins = JsonValue::Array();
  std::set<std::pair<std::string, std::string>> seen;
  for (StoredLogin& login : read.logins) {
    auto origin = login.password.empty() || login.password.size() > kMaxLoginPasswordBytes ||
                          login.username.size() > kMaxLoginUsernameBytes
                      ? std::nullopt
                      : LoginOrigin(login.realm);
    if (!origin || !seen.emplace(*origin, login.username).second) continue;
    auto sealed = keys_->SealPassword(login.password, *origin, login.username);
    Wipe(login.password);
    if (!sealed) {
      WipeJson(logins);
      return Outcome::Value(JsonValue::Null());
    }
    logins.Append(JsonValue::Object({{"origin", JsonValue::String(*origin)},
                                     {"username", JsonValue::String(login.username)},
                                     {"sealed", JsonValue::String(std::move(*sealed))},
                                     {"created", JsonValue::Number(login.created_ms)}}));
  }
  return Outcome::Value(std::move(logins));
}

std::optional<StoredLogin> SyncCore::OpenLogin(const PasswordSave& save) {
  if (!keys_) return std::nullopt;
  std::string password;
  if (keys_->OpenPassword(save.sealed, save.origin, save.username, &password) != OpenError::kNone ||
      password.empty() || password.size() > kMaxLoginPasswordBytes) {
    Wipe(password);
    return std::nullopt;
  }
  return StoredLogin(save.origin, save.username, std::move(password), 0);
}

ClipboardWrite PhraseClipboard(std::string words) {
  ClipboardWrite write;
  write.text = std::move(words);
  write.raw.emplace_back(kPasswordManagerHintFormat, kPasswordManagerHintValue);
  return write;
}

std::string KitText(const std::vector<std::string>& words, std::string_view created, std::string_view device) {
  std::string out = "Ardia Recovery Kit\nCreated ";
  out.append(created).append(" on ").append(device).append("\n\n");
  out.append(
      "If you don’t have access to the device on which you first turned on sync, you can still get your synced data on "
      "another device:\n\n");
  out.append("1. Open Ardia › Settings › Sync, and choose the same sync folder.\n");
  out.append("2. Click Enter Recovery Phrase.\n");
  out.append("3. Paste the 24 words below.\n\nRecovery phrase:\n\n");
  for (size_t i = 0; i < words.size(); ++i) {
    char number[8];
    std::snprintf(number, sizeof(number), "%2zu. ", i + 1);
    out.append(number).append(words[i]).append("\n");
  }
  out.append(
      "\nKeep this kit somewhere safe, like a password manager or a printed copy. Anyone with these words and your sync "
      "folder can read your synced data. Ardia can’t recover the words for you: there’s no server and no other copy.\n");
  return out;
}

std::string LossyUtf8(const Bytes& data) {
  std::string out;
  out.reserve(data.size());
  size_t i = 0;
  while (i < data.size()) {
    const uint8_t lead = data[i];
    if (lead < 0x80) {
      out.push_back(static_cast<char>(lead));
      ++i;
      continue;
    }
    const size_t length = (lead & 0xe0) == 0xc0 ? 2 : (lead & 0xf0) == 0xe0 ? 3 : (lead & 0xf8) == 0xf0 ? 4 : 0;
    bool valid = length && i + length <= data.size();
    uint32_t point = valid ? lead & (0x7f >> length) : 0;
    for (size_t k = 1; valid && k < length; ++k) {
      valid = (data[i + k] & 0xc0) == 0x80;
      point = (point << 6) | (data[i + k] & 0x3f);
    }
    valid = valid && !((length == 2 && point < 0x80) || (length == 3 && point < 0x800) ||
                       (length == 4 && point < 0x10000) || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff));
    if (valid) {
      out.append(reinterpret_cast<const char*>(data.data() + i), length);
      i += length;
    } else {
      out.append("\xef\xbf\xbd");
      ++i;
    }
  }
  return out;
}

std::string HostDeviceName() {
  char name[256] = {};
  if (gethostname(name, sizeof(name) - 1) != 0 || !name[0]) return "Linux";
  return LossyUtf8(Bytes(name, name + std::char_traits<char>::length(name)));
}

std::string DefaultFolder(std::string_view home) {
  std::string base = home.empty() ? "/" : std::string(home);
  if (base.back() != '/') base.push_back('/');
  return base + "Ardia Sync";
}

}
