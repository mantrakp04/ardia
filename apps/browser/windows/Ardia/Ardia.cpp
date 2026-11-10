#include "pch.h"

#include "AutolinkedNativeModules.g.h"

#include "NativeModules.h"

#include "AppModule.h"
#include "LaunchLog.h"
#include "LoggedErrors.h"
#include "WindowsHostModule.h"

struct AppPackageProvider : winrt::implements<AppPackageProvider, winrt::Microsoft::ReactNative::IReactPackageProvider> {
  void CreatePackage(winrt::Microsoft::ReactNative::IReactPackageBuilder const &packageBuilder) noexcept {
    AddAttributedModules(packageBuilder, true);
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

  auto app{winrt::Microsoft::ReactNative::ReactNativeAppBuilder().Build()};

  auto settings{app.ReactNativeHost().InstanceSettings()};
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

  auto window{app.AppWindow()};
  window.Title(L"Ardia");
  window.Resize({1280, 800});

  app.ReactViewOptions().ComponentName(L"main");

  app.Start();
  return 0;
}
