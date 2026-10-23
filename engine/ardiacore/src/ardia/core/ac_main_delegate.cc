#include "ardia/core/ac_main_delegate.h"

#include <algorithm>
#include <cstdlib>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

#include "base/base_switches.h"
#include "base/command_line.h"
#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/run_loop.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/browser_process_impl.h"
#include "chrome/browser/chrome_browser_main.h"
#include "chrome/browser/chrome_browser_main_extra_parts.h"
#include "chrome/browser/ardia/ac_scripts_policy.h"  // nogncheck
#include "chrome/browser/chrome_content_browser_client.h"
#include "chrome/common/chrome_paths.h"
#include "chrome/common/chrome_paths_internal.h"
#include "chrome/common/chrome_switches.h"
#include "chrome/common/profiler/main_thread_stack_sampling_profiler.h"
#include "components/component_updater/component_updater_paths.h"
#include "components/keep_alive_registry/keep_alive_types.h"
#include "components/keep_alive_registry/scoped_keep_alive.h"
#include "components/os_crypt/common/os_crypt_switches.h"
#include "content/public/browser/browser_context.h"
#include "content/public/browser/browser_main_parts.h"
#include "content/public/common/content_switches.h"
#include "extensions/common/switches.h"
#include "third_party/blink/public/common/switches.h"
#include "content/public/common/result_codes.h"
#include "services/cert_verifier/public/mojom/cert_verifier_service_factory.mojom.h"
#include "ardia/core/ac_video_upscaler.h"
#include "services/network/public/mojom/network_context.mojom.h"
#include "ardia/core/ac_content_hooks.h"
#include "ardia/core/ac_hooks.h"
#include "ardia/core/ac_lifetime.h"
#include "ardia/core/ac_context_menu.h"
#include "ardia/core/ac_navigation_hold.h"
#include "ardia/core/ac_page_channel.h"
#include "ardia/core/ac_safe_storage.h"
#include "ardia/core/ac_seams.h"
#include "ardia/core/ac_strings.h"
#include "content/public/browser/web_contents_view_delegate.h"
#include "ardia/core/renderer/ac_content_renderer_client.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"

namespace ardiacore {

namespace {

EngineCallbacks& Callbacks() {
  static base::NoDestructor<EngineCallbacks> callbacks;
  return *callbacks;
}

bool g_browser_started = false;

constexpr char kBundledContentBlockerId[] = "fajbdaomknpkicfjcpipdmcpoamdmilh";

bool IsBundledComponentExtension(const extensions::ExtensionId& extension_id) {
  return extension_id == kBundledContentBlockerId;
}

constexpr const char* kSwitchesThatOpenTheProfile[] = {
    "allow-insecure-localhost",
    "auto-open-devtools-for-tabs",
    "custom-devtools-frontend",
    "devtools-flags",
    "disable-extensions-except",
    "disable-web-security",
    "enable-automation",
    "enable-ui-devtools",
    "extensions-on-chrome-urls",
    "extensions-on-extension-urls",
    "host-resolver-rules",
    "host-rules",
    "ignore-certificate-errors",
    "ignore-certificate-errors-spki-list",
    "load-apps",
    "load-extension",
    "log-net-log",
    "net-log-capture-mode",
    "proxy-pac-url",
    "proxy-server",
    "remote-allow-origins",
    "remote-debugging-address",
    "remote-debugging-io-pipes",
    "remote-debugging-pipe",
    "remote-debugging-port",
    "remote-debugging-socket-name",
    "remote-debugging-targets",
    "silent-debugger-extension-api",
    "ssl-key-log-file",
    "unsafely-treat-insecure-origin-as-secure",
    "webtransport-developer-mode",
};

constexpr const char* kEnvironmentThatOpensTheProfile[] = {
    "SSLKEYLOGFILE",
};

void RemoveSwitchesThatOpenTheProfile(base::CommandLine* command_line) {
  for (const char* name : kSwitchesThatOpenTheProfile) {
    command_line->RemoveSwitch(name);
  }
}

std::string EnvironmentThatOpensTheProfile(base::Environment& env) {
  std::string set;
  for (const char* name : kEnvironmentThatOpensTheProfile) {
    if (env.HasVar(std::string(name))) {
      set += std::string(set.empty() ? "" : " ") + name;
    }
  }
  return set.empty() ? "none" : set;
}

void KeepRealProfileClosed(base::CommandLine* command_line,
                           std::string_view stage) {
  const bool mock_keychain =
      command_line->HasSwitch(os_crypt::switches::kUseMockKeychain) &&
      !command_line->HasSwitch("ardia-apply-profile-gate");
  std::unique_ptr<base::Environment> env = base::Environment::Create();
  if (command_line->HasSwitch("ardia-show-profile-gate")) {
    base::CommandLine closed(*command_line);
    RemoveSwitchesThatOpenTheProfile(&closed);
    LOG(ERROR) << "[ardiacore] profile gate " << stage << " (applies here: "
               << (mock_keychain ? "no" : "yes") << ")\n  parsed: "
               << command_line->GetCommandLineString()
               << "\n  closed: " << closed.GetCommandLineString()
               << "\n  environment it unsets: "
               << EnvironmentThatOpensTheProfile(*env);
  }
  if (!mock_keychain) {
    RemoveSwitchesThatOpenTheProfile(command_line);
    for (const char* name : kEnvironmentThatOpensTheProfile) {
      env->UnSetVar(std::string(name));
    }
  }
}

std::unique_ptr<ScopedKeepAlive>& AppKeepAlive() {
  static base::NoDestructor<std::unique_ptr<ScopedKeepAlive>> keep_alive;
  return *keep_alive;
}

class ACBrowserMainExtraParts : public ChromeBrowserMainExtraParts {
 public:
  void PreBrowserStart() override {
    AppKeepAlive() = std::make_unique<ScopedKeepAlive>(
        KeepAliveOrigin::APP_CONTROLLER, KeepAliveRestartOption::DISABLED);
    StartLifetimeObservers();
  }
  void PostBrowserStart() override {
    g_browser_started = true;
    if (Callbacks().started) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, std::move(Callbacks().started));
    }
  }
  void PostMainMessageLoopRun() override {
    if (Callbacks().shutting_down) {
      std::move(Callbacks().shutting_down).Run();
    }
  }
};

class ACBrowserMainParts : public content::BrowserMainParts {
 public:
  explicit ACBrowserMainParts(std::unique_ptr<content::BrowserMainParts> chrome)
      : chrome_(std::move(chrome)) {}

  int PreEarlyInitialization() override {
    return chrome_->PreEarlyInitialization();
  }
  void PostEarlyInitialization() override {
    chrome_->PostEarlyInitialization();
  }
  void ToolkitInitialized() override { chrome_->ToolkitInitialized(); }
  void PreCreateMainMessageLoop() override {
    chrome_->PreCreateMainMessageLoop();
  }
  void PostCreateMainMessageLoop() override {
    chrome_->PostCreateMainMessageLoop();
  }
  int PreCreateThreads() override { return chrome_->PreCreateThreads(); }
  int PostCreateThreads() override { return chrome_->PostCreateThreads(); }
  int PreMainMessageLoopRun() override {
    result_ = chrome_->PreMainMessageLoopRun();
    return result_;
  }
  bool ShouldInterceptMainMessageLoopRun() override {
    return result_ == content::RESULT_CODE_NORMAL_EXIT && g_browser_started;
  }
  void WillRunMainMessageLoop(std::unique_ptr<base::RunLoop>& run_loop) override {
    chrome_->WillRunMainMessageLoop(run_loop);
    if (!run_loop) {
      run_loop = std::make_unique<base::RunLoop>();
      static_cast<BrowserProcessImpl*>(g_browser_process)
          ->SetQuitClosure(run_loop->QuitWhenIdleClosure());
    }
  }
  void OnFirstIdle() override { chrome_->OnFirstIdle(); }
  void PostMainMessageLoopRun() override { chrome_->PostMainMessageLoopRun(); }
  void PostDestroyThreads() override { chrome_->PostDestroyThreads(); }

 private:
  std::unique_ptr<content::BrowserMainParts> chrome_;
  int result_ = content::RESULT_CODE_NORMAL_EXIT;
};

class ACContentBrowserClient : public ChromeContentBrowserClient {
 public:
  void RenderProcessWillLaunch(content::RenderProcessHost* host) override {
    ChromeContentBrowserClient::RenderProcessWillLaunch(host);
    SendPageScript(host);
  }
  void RegisterAssociatedInterfaceBindersForRenderFrameHost(
      content::RenderFrameHost& render_frame_host,
      blink::AssociatedInterfaceRegistry& associated_registry) override {
    ChromeContentBrowserClient::
        RegisterAssociatedInterfaceBindersForRenderFrameHost(
            render_frame_host, associated_registry);
    RegisterPageChannelBinders(render_frame_host, associated_registry);
  }
  std::unique_ptr<content::WebContentsViewDelegate> GetWebContentsViewDelegate(
      content::WebContents* web_contents) override {
    return CreateViewDelegate(web_contents);
  }
  void CreateThrottlesForNavigation(
      content::NavigationThrottleRegistry& registry) override {
    ChromeContentBrowserClient::CreateThrottlesForNavigation(registry);
    AddAppSchemeThrottle(registry);
    MaybeAddNavigationHoldThrottle(registry);
    ardia::AddScriptsPagesThrottle(registry);
  }
  std::optional<base::TimeDelta> GetSpareRendererDelayForSiteURL(
      const GURL& site_url) override {
    std::optional<base::TimeDelta> delay =
        ChromeContentBrowserClient::GetSpareRendererDelayForSiteURL(site_url);
    return delay ? delay : std::optional<base::TimeDelta>(base::Milliseconds(500));
  }

  void ConfigureNetworkContextParams(
      content::BrowserContext* context,
      bool in_memory,
      const base::FilePath& relative_partition_path,
      network::mojom::NetworkContextParams* network_context_params,
      cert_verifier::mojom::CertVerifierCreationParams*
          cert_verifier_creation_params) override {
    ChromeContentBrowserClient::ConfigureNetworkContextParams(
        context, in_memory, relative_partition_path, network_context_params,
        cert_verifier_creation_params);
    if (!in_memory && relative_partition_path.empty() &&
        !context->IsOffTheRecord()) {
      network_context_params->restore_old_session_cookies = true;
      network_context_params->persist_session_cookies = true;
    }
  }

  std::unique_ptr<content::BrowserMainParts> CreateBrowserMainParts(
      bool is_integration_test) override {
    std::unique_ptr<content::BrowserMainParts> chrome =
        ChromeContentBrowserClient::CreateBrowserMainParts(is_integration_test);
    static_cast<ChromeBrowserMainParts*>(chrome.get())
        ->AddParts(std::make_unique<ACBrowserMainExtraParts>());
    return std::make_unique<ACBrowserMainParts>(std::move(chrome));
  }
};

}

void SetEngineCallbacks(EngineCallbacks callbacks) {
  Callbacks() = std::move(callbacks);
}

void ReleaseAppKeepAlive() {
  AppKeepAlive().reset();
}

ACMainDelegate::ACMainDelegate(const StartupTimestamps& timestamps)
    : ChromeMainDelegate(timestamps) {
  g_ardia_embedder = true;
  g_ardia_restricted_component_extension = &IsBundledComponentExtension;
  g_ardia_resource_bundle_delegate = ProductStrings();
}

ACMainDelegate::~ACMainDelegate() = default;

namespace {

void KeepMemoryReducer(base::CommandLine* command_line) {
  const std::string flags = command_line->GetSwitchValueASCII(blink::switches::kJavaScriptFlags);
  std::vector<std::string> kept;
  bool dropped = false;
  for (const std::string& flag :
       base::SplitString(flags, " ,", base::TRIM_WHITESPACE, base::SPLIT_WANT_NONEMPTY)) {
    if (flag == "--no-memory-reducer" || flag == "--no_memory_reducer") {
      dropped = true;
    } else {
      kept.push_back(flag);
    }
  }
  if (!dropped) {
    return;
  }
  command_line->RemoveSwitch(blink::switches::kJavaScriptFlags);
  if (!kept.empty()) {
    command_line->AppendSwitchASCII(blink::switches::kJavaScriptFlags, base::JoinString(kept, " "));
  }
}

bool EnvIs(const char* name, std::string_view value) {
  const char* set = getenv(name);
  return set && value == set;
}

void MergeFeatures(base::CommandLine* command_line, const char* list, std::string_view features) {
  const std::string current = command_line->GetSwitchValueASCII(list);
  command_line->RemoveSwitch(list);
  command_line->AppendSwitchASCII(list, current.empty() ? std::string(features)
                                                        : current + "," + std::string(features));
}

void QuietIdleTimers(base::CommandLine* command_line) {
  if (!EnvIs("ARDIA_PA_RECLAIM", "fixed")) {
    MergeFeatures(command_line, switches::kEnableFeatures, "PartitionAllocAdaptiveMemoryReclaimInterval");
  }
  if (EnvIs("ARDIA_HANG_WATCHER", "off")) {
    MergeFeatures(command_line, switches::kDisableFeatures, "EnableHangWatcher,EnableHangWatcherOnGpuProcess");
  }
  g_ardia_skip_cpu_health_sampling = !EnvIs("ARDIA_CPU_HEALTH_SAMPLING", "on");
  int disk_check_seconds = 60;
  if (const char* set = getenv("ARDIA_DISK_CHECK_SECONDS");
      set && !base::StringToInt(set, &disk_check_seconds)) {
    disk_check_seconds = 0;
  }
  g_ardia_disk_space_check_seconds = std::clamp(disk_check_seconds, 0, 3600);
  g_ardia_lazy_storage_usage = !EnvIs("ARDIA_LAZY_STORAGE_USAGE", "off");
  g_ardia_script_loader_ready_at_once = !EnvIs("ARDIA_SCRIPT_LOADER_AT_ONCE", "off");
  g_ardia_scripts_wait_at_response = !EnvIs("ARDIA_SCRIPTS_WAIT_AT_RESPONSE", "off");
  g_ardia_bluetooth_poll_on_demand = !EnvIs("ARDIA_BLUETOOTH_POLL_ON_DEMAND", "off");
  g_ardia_hybrid_scan_on_demand = !EnvIs("ARDIA_HYBRID_SCAN_ON_DEMAND", "off");
}

}

std::optional<int> ACMainDelegate::BasicStartupComplete() {
  base::CommandLine* command_line = base::CommandLine::ForCurrentProcess();
  g_ardia_begin_frame_bridge = EnvIs("ARDIA_BEGIN_FRAME_BRIDGE", "on");
  if (!command_line->HasSwitch(switches::kProcessType)) {
    KeepRealProfileClosed(command_line, "at startup");
    GuardSafeStorageKey(*command_line);
    command_line->AppendSwitch(switches::kNoStartupWindow);
    command_line->AppendSwitch(switches::kNoFirstRun);
    command_line->AppendSwitch(switches::kNoDefaultBrowserCheck);
    command_line->RemoveSwitch(switches::kMakeDefaultBrowser);
    QuietIdleTimers(command_line);
  }
  if (command_line->HasSwitch(extensions::switches::kExtensionProcess)) {
    KeepMemoryReducer(command_line);
  }
  return ChromeMainDelegate::BasicStartupComplete();
}

std::optional<int> ACMainDelegate::PostEarlyInitialization(
    InvokedIn invoked_in) {
  std::optional<int> exit_code =
      ChromeMainDelegate::PostEarlyInitialization(invoked_in);
  if (std::holds_alternative<InvokedInBrowserProcess>(invoked_in)) {
    KeepRealProfileClosed(base::CommandLine::ForCurrentProcess(),
                          "after chrome://flags");
  }
  return exit_code;
}

void ACMainDelegate::PreSandboxStartup() {
  const base::CommandLine& command_line =
      *base::CommandLine::ForCurrentProcess();
  const std::string process_type =
      command_line.GetSwitchValueASCII(switches::kProcessType);
  if (chrome::ProcessNeedsProfileDir(process_type)) {
    base::FilePath dir = command_line.GetSwitchValuePath(switches::kUserDataDir);
    if (dir.empty() && !process_type.empty()) {
      base::FilePath scratch;
      if (base::GetTempDir(&scratch)) {
        base::PathService::OverrideAndCreateIfNeeded(
            chrome::DIR_USER_DATA, scratch.Append("ardiacore-helper"),
            true, false);
      }
      ChromeMainDelegate::PreSandboxStartup();
      return;
    }
    CHECK(!dir.empty()) << "ArdiaCore needs --user-data-dir";
    CHECK(base::CreateDirectory(dir));
    dir = base::MakeAbsoluteFilePath(dir);
    CHECK(base::PathService::OverrideAndCreateIfNeeded(
        chrome::DIR_USER_DATA, dir, true, false));
    base::PathService::Override(chrome::DIR_CRASH_DUMPS,
                                dir.Append(FILE_PATH_LITERAL("Crashpad")));
    component_updater::RegisterPathProvider(chrome::DIR_COMPONENTS,
                                            chrome::DIR_USER_DATA);
  }
  if (process_type == switches::kGpuProcess) {
    g_ardia_create_video_upscaler = &ardiacore::CreateVideoUpscaler;
  }
  if (process_type.empty()) {
    InstallAppOverrides();
    InstallChromeHooks();
  }
  ChromeMainDelegate::PreSandboxStartup();
}

content::ContentRendererClient* ACMainDelegate::CreateContentRendererClient() {
  static base::NoDestructor<ACContentRendererClient> client;
  return client.get();
}

content::ContentBrowserClient* ACMainDelegate::CreateContentBrowserClient() {
  chrome_content_browser_client_ = std::make_unique<ACContentBrowserClient>();
  if (sampling_profiler_) {
    chrome_content_browser_client_->SetSamplingProfiler(
        std::move(sampling_profiler_));
  }
  return chrome_content_browser_client_.get();
}

}
