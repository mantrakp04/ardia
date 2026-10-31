#include "ardia/linux/ac_linux_calendar_eds.h"

#include <dlfcn.h>
#include <time.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <utility>

namespace ardia::linux_calendar {

namespace {

struct GDBusConnection;
struct GVariant;
struct GVariantType;
struct GError {
  uint32_t domain;
  int code;
  char* message;
};

using SignalCallback = void (*)(GDBusConnection*, const char*, const char*, const char*, const char*, GVariant*, void*);

constexpr int kBusSession = 2;
constexpr int kConnectionFlags = (1 << 0) | (1 << 3);
constexpr int kCallNone = 0;
constexpr int kCallNoAutoStart = 1;
constexpr int kMatchArg0Namespace = 1 << 1;
constexpr int kIoErrorTimedOut = 24;
constexpr int64_t kEarliestQueryMs = -62135596800000;
constexpr int64_t kLatestQueryMs = 253402300799999;
constexpr int kListTimeoutMs = 3000;
constexpr int kCloseTimeoutMs = 1000;
constexpr const char* kBus = "org.freedesktop.DBus";
constexpr const char* kBusPath = "/org/freedesktop/DBus";
constexpr const char* kPrefix = "org.gnome.evolution.dataserver.";
constexpr const char* kNamespace = "org.gnome.evolution.dataserver";
constexpr const char* kSourceManagerPath = "/org/gnome/evolution/dataserver/SourceManager";
constexpr const char* kObjectManager = "org.freedesktop.DBus.ObjectManager";
constexpr const char* kSourceInterface = "org.gnome.evolution.dataserver.Source";
constexpr const char* kFactoryPath = "/org/gnome/evolution/dataserver/CalendarFactory";
constexpr const char* kFactoryInterface = "org.gnome.evolution.dataserver.CalendarFactory";
constexpr const char* kCalendarInterface = "org.gnome.evolution.dataserver.Calendar";
constexpr const char* kViewInterface = "org.gnome.evolution.dataserver.CalendarView";

struct Gio {
  bool loaded = false;
  char* (*bus_address)(int, void*, GError**) = nullptr;
  GDBusConnection* (*connect_sync)(const char*, int, void*, void*, GError**) = nullptr;
  int (*is_closed)(GDBusConnection*) = nullptr;
  int (*close_sync)(GDBusConnection*, void*, GError**) = nullptr;
  void (*object_unref)(void*) = nullptr;
  GVariant* (*call_sync)(GDBusConnection*, const char*, const char*, const char*, const char*, GVariant*,
                         const GVariantType*, int, int, void*, GError**) = nullptr;
  unsigned (*signal_subscribe)(GDBusConnection*, const char*, const char*, const char*, const char*, const char*, int,
                               SignalCallback, void*, void (*)(void*)) = nullptr;
  void (*signal_unsubscribe)(GDBusConnection*, unsigned) = nullptr;
  GVariant* (*variant_new)(const char*, ...) = nullptr;
  GVariant* (*variant_ref)(GVariant*) = nullptr;
  void (*variant_unref)(GVariant*) = nullptr;
  GVariant* (*child)(GVariant*, size_t) = nullptr;
  GVariant* (*get_variant)(GVariant*) = nullptr;
  size_t (*n_children)(GVariant*) = nullptr;
  const char* (*get_string)(GVariant*, size_t*) = nullptr;
  const char* (*type_string)(GVariant*) = nullptr;
  char* (*remote_error)(const GError*) = nullptr;
  int (*strip_remote_error)(GError*) = nullptr;
  void (*error_free)(GError*) = nullptr;
  void (*free)(void*) = nullptr;
  uint32_t (*io_error_quark)() = nullptr;
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
    made.loaded = Load(library, "g_dbus_address_get_for_bus_sync", &made.bus_address) &&
                  Load(library, "g_dbus_connection_new_for_address_sync", &made.connect_sync) &&
                  Load(library, "g_dbus_connection_is_closed", &made.is_closed) &&
                  Load(library, "g_dbus_connection_close_sync", &made.close_sync) &&
                  Load(library, "g_object_unref", &made.object_unref) &&
                  Load(library, "g_dbus_connection_call_sync", &made.call_sync) &&
                  Load(library, "g_dbus_connection_signal_subscribe", &made.signal_subscribe) &&
                  Load(library, "g_dbus_connection_signal_unsubscribe", &made.signal_unsubscribe) &&
                  Load(library, "g_variant_new", &made.variant_new) &&
                  Load(library, "g_variant_ref", &made.variant_ref) &&
                  Load(library, "g_variant_unref", &made.variant_unref) &&
                  Load(library, "g_variant_get_child_value", &made.child) &&
                  Load(library, "g_variant_get_variant", &made.get_variant) &&
                  Load(library, "g_variant_n_children", &made.n_children) &&
                  Load(library, "g_variant_get_string", &made.get_string) &&
                  Load(library, "g_variant_get_type_string", &made.type_string) &&
                  Load(library, "g_dbus_error_get_remote_error", &made.remote_error) &&
                  Load(library, "g_dbus_error_strip_remote_error", &made.strip_remote_error) &&
                  Load(library, "g_error_free", &made.error_free) &&
                  Load(library, "g_free", &made.free) &&
                  Load(library, "g_io_error_quark", &made.io_error_quark);
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
  [[clang::no_sanitize("cfi-icall")]] size_t Size() const {
    return value_ && Container() ? Library().n_children(value_) : 0;
  }
  [[clang::no_sanitize("cfi-icall")]] Variant Child(size_t index) const {
    return index < Size() ? Variant(Library().child(value_, index)) : Variant();
  }
  [[clang::no_sanitize("cfi-icall")]] Variant Unboxed() const {
    if (!Is("v")) return Variant();
    return Variant(Library().get_variant(value_));
  }
  [[clang::no_sanitize("cfi-icall")]] size_t StringSize() const {
    if (!Is("s") && !Is("o")) return 0;
    size_t length = 0;
    Library().get_string(value_, &length);
    return length;
  }
  [[clang::no_sanitize("cfi-icall")]] std::string String() const {
    if (!Is("s") && !Is("o")) return std::string();
    const char* text = Library().get_string(value_, nullptr);
    return text ? std::string(text) : std::string();
  }
  [[clang::no_sanitize("cfi-icall")]] bool Is(const char* type) const {
    const char* actual = value_ ? Library().type_string(value_) : nullptr;
    return actual && std::strcmp(actual, type) == 0;
  }

 private:
  [[clang::no_sanitize("cfi-icall")]] bool Container() const {
    const char* type = Library().type_string(value_);
    return type && (type[0] == '(' || type[0] == 'a' || type[0] == '{' || type[0] == 'v');
  }
  [[clang::no_sanitize("cfi-icall")]] void Reset() {
    if (value_) Library().variant_unref(value_);
    value_ = nullptr;
  }
  GVariant* value_ = nullptr;
};

bool StartsWith(std::string_view text, std::string_view prefix) {
  return text.substr(0, prefix.size()) == prefix;
}

bool Contains(std::string_view text, std::string_view part) {
  return text.find(part) != std::string_view::npos;
}

[[clang::no_sanitize("cfi-icall")]] EdsResult Classify(GError* error, std::string_view what) {
  const Gio& gio = Library();
  EdsResult result{EdsStatus::kFailed, std::string(what)};
  if (!error) return result;
  char* remote = gio.remote_error(error);
  const std::string name = remote ? remote : "";
  result.timed_out = (error->domain == gio.io_error_quark() && error->code == kIoErrorTimedOut) ||
                     name == "org.freedesktop.DBus.Error.NoReply" || name == "org.freedesktop.DBus.Error.Timeout" ||
                     name == "org.freedesktop.DBus.Error.TimedOut";
  if (remote) gio.free(remote);
  gio.strip_remote_error(error);
  const std::string detail = error->message ? error->message : "";
  gio.error_free(error);
  if (name == "org.freedesktop.DBus.Error.ServiceUnknown" || name == "org.freedesktop.DBus.Error.NameHasNoOwner" ||
      StartsWith(name, "org.freedesktop.DBus.Error.Spawn.")) {
    result.status = EdsStatus::kUnavailable;
  } else if (Contains(name, "AccessDenied") || Contains(name, "AuthFailed") || Contains(name, "PermissionDenied") ||
             Contains(name, "AuthenticationRequired") || Contains(name, "AuthenticationFailed") ||
             Contains(name, "InteractiveAuthorizationRequired")) {
    result.status = EdsStatus::kDenied;
  }
  if (!detail.empty()) result.message += ": " + detail;
  return result;
}

bool HighestVersion(const Variant& names, std::string_view stem, std::string* best, int* best_version) {
  const Variant list = names.Child(0);
  bool found = false;
  for (size_t i = 0; i < list.Size(); ++i) {
    const std::string name = list.Child(i).String();
    if (!StartsWith(name, stem) || name.size() == stem.size() || name.size() > stem.size() + 3) continue;
    int version = 0;
    bool digits = true;
    for (char c : std::string_view(name).substr(stem.size())) {
      if (c < '0' || c > '9') digits = false;
      else version = version * 10 + (c - '0');
    }
    if (!digits || version <= *best_version) continue;
    *best_version = version;
    *best = name;
    found = true;
  }
  return found;
}

std::optional<std::string> Utc(int64_t ms) {
  if (ms < kEarliestQueryMs || ms > kLatestQueryMs) return std::nullopt;
  const time_t seconds = static_cast<time_t>(ms / 1000 - (ms % 1000 < 0 ? 1 : 0));
  struct tm parts;
  if (!gmtime_r(&seconds, &parts) || parts.tm_year + 1900 < 1 || parts.tm_year + 1900 > 9999) return std::nullopt;
  char text[32];
  std::snprintf(text, sizeof(text), "%04d%02d%02dT%02d%02d%02dZ", parts.tm_year + 1900, parts.tm_mon + 1,
                parts.tm_mday, parts.tm_hour, parts.tm_min, parts.tm_sec);
  return std::string(text);
}

using Clock = std::chrono::steady_clock;

int Remaining(Clock::time_point deadline, int cap) {
  const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - Clock::now()).count();
  return static_cast<int>(std::clamp<int64_t>(left, 0, cap));
}

EdsResult OutOfTime() {
  EdsResult result{EdsStatus::kFailed, "Ardia ran out of time before this calendar answered"};
  result.timed_out = true;
  return result;
}

bool IsEdsServiceName(std::string_view name) {
  for (std::string_view stem : {"Sources", "Calendar"}) {
    const std::string prefix = std::string(kPrefix) + std::string(stem);
    if (!StartsWith(name, prefix) || name.size() == prefix.size()) continue;
    if (std::all_of(name.begin() + prefix.size(), name.end(), [](char c) { return c >= '0' && c <= '9'; })) return true;
  }
  return false;
}

bool BackendGone(const EdsResult& result) {
  return result.status == EdsStatus::kUnavailable || Contains(result.message, "UnknownObject") ||
         Contains(result.message, "UnknownMethod") || Contains(result.message, "No such interface") ||
         Contains(result.message, "Disconnected") || Contains(result.message, "Object does not exist");
}

class SessionClient final : public EdsClient {
 public:
  SessionClient(ChangeListener listener, bool watch) : listener_(std::move(listener)), watch_(watch) {}
  ~SessionClient() override {
    CloseCalendars();
    Disconnect(true);
  }

  EdsResult Probe() override {
    EdsResult connected = Connect();
    if (!connected.ok()) return connected;
    return Discover();
  }

  [[clang::no_sanitize("cfi-icall")]] EdsResult Sources(std::vector<EdsSource>* sources) override {
    EdsResult ready = Probe();
    if (!ready.ok()) return ready;
    WatchSources();
    Variant reply;
    EdsResult called = Call(sources_name_.c_str(), kSourceManagerPath, kObjectManager, "GetManagedObjects", nullptr,
                            kCallTimeoutMs, kCallNone, &reply);
    if (!called.ok()) return called;
    const Variant objects = reply.Child(0);
    for (size_t i = 0; i < objects.Size(); ++i) {
      const Variant interfaces = objects.Child(i).Child(1);
      for (size_t j = 0; j < interfaces.Size(); ++j) {
        const Variant entry = interfaces.Child(j);
        if (entry.Child(0).String() != kSourceInterface) continue;
        EdsSource source;
        const Variant properties = entry.Child(1);
        for (size_t k = 0; k < properties.Size(); ++k) {
          const Variant property = properties.Child(k);
          const std::string key = property.Child(0).String();
          const std::string value = property.Child(1).Unboxed().String();
          if (key == "UID") source.uid = value;
          if (key == "Data") source.data = ParseKeyFile(value);
        }
        if (!source.uid.empty()) sources->push_back(std::move(source));
      }
    }
    return {};
  }

  [[clang::no_sanitize("cfi-icall")]] EdsCalendarObjects Objects(const std::string& uid, int64_t start_ms,
                                                                 int64_t end_ms, int budget_ms,
                                                                 size_t max_bytes) override {
    EdsCalendarObjects objects;
    const auto query = EdsTimeRangeQuery(start_ms, end_ms);
    if (!query) {
      objects.result = {EdsStatus::kFailed, "That time range can't be asked of Evolution Data Server"};
      return objects;
    }
    const auto cooling = cooling_.find(uid);
    if (cooling != cooling_.end() && Clock::now() < cooling->second) {
      objects.result = {EdsStatus::kFailed, "This calendar didn't answer recently, so Ardia is skipping it for now"};
      objects.result.timed_out = true;
      return objects;
    }
    cooling_.erase(uid);
    const Clock::time_point deadline = Clock::now() + std::chrono::milliseconds(std::max(0, budget_ms));
    Variant reply;
    objects.result = CallCalendar(uid, "GetObjectList", *query, deadline, &reply);
    if (objects.result.timed_out) cooling_[uid] = Clock::now() + std::chrono::milliseconds(kTimeoutCooldownMs);
    if (!objects.result.ok()) return objects;
    const Variant list = reply.Child(0);
    const size_t limit = std::min(max_bytes, kMaxObjectBytes * 16);
    size_t bytes = 0;
    for (size_t i = 0; i < list.Size(); ++i) {
      const Variant item = list.Child(i);
      const size_t size = item.StringSize();
      if (size > kMaxObjectBytes) {
        objects.truncated = true;
        continue;
      }
      if (objects.objects.size() >= kMaxObjectsPerCalendar || bytes + size > limit) {
        objects.truncated = true;
        break;
      }
      bytes += size;
      objects.objects.push_back(item.String());
    }
    return objects;
  }

  EdsResult Timezone(const std::string& uid, const std::string& tzid, std::string* ics) override {
    Variant reply;
    EdsResult result =
        CallCalendar(uid, "GetTimezone", tzid, Clock::now() + std::chrono::milliseconds(kCallTimeoutMs), &reply);
    if (result.ok()) *ics = reply.Child(0).String();
    return result;
  }

  [[clang::no_sanitize("cfi-icall")]] void CloseCalendars() override {
    for (auto& [uid, calendar] : calendars_) Release(calendar, true);
    calendars_.clear();
  }

 private:
  struct OpenCalendar {
    std::string path;
    std::string bus;
    std::string view;
    unsigned view_subscription = 0;
  };

  [[clang::no_sanitize("cfi-icall")]] EdsResult Connect() {
    const Gio& gio = Library();
    if (!gio.loaded) return {EdsStatus::kUnavailable, "GIO is unavailable, so Ardia can't reach the D-Bus session bus"};
    if (bus_ && !gio.is_closed(bus_)) return {};
    if (bus_) {
      for (auto& [uid, calendar] : calendars_) Release(calendar, false);
      calendars_.clear();
      Disconnect(false);
    }
    GError* error = nullptr;
    char* address = gio.bus_address(kBusSession, nullptr, &error);
    if (address) {
      bus_ = gio.connect_sync(address, kConnectionFlags, nullptr, nullptr, &error);
      gio.free(address);
    }
    if (bus_) {
      if (watch_) {
        owner_subscription_ = gio.signal_subscribe(bus_, kBus, kBus, "NameOwnerChanged", kBusPath, kNamespace,
                                                   kMatchArg0Namespace, &SessionClient::OnOwner, this, nullptr);
      }
      return {};
    }
    EdsResult result = Classify(error, "There is no D-Bus session bus");
    result.status = EdsStatus::kUnavailable;
    return result;
  }

  [[clang::no_sanitize("cfi-icall")]] void Disconnect(bool close) {
    Unsubscribe(&sources_subscription_);
    Unsubscribe(&owner_subscription_);
    sources_name_.clear();
    factory_name_.clear();
    if (!bus_) return;
    const Gio& gio = Library();
    if (close && !gio.is_closed(bus_)) gio.close_sync(bus_, nullptr, nullptr);
    gio.object_unref(bus_);
    bus_ = nullptr;
  }

  [[clang::no_sanitize("cfi-icall")]] EdsResult Discover() {
    std::string sources;
    std::string factory;
    int sources_version = 0;
    int factory_version = 0;
    for (const char* method : {"ListNames", "ListActivatableNames"}) {
      Variant names;
      EdsResult listed = Call(kBus, kBusPath, kBus, method, nullptr, kListTimeoutMs, kCallNoAutoStart, &names);
      if (!listed.ok()) return listed;
      HighestVersion(names, std::string(kPrefix) + "Sources", &sources, &sources_version);
      HighestVersion(names, std::string(kPrefix) + "Calendar", &factory, &factory_version);
    }
    if (sources.empty() || factory.empty()) {
      return {EdsStatus::kUnavailable, "Evolution Data Server isn't installed or running in this session"};
    }
    if (sources != sources_name_) {
      Unsubscribe(&sources_subscription_);
      sources_name_ = sources;
    }
    if (factory != factory_name_) {
      CloseCalendars();
      factory_name_ = factory;
    }
    return {};
  }

  [[clang::no_sanitize("cfi-icall")]] EdsResult Call(const char* name, const char* path, const char* interface,
                                                     const char* method, GVariant* arguments, int timeout_ms,
                                                     int flags, Variant* reply) {
    const Gio& gio = Library();
    GError* error = nullptr;
    GVariant* answer = gio.call_sync(bus_, name, path, interface, method, arguments, nullptr, flags, timeout_ms,
                                     nullptr, &error);
    if (!answer) return Classify(error, std::string(interface) + "." + method + " failed");
    *reply = Variant(answer);
    return {};
  }

  [[clang::no_sanitize("cfi-icall")]] EdsResult CallCalendar(const std::string& uid, const char* method,
                                                             const std::string& argument, Clock::time_point deadline,
                                                             Variant* reply) {
    for (int attempt = 0; attempt < 2; ++attempt) {
      OpenCalendar* calendar = nullptr;
      EdsResult opened = Open(uid, deadline, &calendar);
      if (!opened.ok()) return opened;
      const int timeout = Remaining(deadline, kCallTimeoutMs);
      if (!timeout) return OutOfTime();
      EdsResult called = Call(calendar->bus.c_str(), calendar->path.c_str(), kCalendarInterface, method,
                              Library().variant_new("(s)", argument.c_str()), timeout, kCallNone, reply);
      if (called.ok() || !BackendGone(called) || attempt) return called;
      Forget(uid);
    }
    return {EdsStatus::kFailed, "The calendar backend kept closing"};
  }

  [[clang::no_sanitize("cfi-icall")]] EdsResult Open(const std::string& uid, Clock::time_point deadline,
                                                     OpenCalendar** out) {
    auto found = calendars_.find(uid);
    if (found != calendars_.end()) {
      *out = &found->second;
      return {};
    }
    if (!Remaining(deadline, kOpenTimeoutMs)) return OutOfTime();
    EdsResult ready = Probe();
    if (!ready.ok()) return ready;
    const Gio& gio = Library();
    Variant opened;
    int timeout = Remaining(deadline, kOpenTimeoutMs);
    if (!timeout) return OutOfTime();
    EdsResult called = Call(factory_name_.c_str(), kFactoryPath, kFactoryInterface, "OpenCalendar",
                            gio.variant_new("(s)", uid.c_str()), timeout, kCallNone, &opened);
    if (!called.ok()) return called;
    OpenCalendar calendar;
    calendar.path = opened.Child(0).String();
    calendar.bus = opened.Child(1).String();
    if (calendar.path.empty() || calendar.bus.empty()) {
      return {EdsStatus::kFailed, "Evolution Data Server didn't say where the calendar opened"};
    }
    Variant ignored;
    timeout = Remaining(deadline, kOpenTimeoutMs);
    EdsResult ready_calendar = timeout ? Call(calendar.bus.c_str(), calendar.path.c_str(), kCalendarInterface, "Open",
                                              nullptr, timeout, kCallNone, &ignored)
                                       : OutOfTime();
    if (!ready_calendar.ok()) {
      Call(calendar.bus.c_str(), calendar.path.c_str(), kCalendarInterface, "Close", nullptr, kCloseTimeoutMs,
           kCallNone, &ignored);
      return ready_calendar;
    }
    WatchObjects(&calendar, deadline);
    auto [inserted, added] = calendars_.emplace(uid, std::move(calendar));
    *out = &inserted->second;
    return {};
  }

  [[clang::no_sanitize("cfi-icall")]] void WatchObjects(OpenCalendar* calendar, Clock::time_point deadline) {
    const Gio& gio = Library();
    if (!watch_ || !Remaining(deadline, kCallTimeoutMs)) return;
    Variant view;
    if (!Call(calendar->bus.c_str(), calendar->path.c_str(), kCalendarInterface, "GetView",
              gio.variant_new("(s)", "#t"), Remaining(deadline, kCallTimeoutMs), kCallNone, &view).ok()) return;
    calendar->view = view.Child(0).String();
    if (calendar->view.empty()) return;
    Variant ignored;
    Call(calendar->bus.c_str(), calendar->view.c_str(), kViewInterface, "SetFlags", gio.variant_new("(u)", 0u),
         std::max(1, Remaining(deadline, kCallTimeoutMs)), kCallNone, &ignored);
    calendar->view_subscription = gio.signal_subscribe(bus_, calendar->bus.c_str(), kViewInterface, nullptr,
                                                       calendar->view.c_str(), nullptr, 0, &SessionClient::OnView,
                                                       this, nullptr);
    Call(calendar->bus.c_str(), calendar->view.c_str(), kViewInterface, "Start", nullptr,
         std::max(1, Remaining(deadline, kCallTimeoutMs)), kCallNone, &ignored);
  }

  [[clang::no_sanitize("cfi-icall")]] void WatchSources() {
    if (!watch_ || sources_subscription_) return;
    sources_subscription_ = Library().signal_subscribe(bus_, sources_name_.c_str(), nullptr, nullptr, nullptr,
                                                       nullptr, 0, &SessionClient::OnSources, this, nullptr);
  }

  [[clang::no_sanitize("cfi-icall")]] void Unsubscribe(unsigned* subscription) {
    if (*subscription && bus_) Library().signal_unsubscribe(bus_, *subscription);
    *subscription = 0;
  }

  [[clang::no_sanitize("cfi-icall")]] void Release(OpenCalendar& calendar, bool close) {
    Unsubscribe(&calendar.view_subscription);
    if (!close || !bus_) return;
    Variant ignored;
    if (!calendar.view.empty()) {
      Call(calendar.bus.c_str(), calendar.view.c_str(), kViewInterface, "Dispose", nullptr, kCloseTimeoutMs,
           kCallNoAutoStart, &ignored);
    }
    Call(calendar.bus.c_str(), calendar.path.c_str(), kCalendarInterface, "Close", nullptr, kCloseTimeoutMs,
         kCallNoAutoStart, &ignored);
  }

  void Forget(const std::string& uid) {
    auto found = calendars_.find(uid);
    if (found == calendars_.end()) return;
    Release(found->second, false);
    calendars_.erase(found);
  }

  void Notify(EdsChange change) {
    if (listener_) listener_(change);
  }

  static void OnView(GDBusConnection*, const char*, const char*, const char*, const char* signal, GVariant*,
                     void* self) {
    if (!signal || !StartsWith(signal, "Objects")) return;
    static_cast<SessionClient*>(self)->Notify(EdsChange::kObjects);
  }

  static void OnSources(GDBusConnection*, const char*, const char*, const char* interface, const char* signal,
                        GVariant*, void* self) {
    if (!interface || !signal) return;
    const bool manager = std::strcmp(interface, kObjectManager) == 0 && StartsWith(signal, "Interfaces");
    const bool properties = std::strcmp(interface, "org.freedesktop.DBus.Properties") == 0 &&
                            std::strcmp(signal, "PropertiesChanged") == 0;
    if (manager || properties) static_cast<SessionClient*>(self)->Notify(EdsChange::kSources);
  }

  [[clang::no_sanitize("cfi-icall")]] static void OnOwner(GDBusConnection*, const char*, const char*, const char*,
                                                          const char*, GVariant* parameters, void* self) {
    if (!parameters) return;
    const Variant arguments(Library().variant_ref(parameters));
    if (!arguments.Is("(sss)")) return;
    const std::string name = arguments.Child(0).String();
    const std::string owner = arguments.Child(2).String();
    static_cast<SessionClient*>(self)->OwnerChanged(name, owner);
  }

  void OwnerChanged(const std::string& name, const std::string& owner) {
    if (!owner.empty()) {
      if (!IsEdsServiceName(name)) return;
      cooling_.clear();
      Notify(EdsChange::kService);
      return;
    }
    bool tracked = false;
    if (name == sources_name_ || name == factory_name_) {
      for (auto& [uid, calendar] : calendars_) Release(calendar, false);
      calendars_.clear();
      Unsubscribe(&sources_subscription_);
      tracked = true;
    } else {
      for (auto it = calendars_.begin(); it != calendars_.end();) {
        if (it->second.bus != name) {
          ++it;
          continue;
        }
        Release(it->second, false);
        it = calendars_.erase(it);
        tracked = true;
      }
    }
    if (!tracked) return;
    cooling_.clear();
    Notify(EdsChange::kService);
  }

  ChangeListener listener_;
  const bool watch_;
  GDBusConnection* bus_ = nullptr;
  std::string sources_name_;
  std::string factory_name_;
  unsigned sources_subscription_ = 0;
  unsigned owner_subscription_ = 0;
  std::map<std::string, OpenCalendar> calendars_;
  std::map<std::string, Clock::time_point> cooling_;
};

}

std::string_view EdsStatusName(EdsStatus status) {
  switch (status) {
    case EdsStatus::kOk: return "ok";
    case EdsStatus::kUnavailable: return "unavailable";
    case EdsStatus::kDenied: return "denied";
    case EdsStatus::kFailed: return "failed";
  }
  return "failed";
}

KeyFile ParseKeyFile(std::string_view text) {
  KeyFile file;
  std::string group;
  while (!text.empty()) {
    const size_t end = text.find('\n');
    std::string_view line = text.substr(0, end);
    text = end == std::string_view::npos ? std::string_view() : text.substr(end + 1);
    while (!line.empty() && (line.back() == '\r' || line.back() == ' ' || line.back() == '\t')) line.remove_suffix(1);
    while (!line.empty() && (line.front() == ' ' || line.front() == '\t')) line.remove_prefix(1);
    if (line.empty() || line.front() == '#') continue;
    if (line.front() == '[' && line.back() == ']') {
      group = std::string(line.substr(1, line.size() - 2));
      file[group];
      continue;
    }
    const size_t equals = line.find('=');
    if (group.empty() || equals == std::string_view::npos) continue;
    std::string_view key = line.substr(0, equals);
    std::string_view raw = line.substr(equals + 1);
    while (!key.empty() && (key.back() == ' ' || key.back() == '\t')) key.remove_suffix(1);
    while (!raw.empty() && (raw.front() == ' ' || raw.front() == '\t')) raw.remove_prefix(1);
    if (key.empty() || key.find('[') != std::string_view::npos) continue;
    std::string value;
    for (size_t i = 0; i < raw.size(); ++i) {
      if (raw[i] != '\\' || i + 1 == raw.size()) {
        value += raw[i];
        continue;
      }
      const char next = raw[++i];
      value += next == 'n' ? '\n' : next == 't' ? '\t' : next == 'r' ? '\r' : next == 's' ? ' ' : next;
    }
    file[group][std::string(key)] = std::move(value);
  }
  return file;
}

std::optional<std::string> EdsTimeRangeQuery(int64_t start_ms, int64_t end_ms) {
  const auto start = Utc(start_ms);
  const auto end = Utc(end_ms);
  if (!start || !end) return std::nullopt;
  return "(occur-in-time-range? (make-time \"" + *start + "\") (make-time \"" + *end + "\"))";
}

bool IsCalendarSource(const EdsSource& source) {
  return source.data.count("Calendar") > 0;
}

std::unique_ptr<EdsClient> SessionEdsClient(EdsClient::ChangeListener listener) {
  return std::make_unique<SessionClient>(std::move(listener), true);
}

EdsResult ProbeEds() {
  SessionClient client(nullptr, false);
  return client.Probe();
}

}
