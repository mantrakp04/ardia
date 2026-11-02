import asyncio
import contextlib
import io
import json
import os
import plistlib
import shutil
import signal
import socket
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import automation_cli, cli, control, endpoint, hooks, runner

SCRATCH = Path.home() / "ardia-scratch"
COMMANDS = [
    {"id": "newTab", "title": "New Tab", "scope": "window", "variants": None},
    {"id": "selectTab", "title": "Select Tab", "scope": "window", "variants": ["1", "2", "3"]},
    {"id": "toggleSidebar", "title": "Toggle Sidebar", "scope": "window", "variants": None},
]
WINDOWS = [
    {
        "id": 1,
        "kind": "normal",
        "focused": True,
        "profile": "default",
        "profileName": "Personal",
        "tabs": [
            {"id": 11, "url": "https://example.com/", "title": "Example", "profile": "default", "active": True, "pinned": False, "group": None},
            {"id": 12, "url": "https://news.ycombinator.com/", "title": "HN", "profile": "default", "active": False, "pinned": True, "group": 3},
        ],
    }
]
RECORDER = r"""
import json, os, sys
out = sys.argv[1]
names = ["ARDIA_EVENT", "ARDIA_WINDOW_ID", "ARDIA_TAB_ID", "ARDIA_PROFILE", "ARDIA_URL", "ARDIA_TITLE"]
record = {"stdin": sys.stdin.read(), "env": {n: os.environ.get(n) for n in names}, "argv": sys.argv[2:]}
index = len(os.listdir(out))
with open(os.path.join(out, f"{index:04}.json"), "w") as handle:
    json.dump(record, handle)
"""


def scratch_dir() -> Path:
    base = SCRATCH if SCRATCH.is_dir() else Path(tempfile.gettempdir())
    return Path(tempfile.mkdtemp(prefix="ac", dir=base)).resolve()


def event(name, **data):
    return {"event": name, "time": 1730400000000, "data": data}


class FakeArdia:
    def __init__(self, path: Path):
        self.path = path
        self.requests = []
        self.connections = 0
        self.finished = 0
        self.writers = []
        self.every_writer = []
        self.subscriptions = {}
        self.subscribed = threading.Event()
        self.replies = {}
        self.loop = asyncio.new_event_loop()
        self.ready = threading.Event()
        self.thread = threading.Thread(target=self._thread, daemon=True)

    def _thread(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._start())
        self.ready.set()
        self.loop.run_forever()
        pending = [t for t in asyncio.all_tasks(self.loop) if not t.done()]
        for task in pending:
            task.cancel()
        self.loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        for _ in range(3):
            self.loop.run_until_complete(asyncio.sleep(0))
        self.loop.close()

    async def _start(self):
        self.server = await asyncio.start_unix_server(self._client, path=str(self.path), limit=2 * 1024 * 1024)

    def start(self):
        self.thread.start()
        self.ready.wait(5)
        return self

    async def _client(self, reader, writer):
        self.connections += 1
        self.writers.append(writer)
        self.every_writer.append(writer)
        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                request = json.loads(line)
                self.requests.append((request.get("method"), request.get("params")))
                reply = self.answer(request, writer)
                if reply is None:
                    writer.close()
                    break
                writer.write(json.dumps(reply).encode() + b"\n")
                await writer.drain()
        except (ConnectionError, ValueError):
            pass
        finally:
            self.subscriptions.pop(writer, None)
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
            self.finished += 1

    def answer(self, request, writer):
        method = request.get("method")
        ident = request.get("id")
        params = request.get("params") or {}
        if method in self.replies:
            reply = self.replies[method](params)
            if reply is None:
                return None
            return {"id": ident, **reply}
        if method == "hello":
            return {"id": ident, "result": {"app": "Ardia", "version": "0.2.44", "protocol": 1}}
        if method == "commands":
            return {"id": ident, "result": COMMANDS}
        if method == "windows":
            return {"id": ident, "result": WINDOWS}
        if method == "subscribe":
            self.subscriptions[writer] = list(params.get("events", []))
            self.subscribed.set()
            return {"id": ident, "result": {"ok": True}}
        if method == "run":
            if params.get("command") not in {c["id"] for c in COMMANDS}:
                return {"id": ident, "error": {"code": "unknown_command", "message": f"unknown command {params.get('command')}"}}
            return {"id": ident, "result": {"ok": True}}
        return {"id": ident, "error": {"code": "unknown_method", "message": "unknown method"}}

    def emit(self, payload: dict):
        line = json.dumps(payload).encode() + b"\n"

        def send():
            for writer, names in list(self.subscriptions.items()):
                if "*" in names or payload.get("event") in names:
                    writer.write(line)

        self.loop.call_soon_threadsafe(send)

    def drop(self):
        def close():
            for writer in self.writers:
                writer.close()
            self.writers.clear()
            self.subscriptions.clear()

        self.subscribed.clear()
        self.loop.call_soon_threadsafe(close)

    async def _shutdown(self):
        await asyncio.sleep(0.05)
        if hasattr(self.server, "close_clients"):
            self.server.close_clients()
        for writer in self.every_writer:
            writer.close()
        await asyncio.gather(*(w.wait_closed() for w in self.every_writer), return_exceptions=True)
        self.server.close()
        with contextlib.suppress(Exception):
            await asyncio.wait_for(self.server.wait_closed(), 2)

    def stop(self):
        with contextlib.suppress(Exception):
            asyncio.run_coroutine_threadsafe(self._shutdown(), self.loop).result(5)
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(5)
        with contextlib.suppress(FileNotFoundError):
            os.unlink(self.path)


def wait_for(condition, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return False


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = scratch_dir()
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.data = self.temp / "d"
        self.data.mkdir()
        self.home = self.temp / "h"
        self.home.mkdir()
        patches = [
            mock.patch.dict(os.environ, {"HOME": str(self.home), "ARDIA_DATA_DIR": str(self.data), "ARDIA_CLI_HOME": str(self.temp / "cli")}),
            mock.patch.object(endpoint, "INSTALLED_DATA_DIR", self.temp / "installed"),
            mock.patch.object(hooks, "launchctl", side_effect=AssertionError("real launchctl")),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.socket = self.data / control.SOCKET_FILE

    def serve(self) -> FakeArdia:
        server = FakeArdia(self.socket).start()
        self.addCleanup(server.stop)
        return server

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                status = cli.main(list(argv))
            except SystemExit as exit:
                status = exit.code
        return status, out.getvalue(), err.getvalue()

    def interrupt_after(self, seconds):
        timer = threading.Timer(seconds, os.kill, (os.getpid(), signal.SIGINT))
        timer.start()
        self.addCleanup(timer.cancel)


class Discovery(Base):
    def test_missing_socket(self):
        status, _, err = self.run_cli("windows")
        self.assertEqual(status, 2)
        self.assertEqual(err.strip(), f"ardia: {endpoint.NOT_REACHABLE}")

    def test_regular_file_is_not_a_socket(self):
        self.socket.write_text("")
        status, _, err = self.run_cli("commands")
        self.assertEqual(status, 2)
        self.assertIn("isn't a socket", err)

    def test_symlink_is_not_a_socket(self):
        server = FakeArdia(self.temp / "real.sock").start()
        self.addCleanup(server.stop)
        os.symlink(self.temp / "real.sock", self.socket)
        status, _, err = self.run_cli("windows")
        self.assertEqual(status, 2)
        self.assertIn("isn't a socket", err)
        self.assertEqual(server.requests, [])

    def test_other_owner(self):
        self.serve()
        with mock.patch.object(os, "getuid", return_value=os.getuid() + 1):
            status, _, err = self.run_cli("windows")
        self.assertEqual(status, 2)
        self.assertIn("belongs to another user", err)

    def test_peer_uid_checked_before_sending(self):
        server = self.serve()
        with mock.patch.object(control, "peer_uid", return_value=os.getuid() + 1):
            status, _, err = self.run_cli("windows")
        self.assertEqual(status, 2)
        self.assertIn("served by another user", err)
        with mock.patch.object(control, "peer_uid", return_value=None):
            status, _, err = self.run_cli("windows")
        self.assertEqual(status, 2)
        self.assertIn("couldn't check who serves it", err)
        self.assertEqual(server.requests, [])

    def test_peer_uid_is_real(self):
        server = self.serve()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.connect(str(self.socket))
            self.assertEqual(control.peer_uid(sock), os.getuid())
        self.assertTrue(wait_for(lambda: server.finished >= 1))

    def test_long_path(self):
        deep = self.temp / ("x" * 120)
        status, _, err = self.run_cli("windows", "--data-dir", str(deep))
        self.assertEqual(status, 2)
        self.assertIn("over the 103 a Unix socket allows", err)

    def test_stale_socket(self):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.bind(str(self.socket))
        sock.close()
        status, _, err = self.run_cli("windows")
        self.assertEqual(status, 2)
        self.assertEqual(err.strip(), f"ardia: {endpoint.NOT_REACHABLE}")

    def test_installed_data_dir_without_env(self):
        with mock.patch.dict(os.environ, {"ARDIA_DATA_DIR": ""}):
            self.assertEqual(control.socket_path(), self.temp / "installed" / control.SOCKET_FILE)

    def test_lost_during_hello_is_unreachable_not_maybe_ran(self):
        server = self.serve()
        server.replies["hello"] = lambda params: None
        status, _, err = self.run_cli("run", "newTab")
        self.assertEqual(status, 2)
        self.assertNotIn("may or may not", err)
        self.assertNotIn("run", [m for m, _ in server.requests])

    def test_not_ardia(self):
        server = self.serve()
        server.replies["hello"] = lambda params: {"result": {"app": "Other"}}
        status, _, err = self.run_cli("windows")
        self.assertEqual(status, 2)
        self.assertIn("something other than Ardia", err)


class Methods(Base):
    def test_run(self):
        server = self.serve()
        status, out, _ = self.run_cli("run", "newTab")
        self.assertEqual((status, out.strip()), (0, "ran newTab"))
        self.run_cli("run", "selectTab", "2", "--window", "1")
        self.run_cli("run", "selectTab:3")
        runs = [p for m, p in server.requests if m == "run"]
        self.assertEqual(runs, [{"command": "newTab"}, {"command": "selectTab", "arg": "2", "window": 1}, {"command": "selectTab", "arg": "3"}])
        self.assertEqual(server.requests[0][0], "hello")

    def test_run_unknown_suggests(self):
        self.serve()
        status, _, err = self.run_cli("run", "newTabb")
        self.assertEqual(status, 1)
        self.assertIn("did you mean newTab", err)

    def test_run_refused_and_no_window(self):
        server = self.serve()
        for code in ("refused", "no_window", "failed"):
            server.replies["run"] = lambda params, code=code: {"error": {"code": code, "message": f"{code} message"}}
            status, _, err = self.run_cli("run", "newTab")
            self.assertEqual(status, 1, code)
            self.assertIn(f"{code} message", err)

    def test_run_dropped_after_send_is_reported_not_retried(self):
        server = self.serve()
        server.replies["run"] = lambda params: None
        status, _, err = self.run_cli("run", "newTab")
        self.assertEqual(status, 2)
        self.assertIn("may or may not have run", err)
        self.assertEqual([m for m, _ in server.requests].count("run"), 1)

    def test_commands_and_windows(self):
        self.serve()
        status, out, _ = self.run_cli("commands")
        self.assertEqual(status, 0)
        self.assertIn("selectTab      Select Tab  [1, 2, 3]", out)
        status, out, _ = self.run_cli("commands", "--json")
        self.assertEqual(json.loads(out), COMMANDS)
        status, out, _ = self.run_cli("windows")
        self.assertEqual(out.splitlines()[0], "window 1  normal, focused  Personal")
        self.assertIn("*  11  Example  https://example.com/", out)
        self.assertIn(" p 12  HN  https://news.ycombinator.com/  (group 3)", out)
        status, out, _ = self.run_cli("windows", "--json")
        self.assertEqual(json.loads(out), WINDOWS)

    def test_ignores_null_id_errors_and_unknown_ids(self):
        server = self.serve()
        original = server.answer

        def answer(request, writer):
            if request.get("method") == "windows":
                writer.write(b'{"id": null, "error": {"code": "bad_request", "message": "x"}}\n{"id": 999, "result": 1}\n')
            return original(request, writer)

        server.answer = answer
        status, out, _ = self.run_cli("windows", "--json")
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(out), WINDOWS)

    def test_reply_timeout(self):
        async def check():
            reader = asyncio.StreamReader()
            writer = mock.MagicMock()
            writer.drain = mock.AsyncMock()
            connection = control.Connection(reader, writer)
            with self.assertRaises(control.Unreachable) as caught:
                await connection.call("windows", timeout=0.1)
            self.assertTrue(caught.exception.sent)
            await connection.close()

        asyncio.run(check())

    def test_line_cap(self):
        async def check():
            reader = asyncio.StreamReader(limit=control.MAX_LINE + 2)
            reader.feed_data(b"x" * (control.MAX_LINE + 10))
            writer = mock.MagicMock()
            connection = control.Connection(reader, writer)
            with self.assertRaises(control.Unreachable) as caught:
                await connection.next_event(timeout=2)
            self.assertIn("longer than 1 MB", str(caught.exception))

        asyncio.run(check())

    def test_event_queue_is_bounded_and_counts_drops(self):
        async def check():
            reader = asyncio.StreamReader()
            for n in range(control.EVENT_QUEUE_CAP + 250):
                reader.feed_data(json.dumps({"event": "tab.opened", "time": n, "data": {}}).encode() + b"\n")
            reader.feed_data(b'{"id": 1, "result": {"ok": true}}\n')
            writer = mock.MagicMock()
            writer.drain = mock.AsyncMock()
            connection = control.Connection(reader, writer)
            reply = await asyncio.wait_for(connection.call("subscribe", {"events": ["*"]}), 2)
            self.assertEqual(reply, {"ok": True})
            self.assertEqual(connection._events.qsize(), control.EVENT_QUEUE_CAP)
            first = await connection.next_event(timeout=1)
            self.assertEqual(first["time"], 250)
            self.assertEqual(connection.take_dropped(), 250)
            self.assertEqual(connection.take_dropped(), 0)
            await connection.close()

        asyncio.run(check())

    def test_service_logs_local_drops(self):
        lines = []
        service = hooks.Service(Path("/nowhere"), SimpleNamespace(write=lines.append), capture=False)

        class Stub:
            def __init__(self):
                self.events = [event("tab.opened"), event("tab.opened")]
                self.drops = [3, 0]

            async def subscribe(self, names):
                pass

            async def next_event(self):
                if not self.events:
                    raise control.Unreachable("done")
                return self.events.pop(0)

            def take_dropped(self):
                return self.drops.pop(0) if self.drops else 0

        async def check():
            with self.assertRaises(control.Unreachable):
                await service._serve(Stub())

        asyncio.run(check())
        self.assertEqual(sum("3 events dropped before this one" in line for line in lines), 1)

    def test_drain_failure_counts_as_sent(self):
        async def check():
            writer = mock.MagicMock()
            writer.drain = mock.AsyncMock(side_effect=ConnectionResetError(54, "Connection reset by peer"))
            connection = control.Connection(asyncio.StreamReader(), writer)
            with self.assertRaises(control.Unreachable) as caught:
                await connection.call("run", {"command": "newTab"})
            self.assertTrue(caught.exception.sent)
            await connection.close()

        asyncio.run(check())

    def test_run_reports_maybe_ran_when_drain_fails(self):
        self.serve()
        original = control.Connection.call

        async def failing(connection, method, params=None, timeout=control.CALL_TIMEOUT):
            if method == "run":
                connection._writer.drain = mock.AsyncMock(side_effect=BrokenPipeError(32, "Broken pipe"))
            return await original(connection, method, params, timeout)

        with mock.patch.object(control.Connection, "call", failing):
            status, _, err = self.run_cli("run", "newTab")
        self.assertEqual(status, 2)
        self.assertIn("may or may not have run", err)

    def test_big_request_refused_locally(self):
        async def check():
            connection = control.Connection(asyncio.StreamReader(), mock.MagicMock())
            with self.assertRaises(control.MethodError):
                await connection.call("run", {"command": "x" * control.MAX_LINE})
            await connection.close()

        asyncio.run(check())


class Events(Base):
    def test_stream_and_dropped(self):
        server = self.serve()

        def feed():
            server.subscribed.wait(5)
            server.emit(event("tab.opened", windowId=1, tabId=5, profile="default", url="https://example.com/", title="Ex"))
            server.emit({**event("tab.closed", windowId=1, tabId=5, profile="default", url="https://example.com/", title="Ex"), "dropped": 3})
            server.emit(event("settings.changed", keys=["tabLayout"]))
            time.sleep(0.3)
            server.drop()

        threading.Thread(target=feed, daemon=True).start()
        status, out, err = self.run_cli("events", "tab.opened", "tab.closed", "settings.changed")
        self.assertEqual(status, 2)
        lines = out.splitlines()
        self.assertEqual(len(lines), 3)
        self.assertIn("tab.opened  window 1  tab 5  https://example.com/  \"Ex\"", lines[0])
        self.assertIn("settings.changed  tabLayout", lines[2])
        self.assertIn("dropped 3 events", err)
        self.assertEqual(server.subscriptions, {})
        subscribe = [p for m, p in server.requests if m == "subscribe"]
        self.assertEqual(subscribe, [{"events": ["tab.opened", "tab.closed", "settings.changed"]}])

    def test_json_prints_raw_lines(self):
        server = self.serve()
        payload = {**event("tab.navigated", windowId=1, tabId=2, url="https://a.test/", title="", sameDocument=True), "dropped": 1}

        def feed():
            server.subscribed.wait(5)
            server.emit(payload)
            time.sleep(0.2)
            server.drop()

        threading.Thread(target=feed, daemon=True).start()
        status, out, _ = self.run_cli("events", "--json")
        self.assertEqual(json.loads(out), payload)
        self.assertEqual([p for m, p in server.requests if m == "subscribe"], [{"events": ["*"]}])

    def test_unknown_event(self):
        status, _, err = self.run_cli("events", "tab.navigate")
        self.assertEqual(status, 1)
        self.assertIn("did you mean tab.navigated", err)


class On(Base):
    def setUp(self):
        super().setUp()
        self.out = self.temp / "out"
        self.out.mkdir()

    def records(self):
        return [json.loads(p.read_text()) for p in sorted(self.out.iterdir())]

    def test_match_env_stdin(self):
        server = self.serve()
        navigated = event("tab.navigated", windowId=1, tabId=7, profile="default", url="https://www.youtube.com/watch?v=1", title="Video\0 x", sameDocument=False)

        def feed():
            server.subscribed.wait(5)
            server.emit(event("tab.navigated", windowId=1, tabId=8, profile="default", url="https://example.com/", title="no"))
            server.emit(event("window.focused", windowId=1, kind="normal", profile="default"))
            server.emit(navigated)
            wait_for(lambda: len(os.listdir(self.out)) >= 1)
            time.sleep(0.2)
            os.kill(os.getpid(), signal.SIGINT)

        threading.Thread(target=feed, daemon=True).start()
        with mock.patch.dict(os.environ, {"ARDIA_TITLE": "stale", "ARDIA_TAB_ID": "stale"}):
            status, _, err = self.run_cli("on", "tab.navigated,window.focused", "--match", "https://*.youtube.com/*", "--match", "https://*.vimeo.com/*", "--", sys.executable, "-I", "-c", RECORDER, str(self.out), "--match", "$ARDIA_URL")
        self.assertEqual(status, 130, err)
        records = self.records()
        self.assertEqual(len(records), 1)
        self.assertEqual(json.loads(records[0]["stdin"]), navigated)
        self.assertEqual(records[0]["env"], {"ARDIA_EVENT": "tab.navigated", "ARDIA_WINDOW_ID": "1", "ARDIA_TAB_ID": "7", "ARDIA_PROFILE": "default", "ARDIA_URL": "https://www.youtube.com/watch?v=1", "ARDIA_TITLE": "Video x"})
        self.assertEqual(records[0]["argv"], ["--match", "$ARDIA_URL"])
        self.assertEqual([p for m, p in server.requests if m == "subscribe"], [{"events": ["window.focused", "tab.navigated"]}])

    def test_needs_program_and_valid_input(self):
        status, _, err = self.run_cli("on", "tab.opened")
        self.assertEqual(status, 1)
        self.assertIn("give the program after --", err)
        status, _, err = self.run_cli("on", "tab.opend", "--", "true")
        self.assertEqual(status, 1)
        self.assertIn("did you mean tab.opened", err)
        status, _, err = self.run_cli("on", "tab.opened", "--match", "nope", "--", "true")
        self.assertEqual(status, 1)
        self.assertIn("bad match pattern", err)

    def test_reconnects(self):
        server = self.serve()

        def feed():
            server.subscribed.wait(5)
            server.drop()
            wait_for(lambda: server.connections >= 2 and server.subscribed.is_set())
            server.emit(event("tab.opened", windowId=1, tabId=1, url="https://a.test/", title=""))
            wait_for(lambda: len(os.listdir(self.out)) >= 1)
            time.sleep(0.1)
            os.kill(os.getpid(), signal.SIGINT)

        threading.Thread(target=feed, daemon=True).start()
        with mock.patch.object(hooks, "BACKOFF_START", 0.05):
            status, _, err = self.run_cli("on", "tab.opened", "--", sys.executable, "-I", "-c", RECORDER, str(self.out))
        self.assertEqual(status, 130)
        self.assertEqual(len(self.records()), 1)
        self.assertIn("lost Ardia", err)
        self.assertIn("events in between may have been missed", err)

    def test_waits_for_ardia_then_connects(self):
        def later():
            time.sleep(0.3)
            server = FakeArdia(self.socket).start()
            self.addCleanup(server.stop)
            server.subscribed.wait(5)
            os.kill(os.getpid(), signal.SIGINT)

        threading.Thread(target=later, daemon=True).start()
        with mock.patch.object(hooks, "BACKOFF_START", 0.05):
            status, _, err = self.run_cli("on", "tab.opened", "--", "true")
        self.assertEqual(status, 130)
        self.assertEqual(err.count("retrying"), 1)
        self.assertIn("connected to Ardia 0.2.44", err)


class Running(unittest.TestCase):
    def setUp(self):
        self.temp = scratch_dir()
        self.addCleanup(shutil.rmtree, self.temp, True)

    def test_queue_cap_drops_oldest(self):
        lines = []
        log = SimpleNamespace(write=lines.append)

        async def check():
            hook = hooks.make_hook("h", ["tab.opened"], [], ["true"])
            runner = hooks.HookRunner(hook, log, capture=False)
            gate = asyncio.Event()
            seen = []

            async def blocked(event):
                seen.append(event["n"])
                await gate.wait()

            runner.run_once = blocked
            runner.offer({"event": "tab.opened", "n": 0})
            await asyncio.sleep(0)
            for n in range(1, 106):
                runner.offer({"event": "tab.opened", "n": n})
            self.assertEqual(len(runner.queue), 100)
            self.assertEqual(runner.queue[0]["n"], 6)
            self.assertEqual(runner.dropped, 5)
            gate.set()
            await asyncio.sleep(0.05)
            self.assertEqual(seen[:3], [0, 6, 7])
            runner.close()

        asyncio.run(check())
        self.assertEqual(sum("dropped the oldest" in line for line in lines), 1)

    def test_one_run_at_a_time(self):
        out = self.temp / "o"
        out.mkdir()
        script = "import os,sys,time; p=sys.argv[1]; open(os.path.join(p,'start-'+str(time.time())),'w').close(); time.sleep(0.2); open(os.path.join(p,'end-'+str(time.time())),'w').close()"

        async def check():
            hook = hooks.make_hook("h", ["tab.opened"], [], [sys.executable, "-I", "-c", script, str(out)])
            runner = hooks.HookRunner(hook, hooks.Log(stream=io.StringIO()), capture=True)
            for _ in range(3):
                runner.offer({"event": "tab.opened"})
            deadline = time.monotonic() + 10
            while len(os.listdir(out)) < 6 and time.monotonic() < deadline:
                await asyncio.sleep(0.05)
            runner.close()

        asyncio.run(check())
        marks = sorted((float(n.split("-", 1)[1]), n.split("-")[0]) for n in os.listdir(out))
        self.assertEqual([kind for _, kind in marks], ["start", "end"] * 3)

    def test_timeout_term_then_kill(self):
        stubborn = "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)"
        lines = []

        async def check():
            hook = hooks.make_hook("slow", ["tab.opened"], [], [sys.executable, "-I", "-c", stubborn], timeout=0.5)
            runner = hooks.HookRunner(hook, SimpleNamespace(write=lines.append), capture=True, kill_grace=0.3)
            started = time.monotonic()
            status = await runner.run_once({"event": "tab.opened"})
            runner.close()
            return status, time.monotonic() - started

        status, took = asyncio.run(check())
        self.assertEqual(status, -signal.SIGKILL)
        self.assertLess(took, 5)
        self.assertTrue(any("stopped after its 0.5 s timeout" in line for line in lines))

    def descendant_run(self, child_code, timeout=0.3, kill_grace=0.3):
        pid_file = self.temp / "child.pid"
        parent = f"import subprocess,sys; subprocess.Popen([sys.executable,'-I','-c',{child_code!r},{str(pid_file)!r}]{{extra}}); sys.exit(0)"
        return pid_file, parent

    def run_hook(self, script, timeout=0.3, kill_grace=0.3):
        lines = []

        async def check():
            hook = hooks.make_hook("kids", ["tab.opened"], [], [sys.executable, "-I", "-c", script], timeout=timeout)
            runner = hooks.HookRunner(hook, SimpleNamespace(write=lines.append), capture=True, kill_grace=kill_grace)
            started = time.monotonic()
            await runner.run_once({"event": "tab.opened"})
            runner.close()
            return time.monotonic() - started

        return asyncio.run(check()), lines

    def alive(self, pid_file):
        if not wait_for(pid_file.exists, 3):
            self.fail("the descendant never started")
        pid = int(pid_file.read_text())
        self.addCleanup(lambda: os.kill(pid, signal.SIGKILL) if self.pid_alive(pid) else None)
        return self.pid_alive(pid)

    @staticmethod
    def pid_alive(pid):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        return True

    def test_descendant_holding_output_is_stopped_with_its_group(self):
        child = "import os,sys,time; open(sys.argv[1],'w').write(str(os.getpid())); time.sleep(30)"
        pid_file, parent = self.descendant_run(child)
        took, lines = self.run_hook(parent.format(extra=""))
        self.assertLess(took, 2)
        time.sleep(0.1)
        self.assertFalse(self.alive(pid_file))
        self.assertTrue(any("stopped after its 0.3 s timeout" in line for line in lines))

    def test_descendant_ignoring_term_gets_killed(self):
        child = "import os,signal,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); open(sys.argv[1],'w').write(str(os.getpid())); time.sleep(30)"
        pid_file, parent = self.descendant_run(child)
        took, _ = self.run_hook(parent.format(extra=""), kill_grace=0.2)
        self.assertLess(took, 3)
        time.sleep(0.1)
        self.assertFalse(self.alive(pid_file))

    def test_escaped_descendant_still_bounded(self):
        child = "import os,sys,time; open(sys.argv[1],'w').write(str(os.getpid())); time.sleep(30)"
        pid_file, parent = self.descendant_run(child)
        took, _ = self.run_hook(parent.format(extra=", start_new_session=True"), kill_grace=0.2)
        self.assertLess(took, 0.3 + 0.2 + 2 * hooks.DRAIN_GRACE + 1)
        self.assertTrue(self.alive(pid_file))

    def test_timeout_signals_the_whole_group(self):
        child = "import os,sys,time; open(sys.argv[1],'w').write(str(os.getpid())); time.sleep(30)"
        pid_file = self.temp / "child.pid"
        parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-I','-c',{child!r},{str(pid_file)!r}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(30)"
        took, lines = self.run_hook(parent)
        self.assertLess(took, 2)
        time.sleep(0.1)
        self.assertFalse(self.alive(pid_file))
        self.assertTrue(any("stopped after its 0.3 s timeout" in line for line in lines))

    def test_spawn_failure_survives(self):
        lines = []

        async def check():
            hook = hooks.make_hook("missing", ["tab.opened"], [], [str(self.temp / "nope")])
            runner = hooks.HookRunner(hook, SimpleNamespace(write=lines.append), capture=True)
            runner.offer({"event": "tab.opened"})
            runner.offer({"event": "tab.opened"})
            await asyncio.sleep(0.3)
            self.assertFalse(runner.task.done())
            runner.close()

        asyncio.run(check())
        self.assertEqual(sum("can't run" in line for line in lines), 2)

    def test_output_drained_and_long_lines_cut(self):
        script = "import sys; sys.stdout.write('x'*100000+'\\nafter\\n'); sys.stderr.write('e'*300000+'\\n'); sys.stdout.flush()"
        lines = []

        async def check():
            hook = hooks.make_hook("noisy", ["tab.opened"], [], [sys.executable, "-I", "-c", script])
            runner = hooks.HookRunner(hook, SimpleNamespace(write=lines.append), capture=True)
            status = await asyncio.wait_for(runner.run_once({"event": "tab.opened"}), 10)
            runner.close()
            return status

        self.assertEqual(asyncio.run(check()), 0)
        self.assertIn("[noisy] after", lines)
        cut = [line for line in lines if "line cut at 64 KB" in line]
        self.assertEqual(len(cut), 2)
        self.assertTrue(all(len(line) < hooks.LINE_LIMIT + 100 for line in lines))

    def test_env_set_or_removed(self):
        base = {"ARDIA_URL": "stale", "ARDIA_TITLE": "stale", "PATH": "/bin"}
        env = hooks.hook_env(event("window.focused", windowId=2, kind="normal", profile="p"), base)
        self.assertNotIn("ARDIA_URL", env)
        self.assertNotIn("ARDIA_TITLE", env)
        self.assertEqual((env["ARDIA_EVENT"], env["ARDIA_WINDOW_ID"], env["ARDIA_PROFILE"], env["PATH"]), ("window.focused", "2", "p", "/bin"))
        env = hooks.hook_env(event("tab.opened", url="https://a.test/" + "é" * 5000, title="a\0b"), {})
        self.assertLessEqual(len(env["ARDIA_URL"].encode()), 4096)
        self.assertEqual(env["ARDIA_TITLE"], "ab")

    def test_only_leading_tilde_expanded(self):
        with mock.patch.dict(os.environ, {"HOME": "/Users/someone"}):
            self.assertEqual(hooks.program_argv(["~/bin/hook", "~/x", "$HOME"]), ["/Users/someone/bin/hook", "~/x", "$HOME"])
            self.assertEqual(hooks.program_argv(["bin/~hook"]), ["bin/~hook"])

    def test_patterns_or_and_urlless_events(self):
        hook = hooks.make_hook("h", ["*"], ["https://a.test/*", "https://*.b.test/*"], ["true"])
        self.assertTrue(hook.wants(event("tab.opened", url="https://a.test/x")))
        self.assertTrue(hook.wants(event("tab.navigated", url="https://www.b.test/")))
        self.assertFalse(hook.wants(event("tab.opened", url="https://c.test/")))
        self.assertFalse(hook.wants(event("window.focused", windowId=1)))
        self.assertFalse(hook.wants(event("settings.changed", keys=["x"])))
        bare = hooks.make_hook("b", ["window.focused"], [], ["true"])
        self.assertTrue(bare.wants(event("window.focused", windowId=1)))
        self.assertFalse(bare.wants(event("tab.opened", url="https://a.test/")))

    def test_log_rotation_mode_and_no_follow(self):
        path = self.temp / "logs" / "hooks.log"
        log = hooks.Log(path, limit=300)
        for n in range(40):
            log.write(f"line {n:03}")
        log.close()
        self.assertTrue(path.with_name("hooks.log.1").exists())
        self.assertFalse(path.with_name("hooks.log.2").exists())
        self.assertLessEqual(path.stat().st_size, 300)
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertIn("line 039", path.read_text())
        target = self.temp / "elsewhere.txt"
        target.write_text("keep\n")
        link = self.temp / "linked.log"
        os.symlink(target, link)
        with contextlib.redirect_stderr(io.StringIO()) as err:
            hooks.Log(link).write("nope")
        self.assertEqual(target.read_text(), "keep\n")
        self.assertIn("can't write", err.getvalue())


class HooksFile(unittest.TestCase):
    def test_valid(self):
        found = hooks.parse_hooks(json.dumps({"hooks": [
            {"name": "yt", "on": ["tab.navigated"], "match": ["https://*.youtube.com/*"], "run": ["~/bin/yt-hook"], "timeout": 30},
            {"name": "all", "on": "*", "run": ["/bin/echo", "hi"]},
        ]}))
        self.assertEqual([h.name for h in found], ["yt", "all"])
        self.assertEqual(found[0].timeout, 30)
        self.assertEqual(found[1].timeout, 60)
        self.assertEqual(found[1].events, ("*",))

    def test_invalid_whole_file(self):
        cases = [
            ("[]", 'must be an object with a "hooks" list'),
            ('{"hooks": {}}', 'must be an object with a "hooks" list'),
            ('{"hooks": [', "doesn't parse"),
            ('{"hooks": [{"name": "a", "on": ["tab.opened"], "run": "echo hi"}]}', "run must be a list"),
            ('{"hooks": [{"name": "a", "on": ["tab.opened"], "run": ["x"]}, {"name": "a", "on": ["tab.opened"], "run": ["y"]}]}', "the name is used twice"),
            ('{"hooks": [{"name": "a", "on": ["tab.navigate"], "run": ["x"]}]}', "did you mean tab.navigated"),
            ('{"hooks": [{"name": "a", "on": ["tab.opened"], "match": ["nope"], "run": ["x"]}]}', "bad match pattern"),
            ('{"hooks": [{"name": "a", "on": ["tab.opened"], "run": ["x"], "tiemout": 3}]}', "did you mean timeout"),
            ('{"hooks": [{"name": "a", "on": ["tab.opened"], "run": ["x"], "timeout": 0}]}', "timeout must be"),
            ('{"hooks": [{"name": "a", "on": ["tab.opened"], "run": []}]}', "run must be a non-empty list"),
            ('{"hooks": [{"on": ["tab.opened"], "run": ["x"]}]}', "needs a name"),
        ]
        for text, message in cases:
            with self.subTest(text=text):
                with self.assertRaises(hooks.HooksError) as caught:
                    hooks.parse_hooks(text)
                self.assertIn(message, str(caught.exception))


class Reload(Base):
    def test_reload_swap_and_keep_last_good(self):
        server = self.serve()
        config = self.data / "config"
        config.mkdir()
        path = config / "hooks.json"
        lines = []
        log = SimpleNamespace(write=lines.append)

        def write(document):
            text = document if isinstance(document, str) else json.dumps(document)
            temp = path.with_suffix(".tmp")
            temp.write_text(text)
            os.replace(temp, path)

        async def check():
            service = hooks.Service(self.socket, log, capture=False, backoff_start=0.05)
            write({"hooks": [{"name": "a", "on": ["tab.opened"], "run": ["true"]}]})
            tasks = [asyncio.ensure_future(hooks.watch_hooks(path, service, log, interval=0.05)), asyncio.ensure_future(service.run_forever())]
            try:
                await asyncio.wait_for(service.subscribed.wait(), 5)
                self.assertEqual(list(service.runners), ["a"])
                first = service.runners["a"]
                first.queue.append({"event": "tab.opened"})
                write({"hooks": [{"name": "a", "on": ["tab.opened"], "run": ["true"]}, {"name": "b", "on": ["tab.closed"], "run": ["true"]}]})
                await self.until(lambda: "b" in service.runners)
                self.assertIs(service.runners["a"], first)
                write({"hooks": [{"name": "a", "on": ["tab.activated"], "run": ["true"]}]})
                await self.until(lambda: "b" not in service.runners)
                self.assertIsNot(service.runners["a"], first)
                self.assertEqual(len(first.queue), 0)
                write('{"hooks": [')
                await self.until(lambda: any("keeping the hooks loaded before" in line for line in lines))
                self.assertEqual(list(service.runners), ["a"])
                await self.until(lambda: [p for m, p in server.requests if m == "subscribe"][-1:] == [{"events": ["tab.activated"]}])
                os.unlink(path)
                await self.until(lambda: service.runners == {})
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                await service.stop()

        asyncio.run(check())
        subscriptions = [p["events"] for m, p in server.requests if m == "subscribe"]
        self.assertEqual(subscriptions[0], ["tab.opened"])
        self.assertIn(["tab.opened", "tab.closed"], subscriptions)
        self.assertEqual(subscriptions[-1], [])

    async def until(self, condition, timeout=5.0):
        deadline = time.monotonic() + timeout
        while not condition():
            if time.monotonic() > deadline:
                self.fail("timed out")
            await asyncio.sleep(0.02)

    def test_hooks_file_follows_config_resolver(self):
        self.assertEqual(automation_cli.hooks_file(SimpleNamespace(data_dir=None)), self.data / "config" / "hooks.json")
        with mock.patch.dict(os.environ, {"ARDIA_DATA_DIR": ""}):
            self.assertEqual(automation_cli.hooks_file(SimpleNamespace(data_dir=None)), self.home / ".config" / "ardia" / "hooks.json")

    def test_reads_bounded_regular_files(self):
        config = self.data / "config"
        config.mkdir()
        os.mkfifo(config / "hooks.json")
        with self.assertRaises(hooks.HooksError) as caught:
            hooks.read_hooks(config / "hooks.json")
        self.assertIn("isn't a regular file", str(caught.exception))
        os.unlink(config / "hooks.json")
        (config / "hooks.json").write_text('{"hooks": [], "pad": "' + "x" * (1024 * 1024) + '"}')
        with self.assertRaises(hooks.HooksError):
            hooks.read_hooks(config / "hooks.json")


class LaunchAgent(Base):
    def setUp(self):
        super().setUp()
        launcher = self.temp / "cli" / "current" / "bin" / "ardia"
        launcher.parent.mkdir(parents=True)
        launcher.write_text("#!/bin/sh\n")
        self.launcher = launcher
        self.calls = []

        def fake(arguments):
            self.calls.append(arguments)
            out = "\tstate = running\n\tpid = 4242\n" if arguments[0] == "print" else ""
            return SimpleNamespace(returncode=0, stdout=out, stderr="")

        patch = mock.patch.object(hooks, "launchctl", side_effect=fake)
        patch.start()
        self.addCleanup(patch.stop)

    def installed_env(self):
        return mock.patch.dict(os.environ, {"ARDIA_DATA_DIR": "", "PATH": "/opt/homebrew/bin:/usr/bin:/bin"})

    def test_install_writes_plist_and_bootstraps(self):
        with self.installed_env():
            status, out, err = self.run_cli("hooks", "install")
        self.assertEqual(status, 0, err)
        plist = self.home / "Library" / "LaunchAgents" / "dev.ardia.hooks.plist"
        agent = plistlib.loads(plist.read_bytes())
        self.assertEqual(agent["Label"], "dev.ardia.hooks")
        self.assertEqual(agent["ProgramArguments"], [str(self.launcher), "hooks", "run", "--log", str(self.home / "Library" / "Logs" / "Ardia" / "hooks.log")])
        self.assertTrue(os.path.isabs(agent["ProgramArguments"][0]))
        self.assertIs(agent["RunAtLoad"], True)
        self.assertIs(agent["KeepAlive"], True)
        self.assertEqual(agent["WorkingDirectory"], str(self.home))
        self.assertEqual(agent["EnvironmentVariables"], {"PATH": "/opt/homebrew/bin:/usr/bin:/bin", "ARDIA_DATA_DIR": ""})
        uid = os.getuid()
        self.assertEqual(self.calls, [["bootout", f"gui/{uid}/dev.ardia.hooks"], ["bootstrap", f"gui/{uid}", str(plist)]])
        self.assertIn("there's no", err)
        with self.installed_env():
            status, out, _ = self.run_cli("hooks", "list")
        self.assertIn("LaunchAgent dev.ardia.hooks: loaded, running (pid 4242)", out)
        with self.installed_env():
            status, out, _ = self.run_cli("hooks", "uninstall")
        self.assertEqual((status, out.strip()), (0, "uninstalled dev.ardia.hooks"))
        self.assertFalse(plist.exists())
        self.assertEqual(self.calls[-1], ["bootout", f"gui/{uid}/dev.ardia.hooks"])

    def test_refused_with_scratch_data_dir(self):
        for verb in ("install", "uninstall"):
            status, _, err = self.run_cli("hooks", verb)
            self.assertEqual(status, 1)
            self.assertIn("refused while --data-dir or $ARDIA_DATA_DIR", err)
            with self.installed_env():
                status, _, err = self.run_cli("hooks", verb, "--data-dir", str(self.data))
            self.assertEqual(status, 1)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.home / "Library").exists())

    def test_install_needs_installed_launcher(self):
        os.unlink(self.launcher)
        with self.installed_env():
            status, _, err = self.run_cli("hooks", "install")
        self.assertEqual(status, 1)
        self.assertIn("isn't installed", err)
        self.assertEqual(self.calls, [])

    def test_bootstrap_failure(self):
        def failing(arguments):
            self.calls.append(arguments)
            return SimpleNamespace(returncode=5 if arguments[0] == "bootstrap" else 0, stdout="", stderr="Bootstrap failed: 5: Input/output error")

        with self.installed_env(), mock.patch.object(hooks, "launchctl", side_effect=failing), mock.patch.object(automation_cli.time, "sleep"):
            status, _, err = self.run_cli("hooks", "install")
        self.assertEqual(status, 1)
        self.assertIn("Input/output error", err)
        self.assertEqual([c[0] for c in self.calls], ["bootout", "bootstrap", "bootstrap", "bootstrap"])

    def test_list_reports_hooks(self):
        config = self.data / "config"
        config.mkdir()
        (config / "hooks.json").write_text(json.dumps({"hooks": [{"name": "yt", "on": ["tab.navigated"], "match": ["https://*.youtube.com/*"], "run": ["~/bin/yt-hook"]}]}))
        status, out, _ = self.run_cli("hooks", "list")
        self.assertEqual(status, 0)
        self.assertIn("yt  on tab.navigated  match https://*.youtube.com/*  run ~/bin/yt-hook  timeout 60s", out)
        self.assertIn("not installed", out)
        (config / "hooks.json").write_text('{"hooks": [{"name": "yt"}]}')
        status, _, err = self.run_cli("hooks", "list")
        self.assertEqual(status, 1)
        self.assertEqual(self.calls, [])


class ExecHelpers(Base):
    def namespace(self, root):
        session = SimpleNamespace(browser=None, opened=[])
        with mock.patch.dict(sys.modules, {}):
            try:
                return runner.build_namespace(session, "<test>", root)
            except ImportError as error:
                self.skipTest(f"pydoll isn't installed: {error}")

    def test_helpers_over_the_socket(self):
        server = self.serve()
        namespace = self.namespace(self.data)

        async def check():
            self.assertEqual(await namespace["windows"](), WINDOWS)
            self.assertEqual(await namespace["run"]("selectTab", "2", window=1), {"ok": True})
            with self.assertRaises(namespace["CommandError"]):
                await namespace["run"]("nope")
            stream = namespace["events"]("tab.opened")
            first = asyncio.ensure_future(stream.__anext__())
            await asyncio.get_running_loop().run_in_executor(None, server.subscribed.wait, 5)
            server.emit(event("tab.opened", windowId=1, tabId=3, url="https://a.test/", title="A"))
            got = await asyncio.wait_for(first, 5)
            await stream.aclose()
            return got

        got = asyncio.run(check())
        self.assertEqual(got["data"]["tabId"], 3)
        self.assertIn(("run", {"command": "selectTab", "arg": "2", "window": 1}), server.requests)

    def test_need_data_dir_with_explicit_endpoint(self):
        namespace = self.namespace(None)

        async def check():
            for call in (namespace["windows"](), namespace["run"]("newTab")):
                with self.assertRaises(namespace["ControlUnreachable"]) as caught:
                    await call
                self.assertIn("needs --data-dir or $ARDIA_DATA_DIR", str(caught.exception))

        asyncio.run(check())


class Help(Base):
    def test_help(self):
        for argv in (["run", "--help"], ["events", "--help"], ["on", "--help"], ["hooks", "--help"], ["hooks", "install", "--help"], ["commands", "--help"], ["windows", "--help"]):
            status, out, _ = self.run_cli(*argv)
            self.assertEqual(status, 0, argv)
            self.assertIn("usage: ardia", out)


if __name__ == "__main__":
    unittest.main()
