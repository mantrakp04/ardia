import asyncio
import io
import json
import os
import time
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli.browse import cli as browse_cli
from ardia_cli.browse import commands, daemon, readpages, script
from ardia_cli.browse.errors import BrowseError, OutcomeUnknown, Usage

SCRATCH = Path.home() / "ardia-scratch"


def run(coro):
    return asyncio.run(coro)


class Links(unittest.TestCase):
    def test_a_plain_pattern_is_a_substring_and_star_matches_anything(self):
        links = ["http://s/p/a", "http://s/c/docks?page=2", "http://s/p/b", "http://s/blog/p/x", "http://s/"]
        self.assertEqual(readpages.pick_links(links, "/p/"), ["http://s/p/a", "http://s/p/b", "http://s/blog/p/x"])
        self.assertEqual(readpages.pick_links(links, "s/p/*"), ["http://s/p/a", "http://s/p/b"])
        self.assertEqual(readpages.pick_links(links, "page=*"), ["http://s/c/docks?page=2"])
        self.assertEqual(readpages.pick_links(links, ""), links)

    def test_the_listing_itself_is_skipped(self):
        self.assertEqual(readpages.pick_links(["http://s/p/a", "http://s/p/b"], "/p/", "http://s/p/a#top"), ["http://s/p/b"])

    def test_no_match_names_some_links(self):
        message = readpages.no_links_message("/item/", "http://s/c", ["http://s/p/a?x=1", "http://s/p/b"])
        self.assertEqual(message, "No link on http://s/c matches '/item/' (2 links, such as /p/a?x=1, /p/b)")
        self.assertEqual(readpages.no_links_message("/p/", "http://s/", []), "The page has no links to read (http://s/)")


class Urls(unittest.TestCase):
    def test_arguments_and_stdin_lines_dedupe_in_order(self):
        urls = readpages.wanted_urls({"stdin": True}, ["example.com/a", "-"], "# picked\nhttp://x/1 http://x/2\n\nexample.com/a\n")
        self.assertEqual(urls, ["https://example.com/a", "http://x/1", "http://x/2"])

    def test_paths_resolve_against_the_tab(self):
        self.assertEqual(readpages.wanted_urls({}, ["/p/a", "?page=2", "../b"], None, "http://s/c/docks?page=1"),
                         ["http://s/p/a", "http://s/c/docks?page=2", "http://s/b"])
        with self.assertRaises(Usage):
            readpages.wanted_urls({}, ["/p/a"], None, None)

    def test_limits(self):
        self.assertEqual(readpages.parse_limit(None), readpages.DEFAULT_LIMIT)
        for bad in ("0", "101", "ten"):
            with self.assertRaises(Usage):
                readpages.parse_limit(bad)
        self.assertEqual(readpages.page_timeout({"timeout": "1500"}), 1.5)


class Rendering(unittest.TestCase):
    def test_pages_are_headed_by_title_and_url(self):
        records = [{"url": "http://s/p/a", "finalUrl": "http://s/p/a", "title": "Dock A", "text": "Two displays: Yes"},
                   {"url": "http://s/p/b", "error": "couldn't load it: net::ERR_CONNECTION_REFUSED"}]
        self.assertEqual(readpages.render(records, {}),
                         "=== [1/2] Dock A\nhttp://s/p/a\nTwo displays: Yes\n\n=== [2/2] ✗ http://s/p/b\ncouldn't load it: net::ERR_CONNECTION_REFUSED")
        self.assertEqual(readpages.render(records[:1], {}), "=== Dock A\nhttp://s/p/a\nTwo displays: Yes")

    def test_the_cap_is_shared_so_every_page_shows(self):
        records = [{"url": f"http://s/p/{n}", "title": f"P{n}", "text": "\n".join(f"spec {n}.{k}: value" for k in range(400))} for n in range(10)]
        records[3]["text"] = "short page"
        text = readpages.render(records, {})
        self.assertLessEqual(len(text), daemon.OUTPUT_CAP)
        for n in range(10):
            self.assertIn(f"=== [{n + 1}/10] P{n}\nhttp://s/p/{n}\n", text)
        self.assertIn("short page", text)
        self.assertIn("Narrow it instead: -s <css> (one region per page)", text)
        self.assertNotIn("--full", text)
        self.assertIn(" characters]\n\n=== [", text)
        _, out, _ = daemon.render({}, result=commands.Result({}, text))
        self.assertNotIn("output capped", out)
        full = readpages.render(records, {"full": True})
        self.assertNotIn("pages cut", full)
        self.assertGreater(len(text), daemon.OUTPUT_CAP - 400)
        self.assertEqual(readpages.render(records, {"max_output": 0}), full)

    def test_shares_give_short_pages_their_length_and_split_the_rest(self):
        self.assertEqual(readpages.shares([100, 5000, 5000], 3100), [100, 1500, 1500])
        self.assertEqual(readpages.shares([10, 20], 1000), [10, 20])


class FakeBrowser:
    def __init__(self, state, delay=0.02):
        self.state = state
        self.delay = delay
        self.created = []
        self.closed = []
        self.urls = {}
        self.stuck = set()
        self.close_fails = False
        self.live = 0
        self.peak = 0

    async def send(self, method, params=None, session=None, timeout=30):
        if method == "Target.createTarget":
            target = f"R{len(self.created) + 1}"
            self.created.append(target)
            self.urls[target] = params["url"]
            return {"targetId": target}
        if method == "Target.closeTarget":
            if self.close_fails:
                raise BrowseError("Target.closeTarget got no answer in 3s")
            self.closed.append(params["targetId"])
            return {"success": True}
        if method == "Target.getTargets":
            present = [target for target in self.urls if target not in self.closed or target in self.stuck]
            return {"targetInfos": [{"targetId": target, "type": "page", "url": self.urls[target]} for target in present]}
        raise AssertionError(method)


class FakeReader:
    def __init__(self, state, target_id, browser, fail=()):
        self.state = state
        self.target_id = target_id
        self.session_id = "S" + target_id
        self.browser = browser
        self.fail = fail
        self.url = "about:blank"

    async def attach(self, browser):
        if self.target_id in self.state.refuse_attach:
            raise BrowseError("Target.attachToTarget: No target with given id found")


class FakeRegistry:
    def __init__(self):
        self.calls = []
        self.temporary = set()
        self.refuse = set()
        self.intents = set()
        self.orphans = []

    def note_intent(self, instance, marker):
        self.calls.append(("note_intent", marker))
        self.intents.add(marker)

    def drop_intent(self, instance, marker):
        self.calls.append(("drop_intent", marker))
        self.intents.discard(marker)

    def claim_orphans(self, instance):
        return list(self.orphans)

    def release_close(self, instance, target):
        self.calls.append(("release_close", target))

    def note_temporary(self, instance, target):
        self.calls.append(("note_temporary", target))
        self.temporary.add(target)

    def temporaries(self, instance):
        return sorted(self.temporary)

    def drop_temporary(self, instance, target):
        self.calls.append(("drop_temporary", target))
        self.temporary.discard(target)

    def reserve_close(self, instance, target):
        self.calls.append(("reserve_close", target))
        return target not in self.refuse

    def finish_close(self, instance, target):
        self.calls.append(("finish_close", target))
        self.temporary.discard(target)


def reader_state():
    state = SimpleNamespace(opened=set(), target_infos={}, pages={}, connected=True, refuse_attach=set(), instance="I", registry=FakeRegistry(), extras={})
    state.browser = FakeBrowser(state)

    async def connect():
        return None

    def forget(target_id):
        state.opened.discard(target_id)
        state.pages.pop(target_id, None)
        state.target_infos.pop(target_id, None)

    state.connect = connect
    state.forget_target = forget
    return state


class ReadingTabs(unittest.TestCase):
    def setUp(self):
        self.state = reader_state()
        self.ctx = commands.Ctx(self.state, {}, "/", {}, None, "read")
        self.visits = []

        async def read_in(ctx, page, url, selector, timeout, options):
            browser = self.state.browser
            browser.live += 1
            browser.peak = max(browser.peak, browser.live)
            self.visits.append((page.target_id, url))
            await asyncio.sleep(browser.delay)
            browser.live -= 1
            if url.endswith("/boom"):
                return {"url": url, "source": "browser", "error": "couldn't load it: net::ERR_FAILED"}
            return {"url": url, "finalUrl": url, "title": url.rsplit("/", 1)[1], "text": f"text of {url}", "source": "browser"}

        page_class = lambda state, target_id: FakeReader(state, target_id, state.browser)
        patches = [mock.patch.object(readpages, "read_in", read_in), mock.patch("ardia_cli.browse.page.Page", page_class)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_at_most_four_tabs_reused_and_all_closed(self):
        urls = [f"http://s/p/{n}" for n in range(10)] + ["http://s/boom"]
        records = run(readpages.read_tabs(self.ctx, urls, None, 5, {}))
        self.assertEqual([record["url"] for record in records], urls)
        self.assertEqual(len(self.state.browser.created), 4)
        self.assertLessEqual(self.state.browser.peak, 4)
        self.assertEqual(sorted(self.state.browser.closed), sorted(self.state.browser.created))
        self.assertEqual(self.state.opened, set())
        self.assertEqual(self.state.pages, {})
        self.assertEqual(records[-1]["error"], "couldn't load it: net::ERR_FAILED")

    def test_a_cancelled_read_still_closes_its_tabs(self):
        self.state.browser.delay = 5

        async def go():
            task = asyncio.ensure_future(readpages.read_tabs(self.ctx, [f"http://s/p/{n}" for n in range(6)], None, 5, {}))
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        run(go())
        self.assertEqual(len(self.state.browser.created), 4)
        self.assertEqual(sorted(self.state.browser.closed), sorted(self.state.browser.created))
        self.assertEqual(self.state.opened, set())

    def test_a_tab_that_fails_to_attach_is_still_closed(self):
        self.state.refuse_attach.add("R1")
        with self.assertRaises(BrowseError):
            run(readpages.read_tabs(self.ctx, ["http://s/p/1"], None, 5, {}))
        self.assertEqual(self.state.browser.closed, ["R1"])
        self.assertEqual(self.state.opened, set())

    def test_one_url_uses_one_tab(self):
        run(readpages.read_tabs(self.ctx, ["http://s/p/1"], None, 5, {}))
        self.assertEqual(self.state.browser.created, ["R1"])

    def test_a_failed_page_makes_the_command_fail_but_keeps_the_others(self):
        records = run(readpages.read_tabs(self.ctx, ["http://s/p/1", "http://s/boom"], None, 5, {}))
        result = readpages.result_for(records, {}, {})
        self.assertTrue(result.failed)
        self.assertIn("text of http://s/p/1", result.text)
        code, out, _ = daemon.render({}, result=result)
        self.assertEqual(code, 1)


class TemporaryOwnership(unittest.TestCase):
    def test_reader_tabs_are_registered_and_closed_through_a_reservation(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        owned = []
        target = run(temptabs.create(state, owned))
        marker = state.registry.calls[0][1]
        self.assertEqual(state.registry.calls, [("note_intent", marker), ("note_temporary", "R1"), ("drop_intent", marker)])
        self.assertEqual(state.browser.urls["R1"], f"about:blank#{marker}")
        self.assertTrue(marker.startswith("ardia-temp-"))
        run(temptabs.release(state, owned))
        self.assertEqual(state.registry.calls[3:], [("reserve_close", "R1"), ("finish_close", "R1")])
        self.assertEqual(state.browser.closed, [target])
        self.assertEqual(owned, [])

    def test_a_tab_another_session_holds_is_left_open_and_no_longer_hidden(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        state.registry.refuse.add("R1")
        owned = []
        run(temptabs.create(state, owned))
        run(temptabs.release(state, owned))
        self.assertEqual(state.browser.closed, [])
        self.assertNotIn(("drop_temporary", "R1"), state.registry.calls)
        self.assertEqual(state.registry.temporary, {"R1"})

    def test_a_close_that_fails_keeps_the_record_and_frees_only_the_reservation(self):
        from ardia_cli.browse import temptabs

        for how in ("stuck", "fails", "disconnected"):
            state = reader_state()
            owned = []
            run(temptabs.create(state, owned))
            if how == "stuck":
                state.browser.stuck.add("R1")
            elif how == "fails":
                state.browser.close_fails = True
            else:
                state.connected = False
            run(temptabs.release(state, owned))
            self.assertEqual(state.registry.temporary, {"R1"}, how)
            self.assertEqual(state.registry.calls[-2:], [("reserve_close", "R1"), ("release_close", "R1")], how)
            self.assertEqual(owned, [], how)

    def test_a_tab_created_by_a_daemon_that_died_before_the_reply_is_found_by_its_marker(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        state.registry.orphans = ["ardia-temp-dead1", "ardia-temp-never"]
        state.registry.intents = set(state.registry.orphans)
        state.browser.urls = {"X1": "about:blank#ardia-temp-dead1", "U1": "about:blank#ardia-temp-dead1x"}
        state.target_infos = {target: {"targetId": target, "url": url} for target, url in state.browser.urls.items()}
        run(temptabs.sweep(state))
        self.assertEqual(state.browser.closed, ["X1"])
        self.assertEqual(state.registry.intents, set())
        self.assertEqual(state.registry.temporary, set())

    def test_leftovers_of_a_dead_daemon_are_closed_on_the_next_run(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        state.registry.temporary = {"OLD1", "GONE"}
        state.browser.urls = {"OLD1": "http://s/"}
        state.target_infos = {"OLD1": {"targetId": "OLD1", "url": "http://s/"}}
        run(temptabs.sweep(state))
        self.assertEqual(state.browser.closed, ["OLD1"])
        self.assertEqual(state.registry.temporary, set())


class RegistryRecovery(unittest.TestCase):
    def setUp(self):
        from ardia_cli.browse import paths

        SCRATCH.mkdir(exist_ok=True)
        root = Path(tempfile.mkdtemp(prefix="browse-registry-", dir=SCRATCH))
        self.addCleanup(shutil.rmtree, root, ignore_errors=True)
        self.fd = paths.browse_dir(root)
        self.addCleanup(os.close, self.fd)

    def registry(self, key="mine"):
        from ardia_cli.browse.tabs import Registry

        return Registry(self.fd, key, key)

    def edit(self, change):
        with self.registry()._open("I") as data:
            change(data)

    def test_release_close_frees_the_reservation_and_keeps_the_temporary(self):
        mine = self.registry()
        mine.note_temporary("I", "T1")
        self.assertTrue(mine.reserve_close("I", "T1"))
        mine.release_close("I", "T1")
        self.assertEqual(mine.temporaries("I"), ["T1"])
        with mine._open("I") as data:
            self.assertNotIn("T1", data["closing"])
        self.assertTrue(mine.reserve_close("I", "T1"))

    def test_a_reservation_left_by_an_earlier_process_of_this_session_is_reclaimed(self):
        mine = self.registry()
        mine.note_temporary("I", "T1")
        self.edit(lambda data: data["closing"].__setitem__("T1", {"key": "mine", "session": "mine", "at": time.time(), "pid": 1}))
        self.assertTrue(mine.reserve_close("I", "T1"))
        self.assertFalse(mine.reserve_close("I", "T1"))

    def test_orphans_of_dead_daemons_are_claimed_and_live_ones_left(self):
        mine = self.registry()
        mine.note_intent("I", "ardia-temp-live")

        def plant(data):
            data.setdefault("intents", {}).update({
                "ardia-temp-old": {"key": "mine", "session": "mine", "pid": 1, "at": 0},
                "ardia-temp-dead": {"key": "gone", "session": "gone", "pid": 2, "at": 0},
            })
            data["opened"]["T9"] = {"key": "gone", "session": "gone", "temporary": True, "at": 0}

        self.edit(plant)
        self.assertEqual(sorted(mine.claim_orphans("I")), ["ardia-temp-dead", "ardia-temp-old"])
        self.assertEqual(mine.temporaries("I"), ["T9"])
        self.assertEqual(mine.claim_orphans("I"), [])
        mine.drop_intent("I", "ardia-temp-dead")
        with mine._open("I") as data:
            self.assertEqual(sorted(data["intents"]), ["ardia-temp-live", "ardia-temp-old"])


class SweepSparesLiveTabs(unittest.TestCase):
    def test_a_nested_read_does_not_close_the_running_scripts_page(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        state.extras = {}
        controller = []
        run(temptabs.create(state, controller))
        state.target_infos[controller[0]] = {"targetId": controller[0], "url": "about:blank"}
        run(temptabs.sweep(state))
        self.assertEqual(state.browser.closed, [])
        run(temptabs.release(state, controller))
        self.assertEqual(state.browser.closed, ["R1"])
        self.assertEqual(state.extras["temporaries"], set())


class ReadRouting(unittest.TestCase):
    def ctx(self, stdin=None):
        return commands.Ctx(SimpleNamespace(), {}, "/", {}, stdin, "read")

    def test_urls_go_to_the_browser_and_one_http_url_keeps_the_fetch(self):
        with mock.patch.object(readpages, "run", mock.AsyncMock(return_value="pages")) as pages, \
                mock.patch("ardia_cli.browse.readurl.run", return_value="fetched") as fetched:
            self.assertEqual(run(commands.cmd_read(self.ctx(), ["http://a/", "http://b/"])), "pages")
            self.assertEqual(run(commands.cmd_read(self.ctx(), ["http://a/"])), "pages")
            self.assertEqual(run(commands.cmd_read(self.ctx(), ["--links", "/p/", "-s", "main"])), "pages")
            self.assertEqual(run(commands.cmd_read(self.ctx(), ["http://a/", "--http"])), "fetched")
            self.assertEqual(run(commands.cmd_read(self.ctx(), ["http://a/", "--llms", "index"])), "fetched")
        self.assertEqual(pages.await_count, 3)
        self.assertEqual(pages.await_args_list[2].args[1], {"links": "/p/", "selector": "main"})

    def test_http_reads_run_without_the_browser(self):
        self.assertTrue(browse_cli.read_runs_locally(["http://a/", "http://b/", "--http"]))
        self.assertTrue(browse_cli.read_runs_locally(["http://a/", "--raw"]))
        self.assertFalse(browse_cli.read_runs_locally(["http://a/", "http://b/"]))
        self.assertFalse(browse_cli.read_runs_locally(["--links", "/p/", "--http"]))
        self.assertFalse(browse_cli.read_runs_locally(["/p/a", "--http"]))
        self.assertFalse(browse_cli.read_runs_locally([]))

    def test_http_mode_refuses_a_selector(self):
        with self.assertRaises(Usage):
            readpages.run_local({"selector": "main", "http": True}, ["http://a/"], None, {})

    def test_local_http_reads_each_url(self):
        def fake(url, options, global_options):
            if "bad" in url:
                raise BrowseError(f"{url} answered HTTP 404")
            return commands.Result({"content": f"body {url}", "finalUrl": url, "title": "T " + url[-2:]}, "")

        with mock.patch("ardia_cli.browse.readurl.run", side_effect=fake):
            result = readpages.run_local({"http": True}, ["http://a/1", "http://a/bad"], None, {})
        self.assertEqual(result.data["pages"][0], {"url": "http://a/1", "source": "http", "finalUrl": "http://a/1", "title": "T /1", "text": "body http://a/1"})
        self.assertIn("=== [2/2] ✗ http://a/bad\nhttp://a/bad answered HTTP 404", result.text)
        self.assertTrue(result.failed)


class ScriptPieces(unittest.TestCase):
    def test_timeouts(self):
        self.assertEqual(script.parse_timeout(None), script.DEFAULT_TIMEOUT)
        self.assertEqual(script.parse_timeout("2m"), 120)
        self.assertEqual(script.parse_timeout("30s"), 30)
        self.assertEqual(script.parse_timeout("1500"), 1.5)
        for bad in ("11m", "0", "soon"):
            with self.assertRaises(Usage):
                script.parse_timeout(bad)

    def test_the_wrapper_keeps_line_numbers_one_off(self):
        code, offset = script.worker_source("const a = 1;\nreturn a;")
        self.assertEqual(code.splitlines()[offset:offset + 2], ["const a = 1;", "return a;"])
        self.assertIn(f"const OFFSET = {offset};", code)
        self.assertTrue(code.endswith(f"//# sourceURL={script.SOURCE_URL}"))
        self.assertEqual(script.source_line("a\nb\nc", 9), 3)
        self.assertEqual(script.source_line("a\nb\nc", 2), 2)

    def test_close_and_nested_scripts_are_refused(self):
        ctx = commands.Ctx(SimpleNamespace(), {}, "/", {}, "page.goto('x')", "script")
        for argv in (["close"], ["quit"], ["script"], [], ["click", 3]):
            answer = run(script.answer_call(ctx, argv))
            self.assertFalse(answer["ok"], argv)

    def test_commands_run_through_the_normal_dispatch_without_the_script_as_stdin(self):
        seen = []

        async def fake_dispatch(ctx, name, argv):
            seen.append((name, argv, ctx.stdin))
            return commands.Result({"url": "http://s/"}, "http://s/")

        ctx = commands.Ctx(SimpleNamespace(), {"json": True}, "/", {}, "the script", "script")
        with mock.patch.object(daemon, "dispatch", fake_dispatch):
            answer = run(script.answer_call(ctx, ["goto", "http://s/"]))
        self.assertEqual(seen, [("open", ["http://s/"], None)])
        self.assertEqual(answer, {"ok": True, "text": "http://s/", "data": {"url": "http://s/"}})

    def test_an_unknown_outcome_stops_the_script(self):
        async def fake_dispatch(ctx, name, argv):
            raise OutcomeUnknown("`click`", "Ardia didn't answer")

        ctx = commands.Ctx(SimpleNamespace(), {}, "/", {}, None, "script")
        with mock.patch.object(daemon, "dispatch", fake_dispatch):
            with self.assertRaises(OutcomeUnknown):
                run(script.answer_call(ctx, ["click", "#go"]))


class FakeController:
    def __init__(self, replies, hang=False):
        self.replies = list(replies)
        self.hang = hang
        self.answers = []
        self.target_id = "C1"
        self.evaluated = []

    async def send(self, method, params=None, timeout=30, mutation=False):
        if method == "Runtime.evaluate":
            self.evaluated.append(params["expression"])
            return {"result": {"objectId": "H"}}
        if method == "Runtime.callFunctionOn":
            if "this.start(" in params["functionDeclaration"]:
                self.started = params["arguments"][0]["value"]
                return {"result": {"value": True}}
            if "reply" in params["functionDeclaration"]:
                self.answers.append([arg["value"] for arg in params["arguments"]])
                return {"result": {"value": True}}
            if "this.stop()" in params["functionDeclaration"]:
                return {"result": {"value": {"logs": ["before the hang"]}}}
            if not self.replies:
                if self.hang:
                    await asyncio.sleep(60)
                raise AssertionError("no more messages")
            return {"result": {"value": self.replies.pop(0)}}
        raise AssertionError(method)


class ScriptRuns(unittest.TestCase):
    def run_script(self, controller, source="page.goto('x')", seconds=5, dispatch=None):
        state = SimpleNamespace(connected=True, pages={}, instance="I", registry=FakeRegistry(), target_infos={}, extras={})
        closed = []

        async def connect():
            return None

        state.connect = connect
        state.forget_target = lambda target_id: closed.append(target_id)
        state.browser = SimpleNamespace(send=mock.AsyncMock(return_value={}))
        ctx = commands.Ctx(state, {}, "/", {}, source, "script")

        async def fake_dispatch(ctx, name, argv):
            return commands.Result({"text": f"{name} {' '.join(argv)}"}, f"✓ {name}")

        async def open_controller(state, owned):
            owned.append(controller.target_id)
            return controller

        with mock.patch.object(script, "open_controller", open_controller), \
                mock.patch.object(daemon, "dispatch", dispatch or fake_dispatch):
            try:
                return run(script.run(ctx, source, seconds)), closed
            except BrowseError as error:
                return error, closed

    def test_requests_run_in_order_and_the_value_is_printed(self):
        controller = FakeController([
            {"kind": "request", "type": "call", "id": 1, "argv": ["get", "text", "h1"], "line": 2},
            {"kind": "request", "type": "sleep", "id": 2, "ms": 1, "line": 3},
            {"kind": "done", "value": [{"name": "Dock"}], "logs": ["read 1 page"]},
        ])
        result, closed = self.run_script(controller)
        self.assertEqual(controller.answers[0], [1, {"ok": True, "text": "✓ get", "data": {"text": "get text h1"}}])
        self.assertEqual(controller.answers[1][0], 2)
        self.assertEqual(result.text, 'read 1 page\n[\n  {\n    "name": "Dock"\n  }\n]')
        self.assertEqual(result.data, {"value": [{"name": "Dock"}], "logs": ["read 1 page"]})
        self.assertEqual(closed, ["C1"])

    def test_a_failed_command_reports_the_script_line(self):
        controller = FakeController([{"kind": "error", "message": "Element not found: #nope", "name": "Error", "line": 4,
                                      "code": "not_found", "command": ["click", "#nope"], "logs": ["opened"]}])
        error, closed = self.run_script(controller, "a\nb\nc\nd\ne")
        self.assertEqual(error.message, "line 4: Element not found: #nope (in `click '#nope'`)\nlogged before that:\nopened")
        self.assertEqual(error.code, "not_found")
        self.assertEqual(error.data["line"], 4)
        self.assertEqual(closed, ["C1"])

    def test_a_syntax_error_names_its_line(self):
        controller = FakeController([{"kind": "error", "message": "SyntaxError: Unexpected token ';'", "name": "", "line": 2, "code": "script_syntax", "logs": []}])
        error, closed = self.run_script(controller, "const a = 1;\nsyntax(;\nreturn a;")
        self.assertEqual(error.message, "line 2: SyntaxError: Unexpected token ';'")
        self.assertIn("syntax(;", controller.started)
        self.assertEqual(error.code, "script_syntax")
        self.assertEqual(closed, ["C1"])

    def test_a_thrown_type_error_keeps_its_name(self):
        controller = FakeController([{"kind": "error", "message": "x is not a function", "name": "TypeError", "line": 1, "logs": []}])
        error, _ = self.run_script(controller)
        self.assertEqual(error.message, "line 1: TypeError: x is not a function")

    def test_the_timeout_names_the_command_in_flight_and_its_line(self):
        async def slow_dispatch(ctx, name, argv):
            await asyncio.sleep(30)

        controller = FakeController([{"kind": "request", "type": "call", "id": 1, "argv": ["click", "#go"], "line": 7}])
        error, closed = self.run_script(controller, "x\n" * 9, seconds=0.2, dispatch=slow_dispatch)
        self.assertEqual(error.code, "timeout")
        self.assertTrue(error.message.startswith("The script timed out after 0.2s, in `click '#go'` at line 7; that command was cut off, "
                                                 "so its outcome is unknown."), error.message)
        self.assertIn("logged before that:\nbefore the hang", error.message)
        self.assertEqual(closed, ["C1"])

    def test_a_script_stuck_in_its_own_code_times_out_too(self):
        error, closed = self.run_script(FakeController([], hang=True), seconds=0.2)
        self.assertEqual(error.code, "timeout")
        self.assertTrue(error.message.startswith("The script timed out after 0.2s. Give it longer"), error.message)
        self.assertEqual(closed, ["C1"])

    def test_unawaited_commands_are_reported(self):
        result, _ = self.run_script(FakeController([{"kind": "done", "undefined": True, "unawaited": 2, "logs": []}]))
        self.assertEqual(result.text, "[2 commands the script didn't await never ran]")
        result, _ = self.run_script(FakeController([{"kind": "done", "undefined": True, "logs": []}]))
        self.assertEqual(result.text, "✓ Done")


class ScriptSource(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(exist_ok=True)
        self.dir = Path(tempfile.mkdtemp(prefix="browse-script-", dir=SCRATCH))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def test_a_file_or_stdin(self):
        (self.dir / "loop.js").write_text("return 1;\n")
        self.assertEqual(browse_cli.script_source(["loop.js", "--timeout", "2m"], str(self.dir)), "return 1;\n")
        with mock.patch.object(sys, "stdin", io.StringIO("return 2;")):
            self.assertEqual(browse_cli.script_source([], str(self.dir)), "return 2;")
        with self.assertRaises(Usage):
            browse_cli.script_source(["missing.js"], str(self.dir))
        with self.assertRaises(Usage):
            browse_cli.script_source(["a.js", "b.js"], str(self.dir))


class CompositeOutcomes(unittest.TestCase):
    def ctx(self):
        return commands.Ctx(SimpleNamespace(), {}, "/", {}, None, "script")

    def test_batch_is_refused_inside_a_script(self):
        answer = run(script.answer_call(self.ctx(), ["batch", "click #pay"]))
        self.assertEqual(answer, {"ok": False, "error": "batch can't run inside a script; loop in the script instead", "code": "usage"})

    def test_an_unknown_outcome_inside_a_composite_result_stops_the_script(self):
        async def composite(ctx, name, argv):
            result = commands.Result({"results": []}, "✗ unknown")
            result.batch = [{"command": ["click", "#pay"], "success": False, "error": "the outcome of `click` is unknown", "code": "outcome_unknown"}]
            result.failed = True
            return result

        with mock.patch.object(daemon, "dispatch", composite):
            with self.assertRaises(OutcomeUnknown):
                run(script.answer_call(self.ctx(), ["find", "text", "Pay", "click"]))

    def test_a_failed_result_is_an_error_but_a_partly_failed_read_is_data(self):
        async def failed(ctx, name, argv):
            result = commands.Result({"pages": [{"url": "http://s/", "error": "boom"}]} if name == "read" else {}, "✗ part of it failed")
            result.failed = True
            return result

        with mock.patch.object(daemon, "dispatch", failed):
            self.assertEqual(run(script.answer_call(self.ctx(), ["diff", "url", "a", "b"])),
                             {"ok": False, "error": "✗ part of it failed", "code": "failed"})
            answer = run(script.answer_call(self.ctx(), ["read", "http://s/"]))
        self.assertTrue(answer["ok"])
        self.assertEqual(answer["data"]["pages"][0]["error"], "boom")


class Redaction(unittest.TestCase):
    def setUp(self):
        from ardia_cli import redact

        self.secret = "Tok3nThatCrossesTheCutBoundary0123456789abcdefghijklmn"
        redact.add_secret(self.secret)

    def assert_no_piece(self, text):
        for size in range(8, len(self.secret) + 1):
            self.assertNotIn(self.secret[:size], text)

    def test_a_secret_on_a_cut_boundary_is_masked_before_budgeting(self):
        for offset in range(0, 1200, 37):
            records = [{"url": f"http://s/{n}", "title": "T", "text": "x" * (500 + offset) + self.secret + "y" * 3000} for n in range(4)]
            self.assert_no_piece(readpages.render(records, {}))

    def test_titles_and_urls_are_masked(self):
        text = readpages.render([{"url": f"http://s/?token={self.secret}", "title": f"Hi {self.secret}", "text": "ok"}], {})
        self.assert_no_piece(text)

    def test_script_failure_logs_are_masked_before_their_tail_is_cut(self):
        logs = ["z" * 2990 + self.secret] + ["w" * 40]
        self.assert_no_piece(script.failure("line 1: boom", logs, {}).message)


class Budget(unittest.TestCase):
    def test_a_hundred_pages_fit_the_cap_and_say_what_was_left_out(self):
        records = [{"url": f"http://s/p/{n}", "finalUrl": f"http://s/p/{n}", "title": f"Product {n}", "text": "spec: value\n" * 160} for n in range(100)]
        text = readpages.render(records, {})
        self.assertLessEqual(len(text), daemon.OUTPUT_CAP)
        shown = [n for n in range(100) if f"=== [{n + 1}/100] Product {n}\n" in text]
        self.assertEqual(shown, list(range(len(shown))))
        self.assertGreater(len(shown), 5)
        self.assertIn(f"+{100 - len(shown)} pages not shown", text)
        self.assertIn("--max-output ", text)
        _, out, _ = daemon.render({}, result=commands.Result({}, text))
        self.assertNotIn("output capped", out)

    def test_small_limits_still_fit(self):
        records = [{"url": f"http://s/p/{n}", "title": f"P{n}", "text": "a" * 900} for n in range(30)]
        for limit in (300, 1000, 2500):
            text = readpages.render(records, {"max_output": limit})
            self.assertLessEqual(len(text), limit, limit)
            self.assertIn("pages not shown", text)

    def test_shares_can_go_below_two_hundred(self):
        self.assertEqual(readpages.shares([1000] * 10, 500), [50] * 10)


class SlowCreate(FakeBrowser):
    def __init__(self, state, create_delay):
        super().__init__(state)
        self.create_delay = create_delay

    async def send(self, method, params=None, session=None, timeout=30):
        if method == "Target.createTarget":
            await asyncio.sleep(self.create_delay)
        return await super().send(method, params, session, timeout)


class CreationRace(unittest.TestCase):
    def test_a_read_cancelled_while_its_tab_is_being_created_still_closes_it(self):
        state = reader_state()
        state.browser = SlowCreate(state, 0.2)
        ctx = commands.Ctx(state, {}, "/", {}, None, "read")

        async def go():
            task = asyncio.ensure_future(readpages.read_tabs(ctx, ["http://s/p/1", "http://s/p/2"], None, 5, {}))
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        with mock.patch("ardia_cli.browse.page.Page", lambda state, target_id: FakeReader(state, target_id, state.browser)):
            run(go())
        self.assertEqual(len(state.browser.created), 2)
        self.assertEqual(sorted(state.browser.closed), sorted(state.browser.created))
        self.assertEqual(state.opened, set())

    def test_a_script_cancelled_while_its_controller_is_being_created_still_closes_it(self):
        state = reader_state()
        state.browser = SlowCreate(state, 0.2)
        ctx = commands.Ctx(state, {}, "/", {}, "return 1", "script")

        async def go():
            task = asyncio.ensure_future(script.run(ctx, "return 1", 5))
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        with mock.patch("ardia_cli.browse.page.Page", lambda state, target_id: FakeReader(state, target_id, state.browser)):
            run(go())
        self.assertEqual(state.browser.created, ["R1"])
        self.assertEqual(state.browser.closed, ["R1"])


if __name__ == "__main__":
    unittest.main()
