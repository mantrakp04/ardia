#include "ardia/win/main.h"

#include <windows.h>

#include <memory>
#include <string>
#include <utility>

#include "ardia/core/ac_hooks.h"
#include "ardia/win/api.h"
#include "ardia/win/frame_view.h"
#include "ardia/win/hooks.h"
#include "ardia/win/host.h"
#include "base/base_switches.h"
#include "base/command_line.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "chrome/browser/chrome_browser_main.h"
#include "chrome/browser/chrome_browser_main_extra_parts.h"
#include "chrome/browser/lifetime/application_lifetime_desktop.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/common/chrome_switches.h"
#include "components/keep_alive_registry/keep_alive_types.h"
#include "components/keep_alive_registry/scoped_keep_alive.h"
#include "content/public/common/content_switches.h"

namespace base {
extern bool (*g_ardia_pre_translate_message)(const MSG& msg);
}

namespace ardia_win {

namespace {

struct App {
  HMODULE module = nullptr;
  ArdiaAppPreTranslateFunction pre_translate = nullptr;
  ArdiaAppStopFunction stop = nullptr;
  bool started = false;
};

App& TheApp() {
  static App app;
  return app;
}

std::unique_ptr<ScopedKeepAlive>& KeepAlive() {
  static base::NoDestructor<std::unique_ptr<ScopedKeepAlive>> keep_alive;
  return *keep_alive;
}

std::wstring AppLibraryPath() {
  std::wstring path(MAX_PATH, L'\0');
  DWORD length = ::GetModuleFileNameW(nullptr, path.data(),
                                      static_cast<DWORD>(path.size()));
  path.resize(length);
  size_t slash = path.find_last_of(L'\\');
  if (slash == std::wstring::npos) {
    return std::wstring();
  }
  path.resize(slash + 1);
  path.append(L"ArdiaApp.dll");
  return path;
}

bool AppLibraryPresent() {
  std::wstring path = AppLibraryPath();
  return !path.empty() &&
         ::GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
}

bool PreTranslate(const MSG& msg) {
  App& app = TheApp();
  return app.started && app.pre_translate && app.pre_translate(&msg) != 0;
}

void StartApp() {
  App& app = TheApp();
  std::wstring path = AppLibraryPath();
  app.module =
      ::LoadLibraryExW(path.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
  if (!app.module) {
    LOG(ERROR) << "Ardia: the app library did not load, error "
               << ::GetLastError();
    QuitApp();
    return;
  }
  auto start = reinterpret_cast<ArdiaAppStartFunction>(
      ::GetProcAddress(app.module, "ArdiaAppStart"));
  app.pre_translate = reinterpret_cast<ArdiaAppPreTranslateFunction>(
      ::GetProcAddress(app.module, "ArdiaAppPreTranslateMessage"));
  app.stop = reinterpret_cast<ArdiaAppStopFunction>(
      ::GetProcAddress(app.module, "ArdiaAppStop"));
  if (!start) {
    LOG(ERROR) << "Ardia: the app library has no ArdiaAppStart";
    QuitApp();
    return;
  }
  int result = start(EngineApi());
  if (result != 0) {
    LOG(ERROR) << "Ardia: the app did not start, code " << result;
    QuitApp();
    return;
  }
  app.started = true;
  base::g_ardia_pre_translate_message = &PreTranslate;
}

void StopApp() {
  App& app = TheApp();
  base::g_ardia_pre_translate_message = nullptr;
  if (app.started && app.stop) {
    app.stop();
  }
  app.started = false;
}

class MainParts : public ChromeBrowserMainExtraParts {
 public:
  MainParts() = default;
  MainParts(const MainParts&) = delete;
  MainParts& operator=(const MainParts&) = delete;
  ~MainParts() override = default;

  void PreBrowserStart() override {
    KeepAlive() = std::make_unique<ScopedKeepAlive>(
        KeepAliveOrigin::APP_CONTROLLER, KeepAliveRestartOption::DISABLED);
  }

  void PostBrowserStart() override {
    Host::Get()->Start();
    WatchEngineEvents();
    StartApp();
  }

  void PostMainMessageLoopRun() override {
    StopApp();
    KeepAlive().reset();
  }
};

void AddMainParts(ChromeBrowserMainParts* main_parts) {
  main_parts->AddParts(std::make_unique<MainParts>());
}

bool KeepsWindowWithoutTabs(const BrowserWindowInterface* browser) {
  return Host::Get()->Keeps(browser);
}

}

void BeforeChromeMain() {
  base::CommandLine* command_line = base::CommandLine::ForCurrentProcess();
  if (command_line->HasSwitch(switches::kProcessType) ||
      !AppLibraryPresent()) {
    return;
  }
  command_line->AppendSwitch(switches::kNoStartupWindow);
  command_line->AppendSwitch(switches::kNoFirstRun);
  command_line->AppendSwitch(switches::kNoDefaultBrowserCheck);
  std::string disabled =
      command_line->GetSwitchValueASCII(switches::kDisableFeatures);
  if (!disabled.empty()) {
    disabled.push_back(',');
  }
  disabled.append("CalculateNativeWinOcclusion");
  command_line->AppendSwitchASCII(switches::kDisableFeatures, disabled);
  g_ardia_win_hosts_normal_windows = true;
  g_ardia_win_frame_view = &CreateHostedFrameView;
  g_ardia_win_add_main_parts = &AddMainParts;
  g_ardia_keeps_window_without_tabs = &KeepsWindowWithoutTabs;
}

void QuitApp() {
  KeepAlive().reset();
  chrome::CloseAllBrowsersAndQuit();
}

}
