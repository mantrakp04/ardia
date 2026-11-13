import os
import plistlib
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import caller
from ardia_cli.caller import Caller, Process

T3 = "/Applications/T3 Code (Nightly).app/Contents/MacOS/T3 Code (Nightly)"


def chain(*processes):
    return [Process(index + 100, index + 101, path, tuple(argv)) for index, (path, argv) in enumerate(processes)]


class FakeReader:
    def __init__(self, table):
        self.table = table

    def process(self, pid):
        return self.table.get(pid)


class Naming(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.temp = Path(temp.name)

    def bundle(self, folder, **info):
        root = self.temp / folder
        (root / "Contents" / "MacOS").mkdir(parents=True)
        if info:
            (root / "Contents" / "Info.plist").write_bytes(plistlib.dumps(info, fmt=plistlib.FMT_BINARY))
        return root

    def test_a_known_agent_anywhere_in_the_chain_wins_over_the_app(self):
        found = caller.from_chain(chain(
            ("/bin/zsh", ["/bin/zsh", "-c"]),
            ("/Users/me/.local/share/claude/versions/2.1.319", ["claude", "--output-format"]),
            (T3, [T3]),
        ), lambda bundle: "T3 Code (Nightly)")
        self.assertEqual(found, Caller("Claude Code"))

    def test_agents_run_by_an_interpreter_or_under_a_versioned_binary(self):
        cases = {
            ("/opt/homebrew/Cellar/node/24/bin/node", ("node", "/opt/homebrew/bin/codex", "exec")): "Codex",
            ("/usr/bin/python3", ("/usr/bin/python3", "/Users/me/.local/bin/aider")): "Aider",
            ("/Users/me/.bun/bin/bun", ("bun", "/Users/me/.bun/bin/opencode.js")): "OpenCode",
            ("/Users/me/.local/bin/cursor-agent", ("cursor-agent",)): "Cursor Agent",
            ("/opt/homebrew/bin/gemini", ()): "Gemini CLI",
        }
        for (path, argv), name in cases.items():
            self.assertEqual(caller.from_chain([Process(5, 1, path, argv)]).name, name, path)

    def test_an_interpreter_running_something_else_is_not_an_agent(self):
        found = caller.from_chain([Process(5, 1, "/usr/bin/python3", ("python3", "-c", "claude"))])
        self.assertEqual(found, Caller("ardia"))

    def test_the_outermost_app_bundle_names_the_caller(self):
        app = self.bundle("Visual Studio Code.app", CFBundleName="Code")
        helper = app / "Contents" / "Frameworks" / "Code Helper (Plugin).app" / "Contents" / "MacOS" / "Code Helper (Plugin)"
        found = caller.from_chain(chain(("/bin/zsh", ["-zsh"]), (str(helper), [str(helper)])))
        self.assertEqual(found, Caller("Code", str(app)))

    def test_display_name_first_then_bundle_name_then_folder(self):
        ghostty = self.bundle("Ghostty.app", CFBundleDisplayName="Ghostty", CFBundleName="ghostty")
        iterm = self.bundle("iTerm.app", CFBundleName="iTerm2")
        bare = self.bundle("Warp.app")
        for bundle, name in ((ghostty, "Ghostty"), (iterm, "iTerm2"), (bare, "Warp")):
            exe = bundle / "Contents" / "MacOS" / "app"
            found = caller.from_chain(chain(("/bin/zsh", ["-zsh"]), ("/usr/bin/login", ["login"]), (str(exe), [str(exe)])))
            self.assertEqual(found, Caller(name, str(bundle)))

    def test_a_bundle_name_is_sanitized_and_capped(self):
        app = self.bundle("Odd.app", CFBundleDisplayName="Evil‮\x00 App\n" + "x" * 80)
        found = caller.from_chain([Process(5, 1, str(app / "Contents" / "MacOS" / "Odd"), ())])
        self.assertEqual(found.name, ("Evil App " + "x" * 80)[: caller.MAX_NAME])

    def test_no_agent_and_no_app_falls_back_to_ardia(self):
        found = caller.from_chain(chain(("/bin/sh", ["/bin/sh", "-c"]), ("/usr/sbin/sshd", ["sshd-session"])))
        self.assertEqual(found, Caller("ardia"))
        self.assertEqual(caller.from_chain([]), Caller("ardia"))

    def test_the_walk_stops_at_launchd_on_a_cycle_and_on_a_gone_process(self):
        reader = FakeReader({10: Process(10, 11, "/bin/zsh"), 11: Process(11, 1, T3)})
        self.assertEqual([p.pid for p in caller.ancestry(10, reader)], [10, 11])
        loop = FakeReader({10: Process(10, 11, "/bin/zsh"), 11: Process(11, 10, "/bin/zsh")})
        self.assertEqual([p.pid for p in caller.ancestry(10, loop)], [10, 11])
        self.assertEqual(caller.ancestry(10, FakeReader({})), [])

    def test_a_reparented_process_names_nothing(self):
        reader = FakeReader({10: Process(10, 1, "/bin/sh", ("/bin/sh", "-c"))})
        self.assertEqual(caller.from_chain(caller.ancestry(10, reader)), Caller("ardia"))

    def test_procfs_reads_parents_paths_and_argv_from_a_proc_tree(self):
        with tempfile.TemporaryDirectory() as proc:
            for pid, stat, cmdline, exe in (
                (10, b"10 (node (x) y) S 11 10 10 0", b"node\0/usr/local/bin/claude\0--resume\0", "/usr/bin/node"),
                (11, b"11 (bash) S 1 11 11 0", b"-bash\0", None),
            ):
                folder = Path(proc, str(pid))
                folder.mkdir()
                (folder / "stat").write_bytes(stat)
                (folder / "cmdline").write_bytes(cmdline)
                if exe:
                    (folder / "exe").symlink_to(exe + " (deleted)")
            reader = caller.ProcFs(proc)
            self.assertEqual(caller.ancestry(10, reader), [Process(10, 11, "/usr/bin/node", ("node", "/usr/local/bin/claude")), Process(11, 1, "", ("-bash",))])
            self.assertEqual(caller.from_chain(caller.ancestry(10, reader)), Caller("Claude Code"))
            self.assertIsNone(reader.process(12))
            Path(proc, "11", "stat").write_bytes(b"garbage")
            self.assertEqual([p.pid for p in caller.ancestry(10, reader)], [10])

    def test_the_live_ancestry_reads_this_process(self):
        chain_now = caller.ancestry(os.getpid())
        self.assertEqual(chain_now[0].pid, os.getpid())
        self.assertEqual(chain_now[0].ppid, os.getppid())
        self.assertEqual(os.path.realpath(chain_now[0].path), os.path.realpath(sys.executable))
        self.assertTrue(chain_now[0].argv)
        self.assertIsInstance(caller.current(), Caller)

    def test_parse_keeps_only_display_text_and_an_outermost_bundle(self):
        self.assertEqual(caller.parse({"name": " Claude\x07 Code ", "app": "/Applications/T3 Code.app"}), Caller("Claude Code", "/Applications/T3 Code.app"))
        self.assertEqual(caller.parse({"name": "A", "app": "/A.app/Contents/Frameworks/B.app"}), Caller("A"))
        self.assertEqual(caller.parse({"name": "A", "app": "/x/../A.app"}), Caller("A"))
        self.assertEqual(caller.parse({"name": "A", "app": "relative.app"}), Caller("A"))
        self.assertIsNone(caller.parse({"name": "​"}))
        self.assertIsNone(caller.parse("Claude"))


if __name__ == "__main__":
    unittest.main()
