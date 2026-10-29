import pathlib
import re
import tempfile
import unittest

from test_downloads import compile_and_run
from test_session_merge import VALUES

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'
HOST = (LINUX / 'ac_linux_host.cc').read_text()
HELPER = (LINUX / 'ac_linux_memory_saver.h').read_text()
ENGINE = (ROOT.parents[0] / 'chromium/src/chrome/browser/ardia/ac_memory_saver.cc').read_text()


def body(source, start):
    begin = source.index(start)
    depth = 0
    for index in range(source.index('{', begin), len(source)):
        depth += {'{': 1, '}': -1}.get(source[index], 0)
        if depth == 0:
            return source[begin:index + 1]
    raise AssertionError(f'unterminated {start}')


def branch(source, start):
    begin = source.index(start)
    end = source.index('\n      }\n', begin)
    return source[begin:end]


class MemorySaverHelperTests(unittest.TestCase):
    def test_requests_and_replies_are_validated_against_the_engine_shape(self):
        with tempfile.TemporaryDirectory(prefix='ardia-memory-saver-') as directory:
            include = pathlib.Path(directory) / 'include'
            (include / 'base').mkdir(parents=True)
            (include / 'base/values.h').write_text(VALUES)
            output = compile_and_run(self, 'memory-saver', [
                LINUX / 'ac_linux_memory_saver.cc', ROOT / 'tests/fixtures/memory_saver_scenarios.cc',
            ], extra_includes=[include])
        self.assertIn('memory saver scenarios passed', output)

    def test_the_helper_speaks_the_engine_call_it_targets(self):
        self.assertIn('AC_PROFILE_CALL(ac_memory_saver)', ENGINE)
        self.assertIn('kLinuxMemorySaverService[] = "ac_memory_saver"', HELPER)
        for key in ['validate', 'state', 'aggressiveness']:
            self.assertIn(f'args.FindString("{key}")', ENGINE)
        self.assertIn('args.FindList("sites")', ENGINE)
        engine_modes = re.findall(r'\{"(\w+)", MemorySaverModeAggressiveness::', ENGINE)
        helper = (LINUX / 'ac_linux_memory_saver.cc').read_text()
        helper_modes = re.findall(r'"(\w+)"', helper[helper.index('kModes[]'):helper.index(';', helper.index('kModes[]'))])
        self.assertEqual(engine_modes, ['moderate', 'balanced', 'maximum'])
        self.assertEqual(helper_modes, engine_modes)
        for key in ['"state"', '"aggressiveness"', '"active"', '"sites"', '"invalid"', '"valid"']:
            self.assertIn(f'.Set({key}', ENGINE)

    def test_the_helper_needs_only_base_values(self):
        includes = re.findall(r'^#include "([^"]+)"', HELPER + (LINUX / 'ac_linux_memory_saver.cc').read_text(), re.M)
        self.assertEqual(sorted(set(includes)), ['ardia/linux/ac_linux_memory_saver.h', 'base/values.h'])


class MemorySaverWiringTests(unittest.TestCase):
    def test_requests_are_prepared_before_the_route_table_and_resolve_a_regular_profile(self):
        request = body(HOST, '  void Request(const base::ListValue& arguments) {')
        intercept = request.index('if (ardiacore::IsLinuxMemorySaverRoute(name)) {')
        self.assertLess(request.index('ardiacore::linux_profiles::ParseProfileName(profile)'), intercept)
        self.assertLess(request.index('parsed->GetDict().contains("profile")'), intercept)
        self.assertLess(intercept, request.index('ardiacore::linux_contract::FindRoute(name)'))
        saver = branch(request, 'if (ardiacore::IsLinuxMemorySaverRoute(name)) {')
        self.assertLess(saver.index('if (private_request) {'), saver.index('ResolveLinuxProfile(profile,'))
        self.assertLess(saver.index('PrepareLinuxMemorySaver(name, input)'), saver.index('ResolveLinuxProfile(profile,'))
        self.assertIn('base::WriteJson(*prepared)', saver)
        self.assertIn('resolved->IsOffTheRecord()', saver)
        self.assertIn('ProfileError::kPrivateService', saver)
        self.assertIn('ac_engine_call(ardiacore::kLinuxMemorySaverService, path.c_str(), json.c_str(), Replied,', saver)
        self.assertNotIn('input.Clone()', saver)
        self.assertNotIn('host_->profile()', saver)

    def test_replies_are_completed_before_the_route_field_handling(self):
        replied = body(HOST, '  static void Replied(void* context, const char* json) {')
        complete = replied.index('if (ardiacore::IsLinuxMemorySaverRoute(reply->name)) {')
        self.assertLess(replied.index('ardiacore::linux_private_services::EngineFailure('), complete)
        self.assertLess(complete, replied.index('ardiacore::linux_contract::FindRoute(reply->name)'))
        self.assertIn('ardiacore::CompleteLinuxMemorySaver(reply->name, value->GetDict())', replied)
        self.assertIn('"ERR_BAD_REPLY", "Malformed Memory Saver reply"', replied)

    def test_bootstrap_advertises_the_routes_and_they_stay_out_of_the_pass_through_table(self):
        bootstrap = body(HOST, 'base::DictValue ShellHostView::Bootstrap() const {')
        self.assertRegex(bootstrap, r'for \(const char\* route : ardiacore::kLinuxMemorySaverRoutes\)\s*capabilities\.Append\(route\);')
        routes = re.findall(r'"([\w.]+)"', HELPER[HELPER.index('kLinuxMemorySaverRoutes[]'):HELPER.index(';', HELPER.index('kLinuxMemorySaverRoutes[]'))])
        self.assertEqual(routes, ['engine.memorySaver', 'engine.validateKeepActiveSite'])
        contract = (LINUX / 'ac_linux_contract.h').read_text()
        for route in routes:
            self.assertNotIn(f'"{route}"', contract)
        self.assertNotIn('"ac_memory_saver"', contract)

    def test_gn_lists_the_helper(self):
        build = (LINUX / 'BUILD.gn').read_text()
        target = build[build.index('source_set("linux")'):]
        for name in ['ac_linux_memory_saver.cc', 'ac_linux_memory_saver.h']:
            self.assertIn(f'"{name}"', target)


if __name__ == '__main__':
    unittest.main()
