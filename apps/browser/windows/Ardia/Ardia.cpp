#include "pch.h"

#include "AutolinkedNativeModules.g.h"

#include "NativeModules.h"

#include "Host.h"
#include "LaunchLog.h"
#include "LoggedErrors.h"
#include "Modules.h"
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

_Use_decl_annotations_ int CALLBACK WinMain(HINSTANCE, HINSTANCE, PSTR, int) {
  winrt::init_apartment(winrt::apartment_type::single_threaded);
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

  Ardia::LaunchLog::OpenFromCommandLine();
  Ardia::LaunchLog::Write(L"launch", L"process started");

  WCHAR appDirectory[MAX_PATH];
  GetModuleFileNameW(NULL, appDirectory, MAX_PATH);
  PathCchRemoveFileSpec(appDirectory, MAX_PATH);

  Ardia::Host host;
  Ardia::Host::Current() = &host;
  host.queue = winrt::Microsoft::UI::Dispatching::DispatcherQueueController::CreateOnCurrentThread();

  auto settings{host.reactHost.InstanceSettings()};
  settings.Properties().Set(
      winrt::Microsoft::ReactNative::ReactDispatcherHelper::UIDispatcherProperty(),
      winrt::Microsoft::ReactNative::ReactDispatcherHelper::UIThreadDispatcher());
  host.compositor = winrt::Microsoft::UI::Composition::Compositor();
  winrt::Microsoft::ReactNative::Composition::CompositionUIService::SetCompositor(settings, host.compositor);

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
  host.reactHost.ReloadInstance();
  Ardia::LaunchLog::Write(L"launch", L"instance loading");

  host.queue.DispatcherQueue().RunEventLoop();
  host.queue.ShutdownQueue();
  Ardia::LaunchLog::Write(L"launch", L"process ending");
  return 0;
}
