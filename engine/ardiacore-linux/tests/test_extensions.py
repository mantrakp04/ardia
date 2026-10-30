import pathlib
import re
import tempfile
import unittest

from support import VALUES, compile_and_run

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
LINUX = ROOT / 'src/ardia/linux'
FIXTURES = ROOT / 'tests/fixtures'


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


class ExtensionRouteTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
