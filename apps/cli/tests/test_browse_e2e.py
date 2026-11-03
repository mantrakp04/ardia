import json
import os
import shutil
import socket
import statistics
import subprocess
import sys
import time
import unittest
import urllib.request
from pathlib import Path

CLI = Path(__file__).resolve().parents[1]
REPO = CLI.parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "browse"
APP = os.environ.get("ARDIA_BROWSE_E2E_APP")
SCRATCH = Path(os.environ.get("ARDIA_BROWSE_E2E_DIR", str(Path.home() / "ardia-scratch" / "browse-impl" / "e2e")))


def ref_for(snapshot: str, needle: str) -> str:
    for line in snapshot.splitlines():
        if needle in line and "ref=" in line:
            return "@" + line.split("ref=")[1].split("]")[0].split(",")[0]
    raise AssertionError(f"no ref for {needle} in:\n{snapshot}")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


SERVE = (
    "import http.server, socketserver, sys\n"
    "socketserver.TCPServer.allow_reuse_address = True\n"
    "socketserver.ThreadingTCPServer(('127.0.0.1', int(sys.argv[1])), http.server.SimpleHTTPRequestHandler).serve_forever()\n"
)
DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def wait_for(check, seconds: float, what: str):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {what}")


@unittest.skipUnless(APP, "set ARDIA_BROWSE_E2E_APP to a built Ardia.app (never /Applications) to run the end-to-end test")
class BrowseEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if APP.startswith("/Applications/"):
            raise unittest.SkipTest("never an installed app")
        cls.data = SCRATCH / "data"
        if cls.data.exists():
            shutil.rmtree(cls.data)
        cls.data.mkdir(parents=True)
        cls.http_port = free_port()
        cls.server = subprocess.Popen([sys.executable, "-I", "-c", SERVE, str(cls.http_port)], cwd=FIXTURES, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.port = free_port()
        launched = subprocess.run([str(REPO / "scripts/agent/ac"), "launch", APP, "--data", str(cls.data), "--port", str(cls.port), "--js", "none",
                                   "--onboarded", "--no-wait"], capture_output=True, text=True, timeout=90)
        if launched.returncode:
            cls.server.terminate()
            raise RuntimeError(launched.stderr or launched.stdout)

        def devtools():
            try:
                with DIRECT.open(f"http://127.0.0.1:{cls.port}/json/version", timeout=2):
                    return True
            except OSError:
                return False

        try:
            wait_for(devtools, 60, "the instance's DevTools port")
            wait_for(lambda: cls.fetch_ok(f"http://127.0.0.1:{cls.http_port}/probe.html"), 10, "the fixture server")
        except BaseException:
            cls.tearDownClass()
            raise

    @staticmethod
    def fetch_ok(url):
        try:
            with DIRECT.open(url, timeout=2):
                return True
        except OSError:
            return False

    @classmethod
    def tearDownClass(cls):
        try:
            cls.browse("close", "--all", check=False)
        finally:
            subprocess.run([str(REPO / "scripts/agent/ac"), "quit", str(cls.data)], capture_output=True, timeout=60)
            cls.server.terminate()
            cls.server.wait(10)

    @classmethod
    def browse(cls, *args, session="e2e", check=True, timeout=120, extra_env=None, stdin=None):
        env = dict(os.environ, PYTHONPATH=str(CLI), **(extra_env or {}))
        env.pop("AGENT_BROWSER_NO_HUMANIZE", None)
        done = subprocess.run([sys.executable, "-m", "ardia_cli", "browse", "--port", str(cls.port), "--data-dir", str(cls.data), "--session", session, *args],
                              capture_output=True, text=True, timeout=timeout, env=env, input=stdin)
        if check and done.returncode:
            raise AssertionError(f"ardia browse {' '.join(args)} exited {done.returncode}: {done.stderr}{done.stdout}")
        return done

    def url(self, name):
        return f"http://127.0.0.1:{self.http_port}/{name}"

    def report(self, session="e2e") -> dict:
        return json.loads(self.browse("get", "text", "#report", session=session).stdout)

    def test_core_loop(self):
        opened = self.browse("open", self.url("login.html"), "--show").stdout
        self.assertEqual(opened, f"✓ Fixture Login\n  {self.url('login.html')}\n")
        snap = self.browse("snapshot", "-i").stdout
        self.assertIn('heading "Log in" [level=1, ref=', snap)
        email = ref_for(snap, 'textbox "Email"')
        agree = ref_for(snap, 'checkbox "I agree"')
        go = ref_for(snap, 'button "Continue"')
        self.assertEqual(self.browse("click", agree).stdout, "✓ Done\n")
        self.assertEqual(self.browse("is", "checked", agree).stdout, "true\n")
        self.browse("fill", email, "agent@example.com")
        self.assertEqual(self.browse("get", "value", email).stdout, "agent@example.com\n")
        self.browse("select", ref_for(snap, "combobox"), "Blue")
        self.assertEqual(self.browse("get", "value", "#color").stdout, "b\n")
        self.browse("click", go)
        self.assertEqual(self.browse("wait", "--text", "submitted:").stdout, "submitted:\n")
        self.assertEqual(self.browse("get", "text", "#out").stdout, "submitted:agent@example.com\n")
        shot = SCRATCH / "core.png"
        self.assertEqual(self.browse("screenshot", str(shot)).stdout, f"✓ Screenshot saved to {shot}\n")
        self.assertEqual(shot.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
        data = json.loads(self.browse("snapshot", "-i", "--json").stdout)
        self.assertTrue(data["success"])
        self.assertIn("refs", data["data"])
        self.assertEqual(json.loads(self.browse("get", "title", "--json").stdout), {"success": True, "data": {"title": "Fixture Login"}, "error": None})
        missing = self.browse("click", "@e999", check=False)
        self.assertEqual((missing.returncode, missing.stderr), (1, "✗ Unknown ref: e999\n"))
        self.browse("open", self.url("probe.html"))
        stale = self.browse("click", email, check=False)
        self.assertEqual(stale.returncode, 1)
        self.assertIn("Stale ref", stale.stderr)

    def test_probe_sees_no_automation_and_humanized_input(self):
        session = "probe"
        self.browse("open", self.url("probe.html"), "--show", session=session)
        snap = self.browse("snapshot", "-i", session=session).stdout
        self.assertIn('button "Press me"', snap)
        self.browse("click", "#target", session=session)
        text = "Hello Ardia 42"
        self.browse("fill", "#field", text, session=session)
        self.assertEqual(self.browse("get", "value", "#field", session=session).stdout, text + "\n")
        self.assertEqual(self.browse("get", "title", session=session).stdout, "Probe\n")
        self.browse("screenshot", str(SCRATCH / "probe.png"), session=session)
        time.sleep(0.4)
        state = self.report(session)
        self.assertFalse(state["webdriver"])
        self.assertEqual(state["consoleGetter"], 0, "the Runtime domain was on before console capture")
        self.assertEqual(state["mutations"], 0, state["mutationSamples"])
        self.assertEqual(state["newGlobals"], [])
        events = state["events"]
        self.assertTrue(all(event["trusted"] for event in events))
        downs = [index for index, event in enumerate(events) if event["type"] == "mousedown"]
        self.assertGreaterEqual(len(downs), 2)
        self.assertGreater(sum(1 for event in events[:downs[0]] if event["type"] == "mousemove"), 3)
        for index in downs:
            up = next(event for event in events[index:] if event["type"] == "mouseup")
            self.assertGreater(up["t"] - events[index]["t"], 20)
        keydowns = [event for event in events if event["type"] == "keydown" and len(event["key"]) == 1]
        keyups = [event for event in events if event["type"] == "keyup" and len(event["key"]) == 1]
        self.assertEqual("".join(event["key"] for event in keydowns), text)
        self.assertEqual(len(keyups), len(text))
        gaps = [b["t"] - a["t"] for a, b in zip(keydowns, keydowns[1:])]
        self.assertGreater(statistics.mean(gaps), 30)
        self.assertGreater(statistics.stdev(gaps), 5)
        self.browse("console", session=session)
        time.sleep(0.5)
        self.assertGreater(self.report(session)["consoleGetter"], 0, "the probe's detector should fire once Runtime is on")

    def test_no_humanize_is_instant(self):
        session = "instant"
        self.browse("open", self.url("probe.html"), "--show", session=session)
        self.browse("fill", "#field", "abc", "--no-humanize", session=session)
        self.browse("click", "#target", "--no-humanize", session=session)
        events = self.report(session)["events"]
        down = next(index for index, event in enumerate(events) if event["type"] == "mousedown")
        self.assertLessEqual(sum(1 for event in events[:down] if event["type"] == "mousemove"), 1)
        keydowns = [event for event in events if event["type"] == "keydown" and len(event["key"]) == 1]
        self.assertEqual("".join(event["key"] for event in keydowns), "abc")
        self.assertLess(keydowns[-1]["t"] - keydowns[0]["t"], 100)

    def test_hidden_tab_refuses_input(self):
        session = "hidden"
        self.browse("open", self.url("probe.html"), "--show", session="hidden-front")
        self.browse("open", self.url("probe.html"), session=session)
        refused = self.browse("click", "#target", session=session, check=False)
        self.assertEqual(refused.returncode, 1)
        self.assertIn("background", refused.stderr)
        self.browse("scroll", "down", "200", session=session)

    def scratch_keychain(self) -> str:
        security = "/usr/bin/security"
        if not os.path.exists(security):
            self.skipTest("no /usr/bin/security")
        keychain = str(SCRATCH / "e2e-vault.keychain-db")
        subprocess.run([security, "delete-keychain", keychain], capture_output=True)
        subprocess.run([security, "create-keychain", "-p", "scratch", keychain], check=True, capture_output=True)
        self.addCleanup(subprocess.run, [security, "delete-keychain", keychain], capture_output=True)
        subprocess.run([security, "unlock-keychain", "-p", "scratch", keychain], check=True, capture_output=True)
        return keychain

    def test_auth_login_types_into_the_saved_origin(self):
        env = {"ARDIA_BROWSE_KEYCHAIN": self.scratch_keychain()}
        session = "vault-ok"
        self.browse("auth", "save", "site", "--url", self.url("auth.html"), "--username", "me@example.com", "--password-stdin",
                    session=session, extra_env=env, stdin="s3cret!\n")
        self.browse("open", self.url("auth.html"), "--show", session=session, extra_env=env)
        self.assertEqual(self.browse("auth", "login", "site", session=session, extra_env=env).stdout, "✓ Logged in as me@example.com\n")
        time.sleep(0.3)
        state = json.loads(self.browse("get", "text", "#report", session=session).stdout)
        self.assertEqual(state, {"leaked": [], "user": "me@example.com", "pw": "s3cret!"})

    def test_auth_login_stops_when_focus_moves_into_another_frame(self):
        env = {"ARDIA_BROWSE_KEYCHAIN": self.scratch_keychain()}
        session = "vault-race"
        self.browse("auth", "save", "race", "--url", self.url("auth.html"), "--username", "me@example.com", "--password-stdin",
                    session=session, extra_env=env, stdin="s3cret!\n")
        self.browse("open", self.url("auth.html#steal"), "--show", session=session, extra_env=env)
        time.sleep(1)
        refused = self.browse("auth", "login", "race", session=session, extra_env=env, check=False)
        self.assertEqual(refused.returncode, 1)
        self.assertIn("focus left the field", refused.stderr)
        time.sleep(0.5)
        state = json.loads(self.browse("get", "text", "#report", session=session).stdout)
        self.assertEqual(state["leaked"], [], "a credential character reached the cross-origin frame")
        self.assertEqual(state["pw"], "")

    def test_fill_follows_a_field_the_page_replaces_on_focus(self):
        session = "replace"
        self.browse("open", self.url("replace.html"), "--show", session=session)
        ref = ref_for(self.browse("snapshot", "-i", session=session).stdout, "Search the fixture")
        filled = json.loads(self.browse("fill", ref, "Chromium", "--json", session=session).stdout)
        self.assertEqual(filled, {"success": True, "data": {"filled": ref, "retargeted": True}, "error": None})
        state = json.loads(self.browse("get", "text", "#report", session=session).stdout)
        self.assertEqual((state["mounted"], state["value"], state["otherValue"]), (True, "Chromium", ""))
        self.browse("open", self.url("replace.html"), session=session)
        ref = ref_for(self.browse("snapshot", "-i", session=session).stdout, "Search the fixture")
        typed = self.browse("type", ref, "abc", session=session).stdout
        self.assertIn("typed into that one", typed)
        self.assertEqual(json.loads(self.browse("get", "text", "#report", session=session).stdout)["value"], "abc")

    def test_fill_refuses_when_focus_goes_to_another_field(self):
        session = "replace-elsewhere"
        self.browse("open", self.url("replace.html#elsewhere"), "--show", session=session)
        ref = ref_for(self.browse("snapshot", "-i", session=session).stdout, "Search the fixture")
        refused = self.browse("fill", ref, "Chromium", session=session, check=False)
        self.assertEqual(refused.returncode, 1)
        self.assertIn("nothing was typed", refused.stderr)
        state = json.loads(self.browse("get", "text", "#report", session=session).stdout)
        self.assertEqual((state["value"], state["otherValue"]), ("", ""))

    def test_auth_login_never_follows_a_replaced_field(self):
        env = {"ARDIA_BROWSE_KEYCHAIN": self.scratch_keychain()}
        session = "vault-replace"
        self.browse("auth", "save", "swap", "--url", self.url("replace.html"), "--password-selector", "#q", "--password-stdin",
                    session=session, extra_env=env, stdin="s3cret!\n")
        self.browse("open", self.url("replace.html"), "--show", session=session, extra_env=env)
        refused = self.browse("auth", "login", "swap", session=session, extra_env=env, check=False)
        self.assertEqual(refused.returncode, 1)
        self.assertEqual(json.loads(self.browse("get", "text", "#report", session=session).stdout)["value"], "")

    def test_repeat_snapshots_keep_their_refs_and_annotate_lists_only_the_image(self):
        session = "stable"
        self.browse("open", self.url("login.html"), "--show", session=session)
        first = self.browse("snapshot", "-i", session=session).stdout
        for _ in range(3):
            self.assertEqual(self.browse("snapshot", "-i", session=session).stdout, first)
        self.assertEqual(self.browse("snapshot", session=session).stdout.count("ref="), first.count("ref="))
        annotated = json.loads(self.browse("screenshot", "--annotate", str(SCRATCH / "stable.png"), "--json", session=session).stdout)["data"]
        height = json.loads(self.browse("eval", "innerHeight", "--json", session=session).stdout)["data"]["result"]
        self.assertTrue(annotated["annotations"])
        self.assertTrue(all(row["box"]["y"] < height and row["box"]["y"] + row["box"]["height"] > 0 for row in annotated["annotations"]))
        self.assertLess(len(annotated["annotations"]), first.count("ref="))
        self.assertEqual(self.browse("snapshot", "-i", session=session).stdout, first)

    def test_refs_survive_idle_disconnect(self):
        session = "idle"
        self.browse("open", self.url("login.html"), "--show", session=session)
        snap = self.browse("snapshot", "-i", session=session).stdout
        agree = ref_for(snap, 'checkbox "I agree"')
        time.sleep(33)
        self.assertFalse(json.loads(self.browse("session", "info", "--json", session=session).stdout)["data"]["connected"])
        self.browse("click", agree, session=session)
        self.assertEqual(self.browse("is", "checked", agree, session=session).stdout, "true\n")



SESSION_JS = (
    "import('./scripts/lib/instance.mjs').then(({ session }) => {"
    " const fs = require('fs'); const dir = process.argv[1];"
    " fs.writeFileSync(dir + '/session.json', JSON.stringify(session({ settings: { cliControl: true } })));"
    " fs.writeFileSync(dir + '/onboarding.json', JSON.stringify({ version: 1, completedAt: 1 })); });"
)


@unittest.skipUnless(APP, "set ARDIA_BROWSE_E2E_APP to a built Ardia.app (never /Applications) to run the end-to-end test")
class BrowseTokenPath(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if APP.startswith("/Applications/"):
            raise unittest.SkipTest("never an installed app")
        cls.data = SCRATCH / "token-data"
        if cls.data.exists():
            shutil.rmtree(cls.data)
        cls.data.mkdir(parents=True)
        subprocess.run(["node", "-e", SESSION_JS, str(cls.data)], cwd=REPO, check=True, timeout=30)
        cls.http_port = free_port()
        cls.server = subprocess.Popen([sys.executable, "-I", "-c", SERVE, str(cls.http_port)], cwd=FIXTURES, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log = str(cls.data / "app.out.log")
        subprocess.run(["open", "-g", "-n", "--env", "ARDIA_BACKGROUND=1", "--env", f"ARDIA_DATA_DIR={cls.data}", "--stdout", log, "--stderr", log, APP],
                       check=True, timeout=30)
        control = cls.data / "Chromium" / "ArdiaControl.json"
        cls.pid = None
        try:
            wait_for(control.exists, 60, "ArdiaControl.json")
            cls.pid = json.loads(control.read_text())["pid"]
            wait_for(lambda: BrowseEndToEnd.fetch_ok(f"http://127.0.0.1:{cls.http_port}/login.html"), 10, "the fixture server")
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        try:
            if cls.pid:
                cls.browse("close", "--all", check=False)
        finally:
            if cls.pid:
                try:
                    os.kill(cls.pid, 15)
                    wait_for(lambda: not cls.alive(cls.pid), 30, "the instance to quit")
                except (ProcessLookupError, AssertionError):
                    if cls.alive(cls.pid):
                        os.kill(cls.pid, 9)
            cls.server.terminate()
            cls.server.wait(10)

    @staticmethod
    def alive(pid):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        return True

    @classmethod
    def browse(cls, *args, session="token", check=True, timeout=120):
        env = dict(os.environ, PYTHONPATH=str(CLI))
        env.pop("AGENT_BROWSER_NO_HUMANIZE", None)
        done = subprocess.run([sys.executable, "-m", "ardia_cli", "browse", "--data-dir", str(cls.data), "--session", session, *args],
                              capture_output=True, text=True, timeout=timeout, env=env)
        if check and done.returncode:
            raise AssertionError(f"ardia browse {' '.join(args)} exited {done.returncode}: {done.stderr}{done.stdout}")
        return done

    def url(self, name):
        return f"http://127.0.0.1:{self.http_port}/{name}"

    def test_core_loop_over_the_token_policy(self):
        self.browse("open", self.url("login.html"), "--show")
        snap = self.browse("snapshot", "-i").stdout
        email = ref_for(snap, 'textbox "Email"')
        agree = ref_for(snap, 'checkbox "I agree"')
        self.browse("click", agree)
        self.assertEqual(self.browse("is", "checked", agree).stdout, "true\n")
        self.browse("fill", email, "token@example.com")
        self.assertEqual(self.browse("get", "value", email).stdout, "token@example.com\n")
        self.browse("press", "Enter")
        self.assertEqual(self.browse("wait", "--text", "submitted:token@example.com").returncode, 0)
        shot = SCRATCH / "token.png"
        self.browse("screenshot", str(shot))
        self.assertEqual(shot.read_bytes()[:4], b"\x89PNG")
        self.assertNotIn("about:blank", self.browse("tab").stdout)
        self.assertIn("never prints it", self.browse("get", "cdp-url", check=False).stderr)

    def test_probe_over_the_token_policy(self):
        session = "token-probe"
        self.browse("open", self.url("probe.html"), "--show", session=session)
        self.browse("snapshot", "-i", session=session)
        self.browse("click", "#target", session=session)
        self.browse("fill", "#field", "via token", session=session)
        self.browse("screenshot", str(SCRATCH / "token-probe.png"), session=session)
        time.sleep(0.4)
        state = json.loads(self.browse("get", "text", "#report", session=session).stdout)
        self.assertFalse(state["webdriver"])
        self.assertEqual(state["consoleGetter"], 0)
        self.assertEqual(state["mutations"], 0, state["mutationSamples"])
        self.assertEqual(state["newGlobals"], [])

    def test_gated_commands_name_the_refused_method(self):
        session = "token-gated"
        self.browse("open", self.url("login.html"), session=session)
        for args, method in ((["cookies"], "Network.getCookies"), (["network", "route", "*", "--abort"], "Fetch.enable"),
                             (["set", "viewport", "800", "600"], "Emulation.setDeviceMetricsOverride"), (["trace", "start"], "Tracing.start"),
                             (["upload", "#email", str(FIXTURES / "login.html")], "DOM.setFileInputFiles")):
            done = self.browse(*args, session=session, check=False)
            self.assertEqual(done.returncode, 1, args)
            self.assertIn(f"needs {method}", done.stderr)
            self.assertIn("isn't allowed for the ardia command", done.stderr)
        data = json.loads(self.browse("cookies", "--json", session=session, check=False).stdout)
        self.assertEqual((data["success"], data["code"], data["data"]["method"]), (False, "policy_refused", "Network.getCookies"))


if __name__ == "__main__":
    unittest.main()
