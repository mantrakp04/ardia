#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace Ardia::Menus {

enum Modifier : unsigned {
  ModifierControl = 1,
  ModifierOption = 2,
  ModifierShift = 4,
  ModifierCommand = 8,
  ModifierFunction = 16,
};

struct Combo {
  wchar_t key = 0;
  unsigned modifiers = 0;

  bool operator==(Combo const &) const = default;
  bool Empty() const noexcept {
    return key == 0;
  }
};

enum RowFlag : unsigned {
  RowHidden = 1,
  RowHiddenWithBookmarks = 2,
  RowInBookmarksMenu = 4,
  RowHiddenWhenDisabled = 8,
  RowNativeAction = 16,
  RowDebugOnly = 32,
};

enum class Expansion {
  None,
  LittleArdiaProfiles,
  SwitchProfiles,
  Extensions,
};

struct CommandRow {
  std::string_view id;
  std::string_view title;
  std::string_view path;
  std::string_view mac;
  std::string_view windows;
  unsigned flags = 0;
  Expansion expansion = Expansion::None;
};

struct SystemRow {
  std::string_view title;
  std::string_view path;
  std::string_view windows;
};

#define ARDIA_ELLIPSIS "\xE2\x80\xA6"

inline constexpr CommandRow kCommandRows[] = {
    {"openSettings", "Settings" ARDIA_ELLIPSIS, "Ardia", "cmd+,", "ctrl+,"},
    {"importBrowserData", "Import from Another Browser" ARDIA_ELLIPSIS, "Ardia", "", ""},

    {"newTab", "New Tab", "File", "cmd+t", "ctrl+t"},
    {"newTabInGroup", "New Tab in Group", "File", "option+cmd+t|ctrl+cmd+c", "ctrl+alt+t|none"},
    {"newWindow", "New Window", "File", "cmd+n", "ctrl+n"},
    {"newIncognitoWindow", "New Incognito Window", "File", "shift+cmd+n", "ctrl+shift+n"},
    {"newLittleArdia", "New Little Ardia Window", "File", "option+cmd+n", "ctrl+alt+n"},
    {"", "", "File > New Little Ardia Window in Profile", "", "", 0, Expansion::LittleArdiaProfiles},
    {"toggleOpenLinksInLittleArdia", "Open Links from Other Apps in Main Window", "File", "", ""},
    {"reopenClosedTab", "Reopen Closed Tab", "File", "shift+cmd+t", "ctrl+shift+t"},
    {"reopenClosedWindow", "Reopen Closed Window", "File", "", ""},
    {"openFile", "Open File" ARDIA_ELLIPSIS, "File", "cmd+o", "ctrl+o"},
    {"focusCommandBar", "Open Command Bar", "File", "cmd+l|ctrl+f5", "ctrl+l|none|alt+d"},
    {"std:closeWindow:", "Close Window", "File", "shift+cmd+w", "ctrl+shift+w", RowNativeAction},
    {"closeTab", "Close Tab", "File", "cmd+w", "ctrl+w|ctrl+f4"},
    {"closeAllTabs", "Close All Tabs", "File", "shift+cmd+k", "ctrl+shift+k"},
    {"cleanUpTabs", "Clean Up Tabs", "File", "option+cmd+k", "ctrl+alt+k"},
    {"savePage", "Save Page As" ARDIA_ELLIPSIS, "File", "", ""},
    {"share", "Share" ARDIA_ELLIPSIS, "File > Share", "option+cmd+s", "ctrl+alt+s"},
    {"emailPageLocation", "Email Page Location", "File", "shift+cmd+i", "none"},
    {"print", "Print" ARDIA_ELLIPSIS, "File", "cmd+p", "ctrl+p"},
    {"printWithSystemDialog", "Print Using System Dialog" ARDIA_ELLIPSIS, "File", "option+cmd+p", "ctrl+shift+p"},

    {"copyUrl", "Copy URL", "Edit", "shift+cmd+c", "ctrl+shift+c"},
    {"copyUrlAsMarkdown", "Copy URL as Markdown", "Edit", "option+shift+cmd+c", "ctrl+alt+shift+c"},
    {"findInPage", "Find" ARDIA_ELLIPSIS, "Edit > Find", "cmd+f", "ctrl+f"},
    {"findAndReplace", "Find and Replace" ARDIA_ELLIPSIS, "Edit > Find", "option+cmd+f", "ctrl+shift+h"},
    {"findNext", "Find Next", "Edit > Find", "cmd+g", "ctrl+g|f3"},
    {"findPrevious", "Find Previous", "Edit > Find", "shift+cmd+g", "ctrl+shift+g|shift+f3"},
    {"useSelectionForFind", "Use Selection for Find", "Edit > Find", "cmd+e", "ctrl+e"},
    {"jumpToSelection", "Jump to Selection", "Edit > Find", "cmd+j", "none"},
    {"autofill:contact", "Contact" ARDIA_ELLIPSIS, "Edit > AutoFill", "", ""},
    {"autofill:passwords", "Passwords" ARDIA_ELLIPSIS, "Edit > AutoFill", "", ""},
    {"autofill:creditCard", "Credit Card" ARDIA_ELLIPSIS, "Edit > AutoFill", "", ""},

    {"setAppearance:auto", "Automatic", "View > Appearance", "", ""},
    {"setAppearance:light", "Light", "View > Appearance", "", ""},
    {"setAppearance:dark", "Dark", "View > Appearance", "", ""},
    {"stop", "Stop", "View", "cmd+.", "ctrl+."},
    {"reload", "Refresh", "View", "cmd+r", "ctrl+r|f5"},
    {"forceReload", "Force Refresh the Page", "View", "shift+cmd+r", "ctrl+shift+r|ctrl+f5|shift+f5"},
    {"toggleTabLayout", "Show Tabs in Sidebar", "View", "shift+cmd+s", "ctrl+shift+s"},
    {"toggleSidebar", "Auto-Hide Tabs", "View", "cmd+s|shift+cmd+l|shift+cmd+f", "ctrl+s|ctrl+shift+l|ctrl+shift+f"},
    {"toggleSidebarSide", "Sidebar on Right", "View", "", ""},
    {"openSplitPane", "Open Split Pane", "View", "ctrl+shift+=|ctrl+plus", "ctrl+\\|none"},
    {"focusNextPane", "Focus Next Split Pane", "View", "ctrl+shift+]|ctrl+}", "alt+shift+]|none"},
    {"focusPreviousPane", "Focus Previous Split Pane", "View", "ctrl+shift+[|ctrl+{", "alt+shift+[|none"},
    {"setBookmarksBar:always", "Always", "View > Show Bookmarks Bar", "", "", RowInBookmarksMenu},
    {"setBookmarksBar:newTab", "On New Tab Only", "View > Show Bookmarks Bar", "", "", RowInBookmarksMenu},
    {"setBookmarksBar:never", "Never", "View > Show Bookmarks Bar", "", "", RowInBookmarksMenu},
    {"toggleBookmarksBar", "Toggle Bookmarks Bar", "View > Show Bookmarks Bar", "shift+cmd+b", "ctrl+shift+b", RowInBookmarksMenu},
    {"toggleFullUrl", "Show Full URL", "View", "", ""},
    {"toggleAddressBar", "Show Address Bar in Sidebar", "View", "", ""},
    {"cast", "Cast" ARDIA_ELLIPSIS, "View", "", ""},
    {"zoomReset", "Zoom to Actual Size", "View", "cmd+0", "ctrl+0"},
    {"zoomIn", "Zoom In", "View", "cmd+plus|cmd+=", "ctrl+plus|ctrl+="},
    {"zoomOut", "Zoom Out", "View", "cmd+-", "ctrl+-"},
    {"std:toggleFullScreen:", "Enter Full Screen", "View", "fn+f|ctrl+cmd+f", "none|none|f11", RowNativeAction},
    {"viewSource", "View Source", "View > Developer", "option+cmd+u", "ctrl+u"},
    {"devTools", "Developer Tools", "View > Developer", "option+cmd+i", "ctrl+shift+i"},
    {"inspectElements", "Inspect Elements", "View > Developer", "option+cmd+c", "ctrl+alt+c"},
    {"javaScriptConsole", "JavaScript Console", "View > Developer", "option+cmd+j", "ctrl+shift+j"},
    {"toggleDevTools", "Toggle Developer Tools", "View > Developer", "f12", "f12", RowHidden},
    {"caretBrowsing", "Caret Browsing", "View > Developer", "f7", "f7", RowHidden},

    {"back", "Go Back", "Tabs", "cmd+[|cmd+left", "ctrl+[|alt+left"},
    {"forward", "Go Forward", "Tabs", "cmd+]|cmd+right", "ctrl+]|alt+right"},
    {"nextTab", "Next Tab", "Tabs", "shift+cmd+]|cmd+}|ctrl+pagedown|option+cmd+down", "ctrl+shift+]|ctrl+}|ctrl+pagedown|none"},
    {"previousTab", "Previous Tab", "Tabs", "shift+cmd+[|cmd+{|ctrl+pageup|option+cmd+up", "ctrl+shift+[|ctrl+{|ctrl+pageup|none"},
    {"moveTabDown", "Move Tab Down", "Tabs", "ctrl+shift+pagedown", "ctrl+shift+pagedown", RowHidden},
    {"moveTabUp", "Move Tab Up", "Tabs", "ctrl+shift+pageup", "ctrl+shift+pageup", RowHidden},
    {"searchTabs", "Search Tabs" ARDIA_ELLIPSIS, "Tabs", "shift+cmd+a", "ctrl+shift+a"},
    {"tabSwitcher:forward", "Tab Switcher (forward)", "Tabs", "ctrl+tab", "ctrl+tab", RowHidden},
    {"tabSwitcher:backward", "Tab Switcher (backward)", "Tabs", "ctrl+shift+tab", "ctrl+shift+tab", RowHidden},
    {"returnToPinnedUrl", "Back to Pinned URL", "Tabs", "cmd+enter", "alt+home", RowHidden},
    {"selectTab:1", "Select Tab 1", "Tabs", "cmd+1", "ctrl+1", RowHidden},
    {"selectTab:2", "Select Tab 2", "Tabs", "cmd+2", "ctrl+2", RowHidden},
    {"selectTab:3", "Select Tab 3", "Tabs", "cmd+3", "ctrl+3", RowHidden},
    {"selectTab:4", "Select Tab 4", "Tabs", "cmd+4", "ctrl+4", RowHidden},
    {"selectTab:5", "Select Tab 5", "Tabs", "cmd+5", "ctrl+5", RowHidden},
    {"selectTab:6", "Select Tab 6", "Tabs", "cmd+6", "ctrl+6", RowHidden},
    {"selectTab:7", "Select Tab 7", "Tabs", "cmd+7", "ctrl+7", RowHidden},
    {"selectTab:8", "Select Tab 8", "Tabs", "cmd+8", "ctrl+8", RowHidden},
    {"selectLastTab", "Select Last Tab", "Tabs", "cmd+9", "ctrl+9", RowHidden},
    {"togglePin", "Move to Top Apps", "Tabs", "", ""},
    {"togglePin:tile", "Move Pinned Tab to Top Apps", "Tabs", "", "", RowHiddenWhenDisabled},
    {"togglePinnedRow", "Move to Pinned", "Tabs", "option+shift+cmd+d", "ctrl+alt+shift+d"},
    {"duplicateTab", "Duplicate", "Tabs", "", ""},
    {"newGroupWithTabs", "New Group with Tab", "Tabs", "ctrl+cmd+n|ctrl+cmd+p", "ctrl+alt+g|none"},
    {"closeTabGroup", "Close Group", "Tabs", "ctrl+cmd+w", "ctrl+alt+w", RowHidden},
    {"bookmarkPage", "Add to Bookmarks" ARDIA_ELLIPSIS, "Tabs", "cmd+d", "ctrl+d", RowHiddenWithBookmarks},
    {"renameTab", "Rename" ARDIA_ELLIPSIS, "Tabs", "", ""},
    {"changeTabIcon", "Change Icon" ARDIA_ELLIPSIS, "Tabs", "", ""},
    {"toggleMute", "Mute Tab", "Tabs", "", ""},

    {"bookmarkPage", "Bookmark This Page", "Bookmarks", "cmd+d", "ctrl+d", RowInBookmarksMenu},
    {"bookmarkAllTabs", "Bookmark All Tabs" ARDIA_ELLIPSIS, "Bookmarks", "shift+cmd+d", "ctrl+shift+d", RowInBookmarksMenu},
    {"manageBookmarks", "Manage Bookmarks", "Bookmarks", "option+cmd+b", "ctrl+shift+o", RowInBookmarksMenu},
    {"exportBookmarks", "Export Bookmarks" ARDIA_ELLIPSIS, "Bookmarks", "", "", RowInBookmarksMenu},

    {"showHistory", "Show History" ARDIA_ELLIPSIS, "History", "cmd+y", "ctrl+h"},
    {"clearBrowsingData", "Clear Browsing Data" ARDIA_ELLIPSIS, "History", "shift+cmd+backspace", "ctrl+shift+delete"},

    {"", "", "Extensions", "", "", 0, Expansion::Extensions},
    {"addExtension", "Add Extension" ARDIA_ELLIPSIS, "Extensions", "", ""},
    {"manageExtensions", "Manage Extensions" ARDIA_ELLIPSIS, "Extensions", "", ""},
    {"pinExtensions", "Pin Extensions" ARDIA_ELLIPSIS, "Extensions", "", ""},

    {"std:performMiniaturize:", "Minimize", "Window", "cmd+m", "none", RowNativeAction},
    {"std:miniaturizeAll:", "Minimize All", "Window", "option+cmd+m", "none", RowNativeAction},
    {"std:performZoom:", "Zoom", "Window", "", "", RowNativeAction},
    {"std:toggleKeepOnTop:", "Keep Window on Top", "Window", "", "", RowNativeAction},
    {"downloads", "Downloads", "Window", "shift+cmd+j|option+cmd+l", "ctrl+j|none"},
    {"taskManager", "Task Manager", "Window", "", "shift+escape"},
    {"mergeAllWindows", "Merge All Windows", "Window", "", ""},
    {"", "", "Window > Profiles", "", "", 0, Expansion::SwitchProfiles},
    {"nextProfile", "Next Profile", "Window > Profiles", "option+cmd+right", "none"},
    {"previousProfile", "Previous Profile", "Window > Profiles", "option+cmd+left", "none"},
    {"newProfile", "New Profile" ARDIA_ELLIPSIS, "Window > Profiles", "", ""},
    {"openProfileMenu", "Show Profiles Menu", "Window", "shift+cmd+m", "ctrl+shift+m", RowHidden},

    {"reportProblem", "Report a Problem" ARDIA_ELLIPSIS, "Help", "option+shift+cmd+i", "ctrl+alt+shift+i"},
    {"keyboardShortcuts", "Keyboard Shortcuts", "Help", "", ""},
    {"toolTour", "Tool Tour", "Help", "", ""},
    {"videoTour", "Video Tour", "Help", "", ""},
    {"releaseNotes", "Release Notes", "Help", "", ""},
    {"copyDiagnostics", "Copy Diagnostics", "Help", "", ""},
    {"showOnboarding", "Show Onboarding", "Help", "", "", RowDebugOnly},
};

inline constexpr SystemRow kSystemRows[] = {
    {"Undo", "Edit", "ctrl+z"},
    {"Redo", "Edit", "ctrl+y"},
    {"Cut", "Edit", "ctrl+x"},
    {"Copy", "Edit", "ctrl+c"},
    {"Paste", "Edit", "ctrl+v"},
    {"Paste and Match Style", "Edit", "ctrl+shift+v"},
    {"Select All", "Edit", "ctrl+a"},
    {"Close", "Window", "alt+f4"},
};

#undef ARDIA_ELLIPSIS

inline constexpr int kProfileShortcutCount = 9;
inline constexpr wchar_t kFunctionKeyF1 = 0xF704;

inline std::vector<std::string_view> SplitOn(std::string_view text, std::string_view separator) noexcept {
  std::vector<std::string_view> parts;
  if (text.empty()) return parts;
  size_t start = 0;
  while (true) {
    size_t found = text.find(separator, start);
    if (found == std::string_view::npos) {
      parts.push_back(text.substr(start));
      return parts;
    }
    parts.push_back(text.substr(start, found - start));
    start = found + separator.size();
  }
}

inline std::optional<unsigned> ModifierNamed(std::string_view name) noexcept {
  if (name == "ctrl" || name == "control") return ModifierControl;
  if (name == "alt" || name == "option") return ModifierOption;
  if (name == "shift") return ModifierShift;
  if (name == "cmd" || name == "command") return ModifierCommand;
  if (name == "fn" || name == "function") return ModifierFunction;
  return std::nullopt;
}

inline wchar_t KeyNamed(std::string_view name) noexcept {
  if (name.size() == 1) {
    char c = name[0];
    return static_cast<wchar_t>(c >= 'A' && c <= 'Z' ? c - 'A' + 'a' : c);
  }
  static constexpr std::pair<std::string_view, wchar_t> named[] = {
      {"plus", L'+'},        {"left", 0xF702},     {"right", 0xF703},  {"up", 0xF700},     {"down", 0xF701},
      {"pageup", 0xF72C},    {"pagedown", 0xF72D}, {"home", 0xF729},   {"end", 0xF72B},    {"delete", 0xF728},
      {"insert", 0xF727},    {"backspace", 0x08},  {"tab", L'\t'},     {"enter", L'\r'},   {"escape", 0x1B},
      {"space", L' '},
  };
  for (auto const &[label, key] : named) {
    if (label == name) return key;
  }
  if (name.size() >= 2 && name.size() <= 3 && name[0] == 'f') {
    int number = 0;
    for (char c : name.substr(1)) {
      if (c < '0' || c > '9') return 0;
      number = number * 10 + (c - '0');
    }
    if (number >= 1 && number <= 24) return static_cast<wchar_t>(kFunctionKeyF1 + number - 1);
  }
  return 0;
}

inline Combo ParseCombo(std::string_view text) noexcept {
  if (text.empty() || text == "none") return {};
  std::vector<std::string_view> parts = SplitOn(text, "+");
  Combo combo;
  for (size_t i = 0; i + 1 < parts.size(); i++) {
    std::optional<unsigned> modifier = ModifierNamed(parts[i]);
    if (!modifier) return {};
    combo.modifiers |= *modifier;
  }
  combo.key = KeyNamed(parts.back());
  if (combo.key == 0) return {};
  return combo;
}

inline std::vector<Combo> ParseCombos(std::string_view list) noexcept {
  std::vector<Combo> combos;
  for (std::string_view part : SplitOn(list, "|")) combos.push_back(ParseCombo(part));
  return combos;
}

inline const char *ModifierNameOf(unsigned modifier) noexcept {
  switch (modifier) {
    case ModifierControl: return "control";
    case ModifierOption: return "option";
    case ModifierShift: return "shift";
    case ModifierCommand: return "command";
    case ModifierFunction: return "function";
    default: return "";
  }
}

inline constexpr unsigned kModifierOrder[] = {ModifierControl, ModifierOption, ModifierShift, ModifierCommand, ModifierFunction};

inline bool IsPrintableKey(wchar_t key) noexcept {
  return key >= 0x20 && key != 0x7F && (key < 0xF700 || key > 0xF8FF);
}

inline bool IsFunctionKey(wchar_t key) noexcept {
  return key >= kFunctionKeyF1 && key < kFunctionKeyF1 + 24;
}

inline Combo WindowsComboFromStored(Combo stored) noexcept {
  if (stored.Empty()) return {};
  Combo combo{stored.key, static_cast<unsigned>(stored.modifiers & (ModifierControl | ModifierOption | ModifierShift))};
  if (stored.modifiers & ModifierCommand) combo.modifiers |= ModifierControl;
  bool held = (combo.modifiers & (ModifierControl | ModifierOption)) != 0;
  if (!held && IsPrintableKey(combo.key)) return {};
  return combo;
}

}
