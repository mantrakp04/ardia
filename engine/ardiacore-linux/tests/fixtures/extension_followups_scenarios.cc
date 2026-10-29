#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "ardia/linux/ac_linux_extension_shortcuts.h"
#include "ardia/linux/ac_linux_native_messaging.h"

namespace shortcuts = ardia::linux_extension_shortcuts;
namespace messaging = ardia::linux_native_messaging;

namespace {

int failures = 0;

void Expect(bool condition, const char* what) {
  if (condition) return;
  std::printf("FAILED: %s\n", what);
  ++failures;
}

constexpr int kShift = 1 << 1;
constexpr int kControl = 1 << 2;
constexpr int kAlt = 1 << 3;

void ShortcutBookScenarios() {
  shortcuts::ShortcutBook book;
  const shortcuts::Key action{'Y', kControl | kShift};
  const shortcuts::Key named{'K', kAlt | kShift};
  const shortcuts::Key legacy{'U', kControl | kShift};
  const std::string id(32, 'a');
  const std::string other(32, 'b');
  book.Register(action, id, "_execute_action");
  book.Register(named, id, "toggle-feature");
  book.Register(legacy, other, "_execute_browser_action");

  shortcuts::Decision decision = book.Decide(action, false, false);
  Expect(decision.route == shortcuts::Route::kAction && decision.extension_id == id, "action shortcut opens the action");
  decision = book.Decide(action, true, false);
  Expect(decision.route == shortcuts::Route::kSwallow, "a held action key is swallowed instead of reopening");
  decision = book.Decide(legacy, false, false);
  Expect(decision.route == shortcuts::Route::kAction && decision.extension_id == other, "browser action alias opens the action");
  decision = book.Decide(named, false, false);
  Expect(decision.route == shortcuts::Route::kCommand && decision.command == "toggle-feature", "named command dispatches");
  decision = book.Decide(named, true, false);
  Expect(decision.route == shortcuts::Route::kCommand, "named commands repeat like Chromium");
  decision = book.Decide(shortcuts::Key{'Y', kControl}, false, false);
  Expect(decision.route == shortcuts::Route::kNone, "modifiers must match exactly");

  decision = book.Decide(action, false, true);
  Expect(decision.route == shortcuts::Route::kNone && decision.extension_id.empty(), "an Ardia shortcut is never shadowed by an action");
  decision = book.Decide(named, false, true);
  Expect(decision.route == shortcuts::Route::kNone, "an Ardia shortcut is never shadowed by a command");

  book.Unregister(named);
  Expect(!book.Contains(named) && book.Decide(named, false, false).route == shortcuts::Route::kNone, "unregistered commands stop");
  book.Register(action, other, "renamed");
  decision = book.Decide(action, false, false);
  Expect(decision.route == shortcuts::Route::kCommand && decision.extension_id == other, "re-registration replaces the target");
  Expect(book.size() == 2, "book size");

  Expect(shortcuts::IsActionCommand("_execute_action") && shortcuts::IsActionCommand("_execute_page_action") &&
             shortcuts::IsActionCommand("_execute_browser_action"),
         "action command names");
  Expect(!shortcuts::IsActionCommand("_execute_side_panel") && !shortcuts::IsActionCommand(""), "other names are commands");
}

void NativeMessagingScenarios(const std::string& scratch) {
  for (const char* good : {"com.example.host", "a", "a_b.c9", "dev.ardia.acceptance.echo", "com.1password.1password",
                           "com.8bit.bitwarden", "org.keepassxc.keepassxc_browser"}) {
    Expect(messaging::ValidHostName(good), good);
  }
  for (const char* bad : {"", ".a", "a.", "a..b", "A.b", "a/b", "../x", "a-b", "a b", "a.json\n"}) {
    Expect(!messaging::ValidHostName(bad), bad);
  }

  messaging::Environment environment;
  environment.home = "/home/u";
  Expect(messaging::ConfigRoot(environment) == "/home/u/.config", "home fallback");
  environment.xdg_config_home = "relative";
  Expect(messaging::ConfigRoot(environment) == "relative", "any non-empty XDG_CONFIG_HOME wins, as in Chromium");
  Expect(messaging::FindManifest(messaging::ExtraUserDirectories(environment), "com.example.host").empty(),
         "a relative root yields no usable folder");
  environment.xdg_config_home = "/xdg";
  Expect(messaging::ConfigRoot(environment) == "/xdg", "XDG_CONFIG_HOME wins over HOME");
  environment.chrome_config_home = "/chrome-config";
  Expect(messaging::ConfigRoot(environment) == "/chrome-config", "CHROME_CONFIG_HOME wins like Chromium");
  std::vector<std::string> directories = messaging::ExtraUserDirectories(environment);
  Expect(directories.size() == 1 && directories[0] == "/chrome-config/chromium/NativeMessagingHosts", "chromium user folder");
  Expect(messaging::ExtraUserDirectories(messaging::Environment{}).empty(), "no home means no extra folder");

  const std::string first = scratch + "/first";
  const std::string second = scratch + "/second";
  const std::vector<std::string> search = {"relative/dir", first, second};
  Expect(messaging::FindManifest(search, "com.example.host") == second + "/com.example.host.json", "finds the manifest in a later folder");
  Expect(messaging::FindManifest(search, "com.example.both") == first + "/com.example.both.json", "the first folder wins");
  Expect(messaging::FindManifest(search, "com.example.folder").empty(), "a folder named like a manifest is ignored");
  Expect(messaging::FindManifest(search, "com.example.missing").empty(), "missing manifests are not found");
  Expect(messaging::FindManifest(search, "../second/com.example.host").empty(), "traversal names are refused");
  Expect(messaging::FindManifest({"relative"}, "com.example.host").empty(), "relative folders are skipped");
}

}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::printf("usage: extension_followups <scratch>\n");
    return 2;
  }
  ShortcutBookScenarios();
  NativeMessagingScenarios(argv[1]);
  if (failures) return 1;
  std::printf("extension follow-up scenarios passed\n");
  return 0;
}
