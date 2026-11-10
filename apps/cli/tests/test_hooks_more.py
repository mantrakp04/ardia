import asyncio
import json
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ardia_cli import hooks
from ardia_cli.hook_decide import Decider, parse_answer
from ardia_cli.hook_schedule import Scheduler, next_at
from test_automation import Base, event, wait_for

ANSWERING = r"""
import json, sys
request = json.loads(sys.stdin.read())
print(json.dumps({"url": request["data"]["url"].replace("www.", "old.")}))
"""
SLOW = r"""
import time
time.sleep(5)
print("{}")
"""


def parse(*items):
    return hooks.parse_hooks(json.dumps({"hooks": list(items)}))


def problem(**item):
    try:
        parse({"name": "h", **item})
    except hooks.HooksError as error:
        return str(error)
    return None


class Validation(unittest.TestCase):
    def test_one_trigger_one_action_known_keys(self):
        self.assertIsNone(problem(on="tab.opened", run=["x"]))
        self.assertIn("unknown key bogus", problem(on="tab.opened", run=["x"], bogus=1))
        self.assertIn("exactly one of run, command", problem(on="tab.opened", run=["x"], command="newTab"))
        self.assertIn("exactly one of on, at, every", problem(on="tab.opened", every="1h", run=["x"]))
        self.assertIn("arg only goes with command", problem(on="tab.opened", run=["x"], arg="1"))
        self.assertIn("timeout only goes with run", problem(on="tab.opened", command="newTab", timeout=3))

    def test_decide_hooks(self):
        self.assertIn("goes alone", problem(on=["tab.opening", "tab.opened"], cancel=True))
        self.assertIn("can't answer a decide event", problem(on="tab.opening", command="newTab"))
        self.assertIn('folder only goes with on: ["download.deciding"]', problem(on="tab.opening", folder="~/Downloads/x"))
        self.assertIn("fixed deadlines", problem(on="link.opening", run=["x"], timeout=5))
        self.assertIn(".. parts", problem(on="download.deciding", folder="~/Downloads/../.ssh"))
        self.assertIn("http or https", problem(on="tab.opening", rewrite=[{"match": "https://a.com/*", "to": "javascript:1"}]))
        self.assertIn("allow, deny or ask", problem(on="permission.requested", permission="always"))
        self.assertIsNone(problem(on="tab.opening", rewrite=[{"match": "https://*/*", "to": "{origin}{path}"}]))
        self.assertIsNone(problem(on="link.opening", **{"from": ["com.tinyspeck.slackmacgap"]}, route={"profile": "Work", "open": "tab"}))

    def test_idle_schedules_omnibox(self):
        self.assertIn("needs idle", problem(on="tab.idle", run=["x"]))
        self.assertIn("at least 1m", problem(on="user.idle", run=["x"], idle="30s"))
        self.assertIsNone(problem(on=["tab.idle", "tab.resumed"], run=["x"], idle="30m"))
        self.assertIsNone(problem(at="09:00", days=["mon"], timezone="Europe/Paris", command="newTab"))
        self.assertIn("isn't a known time zone", problem(at="09:00", timezone="Mars/Olympus", command="newTab"))
        self.assertIn("at least 1m", problem(every="10s", run=["x"]))
        self.assertIn("not both", problem(omnibox={"title": "J", "keyword": "j", "global": True}, run=["x"]))
        self.assertIn("cancel only goes with", problem(omnibox={"title": "J", "keyword": "j"}, cancel=True))


class Subscribing(unittest.TestCase):
    def service(self, *items, state=None):
        service = hooks.Service(Path("/nowhere"), SimpleNamespace(write=lambda _: None), capture=False, state_path=state)

        async def setup():
            service.set_hooks(parse(*items))

        asyncio.run(setup())
        return service

    def test_names_full_urls_idle_and_served_hooks(self):
        service = self.service(
            {"name": "all", "on": "*", "run": ["x"]},
            {"name": "note", "on": "notification.shown", "run": ["x"]},
            {"name": "idle", "on": "tab.idle", "idle": "30m", "run": ["x"], "fullUrls": True},
            {"name": "away", "on": "user.idle", "idle": "5m", "command": "toggleSidebar"},
            {"name": "prog", "on": "tab.opening", "run": ["~/bin/decide"]},
            {"name": "rule", "on": "tab.opening", "cancel": True},
            {"name": "jira", "omnibox": {"title": "Jira", "keyword": "j"}, "run": ["~/bin/jira"]},
        )
        self.assertEqual(service.event_names(), ["*", "notification.shown", "user.idle"])
        extra = service.subscription()
        self.assertEqual(extra["fullUrls"], True)
        self.assertEqual(extra["idle"], {"tab": [1800], "user": [300]})
        self.assertEqual([h["name"] for h in extra["hooks"]], ["prog", "jira"])
        self.assertNotIn("rule", service.runners)
        self.assertNotIn("prog", service.runners)

    def test_star_never_includes_named_only_and_idle_thresholds_must_match(self):
        hook = parse({"name": "all", "on": "*", "run": ["x"]})[0]
        self.assertFalse(hook.wants(event("user.idle", idle=300)))
        self.assertTrue(hook.wants(event("tab.opened")))
        idle = parse({"name": "i", "on": "tab.idle", "idle": "30m", "run": ["x"]})[0]
        self.assertTrue(idle.wants(event("tab.idle", idle=1800)))
        self.assertFalse(idle.wants(event("tab.idle", idle=600)))
        self.assertFalse(parse({"name": "d", "on": "tab.opening", "run": ["x"]})[0].wants(event("tab.opening")))

    def test_launch_runs_once_per_launch_and_hook_even_after_a_restart(self):
        state = Path(self.enterContext(_scratch()) if hasattr(self, "enterContext") else _scratch().__enter__()) / "state.json"
        offered = []
        launch = event("app.launched", launchId="L1", restored=True, focusedWindowId="w1", windows=["w1"])
        for _ in range(2):
            service = self.service({"name": "fresh", "on": "app.launched", "command": "newTab"}, state=state)
            service.runners["fresh"].offer = offered.append
            service.dispatch(launch)
            service.dispatch(launch)
        self.assertEqual(len(offered), 1)
        service = self.service({"name": "fresh", "on": "app.launched", "command": "newTab"}, state=state)
        service.runners["fresh"].offer = offered.append
        service.dispatch(event("app.launched", launchId="L2"))
        self.assertEqual(len(offered), 2)

    def test_urls_are_trimmed_for_hooks_that_dont_ask(self):
        service = self.service({"name": "a", "on": "tab.opened", "run": ["x"]}, {"name": "b", "on": "tab.opened", "run": ["x"], "fullUrls": True})
        got = {}
        for name in ("a", "b"):
            service.runners[name].offer = lambda e, n=name: got.setdefault(n, e)
        service.dispatch(event("tab.opened", url="https://a.example/p?token=1#x"))
        self.assertEqual(got["a"]["data"]["url"], "https://a.example/p")
        self.assertEqual(got["b"]["data"]["url"], "https://a.example/p?token=1#x")

    def test_notification_text_stays_out_of_the_environment(self):
        env = hooks.hook_env(event("notification.shown", title="secret", url="https://a/", origin="https://a"), base={})
        self.assertNotIn("ARDIA_TITLE", env)
        self.assertNotIn("ARDIA_URL", env)


class _scratch:
    def __enter__(self):
        import tempfile

        self.path = tempfile.mkdtemp(prefix="hk", dir=Path.home() / "ardia-scratch" if (Path.home() / "ardia-scratch").is_dir() else None)
        return self.path

    def __exit__(self, *exc):
        import shutil

        shutil.rmtree(self.path, True)


class Live(Base):
    def service(self, items):
        log = []
        holder = {}

        async def main(until, seconds):
            service = hooks.Service(self.socket, SimpleNamespace(write=log.append), capture=False, backoff_start=0.05, backoff_max=0.1)
            holder["service"] = service
            service.set_hooks(parse(*items))
            task = asyncio.ensure_future(service.run_forever())
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline and not until():
                await asyncio.sleep(0.02)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await service.stop()

        return log, holder, main

    def send_raw(self, server, payload):
        line = json.dumps(payload).encode() + b"\n"
        server.loop.call_soon_threadsafe(lambda: [w.write(line) for w in list(server.subscriptions)])

    def test_command_hook_runs_in_the_event_window_and_is_rate_limited(self):
        server = self.serve()
        log, _, main = self.service([{"name": "loop", "on": "tab.opened", "command": "newTab"}])

        def feed():
            server.subscribed.wait(5)
            for i in range(15):
                server.emit(event("tab.opened", windowId="w1", tabId=f"t{i}", url="https://a/"))

        import threading

        threading.Thread(target=feed, daemon=True).start()
        runs = lambda: [p for m, p in server.requests if m == "run"]
        asyncio.run(main(lambda: len(runs()) >= 10 and any("triggering itself" in l for l in log), 5))
        self.assertEqual(len(runs()), 10)
        self.assertEqual(runs()[0], {"command": "newTab", "window": "w1"})

    def test_decide_program_answers_and_a_slow_one_is_stopped(self):
        server = self.serve()
        items = [
            {"name": "rewrite", "on": "tab.opening", "run": [sys.executable, "-I", "-c", ANSWERING]},
            {"name": "slow", "on": "link.opening", "run": [sys.executable, "-I", "-c", SLOW]},
        ]
        log, _, main = self.service(items)

        def feed():
            server.subscribed.wait(5)
            wait_for(lambda: any(m == "subscribe" and (p or {}).get("hooks") for m, p in server.requests))
            self.send_raw(server, {"decide": "d1", "event": "tab.opening", "hook": "rewrite", "revision": "rev-rewrite", "deadline": 2000, "data": {"url": "https://www.reddit.com/r/x"}})
            self.send_raw(server, {"decide": "d2", "event": "link.opening", "hook": "slow", "revision": "rev-slow", "deadline": 300, "data": {"url": "https://a/"}})
            self.send_raw(server, {"decide": "d3", "event": "tab.opening", "hook": "nope", "deadline": 300, "data": {}})

        import threading

        threading.Thread(target=feed, daemon=True).start()
        answers = lambda: [p for m, p in server.requests if m == "answer"]
        asyncio.run(main(lambda: answers() and any("no answer in" in l for l in log), 6))
        self.assertEqual(answers(), [{"decide": "d1", "answer": {"url": "https://old.reddit.com/r/x"}}])
        subscribe = [p for m, p in server.requests if m == "subscribe"][-1]
        self.assertEqual([h["name"] for h in subscribe["hooks"]], ["rewrite", "slow"])

    def test_a_decision_for_a_revision_the_app_didnt_accept_never_runs(self):
        server = self.serve()
        log, _, main = self.service([{"name": "rewrite", "on": "tab.opening", "run": [sys.executable, "-I", "-c", ANSWERING]}])

        def feed():
            server.subscribed.wait(5)
            time.sleep(0.2)
            self.send_raw(server, {"decide": "x1", "event": "tab.opening", "hook": "rewrite", "revision": "rev-edited", "deadline": 1000, "data": {"url": "https://www.reddit.com/r/x"}})
            self.send_raw(server, {"decide": "x2", "event": "tab.opening", "hook": "rewrite", "revision": "rev-rewrite", "deadline": 2000, "data": {"url": "https://www.reddit.com/r/x"}})

        import threading

        threading.Thread(target=feed, daemon=True).start()
        answers = lambda: [p for m, p in server.requests if m == "answer"]
        asyncio.run(main(lambda: answers(), 6))
        self.assertEqual([a["decide"] for a in answers()], ["x2"])
        self.assertTrue(any("didn't register" in l for l in log))


class Deciding(unittest.TestCase):
    def test_answers_parse_strictly(self):
        self.assertEqual(parse_answer(b'{"cancel": true}\n'), {"cancel": True})
        self.assertEqual(parse_answer(b"[]"), [])
        self.assertIsNone(parse_answer(b"not json"))
        self.assertIsNone(parse_answer(b'"a string"'))
        self.assertIsNone(parse_answer(b""))

    def test_cancel_kills_the_program(self):
        hook = parse({"name": "slow", "on": "tab.opening", "run": [sys.executable, "-I", "-c", SLOW]})[0]
        answered = []

        class Connection:
            async def answer(self, ident, value):
                answered.append(ident)
                return True

        async def main():
            decider = Decider(SimpleNamespace(write=lambda _: None))
            decider.handle({"decide": "d1", "event": "tab.opening", "hook": "slow", "revision": "r1", "deadline": 4000, "data": {}}, {"slow": ("r1", hook)}, Connection())
            await asyncio.sleep(0.2)
            started = time.monotonic()
            decider.handle({"decide": "d1", "cancel": True}, {"slow": ("r1", hook)}, Connection())
            await asyncio.sleep(0.1)
            self.assertEqual(decider.running, {})
            return time.monotonic() - started

        self.assertLess(asyncio.run(main()), 1)
        self.assertEqual(answered, [])

    def test_only_the_registered_revision_runs_and_urls_are_trimmed(self):
        recorder = r"""
import json, sys
request = json.loads(sys.stdin.read())
print(json.dumps({"seen": request["data"]["url"]}))
"""
        plain = parse({"name": "p", "on": "tab.opening", "run": [sys.executable, "-I", "-c", recorder]})[0]
        full = parse({"name": "f", "on": "tab.opening", "run": [sys.executable, "-I", "-c", recorder], "fullUrls": True})[0]
        answers = {}
        lines = []

        class Connection:
            async def answer(self, ident, value):
                answers[ident] = value
                return True

        async def main():
            decider = Decider(SimpleNamespace(write=lines.append))
            accepted = {"p": ("r-old", plain), "f": ("r-f", full)}
            url = "https://a.example/x?token=1#h"
            decider.handle({"decide": "edited", "event": "tab.opening", "hook": "p", "revision": "r-new", "deadline": 3000, "data": {"url": url}}, accepted, Connection())
            decider.handle({"decide": "trimmed", "event": "tab.opening", "hook": "p", "revision": "r-old", "deadline": 3000, "data": {"url": url}}, accepted, Connection())
            decider.handle({"decide": "full", "event": "tab.opening", "hook": "f", "revision": "r-f", "deadline": 3000, "data": {"url": url}}, accepted, Connection())
            for _ in range(100):
                if len(answers) >= 2:
                    break
                await asyncio.sleep(0.03)

        asyncio.run(main())
        self.assertNotIn("edited", answers)
        self.assertEqual(answers["trimmed"], {"seen": "https://a.example/x"})
        self.assertEqual(answers["full"], {"seen": "https://a.example/x?token=1#h"})
        self.assertTrue(any("didn't register" in line for line in lines))

    def test_busy_limits(self):
        decider = Decider(SimpleNamespace(write=lambda _: None), max_running=2, per_hook=1)
        decider.running = {"a": ("h", None)}
        self.assertTrue(decider.busy("h"))
        self.assertFalse(decider.busy("g"))


class Scheduling(unittest.TestCase):
    def clocks(self, start):
        now = {"wall": start, "mono": 1000.0}
        return now, (lambda: now["wall"]), (lambda: now["mono"])

    def test_at_fires_once_skips_missed_days_and_catches_up_once(self):
        hook = parse({"name": "s", "at": "09:00", "command": "newTab"})[0]
        start = time.mktime((2026, 11, 2, 8, 0, 0, 0, 0, -1))
        now, wall, mono = self.clocks(start)
        fired = []
        scheduler = Scheduler(lambda h, e: fired.append(e), None, wall=wall, mono=mono)
        scheduler.set_hooks([hook])
        scheduler.check()
        self.assertEqual(fired, [])
        now["wall"] = start + 3600 + 5
        scheduler.check()
        scheduler.check()
        self.assertEqual(len(fired), 1)
        self.assertFalse(fired[0]["data"]["catchUp"])
        self.assertTrue(fired[0]["data"]["occurrence"].startswith("s@2026-11-02T09:00"))
        now["wall"] = start + 3 * 86400 + 7200
        scheduler.check()
        scheduler.check()
        self.assertEqual(len(fired), 2)
        self.assertTrue(fired[1]["data"]["catchUp"])

    def test_at_honours_weekdays(self):
        hook = parse({"name": "s", "at": "09:00", "days": ["mon"], "command": "newTab"})[0]
        saturday = time.mktime((2026, 11, 7, 10, 0, 0, 0, 0, -1))
        self.assertEqual(time.localtime(next_at(hook, saturday))[:4], (2026, 11, 9, 9))

    def test_every_uses_the_monotonic_clock_and_one_catch_up_after_sleep(self):
        hook = parse({"name": "e", "every": "1h", "run": ["x"]})[0]
        now, wall, mono = self.clocks(1_800_000_000.0)
        fired = []
        scheduler = Scheduler(lambda h, e: fired.append(e), None, wall=wall, mono=mono)
        scheduler.set_hooks([hook])
        now["mono"] += 3600
        now["wall"] += 3600
        scheduler.check()
        self.assertEqual(len(fired), 1)
        now["wall"] += 5 * 3600
        now["mono"] += 60
        scheduler.check()
        scheduler.check()
        self.assertEqual(len(fired), 2)
        self.assertTrue(fired[1]["data"]["catchUp"])
