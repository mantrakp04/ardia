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

std::string ShowArgs(const char* key) {
  RECT client = {};
  ::GetClientRect(g_window, &client);
  char args[256];
  snprintf(args, sizeof(args),
           "{\"key\":\"%s\",\"visible\":true,\"x\":%d,\"y\":%d,\"width\":%d,"
           "\"height\":%d}",
           key, kPageLeft, kPageTop,
           static_cast<int>(client.right) - kPageLeft - kPageMargin,
           static_cast<int>(client.bottom) - kPageTop - kPageMargin);
  return args;
}

std::string CreateArgs(const char* key, const std::string& url) {
  return std::string("{\"key\":\"") + key + "\",\"profile\":\"\",\"url\":\"" +
         url + "\"}";
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
      break;
    case 4:
      Call("reply back", "tab.call", "{\"key\":\"one\",\"method\":\"goBack\"}");
      Call("reply close two", "tab.close", "{\"key\":\"two\"}");
      break;
    case 5:
      Call("reply list", "tabs.list", "{}");
      Call("reply hide one", "tab.show", "{\"key\":\"one\",\"visible\":false}");
      break;
    case 6:
      Call("reply show one last", "tab.show", ShowArgs("one"));
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
