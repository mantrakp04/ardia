#pragma once

#include <dpapi.h>
#include <winrt/Windows.Data.Json.h>

#include <array>
#include <chrono>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "ImportFiles.h"

#pragma comment(lib, "bcrypt.lib")

namespace Ardia {

namespace ImportSecrets {

inline constexpr size_t kKeyBytes = 32;
inline constexpr size_t kNonceBytes = 12;
inline constexpr size_t kTagBytes = 16;
inline constexpr size_t kCookieBatch = 500;
inline constexpr size_t kHostHashBytes = 32;
inline constexpr auto kVaultLifetime = std::chrono::minutes(10);
inline constexpr int64_t kWebKitEpochOffset = 11644473600000000;

using Key = std::array<uint8_t, kKeyBytes>;

class Wiped {
 public:
  Wiped() = default;
  ~Wiped() noexcept { Wipe(); }
  Wiped(Wiped const &) = delete;
  Wiped &operator=(Wiped const &) = delete;

  void Append(std::string_view text) { Append(reinterpret_cast<const uint8_t *>(text.data()), text.size()); }
  void Append(const uint8_t *data, size_t size) {
    if (m_bytes.size() + size > m_bytes.capacity()) {
      std::vector<uint8_t> grown;
      grown.reserve(std::max<size_t>(64 * 1024, (m_bytes.size() + size) * 2));
      grown.insert(grown.end(), m_bytes.begin(), m_bytes.end());
      Wipe();
      m_bytes.swap(grown);
    }
    m_bytes.insert(m_bytes.end(), data, data + size);
  }
  void Resize(size_t size) {
    if (size > m_bytes.capacity()) {
      Wipe();
      m_bytes.reserve(size);
    }
    m_bytes.resize(size);
  }
  uint8_t *Data() noexcept { return m_bytes.data(); }
  size_t Size() const noexcept { return m_bytes.size(); }
  std::string_view View() const noexcept { return {reinterpret_cast<const char *>(m_bytes.data()), m_bytes.size()}; }
  void Wipe() noexcept {
    if (m_bytes.capacity()) SecureZeroMemory(m_bytes.data(), m_bytes.capacity());
    m_bytes.clear();
  }

 private:
  std::vector<uint8_t> m_bytes;
};

inline bool Unprotect(const uint8_t *data, size_t size, Wiped &out) noexcept {
  DATA_BLOB in{static_cast<DWORD>(size), const_cast<BYTE *>(data)};
  DATA_BLOB plain{};
  if (size > 0x7fffffff || !CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &plain)) return false;
  try {
    out.Wipe();
    out.Append(plain.pbData, plain.cbData);
  } catch (...) {
  }
  SecureZeroMemory(plain.pbData, plain.cbData);
  LocalFree(plain.pbData);
  return out.Size() == plain.cbData;
}

struct LocalStateKey {
  std::optional<Key> key;
  bool appBound = false;
};

inline LocalStateKey ReadLocalStateKey(std::filesystem::path const &localState) noexcept {
  LocalStateKey found;
  try {
    auto bytes = ImportFiles::ReadBytes(localState, 64ull << 20);
    if (!bytes || !Files::IsValidUtf8(*bytes)) return found;
    winrt::Windows::Data::Json::JsonObject top{nullptr};
    if (!winrt::Windows::Data::Json::JsonObject::TryParse(winrt::to_hstring(*bytes), top)) return found;
    auto crypt = top.GetNamedObject(L"os_crypt", nullptr);
    if (!crypt) return found;
    found.appBound = crypt.HasKey(L"app_bound_encrypted_key");
    std::string wrapped = winrt::to_string(crypt.GetNamedString(L"encrypted_key", L""));
    if (wrapped.empty()) return found;
    DWORD size = 0;
    if (!CryptStringToBinaryA(wrapped.c_str(), static_cast<DWORD>(wrapped.size()), CRYPT_STRING_BASE64, nullptr, &size, nullptr, nullptr)) return found;
    std::vector<uint8_t> blob(size);
    if (!CryptStringToBinaryA(wrapped.c_str(), static_cast<DWORD>(wrapped.size()), CRYPT_STRING_BASE64, blob.data(), &size, nullptr, nullptr)) return found;
    constexpr std::string_view kDpapi = "DPAPI";
    if (size <= kDpapi.size() || std::string_view(reinterpret_cast<const char *>(blob.data()), kDpapi.size()) != kDpapi) return found;
    Wiped plain;
    if (Unprotect(blob.data() + kDpapi.size(), size - kDpapi.size(), plain) && plain.Size() == kKeyBytes) {
      Key key{};
      memcpy(key.data(), plain.Data(), kKeyBytes);
      found.key = key;
      SecureZeroMemory(key.data(), key.size());
    }
  } catch (...) {
  }
  return found;
}

class Gcm {
 public:
  explicit Gcm(Key const &key) noexcept {
    if (BCryptOpenAlgorithmProvider(&m_algorithm, BCRYPT_AES_ALGORITHM, nullptr, 0) != 0) return;
    auto mode = const_cast<wchar_t *>(BCRYPT_CHAIN_MODE_GCM);
    if (BCryptSetProperty(m_algorithm, BCRYPT_CHAINING_MODE, reinterpret_cast<PUCHAR>(mode), sizeof(BCRYPT_CHAIN_MODE_GCM), 0) != 0) return;
    BCryptGenerateSymmetricKey(m_algorithm, &m_key, nullptr, 0, const_cast<PUCHAR>(key.data()), static_cast<ULONG>(key.size()), 0);
  }
  ~Gcm() noexcept {
    if (m_key) BCryptDestroyKey(m_key);
    if (m_algorithm) BCryptCloseAlgorithmProvider(m_algorithm, 0);
  }
  Gcm(Gcm const &) = delete;
  Gcm &operator=(Gcm const &) = delete;

  bool Decrypt(const uint8_t *sealed, size_t size, Wiped &out) noexcept {
    if (!m_key || size < kNonceBytes + kTagBytes) return false;
    size_t body = size - kNonceBytes - kTagBytes;
    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
    BCRYPT_INIT_AUTH_MODE_INFO(info);
    info.pbNonce = const_cast<PUCHAR>(sealed);
    info.cbNonce = kNonceBytes;
    info.pbTag = const_cast<PUCHAR>(sealed + kNonceBytes + body);
    info.cbTag = kTagBytes;
    try {
      out.Resize(body);
    } catch (...) {
      return false;
    }
    ULONG written = 0;
    NTSTATUS status = BCryptDecrypt(m_key, const_cast<PUCHAR>(sealed + kNonceBytes), static_cast<ULONG>(body), &info, nullptr, 0,
                                    body ? out.Data() : nullptr, static_cast<ULONG>(body), &written, 0);
    if (status != 0 || written != body) {
      out.Wipe();
      return false;
    }
    return true;
  }

 private:
  BCRYPT_ALG_HANDLE m_algorithm = nullptr;
  BCRYPT_KEY_HANDLE m_key = nullptr;
};

enum class Opened { plain, appBound, failed };

inline Opened OpenValue(Gcm *gcm, const uint8_t *value, size_t size, Wiped &out) noexcept {
  if (size >= 3 && value[0] == 'v' && value[1] == '2' && value[2] == '0') return Opened::appBound;
  if (size >= 3 && value[0] == 'v' && value[1] == '1' && (value[2] == '0' || value[2] == '1'))
    return gcm && gcm->Decrypt(value + 3, size - 3, out) ? Opened::plain : Opened::failed;
  return Unprotect(value, size, out) ? Opened::plain : Opened::failed;
}

inline bool Sha256(std::string_view text, std::array<uint8_t, kHostHashBytes> &digest) noexcept {
  return BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0, reinterpret_cast<PUCHAR>(const_cast<char *>(text.data())), static_cast<ULONG>(text.size()),
                    digest.data(), static_cast<ULONG>(digest.size())) == 0;
}

inline double FromWebKit(int64_t micros) noexcept {
  return micros > 0 ? static_cast<double>(micros - kWebKitEpochOffset) / 1000.0 : 0;
}

struct Counted {
  size_t undecryptable = 0;
  size_t appBound = 0;
  void Note(Opened opened) noexcept {
    if (opened == Opened::appBound) appBound++;
    else if (opened == Opened::failed) undecryptable++;
  }
  std::string Json() const { return "\"undecryptable\":" + std::to_string(undecryptable) + ",\"appBound\":" + std::to_string(appBound); }
};

inline const char *SameSite(std::optional<int64_t> value) noexcept {
  if (value == 0) return "none";
  if (value == 1) return "lax";
  if (value == 2) return "strict";
  return "unspecified";
}

inline const char *Priority(std::optional<int64_t> value) noexcept {
  if (value == 0) return "low";
  if (value == 2) return "high";
  return "medium";
}

inline const char *SourceScheme(std::optional<int64_t> value) noexcept {
  if (value == 1) return "nonSecure";
  if (value == 2) return "secure";
  return "unset";
}

struct VaultEntry {
  std::vector<std::unique_ptr<Wiped>> batches;
  std::vector<std::unique_ptr<Wiped>> autofill;
  size_t dropped = 0;
  std::chrono::steady_clock::time_point kept = std::chrono::steady_clock::now();
};

struct Store {
  std::mutex lock;
  std::map<std::string, Key> keys;
  std::map<std::string, std::shared_ptr<VaultEntry>> vault;
  uint64_t generation = 0;

  static Store &Shared() noexcept {
    static Store store;
    return store;
  }

  std::optional<Key> KeyFor(std::string const &browser) {
    std::lock_guard guard{lock};
    auto found = keys.find(browser);
    if (found == keys.end()) return std::nullopt;
    return found->second;
  }

  void Forget() noexcept {
    std::lock_guard guard{lock};
    generation++;
    for (auto &[name, key] : keys) SecureZeroMemory(key.data(), key.size());
    keys.clear();
    vault.clear();
  }

  uint64_t Generation() {
    std::lock_guard guard{lock};
    return generation;
  }

  void PurgeLocked() noexcept {
    auto cutoff = std::chrono::steady_clock::now() - kVaultLifetime;
    for (auto it = vault.begin(); it != vault.end();) it = it->second->kept < cutoff ? vault.erase(it) : std::next(it);
  }

  void Purge() noexcept {
    std::lock_guard guard{lock};
    PurgeLocked();
  }

  std::shared_ptr<VaultEntry> Take(std::string const &token) {
    std::lock_guard guard{lock};
    PurgeLocked();
    auto found = vault.find(token);
    if (found == vault.end()) return nullptr;
    auto entry = found->second;
    vault.erase(found);
    return entry;
  }

  std::string Keep(std::shared_ptr<VaultEntry> entry, uint64_t started) {
    std::array<uint8_t, 16> random{};
    BCryptGenRandom(nullptr, random.data(), static_cast<ULONG>(random.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    std::string token;
    char hex[3];
    for (uint8_t byte : random) {
      snprintf(hex, sizeof(hex), "%02x", byte);
      token.append(hex);
    }
    {
      std::lock_guard guard{lock};
      PurgeLocked();
      if (generation != started) return {};
      vault[token] = std::move(entry);
    }
    try {
      std::thread([]() noexcept {
        std::this_thread::sleep_for(kVaultLifetime + std::chrono::seconds(5));
        Store::Shared().Purge();
      }).detach();
    } catch (...) {
    }
    return token;
  }

  std::string Attach(std::string const &token, std::vector<std::unique_ptr<Wiped>> autofill, uint64_t started) {
    if (!token.empty()) {
      std::lock_guard guard{lock};
      PurgeLocked();
      if (generation != started) return {};
      auto found = vault.find(token);
      if (found != vault.end()) {
        for (auto &batch : autofill) found->second->autofill.push_back(std::move(batch));
        return token;
      }
    }
    auto entry = std::make_shared<VaultEntry>();
    entry->autofill = std::move(autofill);
    return Keep(entry, started);
  }
};

inline std::string Unlock(std::string const &browser, std::filesystem::path const &localState) {
  uint64_t started = 0;
  {
    std::lock_guard guard{Store::Shared().lock};
    started = Store::Shared().generation;
  }
  LocalStateKey found = ReadLocalStateKey(localState);
  bool unlocked = false;
  if (found.key) {
    std::lock_guard guard{Store::Shared().lock};
    if (Store::Shared().generation == started) {
      Store::Shared().keys[browser] = *found.key;
      unlocked = true;
    }
    SecureZeroMemory(found.key->data(), found.key->size());
  }
  return std::string{"{\"unlocked\":"} + (unlocked ? "true" : "false") + ",\"appBound\":" + (found.appBound ? "true" : "false") + "}";
}

inline void AppendLogin(Wiped &items, sqlite3_stmt *row, std::string_view password, int columns[7]) {
  std::string out;
  out.reserve(password.size() * 6 + 512);
  std::string origin = ImportFiles::ColumnText(row, columns[0]);
  std::string realm = ImportFiles::ColumnText(row, columns[1]);
  out.append("{\"url\":");
  ImportFiles::AppendJsonString(out, origin.empty() ? realm : origin);
  out.append(",\"username\":");
  ImportFiles::AppendJsonString(out, ImportFiles::ColumnText(row, columns[2]));
  out.append(",\"password\":");
  ImportFiles::AppendJsonString(out, password);
  if (!realm.empty()) {
    out.append(",\"realm\":");
    ImportFiles::AppendJsonString(out, realm);
  }
  const char *times[] = {"created", "lastUsed"};
  for (int i = 0; i < 2; i++) {
    auto micros = ImportFiles::ColumnInt(row, columns[3 + i]);
    if (!micros || *micros <= 0) continue;
    out.append(",\"").append(times[i]).append("\":");
    ImportFiles::AppendNumber(out, FromWebKit(*micros));
  }
  if (auto used = ImportFiles::ColumnInt(row, columns[5])) out.append(",\"timesUsed\":").append(std::to_string(*used));
  out.push_back('}');
  items.Append(out);
  SecureZeroMemory(out.data(), out.size());
}

inline std::string Logins(std::string const &browser, std::vector<std::filesystem::path> const &files) {
  auto key = Store::Shared().KeyFor(browser);
  std::unique_ptr<Gcm> gcm = key ? std::make_unique<Gcm>(*key) : nullptr;
  if (key) SecureZeroMemory(key->data(), key->size());
  Wiped list;
  Counted counted;
  size_t items = 0;
  std::string failure;
  auto note = [&failure](std::string const &what) {
    if (failure.empty() || what == "inUse") failure = what;
  };
  Wiped plain;
  for (auto const &file : files) {
    ImportFiles::Snapshot snapshot{file};
    if (!snapshot.Db()) {
      note(snapshot.Failure());
      continue;
    }
    ImportFiles::Table table = ImportFiles::TableIn(snapshot.Db(), "logins");
    if (table == ImportFiles::Table::absent) continue;
    ImportFiles::Statement select{snapshot.Db(), "SELECT * FROM logins"};
    if (table == ImportFiles::Table::broken || !select) {
      note("unreadable");
      continue;
    }
    sqlite3_stmt *row = select.Get();
    int columns[7] = {ImportFiles::ColumnIndex(row, "origin_url"), ImportFiles::ColumnIndex(row, "signon_realm"), ImportFiles::ColumnIndex(row, "username_value"),
                      ImportFiles::ColumnIndex(row, "date_created"), ImportFiles::ColumnIndex(row, "date_last_used"), ImportFiles::ColumnIndex(row, "times_used"),
                      ImportFiles::ColumnIndex(row, "blacklisted_by_user")};
    int value = ImportFiles::ColumnIndex(row, "password_value");
    int step = SQLITE_ROW;
    while ((step = sqlite3_step(row)) == SQLITE_ROW) {
      if (ImportFiles::ColumnInt(row, columns[6]).value_or(0) != 0 || value < 0) continue;
      auto blob = static_cast<const uint8_t *>(sqlite3_column_blob(row, value));
      size_t size = static_cast<size_t>(sqlite3_column_bytes(row, value));
      if (!blob || size == 0) continue;
      Opened opened = OpenValue(gcm.get(), blob, size, plain);
      counted.Note(opened);
      if (opened != Opened::plain || plain.Size() == 0 || !Files::IsValidUtf8(plain.View())) {
        if (opened == Opened::plain) counted.undecryptable += plain.Size() ? 1 : 0;
        plain.Wipe();
        continue;
      }
      if (items++) list.Append(",");
      AppendLogin(list, row, plain.View(), columns);
      plain.Wipe();
    }
    if (step != SQLITE_DONE) note("unreadable");
  }
  std::string out;
  out.reserve(list.Size() + 256);
  out.append("{\"items\":[").append(list.View()).append("],").append(counted.Json());
  if (!failure.empty()) out.append(",\"failure\":").append(ImportFiles::JsonString(failure));
  out.push_back('}');
  return out;
}

inline void AppendCookie(Wiped &batch, sqlite3_stmt *row, std::string const &host, std::string_view value, double expires) {
  std::string head = "{\"name\":";
  ImportFiles::AppendJsonString(head, ImportFiles::ColumnText(row, ImportFiles::ColumnIndex(row, "name")));
  head.append(",\"value\":");
  batch.Append(head);
  std::string quoted;
  quoted.reserve(value.size() * 6 + 2);
  ImportFiles::AppendJsonString(quoted, value);
  batch.Append(quoted);
  SecureZeroMemory(quoted.data(), quoted.size());
  std::string tail = ",\"domain\":";
  ImportFiles::AppendJsonString(tail, host);
  std::string path = ImportFiles::ColumnText(row, ImportFiles::ColumnIndex(row, "path"));
  tail.append(",\"path\":");
  ImportFiles::AppendJsonString(tail, path.empty() ? "/" : path);
  auto time = [&](const char *column, const char *field) {
    auto micros = ImportFiles::ColumnInt(row, ImportFiles::ColumnIndex(row, column));
    if (!micros || *micros <= 0) return;
    tail.append(",\"").append(field).append("\":");
    ImportFiles::AppendNumber(tail, FromWebKit(*micros));
  };
  time("creation_utc", "created");
  if (expires > 0) {
    tail.append(",\"expires\":");
    ImportFiles::AppendNumber(tail, expires);
  }
  time("last_access_utc", "lastAccess");
  auto flag = [&](const char *column) { return ImportFiles::ColumnInt(row, ImportFiles::ColumnIndex(row, column)).value_or(0) != 0; };
  tail.append(flag("is_secure") ? ",\"secure\":true" : ",\"secure\":false");
  tail.append(flag("is_httponly") ? ",\"httpOnly\":true" : ",\"httpOnly\":false");
  tail.append(",\"sameSite\":\"").append(SameSite(ImportFiles::ColumnInt(row, ImportFiles::ColumnIndex(row, "samesite")))).append("\"");
  tail.append(",\"priority\":\"").append(Priority(ImportFiles::ColumnInt(row, ImportFiles::ColumnIndex(row, "priority")))).append("\"");
  std::string topFrame = ImportFiles::ColumnText(row, ImportFiles::ColumnIndex(row, "top_frame_site_key"));
  if (!topFrame.empty()) {
    tail.append(",\"partitionKey\":{\"topLevelSite\":");
    ImportFiles::AppendJsonString(tail, topFrame);
    tail.append(flag("has_cross_site_ancestor") ? ",\"crossSite\":true}" : ",\"crossSite\":false}");
  }
  tail.append(",\"sourceScheme\":\"").append(SourceScheme(ImportFiles::ColumnInt(row, ImportFiles::ColumnIndex(row, "source_scheme")))).append("\"");
  int64_t port = ImportFiles::ColumnInt(row, ImportFiles::ColumnIndex(row, "source_port")).value_or(-1);
  tail.append(",\"sourcePort\":").append(std::to_string(port >= 0 && port <= 65535 ? port : -1)).append("}");
  batch.Append(tail);
}

inline void CloseBatch(Wiped &batch) {
  batch.Append("]}");
  const uint8_t terminator = 0;
  batch.Append(&terminator, 1);
}

inline std::string Cookies(std::string const &browser, std::filesystem::path const &file) {
  uint64_t started = Store::Shared().Generation();
  auto key = Store::Shared().KeyFor(browser);
  std::unique_ptr<Gcm> gcm = key ? std::make_unique<Gcm>(*key) : nullptr;
  if (key) SecureZeroMemory(key->data(), key->size());
  ImportFiles::Snapshot snapshot{file};
  if (!snapshot.Db()) return "{\"failure\":" + ImportFiles::JsonString(snapshot.Failure()) + "}";
  if (ImportFiles::TableIn(snapshot.Db(), "cookies") != ImportFiles::Table::present) return "{\"failure\":\"unreadable\"}";
  int64_t version = 0;
  if (ImportFiles::TableExists(snapshot.Db(), "meta")) {
    ImportFiles::Statement meta{snapshot.Db(), "SELECT CAST(value AS INTEGER) FROM meta WHERE key='version'"};
    if (meta && sqlite3_step(meta.Get()) == SQLITE_ROW) version = sqlite3_column_int64(meta.Get(), 0);
  }
  ImportFiles::Statement select{snapshot.Db(), "SELECT * FROM cookies"};
  if (!select) return "{\"failure\":\"unreadable\"}";
  sqlite3_stmt *row = select.Get();
  int hostColumn = ImportFiles::ColumnIndex(row, "host_key");
  int plainColumn = ImportFiles::ColumnIndex(row, "value");
  int sealedColumn = ImportFiles::ColumnIndex(row, "encrypted_value");
  int persistentColumn = ImportFiles::ColumnIndex(row, "has_expires");
  if (persistentColumn < 0) persistentColumn = ImportFiles::ColumnIndex(row, "is_persistent");
  int expiresColumn = ImportFiles::ColumnIndex(row, "expires_utc");
  double now = static_cast<double>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
  auto entry = std::make_shared<VaultEntry>();
  Counted counted;
  size_t count = 0;
  size_t inBatch = 0;
  Wiped plain;
  int step = SQLITE_ROW;
  while ((step = sqlite3_step(row)) == SQLITE_ROW) {
    std::string host = ImportFiles::ColumnText(row, hostColumn);
    if (host.empty()) continue;
    bool persistent = ImportFiles::ColumnInt(row, persistentColumn).value_or(1) != 0;
    double expires = persistent ? FromWebKit(ImportFiles::ColumnInt(row, expiresColumn).value_or(0)) : 0;
    if (expires > 0 && expires < now) continue;
    auto clear = static_cast<const uint8_t *>(plainColumn >= 0 ? sqlite3_column_blob(row, plainColumn) : nullptr);
    size_t clearSize = plainColumn >= 0 ? static_cast<size_t>(sqlite3_column_bytes(row, plainColumn)) : 0;
    auto sealed = static_cast<const uint8_t *>(sealedColumn >= 0 ? sqlite3_column_blob(row, sealedColumn) : nullptr);
    size_t sealedSize = sealedColumn >= 0 ? static_cast<size_t>(sqlite3_column_bytes(row, sealedColumn)) : 0;
    size_t start = 0;
    if (clearSize && sealedSize) {
      counted.undecryptable++;
      continue;
    }
    plain.Wipe();
    if (clearSize) {
      plain.Append(clear, clearSize);
    } else if (sealedSize) {
      Opened opened = OpenValue(gcm.get(), sealed, sealedSize, plain);
      counted.Note(opened);
      if (opened != Opened::plain) continue;
      if (version >= 24) {
        std::array<uint8_t, kHostHashBytes> digest{};
        if (plain.Size() < kHostHashBytes || !Sha256(host, digest) || memcmp(plain.Data(), digest.data(), kHostHashBytes) != 0) {
          counted.undecryptable++;
          plain.Wipe();
          continue;
        }
        start = kHostHashBytes;
      }
    }
    std::string_view value = plain.View().substr(start);
    if (!Files::IsValidUtf8(value)) {
      entry->dropped++;
      plain.Wipe();
      continue;
    }
    if (entry->batches.empty() || inBatch == kCookieBatch) {
      if (!entry->batches.empty()) CloseBatch(*entry->batches.back());
      entry->batches.push_back(std::make_unique<Wiped>());
      entry->batches.back()->Append("{\"cookies\":[");
      inBatch = 0;
    }
    if (inBatch++) entry->batches.back()->Append(",");
    AppendCookie(*entry->batches.back(), row, host, value, expires);
    plain.Wipe();
    count++;
  }
  if (step != SQLITE_DONE) return "{\"failure\":\"unreadable\"}";
  if (!entry->batches.empty()) CloseBatch(*entry->batches.back());
  std::string token = count ? Store::Shared().Keep(entry, started) : std::string{};
  if (count && token.empty()) return "{\"failure\":\"cancelled\"}";
  std::string out = "{\"count\":" + std::to_string(count) + "," + counted.Json() + ",\"dropped\":" + std::to_string(entry->dropped);
  if (!token.empty()) out.append(",\"token\":").append(ImportFiles::JsonString(token));
  out.push_back('}');
  return out;
}

}

}
