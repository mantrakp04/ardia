#pragma once

#include <cstdint>
#include <cstdio>
#include <deque>
#include <filesystem>
#include <fstream>
#include <optional>
#include <set>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "LaunchLog.h"
#include "MenuKeys.h"
#include "MenuStore.h"
#include "NativeModules.h"
#include "LaunchConfig.h"
#include "Paths.h"

namespace Ardia::Menus {

struct PopupItem {
  bool separator = false;
  std::string id;
  std::string title;
  std::optional<std::string> symbol;
  std::optional<std::string> swatch;
  std::optional<std::string> swatchDark;
  std::string key;
  std::vector<std::string> modifiers;
  bool enabled = true;
  bool checked = false;
  bool alternate = false;
  bool share = false;
  std::optional<std::vector<PopupItem>> children;
};

inline std::optional<std::string> OptionalStringOf(winrt::Microsoft::ReactNative::JSValue const &value) noexcept {
  if (auto text = value.TryGetString()) return *text;
  return std::nullopt;
}

inline std::vector<PopupItem> PopupItemsOf(winrt::Microsoft::ReactNative::JSValue const &value, int depth = 0) noexcept {
  std::vector<PopupItem> items;
  auto list = value.TryGetArray();
  if (!list || depth > 16) return items;
  for (auto const &raw : *list) {
    if (!raw.TryGetObject()) continue;
    PopupItem item;
    item.separator = BooleanOf(raw["separator"], false);
    item.id = StringOf(raw["id"]);
    item.title = StringOf(raw["title"]);
    item.symbol = OptionalStringOf(raw["symbol"]);
    item.swatch = OptionalStringOf(raw["swatch"]);
    item.swatchDark = OptionalStringOf(raw["swatchDark"]);
    item.key = StringOf(raw["key"]);
    item.modifiers = StringsOf(raw["modifiers"]);
    item.enabled = BooleanOf(raw["enabled"], true);
    item.checked = BooleanOf(raw["checked"], false);
    item.alternate = BooleanOf(raw["alternate"], false);
    item.share = BooleanOf(raw["share"], false);
    if (raw["children"].TryGetArray()) item.children = PopupItemsOf(raw["children"], depth + 1);
    items.push_back(std::move(item));
  }
  return items;
}

inline std::string ShareChoice(std::string const &id) {
  return id + ":via:system";
}

inline void EnabledIds(std::vector<PopupItem> const &items, std::set<std::string> &ids) noexcept {
  for (auto const &item : items) {
    if (!item.enabled || item.separator) continue;
    if (item.children) {
      EnabledIds(*item.children, ids);
    } else {
      ids.insert(item.id);
    }
  }
}

inline std::string JsonQuoted(std::string_view text) {
  std::string quoted = "\"";
  for (unsigned char c : text) {
    switch (c) {
      case '"': quoted += "\\\""; break;
      case '\\': quoted += "\\\\"; break;
      case '\n': quoted += "\\n"; break;
      case '\r': quoted += "\\r"; break;
      case '\t': quoted += "\\t"; break;
      default:
        if (c < 0x20) {
          char escaped[8];
          snprintf(escaped, sizeof(escaped), "\\u%04x", static_cast<unsigned>(c));
          quoted += escaped;
        } else {
          quoted += static_cast<char>(c);
        }
    }
  }
  return quoted + "\"";
}

inline void WriteItemsJson(std::vector<PopupItem> const &items, std::string &out, int indent) {
  std::string pad(static_cast<size_t>(indent) * 2, ' ');
  std::string inner(static_cast<size_t>(indent + 1) * 2, ' ');
  std::string field(static_cast<size_t>(indent + 2) * 2, ' ');
  if (items.empty()) {
    out += "[]";
    return;
  }
  out += "[\n";
  for (size_t i = 0; i < items.size(); i++) {
    PopupItem const &item = items[i];
    std::vector<std::pair<std::string, std::string>> fields;
    auto boolean = [](bool flag) { return std::string{flag ? "true" : "false"}; };
    fields.push_back({"alternate", boolean(item.alternate)});
    fields.push_back({"checked", boolean(item.checked)});
    if (item.children) {
      std::string children;
      WriteItemsJson(*item.children, children, indent + 2);
      fields.push_back({"children", children});
    }
    fields.push_back({"enabled", boolean(item.enabled)});
    fields.push_back({"id", JsonQuoted(item.id)});
    fields.push_back({"key", JsonQuoted(item.key)});
    std::string modifiers = "[";
    for (size_t m = 0; m < item.modifiers.size(); m++) modifiers += (m ? ", " : "") + JsonQuoted(item.modifiers[m]);
    fields.push_back({"modifiers", modifiers + "]"});
    fields.push_back({"separator", boolean(item.separator)});
    fields.push_back({"share", boolean(item.share)});
    if (item.swatch) fields.push_back({"swatch", JsonQuoted(*item.swatch)});
    if (item.swatchDark) fields.push_back({"swatchDark", JsonQuoted(*item.swatchDark)});
    if (item.symbol) fields.push_back({"symbol", JsonQuoted(*item.symbol)});
    fields.push_back({"title", JsonQuoted(item.title)});
    out += inner + "{\n";
    for (size_t f = 0; f < fields.size(); f++) {
      out += field + JsonQuoted(fields[f].first) + " : " + fields[f].second + (f + 1 < fields.size() ? ",\n" : "\n");
    }
    out += inner + "}" + (i + 1 < items.size() ? ",\n" : "\n");
  }
  out += pad + "]";
}

inline bool TestFlag(std::wstring_view flag) noexcept {
  return AppLaunch::TestFlag(Paths::Utf8(flag));
}

inline std::optional<std::string> TestPick(std::vector<PopupItem> const &items) noexcept {
  try {
    std::filesystem::path file = Paths::DataDirectory() / L"menu.json";
    std::string json;
    WriteItemsJson(items, json, 0);
    {
      std::ofstream out(file, std::ios::binary | std::ios::trunc);
      out << json;
    }
    std::filesystem::path pickFile = file;
    pickFile += L".pick";
    std::string pick;
    {
      std::ifstream in(pickFile, std::ios::binary);
      if (in) {
        std::stringstream buffer;
        buffer << in.rdbuf();
        pick = buffer.str();
      }
    }
    std::error_code ignored;
    std::filesystem::remove(pickFile, ignored);
    size_t first = pick.find_first_not_of(" \t\r\n");
    size_t last = pick.find_last_not_of(" \t\r\n");
    if (first == std::string::npos) return std::nullopt;
    pick = pick.substr(first, last - first + 1);
    std::set<std::string> enabled;
    EnabledIds(items, enabled);
    if (enabled.find(pick) == enabled.end()) return std::nullopt;
    return pick;
  } catch (...) {
    return std::nullopt;
  }
}

inline std::deque<std::string> &RecentMenuLog() noexcept {
  static std::deque<std::string> *lines = new std::deque<std::string>();
  return *lines;
}

inline void MenuLog(std::string const &line) noexcept {
  try {
    LaunchLog::Write(L"menu", Paths::Wide(line));
    std::deque<std::string> &lines = RecentMenuLog();
    lines.push_back(line);
    while (lines.size() > 40) lines.pop_front();
  } catch (...) {
  }
}

inline size_t VisibleItemCount(std::vector<PopupItem> const &items) noexcept {
  size_t count = 0;
  for (auto const &item : items) {
    if (!item.separator) count++;
  }
  return count;
}

inline std::string LogTimestamp() noexcept {
  SYSTEMTIME now{};
  GetSystemTime(&now);
  char text[40];
  snprintf(text, sizeof(text), "%04u-%02u-%02u %02u:%02u:%02u +0000", static_cast<unsigned>(now.wYear), static_cast<unsigned>(now.wMonth), static_cast<unsigned>(now.wDay),
           static_cast<unsigned>(now.wHour), static_cast<unsigned>(now.wMinute), static_cast<unsigned>(now.wSecond));
  return text;
}

inline void LogActivation(std::string const &line) noexcept {
  LaunchLog::Write(L"info", Paths::Wide(line));
  try {
    std::filesystem::path file = Paths::DataDirectory() / L"activation.log";
    std::ofstream out(file, std::ios::binary | std::ios::app);
    out << LogTimestamp() << " " << line << "\n";
  } catch (...) {
  }
}

inline std::string JoinedTitles(std::vector<PopupItem> const &items, bool describe) {
  std::string joined;
  for (auto const &item : items) {
    if (item.separator || item.title.empty()) continue;
    if (!joined.empty()) joined += " | ";
    joined += item.title;
    if (describe && item.checked) joined += " \xE2\x9C\x93";
  }
  return joined;
}

inline void ReportItems(std::vector<PopupItem> const &items, std::string const &path) noexcept {
  try {
    LogActivation("menu items: " + path + ": " + JoinedTitles(items, true));
    for (auto const &item : items) {
      if (!item.separator && item.children && !item.children->empty()) ReportItems(*item.children, path + " \xE2\x80\xBA " + item.title);
    }
  } catch (...) {
  }
}

inline void ReportUnshownMenu(std::vector<PopupItem> const &items) noexcept {
  try {
    MenuLog("pop-up menu not shown in a background instance: " + JoinedTitles(items, false));
    LogActivation("pop-up menu (not shown): " + JoinedTitles(items, false));
    ReportItems(items, "pop-up menu");
  } catch (...) {
  }
}

inline std::wstring ShortcutLabelOf(PopupItem const &item) noexcept {
  if (item.key.empty()) return {};
  std::vector<std::string> stored{item.key};
  stored.insert(stored.end(), item.modifiers.begin(), item.modifiers.end());
  Combo combo = StoredCombo(stored);
  if (combo.Empty()) return {};
  std::optional<Combo> windows = MenuStore::Shared().WindowsComboForMenu(combo);
  return ComboLabel(windows ? *windows : WindowsComboFromStored(combo));
}

inline std::wstring MenuLabelOf(PopupItem const &item) noexcept {
  std::wstring title = Paths::Wide(item.title);
  std::wstring label;
  for (wchar_t c : title) {
    if (c == L'&') label += L'&';
    label += c;
  }
  std::wstring shortcut = ShortcutLabelOf(item);
  if (!shortcut.empty()) label += L"\t" + shortcut;
  return label;
}

inline HMENU BuildPopup(std::vector<PopupItem> const &items, std::vector<std::string> &choices) noexcept {
  HMENU menu = CreatePopupMenu();
  if (!menu) return nullptr;
  for (auto const &item : items) {
    if (item.separator) {
      AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
      continue;
    }
    if (item.alternate) continue;
    UINT state = (item.enabled ? MF_ENABLED : MF_GRAYED) | (item.checked ? MF_CHECKED : MF_UNCHECKED);
    std::wstring label = MenuLabelOf(item);
    if (item.children) {
      HMENU submenu = BuildPopup(*item.children, choices);
      if (!submenu) continue;
      AppendMenuW(menu, MF_STRING | MF_POPUP | state, reinterpret_cast<UINT_PTR>(submenu), label.c_str());
      continue;
    }
    choices.push_back(item.share ? ShareChoice(item.id) : item.id);
    AppendMenuW(menu, MF_STRING | state, static_cast<UINT_PTR>(choices.size()), label.c_str());
  }
  return menu;
}

inline std::string HandleText(HWND hwnd) {
  char text[32];
  snprintf(text, sizeof(text), "0x%llx", static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(hwnd)));
  return text;
}

inline std::optional<std::string> TrackPopup(std::vector<PopupItem> const &items, HWND owner) noexcept {
  try {
    if (!owner || !IsWindow(owner)) {
      MenuLog("pop-up menu not shown: no Ardia window to own it");
      return std::nullopt;
    }
    std::vector<std::string> choices;
    HMENU menu = BuildPopup(items, choices);
    if (!menu) {
      MenuLog("pop-up menu not shown: CreatePopupMenu failed with error " + std::to_string(GetLastError()));
      return std::nullopt;
    }
    POINT point{};
    GetCursorPos(&point);
    bool rightButtonDown = (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0;
    bool wasForeground = GetForegroundWindow() == owner;
    BOOL madeForeground = SetForegroundWindow(owner);
    MenuLog("pop-up menu shown at " + std::to_string(point.x) + "," + std::to_string(point.y) + " with " + std::to_string(choices.size()) +
            " choices, owner " + HandleText(owner) + (wasForeground ? " (foreground)" : madeForeground ? " (brought to the foreground)" : " (not foreground)") +
            (rightButtonDown ? ", right button still down" : ""));
    UINT align = GetSystemMetrics(SM_MENUDROPALIGNMENT) ? TPM_RIGHTALIGN : TPM_LEFTALIGN;
    UINT flags = TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_NONOTIFY | TPM_TOPALIGN | align;
    SetLastError(0);
    BOOL chosen = TrackPopupMenuEx(menu, flags, point.x, point.y, owner, nullptr);
    DWORD error = GetLastError();
    PostMessageW(owner, WM_NULL, 0, 0);
    DestroyMenu(menu);
    if (chosen <= 0 || static_cast<size_t>(chosen) > choices.size()) {
      MenuLog(error ? "pop-up menu failed with error " + std::to_string(error) : std::string{"pop-up menu dismissed"});
      return std::nullopt;
    }
    std::string choice = choices[static_cast<size_t>(chosen) - 1];
    MenuLog("pop-up menu chose " + choice);
    return choice;
  } catch (...) {
    return std::nullopt;
  }
}

}
