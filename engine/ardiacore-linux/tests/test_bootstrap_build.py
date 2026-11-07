import pathlib
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'src/ardia/linux'


class BootstrapBuildTests(unittest.TestCase):
    def test_generated_header_compiles_and_preserves_javascript(self):
        compiler = shutil.which('clang++') or shutil.which('c++')
        if compiler is None:
            self.skipTest('C++ compiler is unavailable')
        with tempfile.TemporaryDirectory(prefix='ardia-bootstrap-test-') as scratch:
            scratch = pathlib.Path(scratch)
            header = scratch / 'host_bootstrap.h'
            subprocess.run(['python3', str(SOURCE / 'generate_bootstrap.py'), '--input', str(SOURCE / 'bootstrap.js'), '--output', str(header)], check=True)
            first = header.read_bytes()
            subprocess.run(['python3', str(SOURCE / 'generate_bootstrap.py'), '--input', str(SOURCE / 'bootstrap.js'), '--output', str(header)], check=True)
            self.assertEqual(first, header.read_bytes())
            cpp = scratch / 'bootstrap.cc'
            cpp.write_text('#include <cstdio>\n#include "host_bootstrap.h"\nint main() { std::fputs(ardia::kArdiaHostBootstrap, stdout); }\n')
            binary = scratch / 'bootstrap'
            subprocess.run([compiler, '-std=c++17', str(cpp), '-o', str(binary)], check=True, capture_output=True)
            self.assertEqual(subprocess.check_output([str(binary)]), (SOURCE / 'bootstrap.js').read_bytes())

    def test_literal_delimiter_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='ardia-bootstrap-test-') as scratch:
            scratch = pathlib.Path(scratch)
            source = scratch / 'bad.js'
            source.write_text(')ardia_bootstrap"')
            result = subprocess.run(['python3', str(SOURCE / 'generate_bootstrap.py'), '--input', str(source), '--output', str(scratch / 'bad.h')], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse((scratch / 'bad.h').exists())


if __name__ == '__main__':
    unittest.main()
