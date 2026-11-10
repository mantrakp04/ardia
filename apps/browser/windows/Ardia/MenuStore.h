#pragma once

#include <algorithm>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "CommandTable.h"
#include "MenuKeys.h"
#include "NativeModules.h"
#include "Paths.h"

namespace Ardia::Menus {

struct MenuEntryValue {
  std::string id;
  std::string title;
  bool current = false;
};

struct MenuExtensionValue {
  std::string id;
  std::string title;
};

struct CommandEntry {
  std::string id;
  std::string command;
  std::optional<std::string> arg;
  std::string title;
  std::vector<std::string> path;
  unsigned flags = 0;
  bool listed = true;
  std::vector<std::pair<Combo, Combo>> pairs;
  std::vector<Combo> extras;
  std::vector<Combo> defaults;
  std::vector<Combo> active;

  bool Native() const noexcept {
    return (flags & RowNativeAction) != 0;
  }
};

inline std::string StringOf(winrt::Microsoft::ReactNative::JSValue const &value) noexcept {
  if (auto text = value.TryGetString()) return *text;
  return {};
}

inline bool BooleanOf(winrt::Microsoft::ReactNative::JSValue const &value, bool fallback) noexcept {
  if (auto flag = value.TryGetBoolean()) return *flag;
  return fallback;
}

inline int64_t IntegerOf(winrt::Microsoft::ReactNative::JSValue const &value, int64_t fallback) noexcept {
  if (auto number = value.TryGetInt64()) return *number;
  if (auto number = value.TryGetDouble()) return static_cast<int64_t>(*number);
  return fallback;
}

inline std::vector<std::string> StringsOf(winrt::Microsoft::ReactNative::JSValue const &value) noexcept {
  std::vector<std::string> strings;
  if (auto items = value.TryGetArray()) {
    for (auto const &item : *items) {
      if (auto text = item.TryGetString()) strings.push_back(*text);
    }
  }
  return strings;
}

inline std::vector<MenuEntryValue> EntriesOf(winrt::Microsoft::ReactNative::JSValue const &value) noexcept {
  std::vector<MenuEntryValue> entries;
  if (auto items = value.TryGetArray()) {
    for (auto const &item : *items) {
      if (!item.TryGetObject()) continue;
      entries.push_back({StringOf(item["id"]), StringOf(item["title"]), BooleanOf(item["current"], false)});
    }
  }
  return entries;
}

inline Combo StoredCombo(std::vector<std::string> const &stored) noexcept {
  if (stored.empty()) return {};
  std::wstring key = Paths::Wide(stored[0]);
  if (key.size() != 1) return {};
  Combo combo;
  wchar_t lower = key[0];
  CharLowerBuffW(&lower, 1);
  if (lower != key[0]) combo.modifiers |= ModifierShift;
  combo.key = lower;
  for (size_t i = 1; i < stored.size(); i++) {
    if (auto modifier = ModifierNamed(stored[i])) combo.modifiers |= *modifier;
  }
  return combo;
}

inline std::vector<std::string> PathOf(std::string_view path) noexcept {
  std::vector<std::string> parts;
  for (std::string_view part : SplitOn(path, " > ")) parts.emplace_back(part);
  return parts;
}

struct MenuStore {
  std::set<std::string, std::less<>> checked;
  std::set<std::string, std::less<>> disabled;
  std::map<std::string, std::string, std::less<>> titles;
  std::vector<MenuEntryValue> profiles;
  std::vector<MenuEntryValue> windows;
  std::vector<MenuEntryValue> recentlyClosed;
  std::vector<MenuEntryValue> recentlyClosedGroups;
  std::vector<MenuExtensionValue> extensions;
  std::map<std::string, std::vector<std::vector<std::string>>, std::less<>> shortcuts;
  winrt::Microsoft::ReactNative::JSValue bookmarks{winrt::Microsoft::ReactNative::JSValueObject{}};
  int bookmarksRevision = 0;
  bool warnBeforeQuitting = false;
  bool warnBeforeClosingWindow = false;
  bool undoReopensClosedTab = false;
  bool bookmarksShown = true;
  int64_t downloadsInProgress = 0;
  bool fromApp = false;
  std::vector<CommandEntry> entries;

  static MenuStore &Shared() noexcept {
    static MenuStore *shared = new MenuStore();
    return *shared;
  }

  MenuStore() noexcept {
    Rebuild();
  }

  void Update(winrt::Microsoft::ReactNative::JSValue const &state) noexcept {
    auto checkedList = StringsOf(state["checked"]);
    checked = std::set<std::string, std::less<>>(checkedList.begin(), checkedList.end());
    auto disabledList = StringsOf(state["disabled"]);
    disabled = std::set<std::string, std::less<>>(disabledList.begin(), disabledList.end());
    titles.clear();
    if (auto object = state["titles"].TryGetObject()) {
      for (auto const &[key, value] : *object) {
        if (auto text = value.TryGetString()) titles[key] = *text;
      }
    }
    profiles = EntriesOf(state["profiles"]);
    windows = EntriesOf(state["windows"]);
    recentlyClosed = EntriesOf(state["recentlyClosed"]);
    recentlyClosedGroups = EntriesOf(state["recentlyClosedGroups"]);
    warnBeforeQuitting = BooleanOf(state["warnBeforeQuitting"], false);
    warnBeforeClosingWindow = BooleanOf(state["warnBeforeClosingWindow"], false);
    undoReopensClosedTab = BooleanOf(state["undoReopensClosedTab"], false);
    bookmarksShown = BooleanOf(state["bookmarksShown"], true);
    downloadsInProgress = IntegerOf(state["downloadsInProgress"], 0);
    extensions.clear();
    if (auto items = state["extensions"].TryGetArray()) {
      for (auto const &item : *items) {
        if (!item.TryGetObject()) continue;
        extensions.push_back({StringOf(item["id"]), StringOf(item["title"])});
      }
    }
    shortcuts.clear();
    if (auto object = state["shortcuts"].TryGetObject()) {
      for (auto const &[id, list] : *object) {
        std::vector<std::vector<std::string>> bound;
        if (auto combos = list.TryGetArray()) {
          for (auto const &combo : *combos) bound.push_back(StringsOf(combo));
        }
        shortcuts[id] = std::move(bound);
      }
    }
    fromApp = true;
    Rebuild();
  }

  void UpdateBookmarks(winrt::Microsoft::ReactNative::JSValue const &lists) noexcept {
    bookmarks = lists.Copy();
    bookmarksRevision++;
  }

  bool Disabled(std::string_view key) const noexcept {
    return disabled.find(key) != disabled.end();
  }

  bool EntryEnabled(CommandEntry const &entry) const noexcept {
    return !Disabled(entry.id) && !Disabled(entry.command);
  }

  bool EntryHidden(CommandEntry const &entry) const noexcept {
    if (entry.flags & RowHidden) return true;
    if ((entry.flags & RowHiddenWithBookmarks) && !bookmarksShown) return true;
    if ((entry.flags & RowHiddenWhenDisabled) && !EntryEnabled(entry)) return true;
    return false;
  }

  bool EntryReachable(CommandEntry const &entry) const noexcept {
    if ((entry.flags & (RowHiddenWithBookmarks | RowInBookmarksMenu)) && !bookmarksShown) return false;
    return true;
  }

  void Rebuild() noexcept {
    std::vector<CommandEntry> built;
    for (CommandRow const &row : kCommandRows) {
#if !_DEBUG
      if (row.flags & RowDebugOnly) continue;
#endif
      switch (row.expansion) {
        case Expansion::None: {
          built.push_back(EntryFromRow(row));
          break;
        }
        case Expansion::LittleArdiaProfiles: {
          for (auto const &profile : profiles) {
            built.push_back(DynamicEntry("newLittleArdia", profile.id, profile.title, row.path, {}, {}, true));
          }
          break;
        }
        case Expansion::SwitchProfiles: {
          for (size_t i = 0; i < profiles.size(); i++) {
            auto const &profile = profiles[i];
            std::vector<std::pair<Combo, Combo>> primary;
            std::vector<std::pair<Combo, Combo>> alternate;
            if (i < static_cast<size_t>(kProfileShortcutCount)) {
              wchar_t digit = static_cast<wchar_t>(L'1' + i);
              primary.push_back({Combo{digit, ModifierControl}, Combo{digit, ModifierOption}});
              alternate.push_back({Combo{digit, static_cast<unsigned>(ModifierControl | ModifierCommand)}, Combo{digit, static_cast<unsigned>(ModifierControl | ModifierOption)}});
            }
            std::vector<Combo> defaults;
            for (auto const &pair : primary) defaults.push_back(pair.second);
            built.push_back(DynamicEntry("switchProfile", profile.id, profile.title, row.path, primary, defaults, true));
            built.push_back(DynamicEntry("newWindow", profile.id, profile.title + " \xE2\x86\x97", row.path, alternate, {}, false));
          }
          break;
        }
        case Expansion::Extensions: {
          for (auto const &extension : extensions) {
            built.push_back(DynamicEntry("openExtension", extension.id, extension.title, row.path, {}, {}, true));
          }
          break;
        }
      }
    }
    entries = std::move(built);
    ApplyShortcuts();
  }

  void ApplyShortcuts() noexcept {
    for (auto &entry : entries) {
      auto found = shortcuts.find(entry.id);
      if (found == shortcuts.end()) {
        entry.active = entry.defaults;
        continue;
      }
      std::vector<Combo> active;
      bool onlyDefaults = !found->second.empty();
      for (auto const &stored : found->second) {
        Combo combo = StoredCombo(stored);
        if (combo.Empty()) {
          onlyDefaults = false;
          continue;
        }
        auto pair = std::find_if(entry.pairs.begin(), entry.pairs.end(), [&](auto const &candidate) { return candidate.first == combo; });
        if (pair != entry.pairs.end()) {
          if (!pair->second.Empty()) active.push_back(pair->second);
          continue;
        }
        onlyDefaults = false;
        Combo literal = WindowsComboFromStored(combo);
        if (!literal.Empty()) active.push_back(literal);
      }
      if (onlyDefaults) active.insert(active.end(), entry.extras.begin(), entry.extras.end());
      std::vector<Combo> unique;
      for (Combo const &combo : active) {
        if (std::find(unique.begin(), unique.end(), combo) == unique.end()) unique.push_back(combo);
      }
      entry.active = std::move(unique);
    }
  }

  std::optional<Combo> WindowsComboForMenu(Combo stored) const noexcept {
    for (auto const &entry : entries) {
      for (auto const &[macCombo, windowsCombo] : entry.pairs) {
        if (macCombo == stored) return windowsCombo;
      }
    }
    return std::nullopt;
  }

  CommandEntry const *Match(KeyPress const &press) const noexcept {
    for (auto const &entry : entries) {
      if (!EntryReachable(entry)) continue;
      for (Combo const &combo : entry.active) {
        if (Matches(combo, press)) return &entry;
      }
    }
    return nullptr;
  }

  CommandEntry const *Find(std::string_view id) const noexcept {
    for (auto const &entry : entries) {
      if (entry.id == id) return &entry;
    }
    return nullptr;
  }

  winrt::Microsoft::ReactNative::JSValue ActiveBindings() const noexcept {
    using winrt::Microsoft::ReactNative::JSValue;
    using winrt::Microsoft::ReactNative::JSValueArray;
    using winrt::Microsoft::ReactNative::JSValueObject;
    JSValueObject bindings;
    for (auto const &entry : entries) {
      if (bindings.find(entry.id) != bindings.end()) continue;
      JSValueArray combos;
      for (Combo const &combo : entry.active) {
        JSValueArray stored;
        stored.push_back(JSValue{Paths::Utf8(std::wstring(1, combo.key))});
        for (unsigned modifier : kModifierOrder) {
          if (combo.modifiers & modifier) stored.push_back(JSValue{std::string{ModifierNameOf(modifier)}});
        }
        combos.push_back(JSValue{std::move(stored)});
      }
      bindings[entry.id] = JSValue{std::move(combos)};
    }
    return JSValue{std::move(bindings)};
  }

  winrt::Microsoft::ReactNative::JSValue ShortcutList() const noexcept {
    using winrt::Microsoft::ReactNative::JSValue;
    using winrt::Microsoft::ReactNative::JSValueArray;
    using winrt::Microsoft::ReactNative::JSValueObject;
    std::vector<std::string> order;
    std::map<std::string, CommandEntry const *, std::less<>> primaries;
    for (auto const &entry : entries) {
      if (!entry.listed || entry.title.empty()) continue;
      auto found = primaries.find(entry.id);
      if (found == primaries.end()) {
        order.push_back(entry.id);
        primaries[entry.id] = &entry;
      } else if (EntryHidden(*found->second) && !EntryHidden(entry)) {
        found->second = &entry;
      }
    }
    JSValueArray list;
    for (auto const &id : order) {
      CommandEntry const &entry = *primaries[id];
      JSValueArray path;
      for (auto const &part : entry.path) path.push_back(JSValue{std::string{part}});
      list.push_back(JSValueObject{{"id", id}, {"title", entry.title}, {"path", std::move(path)}, {"remappable", true}});
    }
    for (SystemRow const &row : kSystemRows) {
      Combo combo = ParseCombo(row.windows);
      if (combo.Empty()) continue;
      JSValueArray path;
      for (auto const &part : PathOf(row.path)) path.push_back(JSValue{std::string{part}});
      JSValueArray modifiers;
      for (unsigned modifier : kModifierOrder) {
        if (combo.modifiers & modifier) modifiers.push_back(JSValue{std::string{ModifierNameOf(modifier)}});
      }
      std::string id = "system:" + std::string{row.path} + " > " + std::string{row.title};
      list.push_back(JSValueObject{
          {"id", id},
          {"title", std::string{row.title}},
          {"path", std::move(path)},
          {"remappable", false},
          {"key", Paths::Utf8(std::wstring(1, combo.key))},
          {"modifiers", std::move(modifiers)},
      });
    }
    return JSValue{std::move(list)};
  }

 private:
  static CommandEntry EntryFromRow(CommandRow const &row) noexcept {
    CommandEntry entry;
    entry.id = std::string{row.id};
    size_t colon = row.id.find(':');
    bool standard = row.id.starts_with("std:");
    if (!standard && colon != std::string_view::npos) {
      entry.command = std::string{row.id.substr(0, colon)};
      entry.arg = std::string{row.id.substr(colon + 1)};
    } else {
      entry.command = entry.id;
    }
    entry.title = std::string{row.title};
    entry.path = PathOf(row.path);
    entry.flags = row.flags;
    std::vector<Combo> macCombos = ParseCombos(row.mac);
    std::vector<Combo> windowsCombos = ParseCombos(row.windows);
    for (size_t i = 0; i < macCombos.size(); i++) entry.pairs.push_back({macCombos[i], i < windowsCombos.size() ? windowsCombos[i] : Combo{}});
    for (size_t i = macCombos.size(); i < windowsCombos.size(); i++) {
      if (!windowsCombos[i].Empty()) entry.extras.push_back(windowsCombos[i]);
    }
    for (Combo const &combo : windowsCombos) {
      if (!combo.Empty()) entry.defaults.push_back(combo);
    }
    return entry;
  }

  static CommandEntry DynamicEntry(std::string_view command, std::string const &arg, std::string const &title, std::string_view path,
                                   std::vector<std::pair<Combo, Combo>> pairs, std::vector<Combo> defaults, bool listed) noexcept {
    CommandEntry entry;
    entry.command = std::string{command};
    entry.arg = arg;
    entry.id = entry.command + ":" + arg;
    entry.title = title;
    entry.path = PathOf(path);
    entry.listed = listed;
    entry.pairs = std::move(pairs);
    entry.defaults = std::move(defaults);
    return entry;
  }
};

}
