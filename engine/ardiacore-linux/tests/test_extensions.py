import json
import pathlib
import re
import tempfile
import unittest

from chromium_series import applied
from test_downloads import compile_and_run
from test_renderer_contract import method
from test_session_merge import VALUES

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
LINUX = ROOT / 'src/ardia/linux'
FIXTURES = ROOT / 'tests/fixtures'

EXTENDED = VALUES.replace('#include <map>', '#include <map>\n#include <optional>', 1).replace(
    '''  const std::string* FindString(std::string_view key) const {
    auto* value = Find(key); return value && value->is_string() ? &value->GetString() : nullptr;
  }''', '''  const std::string* FindString(std::string_view key) const {
    auto* value = Find(key); return value && value->is_string() ? &value->GetString() : nullptr;
  }
  std::optional<double> FindDouble(std::string_view key) const {
    auto* value = Find(key); return value && (value->is_double() || value->is_int()) ? std::optional<double>(value->GetDouble()) : std::nullopt;
  }
  std::optional<int> FindInt(std::string_view key) const {
    auto* value = Find(key); return value && value->is_int() ? std::optional<int>(value->GetInt()) : std::nullopt;
  }
  std::optional<bool> FindBool(std::string_view key) const {
    auto* value = Find(key); return value && value->is_bool() ? std::optional<bool>(value->GetBool()) : std::nullopt;
  }
  Value* Set(std::string_view key, bool value) & { return Set(key, Value(value)); }
  DictValue&& Set(std::string_view key, bool value) && { Set(key, Value(value)); return std::move(*this); }
  Value* Set(std::string_view key, int value) & { return Set(key, Value(value)); }
  DictValue&& Set(std::string_view key, int value) && { Set(key, Value(value)); return std::move(*this); }
  Value* Set(std::string_view key, const char* value) & { return Set(key, Value(value)); }
  DictValue&& Set(std::string_view key, const char* value) && { Set(key, Value(value)); return std::move(*this); }''')


def stub_tree(root, names, include):
    for name in names:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f'#include "{include}"\n')


class ExtensionHelperTests(unittest.TestCase):
    def test_requests_manifests_listing_changes_prompts_and_surface_books(self):
        with tempfile.TemporaryDirectory(prefix='ardia-extensions-') as directory:
            root = pathlib.Path(directory)
            (root / 'base').mkdir()
            (root / 'base/values.h').write_text(VALUES)
            output = compile_and_run(self, 'extensions', [LINUX / 'ac_linux_extensions.cc', FIXTURES / 'extensions_scenarios.cc'],
                                     extra_includes=[root])
        self.assertIn('extensions scenarios passed', output)
        native = re.findall(r'^capability (\S+)$', output, re.M)
        script = (REPO / 'apps/linux/src/hostExtensionView.ts').read_text()
        self.assertEqual(sorted(native), sorted(set(re.findall(r'"(extensionView\.\w+)"', script))))
        self.assertEqual(len(native), 4)


class ExtensionSurfaceTests(unittest.TestCase):
    def test_popup_and_side_panel_hosts_follow_page_chrome_renderer_and_window_lifetimes(self):
        service = (LINUX / 'ac_linux_extension_service.cc').read_text()
        profile = method(service, 'Profile* LinuxExtensionViewProfile(')
        with tempfile.TemporaryDirectory(prefix='ardia-extension-views-') as directory:
            root = pathlib.Path(directory)
            (root / 'base').mkdir()
            (root / 'base/values.h').write_text(EXTENDED)
            stub_tree(root, [
                'base/functional/bind.h', 'base/functional/callback.h', 'base/logging.h', 'base/memory/raw_ptr.h',
                'base/memory/weak_ptr.h', 'base/scoped_observation.h', 'base/task/single_thread_task_runner.h',
                'base/time/time.h', 'base/timer/timer.h', 'chrome/browser/extensions/extension_view.h',
                'chrome/browser/extensions/extension_view_host.h', 'chrome/browser/extensions/extension_view_host_factory.h',
                'chrome/browser/profiles/profile.h', 'chrome/browser/ui/browser_window/public/browser_window_interface.h',
                'chrome/browser/ui/extensions/extension_popup_types.h', 'content/public/browser/render_frame_host.h',
                'content/public/browser/render_widget_host_view.h', 'content/public/browser/web_contents.h',
                'content/public/browser/web_contents_observer.h', 'extensions/browser/extension_host_registry.h',
                'extensions/browser/extension_registry.h', 'extensions/browser/extension_registry_observer.h',
                'extensions/browser/extension_util.h',
                'extensions/common/extension.h', 'ui/gfx/geometry/rect.h', 'ui/gfx/geometry/rect_conversions.h',
                'ui/gfx/geometry/rect_f.h', 'ui/gfx/geometry/size.h', 'ui/gfx/native_ui_types.h',
                'ui/views/controls/webview/webview.h', 'ui/views/view.h', 'url/gurl.h',
            ], 'extension_views_support.h')
            resolver = root / 'profile.cc'
            resolver.write_text('#include "extension_views_support.h"\n#include "ardia/linux/ac_linux_extension_service.h"\n'
                                'namespace ardiacore {\nbool LinuxProfileHosts(std::string_view id, const Profile* profile) { return profile->IsOffTheRecord() ? id == "incognito:w1@" : id.empty() || id == "default"; }\n}\n'
                                'namespace ardia {\n' + profile + '\n}\n')
            output = compile_and_run(self, 'extension-views', [
                LINUX / 'ac_linux_extension_views.cc', LINUX / 'ac_linux_extensions.cc', resolver,
                FIXTURES / 'extension_views_scenarios.cc',
            ], extra_includes=[root, FIXTURES])
        self.assertIn('extension views scenarios passed', output)


SERVICE_PRELUDE = r'''
#include "extension_views_support.h"
#include "ardia/linux/ac_linux_extensions.h"
#include "ardia/linux/ac_linux_profiles.h"
#include "ardia/linux/ac_linux_extension_service.h"
namespace extensions {
struct ExtensionInstallPromptClient {
  enum class Result { ACCEPTED, ACCEPTED_WITH_WITHHELD_PERMISSIONS, USER_CANCELED, ABORTED };
  struct DoneCallbackPayload {
    explicit DoneCallbackPayload(Result value) : result(value) {}
    Result result;
  };
  using DoneCallback = base::OnceCallback<void(DoneCallbackPayload)>;
};
}
namespace ardiacore {
inline std::map<std::string, Profile*> g_profiles;
using LinuxProfileDone = base::OnceCallback<void(Profile*, linux_profiles::ProfileError)>;
inline void ResolveLinuxProfile(std::string_view id, LinuxProfileDone done) {
  auto found = g_profiles.find(std::string(id));
  if (found == g_profiles.end()) return std::move(done).Run(nullptr, linux_profiles::ProfileError::kUnavailable);
  std::move(done).Run(found->second, linux_profiles::ProfileError::kNone);
}
inline std::optional<std::string> LinuxProfileName(const Profile* profile) {
  for (const auto& [name, known] : g_profiles) if (known == profile) return name;
  return std::nullopt;
}
}
namespace ardia {
namespace ext = linux_extensions;
using Done = LinuxExtensionsDone;
using InstallDone = extensions::ExtensionInstallPromptClient::DoneCallback;
using InstallPayload = extensions::ExtensionInstallPromptClient::DoneCallbackPayload;
using InstallResult = extensions::ExtensionInstallPromptClient::Result;
ARDIA_SERVICE
}
'''


class ExtensionServiceTests(unittest.TestCase):
    def test_window_calls_use_the_window_profile_and_prompts_resolve_once_in_their_window(self):
        service = (LINUX / 'ac_linux_extension_service.cc').read_text()
        extracted = '\n'.join([
            method(service, 'void Fail(Done done,'), 'void AbortPromptForDestroyedParent(std::string request);',
            method(service, 'class PromptParentWatch') + ';', method(service, 'struct PendingInstall {') + ';',
            method(service, 'ext::PromptLedger<PendingInstall>& Prompts() {'), method(service, 'void Answer(PendingInstall pending,'),
            method(service, 'LinuxExtensionsDelegate& Delegate() {'),
            method(service, 'void AbortPromptForDestroyedParent(std::string request) {'),
            method(service, 'void Retarget(int window, bool closing) {'),
            method(service, 'std::string ProfileId(const Profile* profile) {'), method(service, 'void ResolvePrompt('),
            method(service, 'content::WebContents* ProfileTab('), method(service, 'void LinuxExtensionsProfile('),
            method(service, 'void CallProfile('),
            method(service, 'void LinuxExtensionsWindowRetired(int window) {'),
            method(service, 'void LinuxExtensionsWindowClosing(int window) {'),
            *[line for line in service.splitlines() if line.startswith('LinuxExtensionWindow') or line.startswith('LinuxExtensionsDelegate::')],
        ])
        with tempfile.TemporaryDirectory(prefix='ardia-extension-service-') as directory:
            root = pathlib.Path(directory)
            (root / 'base').mkdir()
            (root / 'base/values.h').write_text(EXTENDED)
            stub_tree(root, ['base/functional/callback.h', 'ui/gfx/native_ui_types.h'], 'extension_views_support.h')
            source = root / 'service.cc'
            source.write_text(SERVICE_PRELUDE.replace('ARDIA_SERVICE', extracted) + (FIXTURES / 'extension_service_scenarios.cc').read_text())
            output = compile_and_run(self, 'extension-service', [source, LINUX / 'ac_linux_extensions.cc', LINUX / 'ac_linux_profiles.cc'],
                                     extra_includes=[root, FIXTURES])
        self.assertIn('extension service scenarios passed', output)


class ExtensionBroadcastTests(unittest.TestCase):
    def test_extension_changes_reach_windows_of_that_profile_and_settings_windows(self):
        host = (LINUX / 'ac_linux_host.cc').read_text()
        start = host.index('  extensions.broadcast = base::BindRepeating(')
        lambda_text = host[start:host.index('\n  });\n', start) + len('\n  });\n')]
        code = r'''
#include "extension_views_support.h"
#include <cassert>
#include <cstdio>
struct FakeHost {
  Profile* page = nullptr;
  bool utility = false;
  std::vector<std::string> seen;
  Profile* companion = nullptr;
  Profile* page_profile() const { return page; }
  bool ServesProfile(const Profile* profile) const { return profile && (profile == page || profile == companion); }
  bool is_utility() const { return utility; }
  bool ExtensionEvent(std::string_view name, base::DictValue data) {
    seen.push_back(std::string(name) + ":" + *data.FindString("id"));
    return true;
  }
};
std::map<int, FakeHost*>& Hosts() {
  static std::map<int, FakeHost*> hosts;
  return hosts;
}
namespace base {
template <class F> F BindRepeating(F fn) { return fn; }
}
int main() {
  Profile regular, isolated, regular_private, isolated_private;
  regular_private.off_the_record = true;
  regular_private.original = &regular;
  isolated_private.off_the_record = true;
  isolated_private.original = &isolated;
  FakeHost a, b, c, d, e, closed, settings;
  settings.page = &regular;
  settings.utility = true;
  a.page = &regular;
  b.page = &isolated;
  c.page = &regular;
  d.page = &regular_private;
  e.page = &isolated_private;
  Hosts() = {{1, &a}, {2, &b}, {3, &c}, {4, &d}, {5, &e}, {6, &closed}, {7, &settings}};
  struct { base::RepeatingCallback<void(Profile*, std::string_view, base::DictValue)> broadcast; } extensions;
ARDIA_LAMBDA
  extensions.broadcast.Run(&isolated, "extensions.changed", base::DictValue().Set("id", "x"));
  assert(a.seen.empty() && c.seen.empty() && d.seen.empty() && b.seen.size() == 1 && b.seen[0] == "extensions.changed:x");
  assert(e.seen.size() == 1 && e.seen[0] == "extensions.changed:x");
  extensions.broadcast.Run(&regular, "extensions.changed", base::DictValue().Set("id", "y"));
  assert(a.seen.size() == 1 && c.seen.size() == 1 && b.seen.size() == 1 && d.seen.size() == 1 && e.seen.size() == 1);
  extensions.broadcast.Run(&regular_private, "extensions.changed", base::DictValue().Set("id", "z"));
  assert(a.seen.size() == 1 && d.seen.size() == 1 && closed.seen.empty());
  assert(settings.seen.size() == 2 && settings.seen[0] == "extensions.changed:x" && settings.seen[1] == "extensions.changed:y");
  a.companion = &isolated;
  extensions.broadcast.Run(&isolated, "extensions.changed", base::DictValue().Set("id", "v"));
  assert(a.seen.size() == 2 && a.seen[1] == "extensions.changed:v" && c.seen.size() == 1 && b.seen.size() == 2);
  a.companion = nullptr;
  regular.shutdown_started = true;
  extensions.broadcast.Run(&isolated, "extensions.changed", base::DictValue().Set("id", "w"));
  assert(settings.seen.size() == 3 && b.seen.size() == 3);
  std::printf("broadcast scenarios passed\n");
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-extension-broadcast-') as directory:
            root = pathlib.Path(directory)
            (root / 'base').mkdir()
            (root / 'base/values.h').write_text(EXTENDED)
            source = root / 'broadcast.cc'
            source.write_text(code.replace('ARDIA_LAMBDA', lambda_text))
            output = compile_and_run(self, 'extension-broadcast', [source], extra_includes=[root, FIXTURES])
        self.assertIn('broadcast scenarios passed', output)


class ExtensionWiringTests(unittest.TestCase):
    def setUp(self):
        self.host = (LINUX / 'ac_linux_host.cc').read_text()
        self.service = (LINUX / 'ac_linux_extension_service.cc').read_text()

    def test_every_forwarded_management_call_has_an_engine_route(self):
        code = r'''
#include "ardia/linux/ac_linux_contract.h"
#include <cassert>
using namespace ardiacore::linux_contract;
int main() {
  for (auto name : {"extensions.list", "extensions.install", "extensions.installCrx", "extensions.setEnabled",
                    "extensions.uninstall", "extensions.reload", "extensions.configure", "extensions.watchActions",
                    "extensions.syncState", "extensions.syncApply", "search.engines"}) assert(FindRoute(name));
  for (auto name : {"extensions.actionStates", "extensions.sidePanelUrl", "extensions.inspectUnpacked",
                    "extensions.chooseFolder", "extensions.resolveInstallPrompt"}) assert(!FindRoute(name));
  assert(EventName("extensions.action") == "extensions.action" && EventName("extensions.sync") == "extensions.sync");
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-extension-routes-') as directory:
            source = pathlib.Path(directory) / 'routes.cc'
            source.write_text(code)
            compile_and_run(self, 'extension-routes', [source])

    def test_extension_calls_are_claimed_before_the_generic_engine_route_and_profile_gate(self):
        request = method(self.host, '  void Request(const base::ListValue& arguments) {')
        claim = request.index('if (LinuxExtensionsHandles(name))')
        self.assertLess(request.index('ParseProfileName(profile)'), claim)
        self.assertLess(claim, request.index('ardiacore::linux_contract::FindRoute(name)'))
        self.assertNotIn('ExtensionConfiguration', self.host)
        self.assertNotIn('reply->name == "search.engines"', self.host)
        for hook in ['g_ardia_extension_install_prompt = &InstallPromptHook', 'g_ardia_extension_side_panel = &SidePanelHook',
                     'g_ardia_open_action_popup = &ActionPopupHook']:
            self.assertIn(hook, self.service)
        start = method(self.host, 'void StartLinuxHost() {')
        self.assertLess(start.index('StartLinuxExtensions(std::move(extensions));'), start.index('ac_engine_set_event_sink(EngineEvent'))

    def test_reloading_an_unpacked_folder_turns_developer_mode_on_first(self):
        forward = self.service[self.service.index('void Forward(Profile* profile'):self.service.index('struct Inspected {')]
        keep = forward.index('KeepDeveloperModeForReload(profile, name, input);')
        self.assertLess(keep, forward.index('ac_engine_call('))
        helper = self.service[self.service.index('void KeepDeveloperModeForReload('):self.service.index('void Forward(Profile* profile')]
        self.assertIn('ext::ReloadsExtensionFolder(name, input)', helper)
        self.assertIn('extensions::Manifest::IsUnpackedLocation(extension->location())', helper)
        self.assertIn('extensions::util::SetDeveloperModeForProfile(profile, true);', helper)
        engine = (ROOT.parents[0] / 'chromium/src/chrome/browser/ardia/ac_extensions.cc').read_text()
        install = engine[engine.index('AC_PROFILE_CALL(ac_extensions_install)'):engine.index('AC_PROFILE_CALL(ac_extensions_install_crx)')]
        self.assertIn('extensions::util::SetDeveloperModeForProfile(profile, true);', install)

    def test_window_and_renderer_retirement_release_surfaces_and_prompts(self):
        retire = method(self.host, '  void RetireRenderer() {')
        self.assertLess(retire.index('++renderer_generation_;'), retire.index('DetachViewports();'))
        detach = method(self.host, 'void ShellHostView::DetachViewports() {')
        self.assertIn('extension_surfaces_->RetireOlderThan(renderer_generation_)', detach)
        self.assertIn('LinuxExtensionsWindowRetired(id_);', detach)
        destructor = method(self.host, 'ShellHostView::~ShellHostView() {')
        self.assertIn('extension_surfaces_.reset();', destructor)
        self.assertLess(destructor.index('Hosts().erase(id_);'), destructor.index('LinuxExtensionsWindowClosing(id_);'))
        self.assertIn('LinuxExtensionsWindowClosing(id_);', method(self.host, '  void ReleaseExtensions() {'))
        self.assertIn('LinuxExtensionsWindowRetired(id_);', method(self.host, 'void ShellHostView::DetachViewports() {'))
        closed = method(self.host, '  void OnBrowserClosed(BrowserWindowInterface* browser) override {')
        self.assertLess(closed.index('found->second->ReleaseExtensions();'), closed.index('found->second->DetachBrowser();'))
        self.assertIn('extension_surfaces_.reset();', method(self.host, '  void ReleaseExtensions() {'))
        invoke = method(self.host, 'void ShellHostView::Invoke(')
        self.assertIn('LinuxExtensionSurfaces::Handles(method)', invoke)
        self.assertIn('renderer_generation_', invoke[invoke.index('LinuxExtensionSurfaces::Handles(method)'):])
        command = method(self.host, 'void ShellHostView::TabCommand(')
        self.assertIn('command == "executeExtensionAction"', command)
        self.assertIn('linux_extensions::kSurfaceCapabilities', method(self.host, 'base::DictValue ShellHostView::Bootstrap() const {'))

    def test_install_prompts_fall_back_to_chromium_and_are_never_silently_accepted(self):
        hook = method(self.service, 'bool InstallPromptHook(')
        self.assertIn('if (!window) return false;', hook)
        self.assertIn('if (pending) *done = std::move(pending->done);', hook)
        self.assertIn('InstallResult::ABORTED', hook)
        self.assertNotIn('ACCEPTED', hook)
        resolve = method(self.service, 'void ResolvePrompt(')
        self.assertIn('case ext::PromptResolve::kWrongWindow:', resolve)
        retarget = method(self.service, 'void Retarget(int window, bool closing) {')
        self.assertIn('InstallResult::USER_CANCELED', retarget)

    def test_install_prompts_end_with_their_parent_tab(self):
        watch = self.service[self.service.index('class PromptParentWatch'):]
        watch = watch[:watch.index('\n};\n')]
        self.assertIn('public content::WebContentsObserver', watch)
        destroyed = watch[watch.index('void WebContentsDestroyed() override'):]
        self.assertLess(destroyed.index('Observe(nullptr);'), destroyed.index('PostTask('))
        self.assertIn('&AbortPromptForDestroyedParent', destroyed)
        abort = method(self.service, 'void AbortPromptForDestroyedParent(std::string request) {')
        self.assertLess(abort.index('Prompts().Take('), abort.index('"extensions.installPromptCancelled"'))
        self.assertIn('InstallResult::ABORTED', abort)
        self.assertNotIn('USER_CANCELED', abort)
        hook = method(self.service, 'bool InstallPromptHook(')
        self.assertIn('parent ? std::make_unique<PromptParentWatch>(parent) : nullptr', hook)
        self.assertLess(hook.index('Prompts().Add('), hook.index('->Track(*request)'))
        self.assertIn('std::unique_ptr<PromptParentWatch> parent;', self.service[self.service.index('struct PendingInstall'):])

    def test_gn_lists_extension_helpers_and_their_dependencies(self):
        build = (LINUX / 'BUILD.gn').read_text()
        target = build[build.index('source_set("linux")'):]
        for name in ['ac_linux_extension_service', 'ac_linux_extension_views', 'ac_linux_extensions']:
            for suffix in ['.cc', '.h']:
                self.assertIn(f'"{name}{suffix}"', target)
        for dep in ['//chrome/browser/extensions', '//chrome/browser/ui/extensions:extension_popup_types', '//extensions/common',
                    '//extensions/browser', '//ui/shell_dialogs']:
            self.assertIn(f'"{dep}"', target)

    def test_action_popup_hook_patch_is_registered_for_linux_and_applies(self):
        series = (REPO / 'engine/patches/series').read_text()
        self.assertIn('chromium chromium-linux-action-popup-hook.patch linux', series)
        patch = REPO / 'engine/patches/chromium-linux-action-popup-hook.patch'
        text = patch.read_text()
        self.assertIn('g_ardia_open_action_popup', text)
        self.assertNotRegex('\n'.join(line for line in text.splitlines() if line.startswith('+')), r'^\+\s*(//|/\*)')
        with applied(patch.name, 'chrome/browser/extensions/api/extension_action/extension_action_api.cc') as directory:
            self.assertIn('g_ardia_open_action_popup', (directory / 'chrome/browser/extensions/api/extension_action/extension_action_api.cc').read_text())


if __name__ == '__main__':
    unittest.main()
