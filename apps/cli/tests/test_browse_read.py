import asyncio
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path

from ardia_cli import command_metrics
from ardia_cli.browse import commands, daemon, readpages
from ardia_cli.browse.errors import Usage

CLI = Path(__file__).resolve().parents[1]
REPO = CLI.parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "browse"
CHROME = os.environ.get("ARDIA_BROWSE_CHROME")


def record(index: int, length: int) -> dict:
    return {"url": f"http://x.test/{index}", "finalUrl": f"http://x.test/{index}", "title": f"Page {index}",
            "text": "\n".join(f"line {index}.{n} " + "x" * 60 for n in range(length // 70))}


class PagesCap(unittest.TestCase):
    def test_cap_grows_with_pages_between_floor_and_ceiling(self):
        self.assertEqual(readpages.pages_cap(1), daemon.OUTPUT_CAP)
        self.assertEqual(readpages.pages_cap(2), daemon.OUTPUT_CAP)
        self.assertEqual(readpages.pages_cap(4), 12000)
        self.assertEqual(readpages.pages_cap(30), readpages.PAGES_CAP_CEILING)

    def test_twelve_pages_fit_whole_under_the_scaled_cap(self):
        records = [record(index, 1000) for index in range(12)]
        result = readpages.result_for(records, {}, {})
        self.assertNotIn("pages cut to fit", result.text)
        self.assertGreater(len(result.text), daemon.OUTPUT_CAP)
        _, out, err = daemon.render({}, result=result, name="read")
        self.assertEqual(out, result.text + "\n")
        self.assertEqual(err, "")

    def test_too_many_pages_are_cut_and_the_footer_reaches_stderr(self):
        records = [record(index, 3000) for index in range(10)]
        result = readpages.result_for(records, {}, {})
        self.assertLessEqual(len(result.text), readpages.PAGES_CAP_CEILING)
        self.assertIn("pages cut to fit 24,000 characters", result.text)
        _, out, err = daemon.render({}, result=result, name="read")
        self.assertTrue(err.startswith("[pages cut to fit 24,000 characters"))
        self.assertTrue(out.rstrip("\n").endswith(err.rstrip("\n")))

    def test_max_output_still_wins_over_the_page_budget(self):
        records = [record(index, 1000) for index in range(12)]
        result = readpages.result_for(records, {}, {"max_output": 3000})
        self.assertLessEqual(len(result.text), 3000)


class CapNotice(unittest.TestCase):
    def test_capped_output_repeats_its_notice_on_stderr(self):
        text = "\n".join(f"- row {n}" for n in range(2000))
        _, out, err = daemon.render({}, result=commands.Result({}, text), name="snapshot")
        notice = out.rstrip("\n").rpartition("\n")[2]
        self.assertTrue(notice.startswith("[output capped at "))
        self.assertEqual(err, notice + "\n")

    def test_uncapped_output_has_nothing_on_stderr(self):
        self.assertEqual(daemon.render({}, result=commands.Result({}, "short"), name="snapshot")[2], "")
        self.assertEqual(daemon.render({"full": True}, result=commands.Result({}, "x\n" * 5000), name="snapshot")[2], "")

    def test_script_gets_its_own_narrowing_hint(self):
        text = "\n".join(f"{{\"row\": {n}}}" for n in range(2000))
        _, out, _ = daemon.render({}, result=commands.Result({}, text), name="script")
        self.assertIn("Narrow it instead: return fewer fields or rows from the script.", out)

    def test_read_fields_survive_the_telemetry_filter(self):
        values = {"read_rows": 200, "read_pages": 12, "read_scrolled": True, "read_matched": True, "read_virtualized_grid": True, "read_text": "x"}
        self.assertEqual(command_metrics.clean(values), {key: value for key, value in values.items() if key != "read_text"})

    def test_output_truncated_counts_read_footers(self):
        self.assertTrue(any(marker in "x\n[pages cut to fit 6,000 characters. Narrow it instead: …" for marker in command_metrics.OUTPUT_MARKERS))
        self.assertTrue(any(marker in "x\n[+3 pages not shown. Narrow it instead: …" for marker in command_metrics.OUTPUT_MARKERS))


class ScrollRows(unittest.TestCase):
    def test_virtual_rows_are_kept_once_by_index_and_ordered(self):
        collector = readpages.RowCollector()
        collector.absorb({"rows": [{"text": "b", "index": 2, "id": "", "offset": 40}, {"text": "a", "index": 1, "id": "", "offset": 0}]})
        added = collector.absorb({"rows": [{"text": "b", "index": 2, "id": "", "offset": 40}, {"text": "c", "index": 3, "id": "", "offset": 80}]})
        self.assertEqual(added, 1)
        self.assertEqual([row["text"] for row in collector.ordered()], ["a", "b", "c"])

    def test_rows_without_an_index_dedupe_by_offset_and_text(self):
        collector = readpages.RowCollector()
        same = {"text": "Weekly digest", "index": None, "id": "", "offset": 400}
        twin = {"text": "Weekly digest", "index": None, "id": "", "offset": 680}
        collector.absorb({"rows": [same, twin, dict(same)]})
        self.assertEqual(len(collector.rows), 2)

    def test_match_ignores_case(self):
        rows = [{"text": "Receipt from STAPLES"}, {"text": "Weekly digest"}]
        self.assertEqual(readpages.matching(rows, "staples"), rows[:1])
        self.assertEqual(readpages.matching(rows, None), rows)

    def test_summary_names_why_it_stopped(self):
        self.assertEqual(readpages.scroll_summary(200, 2, "staples", "end", 1000, 3.1),
                         '[2 of 200 rows match "staples"; scrolled to the end of the list]')
        self.assertIn("--limit 50", readpages.scroll_summary(50, 50, None, "limit", 50, 1))
        self.assertIn("--timeout", readpages.scroll_summary(900, 900, None, "time", 1000, 30))
        self.assertTrue(readpages.scroll_summary(12, 12, None, "end", 1000, 1, "t3").endswith("ardia browse tab t3 --show, then read again]"))
        self.assertNotIn("hidden", readpages.scroll_summary(12, 12, None, "limit", 12, 1, "t3"))

    def test_limits(self):
        self.assertEqual(readpages.parse_rows(None), readpages.SCROLL_ROWS_DEFAULT)
        self.assertEqual(readpages.parse_rows(None, True), readpages.SCROLL_ROWS_MAX)
        self.assertEqual(readpages.parse_rows("300"), 300)
        for bad in ("0", "abc", str(readpages.SCROLL_ROWS_MAX + 1)):
            with self.assertRaises(Usage):
                readpages.parse_rows(bad)

    def test_scroll_flags_need_one_list_on_the_tab(self):
        cases = [({"scroll": True}, []), ({"scroll": True, "selector": "ul"}, ["http://x.test/"]),
                 ({"scroll": True, "selector": "ul", "http": True}, []), ({"match": "x", "selector": "ul"}, [])]
        for options, positional in cases:
            with self.subTest(options=options), self.assertRaises(Usage):
                asyncio.run(readpages.run_scroll(None, options, positional))

    def test_flags_parse(self):
        options, args = commands.parse(["-s", "@e8", "--scroll", "--limit", "50", "--match", "receipt"], readpages.flags(), readpages.ALIASES)
        self.assertEqual((options["selector"], options["scroll"], options["limit"], options["match"], args), ("@e8", True, "50", "receipt", []))
        self.assertTrue(readpages.scrolls(options))


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for(check, seconds: float, what: str):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except OSError:
            pass
        time.sleep(0.1)
    raise AssertionError(f"timed out waiting for {what}")


def answers(url: str) -> bool:
    with urllib.request.urlopen(url, timeout=2) as response:
        return response.status == 200


@unittest.skipUnless(CHROME and Path(CHROME).exists(), "set ARDIA_BROWSE_CHROME to a Chrome binary to read real lists")
class ReadListsInChrome(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = Path(tempfile.mkdtemp(prefix="ardia-read-"))
        cls.data = cls.scratch / "cli-data"
        cls.data.mkdir()
        cls.http_port, cls.port = free_port(), free_port()
        cls.server = subprocess.Popen([sys.executable, "-I", "-m", "http.server", str(cls.http_port), "--bind", "127.0.0.1"], cwd=FIXTURES,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={cls.port}", f"--user-data-dir={cls.scratch / 'profile'}",
                                       "--no-first-run", "--window-size=1200,800", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: answers(f"http://127.0.0.1:{cls.port}/json/version"), 30, "Chrome's DevTools port")
            wait_for(lambda: answers(f"http://127.0.0.1:{cls.http_port}/virtual-lists.html"), 10, "the fixture server")
            cls.browse("open", f"http://127.0.0.1:{cls.http_port}/virtual-lists.html", "--show")
        except BaseException:
            cls.tearDownClass()
            raise

    @classmethod
    def tearDownClass(cls):
        try:
            cls.browse("close", check=False)
        finally:
            for process in (cls.chrome, cls.server):
                process.terminate()
                process.wait(10)
            shutil.rmtree(cls.scratch, ignore_errors=True)

    @classmethod
    def browse(cls, *args, check=True):
        env = dict(os.environ, PYTHONPATH=str(CLI))
        done = subprocess.run([sys.executable, "-m", "ardia_cli", "browse", "--port", str(cls.port), "--data-dir", str(cls.data), "--session", "read",
                               *args], capture_output=True, text=True, timeout=120, env=env, cwd=CLI)
        if check and done.returncode:
            raise AssertionError(f"ardia browse {' '.join(args)} exited {done.returncode}: {done.stderr}{done.stdout}")
        return done

    def test_grid_reads_as_rows_with_the_virtualized_note(self):
        lines = self.browse("read", "-s", "[role=grid]").stdout.splitlines()
        self.assertEqual(lines[0], "Row | SKU | Item | Qty")
        self.assertEqual(lines[1], "1 | SKU-1000 | Washer | 0")
        self.assertRegex(lines[-1], r"^\(\d+ of 501 rows rendered; the grid is virtualized")

    def test_scroll_reads_a_lazy_virtual_list_once_in_order(self):
        out = self.browse("read", "-s", "[role=listbox]", "--scroll", "--max-output", "0").stdout.splitlines()
        self.assertEqual(out[-1], "[120 rows; scrolled to the end of the list]")
        rows = out[:-1]
        self.assertEqual(len(rows), 120)
        self.assertEqual(rows[0], "Sender 0 · Message 1")
        self.assertEqual(rows[119], "Sender 0 · Message 120")
        self.assertEqual(rows.count("Sender 0 · Weekly digest"), 2)
        self.assertEqual(self.browse("eval", "document.getElementById('mail').scrollTop").stdout.strip(), "0")

    def test_scroll_match_and_limit(self):
        out = self.browse("read", "-s", "[role=listbox]", "--scroll", "--match", "STAPLES").stdout.splitlines()
        self.assertEqual(out, ["Sender 1 · Receipt from Staples #37", "Sender 3 · Receipt from Staples #74",
                               "Sender 5 · Receipt from Staples #111", '[3 of 120 rows match "STAPLES"; scrolled to the end of the list]'])
        grid = self.browse("read", "-s", "[role=grid]", "--scroll", "--match", "hex bolt").stdout.splitlines()
        self.assertEqual(grid, ["322 | SKU-1321 | Hex bolt | 963", '[1 of 501 rows match "hex bolt"; scrolled to the end of the list]'])
        limited = self.browse("read", "-s", "[role=grid]", "--scroll", "--limit", "40").stdout.splitlines()
        self.assertEqual(len(limited), 41)
        self.assertIn("stopped at --limit 40", limited[-1])
