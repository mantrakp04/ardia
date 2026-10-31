#include "ardia/linux/ac_linux_sync_keystore.h"

#include <dlfcn.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <utility>

namespace ardia::linux_sync {
namespace {

using GQuark = uint32_t;

struct GError {
  GQuark domain;
  int code;
  char* message;
};

struct SecretSchemaAttribute {
  const char* name;
  int type;
};

struct SecretSchema {
  const char* name;
  int flags;
  SecretSchemaAttribute attributes[32];
  int reserved;
  void* reserved1;
  void* reserved2;
  void* reserved3;
  void* reserved4;
  void* reserved5;
  void* reserved6;
  void* reserved7;
};

using StoreFn = int (*)(const SecretSchema*, const char*, const char*, const char*, void*, GError**, ...);
using LookupFn = char* (*)(const SecretSchema*, void*, GError**, ...);
using ClearFn = int (*)(const SecretSchema*, void*, GError**, ...);
using FreeFn = void (*)(char*);
using ServiceFn = void* (*)(int, void*, GError**);
using UnrefFn = void (*)(void*);
using ErrorFreeFn = void (*)(GError*);
using QuarkNameFn = const char* (*)(GQuark);
using SearchFn = void* (*)(const SecretSchema*, int, void*, GError**, ...);
using ListFreeFullFn = void (*)(void*, void (*)(void*));
using CollectionForAliasFn = void* (*)(void*, const char*, int, void*, GError**);
using CollectionLockedFn = int (*)(void*);

constexpr int kSecretErrorIsLocked = 2;
constexpr int kIoErrorCancelled = 19;
constexpr int kSecretSearchAll = 1 << 1;
constexpr char kDefaultCollection[] = "default";

SecretSchema MakeSecretSchema(const KeySchema& key_schema) {
  SecretSchema s{};
  s.name = key_schema.name;
  s.flags = 0;
  s.attributes[0] = {"account", 0};
  s.attributes[1] = {nullptr, 0};
  return s;
}

bool ValidSyncAccount(std::string_view account) {
  return IsTag(account);
}

class FileKeyStore final : public KeyStore {
 public:
  FileKeyStore(std::string directory, const KeySchema& schema) : directory_(std::move(directory)), schema_(schema) {}

  std::string_view kind() const override { return "file"; }

  KeyStatus Load(std::string_view account, Bytes* secret) override {
    if (!schema_.valid_account(account)) return KeyStatus::kNotFound;
    const int fd = open(PathOf(account).c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return errno == ENOENT ? KeyStatus::kNotFound : KeyStatus::kUnavailable;
    struct stat info;
    if (fstat(fd, &info) != 0 || !S_ISREG(info.st_mode) || static_cast<size_t>(info.st_size) > schema_.max_bytes || info.st_uid != geteuid() ||
        (info.st_mode & 077) != 0) {
      close(fd);
      return KeyStatus::kUnavailable;
    }
    Bytes data(static_cast<size_t>(info.st_size));
    size_t got = 0;
    while (got < data.size()) {
      const ssize_t n = read(fd, data.data() + got, data.size() - got);
      if (n < 0 && errno == EINTR) continue;
      if (n <= 0) break;
      got += static_cast<size_t>(n);
    }
    close(fd);
    if (got != data.size()) {
      Wipe(data);
      return KeyStatus::kUnavailable;
    }
    *secret = std::move(data);
    return KeyStatus::kOk;
  }

  KeyStatus Save(std::string_view account, const Bytes& secret) override {
    if (!schema_.valid_account(account) || secret.size() > schema_.max_bytes) return KeyStatus::kUnavailable;
    if (mkdir(directory_.c_str(), 0700) != 0 && errno != EEXIST) return KeyStatus::kUnavailable;
    struct stat info;
    if (lstat(directory_.c_str(), &info) != 0 || !S_ISDIR(info.st_mode)) return KeyStatus::kUnavailable;
    const std::string path = PathOf(account);
    const std::string staging = path + ".staging";
    unlink(staging.c_str());
    const int fd = open(staging.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) return KeyStatus::kUnavailable;
    size_t written = 0;
    bool ok = true;
    while (ok && written < secret.size()) {
      const ssize_t n = write(fd, secret.data() + written, secret.size() - written);
      if (n < 0 && errno == EINTR) continue;
      ok = n > 0;
      if (ok) written += static_cast<size_t>(n);
    }
    ok = ok && fsync(fd) == 0;
    ok = close(fd) == 0 && ok;
    ok = ok && rename(staging.c_str(), path.c_str()) == 0;
    if (!ok) {
      unlink(staging.c_str());
      return KeyStatus::kUnavailable;
    }
    const int dir = open(directory_.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (dir >= 0) {
      fsync(dir);
      close(dir);
    }
    return KeyStatus::kOk;
  }

  KeyStatus Delete(std::string_view account) override {
    if (!schema_.valid_account(account)) return KeyStatus::kNotFound;
    if (unlink(PathOf(account).c_str()) == 0) return KeyStatus::kOk;
    return errno == ENOENT ? KeyStatus::kNotFound : KeyStatus::kUnavailable;
  }

  KeyStatus Probe() override { return KeyStatus::kOk; }
  bool WritesWithoutPrompt() override { return true; }

 private:
  std::string PathOf(std::string_view account) const {
    return directory_ + "/" + schema_.file_prefix + std::string(account);
  }

  std::string directory_;
  const KeySchema& schema_;
};

class SecretServiceKeyStore final : public KeyStore {
 public:
  SecretServiceKeyStore(std::string library, const KeySchema& schema)
      : key_schema_(schema), schema_(MakeSecretSchema(schema)) {
    handle_ = dlopen(library.c_str(), RTLD_NOW | RTLD_LOCAL);
    if (!handle_) return;
    store_ = reinterpret_cast<StoreFn>(dlsym(handle_, "secret_password_store_sync"));
    lookup_ = reinterpret_cast<LookupFn>(dlsym(handle_, "secret_password_lookup_sync"));
    clear_ = reinterpret_cast<ClearFn>(dlsym(handle_, "secret_password_clear_sync"));
    free_ = reinterpret_cast<FreeFn>(dlsym(handle_, "secret_password_free"));
    service_ = reinterpret_cast<ServiceFn>(dlsym(handle_, "secret_service_get_sync"));
    unref_ = reinterpret_cast<UnrefFn>(dlsym(handle_, "g_object_unref"));
    error_free_ = reinterpret_cast<ErrorFreeFn>(dlsym(handle_, "g_error_free"));
    quark_name_ = reinterpret_cast<QuarkNameFn>(dlsym(handle_, "g_quark_to_string"));
    search_ = reinterpret_cast<SearchFn>(dlsym(handle_, "secret_password_search_sync"));
    list_free_full_ = reinterpret_cast<ListFreeFullFn>(dlsym(handle_, "g_list_free_full"));
    collection_for_alias_ = reinterpret_cast<CollectionForAliasFn>(dlsym(handle_, "secret_collection_for_alias_sync"));
    collection_locked_ = reinterpret_cast<CollectionLockedFn>(dlsym(handle_, "secret_collection_get_locked"));
  }

  std::string_view kind() const override { return "secretService"; }

  [[clang::no_sanitize("cfi-icall")]] KeyStatus Load(std::string_view account, Bytes* secret) override {
    if (!Loaded()) return KeyStatus::kUnavailable;
    if (!key_schema_.valid_account(account)) return KeyStatus::kNotFound;
    const std::string name(account);
    GError* error = nullptr;
    char* found = lookup_(&schema_, nullptr, &error, "account", name.c_str(), nullptr);
    if (error) return Classify(error);
    if (!found) return LockedItem(name);
    std::string hex(found);
    free_(found);
    Bytes decoded;
    const bool ok = HexDecode(hex, &decoded);
    Wipe(hex);
    if (!ok) return KeyStatus::kUnavailable;
    *secret = std::move(decoded);
    return KeyStatus::kOk;
  }

  [[clang::no_sanitize("cfi-icall")]] KeyStatus Save(std::string_view account, const Bytes& secret) override {
    if (!Loaded() || !key_schema_.valid_account(account) || secret.size() > key_schema_.max_bytes)
      return KeyStatus::kUnavailable;
    const std::string name(account);
    std::string hex = HexEncode(secret);
    GError* error = nullptr;
    const int stored =
        store_(&schema_, kDefaultCollection, key_schema_.label, hex.c_str(), nullptr, &error, "account", name.c_str(), nullptr);
    Wipe(hex);
    if (error) return Classify(error);
    return stored ? KeyStatus::kOk : KeyStatus::kUnavailable;
  }

  [[clang::no_sanitize("cfi-icall")]] KeyStatus Delete(std::string_view account) override {
    if (!Loaded()) return KeyStatus::kUnavailable;
    if (!key_schema_.valid_account(account)) return KeyStatus::kNotFound;
    const std::string name(account);
    GError* error = nullptr;
    const int cleared = clear_(&schema_, nullptr, &error, "account", name.c_str(), nullptr);
    if (error) return Classify(error);
    return cleared ? KeyStatus::kOk : KeyStatus::kNotFound;
  }

  [[clang::no_sanitize("cfi-icall")]] KeyStatus Probe() override {
    if (!Loaded()) return KeyStatus::kUnavailable;
    GError* error = nullptr;
    void* service = service_(0, nullptr, &error);
    if (error) {
      if (service) unref_(service);
      return Classify(error);
    }
    if (!service) return KeyStatus::kUnavailable;
    bool open = false;
    const KeyStatus status = DefaultCollection(service, &open);
    unref_(service);
    return status;
  }

  [[clang::no_sanitize("cfi-icall")]] bool WritesWithoutPrompt() override {
    if (!Loaded()) return false;
    GError* error = nullptr;
    void* service = service_(0, nullptr, &error);
    if (error) {
      if (service) unref_(service);
      error_free_(error);
      return false;
    }
    if (!service) return false;
    bool open = false;
    const KeyStatus status = DefaultCollection(service, &open);
    unref_(service);
    return status == KeyStatus::kOk && open;
  }

 private:
  bool Loaded() const {
    return handle_ && store_ && lookup_ && clear_ && free_ && service_ && unref_ && error_free_ && quark_name_;
  }

  [[clang::no_sanitize("cfi-icall")]] KeyStatus LockedItem(const std::string& account) {
    if (!search_ || !list_free_full_) return KeyStatus::kNotFound;
    GError* error = nullptr;
    void* items = search_(&schema_, kSecretSearchAll, nullptr, &error, "account", account.c_str(), nullptr);
    if (error) {
      if (items) list_free_full_(items, unref_);
      return Classify(error);
    }
    if (!items) return KeyStatus::kNotFound;
    list_free_full_(items, unref_);
    return KeyStatus::kLocked;
  }

  [[clang::no_sanitize("cfi-icall")]] KeyStatus DefaultCollection(void* service, bool* open) {
    if (!collection_for_alias_ || !collection_locked_) return KeyStatus::kOk;
    GError* error = nullptr;
    void* collection = collection_for_alias_(service, kDefaultCollection, 0, nullptr, &error);
    if (error) {
      if (collection) unref_(collection);
      return Classify(error);
    }
    if (!collection) return KeyStatus::kOk;
    const bool locked = collection_locked_(collection);
    unref_(collection);
    *open = !locked;
    return locked ? KeyStatus::kLocked : KeyStatus::kOk;
  }

  [[clang::no_sanitize("cfi-icall")]] KeyStatus Classify(GError* error) {
    const char* domain = quark_name_(error->domain);
    const KeyStatus status = ClassifySecretError(domain ? domain : "", error->code);
    error_free_(error);
    return status;
  }

  const KeySchema& key_schema_;
  const SecretSchema schema_;
  void* handle_ = nullptr;
  StoreFn store_ = nullptr;
  LookupFn lookup_ = nullptr;
  ClearFn clear_ = nullptr;
  FreeFn free_ = nullptr;
  ServiceFn service_ = nullptr;
  UnrefFn unref_ = nullptr;
  ErrorFreeFn error_free_ = nullptr;
  QuarkNameFn quark_name_ = nullptr;
  SearchFn search_ = nullptr;
  ListFreeFullFn list_free_full_ = nullptr;
  CollectionForAliasFn collection_for_alias_ = nullptr;
  CollectionLockedFn collection_locked_ = nullptr;
};

}

std::string_view KeyStatusName(KeyStatus status) {
  switch (status) {
    case KeyStatus::kOk: return "ok";
    case KeyStatus::kNotFound: return "notFound";
    case KeyStatus::kLocked: return "locked";
    case KeyStatus::kUnavailable: return "unavailable";
  }
  return "unavailable";
}

KeyStatus ClassifySecretError(std::string_view domain, int code) {
  if (domain == "secret-error" && code == kSecretErrorIsLocked) return KeyStatus::kLocked;
  if (domain == "g-io-error-quark" && code == kIoErrorCancelled) return KeyStatus::kLocked;
  return KeyStatus::kUnavailable;
}

bool UseFileKeyStore(bool background, bool explicit_user_data_dir, std::string_view user_data_dir,
                     std::string_view default_user_data_dir) {
  auto trimmed = [](std::string_view path) {
    while (path.size() > 1 && path.back() == '/') path.remove_suffix(1);
    return path;
  };
  return background && explicit_user_data_dir && !user_data_dir.empty() && user_data_dir.front() == '/' &&
         trimmed(user_data_dir) != trimmed(default_user_data_dir);
}

const KeySchema& SyncKeySchema() {
  static const KeySchema schema{kSecretSchema, kSecretLabel, "sync-key-", &ValidSyncAccount, 1024};
  return schema;
}

std::unique_ptr<KeyStore> MakeFileKeyStore(std::string directory, const KeySchema& schema) {
  return std::make_unique<FileKeyStore>(std::move(directory), schema);
}

std::unique_ptr<KeyStore> MakeSecretServiceKeyStore(std::string library, const KeySchema& schema) {
  return std::make_unique<SecretServiceKeyStore>(std::move(library), schema);
}

std::string HexEncode(const Bytes& data) {
  static constexpr char kHex[] = "0123456789abcdef";
  std::string out;
  out.reserve(data.size() * 2);
  for (const uint8_t byte : data) {
    out.push_back(kHex[byte >> 4]);
    out.push_back(kHex[byte & 15]);
  }
  return out;
}

bool HexDecode(std::string_view text, Bytes* out) {
  if (text.size() % 2) return false;
  auto nibble = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  Bytes decoded;
  decoded.reserve(text.size() / 2);
  for (size_t i = 0; i < text.size(); i += 2) {
    const int high = nibble(text[i]);
    const int low = nibble(text[i + 1]);
    if (high < 0 || low < 0) {
      Wipe(decoded);
      return false;
    }
    decoded.push_back(static_cast<uint8_t>(high << 4 | low));
  }
  *out = std::move(decoded);
  return true;
}

}
