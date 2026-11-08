import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_browse_e2e import CLI, DIRECT, FIXTURES, REPO, SERVE, free_port, wait_for

APP = os.environ.get("ARDIA_BROWSE_E2E_APP")
SCRATCH = Path(os.environ.get("ARDIA_BROWSE_PAGES_E2E_DIR", str(Path.home() / "ardia-scratch" / "browse-pages" / "e2e")))
PORT = int(os.environ.get("ARDIA_BROWSE_PAGES_E2E_PORT") or 0)


@unittest.skipUnless(APP, "set ARDIA_BROWSE_E2E_APP to a built Ardia.app (never /Applications) to run the end-to-end test")
class ReadAndScriptEndToEnd(unittest.TestCase):
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
        cls.port = PORT or free_port()
        launched = subprocess.run([str(REPO / "scripts/agent/ac"), "launch", APP, "--data", str(cls.data), "--port", str(cls.port), "--js", "none",
                                   "--test", "cdpTabsVisible", "--onboarded", "--no-wait"], capture_output=True, text=True, timeout=90)
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
            wait_for(lambda: cls.fetch_ok(f"http://127.0.0.1:{cls.http_port}/listing.html"), 10, "the fixture server")
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
    def browse(cls, *args, session="pages", check=True, timeout=120, stdin=None):
        env = dict(os.environ, PYTHONPATH=str(CLI))
        done = subprocess.run([sys.executable, "-m", "ardia_cli", "browse", "--port", str(cls.port), "--data-dir", str(cls.data), "--session", session, *args],
                              capture_output=True, text=True, timeout=timeout, env=env, input=stdin)
        if check and done.returncode:
            raise AssertionError(f"ardia browse {' '.join(args)} exited {done.returncode}: {done.stderr}{done.stdout}")
        return done

    def url(self, name):
        return f"http://127.0.0.1:{self.http_port}/{name}"

    def targets(self):
        with DIRECT.open(f"http://127.0.0.1:{self.port}/json/list", timeout=5) as response:
            return sorted(target["id"] for target in json.loads(response.read()) if target.get("type") == "page")

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


if __name__ == "__main__":
    unittest.main()
