import pathlib
import re
import unittest

from support import compile_and_run

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'


class SearchEnginePolicyTests(unittest.TestCase):
    def test_validation_templates_and_decisions(self):
        output = compile_and_run(self, 'search-engine-policy', [ROOT / 'tests/fixtures/search_engine_policy_scenarios.cc'])
        self.assertIn('search engine policy scenarios passed', output)

    def test_the_owned_engine_guid_is_a_lowercase_uuid(self):
        policy = (LINUX / 'ac_linux_search_engine_policy.h').read_text()
        guid = re.search(r'kOwnedEngineGuid\[\] = "([^"]+)"', policy).group(1)
        self.assertRegex(guid, r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')

    def test_the_host_hands_every_field_to_the_service(self):
        host = (LINUX / 'ac_linux_host.cc').read_text()
        self.assertIn('for (const char* key : {"name", "keyword", "url"})', host)
        self.assertIn('ardiacore::SetLinuxDefaultSearchEngine(', host)
        self.assertNotIn('No installed search engine named', host)
        service = (LINUX / 'ac_linux_search_engines.cc').read_text()
        for needle in ('is_default_search_managed()', 'IsExtensionControlledDefaultSearch()', 'RegisterOnLoadedCallback(',
                       'ShutdownStarted()', 'OnProfileAdded(', 'GetProfileByPath(path)'):
            self.assertIn(needle, service)
        build = (LINUX / 'BUILD.gn').read_text()
        for source in ('ac_linux_search_engine_policy.h', 'ac_linux_search_engines.cc', 'ac_linux_search_engines.h'):
            self.assertIn(f'"{source}"', build)


if __name__ == '__main__':
    unittest.main()
