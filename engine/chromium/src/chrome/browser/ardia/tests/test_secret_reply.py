import pathlib
import shutil
import subprocess
import tempfile
import unittest


TESTS = pathlib.Path(__file__).resolve().parent
ROOT = TESTS.parent
STUBS = TESTS / "secret_reply"
BUILD_CONFIG = "#pragma once\n#define BUILDFLAG(flag) (BUILDFLAG_INTERNAL_##flag())\n#define BUILDFLAG_INTERNAL_IS_LINUX() (1)\n"


@unittest.skipUnless(shutil.which("clang++"), "clang++ is required")
class SecretReplyFixtureTests(unittest.TestCase):
    def test_serialized_secret_is_wiped_after_the_reply_callback(self):
        with tempfile.TemporaryDirectory(prefix="ardia-secret-reply-") as directory:
            executable = pathlib.Path(directory) / "secret-reply"
            (pathlib.Path(directory) / "build").mkdir()
            (pathlib.Path(directory) / "build/build_config.h").write_text(BUILD_CONFIG)
            compiled = subprocess.run([
                "clang++", "-std=c++20", "-Wall", "-Wextra", "-Werror", "-g", "-O0",
                "-fsanitize=undefined", "-fno-omit-frame-pointer", "-fno-builtin",
                "-I", str(STUBS), "-I", directory, "-I", str(ROOT.parents[2]),
                str(ROOT / "ac_sensitive_args.cc"), str(STUBS / "scenarios.cc"), "-o", str(executable),
            ], capture_output=True, text=True, timeout=180)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            result = subprocess.run([str(executable)], capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("secret reply scenarios passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
