import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest


TESTS = pathlib.Path(__file__).resolve().parent
ROOT = TESTS.parent
STUBS = TESTS / "reauth_linux"


@unittest.skipUnless(shutil.which("clang++"), "clang++ is required")
class LinuxReauthTests(unittest.TestCase):
    def build(self, directory):
        executable = pathlib.Path(directory) / "reauth"
        result = subprocess.run([
            "clang++", "-std=c++20", "-Wall", "-Wextra", "-Werror", "-g",
            "-fsanitize=address,undefined", "-fno-omit-frame-pointer",
            "-I", str(STUBS), "-I", str(ROOT.parents[2]),
            str(ROOT / "ac_reauth_linux.cc"), str(STUBS / "scenarios.cc"), "-o", str(executable),
        ], capture_output=True, text=True, timeout=180)
        self.assertEqual(result.returncode, 0, result.stderr)
        return executable

    def test_polkit_outcomes_validity_and_supersession(self):
        with tempfile.TemporaryDirectory(prefix="ardia-reauth-") as directory:
            executable = self.build(directory)
            env = dict(os.environ, ARDIA_BACKGROUND="1", ARDIA_TEST_REAUTH="granted", ARDIA_TEST="reauth=grant")
            result = subprocess.run([str(executable)], capture_output=True, text=True, timeout=60, env=env)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("reauth scenarios passed", result.stdout)
            wrong_thread = subprocess.run([str(executable), "wrong-thread"], capture_output=True, timeout=60)
            self.assertNotEqual(wrong_thread.returncode, 0)


if __name__ == "__main__":
    unittest.main()
