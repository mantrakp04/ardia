#ifndef ARDIA_LINUX_AC_LINUX_EXTENSIONS_H_
#define ARDIA_LINUX_AC_LINUX_EXTENSIONS_H_

#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "base/values.h"

namespace ardia::linux_extensions {

inline constexpr size_t kMaxActionIds = 64;
inline constexpr size_t kMaxPendingPrompts = 8;
inline constexpr size_t kMaxSurfacesPerWindow = 4;
inline constexpr size_t kMaxIconBytes = 512 * 1024;
inline constexpr size_t kMaxPathBytes = 4096;
inline constexpr size_t kMaxTabKey = 256;
inline constexpr size_t kMaxRequestId = 64;
inline constexpr size_t kMaxSurfaceUrl = 2048;
inline constexpr double kPopupWaitSeconds = 10;

inline constexpr int kPromptInstall = 0;
inline constexpr int kPromptReEnable = 3;
inline constexpr int kPromptPermissions = 4;
inline constexpr int kPromptExternal = 5;
inline constexpr int kPromptRemote = 8;
inline constexpr int kPromptRepair = 9;

inline constexpr const char* kSurfaceCapabilities[] = {"extensionView.create", "extensionView.viewport",
                                                        "extensionView.command", "extensionView.release"};

bool ValidExtensionId(std::string_view id);
bool ValidFolderPath(std::string_view path);
bool LinuxHandles(std::string_view name);
bool UsesWindowProfile(std::string_view name);
enum class PrivateRoute { kWindow, kOriginal, kEnding, kRefused };
PrivateRoute PrivateWindowRoute(std::string_view name, bool ending);
bool ServesPrivateWindow(std::string_view name);
std::string ValidateRequest(std::string_view name, const base::DictValue& input);
std::optional<base::DictValue> Configuration(const base::DictValue& input);
bool ReloadsExtensionFolder(std::string_view name, const base::DictValue& input);

struct ManifestFacts {
  std::string name;
  std::optional<std::string> short_name;
  std::string version;
  std::string description;
  int manifest_version = 2;
  std::optional<std::string> icon_path;
  std::vector<std::string> permissions;
  std::vector<std::string> optional_permissions;
  std::vector<std::string> host_permissions;
  bool has_action = false;
  std::optional<std::string> popup;
  std::optional<std::string> action_title;
  std::optional<std::string> action_icon_path;
  std::optional<std::string> options_page;
  std::optional<std::string> side_panel;
  std::optional<std::string> homepage;
  bool incognito_split = false;
};

std::optional<std::string> IconPath(const base::Value* icons, int size);
ManifestFacts ReadManifest(const base::DictValue& manifest);
std::optional<std::string> ResourcePath(std::string_view relative);
std::string ImageMimeType(std::string_view path);
std::string Base64(std::string_view bytes);
std::string DataUrl(std::string_view path, std::string_view bytes);

std::optional<base::ListValue> Entries(const base::Value& reply);
base::DictValue DecorateEntry(const base::DictValue& entry, const ManifestFacts* facts,
                              const std::string& action_icon);
base::DictValue Package(const ManifestFacts& facts, std::string_view id, std::string_view path,
                        std::string_view icon);
std::optional<base::DictValue> SearchEngines(const base::Value& reply);

struct Change {
  std::string id;
  std::string event;
};
std::optional<Change> ChangeFor(std::string_view name, const base::DictValue& input, const base::Value& reply);
base::DictValue ChangeEvent(const Change& change, std::string_view profile);

std::string PromptTypeName(int type);
std::optional<std::string> HexColor(uint32_t argb);
std::string DisplayBadge(std::string_view text);

struct ActionFacts {
  std::string title;
  std::string badge;
  uint32_t badge_color = 0;
  uint32_t badge_text_color = 0;
  std::string popup;
  bool enabled = false;
  std::string icon;
};
base::DictValue ActionState(const ActionFacts& facts);

enum class SurfaceKind { kPopup, kSidePanel };
struct SurfaceRequest {
  SurfaceKind kind = SurfaceKind::kPopup;
  std::string url;
  std::string extension_id;
};
std::string ValidateSurfaceRequest(const base::DictValue& args, SurfaceRequest* request);
std::optional<std::string> ExtensionUrlHost(std::string_view url);

enum class PromptResolve { kResolved, kUnknown, kWrongWindow, kWrongProfile };

template <typename Done>
class PromptLedger {
 public:
  struct Entry {
    std::string profile;
    int window = 0;
    base::DictValue payload;
    Done done;
  };

  std::optional<std::string> Add(std::string profile, int window, base::DictValue payload, Done done) {
    if (entries_.size() >= kMaxPendingPrompts) return std::nullopt;
    std::string id = "install" + std::to_string(++next_);
    payload.Set("requestId", id);
    entries_.emplace(id, Entry{std::move(profile), window, std::move(payload), std::move(done)});
    return id;
  }

  const Entry* Find(std::string_view id) const {
    auto found = entries_.find(std::string(id));
    return found == entries_.end() ? nullptr : &found->second;
  }

  PromptResolve Check(std::string_view id, int window, std::string_view profile) const {
    const Entry* entry = Find(id);
    if (!entry) return PromptResolve::kUnknown;
    if (entry->profile != profile) return PromptResolve::kWrongProfile;
    if (entry->window != window) return PromptResolve::kWrongWindow;
    return PromptResolve::kResolved;
  }

  std::optional<Done> Take(std::string_view id) {
    auto found = entries_.find(std::string(id));
    if (found == entries_.end()) return std::nullopt;
    Done done = std::move(found->second.done);
    entries_.erase(found);
    return std::optional<Done>(std::move(done));
  }

  std::vector<std::string> OfWindow(int window) const {
    std::vector<std::string> ids;
    for (const auto& [id, entry] : entries_) {
      if (entry.window == window) ids.push_back(id);
    }
    return ids;
  }

  void SetPayload(std::string_view id, base::DictValue payload) {
    auto found = entries_.find(std::string(id));
    if (found != entries_.end()) found->second.payload = std::move(payload);
  }

  bool Move(std::string_view id, int window) {
    auto found = entries_.find(std::string(id));
    if (found == entries_.end()) return false;
    found->second.window = window;
    return true;
  }

  std::vector<Done> TakeAll() {
    std::vector<Done> all;
    for (auto& [id, entry] : entries_) all.push_back(std::move(entry.done));
    entries_.clear();
    return all;
  }

  size_t size() const { return entries_.size(); }

 private:
  std::map<std::string, Entry> entries_;
  uint64_t next_ = 0;
};

struct SurfaceEntry {
  SurfaceKind kind = SurfaceKind::kPopup;
  std::string extension_id;
  uint64_t generation = 0;
};

class SurfaceBook {
 public:
  std::optional<int> Open(SurfaceKind kind, std::string extension_id, uint64_t generation);
  bool Close(int id);
  std::vector<int> CloseExtension(std::string_view extension_id);
  std::vector<int> CloseOlderThan(uint64_t generation);
  std::vector<int> CloseAll();
  const SurfaceEntry* Find(int id) const;
  bool Owns(int id, uint64_t generation) const;
  size_t size() const { return entries_.size(); }

 private:
  std::map<int, SurfaceEntry> entries_;
  int next_ = 0;
};

template <typename Callback>
class PendingPopup {
 public:
  std::optional<Callback> Expect(std::string extension_id, double now, Callback callback) {
    std::optional<Callback> previous = Fail();
    extension_id_ = std::move(extension_id);
    deadline_ = now + kPopupWaitSeconds;
    callback_ = std::move(callback);
    return previous;
  }

  std::optional<Callback> Match(std::string_view extension_id, double now) {
    if (!callback_ || extension_id != extension_id_ || now > deadline_) return std::nullopt;
    return Fail();
  }

  std::optional<Callback> Expire(double now) {
    if (!callback_ || now <= deadline_) return std::nullopt;
    return Fail();
  }

  std::optional<Callback> Fail() {
    if (!callback_) return std::nullopt;
    std::optional<Callback> taken = std::move(callback_);
    callback_.reset();
    extension_id_.clear();
    return taken;
  }

  bool pending() const { return callback_.has_value(); }
  const std::string& extension_id() const { return extension_id_; }

 private:
  std::string extension_id_;
  double deadline_ = 0;
  std::optional<Callback> callback_;
};

}

#endif
