#include "ardia/linux/ac_linux_import_keyring.h"

#include <dlfcn.h>
#include <time.h>

#include <cstdint>
#include <cstring>
#include <iterator>
#include <utility>

#include "ardia/linux/ac_linux_import_formats.h"

namespace ardia::linux_import {

namespace {

struct GDBusConnection;
struct GVariant;
struct GMainContext;
struct GError {
  uint32_t domain;
  int code;
  char* message;
};

using SignalCallback = void (*)(GDBusConnection*, const char*, const char*, const char*, const char*, GVariant*, void*);

constexpr int kBusSession = 2;
constexpr int kCallNoAutoStart = 1;
constexpr int kCallNone = 0;
constexpr const char* kSecrets = "org.freedesktop.secrets";
constexpr const char* kSecretsPath = "/org/freedesktop/secrets";
constexpr const char* kService = "org.freedesktop.Secret.Service";
constexpr const char* kPromptInterface = "org.freedesktop.Secret.Prompt";
constexpr const char* kSessionInterface = "org.freedesktop.Secret.Session";
constexpr const char* kKWallet = "org.kde.KWallet";
constexpr int kActivationTimeoutMs = 25000;

struct Gio {
  bool loaded = false;
  GDBusConnection* (*bus_get_sync)(int, void*, GError**) = nullptr;
  GVariant* (*call_sync)(GDBusConnection*, const char*, const char*, const char*, const char*, GVariant*, const void*,
                         int, int, void*, GError**) = nullptr;
  unsigned (*signal_subscribe)(GDBusConnection*, const char*, const char*, const char*, const char*, const char*, int,
                               SignalCallback, void*, void (*)(void*)) = nullptr;
  void (*signal_unsubscribe)(GDBusConnection*, unsigned) = nullptr;
  GVariant* (*variant_new_parsed)(const char*, ...) = nullptr;
  void (*variant_unref)(GVariant*) = nullptr;
  GVariant* (*child)(GVariant*, size_t) = nullptr;
  size_t (*n_children)(GVariant*) = nullptr;
  const char* (*get_string)(GVariant*, size_t*) = nullptr;
  int (*get_boolean)(GVariant*) = nullptr;
  int32_t (*get_int32)(GVariant*) = nullptr;
  const void* (*fixed_array)(GVariant*, size_t*, size_t) = nullptr;
  const char* (*type_string)(GVariant*) = nullptr;
  void (*error_free)(GError*) = nullptr;
  void (*object_unref)(void*) = nullptr;
  GMainContext* (*context_new)() = nullptr;
  void (*context_unref)(GMainContext*) = nullptr;
  void (*context_push)(GMainContext*) = nullptr;
  void (*context_pop)(GMainContext*) = nullptr;
  int (*context_iteration)(GMainContext*, int) = nullptr;
};

template <typename T>
bool Load(void* library, const char* name, T* out) {
  *out = reinterpret_cast<T>(dlsym(library, name));
  return *out != nullptr;
}

const Gio& Library() {
  static const Gio gio = [] {
    Gio made;
    void* library = dlopen("libgio-2.0.so.0", RTLD_NOW | RTLD_LOCAL);
    if (!library) return made;
    made.loaded = Load(library, "g_bus_get_sync", &made.bus_get_sync) &&
                  Load(library, "g_dbus_connection_call_sync", &made.call_sync) &&
                  Load(library, "g_dbus_connection_signal_subscribe", &made.signal_subscribe) &&
                  Load(library, "g_dbus_connection_signal_unsubscribe", &made.signal_unsubscribe) &&
                  Load(library, "g_variant_new_parsed", &made.variant_new_parsed) &&
                  Load(library, "g_variant_unref", &made.variant_unref) &&
                  Load(library, "g_variant_get_child_value", &made.child) &&
                  Load(library, "g_variant_n_children", &made.n_children) &&
                  Load(library, "g_variant_get_string", &made.get_string) &&
                  Load(library, "g_variant_get_boolean", &made.get_boolean) &&
                  Load(library, "g_variant_get_int32", &made.get_int32) &&
                  Load(library, "g_variant_get_fixed_array", &made.fixed_array) &&
                  Load(library, "g_variant_get_type_string", &made.type_string) &&
                  Load(library, "g_error_free", &made.error_free) &&
                  Load(library, "g_object_unref", &made.object_unref) &&
                  Load(library, "g_main_context_new", &made.context_new) &&
                  Load(library, "g_main_context_unref", &made.context_unref) &&
                  Load(library, "g_main_context_push_thread_default", &made.context_push) &&
                  Load(library, "g_main_context_pop_thread_default", &made.context_pop) &&
                  Load(library, "g_main_context_iteration", &made.context_iteration);
    return made;
  }();
  return gio;
}

class Variant {
 public:
  Variant() = default;
  explicit Variant(GVariant* value) : value_(value) {}
  Variant(Variant&& other) : value_(std::exchange(other.value_, nullptr)) {}
  Variant& operator=(Variant&& other) {
    if (this != &other) {
      Reset();
      value_ = std::exchange(other.value_, nullptr);
    }
    return *this;
  }
  Variant(const Variant&) = delete;
  Variant& operator=(const Variant&) = delete;
  ~Variant() { Reset(); }

  explicit operator bool() const { return value_ != nullptr; }
  GVariant* get() const { return value_; }
  [[clang::no_sanitize("cfi-icall")]] Variant Child(size_t index) const {
    const Gio& gio = Library();
    return value_ && index < gio.n_children(value_) ? Variant(gio.child(value_, index)) : Variant();
  }
  [[clang::no_sanitize("cfi-icall")]] size_t Size() const { return value_ ? Library().n_children(value_) : 0; }
  [[clang::no_sanitize("cfi-icall")]] std::string String() const {
    if (!value_) return std::string();
    const char* type = Library().type_string(value_);
    if (!type || (std::strcmp(type, "s") != 0 && std::strcmp(type, "o") != 0)) return std::string();
    const char* text = Library().get_string(value_, nullptr);
    return text ? std::string(text) : std::string();
  }
  [[clang::no_sanitize("cfi-icall")]] bool Is(const char* type) const {
    const char* actual = value_ ? Library().type_string(value_) : nullptr;
    return actual && std::strcmp(actual, type) == 0;
  }

 private:
  [[clang::no_sanitize("cfi-icall")]] void Reset() {
    if (value_) Library().variant_unref(value_);
    value_ = nullptr;
  }
  GVariant* value_ = nullptr;
};

struct CallError {
  bool failed = false;
  bool timed_out = false;
  bool denied = false;
};

class Bus {
 public:
  [[clang::no_sanitize("cfi-icall")]] Bus() {
    const Gio& gio = Library();
    if (!gio.loaded) return;
    GError* error = nullptr;
    connection_ = gio.bus_get_sync(kBusSession, nullptr, &error);
    if (error) gio.error_free(error);
  }
  Bus(const Bus&) = delete;
  Bus& operator=(const Bus&) = delete;
  [[clang::no_sanitize("cfi-icall")]] ~Bus() {
    if (connection_) Library().object_unref(connection_);
  }

  bool ok() const { return connection_ != nullptr; }
  GDBusConnection* get() const { return connection_; }

  [[clang::no_sanitize("cfi-icall")]] Variant Call(const char* name, const char* path, const char* interface, const char* method, GVariant* arguments,
               int timeout_ms, bool auto_start, CallError* error_out = nullptr) {
    const Gio& gio = Library();
    GError* error = nullptr;
    GVariant* reply = gio.call_sync(connection_, name, path, interface, method, arguments, nullptr,
                                    auto_start ? kCallNone : kCallNoAutoStart, timeout_ms, nullptr, &error);
    if (error) {
      if (error_out) {
        error_out->failed = true;
        const std::string message = error->message ? error->message : "";
        error_out->timed_out = message.find("Timeout") != std::string::npos || message.find("timed out") != std::string::npos;
        error_out->denied = message.find("IsLocked") != std::string::npos || message.find("AccessDenied") != std::string::npos;
      }
      gio.error_free(error);
    }
    return Variant(reply);
  }

  [[clang::no_sanitize("cfi-icall")]] bool Start(const char* name) {
    Variant reply = Call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "StartServiceByName",
                         Library().variant_new_parsed("(%s, %u)", name, uint32_t{0}), kActivationTimeoutMs, false);
    return static_cast<bool>(reply);
  }

  bool Reachable(const char* name, int timeout_ms, bool start) {
    return HasOwner(name, timeout_ms) || (start && Start(name));
  }

  [[clang::no_sanitize("cfi-icall")]] bool HasOwner(const char* name, int timeout_ms) {
    Variant reply = Call("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "NameHasOwner",
                         Library().variant_new_parsed("(%s,)", name), timeout_ms, false);
    Variant owned = reply.Child(0);
    return owned && owned.Is("b") && Library().get_boolean(owned.get());
  }

 private:
  GDBusConnection* connection_ = nullptr;
};

double NowMs() {
  timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return static_cast<double>(now.tv_sec) * 1000 + static_cast<double>(now.tv_nsec) / 1e6;
}

struct PromptWait {
  bool completed = false;
  bool dismissed = false;
};

[[clang::no_sanitize("cfi-icall")]] void PromptCompleted(GDBusConnection*, const char*, const char*, const char*, const char*, GVariant* parameters,
                     void* data) {
  auto* wait = static_cast<PromptWait*>(data);
  wait->completed = true;
  const Gio& gio = Library();
  if (parameters && gio.n_children(parameters) > 0) {
    GVariant* dismissed = gio.child(parameters, 0);
    wait->dismissed = gio.get_boolean(dismissed) != 0;
    gio.variant_unref(dismissed);
  } else {
    wait->dismissed = true;
  }
}

class SecretService {
 public:
  SecretService(Bus& bus, int timeout_ms, bool start) : bus_(bus), timeout_ms_(timeout_ms), start_(start) {}
  ~SecretService() { CloseSession(); }

  bool Available() { return bus_.ok() && bus_.Reachable(kSecrets, timeout_ms_, start_); }

  [[clang::no_sanitize("cfi-icall")]] KeyringStatus Search(const SafeStorageItem& item, std::vector<std::string>* unlocked, std::vector<std::string>* locked) {
    const bool labelled = !item.secret_label.empty();
    const std::string schemas[] = {labelled ? item.secret_schema : std::string(kSecretSchemaV2),
                                   labelled ? std::string() : std::string(kSecretSchemaV1), std::string()};
    for (size_t pass = 0; pass < std::size(schemas); ++pass) {
      const std::string& schema = schemas[pass];
      if (labelled && pass > 0) continue;
      const std::string& key = labelled ? item.secret_label : item.application;
      const char* attribute = labelled ? "string" : "application";
      GVariant* arguments =
          schema.empty()
              ? Library().variant_new_parsed("({%s: %s},)", attribute, key.c_str())
              : Library().variant_new_parsed("({%s: %s, 'xdg:schema': %s},)", attribute, key.c_str(), schema.c_str());
      CallError error;
      Variant reply = bus_.Call(kSecrets, kSecretsPath, kService, "SearchItems", arguments, timeout_ms_, false, &error);
      if (!reply || reply.Size() < 2) return KeyringStatus::kUnavailable;
      for (size_t list = 0; list < 2; ++list) {
        Variant paths = reply.Child(list);
        for (size_t i = 0; i < paths.Size(); ++i) {
          std::string path = paths.Child(i).String();
          if (!path.empty()) (list == 0 ? unlocked : locked)->push_back(std::move(path));
        }
      }
      if (!unlocked->empty() || !locked->empty()) return KeyringStatus::kOk;
    }
    return KeyringStatus::kMissing;
  }

  [[clang::no_sanitize("cfi-icall")]] KeyringStatus Unlock(const std::string& item, int prompt_timeout_ms) {
    Variant reply = bus_.Call(kSecrets, kSecretsPath, kService, "Unlock",
                              Library().variant_new_parsed("([%o],)", item.c_str()), timeout_ms_, false);
    if (!reply || reply.Size() < 2) return KeyringStatus::kUnavailable;
    Variant done = reply.Child(0);
    for (size_t i = 0; i < done.Size(); ++i) {
      if (done.Child(i).String() == item) return KeyringStatus::kOk;
    }
    const std::string prompt = reply.Child(1).String();
    if (prompt.empty() || prompt == "/") return KeyringStatus::kLocked;
    const Gio& gio = Library();
    GMainContext* context = gio.context_new();
    gio.context_push(context);
    PromptWait wait;
    const unsigned subscription = gio.signal_subscribe(bus_.get(), nullptr, kPromptInterface, "Completed",
                                                       prompt.c_str(), nullptr, 0, &PromptCompleted, &wait, nullptr);
    Variant started = bus_.Call(kSecrets, prompt.c_str(), kPromptInterface, "Prompt",
                                gio.variant_new_parsed("(%s,)", ""), timeout_ms_, false);
    const double deadline = NowMs() + prompt_timeout_ms;
    while (started && !wait.completed && NowMs() < deadline) {
      if (!gio.context_iteration(context, 0)) {
        timespec pause{0, 20 * 1000 * 1000};
        nanosleep(&pause, nullptr);
      }
    }
    gio.signal_unsubscribe(bus_.get(), subscription);
    while (gio.context_iteration(context, 0)) {
    }
    gio.context_pop(context);
    gio.context_unref(context);
    if (!started) return KeyringStatus::kUnavailable;
    if (!wait.completed) {
      bus_.Call(kSecrets, prompt.c_str(), kPromptInterface, "Dismiss", nullptr, timeout_ms_, false);
      return KeyringStatus::kDenied;
    }
    return wait.dismissed ? KeyringStatus::kDenied : KeyringStatus::kOk;
  }

  [[clang::no_sanitize("cfi-icall")]] KeyringStatus Secret(const std::string& item, SecretBytes* secret) {
    if (!OpenSession()) return KeyringStatus::kUnavailable;
    CallError error;
    Variant reply = bus_.Call(kSecrets, kSecretsPath, kService, "GetSecrets",
                              Library().variant_new_parsed("([%o], %o)", item.c_str(), session_.c_str()), timeout_ms_,
                              false, &error);
    if (!reply) return error.denied ? KeyringStatus::kLocked : KeyringStatus::kUnavailable;
    Variant secrets = reply.Child(0);
    for (size_t i = 0; i < secrets.Size(); ++i) {
      Variant entry = secrets.Child(i);
      if (entry.Child(0).String() != item) continue;
      Variant value = entry.Child(1).Child(2);
      if (!value || !value.Is("ay")) return KeyringStatus::kUnavailable;
      size_t length = 0;
      const void* bytes = Library().fixed_array(value.get(), &length, 1);
      if (!bytes || length == 0) return KeyringStatus::kMissing;
      *secret = SecretBytes(std::string(static_cast<const char*>(bytes), length));
      std::memset(const_cast<void*>(bytes), 0, length);
      return KeyringStatus::kOk;
    }
    return KeyringStatus::kMissing;
  }

 private:
  [[clang::no_sanitize("cfi-icall")]] bool OpenSession() {
    if (!session_.empty()) return true;
    Variant reply = bus_.Call(kSecrets, kSecretsPath, kService, "OpenSession",
                              Library().variant_new_parsed("('plain', <''>)"), timeout_ms_, false);
    session_ = reply.Child(1).String();
    return !session_.empty();
  }
  void CloseSession() {
    if (session_.empty()) return;
    bus_.Call(kSecrets, session_.c_str(), kSessionInterface, "Close", nullptr, timeout_ms_, false);
    session_.clear();
  }

  Bus& bus_;
  int timeout_ms_;
  bool start_;
  std::string session_;
};

struct WalletService {
  const char* name;
  const char* path;
};

constexpr WalletService kWallets[] = {{"org.kde.kwalletd6", "/modules/kwalletd6"},
                                      {"org.kde.kwalletd5", "/modules/kwalletd5"},
                                      {"org.kde.kwalletd", "/modules/kwalletd"}};

class KWallet {
 public:
  KWallet(Bus& bus, int timeout_ms, bool start) : bus_(bus), timeout_ms_(timeout_ms) {
    if (!bus_.ok()) return;
    for (const WalletService& wallet : kWallets) {
      if (bus_.Reachable(wallet.name, timeout_ms_, start)) {
        service_ = &wallet;
        break;
      }
    }
  }

  [[clang::no_sanitize("cfi-icall")]] bool Available() {
    if (!service_) return false;
    Variant enabled = Call("isEnabled", nullptr, timeout_ms_).Child(0);
    if (!enabled || !enabled.Is("b") || !Library().get_boolean(enabled.get())) return false;
    wallet_ = Call("networkWallet", nullptr, timeout_ms_).Child(0).String();
    return !wallet_.empty();
  }

  [[clang::no_sanitize("cfi-icall")]] KeyringStatus Exists(const SafeStorageItem& item) {
    Variant missing = Call("keyDoesNotExist",
                           Library().variant_new_parsed("(%s, %s, %s)", wallet_.c_str(), item.kwallet_folder.c_str(),
                                                        item.kwallet_key.c_str()),
                           timeout_ms_)
                          .Child(0);
    if (!missing || !missing.Is("b")) return KeyringStatus::kUnavailable;
    return Library().get_boolean(missing.get()) ? KeyringStatus::kMissing : KeyringStatus::kOk;
  }

  [[clang::no_sanitize("cfi-icall")]] KeyringStatus Read(const SafeStorageItem& item, int prompt_timeout_ms, SecretBytes* secret) {
    const std::string app(kKWalletAppId);
    CallError error;
    Variant opened = Call("open", Library().variant_new_parsed("(%s, %x, %s)", wallet_.c_str(), int64_t{0}, app.c_str()),
                          prompt_timeout_ms, &error)
                         .Child(0);
    if (!opened || !opened.Is("i")) return error.timed_out ? KeyringStatus::kDenied : KeyringStatus::kUnavailable;
    const int32_t handle = Library().get_int32(opened.get());
    if (handle < 0) return KeyringStatus::kDenied;
    KeyringStatus status = KeyringStatus::kMissing;
    Variant value = Call("readPassword",
                         Library().variant_new_parsed("(%i, %s, %s, %s)", handle, item.kwallet_folder.c_str(),
                                                      item.kwallet_key.c_str(), app.c_str()),
                         timeout_ms_)
                        .Child(0);
    if (value && value.Is("s")) {
      std::string text = value.String();
      if (!text.empty()) {
        *secret = SecretBytes(std::move(text));
        status = KeyringStatus::kOk;
      }
    } else {
      status = KeyringStatus::kUnavailable;
    }
    Call("close", Library().variant_new_parsed("(%i, false, %s)", handle, app.c_str()), timeout_ms_);
    return status;
  }

 private:
  Variant Call(const char* method, GVariant* arguments, int timeout_ms, CallError* error = nullptr) {
    return bus_.Call(service_->name, service_->path, kKWallet, method, arguments, timeout_ms, false, error);
  }

  Bus& bus_;
  int timeout_ms_;
  const WalletService* service_ = nullptr;
  std::string wallet_;
};

class SystemKeyringImpl : public Keyring {
 public:
  KeyringStatus Exists(const SafeStorageItem& item, int timeout_ms) override {
    Bus bus;
    if (!bus.ok()) return KeyringStatus::kUnavailable;
    KeyringStatus status = KeyringStatus::kUnavailable;
    SecretService secrets(bus, timeout_ms, false);
    if (secrets.Available()) {
      std::vector<std::string> unlocked;
      std::vector<std::string> locked;
      status = secrets.Search(item, &unlocked, &locked);
      if (status == KeyringStatus::kOk) return status;
    }
    KWallet wallet(bus, timeout_ms, false);
    if (!item.kwallet_key.empty() && wallet.Available()) {
      const KeyringStatus found = wallet.Exists(item);
      if (found == KeyringStatus::kOk || status == KeyringStatus::kUnavailable) status = found;
    }
    return status;
  }

  KeyringLookup Read(const SafeStorageItem& item, int timeout_ms) override {
    KeyringLookup lookup;
    Bus bus;
    if (!bus.ok()) return lookup;
    SecretService secrets(bus, kKeyringProbeTimeoutMs, true);
    if (secrets.Available()) {
      std::vector<std::string> unlocked;
      std::vector<std::string> locked;
      lookup.status = secrets.Search(item, &unlocked, &locked);
      lookup.backend = "secretService";
      if (lookup.status == KeyringStatus::kOk) {
        std::string path = !unlocked.empty() ? unlocked.front() : locked.front();
        if (unlocked.empty()) lookup.status = secrets.Unlock(path, timeout_ms);
        if (lookup.status == KeyringStatus::kOk) lookup.status = secrets.Secret(path, &lookup.secret);
        return lookup;
      }
    }
    KWallet wallet(bus, kKeyringProbeTimeoutMs, true);
    if (!item.kwallet_key.empty() && wallet.Available()) {
      const KeyringStatus found = wallet.Exists(item);
      if (found == KeyringStatus::kOk) {
        lookup.backend = "kwallet";
        lookup.status = wallet.Read(item, timeout_ms, &lookup.secret);
        return lookup;
      }
      if (lookup.status == KeyringStatus::kUnavailable) lookup.status = found;
    }
    return lookup;
  }
};

}

std::optional<SafeStorageItem> SafeStorageFor(std::string_view browser_id) {
  struct Entry {
    std::string_view prefix;
    const char* application;
    const char* product;
  };
  constexpr Entry kEntries[] = {{"chromium", "chromium", "Chromium"}, {"chrome", "chrome", "Chrome"},
                                {"brave", "brave", "Brave"},          {"edge", "microsoft-edge", "Microsoft Edge"},
                                {"vivaldi", "vivaldi", "Vivaldi"},    {"opera", "opera", "Opera"},
                                {"helium", "helium", "Helium"}};
  for (const Entry& entry : kEntries) {
    if (browser_id.substr(0, entry.prefix.size()) != entry.prefix) continue;
    SafeStorageItem item;
    item.application = entry.application;
    item.kwallet_folder = std::string(entry.product) + " Keys";
    item.kwallet_key = std::string(entry.product) + " Safe Storage";
    return item;
  }
  return std::nullopt;
}

std::optional<SafeStorageItem> FirefoxStorageFor(std::string_view browser_id) {
  struct Entry {
    std::string_view id;
    const char* product;
  };
  constexpr Entry kEntries[] = {{"firefox", "Firefox"}, {"firefoxSnap", "Firefox"}, {"librewolf", "LibreWolf"}, {"zen", "Zen"}};
  for (const Entry& entry : kEntries) {
    if (browser_id != entry.id) continue;
    SafeStorageItem item;
    item.secret_schema = std::string(kFirefoxSecretSchema);
    item.secret_label = std::string(entry.product) + " Encrypted Storage";
    return item;
  }
  return std::nullopt;
}

std::string_view KeyringErrorCode(KeyringStatus status) {
  switch (status) {
    case KeyringStatus::kOk:
      return "";
    case KeyringStatus::kMissing:
      return "notFound";
    case KeyringStatus::kLocked:
      return "locked";
    case KeyringStatus::kDenied:
      return "denied";
    case KeyringStatus::kUnavailable:
      return "unavailable";
  }
  return "unavailable";
}

std::string KeyringErrorMessage(KeyringStatus status, std::string_view browser_name) {
  const std::string name(browser_name);
  switch (status) {
    case KeyringStatus::kOk:
      return std::string();
    case KeyringStatus::kMissing:
      return "The system keyring has no " + name + " Safe Storage key";
    case KeyringStatus::kLocked:
      return "The system keyring is locked";
    case KeyringStatus::kDenied:
      return "The system keyring didn't allow access to " + name + "'s Safe Storage key";
    case KeyringStatus::kUnavailable:
      return "No system keyring (Secret Service or KWallet) is available";
  }
  return std::string();
}

std::unique_ptr<Keyring> SystemKeyring() {
  return std::make_unique<SystemKeyringImpl>();
}

}
