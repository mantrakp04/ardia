#include <windows.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <string>

#include "ardia/win/public/EngineApi.h"

namespace {

constexpr wchar_t kWindowClass[] = L"ArdiaProbeWindow";
constexpr UINT_PTR kStepTimer = 1;
constexpr int kPageLeft = 220;
constexpr int kPageTop = 60;
constexpr int kPageMargin = 12;

const ArdiaEngineApi* g_engine = nullptr;
HWND g_window = nullptr;
FILE* g_log = nullptr;
int g_step = 0;
int g_step_ms = 4000;
std::string g_first_url = "https://example.com/";
std::string g_second_url = "https://www.wikipedia.org/";
std::string g_download_url;
std::string g_cookie_url;
std::string g_slow_download_url;
std::string g_files_dir;

void Log(const char* what, const char* detail) {
  if (!g_log) {
    return;
  }
  fprintf(g_log, "%lu %s %s\n", static_cast<unsigned long>(::GetTickCount()),
          what, detail ? detail : "");
  fflush(g_log);
}

std::string Environment(const char* name, const std::string& fallback) {
  char value[2048];
  DWORD length = ::GetEnvironmentVariableA(name, value, sizeof(value));
  if (length == 0 || length >= sizeof(value)) {
    return fallback;
  }
  return std::string(value, length);
}

void LogReply(void* context, const char* json) {
  Log(static_cast<const char*>(context), json);
}

void OnEvent(void* context, const char* topic, const char* json) {
  std::string line = std::string("event ") + topic;
  Log(line.c_str(), json);
}

void Call(const char* label, const char* verb, const std::string& args) {
  g_engine->hostCall(verb, args.c_str(),
                     static_cast<uint64_t>(reinterpret_cast<uintptr_t>(g_window)),
                     &LogReply, const_cast<char*>(label));
}

void EngineCall(const char* label, const char* name, const char* args) {
  g_engine->engineCall(name, "", args, &LogReply, const_cast<char*>(label));
}

std::string Quoted(const std::string& text) {
  std::string quoted = "\"";
  for (char c : text) {
    if (c == '\\' || c == '"') {
      quoted += '\\';
    }
    quoted += c;
  }
  return quoted + "\"";
}

std::string PathArgs(const std::string& path) {
  return "{\"path\":" + Quoted(path) + "}";
}

void EngineCallWithPath(const char* label,
                        const char* name,
                        const std::string& path) {
  EngineCall(label, name, PathArgs(path).c_str());
}

std::string LoadArgs(const char* key, const std::string& url) {
  return std::string("{\"key\":\"") + key +
         "\",\"method\":\"loadUrl\",\"url\":" + Quoted(url) +
         ",\"userInitiated\":true}";
}

std::string ShowArgs(const char* key) {
  RECT client = {};
  ::GetClientRect(g_window, &client);
  char args[256];
  snprintf(args, sizeof(args),
           "{\"key\":\"%s\",\"visible\":true,\"unit\":\"px\",\"x\":%d,"
           "\"y\":%d,\"width\":%d,\"height\":%d}",
           key, kPageLeft, kPageTop,
           static_cast<int>(client.right) - kPageLeft - kPageMargin,
           static_cast<int>(client.bottom) - kPageTop - kPageMargin);
  return args;
}

std::string CreateArgs(const char* key, const std::string& url) {
  return std::string("{\"key\":\"") + key + "\",\"profile\":\"\",\"url\":\"" +
         url + "\"}";
}

std::string CreateIn(const char* key,
                     const char* profile,
                     const std::string& url) {
  return std::string("{\"key\":\"") + key + "\",\"profile\":\"" + profile +
         "\",\"url\":" + Quoted(url) + "}";
}

std::string KeyArgs(const char* key) {
  return std::string("{\"key\":\"") + key + "\"}";
}

std::string ProfileArgs(const char* profile) {
  return std::string("{\"profile\":\"") + profile + "\"}";
}

void ClosePrivate(const char* key, const char* profile) {
  Call("reply close private", "tab.close", KeyArgs(key));
  Call("reply release private", "profile.release", ProfileArgs(profile));
}

void Step() {
  ++g_step;
  char label[32];
  snprintf(label, sizeof(label), "%d", g_step);
  Log("step", label);
  switch (g_step) {
    case 1:
      Call("reply info", "host.info", "{}");
      Call("reply create one", "tab.create", CreateArgs("one", g_first_url));
      Call("reply show one", "tab.show", ShowArgs("one"));
      Call("reply create blank", "tab.create", CreateArgs("blank", ""));
      if (!g_download_url.empty()) {
        Call("reply create download", "tab.create",
             CreateArgs("download", ""));
        Call("reply create asked", "tab.create",
             CreateArgs("asked", "about:blank"));
        Call("reply create blank asked", "tab.create",
             CreateArgs("blank-asked", ""));
      }
      break;
    case 2:
      Call("reply list", "tabs.list", "{}");
      Call("reply create two", "tab.create", CreateArgs("two", g_second_url));
      Call("reply show two", "tab.show", ShowArgs("two"));
      break;
    case 3:
      Call("reply list", "tabs.list", "{}");
      Call("reply show one again", "tab.show", ShowArgs("one"));
      Call("reply load", "tab.call",
           "{\"key\":\"one\",\"method\":\"loadUrl\",\"url\":"
           "\"https://example.org/\",\"userInitiated\":true}");
      Call("reply load blank", "tab.call", LoadArgs("blank", g_first_url));
      if (!g_download_url.empty()) {
        Call("reply load download", "tab.call",
             LoadArgs("download", g_download_url));
        Call("reply load blank asked", "tab.call",
             LoadArgs("blank-asked", "about:blank"));
      }
      break;
    case 4:
      Call("reply back", "tab.call", "{\"key\":\"one\",\"method\":\"goBack\"}");
      Call("reply close two", "tab.close", "{\"key\":\"two\"}");
      Call("reply back blank", "tab.call",
           "{\"key\":\"blank\",\"method\":\"goBack\"}");
      if (!g_download_url.empty()) {
        Call("reply load download in asked", "tab.call",
             LoadArgs("asked", g_download_url));
        Call("reply load download in blank asked", "tab.call",
             LoadArgs("blank-asked", g_download_url));
      }
      break;
    case 5:
      if (!g_download_url.empty()) {
        Call("reply load download in one", "tab.call",
             LoadArgs("one", g_download_url));
      }
      EngineCall("reply history", "ac_history_query",
                 "{\"maxUrls\":10,\"maxVisits\":3}");
      EngineCall("reply bookmarks", "ac_bookmarks_tree", "{}");
      EngineCall("reply downloads", "ac_downloads_settings", "{}");
      EngineCall("reply unknown", "ac_no_such_call", "{}");
      EngineCallWithPath("reply export bookmarks", "ac_bookmarks_export_html",
                         g_files_dir + "\\probe-bookmarks.html");
      EngineCallWithPath("reply export bookmarks relative",
                         "ac_bookmarks_export_html", "probe-bookmarks.html");
      EngineCallWithPath("reply install unpacked", "ac_extensions_install",
                         g_files_dir + "\\no-such-extension");
      EngineCallWithPath("reply install crx", "ac_extensions_install_crx",
                         g_files_dir + "\\no-such-extension.crx");
      EngineCallWithPath("reply install crx unc", "ac_extensions_install_crx",
                         "\\\\localhost\\c$\\no-such-extension.crx");
      EngineCallWithPath("reply export passwords relative",
                         "ac_passwords_export", "probe-passwords.csv");
      EngineCall("reply load health", "ac_extensions_load_health", "{}");
      EngineCall("reply suggest", "ac_search_suggest",
                 ("{\"id\":1,\"url\":" + Quoted(g_first_url) + "}").c_str());
      EngineCall("reply suggest stop", "ac_search_suggest_stop", "{\"id\":2}");
      Call("reply list", "tabs.list", "{}");
      Call("reply hide one", "tab.show", "{\"key\":\"one\",\"visible\":false}");
      break;
    case 6:
      Call("reply show one last", "tab.show", ShowArgs("one"));
      break;
    case 7:
      if (!g_cookie_url.empty()) {
        Call("reply create normal cookie", "tab.create",
             CreateIn("normal-cookie", "", g_cookie_url + "?set"));
        Call("reply create private a", "tab.create",
             CreateIn("private-a", "incognito:probe-a@", g_cookie_url + "?set"));
      }
      break;
    case 8:
      if (!g_cookie_url.empty()) {
        Call("reply create private b", "tab.create",
             CreateIn("private-b", "incognito:probe-b@", g_cookie_url));
      }
      break;
    case 9:
      if (!g_cookie_url.empty()) {
        Call("reply sessions with a and b", "tabs.list", "{}");
        ClosePrivate("private-a", "incognito:probe-a@");
        ClosePrivate("private-b", "incognito:probe-b@");
        Call("reply info after release", "host.info", "{}");
      }
      break;
    case 10:
      if (!g_cookie_url.empty()) {
        Call("reply create private c", "tab.create",
             CreateIn("private-c", "incognito:probe-c@", g_cookie_url));
        Call("reply create normal read", "tab.create",
             CreateIn("normal-read", "", g_cookie_url));
        Call("reply reopen released a", "tab.create",
             CreateIn("private-a-again", "incognito:probe-a@", g_cookie_url));
      }
      break;
    case 11:
      if (!g_cookie_url.empty()) {
        Call("reply sessions with c", "tabs.list", "{}");
        Call("reply info with c", "host.info", "{}");
        ClosePrivate("private-c", "incognito:probe-c@");
      }
      if (!g_slow_download_url.empty()) {
        Call("reply create private d", "tab.create",
             CreateIn("private-d", "incognito:probe-d@", ""));
      }
      break;
    case 12:
      if (!g_slow_download_url.empty()) {
        Call("reply load slow download", "tab.call",
             LoadArgs("private-d", g_slow_download_url));
      }
      break;
    case 13:
      if (!g_slow_download_url.empty()) {
        Call("reply info while downloading", "host.info", "{}");
        ClosePrivate("private-d", "incognito:probe-d@");
      }
      break;
    case 14:
      if (!g_cookie_url.empty()) {
        Call("reply create private e", "tab.create",
             CreateIn("private-e", "incognito:probe-e@", g_cookie_url));
      }
      break;
    case 15:
      Call("reply sessions at the end", "tabs.list", "{}");
      Call("reply info at the end", "host.info", "{}");
      break;
    default:
      if (Environment("ARDIA_PROBE_STAY", "").empty()) {
        ::KillTimer(g_window, kStepTimer);
        Call("reply quit", "app.quit", "{}");
      }
      break;
  }
}

LRESULT CALLBACK WindowProcedure(HWND window,
                                 UINT message,
                                 WPARAM w_param,
                                 LPARAM l_param) {
  switch (message) {
    case WM_TIMER:
      if (w_param == kStepTimer) {
        Step();
        return 0;
      }
      break;
    case WM_SIZE:
      if (g_step >= 1 && g_engine) {
        Call("reply resize", "tab.show", ShowArgs(g_step == 2 ? "two" : "one"));
      }
      break;
    case WM_PAINT: {
      PAINTSTRUCT paint;
      HDC context = ::BeginPaint(window, &paint);
      RECT client = {};
      ::GetClientRect(window, &client);
      HBRUSH back = ::CreateSolidBrush(RGB(232, 226, 250));
      ::FillRect(context, &client, back);
      ::DeleteObject(back);
      RECT side = {0, 0, kPageLeft - kPageMargin, client.bottom};
      HBRUSH bar = ::CreateSolidBrush(RGB(120, 96, 200));
      ::FillRect(context, &side, bar);
      ::DeleteObject(bar);
      ::EndPaint(window, &paint);
      return 0;
    }
    case WM_CLOSE:
      if (g_engine) {
        Call("reply quit", "app.quit", "{}");
      }
      return 0;
  }
  return ::DefWindowProcW(window, message, w_param, l_param);
}

}

extern "C" __declspec(dllexport) int ArdiaAppStart(const ArdiaEngineApi* engine) {
  std::string log_path = Environment("ARDIA_PROBE_LOG", "");
  if (!log_path.empty()) {
    fopen_s(&g_log, log_path.c_str(), "w");
  }
  if (!engine || engine->version != ARDIA_ENGINE_API_VERSION ||
      engine->size < sizeof(ArdiaEngineApi)) {
    Log("start", "the engine's API does not match");
    return 1;
  }
  g_engine = engine;
  g_first_url = Environment("ARDIA_PROBE_URL", g_first_url);
  g_second_url = Environment("ARDIA_PROBE_URL_2", g_second_url);
  g_download_url = Environment("ARDIA_PROBE_DOWNLOAD_URL", "");
  g_cookie_url = Environment("ARDIA_PROBE_COOKIE_URL", "");
  g_slow_download_url = Environment("ARDIA_PROBE_SLOW_DOWNLOAD_URL", "");
  g_files_dir = Environment("ARDIA_PROBE_DIR", Environment("TEMP", "C:"));
  g_step_ms = atoi(Environment("ARDIA_PROBE_STEP_MS", "4000").c_str());
  HINSTANCE instance = ::GetModuleHandleW(nullptr);
  WNDCLASSEXW window_class = {};
  window_class.cbSize = sizeof(window_class);
  window_class.lpfnWndProc = &WindowProcedure;
  window_class.hInstance = instance;
  window_class.hCursor = ::LoadCursorW(nullptr, IDC_ARROW);
  window_class.lpszClassName = kWindowClass;
  ::RegisterClassExW(&window_class);
  g_window = ::CreateWindowExW(0, kWindowClass, L"Ardia engine probe",
                               WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, 80, 60,
                               1100, 760, nullptr, nullptr, instance, nullptr);
  if (!g_window) {
    Log("start", "no window");
    return 2;
  }
  engine->setEventSink(&OnEvent, nullptr);
  ::ShowWindow(g_window, SW_SHOWNOACTIVATE);
  ::SetTimer(g_window, kStepTimer, static_cast<UINT>(g_step_ms), nullptr);
  Log("start", "ok");
  return 0;
}

extern "C" __declspec(dllexport) int ArdiaAppPreTranslateMessage(
    const void* message) {
  return 0;
}

extern "C" __declspec(dllexport) void ArdiaAppStop(void) {
  Log("stop", "");
  if (g_engine) {
    g_engine->setEventSink(nullptr, nullptr);
  }
  if (g_log) {
    fclose(g_log);
    g_log = nullptr;
  }
}
