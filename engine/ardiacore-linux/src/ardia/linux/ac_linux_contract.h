#ifndef ARDIA_LINUX_AC_LINUX_CONTRACT_H_
#define ARDIA_LINUX_AC_LINUX_CONTRACT_H_

#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <initializer_list>

namespace ardiacore::linux_contract {

struct LaunchOffer {
  std::string key;
  std::string url;
  std::string profile;
  int tab;
};

class LaunchDecision {
 public:
  bool Offer(LaunchOffer offer) {
    if (consumed_ || offer_ || offer.key.empty() || offer.url.empty() || offer.tab <= 0) return false;
    offer_ = std::move(offer);
    return true;
  }
  std::optional<int> Consume(std::string_view key, std::string_view url, std::string_view profile) {
    if (std::exchange(consumed_, true)) return std::nullopt;
    if (key.empty()) return 0;
    if (!offer_ || key != offer_->key || url != offer_->url || profile != offer_->profile) return std::nullopt;
    return offer_->tab;
  }

 private:
  bool consumed_ = false;
  std::optional<LaunchOffer> offer_;
};

enum class UnclaimedTabStep { kDrop, kWait, kPark, kReport };

inline constexpr int kUnclaimedTabBlankTries = 20;

inline UnclaimedTabStep NextUnclaimedTabStep(bool in_window, bool claimed, bool listening, bool blank, int tries) {
  if (!in_window || claimed) return UnclaimedTabStep::kDrop;
  if (blank && tries < kUnclaimedTabBlankTries) return UnclaimedTabStep::kWait;
  return listening ? UnclaimedTabStep::kReport : UnclaimedTabStep::kPark;
}

struct Route {
  std::string_view name;
  std::string_view service;
  std::string_view field;
};

inline constexpr Route kRoutes[] = {
    {"engine.components", "ac_components_list", "components"},
    {"engine.tasks", "ac_tasks_list", "tasks"},
    {"engine.batterySaver", "ac_battery_saver", ""},
    {"engine.trimMemory", "ac_memory_trim", ""},
    {"engine.openTaskManager", "ac_task_manager_open", ""},
    {"tabs.lastTabPolicy", "ac_tabs_last_tab_policy", ""},
    {"downloads.settings", "ac_downloads_settings", ""},
    {"downloads.setSettings", "ac_downloads_set_settings", ""},
    {"downloads.cancel", "ac_downloads_command", "null"},
    {"downloads.pause", "ac_downloads_command", "null"},
    {"downloads.resume", "ac_downloads_command", "null"},
    {"downloads.keep", "ac_downloads_command", "null"},
    {"history.query", "ac_history_query", ""},
    {"history.add", "ac_history_add", ""},
    {"history.import", "ac_history_import", ""},
    {"history.deleteUrls", "ac_history_delete_urls", ""},
    {"history.watch", "ac_history_watch", ""},
    {"bookmarks.tree", "ac_bookmarks_tree", ""},
    {"bookmarks.apply", "ac_bookmarks_apply", ""},
    {"bookmarks.watch", "ac_bookmarks_watch", ""},
    {"favicons.get", "ac_favicons_get", ""},
    {"favicons.set", "ac_favicons_set", ""},
    {"extensions.list", "ac_extensions_list", ""},
    {"extensions.install", "ac_extensions_install", ""},
    {"extensions.installCrx", "ac_extensions_install_crx", ""},
    {"extensions.setEnabled", "ac_extensions_set_enabled", ""},
    {"extensions.uninstall", "ac_extensions_uninstall", ""},
    {"extensions.reload", "ac_extensions_reload", ""},
    {"extensions.configure", "ac_extensions_configure", ""},
    {"extensions.watchActions", "ac_extensions_watch_actions", ""},
    {"extensions.syncState", "ac_extensions_sync_state", ""},
    {"extensions.syncApply", "ac_extensions_sync_apply", ""},
    {"search.engines", "ac_search_engines_list", ""},
};

inline bool OwnsClaim(std::string_view active, std::string_view supplied) {
  return !active.empty() && active == supplied;
}

inline bool CanReclaim(std::string_view active, std::string_view previous) {
  return active.empty() || OwnsClaim(active, previous);
}

inline bool CanTransfer(bool offered, bool temporary, bool same_profile) {
  return offered && !temporary && same_profile;
}

inline const Route* FindRoute(std::string_view name) {
  for (const auto& route : kRoutes) {
    if (route.name == name) return &route;
  }
  return nullptr;
}

inline std::string_view EventName(std::string_view topic) {
  for (const auto name : {"history.changed", "history.imported", "bookmarks.changed", "extensions.action", "extensions.sync", "downloads.changed", "downloads.removed"}) {
    if (topic == name) return name;
  }
  return {};
}

inline std::string_view ChangeAnnouncedAfter(std::string_view call, std::optional<int> applied) {
  if (call == "bookmarks.apply" && applied.value_or(0) > 0) return EventName("bookmarks.changed");
  if (call == "history.import") return EventName("history.imported");
  return {};
}

}

#endif
