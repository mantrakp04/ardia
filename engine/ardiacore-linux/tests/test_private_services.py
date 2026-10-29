import pathlib
import re
import unittest

from test_downloads import compile_and_run
from test_renderer_contract import method

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
REPO = ROOT.parents[1]


def private_calls():
    header = (LINUX / 'ac_linux_private_services.h').read_text()
    table = header[header.index('kPrivateSessionCalls[] = {'):]
    table = table[:table.index('};')]
    return dict(re.findall(r'\{"([^"]+)", "([^"]+)"\}', table))


class PrivateServiceHelperTests(unittest.TestCase):
    def test_routing_and_engine_failures(self):
        output = compile_and_run(self, 'private-services', [ROOT / 'tests/fixtures/private_services_scenarios.cc'])
        self.assertIn('private services scenarios passed', output)

    def test_private_session_calls_are_the_engine_calls_that_serve_a_private_profile(self):
        engine = ROOT.parents[0] / 'chromium/src/chrome/browser/ardia'
        sources = '\n'.join(path.read_text() for path in engine.glob('ac_*.cc'))
        allowed = set(re.findall(r'^AC_PROFILE_CALL\((ac_\w+),\s*ardia::OffTheRecord::kAllow\)', sources, re.MULTILINE))
        self.assertTrue(allowed)
        self.assertEqual(set(private_calls().values()), allowed)

    def test_the_macos_bridge_leaves_the_private_profile_decision_to_the_engine(self):
        bridge = (REPO / 'packages/ardiacore/ios/ArdiaEngineBridge.mm').read_text()
        self.assertNotIn('PrivateSessionPolicy', bridge)
        self.assertIn('ardia_host::IsPrivateProfile(profile)', bridge)

    def test_zoom_routes_a_hosted_private_session_through_the_engine_off_the_record_call(self):
        host = (LINUX / 'ac_linux_host.cc').read_text()
        request = method(host, '  void Request(const base::ListValue& arguments) {')
        zoom = request[request.index('if (ardiacore::IsLinuxZoomDomainRoute(name)) {'):]
        zoom = zoom[:zoom.index('\n      }\n') + 8]
        self.assertIn('ardiacore::linux_private_services::RoutePrivateCall(name,', zoom)
        self.assertIn('page && host_->HostsProfile(profile)', zoom)
        self.assertIn('page && page->ShutdownStarted()', zoom)
        self.assertIn('prepared->args.Set(ardiacore::linux_private_services::kOffTheRecordKey, true);', zoom)
        self.assertIn('const std::string path = page->GetOriginalProfile()->GetPath().value();', zoom)
        self.assertLess(zoom.index('page->GetOriginalProfile()'), zoom.index('ResolveLinuxProfile(profile,'))
        generic = request[request.index('const auto* route = ardiacore::linux_contract::FindRoute(name);'):]
        generic = generic[:generic.index('ardiacore::ResolveLinuxProfile(profile,')]
        self.assertIn('ProfileError::kPrivateService', generic)

    def test_engine_errors_name_the_private_session_failure(self):
        host = (LINUX / 'ac_linux_host.cc').read_text()
        replied = method(host, '  static void Replied(void* context, const char* json) {')
        self.assertIn('ardiacore::linux_private_services::EngineFailure(', replied)
        controls = (LINUX / 'ac_linux_site_controls.cc').read_text()
        complete = method(controls, 'std::variant<base::Value, Failure> CompleteServiceCall(')
        self.assertIn('ardiacore::linux_private_services::EngineFailure(', complete)

    def test_a_private_window_is_private_whatever_profile_name_its_shell_passes(self):
        host = (LINUX / 'ac_linux_host.cc').read_text()
        request = method(host, '  void Request(const base::ListValue& arguments) {')
        engine = request[request.index('if (arguments[1].GetString() == "engine.call") {'):request.index('if (arguments[1].GetString() != "host.invoke")')]
        decided = engine.index('const bool private_request = ardiacore::linux_private_services::PrivateRequest(')
        self.assertIn('host_->private_window() || (window_profile && window_profile->IsOffTheRecord())', engine[:decided + 200])
        self.assertLess(decided, engine.index('if (LinuxExtensionsHandles(name)) {'))
        self.assertNotIn('profile_name->kind == ardiacore::linux_profiles::ProfileKind::kPrivate', engine)
        zoom = engine[engine.index('if (ardiacore::IsLinuxZoomDomainRoute(name)) {'):engine.index('if (LinuxCredentialsHandles(name)) {')]
        self.assertIn('const bool private_session = private_request;', zoom)
        saver = engine[engine.index('if (ardiacore::IsLinuxMemorySaverRoute(name)) {'):engine.index('const auto* route = ardiacore::linux_contract::FindRoute(name);')]
        self.assertIn('if (private_request) {', saver)
        generic = engine[engine.index('const auto* route = ardiacore::linux_contract::FindRoute(name);'):]
        self.assertLess(generic.index('if (private_request) {'), generic.index('ardiacore::ResolveLinuxProfile(profile,'))
        downloads = engine[engine.index('if (LinuxDownloadsHandles(name) || linux_downloads::IsDownloadControl(name)) {'):engine.index('if (name == "favicons.fetch") {')]
        self.assertIn('const bool page_private = page->IsOffTheRecord();', downloads)
        controls = (LINUX / 'ac_linux_site_controls_service.cc').read_text()
        chosen = method(controls, 'void SiteControlsProfile(')
        self.assertIn('controls::RouteProfile(name, requested, private_page)', chosen)
        self.assertLess(chosen.index('const bool private_page = page_profile && page_profile->IsOffTheRecord();'), chosen.index('controls::RouteProfile('))
        extensions = (LINUX / 'ac_linux_extension_service.cc').read_text()
        call = method(extensions, 'void CallProfile(')
        self.assertLess(call.index('ext::PrivateWindowRoute(name, window.profile->ShutdownStarted())'), call.index('ext::UsesWindowProfile(name)'))

    def test_gn_lists_the_helper(self):
        self.assertIn('"ac_linux_private_services.h",', (LINUX / 'BUILD.gn').read_text())


if __name__ == '__main__':
    unittest.main()
