#ifndef ARDIA_LINUX_AC_LINUX_PROFILES_H_
#define ARDIA_LINUX_AC_LINUX_PROFILES_H_

#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace ardiacore::linux_profiles {

enum class ProfileKind { kDefault, kIsolated, kPrivate };

enum class ProfileError {
  kNone,
  kInvalid,
  kDeleted,
  kReleased,
  kUnavailable,
  kWindowMismatch,
  kPrivateService,
  kPrivateEnding,
};

struct ProfileName {
  ProfileKind kind = ProfileKind::kDefault;
  std::string id;
  std::string original;
  std::string window;
};

inline constexpr std::string_view kPrivatePrefix = "incognito:";
inline constexpr size_t kMaxProfileTokenLength = 128;
inline constexpr int kPrivateEndingRetries = 50;

struct StartupProfiles {
  std::string last_used;
  std::vector<std::string> last_active;
  bool picker_on_startup = true;
  bool operator==(const StartupProfiles&) const = default;
};

struct WindowAccess {
  std::string id;
  std::string page_profile;
  int host = 0;
  int opener_host = 0;
  uint64_t opener_generation = 0;
};

struct WindowRequester {
  int host = 0;
  uint64_t generation = 0;
};

enum class OpeningAdmission { kStarted, kJoined, kMismatch };

struct OpeningTicket {
  OpeningAdmission admission;
  uint64_t generation;
};

std::optional<ProfileName> ParseProfileName(std::string_view value);
bool PrivateWindow(const WindowAccess& window);
bool WindowReachableBy(const WindowAccess& window, const WindowRequester& requester);
bool WindowFocusableBy(const WindowAccess& window, const WindowRequester& requester);
bool WindowListedAsPrivate(const WindowAccess& window, const WindowRequester& requester);
StartupProfiles PinnedStartupProfiles(const StartupProfiles& current, std::string_view app_directory);
std::string ProfileDirectoryName(std::string_view isolated_id);
std::string_view ProfileErrorCode(ProfileError error);
std::string_view ProfileErrorMessage(ProfileError error);
bool ProfileOpensWindow(const ProfileName& name, bool incognito, bool utility);
int NextPrivateOrdinal(const std::vector<int>& taken);

template <class Done>
class OpeningLedger {
 public:
  OpeningTicket Begin(const std::string& id, const std::string& profile, Done& done) {
    const auto found = pending_.find(id);
    if (found != pending_.end()) {
      if (found->second.profile != profile) return {OpeningAdmission::kMismatch, 0};
      found->second.waiters.push_back(std::move(done));
      return {OpeningAdmission::kJoined, found->second.generation};
    }
    Entry& entry = pending_[id];
    entry.profile = profile;
    entry.generation = ++generation_;
    entry.waiters.push_back(std::move(done));
    return {OpeningAdmission::kStarted, entry.generation};
  }

  bool Current(const std::string& id, uint64_t generation) const {
    const auto found = pending_.find(id);
    return found != pending_.end() && found->second.generation == generation;
  }

  std::vector<Done> Finish(const std::string& id, uint64_t generation) {
    const auto found = pending_.find(id);
    if (found == pending_.end() || found->second.generation != generation) return {};
    std::vector<Done> waiters = std::move(found->second.waiters);
    pending_.erase(found);
    return waiters;
  }

  size_t Pending() const { return pending_.size(); }

 private:
  struct Entry {
    std::string profile;
    uint64_t generation = 0;
    std::vector<Done> waiters;
  };
  std::map<std::string, Entry> pending_;
  uint64_t generation_ = 0;
};

template <class P>
class ProfileRegistry {
 public:
  using Done = std::function<void(P*, ProfileError)>;

  class Backend {
   public:
    virtual ~Backend() = default;
    virtual void Load(const std::string& directory, std::function<void(P*)> done) = 0;
    virtual P* ExistingOffTheRecord(P* original) = 0;
    virtual P* CreateOffTheRecord(P* original) = 0;
    virtual bool Usable(P* profile) const = 0;
    virtual bool OffTheRecordProfile(P* profile) const = 0;
    virtual void Later(std::function<void()> task) = 0;
    virtual bool Watch(P* profile) = 0;
  };

  explicit ProfileRegistry(Backend& backend) : backend_(backend) {}
  ~ProfileRegistry() { *alive_ = false; }
  ProfileRegistry(const ProfileRegistry&) = delete;
  ProfileRegistry& operator=(const ProfileRegistry&) = delete;

  bool SetDefault(P* profile) {
    if (!profile || backend_.OffTheRecordProfile(profile)) return false;
    if (default_ && default_ != profile) return false;
    if (!backend_.Watch(profile)) return false;
    default_ = profile;
    regular_[""] = profile;
    return true;
  }

  P* Default() const { return Lookup(""); }

  P* Lookup(std::string_view value) const {
    const auto name = ParseProfileName(value);
    if (!name) return nullptr;
    if (name->kind == ProfileKind::kPrivate) {
      if (released_.contains(name->id)) return nullptr;
      const auto found = private_.find(name->id);
      return found != private_.end() && backend_.Usable(found->second) ? found->second : nullptr;
    }
    if (deleted_.contains(name->id)) return nullptr;
    const auto found = regular_.find(name->id);
    return found != regular_.end() && backend_.Usable(found->second) ? found->second : nullptr;
  }

  std::optional<std::string> NameOf(const P* profile) const {
    if (!profile) return std::nullopt;
    for (const auto& [id, candidate] : regular_) {
      if (candidate == profile && !deleted_.contains(id) && backend_.Usable(candidate)) return id;
    }
    return std::nullopt;
  }

  bool Hosts(std::string_view requested, const P* window_profile) const {
    const P* resolved = Lookup(requested);
    return resolved && resolved == window_profile;
  }

  void Resolve(std::string_view value, Done done) {
    const auto name = ParseProfileName(value);
    if (!name) return done(nullptr, ProfileError::kInvalid);
    if (name->kind == ProfileKind::kPrivate) return ResolvePrivate(*name, std::move(done));
    ResolveRegular(name->id, std::move(done));
  }

  bool Release(std::string_view value) {
    const auto name = ParseProfileName(value);
    if (!name || name->kind != ProfileKind::kPrivate) return false;
    released_.insert(name->id);
    private_.erase(name->id);
    auto waiting = private_waiting_.extract(name->id);
    if (!waiting.empty()) {
      auto alive = alive_;
      for (auto& done : waiting.mapped()) {
        done(nullptr, ProfileError::kReleased);
        if (!*alive) return true;
      }
    }
    return true;
  }

  bool MarkDeleted(std::string_view value) {
    const auto name = ParseProfileName(value);
    if (!name || name->kind != ProfileKind::kIsolated) return false;
    deleted_.insert(name->id);
    regular_.erase(name->id);
    for (auto it = private_.begin(); it != private_.end();) {
      const auto parsed = ParseProfileName(it->first);
      if (parsed && parsed->original == name->id) it = private_.erase(it);
      else ++it;
    }
    return true;
  }

  void Forget(const P* profile) {
    if (!profile) return;
    if (default_ == profile) default_ = nullptr;
    std::erase_if(regular_, [profile](const auto& entry) { return entry.second == profile; });
    std::erase_if(private_, [profile](const auto& entry) { return entry.second == profile; });
  }

  bool Released(std::string_view value) const {
    const auto name = ParseProfileName(value);
    return name && released_.contains(name->id);
  }

  size_t PrivateNames(const P* profile) const {
    size_t count = 0;
    for (const auto& [id, candidate] : private_) count += candidate == profile;
    return count;
  }

 private:
  void ResolveRegular(const std::string& id, Done done) {
    if (deleted_.contains(id)) return done(nullptr, ProfileError::kDeleted);
    if (P* loaded = Lookup(id)) return done(loaded, ProfileError::kNone);
    if (id.empty()) return done(nullptr, ProfileError::kUnavailable);
    auto& waiters = waiting_[id];
    waiters.push_back(std::move(done));
    if (waiters.size() > 1) return;
    backend_.Load(ProfileDirectoryName(id), [this, alive = alive_, id](P* loaded) {
      if (!*alive) return;
      auto node = waiting_.extract(id);
      if (node.empty()) return;
      ProfileError error = ProfileError::kNone;
      if (deleted_.contains(id)) {
        loaded = nullptr;
        error = ProfileError::kDeleted;
      } else if (!loaded || !backend_.Usable(loaded) || backend_.OffTheRecordProfile(loaded) ||
                 loaded == default_ || NameOf(loaded) || !backend_.Watch(loaded)) {
        loaded = nullptr;
        error = ProfileError::kUnavailable;
      } else {
        regular_[id] = loaded;
      }
      for (auto& waiter : node.mapped()) {
        waiter(loaded, error);
        if (!*alive) return;
      }
    });
  }

  void ResolvePrivate(const ProfileName& name, Done done) {
    if (released_.contains(name.id)) return done(nullptr, ProfileError::kReleased);
    if (P* existing = Lookup(name.id)) return done(existing, ProfileError::kNone);
    auto& waiters = private_waiting_[name.id];
    waiters.push_back(std::move(done));
    if (waiters.size() > 1) return;
    ResolveRegular(name.original, [this, alive = alive_, id = name.id, original_id = name.original](P* original, ProfileError error) {
      if (!*alive) return;
      if (!original) return FinishPrivate(id, nullptr, error);
      AcquirePrivate(id, original_id, kPrivateEndingRetries);
    });
  }

  void AcquirePrivate(const std::string& id, const std::string& original_id, int attempts) {
    if (!private_waiting_.contains(id)) return;
    if (released_.contains(id)) return FinishPrivate(id, nullptr, ProfileError::kReleased);
    P* original = Lookup(original_id);
    if (!original) {
      return FinishPrivate(id, nullptr, deleted_.contains(original_id) ? ProfileError::kDeleted : ProfileError::kUnavailable);
    }
    P* existing = backend_.ExistingOffTheRecord(original);
    if (existing && (!backend_.Usable(existing) || !backend_.Watch(existing))) {
      if (attempts <= 0) return FinishPrivate(id, nullptr, ProfileError::kPrivateEnding);
      backend_.Later([this, alive = alive_, id, original_id, attempts] {
        if (*alive) AcquirePrivate(id, original_id, attempts - 1);
      });
      return;
    }
    P* otr = existing ? existing : backend_.CreateOffTheRecord(original);
    if (!otr || otr == original || !backend_.Usable(otr) || !backend_.OffTheRecordProfile(otr) ||
        !backend_.Watch(otr)) {
      return FinishPrivate(id, nullptr, ProfileError::kUnavailable);
    }
    private_[id] = otr;
    FinishPrivate(id, otr, ProfileError::kNone);
  }

  void FinishPrivate(const std::string& id, P* otr, ProfileError error) {
    auto node = private_waiting_.extract(id);
    if (node.empty()) return;
    auto alive = alive_;
    for (auto& waiter : node.mapped()) {
      waiter(otr, error);
      if (!*alive) return;
    }
  }

  Backend& backend_;
  std::shared_ptr<bool> alive_ = std::make_shared<bool>(true);
  P* default_ = nullptr;
  std::map<std::string, P*> regular_;
  std::map<std::string, P*> private_;
  std::map<std::string, std::vector<Done>> waiting_;
  std::map<std::string, std::vector<Done>> private_waiting_;
  std::set<std::string> released_;
  std::set<std::string> deleted_;
};

}

#endif
