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

    def test_linux_reauth_has_no_test_grant_or_secret_logging(self):
        source = (ROOT / "ac_reauth_linux.cc").read_text()
        for forbidden in ("TestValue", "TestFlag", "LOG(", "VLOG(", "granted\")", "auth_admin"):
            self.assertNotIn(forbidden, source)
        self.assertIn("ardiacore::BackgroundInstance()", source)

    def test_packaged_policy_declares_the_checked_action(self):
        header = (ROOT / "ac_reauth_linux_policy.h").read_text()
        policy = (ROOT.parents[5] / "scripts/linux/dev.ardia.linux.policy").read_text()
        action = header.split('kPolkitAction[] = "')[1].split('"')[0]
        self.assertIn(f'<action id="{action}">', policy)
        self.assertIn("<allow_active>auth_self</allow_active>", policy)


if __name__ == "__main__":
    unittest.main()
