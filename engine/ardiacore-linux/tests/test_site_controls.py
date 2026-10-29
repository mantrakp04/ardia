import pathlib
import re
import subprocess
import tempfile
import unittest

from chromium_series import applied
from test_downloads import compile_and_run
from test_session_merge import VALUES

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
HOST = (LINUX / 'ac_linux_host.cc').read_text()


def body(source, start):
    begin = source.index(start)
    depth = 0
    for index in range(source.index('{', begin), len(source)):
        depth += {'{': 1, '}': -1}.get(source[index], 0)
        if depth == 0:
            return source[begin:index + 1]
    raise AssertionError(f'unterminated {start}')


class SiteControlsHelperTests(unittest.TestCase):
    def test_permissions_data_clearing_and_blocker_state_machine(self):
        with tempfile.TemporaryDirectory(prefix='ardia-site-controls-') as directory:
            include = pathlib.Path(directory) / 'include'
            (include / 'base').mkdir(parents=True)
            (include / 'base/values.h').write_text(VALUES)
            output = compile_and_run(self, 'site-controls', [
                LINUX / 'ac_linux_site_controls.cc', ROOT / 'tests/fixtures/site_controls_scenarios.cc',
            ], extra_includes=[include])
        self.assertIn('site controls scenarios passed', output)

    def test_service_drives_engine_calls_component_load_and_the_bridge_page(self):
        service = [LINUX / 'ac_linux_site_controls_service.cc', LINUX / 'ac_linux_site_controls_service.h',
                   LINUX / 'ac_linux_navigation_hold.cc', LINUX / 'ac_linux_navigation_hold.h']
        includes = set()
        for path in service:
            includes.update(re.findall(r'^#include "([^"]+)"', path.read_text(), re.M))
        with tempfile.TemporaryDirectory(prefix='ardia-site-controls-stubs-') as directory:
            stubs = pathlib.Path(directory)
            for name in includes:
                if name.startswith('ardia/linux/'):
                    continue
                (stubs / name).parent.mkdir(parents=True, exist_ok=True)
                (stubs / name).write_text(VALUES if name == 'base/values.h' else '#include "site_controls_service_support.h"\n')
            (stubs / 'base').mkdir(exist_ok=True)
            (stubs / 'base/values.h').write_text(VALUES)
            output = compile_and_run(self, 'site-controls-service', [
                LINUX / 'ac_linux_site_controls.cc', LINUX / 'ac_linux_site_controls_service.cc',
                LINUX / 'ac_linux_navigation_hold.cc',
                LINUX / 'ac_linux_profiles.cc', ROOT / 'tests/fixtures/site_controls_service_scenarios.cc',
            ], extra_includes=[stubs, ROOT / 'tests/fixtures'])
        self.assertIn('site controls service scenarios passed', output)

    def test_bridge_page_against_a_simulated_ublock_dashboard(self):
        result = subprocess.run(['node', '--test', str(ROOT / 'tests/content_blocker_bridge.test.mjs')],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertRegex(result.stdout, r'pass 14\b')


class SiteControlsWiringTests(unittest.TestCase):
    def test_site_calls_pass_the_profile_name_gate_then_reach_the_helper_before_the_route_table(self):
        request = body(HOST, '  void Request(const base::ListValue& arguments) {')
        intercept = request.index('if (LinuxSiteControlsHandles(name))')
        self.assertLess(request.index('ardiacore::linux_profiles::ParseProfileName(profile)'), intercept)
        self.assertLess(request.index('if (name == "profiles.release")'), intercept)
        self.assertLess(intercept, request.index('ardiacore::linux_contract::FindRoute(name)'))
        self.assertLess(intercept, request.index('ardiacore::ResolveLinuxProfile(profile'))
        self.assertIn('LinuxSiteControlsCall(host_->profile(), host_->page_profile(), name, profile, args.Find("args")', request)
        contract = (LINUX / 'ac_linux_contract.h').read_text()
        for name in ['sites.settings', 'sites.setSetting', 'sites.origins', 'sites.reset', 'sites.clearData',
                     'profiles.clearBrowsingData', 'contentBlocker.']:
            self.assertNotIn(f'"{name}', contract)

    def test_blocker_starts_with_each_window_and_broadcasts_changes_to_its_profile(self):
        self.assertIn('StartLinuxContentBlocker(profile(), page_profile());', body(HOST, 'void ShellHostView::Initialize() {'))
        bootstrap = body(HOST, 'base::DictValue ShellHostView::Bootstrap() const {')
        self.assertIn('  AppendLinuxSiteControlsCapabilities(capabilities);\n', bootstrap[:bootstrap.index('  auto bootstrap = base::DictValue()')])
        start = body(HOST, 'void StartLinuxHost() {')
        sink = start[start.index('StartLinuxSiteControls('):]
        self.assertIn('host->profile()->GetOriginalProfile() != profile', sink)
        self.assertIn('host->Event("ArdiaContentBlocker", "contentBlocker"', sink)
        self.assertIn('.Set("name", "contentBlocker.changed")', sink)

    def test_service_restricts_the_component_and_drives_only_its_own_bridge_page(self):
        service = (LINUX / 'ac_linux_site_controls_service.cc').read_text()
        hook = body(service, 'void StartLinuxSiteControls(ContentBlockerChanged changed) {')
        self.assertIn('g_ardia_restricted_component_extension = ', hook)
        self.assertIn('return id == controls::kExtensionId;', hook)
        frame = body(service, '  content::RenderFrameHost* BridgeFrame() const {')
        self.assertIn('frame->GetLastCommittedURL() != BridgeUrl()', frame)
        self.assertEqual(service.count('ExecuteJavaScriptInIsolatedWorld('), 2)
        self.assertEqual(service.count('ISOLATED_WORLD_ID_CHROME_INTERNAL'), 2)
        self.assertNotIn('ExecuteJavaScript(', service.replace('ExecuteJavaScriptInIsolatedWorld(', ''))
        start = body(service, 'void StartLinuxContentBlocker(Profile* app_profile, Profile* page_profile) {')
        self.assertIn('if (!app_profile || app_profile->IsOffTheRecord()) return;', start)
        self.assertIn('LinuxContentBlocker* leader = LinuxContentBlocker::Start(app_profile, nullptr);', start)
        self.assertIn('if (!page_profile || page_profile->IsOffTheRecord() || page_profile == app_profile) return;', start)
        self.assertIn('LinuxContentBlocker::Start(page_profile, leader);', start)
        self.assertIn('InstallLinuxNavigationHold();', hook)
        resolve = body(service, 'void SiteControlsProfile(')
        self.assertIn('controls::RouteProfile(', resolve)
        self.assertIn('ardiacore::ResolveLinuxProfile(requested', resolve)
        self.assertIn('IsOffTheRecord()) error = ProfileError::kPrivateService', resolve)
        self.assertEqual(service.count('SiteControlsProfile('), 2)

    def test_every_linux_process_restricts_the_content_blocker_component(self):
        patch = (ROOT.parents[0] / 'patches/chromium-ardia-linux-layer.patch').read_text()
        hunk = patch[patch.index('--- a/chrome/app/chrome_main_delegate.cc'):]
        self.assertIn('+#include "ardia/core/ac_content_hooks.h"  // nogncheck', hunk)
        startup = hunk[hunk.index(' std::optional<int> ChromeMainDelegate::BasicStartupComplete() {'):]
        self.assertTrue(startup.startswith(' std::optional<int> ChromeMainDelegate::BasicStartupComplete() {\n #if BUILDFLAG(IS_LINUX)\n'
                                           '+  g_ardia_restricted_component_extension = &IsArdiaLinuxContentBlocker;\n'), startup[:300])
        predicate = re.search(r'\+bool IsArdiaLinuxContentBlocker\(const extensions::ExtensionId& extension_id\) \{\n\+  return extension_id == "([a-p]{32})";', hunk)
        helper = (LINUX / 'ac_linux_site_controls.h').read_text()
        self.assertIsNotNone(predicate)
        self.assertIn(f'kExtensionId = "{predicate.group(1)}"', helper)
        self.assertNotRegex(hunk, r'\n\+[^\n]*//(?! nogncheck)')

    def test_the_hook_runs_before_every_process_type_and_guards_renderer_script_access(self):
        chromium = pathlib.Path.home() / 'ardia-linux-build-156/chromium_git/chromium/src'
        runner = chromium / 'content/app/content_main_runner_impl.cc'
        permissions = chromium / 'extensions/common/permissions/permissions_data.cc'
        injection = chromium / 'extensions/renderer/extension_injection_host.cc'
        if not all(path.exists() for path in [runner, permissions, injection]):
            self.skipTest('Chromium 156 source is unavailable')
        source = runner.read_text()
        initialize = body(source, 'int ContentMainRunnerImpl::Initialize(ContentMainParams params) {')
        self.assertIn('delegate_->BasicStartupComplete()', initialize)
        run = body(source, 'NO_STACK_PROTECTOR int ContentMainRunnerImpl::Run() {')
        self.assertIn('RunOtherNamedProcessTypeMain(process_type', run)
        self.assertLess(source.index('delegate_->BasicStartupComplete()'), source.index('NO_STACK_PROTECTOR int ContentMainRunnerImpl::Run() {'))
        self.assertIn('return RunZygote(delegate);', body(source, 'NO_STACK_PROTECTOR int RunOtherNamedProcessTypeMain('))
        data = permissions.read_text()
        restricted = body(data, 'bool PermissionsData::IsRestrictedUrl(const GURL& document_url,')
        self.assertIn('g_ardia_restricted_component_extension(extension_id_)', restricted)
        self.assertIn('if (IsRestrictedUrl(document_url, error))', body(data, 'PermissionsData::PageAccess PermissionsData::CanRunOnPage('))
        self.assertIn('return CanRunOnPage(', body(data, 'PermissionsData::PageAccess PermissionsData::GetContentScriptAccess('))
        self.assertIn('permissions_data()->GetContentScriptAccess(', injection.read_text())

    def test_the_component_stays_out_of_the_user_extension_list(self):
        helper = (LINUX / 'ac_linux_site_controls.h').read_text()
        ours = re.search(r'kExtensionId = "([a-p]{32})"', helper).group(1)
        self.assertNotEqual(ours, 'blockjmkbacgjkknlgpkjjiijinjdanf')
        engine = (ROOT.parents[0] / 'chromium/src/chrome/browser/ardia/ac_extensions.cc').read_text()
        listing = body(engine, '  void List(Reply reply) {')
        self.assertIn('extensions::ExtensionInfoGenerator', listing)
        self.assertNotIn(ours, engine)
        for path in LINUX.glob('ac_linux_extension*'):
            self.assertNotIn(ours, path.read_text(), path)

    def test_gn_lists_the_helper_and_its_extension_dependency(self):
        build = (LINUX / 'BUILD.gn').read_text()
        target = build[build.index('source_set("linux")'):]
        for name in ['ac_linux_site_controls.cc', 'ac_linux_site_controls.h',
                     'ac_linux_site_controls_service.cc', 'ac_linux_site_controls_service.h']:
            self.assertIn(f'"{name}"', target)
        self.assertIn('"//chrome/browser/extensions"', target)

    def test_navigation_hold_hook_patch_is_registered_for_linux_and_applies(self):
        series = (ROOT.parents[0] / 'patches/series').read_text()
        self.assertIn('chromium chromium-linux-navigation-hold-hook.patch linux', series)
        self.assertLess(series.index('chromium-ardia-linux-layer.patch'), series.index('chromium-linux-navigation-hold-hook.patch'))
        patch = ROOT.parents[0] / 'patches/chromium-linux-navigation-hold-hook.patch'
        text = patch.read_text()
        added = '\n'.join(line for line in text.splitlines() if line.startswith('+') and not line.startswith('+++'))
        self.assertIn('g_ardia_linux_navigation_throttles(registry);', added)
        self.assertIn('#if BUILDFLAG(IS_LINUX)', added)
        self.assertNotRegex(added, r'^\+\s*(//|/\*)')
        hold = (LINUX / 'ac_linux_navigation_hold.cc').read_text()
        self.assertIn('extern void (*g_ardia_linux_navigation_throttles)(content::NavigationThrottleRegistry& registry);', hold)
        self.assertIn('g_ardia_linux_navigation_throttles = &MaybeAddHoldThrottle;', hold)
        build = (LINUX / 'BUILD.gn').read_text()
        for name in ['ac_linux_navigation_hold.cc', 'ac_linux_navigation_hold.h']:
            self.assertIn(f'"{name}"', build)
        with applied(patch.name, 'chrome/browser/chrome_content_browser_client.cc') as directory:
            self.assertIn('g_ardia_linux_navigation_throttles(registry);', (directory / 'chrome/browser/chrome_content_browser_client.cc').read_text())

    def test_bridge_files_carry_no_comments(self):
        for path in (ROOT / 'content-blocker').iterdir():
            text = path.read_text()
            self.assertNotIn('<!--', text, path)
            self.assertIsNone(re.search(r'(^|\s)//(?!/)', text), path)
            self.assertNotIn('/*', text, path)


if __name__ == '__main__':
    unittest.main()
