#include "ardia/win/main.h"

#include <windows.h>

#include <stdio.h>

#include <memory>
#include <string>
#include <string_view>
#include <utility>

#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_launch_switches.h"
#include "ardia/win/api.h"
#include "ardia/win/frame_view.h"
#include "ardia/win/hooks.h"
#include "ardia/win/host.h"
#include "base/base_switches.h"
#include "base/command_line.h"
#include "base/files/file_path.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/strings/utf_string_conversions.h"
#include "base/values.h"
#include "chrome/browser/chrome_browser_main.h"
#include "chrome/browser/chrome_browser_main_extra_parts.h"
#include "chrome/browser/lifetime/application_lifetime_desktop.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/common/chrome_switches.h"
#include "components/keep_alive_registry/keep_alive_types.h"
#include "components/keep_alive_registry/scoped_keep_alive.h"
#include "components/url_formatter/url_fixer.h"
#include "content/public/common/content_switches.h"
#include "media/base/media_switches.h"
#include "url/gurl.h"

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

std::wstring Environment(const wchar_t* name) {
  std::wstring value(32768, L'\0');
  DWORD length = ::GetEnvironmentVariableW(name, value.data(),
                                          static_cast<DWORD>(value.size()));
  if (length == 0 || length >= value.size()) {
    return std::wstring();
  }
  value.resize(length);
  return value;
}

bool Set(const std::wstring& value) {
  return !value.empty() && value != L"0";
}

void AddFeatures(base::CommandLine* command_line,
                 const char* switch_name,
                 std::string_view features) {
  std::string all = command_line->GetSwitchValueASCII(switch_name);
  if (!all.empty()) {
    all.push_back(',');
  }
  all.append(features);
  command_line->AppendSwitchASCII(switch_name, all);
}

void AddLaunchSwitches(base::CommandLine* command_line) {
  command_line->AppendSwitch(switches::kNoStartupWindow);
  command_line->AppendSwitch(switches::kNoFirstRun);
  command_line->AppendSwitch(switches::kNoDefaultBrowserCheck);
  command_line->AppendSwitch(switches::kHideCrashRestoreBubble);
  AddFeatures(command_line, switches::kDisableFeatures,
              "CalculateNativeWinOcclusion");
  for (const char* forbidden : {switches::kRemoteDebuggingPort,
                                switches::kRemoteDebuggingPipe,
                                "remote-allow-origins"}) {
    command_line->RemoveSwitch(forbidden);
  }
  std::wstring data_dir = Environment(L"ARDIA_DATA_DIR");
  while (!data_dir.empty() &&
         (data_dir.back() == L'\\' || data_dir.back() == L'/')) {
    data_dir.pop_back();
  }
  const bool scratch = !data_dir.empty();
  const bool background = Set(Environment(L"ARDIA_BACKGROUND"));
  if (scratch) {
    command_line->AppendSwitchNative(ardiacore::kDataDirSwitch, data_dir);
    command_line->AppendSwitchNative(switches::kUserDataDir,
                                     data_dir + L"\\Chromium");
    std::wstring port = Environment(L"ARDIA_REMOTE_DEBUGGING_PORT");
    if (!port.empty()) {
      command_line->AppendSwitchNative(switches::kRemoteDebuggingPort, port);
      command_line->AppendSwitchASCII("remote-allow-origins", "*");
    }
    std::wstring test = Environment(L"ARDIA_TEST");
    if (!test.empty()) {
      command_line->AppendSwitchNative(ardiacore::kTestSwitch, test);
    }
    std::wstring trace = Environment(L"ARDIA_TRACE");
    if (!trace.empty()) {
      command_line->AppendSwitchNative(ardiacore::kTraceSwitch, trace);
    }
  }
  if (background) {
    command_line->AppendSwitch(ardiacore::kBackgroundSwitch);
    command_line->AppendSwitch(switches::kMuteAudio);
    command_line->AppendSwitch(switches::kUseFakeDeviceForMediaStream);
  }
  std::wstring app_switches = Environment(L"ARDIA_SWITCHES");
  if (!app_switches.empty()) {
    command_line->AppendSwitchNative(ardiacore::kSwitchesSwitch, app_switches);
  }
}

bool ForEngineWindow(const MSG& msg) {
  constexpr wchar_t kPrefix[] = L"Chrome_";
  constexpr int kPrefixLength = 7;
  if (!msg.hwnd) {
    return false;
  }
  wchar_t name[kPrefixLength + 2] = {};
  int length = ::GetClassNameW(msg.hwnd, name, kPrefixLength + 2);
  return length >= kPrefixLength &&
         std::wstring_view(name, kPrefixLength) == kPrefix;
}

FILE*& InputTrace() {
  static FILE* trace = nullptr;
  return trace;
}

bool Traced(const MSG& msg) {
  return (msg.message >= WM_MOUSEFIRST && msg.message <= WM_MOUSELAST) ||
         (msg.message >= WM_NCMOUSEMOVE && msg.message <= WM_NCXBUTTONDBLCLK) ||
         (msg.message >= WM_KEYFIRST && msg.message <= WM_KEYLAST) ||
         (msg.message >= WM_NCPOINTERUPDATE && msg.message <= WM_POINTERHWHEEL);
}

void Trace(const MSG& msg, bool engine_window, bool taken) {
  FILE* trace = InputTrace();
  if (!trace || !Traced(msg)) {
    return;
  }
  static int moves = 0;
  if (msg.message == WM_MOUSEMOVE || msg.message == WM_POINTERUPDATE ||
      msg.message == WM_NCMOUSEMOVE || msg.message == WM_NCPOINTERUPDATE) {
    if (++moves > 40) {
      return;
    }
  }
  wchar_t name[64] = {};
  ::GetClassNameW(msg.hwnd, name, 64);
  fprintf(trace, "%lu msg=0x%04x hwnd=%p class=%ls engine=%d taken=%d\n",
          static_cast<unsigned long>(::GetTickCount()), msg.message,
          static_cast<void*>(msg.hwnd), name, engine_window ? 1 : 0,
          taken ? 1 : 0);
  fflush(trace);
}

bool PreTranslate(const MSG& msg) {
  App& app = TheApp();
  const bool engine_window = ForEngineWindow(msg);
  bool taken = false;
  if (app.started && app.pre_translate && !engine_window) {
    taken = app.pre_translate(&msg) != 0;
  }
  Trace(msg, engine_window, taken);
  return taken;
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
  std::wstring traced = Environment(L"ARDIA_INPUT_TRACE");
  if (!traced.empty()) {
    _wfopen_s(&InputTrace(), traced.c_str(), L"w");
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

bool Relaunched(const base::CommandLine& command_line,
                const base::FilePath& cur_dir) {
  base::ListValue urls;
  for (const base::CommandLine::StringType& argument :
       command_line.GetArgs()) {
    GURL url(base::WideToUTF8(argument));
    if (!url.is_valid()) {
      url = url_formatter::FixupRelativeFile(cur_dir,
                                             base::FilePath(argument));
    }
    if (url.is_valid() && (url.SchemeIsHTTPOrHTTPS() || url.SchemeIsFile())) {
      urls.Append(url.spec());
    }
  }
  base::DictValue payload;
  payload.Set("urls", std::move(urls));
  Emit("relaunch", std::move(payload));
  return true;
}

}

void BeforeChromeMain() {
  base::CommandLine* command_line = base::CommandLine::ForCurrentProcess();
  if (command_line->HasSwitch(switches::kProcessType) ||
      !AppLibraryPresent()) {
    return;
  }
  AddLaunchSwitches(command_line);
  g_ardia_win_hosts_normal_windows = true;
  g_ardia_win_frame_view = &CreateHostedFrameView;
  g_ardia_win_add_main_parts = &AddMainParts;
  g_ardia_win_relaunched = &Relaunched;
  g_ardia_keeps_window_without_tabs = &KeepsWindowWithoutTabs;
}

void QuitApp() {
  KeepAlive().reset();
  chrome::CloseAllBrowsersAndQuit();
}

}
