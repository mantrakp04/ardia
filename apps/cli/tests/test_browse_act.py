import asyncio
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import command_metrics
from ardia_cli.browse import actions, commands, help as helptext
from ardia_cli.browse.errors import BrowseError, Usage
from ardia_cli.browse.page import Element

CLI = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "browse"
CHROME = os.environ.get("ARDIA_BROWSE_CHROME")


def run(coroutine):
    return asyncio.run(coroutine)


class DropPoint(unittest.TestCase):
    BOX = (10, 200, 110, 240)

    def test_moving_down_drops_on_the_lower_quarter_and_up_on_the_upper(self):
        self.assertEqual(actions.drop_point(self.BOX, (60, 20), None), (60, 230))
        self.assertEqual(actions.drop_point(self.BOX, (60, 500), None), (60, 210))

    def test_before_and_after_pick_the_side_whatever_the_direction(self):
        self.assertEqual(actions.drop_point(self.BOX, (60, 20), "before"), (60, 210))
        self.assertEqual(actions.drop_point(self.BOX, (60, 500), "after"), (60, 230))

    def test_a_row_of_items_uses_the_width(self):
        self.assertEqual(actions.drop_point(self.BOX, (-400, 220), None), (85, 220))
        self.assertEqual(actions.drop_point(self.BOX, (900, 220), None), (35, 220))


class DragAnswer(unittest.TestCase):
    def test_names_the_new_place_or_an_unchanged_order(self):
        moved = {"html5": True, "started": True, "dropped": True, "position": {"from": 4, "to": 5, "count": 5}}
        self.assertEqual(commands.drag_text(moved), "✓ Done (HTML5 drag and drop)\nmoved to 5 of 5 (was 4)")
        still = {"html5": False, "position": {"from": 2, "to": 2, "count": 3}}
        self.assertEqual(commands.drag_text(still), "✓ Done\nthe order didn't change: still 2 of 3")

    def test_before_and_after_are_exclusive(self):
        ctx = commands.Ctx(state=None, options={}, cwd="/", env={}, stdin=None, command="drag")
        with self.assertRaises(Usage):
            run(commands.cmd_drag(ctx, ["@e1", "@e2", "--before", "--after"]))


class HelpFallback(unittest.TestCase):
    def test_every_command_has_help_or_its_overview_line(self):
        for name in commands.COMMANDS:
            text = helptext.command_help(name)
            self.assertNotEqual(text, helptext.OVERVIEW, name)
            self.assertLess(len(text), 2500, name)

    def test_a_command_without_an_entry_prints_one_line_and_no_flags(self):
        self.assertEqual(helptext.command_help("pushstate"), "ardia browse back, forward, reload, pushstate <url>\nflags: none")
        self.assertIs(helptext.command_help("no-such-command"), helptext.OVERVIEW)

    def test_drag_documents_its_sides(self):
        self.assertIn("--before|--after", helptext.command_help("drag"))
        self.assertIn("moved to 5 of 5", helptext.command_help("drag"))


class InsertOrType(unittest.TestCase):
    def test_plain_inputs_get_one_insert_unless_humanized_guarded_or_secret(self):
        text = {"tag": "input", "type": "text", "editable": True}
        self.assertTrue(actions.inserts_at_once(text, False, None))
        self.assertTrue(actions.inserts_at_once({**text, "type": "email"}, False, None))
        self.assertFalse(actions.inserts_at_once({**text, "type": "password"}, False, None))
        self.assertFalse(actions.inserts_at_once(text, True, None))
        self.assertFalse(actions.inserts_at_once(text, False, object()))
        self.assertTrue(actions.inserts_at_once({"tag": "textarea", "editable": True}, False, None))

    def test_a_combobox_input_still_types(self):
        class Page:
            def __init__(self, kind):
                self.kind = kind

            async def call(self, function, *args, **kwargs):
                return self.kind

        element = Element("F", "O", 1, "@e1")
        self.assertTrue(run(actions.plain_input(Page(None), element, {"tag": "input"})))
        self.assertFalse(run(actions.plain_input(Page("typeahead"), element, {"tag": "input"})))


class Disabling:
    def __init__(self, enabled_after=None, aria=False):
        self.enabled_after = enabled_after
        self.aria = aria
        self.checks = 0

    async def call(self, function, *args, **kwargs):
        if function == actions.DISABLED_STATE:
            self.checks += 1
            off = self.enabled_after is not None and self.checks > self.enabled_after
            return {"native": not off and not self.aria, "aria": not off and self.aria}
        return None


class WaitForEnabled(unittest.TestCase):
    def test_returns_once_the_target_is_enabled(self):
        page = Disabling(enabled_after=3)
        run(actions.wait_enabled(page, Element("F", "O", 1, "@e4")))
        self.assertEqual(page.checks, 4)

    def test_a_target_that_stays_disabled_fails_after_the_wait(self):
        with mock.patch.object(actions, "ENABLE_WAIT", 0.12):
            with self.assertRaises(BrowseError) as caught:
                run(actions.wait_enabled(Disabling(), Element("F", "O", 1, "@e4")))
        self.assertEqual(caught.exception.code, "disabled")
        self.assertIn("@e4 is disabled", caught.exception.message)

    def test_aria_disabled_is_clicked_anyway_after_the_wait(self):
        with mock.patch.object(actions, "ENABLE_WAIT", 0.12):
            run(actions.wait_enabled(Disabling(aria=True), Element("F", "O", 1, "@e4"), strict=False))

    def test_the_wait_is_counted(self):
        metrics = command_metrics.Metrics("click", False, True)
        token = command_metrics.current.set(metrics)
        try:
            run(actions.wait_enabled(Disabling(enabled_after=1), Element("F", "O", 1, "@e4")))
        finally:
            command_metrics.current.reset(token)
        self.assertEqual(command_metrics.clean(metrics.values).get("waited_for_enabled"), True)


class FillOnSelect(unittest.TestCase):
    def test_picks_by_label_or_value_and_reports_the_label(self):
        picked = []

        class Page:
            async def call(self, function, *args, **kwargs):
                if "el.options" in function:
                    return [{"text": "Alpha", "exact": ["a"]}, {"text": "Beta", "exact": ["b"]}]
                return None

        async def select(page, element, values):
            picked.append(values)

        with mock.patch.object(actions, "select", select):
            self.assertEqual(run(actions.pick_option(Page(), Element("F", "O", 1, "@e2"), "beta")), "Beta")
            self.assertEqual(run(actions.pick_option(Page(), Element("F", "O", 1, "@e2"), "a")), "Alpha")
            with self.assertRaises(BrowseError) as caught:
                run(actions.pick_option(Page(), Element("F", "O", 1, "@e2"), "Gamma"))
        self.assertEqual(picked, [["b"], ["a"]])
        self.assertIn("None of the options", caught.exception.message)


class CellAnswer(unittest.TestCase):
    def test_a_cell_edit_prints_its_name_new_value_and_old_one(self):
        result = commands.filled_result("filled", "#c-2356-reorder", False, "250", {"cell": "Reorder level, FAS-53565 Reno", "value": "250", "was": "150"})
        self.assertEqual(result.text, '✓ Done\n~ gridcell "Reorder level, FAS-53565 Reno": 250 (was 150)')
        self.assertEqual(result.data["was"], "150")
        empty = commands.filled_result("filled", "#c", False, "", {"cell": "Bin, new row", "value": "", "was": ""})
        self.assertEqual(empty.text, '✓ Done\n~ gridcell "Bin, new row": empty (was empty)')


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def answers(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            return response.status == 200
    except OSError:
        return False


def wait_for(check, seconds: float, what: str):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {what}")


@unittest.skipUnless(CHROME and Path(CHROME).exists(), "set ARDIA_BROWSE_CHROME to a Chrome binary to act on real cells and lists")
class ActInChrome(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = Path(tempfile.mkdtemp(prefix="ardia-act-"))
        cls.data = cls.scratch / "cli-data"
        cls.data.mkdir()
        cls.http_port, cls.port = free_port(), free_port()
        cls.server = subprocess.Popen([sys.executable, "-I", "-m", "http.server", str(cls.http_port), "--bind", "127.0.0.1"], cwd=FIXTURES,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={cls.port}", f"--user-data-dir={cls.scratch / 'profile'}",
                                       "--no-first-run", "--window-size=1200,900", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            wait_for(lambda: answers(f"http://127.0.0.1:{cls.port}/json/version"), 30, "Chrome's DevTools port")
            wait_for(lambda: answers(f"http://127.0.0.1:{cls.http_port}/act-cells.html"), 10, "the fixture server")
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
        done = subprocess.run([sys.executable, "-m", "ardia_cli", "browse", "--port", str(cls.port), "--data-dir", str(cls.data), "--session", "act",
                               *args], capture_output=True, text=True, timeout=120, env=env, cwd=CLI)
        if check and done.returncode:
            raise AssertionError(f"ardia browse {' '.join(args)} exited {done.returncode}: {done.stderr}{done.stdout}")
        return done

    def setUp(self):
        self.browse("open", f"http://127.0.0.1:{self.http_port}/act-cells.html", "--show")

    def value(self, expression: str) -> str:
        return self.browse("eval", expression).stdout.strip().strip('"')

    def test_grid_cells_are_edited_in_one_batch(self):
        out = self.browse("batch", "fill #size1 large", "fill #name1 Gadget", "fill #qty1 7", "fill #g-item Nut", "fill #g-count 12").stdout
        self.assertIn('~ gridcell "Size, Widget": Large (was Small)', out)
        self.assertIn('~ gridcell "Name, Widget": Gadget (was Widget)', out)
        self.assertIn('~ gridcell "Item, Bolt": Nut (was Bolt)', out)
        self.assertIn('~ gridcell "Count, Bolt": 12 (was 5)', out)
        self.assertEqual(self.value("document.querySelector('#qtyin1').value"), "7")

    def test_a_rejected_cell_value_is_cancelled_with_the_grid_message(self):
        done = self.browse("fill", "#g-count", "many", check=False)
        self.assertEqual(done.returncode, 1)
        self.assertIn("Count must be a whole number. The edit was cancelled (Escape)", done.stderr + done.stdout)
        self.assertEqual(self.value("document.querySelector('#g-count').textContent"), "5")
        self.assertEqual(self.value("String(document.querySelectorAll('#grid .editor').length)"), "0")

    def test_dependent_fields_wait_for_their_target(self):
        out = self.browse("batch", "fill #from Beta", "select #to Yankee", "click #later", "get text #out").stdout
        self.assertIn("later clicked", out)
        self.assertEqual(self.value("document.querySelector('#to').value"), "y")
        done = self.browse("click", "#never", check=False)
        self.assertIn("#never is disabled, and it stayed disabled for 1.5 s", done.stderr + done.stdout)

    def test_drag_takes_the_target_place_and_names_it(self):
        out = self.browse("batch", 'drag "#mouse li:nth-child(1)" "#mouse li:nth-child(5)"', 'drag "#mouse li:nth-child(5)" "#mouse li:nth-child(2)"',
                          'drag "#mouse li:nth-child(1)" "#mouse li:nth-child(3)" --after').stdout
        self.assertEqual(re.findall(r"moved to \d of \d \(was \d\)", out), ["moved to 5 of 5 (was 1)", "moved to 2 of 5 (was 5)", "moved to 3 of 5 (was 1)"])
        self.assertEqual(self.value("[...document.querySelectorAll('#mouse li')].map((n) => n.textContent).join(' ')"), "one three two four five")

    def test_html5_drag_into_a_redrawn_list_names_the_place(self):
        out = self.browse("drag", "#html5 li:nth-child(1)", "#html5 li:nth-child(3)").stdout
        self.assertIn("HTML5 drag and drop", out)
        self.assertIn("moved to 3 of 3 (was 1)", out)
