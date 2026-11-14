#include "pch.h"

#include "AutolinkedNativeModules.g.h"

#include "NativeModules.h"

#include <type_traits>

#include "AppIcon.h"
#include "AppImage.h"
#include "CrashLog.h"
#include "EngineApi.h"
#include "Host.h"
#include "LaunchLog.h"
#include "LoggedErrors.h"
#include "Modules.h"
#include "PointerLatch.h"
#include "WindowManager.h"

#pragma comment(linker, "\"/manifestdependency:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\"")

struct AppPackageProvider : winrt::implements<AppPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
    Ardia::RegisterViews(packageBuilder);
  }
};

static std::wstring_view LogLevelName(winrt::Microsoft::ReactNative::LogLevel level) noexcept {
  switch (level) {
    case winrt::Microsoft::ReactNative::LogLevel::Trace:
      return L"trace";
    case winrt::Microsoft::ReactNative::LogLevel::Info:
      return L"info";
    case winrt::Microsoft::ReactNative::LogLevel::Warning:
      return L"warning";
    case winrt::Microsoft::ReactNative::LogLevel::Error:
      return L"error";
    case winrt::Microsoft::ReactNative::LogLevel::Fatal:
      return L"fatal";
  }
  return L"log";
}

static constexpr int kNoApartment = 10;
static constexpr int kEngineMismatch = 11;
static constexpr int kAlreadyStarted = 12;
static constexpr int kSetupFailed = 13;

using PreTranslateMessage = BOOL(__stdcall *)(const MSG *);

static bool &EngineLoopRunning() noexcept {
  static bool running = false;
  return running;
}

static PreTranslateMessage &ContentPreTranslate() noexcept {
  static PreTranslateMessage preTranslate = nullptr;
  return preTranslate;
}

static PreTranslateMessage FindContentPreTranslate() noexcept {
  HMODULE windowing = GetModuleHandleW(L"Microsoft.UI.Windowing.Core.dll");
  if (!windowing) {
    const std::wstring path = Ardia::AppImage::Directory().append(L"\\Microsoft.UI.Windowing.Core.dll");
    windowing = LoadLibraryExW(path.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
  }
  if (!windowing) return nullptr;
  return reinterpret_cast<PreTranslateMessage>(reinterpret_cast<void *>(GetProcAddress(windowing, "ContentPreTranslateMessage")));
}

static bool EnterApartment() noexcept {
  try {
    winrt::init_apartment(winrt::apartment_type::single_threaded);
    return true;
  } catch (...) {
    return false;
  }
}

static int Refuse(int code, std::wstring const &why) noexcept {
  Ardia::LaunchLog::OpenFromCommandLine();
  Ardia::LaunchLog::Write(L"error", why);
  OutputDebugStringW(std::wstring(L"Ardia: ").append(why).append(L"\n").c_str());
  return code;
}

static int Prepare(const ArdiaEngineApi *engine) {
  const bool apartment = EnterApartment();
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  Ardia::LaunchLog::OpenFromCommandLine();
  Ardia::LaunchLog::Write(L"launch", engine ? L"process started inside the engine" : L"process started");
  if (!apartment) return Refuse(kNoApartment, L"the UI thread is not a single-threaded apartment");
  Ardia::CrashLog::Install();
  Ardia::PointerLatch::Install();

  const std::wstring appDirectory = Ardia::AppImage::Directory();

  auto *host = new Ardia::Host();
  Ardia::Host::Current() = host;
  host->engine = engine;
  host->queue = winrt::Microsoft::UI::Dispatching::DispatcherQueueController::CreateOnCurrentThread();
  Ardia::AppIcon::ClaimAppUserModelId();
  Ardia::NotificationParts::NotificationHub::Shared().Install();

  auto settings{host->reactHost.InstanceSettings()};
  settings.Properties().Set(
      winrt::Microsoft::ReactNative::ReactDispatcherHelper::UIDispatcherProperty(),
      winrt::Microsoft::ReactNative::ReactDispatcherHelper::UIThreadDispatcher());
  host->compositor = winrt::Microsoft::UI::Composition::Compositor();
  winrt::Microsoft::ReactNative::Composition::CompositionUIService::SetCompositor(settings, host->compositor);

  RegisterAutolinkedNativeModulePackages(settings.PackageProviders());
  settings.PackageProviders().Append(winrt::make<AppPackageProvider>());
  settings.NativeLogger([](winrt::Microsoft::ReactNative::LogLevel level, winrt::hstring const &message) noexcept {
    Ardia::LaunchLog::Write(LogLevelName(level), message);
  });
  settings.RedBoxHandler(winrt::make<Ardia::LoggedErrors>());

  settings.BundleRootPath(std::wstring(L"file://").append(appDirectory).append(L"\\Bundle\\").c_str());
  settings.JavaScriptBundleFile(L"index.windows");
  settings.DebugBundlePath(L"index");

#if BUNDLE
  settings.UseFastRefresh(false);
#else
  settings.UseFastRefresh(true);
#endif
#if _DEBUG
  settings.UseDirectDebugger(true);
  settings.UseDeveloperSupport(true);
#else
  settings.UseDirectDebugger(false);
  settings.UseDeveloperSupport(false);
#endif

  Ardia::WindowManager::Shared().Prewarm();
  host->reactHost.ReloadInstance();
  Ardia::LaunchLog::Write(L"launch", L"instance loading");
  return 0;
}

static void ShutDown(Ardia::Host &host) {
  host.engine = nullptr;
  SetFocus(nullptr);
  if (host.queue) host.queue.ShutdownQueue();
  Ardia::LaunchLog::Write(L"launch", L"process ending");
}

extern "C" {

__declspec(dllexport) int ArdiaAppRun(void) {
  if (Ardia::Host::Current()) return Refuse(kAlreadyStarted, L"the app is already running in this process");
  const int prepared = Prepare(nullptr);
  if (prepared != 0) return prepared;
  Ardia::Host *host = Ardia::Host::Current();
  host->queue.DispatcherQueue().RunEventLoop();
  ShutDown(*host);
  Ardia::Host::Current() = nullptr;
  delete host;
  return 0;
}

__declspec(dllexport) int ArdiaAppStart(const ArdiaEngineApi *engine) {
  if (Ardia::Host::Current()) return Refuse(kAlreadyStarted, L"the app is already running in this process");
  if (!engine) return Refuse(kEngineMismatch, L"the engine gave no API table");
  if (engine->version != ARDIA_ENGINE_API_VERSION || engine->size < sizeof(ArdiaEngineApi)) {
    return Refuse(
        kEngineMismatch,
        std::wstring(L"the engine API is version ")
            .append(std::to_wstring(engine->version))
            .append(L" with ")
            .append(std::to_wstring(engine->size))
            .append(L" bytes, and this app needs version ")
            .append(std::to_wstring(ARDIA_ENGINE_API_VERSION))
            .append(L" with at least ")
            .append(std::to_wstring(sizeof(ArdiaEngineApi)))
            .append(L" bytes"));
  }
  if (!engine->setEventSink || !engine->hostCall || !engine->engineCall) return Refuse(kEngineMismatch, L"the engine API table has an empty entry");
  try {
    const int prepared = Prepare(engine);
    if (prepared != 0) return prepared;
  } catch (winrt::hresult_error const &error) {
    if (Ardia::Host *host = Ardia::Host::Current()) host->engine = nullptr;
    return Refuse(kSetupFailed, std::wstring(L"the app could not start inside the engine: ").append(std::wstring_view{error.message()}));
  } catch (...) {
    if (Ardia::Host *host = Ardia::Host::Current()) host->engine = nullptr;
    return Refuse(kSetupFailed, L"the app could not start inside the engine");
  }
  ContentPreTranslate() = FindContentPreTranslate();
  if (!ContentPreTranslate()) Ardia::LaunchLog::Write(L"error", L"ContentPreTranslateMessage was not found, so keys reach the UI untranslated");
  EngineLoopRunning() = true;
  return 0;
}

__declspec(dllexport) int ArdiaAppPreTranslateMessage(const void *message) {
  const PreTranslateMessage preTranslate = ContentPreTranslate();
  if (!message || !preTranslate || !EngineLoopRunning()) return 0;
  return preTranslate(static_cast<const MSG *>(message)) ? 1 : 0;
}

__declspec(dllexport) void ArdiaAppStop(void) {
  Ardia::DialogParts::StopAllModals();
  if (!EngineLoopRunning()) return;
  EngineLoopRunning() = false;
  Ardia::Host *host = Ardia::Host::Current();
  if (!host) return;
  Ardia::EngineHostParts::Detach();
  try {
    ShutDown(*host);
  } catch (...) {
    Ardia::LaunchLog::Write(L"error", L"the UI queue did not shut down cleanly");
  }
}

}

static_assert(std::is_same_v<decltype(&ArdiaAppRun), ArdiaAppRunFunction>);
static_assert(std::is_same_v<decltype(&ArdiaAppStart), ArdiaAppStartFunction>);
static_assert(std::is_same_v<decltype(&ArdiaAppPreTranslateMessage), ArdiaAppPreTranslateFunction>);
static_assert(std::is_same_v<decltype(&ArdiaAppStop), ArdiaAppStopFunction>);

BOOL APIENTRY DllMain(HMODULE image, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) Ardia::AppImage::Handle() = image;
  return TRUE;
}
