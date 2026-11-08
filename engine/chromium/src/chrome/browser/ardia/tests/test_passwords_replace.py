import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest


TESTS = pathlib.Path(__file__).resolve().parent
ROOT = TESTS.parent
STUBS = TESTS / "passwords_replace"
SOURCE = ROOT / "ac_passwords_replace.cc"


@unittest.skipUnless(shutil.which("clang++"), "clang++ is required")
class PasswordsReplaceTests(unittest.TestCase):
    def test_replace_changes_only_the_exact_profile_login(self):
        with tempfile.TemporaryDirectory(prefix="ardia-passwords-replace-") as directory:
            executable = pathlib.Path(directory) / "replace"
            compiled = subprocess.run([
                "clang++", "-std=c++20", "-Wall", "-Wextra", "-Werror", "-Wno-missing-field-initializers", "-g",
                "-fsanitize=address,undefined", "-fno-omit-frame-pointer",
                "-I", str(STUBS), "-I", str(ROOT.parents[2]),
                str(SOURCE), str(STUBS / "scenarios.cc"), "-o", str(executable),
            ], capture_output=True, text=True, timeout=180)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            result = subprocess.run([str(executable)], capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("passwords replace scenarios passed", result.stdout)

    def test_replace_reaches_only_the_profile_store(self):
        text = SOURCE.read_text()
        self.assertIn("ProfilePasswordStoreFactory::GetForProfile", text)
        for other in ("AccountPasswordStoreFactory", "PasswordsPrivateDelegate", "SavedPasswordsPresenter",
                      "ChangeCredential", "AddPassword(", "Reauth"):
            self.assertNotIn(other, text)
        self.assertRegex(text, r"AC_PROFILE_CALL\(ac_passwords_replace, ardia::Sensitive\{")
        passwords = (ROOT / "ac_passwords.cc").read_text()
        self.assertNotIn("ac_passwords_replace", passwords)
        self.assertEqual(len(re.findall(r"^AC_PROFILE_CALL\(ac_passwords_replace\b", text, re.M)), 1)


if __name__ == "__main__":
    unittest.main()
