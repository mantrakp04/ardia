import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'
LINUX = SOURCE / 'ardia' / 'linux'


class TelemetryPolicyTests(unittest.TestCase):
    def test_only_bounded_json_bodies_with_app_keys_post_to_the_fixed_endpoint(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        code = r'''#include <cassert>
#include <string>
#include "ardia/linux/ac_linux_telemetry_policy.h"
int main() {
  using namespace ardia::linux_telemetry_policy;
  assert(kEndpoint == "https://ardia.dev/otel/v1/logs");
  assert(IngestKeyAcceptable("ak_app_41b5d0762fd8ade6949ac2ac"));
  assert(IngestKeyAcceptable("ak_cli_0123456789abcdef01234567"));
  assert(IngestKeyAcceptable("ak_x_0123456789abcdef01234567"));
  assert(!IngestKeyAcceptable(""));
  assert(!IngestKeyAcceptable("ak__0123456789abcdef01234567"));
  assert(!IngestKeyAcceptable("ak_0123456789abcdef01234567"));
  assert(!IngestKeyAcceptable("ak_App_41b5d0762fd8ade6949ac2ac"));
  assert(!IngestKeyAcceptable("ak_a1_41b5d0762fd8ade6949ac2ac"));
  assert(!IngestKeyAcceptable("ak_a_b_41b5d0762fd8ade6949ac2ac"));
  assert(!IngestKeyAcceptable("ak_app_41B5D0762FD8ADE6949AC2AC"));
  assert(!IngestKeyAcceptable("ak_app_41b5d0762fd8ade6949ac2a"));
  assert(!IngestKeyAcceptable("ak_app_41b5d0762fd8ade6949ac2acd"));
  assert(!IngestKeyAcceptable("ak_app_41b5d0762fd8ade6949ac2ag"));
  assert(!IngestKeyAcceptable("xk_app_41b5d0762fd8ade6949ac2ac"));
  assert(!IngestKeyAcceptable(" ak_app_41b5d0762fd8ade6949ac2ac"));
  assert(!IngestKeyAcceptable("ak_app_41b5d0762fd8ade6949ac2ac\n"));
  assert(!IngestKeyAcceptable("ak_app_41b5d0762fd8ade6949ac2ac\r\nX-Evil: 1"));
  assert(!IngestKeyAcceptable(std::string("ak_app\0_41b5d0762fd8ade6949ac2ac", 31)));
  assert(BodyAcceptable("{\"resourceLogs\":[]}"));
  assert(BodyAcceptable("{"));
  assert(BodyAcceptable("{" + std::string(kMaxBodyBytes - 1, ' ')));
  assert(!BodyAcceptable("{" + std::string(kMaxBodyBytes, ' ')));
  assert(!BodyAcceptable(""));
  assert(!BodyAcceptable(" {}"));
  assert(!BodyAcceptable("[]"));
  assert(kMaxBodyBytes == 524288);
  assert(PostAcceptable("{}", "ak_app_41b5d0762fd8ade6949ac2ac"));
  assert(!PostAcceptable("{}", "ak_app_nope"));
  assert(!PostAcceptable("[]", "ak_app_41b5d0762fd8ade6949ac2ac"));
  for (int i = 0; i < kMaxInFlight; ++i) assert(AdmitPost(i));
  assert(kMaxInFlight == 4);
  assert(!AdmitPost(kMaxInFlight));
  assert(!AdmitPost(-1));
  assert(ReportedStatus(true, 200) == 200);
  assert(ReportedStatus(true, 204) == 204);
  assert(ReportedStatus(true, 400) == 400);
  assert(ReportedStatus(true, 429) == 429);
  assert(ReportedStatus(true, 503) == 503);
  assert(ReportedStatus(false, 200) == 0);
  assert(ReportedStatus(false, 0) == 0);
  assert(ReportedStatus(true, 301) == 0);
  assert(ReportedStatus(true, 307) == 0);
  assert(ReportedStatus(true, 100) == 0);
  assert(ReportedStatus(true, 600) == 0);
  assert(kTimeoutSeconds == 30);
}
'''
        with tempfile.TemporaryDirectory(prefix='ardia-telemetry-policy-test-') as scratch:
            scratch = pathlib.Path(scratch)
            cpp = scratch / 'telemetry.cc'
            cpp.write_text(code, encoding='latin-1')
            binary = scratch / 'telemetry'
            compiled = subprocess.run([compiler, '-std=c++20', '-Wall', '-Werror', '-I', str(SOURCE), str(cpp), '-o', str(binary)], capture_output=True, text=True)
            if compiled.returncode != 0:
                raise AssertionError(compiled.stderr)
            subprocess.run([str(binary)], check=True)

    def test_the_post_omits_credentials_refuses_redirects_and_uses_the_system_network_context(self):
        fetcher = (LINUX / 'ac_linux_telemetry.cc').read_text()
        for needle in ['GURL(policy::kEndpoint)', 'request->method = "POST"', 'CredentialsMode::kOmit', 'RedirectMode::kError',
                       'system_network_context_manager()', 'GetSharedURLLoaderFactory()', 'DownloadHeadersOnly(', 'SetAllowHttpErrorResults(true)',
                       'base::Seconds(policy::kTimeoutSeconds)', '"X-Ardia-Key"', 'policy::AdmitPost(InFlight())', 'cookies_allowed: NO']:
            self.assertIn(needle, fetcher)
        self.assertNotIn('GetDefaultStoragePartition', fetcher)
        self.assertNotIn('Profile', fetcher)

    def test_the_host_advertises_and_gates_the_route(self):
        host = (LINUX / 'ac_linux_host.cc').read_text()
        bootstrap = host[host.index('base::DictValue ShellHostView::Bootstrap() const {'):host.index('void ShellHostView::LayoutOverlay()')]
        self.assertIn('.Append("ArdiaTelemetry.post")', bootstrap)
        self.assertIn('.Set("isolatedInstance", IsolatedInstance())', bootstrap)
        route = host[host.index('if (method == "ArdiaTelemetry.post") {'):]
        route = route[:route.index('\n  if (method ==', 1)]
        self.assertIn('ERR_TELEMETRY_REFUSED', route)
        self.assertIn('PostAcceptable(values[0].GetString(), values[1].GetString())', route)
        self.assertIn('values.size() != 2', route)
        self.assertRegex(host, re.compile(r'bool IsolatedInstance\(\) \{\n.*switches::kUserDataDir.*\n.*"ARDIA_DATA_DIR"', re.M))
        build = (LINUX / 'BUILD.gn').read_text()
        for name in ['"ac_linux_telemetry.cc"', '"ac_linux_telemetry.h"', '"ac_linux_telemetry_policy.h"', '"//chrome/browser/net"']:
            self.assertIn(name, build)


if __name__ == '__main__':
    unittest.main()
