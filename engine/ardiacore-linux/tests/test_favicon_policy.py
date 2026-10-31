import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src'

CASES = r'''
#include "ardia/linux/ac_linux_favicon_policy.h"
#include <cassert>
#include <string>
using namespace ardiacore::linux_favicons;
int main() {
  assert(Allowed("https://example.test/favicon.ico", Source::kNetwork));
  assert(Allowed("HTTP://example.test/a.png", Source::kNetwork));
  assert(!Allowed("data:image/png;base64,AAAA", Source::kNetwork));
  assert(Allowed("data:image/png;base64,AAAA", Source::kPage));
  assert(!Allowed("data:text/html,x", Source::kPage));
  assert(!Allowed("file:///etc/passwd", Source::kPage) && !Allowed("chrome://settings", Source::kPage));
  assert(!Allowed("javascript:alert(1)", Source::kPage) && !Allowed("", Source::kNetwork));
  assert(!Allowed(std::string(kMaxUrlLength + 1, 'h'), Source::kNetwork));
  assert(Pick({}) == -1 && Pick({{0, 0}, {-1, 5}}) == -1);
  assert(Pick({{16, 16}, {32, 32}, {48, 48}}) == 2);
  assert(Pick({{16, 16}, {256, 256}, {96, 96}, {64, 64}}) == 3);
  assert(Pick({{128, 128}, {96, 96}}) == 1);
  assert(Pick({{16, 16}, {0, 0}}) == 0);
  assert(Fit(16, 16) == std::make_pair(16, 16));
  assert(Fit(64, 64) == std::make_pair(64, 64));
  assert(Fit(256, 128) == std::make_pair(64, 32));
  assert(Fit(4000, 1) == std::make_pair(64, 1));
  assert(Fit(0, 10) == std::make_pair(0, 0) && Fit(10, -1) == std::make_pair(0, 0));
  for (const char* host : {"example.test", "8.8.8.8", "93.184.216.34", "[2606:4700::1111]", "[2001:4860:4860::8888]", "icons.example.com.", "localhost.example.com", "172.32.0.1", "100.128.0.1"})
    assert(PublicHost(host));
  for (const char* host : {"", "localhost", "LOCALHOST", "localhost.", "a.localhost", "localhost.localdomain", "printer.local", "nas.internal", "box.home.arpa",
                           "127.0.0.1", "127.255.0.9", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
                           "[::1]", "[::]", "[fc00::1]", "[fd12:3456::1]", "[fe80::1]", "[ff02::1]", "[::ffff:7f00:1]", "[::ffff:c0a8:101]", "[::7f00:1]", "[64:ff9b::a00:1]", "[2001:db8::1]", "[", "[::1", "[zz::1]", "[1:2:3:4:5:6:7:8:9]"})
    assert(!PublicHost(host));
  return 0;
}
'''


class FaviconPolicyTests(unittest.TestCase):
    def test_bounded_schemes_size_choice_and_fit(self):
        with tempfile.TemporaryDirectory(prefix='ardia-favicon-policy-') as directory:
            source = Path(directory) / 'cases.cc'
            source.write_text(CASES)
            binary = Path(directory) / 'cases'
            subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++20', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined', '-I', str(SOURCE), str(source), '-o', str(binary)], check=True, timeout=60)
            subprocess.run([str(binary)], check=True, timeout=10)


if __name__ == '__main__':
    unittest.main()
