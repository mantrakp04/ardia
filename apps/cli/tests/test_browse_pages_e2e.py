import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_browse_e2e import CLI, DIRECT, FIXTURES, REPO, SERVE, SESSION_JS, free_port, wait_for

sys.path.insert(0, str(CLI))

APP = os.environ.get("ARDIA_BROWSE_E2E_APP")
SCRATCH = Path(os.environ.get("ARDIA_BROWSE_PAGES_E2E_DIR", str(Path.home() / "ardia-scratch" / "browse-pages" / "e2e")))
PORT = int(os.environ.get("ARDIA_BROWSE_PAGES_E2E_PORT") or 0)


def fetch_ok(url):
    try:
        with DIRECT.open(url, timeout=2):
            return True
    except OSError:
        return False


def cdp(ws: str, method: str, params: dict | None = None) -> dict:
    from ardia_cli import guard

    async def ask():
        connection = await guard.direct_connect(ws, max_size=1 << 24)
        try:
            await connection.send(json.dumps({"id": 1, "method": method, "params": params or {}}))
            while True:
                message = json.loads(await asyncio.wait_for(connection.recv(), 10))
                if message.get("id") == 1:
                    return message.get("result") or {}
        finally:
            await connection.close()

    return asyncio.run(ask())


def page_targets(ws: str) -> dict[str, str]:
    return {info["targetId"]: info.get("url", "") for info in cdp(ws, "Target.getTargets")["targetInfos"] if info.get("type") == "page"}


class PagesChecks:
    endpoint_args: list = []

    @classmethod
    def serve_fixtures(cls):
        cls.http_port = free_port()
        cls.server = subprocess.Popen([sys.executable, "-I", "-c", SERVE, str(cls.http_port)], cwd=FIXTURES, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    @classmethod
    def browse_argv(cls, args, session):
        return [sys.executable, "-m", "ardia_cli", "browse", *cls.endpoint_args, "--data-dir", str(cls.data), "--session", session, *args]

    @classmethod
    def browse(cls, *args, session="pages", check=True, timeout=120, stdin=None):
        env = dict(os.environ, PYTHONPATH=str(CLI))
        done = subprocess.run(cls.browse_argv(args, session), capture_output=True, text=True, timeout=timeout, env=env, input=stdin)
        if check and done.returncode:
            raise AssertionError(f"ardia browse {' '.join(args)} exited {done.returncode}: {done.stderr}{done.stdout}")
        return done

    @classmethod
    def browse_in_background(cls, *args, session="pages"):
        env = dict(os.environ, PYTHONPATH=str(CLI))
        return subprocess.Popen(cls.browse_argv(args, session), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)

    def url(self, name):
        return f"http://127.0.0.1:{self.http_port}/{name}"

    def targets_with_urls(self) -> dict[str, str]:
        return page_targets(self.browser_ws())

    def targets(self):
        return sorted(self.targets_with_urls())

    def test_read_every_matching_link_renders_scripts_and_leaves_no_tabs(self):
        session = "read-links"
        self.browse("open", self.url("listing.html"), session=session)
        before = self.targets()
        out = self.browse("read", "--links", "item.html?n=", "-s", "main", session=session).stdout
        self.assertEqual(self.targets(), before)
        for n in range(1, 7):
            self.assertIn(f"=== [{n}/6] Dock {n} | Fixture Shop\n{self.url(f'item.html?n={n}')}\n# Dock {n}\n", out)
            self.assertIn(f"Charging | {60 + n * 10} W", out)
        self.assertNotIn("Sitewide banner", out)
        self.assertNotIn("Loading", out)
        data = json.loads(self.browse("read", "--links", "n=3", "--json", session=session).stdout)["data"]
        self.assertEqual([page["title"] for page in data["pages"]], ["Dock 3 | Fixture Shop"])
        self.assertNotIn("Sitewide banner", data["pages"][0]["text"])
        listed = self.browse("read", "--links", "item", "--list", session=session).stdout
        self.assertEqual(listed.splitlines(), [self.url(f"item.html?n={n}") for n in range(1, 7)])
        missing = self.browse("read", "--links", "/nothing/", session=session, check=False)
        self.assertEqual(missing.returncode, 1)
        self.assertIn("No link on", missing.stderr)

    def test_read_many_urls_with_a_failure_and_the_http_path(self):
        session = "read-urls"
        done = self.browse("read", self.url("item.html?n=1"), "http://127.0.0.1:1/", stdin=None, session=session, check=False)
        self.assertEqual(done.returncode, 1)
        self.assertIn("=== [1/2] Dock 1 | Fixture Shop", done.stdout)
        self.assertIn("=== [2/2] ✗ http://127.0.0.1:1/", done.stdout)
        piped = self.browse("read", "-", "-s", ".price", stdin=f"{self.url('item.html?n=2')}\n{self.url('item.html?n=4')}\n", session=session).stdout
        self.assertIn("$120.00", piped)
        self.assertIn("$140.00", piped)
        fetched = self.browse("read", "--http", self.url("item.html?n=1"), self.url("listing.html"), session=session).stdout
        self.assertIn("=== [1/2] Item | Fixture Shop", fetched)
        self.assertNotIn("Charging", fetched)

    def test_a_script_loops_over_pages_clicks_and_collects(self):
        session = "script-loop"
        self.browse("open", self.url("listing.html"), session=session)
        before = self.targets()
        source = """
const rows = [];
for (const url of await page.links("item.html?n=")) {
  await page.goto(url);
  await page.wait("#add");
  const changed = await page.click("#add");
  rows.push({ name: await page.text("h1"), price: await page.text(".price"), cart: await page.text("#cart"), reported: changed.includes("Added") });
}
log(`read ${rows.length} docks`);
return rows.filter((row) => row.price < "$140");
"""
        done = self.browse("script", stdin=source, session=session)
        self.assertEqual(len(self.targets()), len(before))
        lines = done.stdout.split("\n", 1)
        self.assertEqual(lines[0], "read 6 docks")
        self.assertEqual(json.loads(lines[1]), [{"name": f"Dock {n}", "price": f"${100 + n * 10}.00", "cart": "Cart: 1", "reported": True} for n in (1, 2, 3)])
        as_json = json.loads(self.browse("script", "--json", stdin="return { url: await page.url(), title: await page.title() };", session=session).stdout)
        self.assertEqual(as_json["data"]["value"], {"url": self.url("item.html?n=6"), "title": "Dock 6 | Fixture Shop"})
        pages = json.loads(self.browse("script", stdin="return (await read({ urls: ['/item.html?n=5'], selector: '.price' })).map((p) => p.text);",
                                       session=session).stdout)
        self.assertEqual(pages, ["$150.00"])
        self.assertEqual(self.browse("script", stdin="return await page.links('/none/');", session=session).stdout, "[]\n")

    def test_script_errors_name_the_line_and_time_out(self):
        session = "script-errors"
        self.browse("open", self.url("item.html?n=1"), session=session)
        before = self.targets()
        failed = self.browse("script", stdin="log('start');\nawait page.wait('#add');\nawait page.click('#nope');\nlog('never');", session=session, check=False)
        self.assertEqual(failed.returncode, 1)
        self.assertTrue(failed.stderr.startswith("✗ line 3: Element not found: #nope."), failed.stderr)
        self.assertIn("(in `click '#nope'`)\nlogged before that:\nstart", failed.stderr)
        caught = self.browse("script", stdin="try { await page.click('#nope'); } catch (e) { return e.code; }", session=session).stdout
        self.assertEqual(caught, "not_found\n")
        syntax = self.browse("script", stdin="const a = 1;\nif (a {\n}", session=session, check=False)
        self.assertEqual(syntax.returncode, 1)
        self.assertTrue(syntax.stderr.startswith("✗ line 2: SyntaxError"), syntax.stderr)
        slow = self.browse("script", "--timeout", "1s", stdin="log('waiting');\nawait sleep(5000);", session=session, check=False)
        self.assertEqual(slow.returncode, 1)
        self.assertTrue(slow.stderr.startswith("✗ The script timed out after 1s, in sleep() at line 2."), slow.stderr)
        self.assertIn("logged before that:\nwaiting", slow.stderr)
        refused = self.browse("script", stdin="await browse('close');", session=session, check=False)
        self.assertIn("close can't run inside a script", refused.stderr)
        self.assertEqual(self.targets(), before)
        self.assertEqual(self.browse("get", "title", session=session).stdout, "Dock 1 | Fixture Shop\n")

    def test_hash_route_links_are_read_and_listed(self):
        session = "hash-routes"
        self.browse("open", self.url("hashapp.html#/"), session=session)
        self.browse("wait", "--text", "Person 6", session=session)
        people = [self.url(f"hashapp.html#/people/{n}") for n in range(1, 7)]
        listed = self.browse("read", "--links", "/people/", "--list", session=session).stdout.splitlines()
        self.assertEqual(listed, people)
        out = self.browse("read", "--links", "/people/", "-s", "main", session=session).stdout
        for n in range(1, 7):
            self.assertIn(f"=== [{n}/6] Person {n} | Hash App\n{people[n - 1]}\n# Person {n}\n", out)
            self.assertIn(f"Role | Engineer {n * 11}", out)
        self.assertNotIn("Loading", out)
        legacy = self.browse("read", "--links", "#!/", "--list", session=session).stdout
        self.assertEqual(legacy, self.url("hashapp.html#!/legacy/7") + "\n")
        found = json.loads(self.browse("script", stdin="return await page.links('/people/');", session=session).stdout)
        self.assertEqual(found, people)
        opened = self.browse("open", people[3], session=session).stdout
        self.assertTrue(opened.startswith("✓ Person 4 | Hash App\n"), opened)
        walked = json.loads(self.browse("script", stdin="""
const names = [await page.goto('/hashapp.html#/').then(() => page.text('h1'))];
for (const url of (await page.links('/people/')).slice(0, 3)) { await page.goto(url); names.push(await page.text('h1')); }
return names;
""", session=session).stdout)
        self.assertEqual(walked, ["Directory", "Person 1", "Person 2", "Person 3"])

    def test_another_session_cannot_adopt_a_reader_tab(self):
        session = "reader-owner"
        self.browse("open", self.url("listing.html"), session=session)
        reading = self.browse_in_background("read", self.url("busy.html"), session=session)
        try:
            wait_for(lambda: any("busy.html" in url for url in self.targets_with_urls().values()), 15, "the reader tab")
            reader = next(target for target, url in self.targets_with_urls().items() if "busy.html" in url)
            listed = json.loads(self.browse("tab", "list", "--json", session="adopter").stdout)["data"]["tabs"]
            self.assertEqual([tab for tab in listed if tab["targetId"] == reader], [])
            adopted = self.browse("tab", reader, session="adopter", check=False)
            self.assertEqual(adopted.returncode, 1, adopted.stdout)
        finally:
            out, err = reading.communicate(timeout=60)
        self.assertEqual(reading.returncode, 0, err)
        self.assertIn("=== Busy | Fixture Shop", out)
        self.assertNotIn(reader, self.targets())

    def test_a_daemon_killed_mid_read_has_its_tab_closed_by_the_next_run(self):
        import signal

        session = "reader-killed"
        self.browse("open", self.url("listing.html"), session=session)
        before = set(self.targets())
        reading = self.browse_in_background("read", self.url("busy.html"), session=session)
        try:
            wait_for(lambda: any("busy.html" in url for url in self.targets_with_urls().values()), 15, "the reader tab")
            orphan = next(target for target, url in self.targets_with_urls().items() if "busy.html" in url)
            browse_dir = self.data / "Browse"
            pid = next(meta["pid"] for meta in (json.loads(path.read_text()) for path in browse_dir.glob("*.json") if path.name[0] != ".")
                       if isinstance(meta, dict) and meta.get("session") == session)
            os.kill(pid, signal.SIGKILL)
        finally:
            reading.communicate(timeout=60)
        self.assertIn(orphan, self.targets())
        self.browse("open", self.url("listing.html"), session=session)
        self.browse("read", self.url("item.html?n=1"), session=session)
        self.assertNotIn(orphan, self.targets())
        self.assertLessEqual(len(set(self.targets()) - before), 1)

    def test_a_dead_sessions_tab_is_closed_by_its_id_and_a_lookalike_user_tab_is_not(self):
        from ardia_cli.browse import paths
        from ardia_cli.browse.tabs import Registry

        session = "orphan-sweeper"
        self.browse("read", self.url("item.html?n=1"), session=session)
        files = [json.loads(path.read_text()) for path in (self.data / "Browse").glob("tabs-*.json")]
        instance = next(data["instance"] for data in files if data.get("version") == 3)
        user = cdp(self.browser_ws(), "Target.createTarget", {"url": self.url("item.html?n=3#ardia-temp-0123456789abcdef"), "background": True})["targetId"]
        orphan = cdp(self.browser_ws(), "Target.createTarget", {"url": "about:blank", "background": True})["targetId"]
        fd = paths.browse_dir(self.data)
        try:
            Registry(fd, "a-daemon-that-died", "dead").note_temporary(instance, orphan)
        finally:
            os.close(fd)
        try:
            self.browse("read", self.url("item.html?n=2"), session=session)
            self.assertNotIn(orphan, self.targets())
            self.assertIn(user, self.targets())
        finally:
            cdp(self.browser_ws(), "Target.closeTarget", {"targetId": user})

    def test_a_busy_script_times_out_and_its_page_goes(self):
        session = "script-busy"
        self.browse("open", self.url("item.html?n=1"), session=session)
        before = self.targets()
        started = time.monotonic()
        spun = self.browse("script", "--timeout", "2s", stdin="log('spinning');\nwhile (true) {}", session=session, check=False)
        self.assertEqual(spun.returncode, 1)
        self.assertTrue(spun.stderr.startswith("✗ The script timed out after 2s."), spun.stderr)
        self.assertIn("logged before that:\nspinning", spun.stderr)
        self.assertLess(time.monotonic() - started, 20)
        wait_for(lambda: self.targets() == before, 30, "the busy script's page to close")
        self.assertEqual(self.browse("get", "title", session=session).stdout, "Dock 1 | Fixture Shop\n")


@unittest.skipUnless(APP, "set ARDIA_BROWSE_E2E_APP to a built Ardia.app (never /Applications) to run the end-to-end test")
class ReadAndScriptOverPort(PagesChecks, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if APP.startswith("/Applications/"):
            raise unittest.SkipTest("never an installed app")
        cls.data = SCRATCH / "data"
        if cls.data.exists():
            shutil.rmtree(cls.data)
        cls.data.mkdir(parents=True)
        cls.serve_fixtures()
        cls.port = PORT or free_port()
        cls.endpoint_args = ["--port", str(cls.port)]
        launched = subprocess.run([str(REPO / "scripts/agent/ac"), "launch", APP, "--data", str(cls.data), "--port", str(cls.port), "--js", "none",
                                   "--test", "cdpTabsVisible", "--onboarded", "--no-wait"], capture_output=True, text=True, timeout=90)
        if launched.returncode:
            cls.server.terminate()
            raise RuntimeError(launched.stderr or launched.stdout)
        try:
            wait_for(lambda: fetch_ok(f"http://127.0.0.1:{cls.port}/json/version"), 60, "the instance's DevTools port")
            wait_for(lambda: fetch_ok(f"http://127.0.0.1:{cls.http_port}/listing.html"), 10, "the fixture server")
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        try:
            cls.browse("close", "--all", check=False)
        finally:
            subprocess.run([str(REPO / "scripts/agent/ac"), "quit", str(cls.data)], capture_output=True, timeout=60)
            cls.server.terminate()
            cls.server.wait(10)

    def browser_ws(self):
        with DIRECT.open(f"http://127.0.0.1:{self.port}/json/version", timeout=5) as response:
            return json.loads(response.read())["webSocketDebuggerUrl"]


@unittest.skipUnless(APP, "set ARDIA_BROWSE_E2E_APP to a built Ardia.app (never /Applications) to run the end-to-end test")
class ReadAndScriptOverToken(PagesChecks, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if APP.startswith("/Applications/"):
            raise unittest.SkipTest("never an installed app")
        cls.data = SCRATCH / "token-data"
        if cls.data.exists():
            shutil.rmtree(cls.data)
        cls.data.mkdir(parents=True)
        subprocess.run(["node", "-e", SESSION_JS, str(cls.data)], cwd=REPO, check=True, timeout=30)
        cls.serve_fixtures()
        log = str(cls.data / "app.out.log")
        subprocess.run(["open", "-g", "-n", "--env", "ARDIA_BACKGROUND=1", "--env", f"ARDIA_DATA_DIR={cls.data}", "--stdout", log, "--stderr", log, APP],
                       check=True, timeout=30)
        control = cls.data / "Chromium" / "ArdiaControl.json"
        cls.pid = None
        try:
            wait_for(control.exists, 60, "ArdiaControl.json")
            cls.pid = json.loads(control.read_text())["pid"]
            wait_for(lambda: fetch_ok(f"http://127.0.0.1:{cls.http_port}/listing.html"), 10, "the fixture server")
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
                    wait_for(lambda: not alive(cls.pid), 30, "the instance to quit")
                except (ProcessLookupError, AssertionError):
                    if alive(cls.pid):
                        os.kill(cls.pid, 9)
            cls.server.terminate()
            cls.server.wait(10)

    def browser_ws(self):
        from ardia_cli import endpoint

        return endpoint.resolve(data_dir=str(self.data)).ws


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


if __name__ == "__main__":
    unittest.main()
