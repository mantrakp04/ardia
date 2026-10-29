import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest


TESTS = pathlib.Path(__file__).resolve().parent
ROOT = TESTS.parent
STUBS = TESTS / "secret_reply"
BUILD_CONFIG = "#pragma once\n#define BUILDFLAG(flag) (BUILDFLAG_INTERNAL_##flag())\n#define BUILDFLAG_INTERNAL_IS_LINUX() (1)\n"


def body(source, start):
    begin = source.index(start)
    depth = 0
    for index in range(source.index("{", begin), len(source)):
        depth += {"{": 1, "}": -1}.get(source[index], 0)
        if depth == 0:
            return source[begin:index + 1]
    raise AssertionError(f"unterminated {start}")


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


def linux_branch(block):
    begin = block.index("#if BUILDFLAG(IS_LINUX)")
    middle = block.index("#else", begin)
    end = block.index("#endif", middle)
    return block[begin:middle], block[middle:end]


class SecretReplyWiringTests(unittest.TestCase):
    def test_reply_sends_secrets_through_the_wiping_serializer_on_linux_only(self):
        header = (ROOT / "ac_engine.h").read_text()
        declaration = header.index("void SendSecret(base::DictValue result);")
        self.assertLess(header.rindex("#if BUILDFLAG(IS_LINUX)", 0, declaration), declaration)
        self.assertLess(declaration, header.index("#endif", declaration))
        engine = (ROOT / "ac_engine.cc").read_text()
        send = body(engine, "void Reply::SendSecret(base::DictValue result) {")
        self.assertIn("SendSecretJson(std::move(result), reply, context);", send)
        keyed = body(engine, "void Reply::SendSecret(std::string_view key, std::u16string* secret) {")
        self.assertIn("SecretUTF8(*secret)", keyed)
        self.assertIn("Cleanse(utf8);", keyed)
        self.assertIn("Cleanse(*secret);", keyed)
        self.assertIn("SendSecret(std::move(result));", keyed)
        self.assertLess(engine.rindex("#if BUILDFLAG(IS_LINUX)", 0, engine.index("void Reply::SendSecret(std::string_view key")), engine.index("void Reply::SendSecret(std::string_view key"))
        self.assertLess(engine.index("void Reply::SendSecret(std::string_view key"), engine.index("#endif", engine.index("void Reply::SendSecret(std::string_view key")))
        definition = engine.index("void Reply::SendSecret(base::DictValue result) {")
        self.assertLess(engine.rindex("#if BUILDFLAG(IS_LINUX)", 0, definition), definition)
        args = (ROOT / "ac_sensitive_args.h").read_text()
        for name in ["std::string SecretUTF8(std::u16string_view text);", "void SendSecretJson("]:
            at = args.index(name)
            self.assertLess(args.rindex("#if BUILDFLAG(IS_LINUX)", 0, at), at)
            self.assertLess(at, args.index("#endif", at))

    def test_reveal_and_card_number_wipe_on_linux_and_keep_macos_unchanged(self):
        passwords = (ROOT / "ac_passwords.cc").read_text()
        linux, other = linux_branch(body(passwords, "AC_PROFILE_CALL(ac_passwords_reveal) {"))
        self.assertIn("reply.SendSecret(", linux)
        self.assertIn("credential ? &credential->password : nullptr", linux)
        self.assertNotIn('result.Set("password", credential->password);', linux)
        self.assertIn('result.Set("password", credential->password);', other)
        self.assertIn("reply.Send(std::move(result));", other)
        self.assertNotIn("Cleanse", other)
        autofill = (ROOT / "ac_autofill.cc").read_text()
        linux, other = linux_branch(body(autofill, "AC_PROFILE_CALL(ac_autofill_card_number) {"))
        self.assertIn("ardia::SecretUTF8(raw)", linux)
        flat = re.sub(r"\s+", " ", linux)
        self.assertIn("std::string number = ardia::autofill_internal::Digits(utf8);", flat)
        self.assertNotRegex(flat, r"(?<!std::string )number = ")
        self.assertLess(linux.index("ardia::Cleanse(raw);"), linux.index('result.Set("number"'))
        self.assertLess(linux.index("ardia::Cleanse(utf8);"), linux.index('result.Set("number"'))
        self.assertIn("ardia::Cleanse(number);", linux)
        self.assertIn("reply.SendSecret(std::move(result));", linux)
        self.assertNotIn("UTF16ToUTF8", linux)
        self.assertIn("base::UTF16ToUTF8(card->GetRawInfo(", other)
        self.assertIn("reply.Send(std::move(result));", other)
        self.assertNotIn("Cleanse", other)
        digits = body(autofill, "std::string Digits(const std::string& text) {")
        self.assertNotIn("reserve", digits)

    def test_no_comments_in_the_new_sources(self):
        for path in [ROOT / "ac_sensitive_args.cc", ROOT / "ac_sensitive_args.h", *STUBS.rglob("*.h"), STUBS / "scenarios.cc"]:
            text = path.read_text()
            lines = [line for line in text.splitlines() if not line.startswith("// Copyright")]
            self.assertIsNone(re.search(r"(^|\s)//", "\n".join(lines)), path)
            self.assertNotIn("/*", text, path)


if __name__ == "__main__":
    unittest.main()
