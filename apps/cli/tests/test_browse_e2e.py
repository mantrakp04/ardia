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


def stat_mode(path: Path) -> int:
    return path.stat().st_mode & 0o777


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
        return json.loads(self.browse("get", "text", "#report", "--full", session=session).stdout)

    def test_core_loop(self):
        opened = self.browse("open", self.url("login.html"), "--show").stdout
        self.assertEqual(opened, f"✓ Fixture Login\n  {self.url('login.html')}\n")
        snap = self.browse("snapshot", "-i").stdout
        self.assertIn('heading "Log in" [level=1, ref=', snap)
        email = ref_for(snap, 'textbox "Email"')
        agree = ref_for(snap, 'checkbox "I agree"')
        go = ref_for(snap, 'button "Continue"')
        clicked = self.browse("click", agree).stdout
        self.assertTrue(clicked.startswith("✓ Done\nchanges:\n"), clicked)
        self.assertIn(f'~ checkbox "I agree" [checked=true, ref={agree[1:]}] (was [checked=false])', clicked)
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
        self.browse("click", "#target", "--humanize", session=session)
        text = "Hello Ardia 42"
        self.browse("fill", "#field", text, "--humanize", session=session)
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
        self.browse("fill", "#field", "abc", session=session)
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
        opened = json.loads(self.browse("open", self.url("probe.html"), "--json", session=session).stdout)["data"]
        self.assertTrue(opened["background"])
        clicked = self.browse("click", "#target", session=session, check=False)
        if opened["takesInput"]:
            self.assertEqual(clicked.returncode, 0, clicked.stderr)
        else:
            self.assertEqual(clicked.returncode, 1)
            self.assertIn(f"use: ardia browse tab {opened['tabId']} --show (or open <url> --show)", clicked.stderr)
            self.assertIn("use: ardia browse tab", self.browse("open", self.url("probe.html#again"), session=session + "-2").stdout)
        self.browse("scroll", "down", "200", session=session)

    def drag_report(self, session):
        return json.loads(self.browse("get", "text", "#report", session=session).stdout)

    def test_html5_drag_reorders_a_list(self):
        session = "dnd"
        self.browse("open", self.url("dnd.html"), "--show", session=session)
        dragged = self.browse("drag", "#alpha", "#charlie", session=session).stdout
        self.assertTrue(dragged.startswith("✓ Done (HTML5 drag and drop)\nchanges:"), dragged)
        state = self.drag_report(session)
        self.assertEqual(state["order"], ["bravo", "charlie", "alpha", "delta"])
        self.assertEqual(state["log"], ["dragstart:alpha", "drop:alpha>charlie", "dragend:alpha:move"])
        self.browse("drag", "#delta", "#bravo", "--humanize", session=session)
        self.assertEqual(self.drag_report(session)["order"], ["delta", "bravo", "charlie", "alpha"])
        refused = json.loads(self.browse("drag", "#bravo", "#refuse", "--json", session=session).stdout)["data"]
        self.assertEqual((refused["html5"], refused["started"], refused["dropped"]), (True, True, False))
        for _ in range(2):
            plain = self.browse("drag", "#locked", "#alpha", session=session).stdout
            self.assertIn("plain mouse drag", plain)
        state = self.drag_report(session)
        self.assertEqual(state["order"], ["delta", "bravo", "charlie", "alpha"])
        self.assertEqual(state["log"][-3:], ["dragend:bravo:none", "prevented", "prevented"])
        self.assertEqual(state["clicks"], 2, "only the plain mouse drags should click")
        self.browse("drag", "#charlie", "#delta", session=session)
        self.assertEqual(self.drag_report(session)["order"], ["charlie", "delta", "bravo", "alpha"])

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
        self.assertEqual((filled["success"], filled["data"]["filled"], filled["data"]["retargeted"]), (True, ref, True))
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

    def test_fill_sets_typed_inputs_and_snapshot_shows_them_whole(self):
        session = "typed"
        self.browse("open", self.url("form.html"), "--show", session=session)
        snap = self.browse("snapshot", "-i", session=session).stdout
        self.assertRegex(snap, r'- textbox "Date" \[type=date, ref=e\d+\]: 2026-11-06\n- textbox "Time" \[type=time, ref=e\d+\]\n')
        self.assertIn('textbox "When" [type=datetime-local, ref=', snap)
        self.assertIn('textbox "Week" [type=week, ref=', snap)
        for text in (snap, self.browse("snapshot", session=session).stdout):
            self.assertNotIn("spinbutton", text)
            self.assertNotIn("picker", text)
        lines = ["fill #d 2026-11-09", "fill #t 2:30pm", 'fill #dt "2026-11-09 14:30"', "fill #m 2026-11", "fill #w 2026-W46",
                 "fill #c #3B82F6", "fill #r 55", "fill #name hello"]
        done = json.loads(self.browse("batch", "--json", session=session, stdin="\n".join(lines) + "\n").stdout)
        self.assertTrue(all(row["success"] for row in done), done)
        self.assertEqual([row["result"].get("value") for row in done], ["2026-11-09", "14:30", "2026-11-09T14:30", "2026-11", "2026-W46", "#3b82f6", "60", None])
        expected = {"d": "2026-11-09", "t": "14:30", "dt": "2026-11-09T14:30", "m": "2026-11", "w": "2026-W46", "c": "#3b82f6", "r": "60"}
        state = self.report(session)
        self.assertEqual({key: state["change"].get(key) for key in expected}, expected)
        self.assertEqual({key: state["input"].get(key) for key in expected}, expected)
        self.assertEqual(state["input"]["name"], "hello")
        refused = self.browse("fill", "#d", "11/09/2026", "--json", session=session, check=False)
        self.assertEqual(refused.returncode, 1)
        self.assertEqual(json.loads(refused.stdout)["code"], "bad_value")
        self.assertIn("YYYY-MM-DD", json.loads(refused.stdout)["error"])
        self.assertEqual(self.browse("get", "value", "#d", session=session).stdout, "2026-11-09\n")
        self.assertEqual(json.loads(self.browse("fill", "#t", "9:05 PM", "--json", session=session).stdout)["data"]["value"], "21:05")
        self.assertIn('textbox "Date" [type=date, ref=', self.browse("snapshot", "-i", session=session).stdout)

    def test_actions_report_changes_and_the_writes_they_caused(self):
        session = "changes"
        self.browse("open", self.url("form.html"), "--show", session=session)
        snap = self.browse("snapshot", "-i", session=session).stdout
        opened = self.browse("click", ref_for(snap, 'button "New item"'), session=session).stdout
        self.assertTrue(opened.startswith("✓ Done\nchanges:\n"), opened)
        title = ref_for(opened, 'textbox "Title"')
        self.assertIn(f'+ textbox "Title" [required, ref={title[1:]}]', opened)
        self.assertIn('+ textbox "Day" [type=date, required, ref=', opened)
        self.assertIn(f'~ textbox "Title" [required, ref={title[1:]}]: Hello (was empty)', self.browse("fill", title, "Hello", session=session).stdout)
        self.browse("fill", "#i-day", "2026-11-09", session=session)
        self.browse("fill", "#i-at", "09:15", session=session)
        selected = self.browse("select", "#i-kind", "Beta", session=session).stdout
        self.assertIn(': Beta (was \'Alpha\')', selected)
        saved = self.browse("click", "#save", session=session).stdout
        self.assertIn(f"POST http://127.0.0.1:{self.http_port}/save?token=", saved)
        self.assertNotIn("fixture-secret-token", saved)
        data = json.loads(self.browse("click", "#open", "--json", session=session).stdout)["data"]["changes"]
        self.assertEqual(data["network"], [])
        self.assertIn(title[1:], [row["ref"] for row in data["added"]])
        pressed = json.loads(self.browse("press", "Escape", "--json", session=session).stdout)["data"]["changes"]
        self.assertIn(title[1:], [row["ref"] for row in pressed["removed"]])
        self.browse("click", "#open", session=session)
        self.browse("batch", session=session, stdin="fill #i-day 2026-11-10\nfill #i-at 10:00\nfill #i-title Again\n")
        posted = json.loads(self.browse("press", "Enter", "--json", session=session).stdout)["data"]["changes"]["network"]
        self.assertEqual([(row["method"], row["status"], row["type"]) for row in posted], [("POST", 501, "Fetch")])
        self.assertEqual(posted[0]["url"], f"http://127.0.0.1:{self.http_port}/save?token=***&id=…")
        self.assertEqual(self.report(session)["items"][-1], {"title": "Again", "day": "2026-11-10", "at": "10:00", "kind": "a"})
        self.assertEqual(json.loads(self.browse("session", "info", "--json", session=session).stdout)["data"]["captures"], [])
        self.browse("eval", "document.body.insertAdjacentHTML('beforeend', '<button>Late arrival</button>')", session=session)
        later = self.browse("snapshot", "-i", "--diff", session=session).stdout
        self.assertRegex(later, r'\+ button "Late arrival" \[ref=e\d+\]')
        self.assertEqual(self.browse("snapshot", "-i", "--diff", session=session).stdout, "changes: none\n")
        quiet = self.browse("click", "#name", "--no-changes", session=session).stdout
        self.assertEqual(quiet, "✓ Done\n")

    def test_a_session_without_a_tab_uses_the_shown_one(self):
        self.browse("open", self.url("login.html#attach"), "--show", session="attach-src")
        first = self.browse("get", "url", session="attach")
        self.assertEqual(first.stdout, self.url("login.html#attach") + "\n")
        self.assertIn("this session had no tab, so it uses the active one", first.stderr.lower())
        again = self.browse("get", "title", session="attach")
        self.assertEqual((again.stdout, again.stderr), ("Fixture Login\n", ""))

    def test_site_notes_show_in_snapshots(self):
        session = "notes"
        site = f"127.0.0.1:{self.http_port}"
        self.browse("open", self.url("login.html"), "--show", session=session)
        self.assertEqual(self.browse("notes", session=session).stdout, f"(no notes for {site})\n")
        self.assertIn(f"Saved the notes for {site}", self.browse("notes", "set", "Use the Continue button", session=session).stdout)
        self.browse("notes", "append", "-", session=session, stdin="Second line\n")
        snap = self.browse("snapshot", "-i", session=session).stdout
        self.assertTrue(snap.startswith(f"# notes for {site} (ardia notes): Use the Continue button\n# Second line\n- link"), snap)
        data = json.loads(self.browse("snapshot", "--json", session=session).stdout)["data"]
        self.assertEqual(data["notes"]["site"], site)
        folder = self.data / "Notes"
        self.assertEqual(stat_mode(folder), 0o700)
        self.assertEqual(stat_mode(folder / f"{site}.md"), 0o600)
        self.assertEqual((folder / f"{site}.md").read_text(), "Use the Continue button\nSecond line\n")
        refused = self.browse("notes", "set", site, "-", "--json", session=session, stdin="x" * 9000, check=False)
        self.assertEqual((refused.returncode, json.loads(refused.stdout)["code"]), (1, "notes_too_large"))
        self.assertIn(site, self.browse("notes", "list", session=session).stdout)
        top = subprocess.run([sys.executable, "-m", "ardia_cli", "notes", "get", site, "--data-dir", str(self.data)], capture_output=True, text=True,
                             timeout=60, env=dict(os.environ, PYTHONPATH=str(CLI)))
        self.assertEqual(top.stdout, "Use the Continue button\nSecond line\n")
        self.assertIn("Removed", self.browse("notes", "rm", session=session).stdout)
        self.assertFalse(self.browse("snapshot", "-i", session=session).stdout.startswith("#"))

    def test_text_output_is_capped(self):
        session = "cap"
        self.browse("open", self.url("many.html"), "--show", session=session)
        capped = self.browse("snapshot", "-i", session=session).stdout
        self.assertLessEqual(len(capped), 6300)
        self.assertIn("Narrow it instead: snapshot -i", capped.splitlines()[-1])
        self.assertIn("--max-output", capped.splitlines()[-1])
        self.assertEqual(self.browse("snapshot", "-i", "--full", session=session).stdout.count("Button number"), 400)
        self.assertLessEqual(len(self.browse("snapshot", "-i", "--max-output", "500", session=session).stdout), 800)
        self.assertEqual(json.loads(self.browse("snapshot", "-i", "--json", session=session).stdout)["data"]["snapshot"].count("Button number"), 400)

    def test_batch_fills_a_form_five_times_from_stdin(self):
        session = "batch"
        self.browse("open", self.url("form.html"), "--show", session=session)
        opener = ref_for(self.browse("snapshot", "-i", session=session).stdout, 'button "New item"')
        lines = ["# five items, one call"]
        for index in range(5):
            lines += [f"click {opener}", f'fill #i-title "Item {index}"', f"fill #i-day 2026-11-{9 + index:02d}", f"fill #i-at {9 + index}:30",
                      "select #i-kind Beta", "click #save"]
        started = time.monotonic()
        done = self.browse("batch", "--bail", session=session, stdin="\n".join(lines) + "\n")
        elapsed = time.monotonic() - started
        self.assertEqual(done.stdout.count("POST http://"), 5, done.stdout)
        self.assertEqual(self.report(session)["items"], [
            {"title": f"Item {index}", "day": f"2026-11-{9 + index:02d}", "at": f"{9 + index:02d}:30", "kind": "b"} for index in range(5)])
        self.assertLess(elapsed, 30)

    def test_refs_survive_idle_disconnect(self):
        session = "idle"
        self.browse("open", self.url("login.html"), "--show", session=session)
        snap = self.browse("snapshot", "-i", session=session).stdout
        agree = ref_for(snap, 'checkbox "I agree"')
        time.sleep(33)
        self.assertFalse(json.loads(self.browse("session", "info", "--json", session=session).stdout)["data"]["connected"])
        self.browse("click", agree, session=session)
        self.assertEqual(self.browse("is", "checked", agree, session=session).stdout, "true\n")

    def test_a_navigation_answers_with_the_new_page_so_no_snapshot_is_needed(self):
        session = "arrive"
        self.browse("open", self.url("login.html"), "--show", session=session)
        self.browse("eval", 'const a = document.createElement("a"); a.id = "go"; a.href = "many.html"; a.textContent = "Many"; document.body.prepend(a); 1',
                    session=session)
        arrived = self.browse("click", "#go", session=session).stdout
        self.assertIn("new document, 401 interactive nodes (its snapshot -i, so no need to take one):", arrived)
        self.assertRegex(arrived, r"\+ 400 buttons \(Button number 1 … Button number 400; e\d+…e\d+\)")
        self.assertNotIn("run `snapshot -i`", arrived)
        capped = self.browse("snapshot", session=session).stdout.splitlines()[-1]
        self.assertTrue(capped.startswith("[output capped at "), capped)
        self.assertIn("Narrow it instead: snapshot -i", capped)
        self.assertNotIn("--full", capped)

    def test_batch_lines_take_their_flags_and_a_last_close(self):
        session = "batch-flags"
        self.browse("open", self.url("many.html"), "--show", session=session)
        done = self.browse("batch", session=session, stdin="snapshot -i --full\nget text h1 --no-changes\nclose\n")
        self.assertEqual(done.stdout.count("Button number"), 400)
        self.assertTrue(done.stdout.endswith("Many buttons\n\n✓ Session batch-flags closed (1 tab it opened)\n"), done.stdout[-200:])

    def test_inspecting_a_url_never_navigates_a_borrowed_tab(self):
        self.browse("open", self.url("login.html#mine"), "--show", session="borrowed-owner")
        self.browse("snapshot", "-i", session="borrowed")
        checked = self.browse("vitals", self.url("form.html"), session="borrowed")
        self.assertIn("since this session uses your tab", checked.stderr)
        owner = json.loads(self.browse("tab", "list", "--json", session="borrowed-owner").stdout)["data"]["tabs"]
        self.assertTrue(any(tab["url"] == self.url("login.html#mine") for tab in owner))
        self.assertEqual(self.browse("get", "url", session="borrowed-owner").stdout, self.url("login.html#mine") + "\n")
        self.browse("tab", "active", session="borrowed-2", check=False)
        self.browse("snapshot", "-i", session="borrowed-2")
        refused = self.browse("reload", session="borrowed-2", check=False)
        self.assertEqual(refused.returncode, 1)
        self.assertIn("won't reload it", refused.stderr)
        self.browse("storage", "local", "set", "draft", "keep me", session="borrowed-owner")
        wiped = self.browse("storage", "local", "clear", session="borrowed-2", check=False)
        self.assertEqual((wiped.returncode, json.loads(self.browse("storage", "local", "clear", "--json", session="borrowed-2", check=False).stdout)["code"]),
                         (1, "borrowed_tab"))
        self.assertEqual(self.browse("storage", "local", "get", "draft", session="borrowed-owner").stdout, "draft: keep me\n")
        tab = json.loads(self.browse("tab", "list", "--json", session="borrowed-2").stdout)["data"]["tabs"]
        picked = next(item["tabId"] for item in tab if item["active"])
        self.browse("tab", picked, session="borrowed-2")
        self.assertEqual(self.browse("storage", "local", "clear", session="borrowed-2").stdout, "✓ Storage cleared\n")

    def test_long_runs_in_a_change_report_are_one_line(self):
        session = "runs"
        self.browse("open", self.url("picker.html"), "--show", session=session)
        edited = self.browse("click", "#edit", session=session).stdout
        self.assertIn('+   48 options in combobox "Start time" (12:00 AM … 11:30 PM; ', edited)
        self.assertRegex(edited, r'\+   option "9:00 AM" \[selected, ref=e\d+\]')
        self.assertRegex(edited, r'\+ button "Save meeting" \[ref=e\d+\]')
        self.assertNotIn('option "3:30 PM"', edited)
        self.assertEqual(len(edited.splitlines()), 7, edited)
        linked = self.browse("click", "#results", session=session).stdout
        self.assertRegex(linked, r"\+ 30 links \(Result 1 … Result 30; e\d+…e\d+\)")
        data = json.loads(self.browse("click", "#edit", "--json", session=session).stdout)["data"]["changes"]
        self.assertGreaterEqual(len(data["rerendered"]), 48)
        self.assertEqual(self.browse("snapshot", "-i", session=session).stdout.count('option "'), 54)

    def test_select_picks_from_a_typeahead_and_a_popup_combobox(self):
        session = "typeahead"
        self.browse("open", self.url("picker.html"), "--show", session=session)
        filled = self.browse("fill", "#guest-input", "Priya R", session=session).stdout
        self.assertIn("→ 1 suggestion showing, none picked. To pick one: ardia browse select #guest-input 'Priya R'", filled)
        ambiguous = self.browse("select", "#guest-input", "Pri", "--json", session=session, check=False)
        self.assertEqual(json.loads(ambiguous.stdout)["code"], "ambiguous")
        picked = self.browse("select", "#guest-input", "Priya Raman", "alex.morgan@northwind.dev", "lena.vogt@kontor.io", session=session).stdout
        self.assertTrue(picked.startswith('✓ Picked "Priya Raman priya.raman@northwind.dev · Engineering Manager" for "Priya Raman"\n'
                                          '✓ Picked "Alex Morgan alex.morgan@northwind.dev · Software Engineer" for "alex.morgan@northwind.dev"\n'
                                          '✓ Picked "Invite lena.vogt@kontor.io Guest outside Northwind" for "lena.vogt@kontor.io"\n'), picked)
        self.assertRegex(picked, r'\+ button "Remove lena.vogt@kontor.io" \[ref=e\d+\]')
        self.browse("select", "#color", "Blue", session=session)
        self.browse("select", "#city", "lis", session=session)
        state = self.report(session)
        self.assertEqual(state, {"guests": ["priya.raman@northwind.dev", "alex.morgan@northwind.dev", "lena.vogt@kontor.io"], "color": "Blue", "city": "Lisbon"})
        refused = self.browse("select", "#edit", "x", session=session, check=False)
        self.assertIn("isn't a <select> or a combobox", refused.stderr)
        self.assertIn('✓ Picked "urgent"', self.browse("select", "#tags", "urgent", session=session).stdout)
        partial = self.browse("select", "#tags", "urg", "--json", session=session, check=False)
        self.assertEqual(json.loads(partial.stdout)["code"], "no_fresh_suggestions")
        self.assertIn('✓ Picked "Region West" for "West"', self.browse("select", "#region", "West", session=session).stdout)
        borrowed = self.browse("select", "#size", "Square", session=session, check=False)
        self.assertIn("no list of suggestions is linked to this field", borrowed.stderr)
        unlinked = self.browse("select", "#owner", "Alice", session=session, check=False)
        self.assertEqual(unlinked.returncode, 1)
        self.assertIn("no list of suggestions is linked to this field", unlinked.stderr)
        self.assertIn("Recent", unlinked.stderr)
        stale = self.browse("select", "#assignee", "Alice", "--json", session=session, check=False)
        self.assertEqual(json.loads(stale.stdout)["code"], "no_fresh_suggestions")
        state = self.report(session)
        self.assertEqual((state.get("tag"), state.get("assignee"), state.get("region")), ("urgent", None, "Region West"))

    def test_find_role_takes_the_name_the_snapshot_shows(self):
        session = "find-role"
        self.browse("open", self.url("disclosure.html"), "--show", session=session)
        snap = self.browse("snapshot", "-i", session=session).stdout
        self.assertRegex(snap, r'- button "Main fare rules" \[expanded=false, ref=e\d+\]')
        toggled = self.browse("find", "role", "button", "Main fare rules", "click", session=session).stdout
        self.assertIn('[expanded=true, ref=', toggled)
        ambiguous = self.browse("find", "role", "button", "--name", "Delete", "click", session=session, check=False)
        self.assertEqual(ambiguous.returncode, 1)
        self.assertIn('2 buttons are named exactly "Delete", so nothing was clicked', ambiguous.stderr)
        self.browse("find", "role", "button", "click", "--name", "Open trigger", session=session)
        dialog = self.browse("snapshot", "-s", "[role=dialog]", session=session).stdout
        self.assertTrue(dialog.startswith('- dialog "Trigger"\n  - button "When a webhook fires" [ref='), dialog)
        self.browse("find", "role", "button", "--name", "when a webhook fires", "click", session=session)
        missing = self.browse("find", "role", "button", "click", "--name", "Archive", session=session, check=False)
        self.assertIn('No button named "Archive" on this page; the buttons here are:', missing.stderr)
        self.assertEqual(self.report(session)["clicks"], ["Main fare rules", "open", "webhook"])

    def test_sessions_share_tab_ids_and_close_keeps_a_tab_another_session_uses(self):
        self.browse("open", self.url("login.html#shared"), session="opener")
        opener = json.loads(self.browse("tab", "list", "--json", session="opener").stdout)["data"]["tabs"]
        mine = next(tab for tab in opener if tab["openedBySession"])
        other = json.loads(self.browse("tab", "list", "--json", session="watcher").stdout)["data"]["tabs"]
        seen = next(tab for tab in other if tab["targetId"] == mine["targetId"])
        self.assertEqual((seen["tabId"], seen["openedBy"]), (mine["tabId"], "opener"))
        self.browse("tab", mine["tabId"], session="watcher")
        closed = self.browse("close", session="opener").stdout
        self.assertEqual(closed, f"✓ Session opener closed (0 tabs it opened); left open: [{mine['tabId']}], which session watcher uses\n")
        self.assertEqual(self.browse("get", "url", session="watcher").stdout, self.url("login.html#shared") + "\n")



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
    def browse(cls, *args, session="token", check=True, timeout=120, stdin=None):
        env = dict(os.environ, PYTHONPATH=str(CLI))
        env.pop("AGENT_BROWSER_NO_HUMANIZE", None)
        done = subprocess.run([sys.executable, "-m", "ardia_cli", "browse", "--data-dir", str(cls.data), "--session", session, *args],
                              capture_output=True, text=True, timeout=timeout, env=env, input=stdin)
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

    def test_a_service_worker_starting_during_a_session_leaves_the_browser_running(self):
        session = "token-worker"
        self.browse("open", self.url("login.html"), session=session)
        self.browse("open", self.url("service-worker.html"), session=session)
        self.assertEqual(self.browse("wait", "--text", "worker registered", session=session).returncode, 0)
        time.sleep(1)
        self.assertTrue(self.alive(self.pid))
        self.assertIn("service worker", self.browse("get", "title", session=session).stdout)

    def test_changes_and_auto_attach_over_the_token_policy(self):
        session = "token-changes"
        self.browse("open", self.url("form.html"), "--show", session=session)
        self.browse("click", "#open", session=session)
        self.browse("batch", session=session, stdin="fill #i-title Token\nfill #i-day 2026-11-11\nfill #i-at 9:00 AM\n")
        posted = json.loads(self.browse("click", "#save", "--json", session=session).stdout)["data"]["changes"]["network"]
        self.assertEqual([(row["method"], row["status"]) for row in posted], [("POST", 501)])
        self.assertEqual(json.loads(self.browse("session", "info", "--json", session=session).stdout)["data"]["captures"], [])
        attached = self.browse("get", "url", session="token-attach")
        self.assertEqual(attached.stdout, self.url("form.html") + "\n")
        self.assertIn("uses the active one", attached.stderr)

    def test_html5_drag_over_the_token_policy(self):
        session = "token-dnd"
        self.browse("open", self.url("dnd.html"), "--show", session=session)
        done = self.browse("drag", "#alpha", "#charlie", "--json", session=session, check=False)
        answer = json.loads(done.stdout)
        if done.returncode:
            self.assertEqual((answer["code"], answer["data"]["method"]), ("policy_refused", "Input.setInterceptDrags"))
        else:
            self.assertEqual((answer["data"]["started"], answer["data"]["dropped"]), (True, True))
        order = json.loads(self.browse("get", "text", "#report", session=session).stdout)["order"]
        self.assertEqual(order, ["alpha", "bravo", "charlie", "delta"] if done.returncode else ["bravo", "charlie", "alpha", "delta"])

    def test_open_from_a_borrowed_tab_says_where_input_goes(self):
        self.browse("open", self.url("login.html"), "--show", session="token-shown")
        session = "token-borrow"
        self.assertIn("uses the active one", self.browse("get", "url", session=session).stderr)
        opened = self.browse("open", self.url("probe.html"), session=session).stdout
        self.assertIn("since this session uses your tab", opened)
        clicked = self.browse("click", "#target", session=session, check=False)
        if "takes input without being shown" in opened:
            self.assertEqual(clicked.returncode, 0, clicked.stderr)
        else:
            self.assertIn("use: ardia browse tab", opened)
            self.assertEqual(clicked.returncode, 1)
            self.assertIn("--show (or open <url> --show)", clicked.stderr)

    def test_a_background_tab_takes_clicks_and_typing_without_show(self):
        self.browse("open", self.url("picker.html#behind"), "--show", session="token-behind-owner")
        behind = json.loads(self.browse("tab", "list", "--json", session="token-behind-owner").stdout)["data"]["tabs"]
        tab = next(item["tabId"] for item in behind if item["url"].endswith("#behind"))
        self.browse("open", self.url("login.html#front"), "--show", session="token-front")
        self.browse("tab", tab, session="token-behind")
        clicked = self.browse("click", "#results", session="token-behind")
        self.assertIn("+ 30 links (Result 1 … Result 30;", clicked.stdout)
        self.assertNotIn("background tab", clicked.stderr)
        self.browse("fill", "#city", "Lisbon", session="token-behind")
        self.assertEqual(self.browse("get", "value", "#city", session="token-behind").stdout, "Lisbon\n")

    def test_tab_takes_the_id_ardia_windows_prints(self):
        self.browse("open", self.url("login.html#app-id"), session="token-app-opener")
        windows = subprocess.run([sys.executable, "-m", "ardia_cli", "windows", "--json", "--data-dir", str(self.data)], capture_output=True, text=True,
                                 timeout=60, env=dict(os.environ, PYTHONPATH=str(CLI)))
        row = next(tab for window in json.loads(windows.stdout) for tab in window["tabs"] if tab["url"] == self.url("login.html#app-id"))
        app_id = row["id"]
        if "targetId" not in row:
            refused = self.browse("tab", app_id, session="token-app", check=False)
            self.assertIn("doesn't say which page belongs to", refused.stderr)
            self.skipTest("this Ardia's `windows` doesn't report tab targets yet")
        picked = self.browse("tab", app_id, "--json", session="token-app")
        self.assertEqual(json.loads(picked.stdout)["data"]["appTabId"], app_id)
        listed = self.browse("tab", "list", session="token-app").stdout
        line = next(line for line in listed.splitlines() if "#app-id" in line)
        self.assertIn(f"] {app_id}  Fixture Login - ", line)
        self.assertIn("(opened by session token-app-opener)", line)

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
