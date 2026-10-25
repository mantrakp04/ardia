import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import browsing, cli, endpoint, scripts_store, scripts_test, urlmatch, userscript
from ardia_cli.scripts_store import Store, StoreError
from ardia_cli.userscript import Meta, ScriptError, build, parse_meta, url_runs

CHROMIUM_URL_CASES = [
    ("http://*/*", "http://google.com/", True),
    ("http://*/*", "http://yahoo.com/", True),
    ("http://*/*", "http://google.com/foo", True),
    ("http://*/*", "https://google.com/", False),
    ("http://*/*", "http://74.125.127.100/search", True),
    ("https://*/foo*", "https://www.google.com/foo", True),
    ("https://*/foo*", "https://www.google.com/foobar", True),
    ("https://*/foo*", "http://www.google.com/foo", False),
    ("https://*/foo*", "https://www.google.com/", False),
    ("http://*.google.com/foo*bar", "http://google.com/foobar", True),
    ("http://*.google.com/foo*bar", "http://www.google.com/foobar", True),
    ("http://*.google.com/foo*bar", "http://www.google.com/foo?bar", True),
    ("http://*.google.com/foo*bar", "http://wwwgoogle.com/foobar", False),
    ("http://*.google.com/foo*bar", "http://yahoo.com/foobar", False),
    ("file:///foo?bar\\*baz", "file:///foo?bar\\hellobaz", True),
    ("file:///foo?bar\\*baz", "file:///fooXbar\\hellobaz", False),
    ("http://127.0.0.1/*", "http://127.0.0.1/", True),
    ("*://*/*", "http://127.0.0.1/", True),
    ("*://*/*", "file:///foo/bar", False),
    ("<all_urls>", "http://127.0.0.1/", True),
    ("<all_urls>", "file:///foo/bar", True),
    ("file:///foo*", "file:///foo", True),
    ("file:///foo*", "file:///foobar", True),
    ("http://www.example.com:80/foo", "http://www.example.com:80/foo", True),
    ("http://www.example.com:80/foo", "http://www.example.com/foo", True),
    ("http://www.example.com:80/foo", "http://www.example.com:8080/foo", False),
    ("http://www.example.com:*/foo", "http://www.example.com:8080/foo", True),
    ("*://example.com/*", "http://example.com./", True),
    ("*://example.com/*", "http://example.com../", True),
    ("*://example.com./*", "http://example.com/", True),
    ("*://*.gOoGle.com/*", "https://google.com/", True),
    ("*://*.gOoGle.com/*", "https://maps.google.com/", True),
    ("*://*.gOoGle.com/*", "https://example.com/", False),
    ("http://example.com/café/*", "http://example.com/caf%C3%A9", True),
    ("http://example.com/café/*", "http://example.com/caf%C3%A9/file.html", True),
    ("http://example.com/café/*", "http://example.com/CAF%C3%89", False),
    ("http://example.com/caf%C3%A9/*", "http://example.com/caf%C3%A9", True),
    ("http://example.com/foo%E1*", "http://example.com/foo%E1bar", True),
    ("http://example.com/foo%E1*", "http://example.com/foo%E1", True),
    ("http://example.com/foo%E1*", "http://example.com/foo%E2bar", False),
    ("http://*/%40*", "http://x.com/%40abc", True),
    ("http://*/%40*", "http://x.com/@abc", False),
    ("http://[2607:f8b0:4005:805::200e]/*", "http://[2607:f8b0:4005:805:0:0:0:200e]/x", True),
    ("http://[2607:f8b0:4005:805:0:0:0:200e]/*", "http://[2607:f8b0:4005:805::200e]/", True),
    ("http://[2607:f8b0:4005:805::200e]:8888/*", "http://[2607:f8b0:4005:805::200e]:8888/", True),
    ("http://[2607:f8b0:4005:805::200e]:8888/*", "http://[2607:f8b0:4005:805::200e]/", False),
    ("http://*.example.com/*", "http://127.0.0.1/", False),
    ("https://example.com/foo/*", "https://example.com/foo", True),
    ("https://example.com/foo/*", "https://example.com/foobar", False),
    ("http://127.1/*", "http://127.0.0.1/", True),
    ("http://2130706433/*", "http://127.0.0.1/", True),
    ("http://127.0.0.1/*", "http://127.1/", True),
    ("http://0x7f.1/*", "http://127.0.0.1/", True),
    ("https://bücher.example/*", "https://xn--bcher-kva.example/", True),
    ("https://xn--bcher-kva.example/*", "https://bücher.example/x", True),
    ("https://BÜCHER.example/*", "https://xn--bcher-kva.example/", True),
    ("https://example.com/%E2%80%8B*", "https://example.com/%E2%80%8Bx", True),
    ("https://example.com/\u200b*", "https://example.com/%E2%80%8Bx", False),
    ("https://example.com/\u00a0*", "https://example.com/%C2%A0x", False),
    ("https://example.com/%C2%A0*", "https://example.com/%C2%A0x", True),
    ("https://example.com/\u00e9*", "https://example.com/%C3%A9x", True),
    ("https://example.com/\u2800*", "https://example.com/%E2%A0%80", False),
    ("https://example.com/\u3164*", "https://example.com/%E3%85%A4", False),
    ("https://example.com/\U0001f511*", "https://example.com/%F0%9F%94%91", True),
    ("https://example.com/\U0001f513*", "https://example.com/%F0%9F%94%93", False),
]

CHROMIUM_PATTERN_CASES = [
    ("www.google.com", "*.com", True),
    ("www.google.com", "*", True),
    ("www.google.com", "www*.g*.org", False),
    ("Hello", "H?l?o", True),
    ("www.google.com", "http://*)", False),
    ("www.msn.com", "*.COM", False),
    ("Hello*1234", "He??o\\*1*", True),
    ("", "*.*", False),
    ("", "*", True),
    ("", "?", True),
    ("", "", True),
    ("Hello", "", False),
    ("Hello*", "Hello*", True),
    ("abcd", "*???", True),
    ("abcd", "???", False),
    ("abcb", "a*b", True),
    ("abcb", "a?b", False),
    ("heart: ♠", "*♠", True),
    ("heart: ♠.", "heart: ?.", True),
    ("hearts: ♠♠", "*", True),
    ("Hello", "He********************************o", True),
    ("123456789012345678", "?????????????????*", True),
    ("aaaaaaaaaaab", "a*a*a*a*a*a*a*a*a*a*a*b", True),
]

GLOB_URL_CASES = [
    ("https://example.com/*a?b", "https://example.com/aacb", False),
    ("https://example.com/*a?b", "https://example.com/xacb", True),
    ("https://example.com/*a?b", "https://example.com/xab", True),
    ("https://example.org/a?c", "https://example.org/ac", True),
    ("https://example.org/a?c", "https://example.org/abc", True),
    ("https://example.org/a?c", "https://example.org/abbc", False),
    ("https://example.org/\\*", "https://example.org/*", True),
    ("https://example.org/\\*", "https://example.org/x", False),
    ("*logout*", "https://example.org/logout", True),
]

INVALID_PATTERNS = [
    "http://*foo/bar",
    "http://foo.*.bar/baz",
    "http://bar",
    "http://",
    "http:///",
    "http://:1234/",
    "http://*./",
    "http://foo:/",
    "http://foo:com/",
    "http://foo:123456/",
    "http://foo:80:80/monkey",
    "http://foo.*/bar",
    "http://[2607:f8b0:4005:805::200e]:/*",
    "http://[]:8888/*",
    "http://[2607:f8b0:4005:805::200e/*",
    "http://[2607:f8b0:4005:805::200e]]/*",
    "http://[[2607:f8b0:4005:805::200e]/*",
    "http://[2607:f8b0:4005:805:200e]/*",
    "http://[2607:f8b0:4005:805:200e:12:bogus]/*",
    "https://[2607:f8b0:4005:805:200e]/*",
    "*://example.com:8080/*",
    "wss://example.com/*",
    "chrome://settings/*",
    "https://exa mple.com/*",
    "https://999.1.1.1/*",
    "https://example.com:070/*",
    "http://[fe80::1%25en0]/*",
    "http://[fe80::1%en0]/*",
    "http://exa%6Dple.com/*",
    "http://1.2.3.4.5/*",
    "http://example.123/*",
    "http://256.1.1.1/*",
    "https://stra\u00dfe.de/*",
]

VALID_PATTERNS = [
    "http://foo:1234/",
    "http://foo:1234/bar",
    "http://*.foo:1234/",
    "http://*:1234/",
    "http://*:*/",
    "http://foo:*/",
    "http://*/:1234",
    "http://*.foo/bar:1234",
    "http://[2607:f8b0:4005:805::200e]/",
    "http://[2607:f8b0:4005:805::200e]:8888/*",
    "file://localhost/foo*",
    "http://127.1/*",
    "https://bücher.example/*",
    "https://é.com/*",
    "<all_urls>",
]


def meta_for(matches=(), exclude_matches=(), includes=(), excludes=()) -> Meta:
    return Meta(name="t", matches=list(matches), exclude_matches=list(exclude_matches), includes=list(includes), excludes=list(excludes))


def all_cases():
    cases = [(meta_for(matches=[pattern]), url, expected) for pattern, url, expected in CHROMIUM_URL_CASES]
    cases += [(meta_for(includes=[glob]), url, expected) for glob, url, expected in GLOB_URL_CASES]
    cases.append((meta_for(["https://example.com/*"], ["https://example.com:443/*"]), "https://example.com/", False))
    cases.append((meta_for(["https://example.com/*"], excludes=["*logout*"]), "https://example.com/logout", False))
    cases.append((meta_for(includes=["*example.org*"]), "file:///example.org", False))
    return cases


class Matching(unittest.TestCase):
    def test_python_matches_chromium(self):
        for meta, url, expected in all_cases():
            with self.subTest(url=url, matches=meta.matches, includes=meta.includes):
                self.assertEqual(url_runs(meta, url), expected)

    def test_match_pattern_port(self):
        for string, pattern, expected in CHROMIUM_PATTERN_CASES:
            with self.subTest(string=string, pattern=pattern):
                self.assertEqual(urlmatch.match_pattern(urlmatch.decode(string.encode()), urlmatch.decode(pattern.encode())), expected)
        self.assertTrue(urlmatch.match_pattern(urlmatch.decode(b"invalid: \xef\xbf\xbe"), urlmatch.decode(b"invalid: ?")))
        self.assertFalse(urlmatch.match_pattern(urlmatch.decode(b"\xf4\x90\x80\x80"), urlmatch.decode(b"\xf4\x90\x80\x80")))

    @unittest.skipUnless(shutil.which("node"), "node isn't installed")
    def test_wrapper_agrees(self):
        cases = [{"rules": userscript.rules(meta), "url": url, "expected": expected} for meta, url, expected in all_cases()]
        program = f"const match = {scripts_test.MATCHER};\nconst cases = {json.dumps(cases)};\n" + (
            "console.log(JSON.stringify(cases.map((c) => (match(c.rules, c.url) === 'run') === c.expected)));"
        )
        result = subprocess.run(["node", "-e", program], capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        verdicts = json.loads(result.stdout)
        failed = [(case["url"], case["expected"]) for case, ok in zip(cases, verdicts) if not ok]
        self.assertEqual(failed, [])

    def test_bad_patterns(self):
        for pattern in INVALID_PATTERNS:
            with self.subTest(pattern=pattern), self.assertRaises(ScriptError):
                parse_meta(f"// ==UserScript==\n// @match {pattern}\n// ==/UserScript==\n", "x.user.js")

    def test_good_patterns(self):
        for pattern in VALID_PATTERNS:
            with self.subTest(pattern=pattern):
                parse_meta(f"// ==UserScript==\n// @match {pattern}\n// ==/UserScript==\n", "x.user.js")


@unittest.skipUnless(userscript.find_esbuild(), "esbuild isn't available")
class Confinement(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="ardia-cli-test-")).resolve()
        self.tree = self.work / "tree"
        (self.tree / "lib").mkdir(parents=True)
        (self.tree / "lib" / "ok.ts").write_text("export const ok = 1;\n")
        (self.work / "secret.js").write_text("export default 1;\n")
        self.data = self.tree / "data"
        (self.data / "Chromium").mkdir(parents=True)
        (self.data / "Chromium" / "ArdiaControl.json").write_text('{"token": "x"}\n')

    def tearDown(self):
        shutil.rmtree(self.work, ignore_errors=True)

    def script(self, body: str) -> Path:
        path = self.tree / "s.user.ts"
        path.write_text("// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==\n" + body)
        return path

    def test_inside_tree_builds(self):
        built = build(self.script('import { ok } from "./lib/ok";\nconsole.log(ok);\n'), data_dirs=[self.data])
        self.assertIn("console.log(ok)", built.js)

    def test_outside_tree_refused(self):
        with self.assertRaisesRegex(ScriptError, "inside"):
            build(self.script('import s from "../secret.js";\nconsole.log(s);\n'), data_dirs=[self.data])

    def test_symlink_out_refused(self):
        os.symlink(self.work / "secret.js", self.tree / "link.js")
        with self.assertRaisesRegex(ScriptError, "inside"):
            build(self.script('import s from "./link.js";\nconsole.log(s);\n'), data_dirs=[self.data])

    def test_data_dir_refused_even_inside(self):
        with self.assertRaisesRegex(ScriptError, "data folder"):
            build(self.script('import s from "./data/Chromium/ArdiaControl.json";\nconsole.log(s);\n'), data_dirs=[self.data])

    def test_data_dir_by_identity_not_spelling(self):
        support = self.tree / "support"
        data = support / "com.ardia.browser"
        (data / "Chromium").mkdir(parents=True)
        (data / "Chromium" / "secret.js").write_text("export default 1;\n")
        path = support / "s.user.ts"
        path.write_text("// ==UserScript==\n// @match https://example.com/*\n// ==/UserScript==\nimport s from \"./COM.ARDIA.BROWSER/Chromium/secret.js\";\nconsole.log(s);\n")
        if not (support / "COM.ARDIA.BROWSER").exists():
            self.skipTest("case-sensitive file system")
        with self.assertRaisesRegex(ScriptError, "data folder"):
            build(path, data_dirs=[data])

    def test_non_source_imports_refused(self):
        (self.tree / "lib" / "data.json").write_text('{"a": 1}\n')
        with self.assertRaisesRegex(ScriptError, "source"):
            build(self.script('import d from "./lib/data.json";\nconsole.log(d);\n'), data_dirs=[self.data])

    def test_hard_links_refused(self):
        os.link(self.tree / "lib" / "ok.ts", self.tree / "lib" / "again.ts")
        with self.assertRaisesRegex(ScriptError, "hard links"):
            build(self.script('import { ok } from "./lib/again";\nconsole.log(ok);\n'), data_dirs=[self.data])

    def test_tsconfig_ignored(self):
        (self.tree / "tsconfig.json").write_text('{"compilerOptions": {"paths": {"@s": ["../secret.js"]}}}')
        with self.assertRaises(ScriptError):
            build(self.script('import s from "@s";\nconsole.log(s);\n'), data_dirs=[self.data])


class Stores(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ardia-cli-store-")).resolve()

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def built(self, name: str, match: str = "https://example.com/*"):
        source = f"// ==UserScript==\n// @name {name}\n// @match {match}\n// ==/UserScript==\nconsole.log(1);\n"
        path = self.root / f"{name}.user.js"
        path.write_text(source)
        return userscript.Build(parse_meta(source, path.name), source, path, "console.log(1);\n", None, [])

    def test_install_uninstall_generations(self):
        with Store(self.root) as store:
            _, first = store.apply(add=self.built("a"))
            _, second = store.apply(add=self.built("b"))
            self.assertEqual(store.extension_generation(), second)
            _, third = store.apply(remove="a")
            _, fourth = store.apply(remove="b")
            self.assertFalse(store.extension_present())
            self.assertEqual(store.generation(), fourth)
        self.assertEqual([first, second, third, fourth], [1, 2, 3, 4])
        self.assertEqual(sorted(os.listdir(self.root / "Scripts" / "scripts")), [])
        self.assertEqual(sorted(p for p in os.listdir(self.root / "Scripts") if p.startswith(".") and p != ".lock"), [])

    def test_failed_publish_rolls_back(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
            before = (self.root / "Scripts" / "extension" / "manifest.json").read_text()
            with mock.patch.object(Store, "commit_record", side_effect=OSError("boom")), self.assertRaises(OSError):
                store.apply(add=self.built("b"))
            self.assertEqual((self.root / "Scripts" / "extension" / "manifest.json").read_text(), before)
            self.assertEqual([m["id"] for m in store.installed()], ["a"])
            self.assertEqual(store.generation(), 1)
        leftovers = [p for p in os.listdir(self.root / "Scripts") if p.startswith(".") and p != ".lock"]
        self.assertEqual(leftovers, [])

    def test_crash_before_generation_recovers(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
            with mock.patch.object(scripts_store, "write_atomic", side_effect=OSError("crash")), self.assertRaises(OSError):
                store.apply(add=self.built("b"))
            self.assertEqual(store.generation(), 1)
            self.assertEqual(store.extension_generation(), 2)
            _, generation = store.apply(add=self.built("c"))
            self.assertEqual(generation, 3)
            self.assertEqual(store.generation(), store.extension_generation())

    def test_symlinked_scripts_refused(self):
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        os.symlink(elsewhere, self.root / "Scripts")
        with self.assertRaises(StoreError):
            with Store(self.root):
                pass

    def test_symlinked_record_refused(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
        os.symlink(self.root, self.root / "Scripts" / "scripts" / "evil")
        with self.assertRaises(StoreError), Store(self.root) as store:
            store.installed()

    def test_engine_limits(self):
        entry = {"matches": ["https://example.com/*"], "exclude_matches": [], "include_globs": [], "exclude_globs": [], "js": ["js/a.js"], "run_at": "document_end", "all_frames": True, "world": "MAIN"}
        manifest = {"manifest_version": 3, "name": "n", "version": "1", "description": "d", "content_scripts": [entry]}
        scripts_store.validate_manifest(manifest, {"js/a.js"})
        with self.assertRaisesRegex(StoreError, "256"):
            scripts_store.validate_manifest({**manifest, "content_scripts": [entry] * 257}, {"js/a.js"})
        many = [f"js/{i}.js" for i in range(513)]
        with self.assertRaisesRegex(StoreError, "512"):
            scripts_store.validate_manifest({**manifest, "content_scripts": [{**entry, "js": many[i : i + 3]} for i in range(0, 513, 3)]}, set(many))
        with self.assertRaises(StoreError):
            scripts_store.validate_manifest({**manifest, "content_scripts": [{**entry, "js": many[:257]}]}, set(many))

    def test_repair_publishes_a_stranded_generation(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
            with mock.patch.object(scripts_store, "write_atomic", side_effect=OSError("crash")), self.assertRaises(OSError):
                store.apply(add=self.built("b"))
        self.assertIn("published", scripts_store.repair_if_present(self.root))
        with Store(self.root) as store:
            self.assertEqual(store.generation(), 2)
            self.assertEqual(store.extension_generation(), 2)
        self.assertIsNone(scripts_store.repair_if_present(self.root))

    def test_repair_rebuilds_a_mismatch(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
        shutil.rmtree(self.root / "Scripts" / "extension")
        self.assertIn("rebuilt", scripts_store.repair_if_present(self.root))
        with Store(self.root) as store:
            self.assertTrue(store.extension_present())
            self.assertEqual(store.generation(), store.extension_generation())
        shutil.rmtree(self.root / "Scripts" / "scripts" / "a")
        self.assertIn("rebuilt", scripts_store.repair_if_present(self.root))
        with Store(self.root) as store:
            self.assertFalse(store.extension_present())

    def test_repair_without_scripts_does_nothing(self):
        self.assertIsNone(scripts_store.repair_if_present(self.root))
        self.assertFalse((self.root / "Scripts").exists())

    def test_uninstall_last_publishes_before_removing(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
            calls = []
            original = scripts_store.write_atomic

            def write_once(*args):
                calls.append(args)
                if len(calls) > 1:
                    raise OSError("crash")
                return original(*args)

            with mock.patch.object(scripts_store, "write_atomic", side_effect=write_once), self.assertRaises(OSError):
                store.apply(remove="a")
            self.assertEqual(store.generation(), 2)
            self.assertFalse(store.extension_present())
            self.assertEqual(store.installed(), [])
        self.assertIsNone(scripts_store.repair_if_present(self.root))

    def test_repair_republishes_a_stranded_uninstall(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
        shutil.rmtree(self.root / "Scripts" / "extension")
        shutil.rmtree(self.root / "Scripts" / "scripts" / "a")
        (self.root / "Scripts" / "status.json").write_text(json.dumps({"generation": 1, "profiles": {"Personal": {"ok": True}}}))
        self.assertIn("uninstall", scripts_store.repair_if_present(self.root))
        self.assertEqual((self.root / "Scripts" / "generation").read_text().strip(), "2")
        (self.root / "Scripts" / "status.json").write_text(json.dumps({"generation": 2, "profiles": {"Personal": {"removed": True}}}))
        self.assertIsNone(scripts_store.repair_if_present(self.root))

    def test_repair_rebuilds_an_old_extension(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
        (self.root / "Scripts" / "generation").write_text("5\n")
        self.assertIn("older", scripts_store.repair_if_present(self.root))
        with Store(self.root) as store:
            self.assertEqual(store.generation(), 6)
            self.assertEqual(store.extension_generation(), 6)

    def test_invalid_manifest_never_published(self):
        with Store(self.root) as store:
            store.apply(add=self.built("a"))
            bad = self.built("b")
            bad.meta.matches = ["https://example.com:99999/*"]
            with self.assertRaises(StoreError):
                store.apply(add=bad)
            self.assertEqual([m["id"] for m in store.installed()], ["a"])
            self.assertEqual(store.generation(), 1)


class ReadOnlyDefaults(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="ardia-cli-default-")).resolve()
        self.default = self.root / "com.ardia.browser"
        self.default.mkdir()
        self.work = self.root / "work"
        self.work.mkdir()
        self.script = self.work / "s.user.js"
        self.script.write_text("// ==UserScript==\n// @name s\n// @match https://example.com/*\n// ==/UserScript==\nconsole.log(1);\n")
        patches = [
            mock.patch.object(endpoint, "installed_data_dir", lambda: self.default),
            mock.patch.dict(os.environ, {}, clear=False),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        for name in ("ARDIA_DATA_DIR", "ARDIA_CDP_URL"):
            os.environ.pop(name, None)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def run_cli(self, *argv) -> int:
        import contextlib
        import io

        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return cli.main(list(argv))

    def snapshot(self) -> dict:
        found = {}
        for path in sorted(self.default.rglob("*")):
            found[str(path.relative_to(self.default))] = path.read_bytes() if path.is_file() else None
        return found

    def crash(self):
        source = self.script.read_text()
        built = userscript.Build(parse_meta(source, self.script.name), source, self.script, "console.log(1);\n", None, [])
        with Store(self.default) as store:
            store.apply(add=built)
        (self.default / "Scripts" / "generation").write_text("0\n")

    @unittest.skipUnless(userscript.find_esbuild(), "esbuild isn't available")
    def test_test_against_a_test_server_creates_nothing(self):
        self.assertEqual(self.run_cli("scripts", "test", str(self.script), "--port", "1"), 2)
        self.assertFalse((self.default / "Scripts").exists())

    @unittest.skipUnless(userscript.find_esbuild(), "esbuild isn't available")
    def test_test_never_repairs(self):
        self.crash()
        before = self.snapshot()
        self.run_cli("scripts", "test", str(self.script), "--port", "1")
        self.run_cli("scripts", "test", str(self.script), "--port", "1", "--data-dir", str(self.default))
        self.assertEqual(self.snapshot(), before)

    def test_list_repairs_only_a_trusted_data_dir(self):
        self.crash()
        before = self.snapshot()
        self.assertEqual(self.run_cli("scripts", "list"), 0)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.run_cli("scripts", "list", "--data-dir", str(self.default)), 0)
        self.assertEqual((self.default / "Scripts" / "generation").read_text().strip(), "1")

    def test_list_json_is_pure_json(self):
        import contextlib
        import io

        self.crash()
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(cli.main(["scripts", "list", "--json", "--data-dir", str(self.default)]), 0)
        data = json.loads(out.getvalue())
        self.assertIn("published", data["repaired"])

    def test_list_without_scripts_creates_nothing(self):
        self.assertEqual(self.run_cli("scripts", "list"), 0)
        self.assertEqual(self.run_cli("scripts", "list", "--data-dir", str(self.default)), 0)
        self.assertFalse((self.default / "Scripts").exists())


class Deadlines(unittest.TestCase):
    def test_progress_handler_interrupts(self):
        import sqlite3
        import time

        connection = browsing.connect(":memory:", time.monotonic() + 0.2)
        started = time.monotonic()
        self.addCleanup(connection.close)
        with self.assertRaises(sqlite3.OperationalError):
            connection.execute("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n) SELECT count(*) FROM n").fetchone()
        self.assertLess(time.monotonic() - started, 2)

    def test_exit_hook_stops_workers_and_cleans(self):
        import threading
        import time

        self.addCleanup(setattr, browsing, "_closing", False)
        work = browsing.new_work_dir()
        stopped = threading.Event()

        def worker():
            while not browsing._closing:
                time.sleep(0.01)
            with self.assertRaises(browsing.OutOfTime):
                browsing.new_work_dir()
            stopped.set()
            with browsing._state:
                browsing._workers.discard(thread)

        thread = threading.Thread(target=worker, daemon=True)
        with browsing._state:
            browsing._workers.add(thread)
        thread.start()
        browsing._shut_down()
        self.assertTrue(stopped.is_set())
        self.assertFalse(Path(work).exists())
        with self.assertRaises(browsing.OutOfTime):
            browsing.out_of_time(time.monotonic() + 10, "x")

    def test_run_bounded_returns_promptly(self):
        import asyncio
        import time

        def slow(deadline):
            time.sleep(5)

        async def main():
            started = time.monotonic()
            with self.assertRaises(browsing.OutOfTime):
                await browsing.run_bounded(slow, budget=0.2)
            return time.monotonic() - started

        self.assertLess(asyncio.run(main()), 3)


if __name__ == "__main__":
    unittest.main()
