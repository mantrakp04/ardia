import contextlib
import importlib.util
import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import automation_cli, browsing, cli, endpoint

SCRATCH = Path.home() / "ardia-scratch"
ENV_NAMES = ("ARDIA_PORT", "ARDIA_WS", "ARDIA_CDP_URL", "ARDIA_DATA_DIR", "AGENT_BROWSER_CDP")


def scratch_dir() -> Path:
    base = SCRATCH if SCRATCH.is_dir() else Path(tempfile.gettempdir())
    return Path(tempfile.mkdtemp(prefix="cli", dir=base)).resolve()


def clean_env(**values):
    env = {k: v for k, v in os.environ.items() if k not in ENV_NAMES}
    env.update(values)
    return mock.patch.dict(os.environ, env, clear=True)


def run_cli(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            status = cli.main(list(argv))
        except SystemExit as exit:
            status = exit.code
    return status, out.getvalue(), err.getvalue()


class Captured(Exception):
    pass


class SharedFlags(unittest.TestCase):
    def dispatched(self, *argv):
        seen = {}

        def capture(args, parser):
            seen["args"] = args
            return 0

        with clean_env(), mock.patch.object(automation_cli, "dispatch", capture):
            status, _, err = run_cli(*argv)
        self.assertEqual(status, 0, err)
        return seen["args"]

    def test_before_and_after_the_command(self):
        for argv in (
            ["--json", "--data-dir", "/d", "windows"],
            ["windows", "--json", "--data-dir", "/d"],
            ["--data-dir=/d", "windows", "--json"],
        ):
            args = self.dispatched(*argv)
            self.assertEqual((args.command, args.json, args.data_dir), ("windows", True, "/d"), argv)

    def test_nested_commands(self):
        for argv in (["--data-dir", "/d", "hooks", "list"], ["hooks", "--data-dir", "/d", "list"], ["hooks", "list", "--data-dir", "/d"]):
            args = self.dispatched(*argv)
            self.assertEqual((args.hooks_command, args.data_dir), ("list", "/d"), argv)

    def test_after_the_command_wins(self):
        self.assertEqual(self.dispatched("--data-dir", "/a", "windows", "--data-dir", "/b").data_dir, "/b")

    def test_program_arguments_stay_put(self):
        args = self.dispatched("--data-dir", "/d", "--timeout", "5", "on", "tab.opened", "--", "prog", "--json", "--port", "1")
        self.assertEqual((args.data_dir, args.timeout), ("/d", 5.0))
        self.assertEqual(args.program, ["prog", "--json", "--port", "1"])

    def test_scripts_test_takes_port_and_ws_before(self):
        seen = {}

        def capture(args, parser):
            seen["args"] = args
            return 0

        from ardia_cli import scripts_cli

        with clean_env(), mock.patch.object(scripts_cli, "run", capture):
            status, _, err = run_cli("--port", "9351", "--ws", "ws://h/devtools/browser/x", "--json", "scripts", "test", "a.user.ts")
        self.assertEqual(status, 0, err)
        args = seen["args"]
        self.assertEqual((args.port, args.ws, args.json, args.file), (9351, "ws://h/devtools/browser/x", True, "a.user.ts"))

    def test_command_without_the_flag_says_so(self):
        with clean_env():
            status, _, err = run_cli("--port", "9351", "windows")
        self.assertEqual(status, 2)
        self.assertIn("windows doesn't take --port", err)

    def test_missing_value(self):
        with clean_env():
            status, _, err = run_cli("--port")
        self.assertEqual(status, 2)
        self.assertIn("--port needs a value", err)


class Browse(unittest.TestCase):
    def browse(self, *argv, **env):
        seen = {}

        def capture(argv):
            seen["argv"] = argv
            return 0

        from ardia_cli.browse import cli as browse_cli

        with clean_env(**env), mock.patch.object(browse_cli, "main", capture):
            status, _, err = run_cli(*argv)
        self.assertEqual(status, 0, err)
        return seen["argv"]

    def test_flags_before_browse_reach_it(self):
        self.assertEqual(self.browse("--port", "9351", "browse", "snapshot"), ["--port", "9351", "snapshot"])
        self.assertEqual(self.browse("browse", "--port", "9351", "snapshot"), ["--port", "9351", "snapshot"])
        self.assertEqual(self.browse("--json", "--data-dir", "/d", "browse", "get", "url"), ["--json", "--data-dir", "/d", "get", "url"])

    def test_env_fills_in_when_no_flag(self):
        self.assertEqual(self.browse("browse", "snapshot", ARDIA_PORT="9351"), ["--port", "9351", "snapshot"])
        self.assertEqual(self.browse("browse", "snapshot", ARDIA_WS="ws://h/devtools/browser/x", ARDIA_PORT="9351"), ["--ws", "ws://h/devtools/browser/x", "snapshot"])

    def test_flag_beats_env(self):
        for argv in (["--port", "1", "browse", "snapshot"], ["browse", "snapshot", "--port", "1"], ["browse", "--cdp", "1", "snapshot"], ["browse", "--ws", "ws://h/devtools/browser/x", "snapshot"]):
            got = self.browse(*argv, ARDIA_PORT="9351", ARDIA_WS="ws://e/devtools/browser/y")
            self.assertNotIn("9351", got, argv)
            self.assertNotIn("ws://e/devtools/browser/y", got, argv)

    def test_command_owned_port_is_not_the_endpoint(self):
        self.assertEqual(self.browse("browse", "stream", "enable", "--port", "9000", ARDIA_PORT="9351"), ["--port", "9351", "stream", "enable", "--port", "9000"])

    def test_flags_browse_doesnt_take(self):
        with clean_env():
            status, _, err = run_cli("--timeout", "5", "browse", "snapshot")
        self.assertEqual(status, 1)
        self.assertIn("ardia browse doesn't take --timeout", err)


class Resolve(unittest.TestCase):
    def resolved(self, ws=None, port=None, **env):
        with clean_env(**env), mock.patch.object(endpoint, "_from_port", lambda p, s: ("port", p, s)), mock.patch.object(endpoint, "_from_ws", lambda u, s: ("ws", u, s)):
            return endpoint.resolve(ws=ws, port=port)

    def test_precedence(self):
        env = {"ARDIA_WS": "ws://e", "ARDIA_PORT": "2", "ARDIA_CDP_URL": "ws://c"}
        self.assertEqual(self.resolved(ws="ws://f", **env), ("ws", "ws://f", "--ws"))
        self.assertEqual(self.resolved(port=1, **env), ("port", 1, "--port"))
        self.assertEqual(self.resolved(**env), ("ws", "ws://e", "ARDIA_WS"))
        self.assertEqual(self.resolved(ARDIA_PORT="2", ARDIA_CDP_URL="ws://c"), ("port", 2, "ARDIA_PORT"))
        self.assertEqual(self.resolved(ARDIA_CDP_URL="ws://c"), ("ws", "ws://c", "ARDIA_CDP_URL"))

    def test_bad_env_port(self):
        with self.assertRaises(endpoint.EndpointError) as caught:
            self.resolved(ARDIA_PORT="nine")
        self.assertIn("ARDIA_PORT must be a port number", str(caught.exception))


class RemovedExec(unittest.TestCase):
    def test_exec_is_an_unknown_command(self):
        for argv in (["exec", "await tab.title()"], ["--port", "9351", "exec", "x"], ["exec", "--help"]):
            with clean_env():
                status, out, err = run_cli(*argv)
            self.assertEqual(status, 2, argv)
            self.assertIn("unknown command 'exec'", err)
            self.assertIn("ardia browse", err)
            self.assertEqual(out, "")

    def test_other_unknown_command(self):
        with clean_env():
            status, _, err = run_cli("nope")
        self.assertEqual(status, 2)
        self.assertIn("unknown command 'nope'", err)

    def test_runner_is_gone(self):
        self.assertIsNone(importlib.util.find_spec("ardia_cli.runner"))


class Notes(unittest.TestCase):
    def test_passes_the_rest_through(self):
        seen = {}
        fake = types.ModuleType("ardia_cli.notes")
        fake.main = lambda argv: seen.setdefault("argv", argv) and 7
        with clean_env(), mock.patch.dict(sys.modules, {"ardia_cli.notes": fake}):
            status, _, _ = run_cli("--data-dir", "/d", "notes", "add", "--json", "hi")
        self.assertEqual(status, 7)
        self.assertEqual(seen["argv"], ["--data-dir", "/d", "add", "--json", "hi"])

    def test_real_module_answers_help(self):
        with clean_env():
            status, _, _ = run_cli("notes", "--help")
        self.assertIn(status, (0, None))


class BrowsingCommands(unittest.TestCase):
    linux = False

    def setUp(self):
        layout = mock.patch.object(endpoint, "LINUX", self.linux)
        layout.start()
        self.addCleanup(layout.stop)
        self.data = scratch_dir()
        self.addCleanup(shutil.rmtree, self.data, True)
        self.chromium = chromium = endpoint.chromium_dir(self.data)
        (chromium / "Default").mkdir(parents=True)
        control = chromium / endpoint.CONTROL_FILE
        control.write_text(json.dumps({"port": 1, "browser": "/devtools/browser/abc", "token": "t" * 24, "pid": os.getpid(), "generation": 1}))
        control.chmod(0o600)
        if self.linux:
            (chromium / "Default" / "Ardia").mkdir()
            (chromium / "Default" / "Ardia" / "linux-session.json").write_text(json.dumps(self.session()))
        else:
            (self.data / "session.json").write_text(json.dumps(self.session()))
        self.history(chromium / "Default" / "History")

    def session(self):
        tab = lambda id, url, pin=None, **extra: {"id": id, "windowId": "w1", "profileId": "default", "url": url, "title": id, "pin": pin, "pinnedUrl": url, **extra}
        return {
            "version": 10,
            "profiles": {"default": {"id": "default", "name": "Personal"}, "incognito:1": {"id": "incognito:1", "name": "Private"}},
            "profileOrder": ["default"],
            "windows": [{"id": "w1", "profileId": "default", "tabIds": ["t1", "t2", "t3", "t4", "t5"], "incognito": False}],
            "tabs": [
                tab("t1", "https://tile.test/", {"as": "tile"}),
                tab("t2", "https://folder.test/", {"as": "tile", "folder": {"id": "f", "name": "Work"}}),
                tab("t3", "https://row.test/", {"as": "row"}),
                tab("t4", "https://group.test/"),
                tab("t5", "https://plain.test/"),
            ],
            "groups": [{"id": "g1", "windowId": "w1", "profileId": "default", "name": "Docs", "pinned": True, "tabIds": ["t4", "t1"]}],
            "parkedPins": {"default": {"tabs": [{"id": "p1", "url": "https://parked.test/", "title": "Parked", "profileId": "default", "pin": {"as": "tile"}, "groupId": None}], "groups": []}},
        }

    def history(self, path):
        connection = sqlite3.connect(path)
        connection.executescript(
            "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, hidden INTEGER);"
            "CREATE TABLE visits (id INTEGER PRIMARY KEY, url INTEGER, visit_time INTEGER, transition INTEGER);"
        )
        rows = [(1, "https://a.test/one", "One", 5, 0), (2, "https://www.a.test/two", "Two", 1, 0), (3, "https://b.test/", "B", 2, 0), (4, "chrome://settings", "S", 1, 0)]
        connection.executemany("INSERT INTO urls VALUES (?, ?, ?, ?, ?)", rows)
        hour = 3_600_000_000
        now = int((time.time() + browsing.WEBKIT_EPOCH_OFFSET) * 1_000_000)
        visits = [(1, 1, now - hour, 1), (2, 1, now - 2 * hour, 1), (3, 2, now - 3 * hour, 1), (4, 3, now - 30 * hour, 1), (5, 4, now, 1)]
        connection.executemany("INSERT INTO visits VALUES (?, ?, ?, ?)", visits)
        connection.commit()
        connection.close()

    def cli(self, *argv):
        with clean_env(ARDIA_DATA_DIR=str(self.data)):
            return run_cli(*argv)

    def test_pinned_json(self):
        status, out, err = self.cli("pinned", "--json")
        self.assertEqual(status, 0, err)
        rows = [(r["url"], r["kind"], r["folder"], r["parked"]) for r in json.loads(out)]
        self.assertEqual(rows, [
            ("https://tile.test/", "favorite", None, False),
            ("https://folder.test/", "favorite", "Work", False),
            ("https://row.test/", "pinned", None, False),
            ("https://group.test/", "pinned", "Docs", False),
            ("https://parked.test/", "favorite", None, True),
        ])

    def test_pinned_text_and_data_dir_flag_before(self):
        with clean_env(), mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.data / "nowhere"):
            status, out, err = run_cli("--data-dir", str(self.data), "pinned")
        self.assertEqual(status, 0, err)
        self.assertIn("pinned    t4  https://group.test/  (folder Docs)  [Personal]", out)
        self.assertIn("[Personal] parked", out)

    def test_history(self):
        status, out, err = self.cli("history", "--json")
        self.assertEqual(status, 0, err)
        rows = json.loads(out)
        self.assertEqual([(r["url"], r["visits"], r["total_visits"]) for r in rows], [("https://a.test/one", 2, 5), ("https://www.a.test/two", 1, 1)])
        self.assertEqual(rows[0]["profile"], "Personal")
        status, out, _ = self.cli("history", "--days", "2", "--limit", "1", "--json")
        self.assertEqual([r["url"] for r in json.loads(out)], ["https://a.test/one"])
        status, out, _ = self.cli("--json", "history", "--days", "2", "--domains")
        self.assertEqual([(r["domain"], r["visits"], r["pages"]) for r in json.loads(out)], [("a.test", 3, 2), ("b.test", 1, 1)])
        status, out, _ = self.cli("history", "--domains", "--days", "2")
        self.assertIn("a.test  2 pages  One  [Personal]", out)

    def test_history_profile_and_bad_input(self):
        self.assertEqual(self.cli("history", "--profile", "Default", "--json")[0], 0)
        status, _, err = self.cli("history", "--profile", "Nope")
        self.assertEqual(status, 1)
        self.assertIn("no profile named 'Nope'", err)
        self.assertEqual(self.cli("history", "--days", "0")[0], 1)
        self.assertEqual(self.cli("history", "--limit", "-1")[0], 1)

    def test_not_running_exits_2(self):
        (self.chromium / endpoint.CONTROL_FILE).unlink()
        for command in ("pinned", "history"):
            status, _, err = self.cli(command)
            self.assertEqual(status, 2, command)
            self.assertIn(endpoint.NOT_REACHABLE, err)


class LinuxBrowsingCommands(BrowsingCommands):
    linux = True


if __name__ == "__main__":
    unittest.main()
