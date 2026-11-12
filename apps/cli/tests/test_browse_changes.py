import asyncio
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import notes
from ardia_cli.browse import actions, changes, commands, daemon, fields, paths, snapshot
from ardia_cli.browse import cli as browse_cli
from ardia_cli.browse.errors import BrowseError, Gated, Usage
from ardia_cli.browse.state import State

SCRATCH = Path.home() / "ardia-scratch"


def scratch(test) -> Path:
    SCRATCH.mkdir(exist_ok=True)
    path = Path(tempfile.mkdtemp(prefix="browse-changes-", dir=SCRATCH))
    test.addCleanup(shutil.rmtree, path, ignore_errors=True)
    return path


def run(coro):
    return asyncio.run(coro)


def ax(node_id, role, name="", parent=None, children=(), backend=None, value=None, props=None, ignored=False):
    node = {"nodeId": node_id, "role": {"value": role}, "name": {"value": name}, "childIds": list(children), "ignored": ignored}
    if parent:
        node["parentId"] = parent
    if backend is not None:
        node["backendDOMNodeId"] = backend
    if value is not None:
        node["value"] = {"value": value}
    if props:
        node["properties"] = [{"name": key, "value": {"value": item}} for key, item in props.items()]
    return node


DATE_FORM = [
    ax("1", "RootWebArea", "Form", children=["2", "3", "4", "9"]),
    ax("2", "textbox", "Title", parent="1", backend=2, props={"required": True}),
    ax("3", "Date", "Date", parent="1", backend=3, value="2026-11-06", children=["31"]),
    ax("31", "group", "", parent="3", children=["32", "33", "34"]),
    ax("32", "spinbutton", "Month Month", parent="31", backend=32, value="11"),
    ax("33", "spinbutton", "Day Day", parent="31", backend=33, value="6"),
    ax("34", "button", "Show date picker Show date picker", parent="31", backend=34),
    ax("4", "InputTime", "Starts", parent="1", backend=4, children=["41"]),
    ax("41", "spinbutton", "Hours Hours", parent="4", backend=41, value="0"),
    ax("9", "DateTime", "When", parent="1", backend=9),
]


def numbered(nodes):
    for index, node in enumerate(snapshot.walk(nodes)):
        if node.role in snapshot.REF_ROLES:
            node.ref = f"e{node.backend}"
    return nodes


class DateAndTimeInputsAreOneNode(unittest.TestCase):
    def test_typed_inputs_render_as_one_textbox_without_their_pieces(self):
        nodes = numbered(snapshot.build_tree(DATE_FORM))
        text = snapshot.render(nodes, interactive=True)
        self.assertEqual(text, "\n".join([
            '- textbox "Title" [required, ref=e2]',
            '- textbox "Date" [type=date, ref=e3]: 2026-11-06',
            '- textbox "Starts" [type=time, ref=e4]',
            '- textbox "When" [type=datetime-local, ref=e9]',
        ]))
        full = snapshot.render(nodes)
        for piece in ("spinbutton", "picker", "Month Month"):
            self.assertNotIn(piece, full)

    def test_dom_type_and_value_win_over_the_tree(self):
        nodes = snapshot.build_tree(DATE_FORM)

        class Page:
            async def resolve_backend(self, backend, frame, label):
                return SimpleNamespace(backend_id=backend, frame=frame)

            async def call(self, function, element, **kwargs):
                return {9: {"type": "week", "value": "2026-W46", "required": True}}.get(element.backend_id, {"type": None, "value": None})

        run(snapshot.field_values(Page(), nodes))
        when = next(node for node in snapshot.walk(nodes) if node.backend == 9)
        self.assertEqual((when.props["inputType"], when.value, when.props.get("required")), ("week", "2026-W46", True))


class FillFormats(unittest.TestCase):
    def test_accepted_values_are_normalized(self):
        cases = {
            ("date", "2026-11-9"): "2026-11-09", ("time", "2:30 PM"): "14:30", ("time", "12am"): "00:00", ("time", "9:05:07"): "09:05:07",
            ("datetime-local", "2026-11-09 14:30"): "2026-11-09T14:30", ("datetime-local", "2026-11-09T9:00 am"): "2026-11-09T09:00",
            ("month", "2026-3"): "2026-03", ("week", "2026-w7"): "2026-W07", ("color", "#ABC"): "#aabbcc", ("color", "3b82f6"): "#3b82f6",
            ("range", "55"): "55", ("date", ""): "",
        }
        for (kind, text), wanted in cases.items():
            self.assertEqual(fields.normalize(kind, text), wanted, (kind, text))

    def test_bad_values_are_refused_with_the_format(self):
        for kind, text in (("date", "11/09/2026"), ("date", "2026-02-30"), ("time", "25:00"), ("time", "14"), ("time", "13pm"),
                           ("datetime-local", "2026-11-09"), ("month", "2026-13"), ("week", "2026-W60"), ("color", "red"), ("range", "nan")):
            with self.assertRaises(BrowseError) as caught:
                fields.normalize(kind, text)
            self.assertEqual(caught.exception.code, "bad_value")
            self.assertIn(fields.FORMATS[kind], caught.exception.message)

    def test_fill_sets_typed_inputs_directly_and_reads_back(self):
        from ardia_cli.browse import actions

        calls = []

        class Page:
            def loader(self, frame):
                return "L"

            async def focus_element(self, element):
                calls.append("focus")

            async def call(self, function, *args, **kwargs):
                if "ardiaBrowse.info" in function:
                    return {"tag": "input", "type": "time", "editable": True, "disabled": False, "value": ""}
                calls.append(("set", args[1]))
                return {"set": True, "stored": args[1]}

        element = SimpleNamespace(frame="F", label="@e4")
        self.assertEqual(run(actions.fill(Page(), element, "2:30 PM", False)), (False, "14:30"))
        self.assertEqual(calls, ["focus", ("set", "14:30")])

    def test_a_value_the_input_rejects_is_an_error(self):
        from ardia_cli.browse import actions

        class Page:
            async def focus_element(self, element):
                pass

            async def call(self, function, *args, **kwargs):
                return {"set": False, "stored": "2026-11-06"}

        with self.assertRaises(BrowseError) as caught:
            run(actions.set_value(Page(), SimpleNamespace(frame="F", label="@e3"), "date", "2026-11-09"))
        self.assertEqual(caught.exception.code, "bad_value")


def view(entries, loader="L1", url="http://x/", title="T"):
    return changes.View("T", loader, url, title, entries)


def row(ref, line, level=0, value="", attrs=(), role="button", name=None):
    return {"ref": ref, "level": level, "role": role, "name": name if name is not None else line, "value": value, "attrs": list(attrs), "line": line}


class ChangesReport(unittest.TestCase):
    def test_added_removed_and_changed_nodes(self):
        before = view([row("e1", 'button "New"'), row("e2", 'textbox "Title"', role="textbox", name="Title")])
        after = view([row("e2", 'textbox "Title": Hi', value="Hi", role="textbox", name="Title"), row("e3", 'button "Save"'),
                      row("e4", 'option "A"', level=1)], url="http://x/#2", title="T2")
        report = changes.diff(before, after, [{"method": "POST", "url": "http://x/api", "statuses": [200], "status": 200, "type": "Fetch"}])
        self.assertEqual(changes.render(report), "\n".join([
            "changes:",
            "url: http://x/ → http://x/#2",
            "title: 'T' → 'T2'",
            '+ button "Save"',
            '+   option "A"',
            '~ textbox "Title": Hi (was empty)',
            '- button "New"',
            "POST http://x/api → 200",
        ]))
        data = changes.as_data(report)
        self.assertEqual([item["ref"] for item in data["added"]], ["e3", "e4"])
        self.assertEqual(data["changed"][0]["to"]["value"], "Hi")
        self.assertEqual(changes.render(changes.diff(after, after)), "changes: none")

    def test_many_removed_nodes_fold_into_one_line_and_returning_ones_into_another(self):
        before = view([row(f"e{index}", f'button "B{index}"', name=f"B{index}") for index in range(1, 9)])
        after = view([row("e20", 'textbox "Title"')])
        report = changes.diff(before, after)
        self.assertIn("- 8 removed: e1 e2 e3 e4 e5 e6 e7 e8", changes.render(report))
        state = SimpleNamespace(extras={"shown": {"e1": 'button "B1"'}})
        back = changes.diff(after, before)
        changes.mark_shown(state, back, before)
        text = changes.render(back)
        self.assertIn("+ 1 back as last shown: e1", text)
        self.assertIn('+ button "B2"', text)
        self.assertNotIn('+ button "B1"', text)

    def test_a_long_run_of_options_is_one_line_that_keeps_the_selected_one(self):
        times = [f"{hour}:{minute} {half}" for half in ("AM", "PM") for hour in (12, 1, 2, 3) for minute in ("00", "30")]
        select = row("e7", 'combobox "Start time" [expanded=false, ref=e7]: 9:00 AM', role="combobox", name="Start time")
        options = [row(f"e{8 + index}", f'option "{label}"', level=1, role="option", name=label, attrs=["selected"] if label == "2:30 AM" else [])
                   for index, label in enumerate(times)]
        save = row("e30", 'button "Save meeting"', name="Save meeting")
        report = changes.diff(view([]), view([select, *options, save]))
        self.assertEqual(changes.render(report), "\n".join([
            "changes:",
            '+ combobox "Start time" [expanded=false, ref=e7]: 9:00 AM',
            '+   16 options in combobox "Start time" (12:00 AM … 3:30 PM; e8…e23)',
            '+   option "2:30 AM"',
            '+ button "Save meeting"',
            changes.RUN_HINT,
        ]))
        self.assertEqual(len(changes.as_data(report)["added"]), 18)

    def test_options_rerendered_under_an_existing_picker_name_it(self):
        select = row("e7", 'combobox "Start time"', role="combobox", name="Start time")
        before = view([select] + [row(f"e{index}", f'option "{index}"', level=1, role="option", name=str(index)) for index in range(8, 14)])
        after = view([select] + [row(f"e{index}", f'option "{index}"', level=1, role="option", name=str(index)) for index in range(20, 26)])
        text = changes.render(changes.diff(before, after))
        self.assertIn('+ 6 options in combobox "Start time" (20 … 25; e20…e25)', text)
        self.assertIn("- 6 removed: e8 e9 e10 e11 e12 e13", text)

    def test_short_runs_and_mixed_roles_stay_verbatim(self):
        rows = [row(f"e{index}", f'link "L{index}"', role="link", name=f"L{index}") for index in range(1, 6)]
        rows.insert(2, row("e9", 'button "Buy"', name="Buy"))
        text = changes.render(changes.diff(view([]), view(rows)))
        self.assertEqual(text.splitlines()[1:], [f"+ {item['line']}" for item in rows])

    def test_a_run_of_links_with_children_lists_enabled_ones_and_counts_disabled(self):
        rows = []
        for index in range(1, 13):
            rows.append(row(f"e{index * 2}", f'button "Seat {index}A"', name=f"Seat {index}A", attrs=["disabled"] if index % 2 else []))
            rows.append(row(f"e{index * 2 + 1}", f'heading "Row {index}"', level=1, role="heading", name=f"Row {index}"))
        text = changes.render(changes.diff(view([]), view(rows)))
        self.assertEqual(text.splitlines()[1:9], [f'+ button "Seat {index}A"' for index in range(2, 13, 2)]
                         + ["+ 6 disabled buttons (Seat 1A … Seat 11A)", changes.RUN_HINT])
        folded = [row(f"e{index}", f'button "Seat {index}A"', name=f"Seat {index}A") for index in range(1, 13)]
        self.assertIn("+ 12 buttons (Seat 1A … Seat 12A; e1…e12)", changes.render(changes.diff(view([]), view(folded))))
        eleven = changes.render(changes.diff(view([]), view(rows[:22])))
        self.assertIn('+ button "Seat 11A"', eleven)

    def test_changed_runs_fold_too(self):
        before = view([row(f"e{index}", f'option "R{index}"', role="option", name=f"R{index}", attrs=[]) for index in range(1, 8)])
        after = view([row(f"e{index}", f'option "R{index}" Busy', role="option", name=f"R{index} Busy",
                          attrs=["selected" if index == 3 else ""][:1 if index == 3 else 0]) for index in range(1, 8)])
        text = changes.render(changes.diff(before, after))
        self.assertIn("~ 7 options changed (R1 Busy … R7 Busy; e1…e7)", text)
        self.assertIn('~ option "R3" Busy (was named \'R3\')', text)

    def test_nodes_redrawn_as_they_were_are_one_line_with_their_new_refs(self):
        chips = [row(f"e{index}", f'button "Remove {name}"', name=f"Remove {name}") for index, name in enumerate(["Ana", "Bo", "Cy"], 1)]
        before = view(chips)
        after = view([row(f"e{index + 10}", item["line"], name=item["name"]) for index, item in enumerate(chips, 1)]
                     + [row("e14", 'button "Remove Di"', name="Remove Di")])
        report = changes.diff(before, after)
        self.assertEqual(changes.render(report), "\n".join([
            "changes:",
            '+ button "Remove Di"',
            "+ 3 redrawn as they were, with new refs: e11…e13",
        ]))
        self.assertEqual(changes.as_data(report)["rerendered"], [{"ref": "e11", "was": "e1"}, {"ref": "e12", "was": "e2"}, {"ref": "e13", "was": "e3"}])
        self.assertEqual(len(changes.as_data(report)["removed"]), 3)

    def test_a_new_document_lists_what_it_has(self):
        report = changes.diff(view([row("e1", "a")]), view([row("e5", "b")], loader="L2", url="http://y/"))
        self.assertEqual(report["document"], "new")
        self.assertEqual(report["removed"], [])
        self.assertIn("new document, 1 interactive nodes (its snapshot -i, so no need to take one):\n+ b", changes.render(report))

    def test_a_navigation_prints_the_whole_new_page_and_a_same_page_change_stays_short(self):
        rows = [row(f"e{index}", f'textbox "Field {index}"', role="textbox", name=f"Field {index}") for index in range(1, 81)]
        navigated = changes.render(changes.diff(view([row("e900", "a")]), view(rows, loader="L2", url="http://y/")))
        self.assertIn('+ textbox "Field 80"', navigated)
        self.assertNotIn("more lines", navigated)
        same = changes.render(changes.diff(view([]), view(rows)))
        self.assertIn('+ textbox "Field 40"', same)
        self.assertIn("+ … 40 more lines (`snapshot -i -s <css>` shows one region)", same)
        self.assertNotIn("run `snapshot -i`", same)

    def test_arriving_on_another_site_shows_its_notes_like_snapshot(self):
        root = scratch(self)
        folder = root / "Notes"
        folder.mkdir(mode=0o700)
        (folder / "y.test.md").write_text("Use the blue button\n")
        os.chmod(folder / "y.test.md", 0o600)
        state = SimpleNamespace(config={"data_root": str(root)})
        here = changes.arrival_notes(state, view([], url="http://x.test/"), view([], url="http://y.test/a"))
        self.assertEqual(here, "# notes for y.test (ardia notes): Use the blue button")
        self.assertIsNone(changes.arrival_notes(state, view([], url="http://y.test/b"), view([], url="http://y.test/a")))
        report = changes.diff(view([row("e1", "a")], url="http://x.test/"), view([row("e2", "b")], loader="L2", url="http://y.test/a"))
        report["notes"] = here
        self.assertTrue(changes.render(report).startswith("changes:\nurl: http://x.test/ → http://y.test/a\n# notes for y.test"))
        self.assertEqual(changes.as_data(report)["notes"], here)

    def test_urls_lose_secrets(self):
        self.assertEqual(changes.clean_url("https://user:pw@api.example.com:8443/v1/items?key=abc&flag&id=7#frag"),
                         "https://api.example.com:8443/v1/items?key=…&flag&id=…")
        self.assertEqual(changes.clean_url("data:text/plain,secret"), "data:…")
        self.assertEqual(changes.clean_url("blob:https://x/1234"), "blob:…")
        self.assertEqual(changes.clean_url("http://[::1]:8080/a"), "http://[::1]:8080/a")
        self.assertTrue(changes.clean_url("https://x/" + "p" * 500).endswith("…"))
        self.assertEqual(changes.clean_url("https://api.telegram.org/bot123456:AAH-secret/sendMessage?sk_live%2FABC"),
                         "https://api.telegram.org/…/sendMessage?…")
        self.assertEqual(changes.clean_url("https://x/reset/k9f8a7s6d5f4g3h2j1k0l9/done"), "https://x/reset/…/done")
        self.assertEqual(changes.clean_url("https://x/api/events/42"), "https://x/api/events/42")

    def test_a_registered_secret_is_masked_before_the_path_is_cut(self):
        from ardia_cli import redact

        secret = "ControlTokenAllLettersQwertyuiopAsdfgh"
        redact.add_secret(secret)
        url = "https://x/" + "a" * 180 + "/" + secret + "/tail"
        for cleaned in (changes.clean_url(url), changes.masked_url(url), redact.redact(changes.clean_url(url))):
            self.assertNotIn(secret[:8], cleaned)

    def test_page_urls_keep_their_shape_but_lose_sensitive_values(self):
        self.assertEqual(changes.masked_url("https://x/cb?code=abc&state=xyz&q=shoes#access_token=t"), "https://x/cb?code=…&state=…&q=shoes#…")
        self.assertEqual(changes.masked_url("https://x/s?q=a+b&page=2#top"), "https://x/s?q=a+b&page=2#top")
        report = changes.diff(view([], url="https://x/"), view([], url="https://x/?password=hunter2"))
        self.assertNotIn("hunter2", changes.render(report))
        self.assertNotIn("hunter2", str(changes.as_data(report)))


class WatchPage:
    def __init__(self, network_on=False):
        self.state = SimpleNamespace(listeners=[])
        self.network_on = network_on
        self.session_id = "S"
        self.sent = []

    async def send(self, method, params=None, **kwargs):
        self.sent.append(method)
        return {}


class NetworkWatchTest(unittest.TestCase):
    def events(self, watch, page):
        watch.listener(page, "Network.requestWillBeSent", {"requestId": "1", "type": "Fetch", "request": {"method": "post", "url": "http://x/api?token=t"}})
        watch.listener(page, "Network.responseReceived", {"requestId": "1", "response": {"status": 201}})
        watch.listener(page, "Network.requestWillBeSent", {"requestId": "2", "type": "XHR", "request": {"method": "GET", "url": "http://x/list"}})
        watch.listener(page, "Network.requestWillBeSent", {"requestId": "3", "type": "Document", "request": {"method": "POST", "url": "http://x/form"}})
        watch.listener(page, "Network.requestWillBeSent", {"requestId": "3", "type": "Document", "request": {"method": "GET", "url": "http://x/done"},
                                                           "redirectResponse": {"status": 303}})
        watch.listener(page, "Network.responseReceived", {"requestId": "3", "response": {"status": 200}})
        watch.listener(page, "Network.loadingFinished", {"requestId": "3"})
        watch.listener(WatchPage(), "Network.requestWillBeSent", {"requestId": "9", "request": {"method": "POST", "url": "http://other/"}})

    def test_writes_are_the_non_get_requests_of_this_page(self):
        async def go():
            page = WatchPage()
            watch = changes.NetworkWatch(page)
            await watch.start()
            self.events(watch, page)
            self.assertTrue(watch.busy())
            watch.listener(page, "Network.loadingFailed", {"requestId": "2", "errorText": "net::ERR_ABORTED"})
            self.assertFalse(watch.busy())
            await watch.stop()
            return page, watch

        page, watch = run(go())
        self.assertEqual(page.sent, ["Network.enable", "Network.disable"])
        self.assertEqual(page.state.listeners, [])
        self.assertEqual([(write["method"], write["url"], write["statuses"]) for write in watch.writes()],
                         [("POST", "http://x/api?token=…", [201]), ("POST", "http://x/form", [303, 200])])

    def test_cancelled_while_enabling_leaves_no_listener(self):
        class Slow(WatchPage):
            async def send(self, method, params=None, **kwargs):
                self.sent.append(method)
                if method == "Network.enable":
                    await asyncio.sleep(10)
                return {}

        async def go():
            page = Slow()
            watch = changes.NetworkWatch(page)
            task = asyncio.ensure_future(watch.start())
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            return page

        page = run(go())
        self.assertEqual(page.state.listeners, [])
        self.assertEqual(page.sent, ["Network.enable", "Network.disable"])

    def test_cancel_during_stop_is_not_swallowed(self):
        class SlowDisable(WatchPage):
            async def send(self, method, params=None, **kwargs):
                self.sent.append(method)
                if method == "Network.disable":
                    await asyncio.sleep(0.5)
                return {}

        async def go():
            watch = changes.NetworkWatch(SlowDisable())
            await watch.start()
            task = asyncio.ensure_future(watch.stop())
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        run(go())

    def test_a_cancelled_stop_finishes_its_disable_before_the_next_command(self):
        class Tab(WatchPage):
            enabled = False

            async def send(self, method, params=None, **kwargs):
                self.sent.append(method)
                if method == "Network.enable":
                    self.enabled = True
                if method == "Network.disable":
                    await asyncio.sleep(0.3)
                    self.enabled = False
                return {}

        async def go():
            page = Tab()
            watch = changes.NetworkWatch(page)
            await watch.start()
            stopping = asyncio.ensure_future(watch.stop())
            await asyncio.sleep(0.05)
            stopping.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await stopping
            page.network_on = True
            await page.send("Network.enable")
            await asyncio.sleep(0.5)
            return page

        self.assertTrue(run(go()).enabled)

    def test_an_unconfirmed_disable_drops_the_cdp_session(self):
        detached = []

        class Failing(WatchPage):
            def __init__(self):
                super().__init__()
                self.browser = SimpleNamespace(send=self.browser_send)

            async def send(self, method, params=None, **kwargs):
                self.sent.append(method)
                if method == "Network.disable":
                    raise BrowseError("Network.disable got no answer in 2s")
                return {}

            async def browser_send(self, method, params=None, session=None, timeout=30):
                detached.append((method, params))
                return {}

            def detach(self):
                self.session_id = None

        async def go():
            page = Failing()
            watch = changes.NetworkWatch(page)
            await watch.start()
            await watch.stop()
            return page

        page = run(go())
        self.assertIsNone(page.session_id)
        self.assertEqual(detached, [("Target.detachFromTarget", {"sessionId": "S"})])

    def test_capture_already_on_is_left_on(self):
        async def go():
            page = WatchPage(network_on=True)
            watch = changes.NetworkWatch(page)
            await watch.start()
            await watch.stop()
            return page

        self.assertEqual(run(go()).sent, [])

    def test_settles_fast_when_nothing_happens_and_gives_up_at_the_bound(self):
        async def go():
            page = WatchPage()
            watch = changes.NetworkWatch(page)
            await watch.start()
            loop = asyncio.get_running_loop()
            started = loop.time()
            quiet = await watch.settle()
            fast = loop.time() - started
            watch.listener(page, "Network.requestWillBeSent", {"requestId": "1", "type": "Fetch", "request": {"method": "POST", "url": "http://x/"}})
            with mock.patch.object(changes, "SETTLE_LIMIT", 0.3):
                started = loop.time()
                busy = await watch.settle()
                bounded = loop.time() - started
            await watch.stop()
            return quiet, fast, busy, bounded

        quiet, fast, busy, bounded = run(go())
        self.assertTrue(quiet)
        self.assertLess(fast, 0.3)
        self.assertFalse(busy)
        self.assertLess(bounded, 0.6)

    def test_refused_network_capture_still_runs_the_action(self):
        class Refusing(WatchPage):
            async def send(self, method, params=None, **kwargs):
                self.sent.append(method)
                raise Gated(method)

        async def go():
            page = Refusing()
            watch = changes.NetworkWatch(page)
            await watch.start()
            return page, watch

        page, watch = run(go())
        self.assertFalse(watch.watching)
        self.assertEqual(page.state.listeners, [])
        self.assertEqual(page.sent, ["Network.enable"])


class OutputCap(unittest.TestCase):
    def test_text_is_capped_at_a_line_with_ways_to_narrow_it(self):
        text = "\n".join(f"- button \"Button {index}\" [ref=e{index}]" for index in range(400))
        _, out, _ = daemon.render({}, result=commands.Result({}, text), name="snapshot")
        body, note = out.rstrip("\n").rsplit("\n", 1)
        self.assertLessEqual(len(body), daemon.OUTPUT_CAP)
        self.assertTrue(body.endswith("]"))
        self.assertEqual(note, f"[output capped at {len(body):,} of {len(text):,} characters. Narrow it instead: snapshot -i (interactive only), "
                               "snapshot -s <css> (one region), find role <role> <action> --name <text> (act without a snapshot). "
                               f"Only if you need every line: --max-output {len(text)}]")
        self.assertNotIn("--full", note)
        _, read, _ = daemon.render({}, result=commands.Result({}, text), name="get")
        self.assertIn("Narrow it instead: get text <css> or read -s <css> (one region)", read)
        self.assertEqual(daemon.render({"full": True}, result=commands.Result({}, text))[1], text + "\n")
        self.assertEqual(daemon.render({"max_output": 0}, result=commands.Result({}, text))[1], text + "\n")
        self.assertNotIn("capped", daemon.render({"json": True}, result=commands.Result({"t": text}, text))[1])

    def test_a_secret_cut_by_the_cap_is_still_masked(self):
        from ardia_cli import redact

        secret = "S3cretContinuesPastTheCap"
        redact.add_secret(secret)
        text = "x" * (daemon.OUTPUT_CAP - 5) + secret
        _, out, _ = daemon.render({}, result=commands.Result({}, text))
        self.assertNotIn("S3cre", out)

    def test_max_output_must_be_a_number(self):
        with self.assertRaises(Usage):
            browse_cli.options_from({"max_output": "lots"}, {})


class BatchFromStdin(unittest.TestCase):
    def test_comments_and_blank_lines_are_skipped(self):
        seen = []

        async def fake_dispatch(ctx, name, argv):
            seen.append([name, *argv])
            return commands.Result({"ok": True})

        ctx = commands.Ctx(SimpleNamespace(extras={}), {}, "/", {}, "# set up\nclick @e1\n\n  # fill\nfill '#a b' \"x y\"\n[\"press\", \"Enter\"]\n", "batch")
        with mock.patch.object(daemon, "dispatch", fake_dispatch):
            result = run(commands.cmd_batch(ctx, []))
        self.assertEqual(seen, [["click", "@e1"], ["fill", "#a b", "x y"], ["press", "Enter"]])
        self.assertFalse(getattr(result, "failed", False))

    def run_batch(self, text, fail=()):
        seen = []

        async def fake_dispatch(ctx, name, argv):
            seen.append(([name, *argv], {key: ctx.options.get(key) for key in ("no_changes", "humanize")}))
            if name in fail:
                raise BrowseError(f"{name} failed")
            return commands.Result({"ok": True})

        ctx = commands.Ctx(SimpleNamespace(extras={}), {"humanize": False}, "/", {}, text, "batch")
        with mock.patch.object(daemon, "dispatch", fake_dispatch):
            result = run(commands.cmd_batch(ctx, ["--bail"]))
        return ctx, seen, result

    def test_lines_take_the_flags_agents_put_on_them(self):
        ctx, seen, result = self.run_batch("snapshot -s main --full\nget text main --max-output 9000\nclick @e1 --no-changes --humanize\n")
        self.assertEqual([argv for argv, _ in seen], [["snapshot", "-s", "main"], ["get", "text", "main"], ["click", "@e1"]])
        self.assertEqual(seen[2][1], {"no_changes": True, "humanize": True})
        self.assertTrue(ctx.options["full"])
        self.assertFalse(getattr(result, "failed", False))
        _, refused, result = self.run_batch("click @e1 --session other\n")
        self.assertEqual(refused, [])
        self.assertIn("--session applies to the whole session", result.text)

    def test_a_result_that_reports_failure_fails_its_line_bail_and_the_closing_close(self):
        seen = []

        async def fake_dispatch(ctx, name, argv):
            seen.append(name)
            result = commands.Result({"pages": 1}, "✗ http://x/ failed: 404")
            if name == "read":
                result.failed = True
            return result

        ctx = commands.Ctx(SimpleNamespace(extras={}), {}, "/", {}, "read http://x/\nget text main\nclose\n", "batch")
        with mock.patch.object(daemon, "dispatch", fake_dispatch):
            result = run(commands.cmd_batch(ctx, ["--bail"]))
        self.assertEqual(seen, ["read"])
        self.assertEqual([outcome["success"] for outcome in result.data["results"]], [False, False])
        self.assertTrue(result.failed)
        self.assertNotIn("close_after_batch", ctx.state.extras)
        self.assertIn("✗ http://x/ failed: 404", result.text)

    def test_close_runs_after_the_batch_as_its_last_line_only(self):
        ctx, seen, result = self.run_batch("notes append done\nclose\n")
        self.assertEqual([argv for argv, _ in seen], [["notes", "append", "done"]])
        self.assertTrue(ctx.state.extras["close_after_batch"])
        ctx, seen, result = self.run_batch("click @e1\nclose\n", fail=("click",))
        self.assertNotIn("close_after_batch", ctx.state.extras)
        self.assertIn("close not run: an earlier line failed or didn't run", result.text)
        ctx, seen, result = self.run_batch("close\ntab t1\n")
        self.assertIn("to close this session's tab and go on, use `tab close`", result.text)
        self.assertNotIn("close_after_batch", ctx.state.extras)

    def test_an_unknown_outcome_with_line_flags_stops_the_rest_and_never_closes(self):
        seen = []

        async def fake_dispatch(ctx, name, argv):
            seen.append([name, *argv])
            if name == "click":
                raise commands.OutcomeUnknown("click", "it was sent")
            return commands.Result({"ok": True})

        ctx = commands.Ctx(SimpleNamespace(extras={}), {}, "/", {}, "click #pay --no-changes\nclick #pay --no-changes\nget text main\nclose\n", "batch")
        with mock.patch.object(daemon, "dispatch", fake_dispatch):
            result = run(commands.cmd_batch(ctx, []))
        self.assertEqual(seen, [["click", "#pay"]])
        self.assertEqual([outcome.get("code") for outcome in result.data["results"]], ["outcome_unknown", "not_run", "not_run", "not_run"])
        self.assertNotIn("close_after_batch", ctx.state.extras)

    def test_a_line_max_output_only_widens_the_cap(self):
        ctx, _, _ = self.run_batch("get text main --max-output 100\n")
        self.assertEqual(ctx.options["max_output"], commands.BATCH_DEFAULT_CAP)
        ctx, _, _ = self.run_batch("get text main --max-output 9000\n")
        self.assertEqual(ctx.options["max_output"], 9000)

    def test_a_closing_batch_answer_includes_the_close(self):
        self.assertEqual(daemon.joined_batch("✓ Done\n", "✓ Session s closed (1 tab it opened)\n", {}), "✓ Done\n\n✓ Session s closed (1 tab it opened)\n")
        joined = json.loads(daemon.joined_batch('[{"command":["click"],"success":true}]\n', '{"success":true,"data":{"closed":true},"error":null}\n', {"json": True}))
        self.assertEqual(joined[-1], {"command": ["close"], "success": True, "result": {"closed": True}, "error": None})


class ReadingHints(unittest.TestCase):
    def test_fetch_in_eval_points_at_read_and_script_once(self):
        self.assertTrue(commands.FETCHING.search("Promise.all(urls.map(u => fetch(u).then(r => r.text())))"))
        self.assertTrue(commands.FETCHING.search("new DOMParser().parseFromString(t, 'text/html')"))
        self.assertFalse(commands.FETCHING.search("document.title"))
        state = SimpleNamespace(extras={})
        commands.hint_once(state, "fetch", commands.FETCH_HINT)
        commands.hint_once(state, "fetch", commands.FETCH_HINT)
        self.assertEqual(state.extras["notice"], commands.FETCH_HINT)

    def test_open_then_get_text_on_three_pages_suggests_read(self):
        state = SimpleNamespace(extras={})
        steps = [("open", ["http://a/1"]), ("get", ["text", "main"]), ("open", ["http://a/2"]), ("get", ["text", "main"]), ("open", ["http://a/3"])]
        for name, argv in steps:
            commands.note_reading(state, name, argv, None)
        self.assertNotIn("notice", state.extras)
        commands.note_reading(state, "get", ["text", "main"], None)
        self.assertEqual(state.extras["notice"], commands.PAGE_BY_PAGE_HINT)

    def test_link_clicks_count_as_arriving_and_form_work_resets_the_streak(self):
        state = SimpleNamespace(extras={})
        clicked = commands.Result({"changes": {"document": "new"}})
        for _ in range(2):
            commands.note_reading(state, "click", ["@e1"], clicked)
            commands.note_reading(state, "get", ["text", "main"], None)
        commands.note_reading(state, "fill", ["@e2", "x"], commands.Result({"changes": {"document": "same"}}))
        commands.note_reading(state, "click", ["@e1"], clicked)
        commands.note_reading(state, "get", ["text", "main"], None)
        self.assertNotIn("notice", state.extras)


class AutoAttach(unittest.TestCase):
    def state(self, active):
        state = State({"session": "t"}, lambda: None)
        state.endpoint = SimpleNamespace(active=active)
        state.target_infos = {"A": {"targetId": "A", "url": "http://a/", "title": "A"}, "B": {"targetId": "B", "url": "http://b/", "title": "B"}}

        async def refresh():
            return list(state.target_infos.values())

        state.refresh_targets = refresh
        return state

    def test_token_path_takes_the_active_tab(self):
        state = self.state("http://127.0.0.1:1/ardia/active?token=x")
        with mock.patch.object(state, "active_target", mock.AsyncMock(return_value="B")):
            self.assertEqual(run(state.attach_active()), "B")
        self.assertEqual(state.current, "B")
        self.assertIn("[t1] B - http://b/", state.extras["notice"])

    def test_a_session_whose_tab_closed_does_not_move_to_the_users_tab(self):
        state = self.state(None)
        state.extras["had_tab"] = True
        state.connect = mock.AsyncMock()
        state.attach_active = mock.AsyncMock(side_effect=AssertionError("must not auto-attach"))
        with self.assertRaises(BrowseError) as caught:
            run(state.page())
        self.assertEqual(caught.exception.code, "tab_gone")

    def test_new_tab_showing_is_no_page(self):
        state = self.state("http://127.0.0.1:1/ardia/active?token=x")
        with mock.patch.object(state, "active_target", mock.AsyncMock(return_value=None)):
            with self.assertRaises(BrowseError) as caught:
                run(state.attach_active())
        self.assertEqual(caught.exception.code, "no_tab")

    def test_test_servers_take_visible_and_focused_then_visible(self):
        state = self.state(None)
        answers = {"A": (True, False), "B": (True, True)}
        with mock.patch.object(state, "probe", mock.AsyncMock(side_effect=lambda target: answers[target])):
            self.assertEqual(run(state.attach_active()), "B")
        state = self.state(None)
        answers = {"A": (False, False), "B": (True, False)}
        with mock.patch.object(state, "probe", mock.AsyncMock(side_effect=lambda target: answers[target])):
            self.assertEqual(run(state.attach_active()), "B")
        state = self.state(None)
        with mock.patch.object(state, "probe", mock.AsyncMock(return_value=(False, False))):
            with self.assertRaises(BrowseError):
                run(state.attach_active())


class SiteNotes(unittest.TestCase):
    def test_sites(self):
        self.assertEqual(notes.site_of("http://127.0.0.1:8791/x?y"), "127.0.0.1:8791")
        self.assertEqual(notes.site_of("https://Example.COM:443/"), "example.com")
        self.assertEqual(notes.site_of("example.com/path"), "example.com")
        self.assertEqual(notes.site_of("[::1]:8080"), "[::1]:8080")
        self.assertEqual(notes.site_of("bücher.de"), "xn--bcher-kva.de")
        self.assertEqual(notes.site_of("a/../../b"), "a")
        for bad in ("../etc", "", "exa mple.com", "host:99999", ".", "a..b"):
            with self.assertRaises(BrowseError):
                notes.site_of(bad)
        self.assertIsNone(notes.page_site("about:blank"))

    def test_arguments(self):
        self.assertEqual(notes.parse_args([]), notes.Request("get", None))
        self.assertEqual(notes.parse_args(["example.com"]), notes.Request("get", "example.com"))
        self.assertEqual(notes.parse_args(["set", "Log in with SSO"]), notes.Request("set", None, "Log in with SSO"))
        self.assertEqual(notes.parse_args(["set", "use", "the", "form"]), notes.Request("set", None, "use the form"))
        self.assertEqual(notes.parse_args(["append", "localhost:3000", "-"]), notes.Request("append", "localhost:3000", "-"))
        self.assertEqual(notes.parse_args(["list"]), notes.Request("list", None))
        with self.assertRaises(Usage):
            notes.parse_args(["set"])

    def test_store_is_private_capped_and_refuses_links(self):
        root = scratch(self)
        os.chmod(root, 0o700)
        set_note = notes.run_request(root, notes.Request("set", "example.com", "Line one"), None)
        self.assertEqual(set_note.data, {"site": "example.com", "bytes": 9})
        notes.run_request(root, notes.Request("append", None, "Line two"), "https://example.com/a")
        self.assertEqual((root / "Notes" / "example.com.md").read_text(), "Line one\nLine two\n")
        self.assertEqual((root / "Notes").stat().st_mode & 0o777, 0o700)
        self.assertEqual((root / "Notes" / "example.com.md").stat().st_mode & 0o777, 0o600)
        self.assertEqual(notes.run_request(root, notes.Request("get", "example.com"), None).text, "Line one\nLine two")
        with self.assertRaises(BrowseError) as caught:
            notes.run_request(root, notes.Request("set", "example.com", "x" * (notes.MAX_NOTE + 1)), None)
        self.assertEqual(caught.exception.code, "notes_too_large")
        self.assertEqual([row["site"] for row in notes.run_request(root, notes.Request("list", None), None).data["notes"]], ["example.com"])
        site, header = notes.header(root, "https://example.com/page")
        self.assertEqual(header, "# notes for example.com (ardia notes): Line one\n# Line two")
        notes.run_request(root, notes.Request("set", "long.example", "y" * 3000), None)
        _, header = notes.header(root, "http://long.example/")
        self.assertLess(len(header), notes.HEADER_LIMIT + 200)
        self.assertIn("ardia notes get long.example", header)
        target = root / "elsewhere.md"
        target.write_text("secret")
        os.symlink(target, root / "Notes" / "linked.example.md")
        with self.assertRaises((OSError, paths.PathError)):
            notes.run_request(root, notes.Request("get", "linked.example"), None)
        self.assertEqual(notes.run_request(root, notes.Request("rm", "example.com"), None).data["removed"], True)
        self.assertEqual(notes.run_request(root, notes.Request("rm", "example.com"), None).data["removed"], False)

    def test_a_linked_notes_folder_is_refused(self):
        root = scratch(self)
        os.chmod(root, 0o700)
        (root / "real").mkdir(mode=0o700)
        os.symlink(root / "real", root / "Notes")
        with self.assertRaises(paths.PathError):
            notes.run_request(root, notes.Request("set", "example.com", "x"), None)

    def test_no_site_without_a_web_page(self):
        with self.assertRaises(BrowseError) as caught:
            notes.run_request(scratch(self), notes.Request("get", None), "about:blank")
        self.assertEqual(caught.exception.code, "bad_site")


class SecretsBeforeCuts(unittest.TestCase):
    def test_a_secret_is_masked_before_a_label_is_folded_or_a_name_is_cut(self):
        from ardia_cli import redact

        secret = "Sk3cretTokenValue1234567890abcdef"
        redact.add_secret(secret)
        label = changes.run_label("Account " + "x" * 25 + secret)
        self.assertNotIn(secret[:6], label)
        name = "y" * 190 + secret
        node = snapshot.build_tree([ax("1", "RootWebArea", "", children=["2"]), ax("2", "button", name, parent="1", backend=2)])[0]
        self.assertNotIn(secret[:6], node.name)
        self.assertLessEqual(len(node.name), snapshot.MAX_NAME)


class SummaryAndScopes(unittest.TestCase):
    def test_a_summary_toggle_is_a_button_with_a_ref(self):
        tree = [ax("1", "RootWebArea", "D", children=["2"]), ax("2", "DisclosureTriangle", "Main fare rules", parent="1", backend=2, props={"expanded": False})]
        nodes = numbered(snapshot.build_tree(tree))
        self.assertEqual(snapshot.render(nodes, interactive=True), '- button "Main fare rules" [expanded=false, ref=e2]')

    def test_a_selector_scopes_to_every_match_with_something_in_the_tree(self):
        tree = [
            ax("1", "RootWebArea", "D", children=["2", "3"]),
            ax("2", "dialog", "Cookies", parent="1", backend=2, ignored=True),
            ax("3", "dialog", "Trigger", parent="1", backend=3, children=["4"]),
            ax("4", "button", "When a webhook fires", parent="3", backend=4),
        ]

        class Page:
            async def send(self, method, params=None, **kwargs):
                return {"nodes": tree}

        nodes = numbered(run(snapshot.frame_nodes(Page(), "F", scopes=[2, 3, 4])))
        self.assertEqual(snapshot.render(nodes), '- dialog "Trigger"\n  - button "When a webhook fires" [ref=e4]')


def role_tree(*names, role="button"):
    return [ax(str(index), role, name, backend=index) for index, name in enumerate(names, 1)]


class FindRole(unittest.TestCase):
    def test_every_order_an_agent_writes(self):
        cases = {
            ("role", "button", "click"): ("role", ["button", "click"], "Go"),
            ("role", "click", "button"): ("role", ["button", "click"], "Go"),
            ("role", "button"): ("role", ["button"], "Go"),
        }
        for args, wanted in cases.items():
            self.assertEqual(commands.find_arguments(list(args), "Go"), wanted)
        self.assertEqual(commands.find_arguments(["role", "button", "When a webhook fires", "click"], None),
                         ("role", ["button", "click"], "When a webhook fires"))
        self.assertEqual(commands.find_arguments(["role", "button", "Delete"], None), ("role", ["button"], "Delete"))
        self.assertEqual(commands.find_arguments(["role", "textbox", "fill", "hello"], None), ("role", ["textbox", "fill", "hello"], None))
        self.assertEqual(commands.find_arguments(["role=button", "click"], "Go"), ("role", ["button", "click"], "Go"))
        options, positionals = commands.parse(["role", "button", "--name", "Go", "click", "--exact"], {"--name": "value", "--exact": "bool"})
        self.assertEqual((options, positionals), ({"name": "Go", "exact": True}, ["role", "button", "click"]))

    def test_the_exact_name_beats_a_longer_one_that_contains_it(self):
        nodes = role_tree("Discord wake · When a webhook fires · Active", "When a webhook fires")
        found, how = commands.role_candidates(nodes, "button", "when a webhook  fires", False)
        self.assertEqual(([node["backendDOMNodeId"] for node, _ in found], how), ([2], "exact"))

    def test_partial_matches_only_without_an_exact_one(self):
        found, how = commands.role_candidates(role_tree("Save draft", "Close"), "button", "save", False)
        self.assertEqual(([name for _, name in found], how), (["Save draft"], "partial"))
        self.assertEqual(commands.role_candidates(role_tree("Save draft"), "button", "save", True)[0], [])

    def test_summary_answers_to_button(self):
        found, _ = commands.role_candidates(role_tree("Main fare rules", role="DisclosureTriangle"), "button", "Main fare rules", False)
        self.assertEqual(len(found), 1)

    def test_ambiguous_names_list_candidates_with_refs_and_click_nothing(self):
        class Page:
            async def send(self, method, params=None, **kwargs):
                return {"nodes": role_tree("Delete", "Delete", "Delete all")}

            async def resolve_backend(self, backend, frame, label):
                return SimpleNamespace(backend_id=backend, frame=frame, label=label)

        state = SimpleNamespace(add_ref=lambda page, element, role, name: f"e{element.backend_id}")
        ctx = SimpleNamespace(state=state)
        with self.assertRaises(BrowseError) as caught:
            run(commands.find_role(ctx, Page(), "F", "button", "Delete", False))
        self.assertEqual(caught.exception.code, "ambiguous")
        self.assertIn('2 buttons are named exactly "Delete"', caught.exception.message)
        self.assertIn('button "Delete" [ref=e1]', caught.exception.message)
        self.assertEqual([item["ref"] for item in caught.exception.data["candidates"]], ["@e1", "@e2"])
        with self.assertRaises(BrowseError) as missing:
            run(commands.find_role(ctx, Page(), "F", "button", "Archive", False))
        self.assertEqual(missing.exception.code, "not_found")
        self.assertIn('"Delete all"', missing.exception.message)


def suggestion(text, *pieces):
    return {"text": text, "pieces": list(pieces) or [text]}


class Suggestions(unittest.TestCase):
    PEOPLE = [
        suggestion("Priya Raman priya.raman@northwind.dev · Engineering Manager", "Priya Raman", "priya.raman@northwind.dev", "Engineering Manager"),
        suggestion("Priyanka Rao priyanka.rao@northwind.dev · Software Engineer", "Priyanka Rao", "priyanka.rao@northwind.dev", "Software Engineer"),
        suggestion("Invite lena.vogt@kontor.io Guest outside Northwind", "Invite lena.vogt@kontor.io", "Guest outside Northwind"),
    ]

    def test_exact_text_label_value_or_email_is_exact_and_a_line_or_substring_is_not(self):
        self.assertEqual(actions.exact_pick("PRIYANKA.RAO@northwind.dev", self.PEOPLE), 1)
        self.assertEqual(actions.exact_pick("lena.vogt@kontor.io", self.PEOPLE), 2)
        self.assertIsNone(actions.exact_pick("Priya Raman", self.PEOPLE))
        labelled = {"text": "Blue", "exact": ["Blue", "colour-blue"], "pieces": ["Blue"]}
        self.assertEqual(actions.exact_pick("colour-blue", [labelled]), 0)
        pick = lambda value: actions.pick_suggestion(value, self.PEOPLE, "Guests")
        self.assertEqual(pick("Priya Raman"), 0)
        self.assertEqual(pick("Raman"), 0)
        self.assertEqual(actions.pick_suggestion("Blue", [suggestion("Blue Grey"), suggestion("Blue")], "Colour"), 1)

    def test_two_matches_or_none_are_errors_that_list_the_suggestions(self):
        with self.assertRaises(BrowseError) as caught:
            actions.pick_suggestion("Pri", self.PEOPLE, '"Guests"')
        self.assertEqual(caught.exception.code, "ambiguous")
        self.assertIn('"Pri" matches 2 suggestions in "Guests"', caught.exception.message)
        with self.assertRaises(BrowseError) as none:
            actions.pick_suggestion("Zed", self.PEOPLE, "Guests")
        self.assertEqual(none.exception.code, "no_match")
        self.assertIn("Priyanka Rao", none.exception.message)

    def test_only_a_list_that_changed_after_the_last_keystroke_is_fresh(self):
        ready = lambda **watch: actions.suggestions_ready({"busy": False, "since": 1000, "first": 400, "changed": 0, "now": 3000, **watch})
        self.assertFalse(ready(changed=0))
        self.assertFalse(ready(changed=900))
        self.assertTrue(ready(changed=1100))
        self.assertFalse(ready(changed=2900))
        self.assertFalse(ready(changed=1100, busy=True))

    def choose(self, value, items, watch):
        class Page:
            async def call(self, function, *args, **kwargs):
                if "suggestionState" in function:
                    return watch
                if "popupsOf(el).length" in function:
                    return 1
                return None

        clicked = []

        async def nothing(*args, **kwargs):
            return None

        async def now(page, element):
            return [SimpleNamespace(label="", frame="F", text=item["text"]) for item in items], items

        async def kind(page, element):
            return "typeahead"

        async def click(page, element, humanize, *rest):
            clicked.append(element.text)

        with mock.patch.multiple(actions, combo_kind=kind, watch_suggestions=nothing, unwatch_suggestions=nothing, fill=nothing,
                                 suggestions_now=now, click=click):
            picked = run(actions.choose(Page(), SimpleNamespace(frame="F", label="@e3"), [value], False, '"Assignee"', 0.2))
        return picked, clicked

    def test_a_list_left_from_an_earlier_query_gives_only_an_exact_match(self):
        stale = {"busy": False, "since": 1000, "first": 400, "changed": 700, "now": 3000}
        old = [{"text": "Alice Jones", "exact": ["Alice Jones"], "pieces": ["Alice Jones"]}]
        with self.assertRaises(BrowseError) as caught:
            self.choose("Alice", old, stale)
        self.assertEqual(caught.exception.code, "no_fresh_suggestions")
        self.assertIn('What\'s showing: "Alice Jones"', caught.exception.message)
        self.assertEqual(self.choose("Alice Jones", old, stale)[1], ["Alice Jones"])
        fresh = dict(stale, changed=1100)
        self.assertEqual(self.choose("Alice", old, fresh)[1], ["Alice Jones"])

if __name__ == "__main__":
    unittest.main()
