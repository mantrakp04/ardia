#pragma once

#include <filesystem>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <vector>

#include "LaunchLog.h"
#include "Paths.h"
#include "TestGate.h"

namespace Ardia {

namespace AppLaunch {

inline bool BackgroundRequested() noexcept {
  return Paths::Environment(L"ARDIA_BACKGROUND") == L"1";
}

inline void Note(std::wstring_view message) noexcept {
  std::wstring line{L"[ardia] "};
  line.append(message).append(L"\n");
  OutputDebugStringW(line.c_str());
  LaunchLog::Write(L"info", message);
}

inline std::string Trimmed(std::string_view text) noexcept {
  size_t start = text.find_first_not_of(" \t");
  if (start == std::string_view::npos) return {};
  size_t end = text.find_last_not_of(" \t");
  return std::string{text.substr(start, end - start + 1)};
}

inline std::vector<std::string> Pieces(std::string_view text) noexcept {
  std::vector<std::string> pieces;
  size_t start = 0;
  while (true) {
    size_t comma = text.find(',', start);
    pieces.emplace_back(text.substr(start, comma == std::string_view::npos ? std::string_view::npos : comma - start));
    if (comma == std::string_view::npos) break;
    start = comma + 1;
  }
  return pieces;
}

inline bool Contains(std::vector<std::string_view> const &list, std::string_view value) noexcept {
  return std::find(list.begin(), list.end(), value) != list.end();
}

inline bool Truthy(std::string_view value) noexcept {
  return !value.empty() && value != "0" && value != "off" && value != "false";
}

inline std::vector<std::string_view> const &InstanceKeys() noexcept {
  static const std::vector<std::string_view> keys{
      "jsLocation", "chromiumSwitches", "downloadsDir", "updateFeed", "allowAudio", "allowOcclusion", "releaseNotes",
      "cliHome", "cliBinDir", "cliUrl", "syncFolder", "sharedFolders", "importSourceDir", "importSafariHome",
  };
  return keys;
}

inline std::vector<std::string_view> const &TestKeys() noexcept {
  static const std::vector<std::string_view> keys{
      "keychain", "keychainHiddenReads", "keychainFail", "safeStorageAnswer", "reauth", "bluetoothChooser",
      "externalProtocolNoLaunch", "externalProtocolApp", "mediaRouteProvider", "systemMediaPermission", "applyProfileGate", "contextMenu",
      "loginsDelay", "loginsReleaseAfter", "cdpTabsVisible",
      "pipSelfTest", "pipHover", "fakeFullScreenMs", "shadersKeyWindow", "peekStrict", "importSecret", "importDiaBundleId", "importDiaWindows",
      "cliInstallScript", "legacySource", "legacyCrashAfter", "bangsUrl", "onboarding", "whatsNew", "telemetry",
      "liveMock", "calendarFixture", "appMenu", "appDialog", "loginsTimeout", "externalAppLaunch",
  };
  return keys;
}

inline std::vector<std::string_view> const &KeysWhoseValuesHoldCommas() noexcept {
  static const std::vector<std::string_view> keys{
      "chromiumSwitches", "downloadsDir", "updateFeed", "cliHome", "cliBinDir", "cliUrl", "syncFolder", "sharedFolders", "importSourceDir",
      "importSafariHome", "importSecret", "cliInstallScript", "legacySource", "bangsUrl", "liveMock",
  };
  return keys;
}

inline std::vector<std::string_view> const &TraceAreas() noexcept {
  static const std::vector<std::string_view> areas{"visibility", "pip", "pipZoom", "trafficLights", "profileGate"};
  return areas;
}

inline std::map<std::string, std::string> KeyedEntries(std::string_view text, std::vector<std::string_view> const &known, std::wstring_view variable) noexcept {
  std::map<std::string, std::string> entries;
  if (text.empty()) return entries;
  std::vector<std::string> pieces;
  std::string previousKey;
  for (std::string const &piece : Pieces(text)) {
    std::string head = Trimmed(std::string_view{piece}.substr(0, piece.find('=')));
    if (!pieces.empty() && !Contains(known, head) && Contains(KeysWhoseValuesHoldCommas(), previousKey)) {
      pieces.back().append(",").append(piece);
      continue;
    }
    pieces.push_back(piece);
    previousKey = head;
  }
  for (std::string const &piece : pieces) {
    size_t equals = piece.find('=');
    std::string key = Trimmed(std::string_view{piece}.substr(0, equals));
    if (key.empty()) continue;
    if (!Contains(known, key)) {
      std::wstring message{variable};
      Note(message.append(L": unknown key ").append(Paths::Wide(key)).append(L" ignored"));
      continue;
    }
    entries[key] = equals == std::string::npos ? std::string{"1"} : Trimmed(std::string_view{piece}.substr(equals + 1));
  }
  return entries;
}

inline std::map<std::string, bool> SwitchEntries(std::string_view text) noexcept {
  std::map<std::string, bool> entries;
  for (std::string const &piece : Pieces(text)) {
    size_t equals = piece.find('=');
    if (equals == std::string::npos || piece.find('=', equals + 1) != std::string::npos) continue;
    std::string name = Trimmed(std::string_view{piece}.substr(0, equals));
    std::string value = Trimmed(std::string_view{piece}.substr(equals + 1));
    if (name.empty()) continue;
    if (value == "on" || value == "1" || value == "true") entries[name] = true;
    else if (value == "off" || value == "0" || value == "false") entries[name] = false;
  }
  return entries;
}

inline std::set<std::string> AreaEntries(std::string_view text) noexcept {
  std::set<std::string> areas;
  for (std::string const &piece : Pieces(text)) {
    std::string area = Trimmed(piece);
    if (area.empty()) continue;
    if (Contains(TraceAreas(), area)) areas.insert(area);
    else Note(std::wstring{L"ARDIA_TRACE: unknown area "}.append(Paths::Wide(area)).append(L" ignored"));
  }
  return areas;
}

struct Config {
  std::string dataDirectory;
  std::string configDirectory;
  bool background = false;
  bool isolated = false;
  bool testInstance = false;
  std::map<std::string, std::string> instance;
  std::map<std::string, bool> switches;
  std::set<std::string> trace;
  std::map<std::string, std::string> test;
  std::string feedbackURL;

  bool InstanceFlag(std::string_view key) const noexcept {
    auto found = instance.find(std::string{key});
    return found != instance.end() && Truthy(found->second);
  }
};

inline std::vector<std::string_view> const &TestOnlyInstanceKeys() noexcept {
  static const std::vector<std::string_view> keys{"updateFeed", "importSourceDir", "importSafariHome"};
  return keys;
}

inline std::filesystem::path ChosenConfigDirectory(bool testInstance) noexcept {
  std::wstring chosen = testInstance ? Paths::Environment(L"ARDIA_CONFIG_DIR") : std::wstring{};
  if (!chosen.empty()) return Paths::Ensured(std::filesystem::path(chosen));
  if (Paths::HasCustomDataDirectory()) return Paths::Ensured(Paths::DataDirectory() / L"config");
  return Paths::Ensured(Paths::UserFolder(FOLDERID_RoamingAppData, L"APPDATA") / L"Ardia");
}

inline Config Read() noexcept {
  Config config;
  if (Paths::HasCustomDataDirectory()) {
    std::error_code ignored;
    std::filesystem::path absolute = std::filesystem::absolute(Paths::DataDirectory(), ignored);
    config.dataDirectory = Paths::Utf8((absolute.empty() ? Paths::DataDirectory() : absolute).lexically_normal().wstring());
  }
  config.background = BackgroundRequested();
  config.isolated = !config.dataDirectory.empty();
  std::wstring refusal = config.isolated ? TestGate::Refusal() : std::wstring{L"no scratch ARDIA_DATA_DIR"};
  config.testInstance = refusal.empty();
  config.configDirectory = Paths::Utf8(ChosenConfigDirectory(config.testInstance).wstring());
  config.instance = KeyedEntries(Paths::Utf8(Paths::Environment(L"ARDIA_INSTANCE")), InstanceKeys(), L"ARDIA_INSTANCE");
  config.switches = SwitchEntries(Paths::Utf8(Paths::Environment(L"ARDIA_SWITCHES")));
  config.trace = AreaEntries(Paths::Utf8(Paths::Environment(L"ARDIA_TRACE")));
  config.test = KeyedEntries(Paths::Utf8(Paths::Environment(L"ARDIA_TEST")), TestKeys(), L"ARDIA_TEST");
  config.feedbackURL = Paths::Utf8(Paths::Environment(L"ARDIA_FEEDBACK_URL"));
  if (config.testInstance) return config;
  bool asked = !config.trace.empty() || !config.test.empty() || !Paths::Environment(L"ARDIA_CONFIG_DIR").empty();
  for (std::string_view key : TestOnlyInstanceKeys()) asked = config.instance.erase(std::string{key}) > 0 || asked;
  config.trace.clear();
  config.test.clear();
  if (asked) Note(L"ARDIA_TEST, ARDIA_TRACE, ARDIA_CONFIG_DIR and test-only ARDIA_INSTANCE keys ignored: not a test instance (" + refusal + L")");
  return config;
}

inline Config const &Shared() noexcept {
  static const Config config = Read();
  return config;
}

inline bool Background() noexcept {
  return Shared().background;
}

inline std::filesystem::path const &ConfigDirectory() noexcept {
  static const std::filesystem::path directory = Paths::Wide(Shared().configDirectory);
  return directory;
}

inline std::optional<std::string> TestValue(std::string_view key) noexcept {
  auto const &test = Shared().test;
  auto found = test.find(std::string{key});
  if (found == test.end()) return std::nullopt;
  return found->second;
}

inline bool TestFlag(std::string_view key) noexcept {
  std::optional<std::string> value = TestValue(key);
  return value && Truthy(*value);
}

}

}
