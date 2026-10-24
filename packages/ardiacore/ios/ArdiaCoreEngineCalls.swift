extension CefModule {
  static let engineCalls: Set<String> = [
    "ac_history_query", "ac_history_add", "ac_history_import", "ac_history_delete_urls", "ac_history_watch",
    "ac_favicons_get", "ac_favicons_set",
    "ac_bookmarks_tree", "ac_bookmarks_apply", "ac_bookmarks_watch",
    "ac_omnibox_opened",
    "ac_tabs_last_tab_policy",
    "ac_task_manager_open", "ac_battery_saver", "ac_memory_trim",
    "ac_cli_control",
    "ac_extensions_watch_actions", "ac_extensions_sync_state", "ac_extensions_sync_apply",
    "ac_downloads_settings", "ac_downloads_set_settings",
  ]
}
