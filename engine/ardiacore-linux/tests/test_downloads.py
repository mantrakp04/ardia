import json
import pathlib
import re
import subprocess
import tempfile
import unittest

from support import VALUES, compile_and_run

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINUX = ROOT / 'src/ardia/linux'


class DownloadHelperTests(unittest.TestCase):
    def test_ids_paths_requests_snapshots_routes_clears_and_file_gates(self):
        with tempfile.TemporaryDirectory(prefix='ardia-downloads-') as directory:
            root = pathlib.Path(directory)
            (root / 'include/base').mkdir(parents=True)
            (root / 'include/base/values.h').write_text(VALUES)
            output = compile_and_run(self, 'downloads', [
                LINUX / 'ac_linux_downloads.cc', LINUX / 'ac_linux_file_drop.cc',
                ROOT / 'tests/fixtures/downloads_scenarios.cc',
            ], extra_includes=[root / 'include'])
        self.assertIn('downloads scenarios passed', output)
        native = re.findall(r'^capability (\S+)$', output, re.M)
        script = "import('./src/fileCapabilities.ts').then((m) => console.log(JSON.stringify(m.FILE_CAPABILITIES)))"
        result = subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e', script],
                                cwd=ROOT.parents[1] / 'apps/linux', capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(native), 3)
        self.assertEqual(sorted(native), sorted(json.loads(result.stdout)))


class DownloadWiringTests(unittest.TestCase):
    def test_contract_routes_engine_controls_and_forwards_removals(self):
        code = r'''
#include "ardia/linux/ac_linux_contract.h"
#include <cassert>
#include <string_view>
using namespace ardiacore::linux_contract;
void Expect(std::string_view name, std::string_view service, std::string_view field) {
  const Route* route = FindRoute(name);
  assert(route && route->service == service && route->field == field);
}
int main() {
  Expect("downloads.cancel", "ac_downloads_command", "null");
  Expect("downloads.pause", "ac_downloads_command", "null");
  Expect("downloads.resume", "ac_downloads_command", "null");
  Expect("downloads.keep", "ac_downloads_command", "null");
  Expect("downloads.settings", "ac_downloads_settings", "");
  Expect("downloads.setSettings", "ac_downloads_set_settings", "");
  assert(!FindRoute("downloads.list") && !FindRoute("downloads.remove") && !FindRoute("downloads.clear"));
  assert(EventName("downloads.changed") == "downloads.changed");
  assert(EventName("downloads.removed") == "downloads.removed");
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-download-contract-') as directory:
            source = pathlib.Path(directory) / 'contract.cc'
            source.write_text(code)
            compile_and_run(self, 'download-contract', [source])


if __name__ == '__main__':
    unittest.main()
