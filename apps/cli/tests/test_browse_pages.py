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
from ardia_cli import command_metrics
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


class HashRoutes(unittest.TestCase):
    def test_route_fragments_are_kept_and_in_page_anchors_dropped(self):
        self.assertEqual(readpages.canonical_link("http://s/a#top"), "http://s/a")
        self.assertEqual(readpages.canonical_link("http://s/#/people/42"), "http://s/#/people/42")
        self.assertEqual(readpages.canonical_link("http://s/#!/legacy/7"), "http://s/#!/legacy/7")
        self.assertEqual(readpages.canonical_link("http://s/a#"), "http://s/a")

    def test_links_dedupe_on_the_full_url_and_patterns_see_the_route(self):
        raw = ["http://s/#/people/1", "http://s/#top", "http://s/#/people/2", "http://s/#/people/1", "http://s/", "http://s/#!/legacy/7"]
        links = readpages.distinct_links(raw)
        self.assertEqual(links, ["http://s/#/people/1", "http://s/", "http://s/#/people/2", "http://s/#!/legacy/7"])
        self.assertEqual(readpages.pick_links(links, "/people/", "http://s/#/"), ["http://s/#/people/1", "http://s/#/people/2"])
        self.assertEqual(readpages.pick_links(links, "#!/", "http://s/"), ["http://s/#!/legacy/7"])
        self.assertEqual(readpages.pick_links(links, "s/", "http://s/#notes"), ["http://s/#/people/1", "http://s/#/people/2", "http://s/#!/legacy/7"])


class SameDocumentRead(unittest.TestCase):
    def test_a_hash_route_read_waits_for_the_route_to_render(self):
        class RoutedPage:
            def __init__(self):
                self.text = "Person 1 Engineer 11"
                self.url = "http://s/#/people/1"
                self.main_frame = "F"
                self.lifecycle = {}

            async def send(self, method, params=None, timeout=30, mutation=False):
                self.url = params["url"]
                self.text = "Loading…"

                async def render():
                    await asyncio.sleep(0.5)
                    self.text = "Person 2 Engineer 22"

                asyncio.ensure_future(render())
                return {"frameId": "F"}

            async def call(self, function, *args, frame=None, read=False, **kwargs):
                return ["complete", self.text, "loading" in self.text.lower()]

            async def refresh_frames(self):
                return {}

        page = RoutedPage()

        async def go():
            await readpages.goto(None, page, "http://s/#/people/2", 5)
            return page.text

        self.assertEqual(run(go()), "Person 2 Engineer 22")


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
        self.assertLessEqual(len(text), readpages.pages_cap(10))
        for n in range(10):
            self.assertIn(f"=== [{n + 1}/10] P{n}\nhttp://s/p/{n}\n", text)
        self.assertIn("short page", text)
        self.assertIn("Narrow it instead: -s <css> (one region per page)", text)
        self.assertNotIn("--full", text)
        self.assertIn(" characters]\n\n=== [", text)
        _, out, _ = daemon.render({}, result=readpages.result_for(records, {}, {}))
        self.assertNotIn("output capped", out)
        full = readpages.render(records, {"full": True})
        self.assertNotIn("pages cut", full)
        self.assertGreater(len(text), readpages.pages_cap(10) - 400)
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


SCRATCH_DIRS = []


def scratch_registry(key="reader", session="reader"):
    from ardia_cli.browse import paths
    from ardia_cli.browse.tabs import Registry

    SCRATCH.mkdir(exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="browse-registry-", dir=SCRATCH))
    fd = paths.browse_dir(root)
    SCRATCH_DIRS.append((root, fd))
    return Registry(fd, key, session)


def peer(registry, key):
    from ardia_cli.browse.tabs import Registry

    return Registry(registry.browse_fd, key, key)


def tearDownModule():
    for root, fd in SCRATCH_DIRS:
        os.close(fd)
        shutil.rmtree(root, ignore_errors=True)


def reader_state(registry=None):
    state = SimpleNamespace(opened=set(), target_infos={}, pages={}, connected=True, refuse_attach=set(), instance="I",
                            registry=registry or scratch_registry(), extras={})
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
        self.detaches = set()

        async def read_in(ctx, page, url, selector, timeout, options):
            browser = self.state.browser
            browser.live += 1
            browser.peak = max(browser.peak, browser.live)
            self.visits.append((page.target_id, url))
            await asyncio.sleep(browser.delay)
            browser.live -= 1
            if page.target_id in self.detaches:
                page.session_id = None
                return {"url": url, "source": "browser", "error": "detached"}
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

    def test_a_page_whose_tab_ardia_detached_is_read_again_in_a_new_tab(self):
        self.detaches.add("R1")
        request = {"argv": ["read"], "options": {}}
        command_metrics.begin(request)
        self.addCleanup(command_metrics.current.set, None)
        records = run(readpages.read_tabs(self.ctx, ["http://s/p/1", "http://s/p/2"], None, 5, {}))
        self.assertEqual([record.get("text") for record in records], ["text of http://s/p/1", "text of http://s/p/2"])
        self.assertEqual(self.visits.count(("R1", "http://s/p/1")), 1)
        self.assertEqual(sorted(self.state.browser.closed), sorted(self.state.browser.created))
        self.assertEqual(command_metrics.answer_fields(request)["metrics"]["read_tabs_reopened"], 1)

    def test_a_tab_detached_twice_fails_that_page_only(self):
        self.detaches.update({"R1", "R2"})
        records = run(readpages.read_tabs(self.ctx, ["http://s/p/1"], None, 5, {}))
        self.assertEqual(records[0]["error"], "detached")
        self.assertEqual(self.state.browser.created, ["R1", "R2"])
        self.assertEqual(sorted(self.state.browser.closed), ["R1", "R2"])

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


class DetachedPage(unittest.TestCase):
    def test_a_detached_page_never_sends_its_command_to_the_browser_session(self):
        from ardia_cli.browse.page import Page

        sent = []

        class Browser:
            async def send(self, method, params=None, session=None, timeout=30):
                sent.append((method, session))
                return {}

        page = Page(SimpleNamespace(sessions={}), "T1")
        page.browser = Browser()
        page.session_id = "S1"
        page.detach()
        with self.assertRaises(BrowseError) as raised:
            run(page.refresh_frames())
        self.assertEqual(raised.exception.code, "tab_detached")
        self.assertNotIn(("Page.getFrameTree", None), sent)

    def test_a_command_waiting_on_a_tab_that_detaches_fails_at_once(self):
        from ardia_cli.browse.page import Page

        class Browser:
            async def send(self, method, params=None, session=None, timeout=30):
                await asyncio.sleep(timeout)

        async def go(method):
            page = Page(SimpleNamespace(sessions={}), "T1")
            page.browser = Browser()
            page.session_id = "S1"
            asyncio.get_running_loop().call_later(0.05, page.detach)
            started = time.monotonic()
            try:
                await page.send(method, timeout=30)
            except BrowseError as error:
                return error.code, time.monotonic() - started, page.calls

        code, took, calls = run(go("Page.getFrameTree"))
        self.assertEqual((code, calls), ("tab_detached", set()))
        self.assertLess(took, 2)
        self.assertEqual(run(go("Page.navigate"))[0], "outcome_unknown")

    def test_a_cancelled_command_is_still_cancelled(self):
        from ardia_cli.browse.page import Page

        class Browser:
            async def send(self, method, params=None, session=None, timeout=30):
                await asyncio.sleep(timeout)

        async def go():
            page = Page(SimpleNamespace(sessions={}), "T1")
            page.browser = Browser()
            page.session_id = "S1"
            task = asyncio.ensure_future(page.send("Page.getFrameTree", timeout=30))
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        run(go())


class RefusedAttach(unittest.TestCase):
    def refused(self, windows):
        from unittest import mock

        from ardia_cli.browse import tabs
        from ardia_cli.browse.errors import Gated
        from ardia_cli.browse.page import Page

        async def refuse(method, params=None, session=None, timeout=30):
            raise Gated(method, reason="to that target")

        async def listed(_state):
            return windows

        with mock.patch.object(tabs, "app_windows", listed), self.assertRaises(Gated) as caught:
            run(Page(reader_state(), "T1").attach(SimpleNamespace(send=refuse)))
        return caught.exception

    def test_it_names_the_tab_ardia_has_for_that_page(self):
        error = self.refused([{"tabs": [{"id": "tab-1", "targetId": "T1", "url": "chrome://settings/"}]}])
        self.assertEqual(error.data, {"method": "Target.attachToTarget", "reason": "to that target"})
        self.assertIn("Target.attachToTarget to that target isn't allowed for the ardia command", error.message)
        self.assertTrue(error.message.endswith("(Ardia has it open as tab-1 at chrome://settings/)"))

    def test_it_says_when_ardia_lists_no_tab_for_that_page(self):
        error = self.refused([{"tabs": [{"id": "tab-2", "targetId": "T2", "url": "https://example.com/"}]}])
        self.assertIn("`ardia windows` lists no tab with that page", error.message)

    def test_it_adds_nothing_when_ardia_cant_say(self):
        self.assertTrue(self.refused(None).message.endswith("or is in a window Ardia keeps for itself"))
        self.assertTrue(self.refused([{"tabs": [{"id": "tab-1", "url": ""}]}]).message.endswith("or is in a window Ardia keeps for itself"))


class TempTabRecovery(unittest.TestCase):
    def test_a_reader_tab_is_owned_by_its_exact_id_and_closed_through_a_reservation(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        owned = []
        target = run(temptabs.create(state, owned))
        self.assertEqual(state.browser.urls[target], "about:blank")
        self.assertEqual(state.registry.temporaries("I"), [target])
        self.assertFalse(hasattr(state.registry, "note_intent"))
        run(temptabs.release(state, owned))
        self.assertEqual(state.browser.closed, [target])
        self.assertEqual(state.registry.temporaries("I"), [])
        self.assertEqual(owned, [])

    def test_a_user_tab_whose_url_looks_like_a_marker_is_never_closed(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        state.browser.urls = {"USER": "https://example.test/doc#ardia-temp-0123456789abcdef", "BLANK": "about:blank#ardia-temp-feedface"}
        state.target_infos = {target: {"targetId": target, "url": url} for target, url in state.browser.urls.items()}
        dead = peer(state.registry, "dead-daemon")
        dead.note_temporary("I", "GONE")
        with dead._open("I") as data:
            data["intents"] = {marker: {"key": "dead-daemon", "session": "dead", "pid": 1, "at": 0}
                               for marker in ("ardia-temp-0123456789abcdef", "ardia-temp-feedface")}
        run(temptabs.sweep(state))
        self.assertEqual(state.browser.closed, [])
        self.assertEqual(state.registry.temporaries("I"), [])

    def test_a_failed_close_keeps_ownership_and_a_later_sweep_retries_it(self):
        from ardia_cli.browse import temptabs

        for how in ("stuck", "fails", "disconnected"):
            state = reader_state()
            owned = []
            target = run(temptabs.create(state, owned))
            if how == "stuck":
                state.browser.stuck.add(target)
            elif how == "fails":
                state.browser.close_fails = True
            else:
                state.connected = False
            run(temptabs.release(state, owned))
            self.assertEqual(state.registry.temporaries("I"), [target], how)
            self.assertNotIn(target, state.target_infos, how)
            run(temptabs.sweep(state))
            self.assertEqual(state.registry.temporaries("I"), [target], f"{how}: a cache miss isn't proof the tab is gone")
            state.browser.stuck.clear()
            state.browser.close_fails = False
            state.connected = True
            run(temptabs.sweep(state))
            self.assertIn(target, state.browser.closed, how)
            self.assertEqual(state.registry.temporaries("I"), [], how)

    def test_a_sweep_spares_the_tabs_this_daemon_is_using(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        controller = []
        target = run(temptabs.create(state, controller))
        state.target_infos[target] = {"targetId": target, "url": "about:blank"}
        run(temptabs.sweep(state))
        self.assertEqual(state.browser.closed, [])
        run(temptabs.release(state, controller))
        self.assertEqual(state.browser.closed, [target])

    def test_a_new_incarnation_reclaims_its_predecessors_tabs_even_with_the_same_pid(self):
        from ardia_cli.browse import temptabs
        from ardia_cli.browse.tabs import Registry

        before = reader_state()
        owned = []
        target = run(temptabs.create(before, owned))
        self.assertTrue(before.registry.reserve_close("I", target))
        after = reader_state(Registry(before.registry.browse_fd, before.registry.key, before.registry.session))
        after.browser.urls = dict(before.browser.urls)
        self.assertTrue(after.registry.reserve_close("I", target))
        after.registry.release_close("I", target)
        run(temptabs.sweep(after))
        self.assertEqual(after.browser.closed, [target])
        self.assertEqual(after.registry.temporaries("I"), [])

    def test_a_dead_sessions_tab_is_closed_only_once_it_is_confirmed_gone(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        dead = peer(state.registry, "dead-daemon")
        dead.note_temporary("I", "OLD")
        state.browser.urls = {"OLD": "http://s/"}
        state.browser.stuck.add("OLD")
        run(temptabs.sweep(state))
        self.assertEqual(state.registry.temporaries("I"), ["OLD"])
        state.browser.stuck.clear()
        run(temptabs.sweep(state))
        self.assertEqual(state.registry.temporaries("I"), [])

    def test_a_sweep_that_cannot_list_targets_deletes_nothing(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        dead = peer(state.registry, "dead-daemon")
        dead.note_temporary("I", "GONE")
        state.connected = False
        run(temptabs.sweep(state))
        self.assertEqual(state.registry.temporaries("I"), ["GONE"])


class FilteredRefresh(unittest.TestCase):
    def test_a_refresh_filtered_for_display_never_drops_ownership_of_an_unlisted_target(self):
        from ardia_cli.browse.state import State

        registry = scratch_registry()
        state = State({"session": "reader", "key": registry.key, "browse_fd": registry.browse_fd}, lambda: None)
        state.registry = registry
        state.instance = "I"
        registry.note_temporary("I", "SETTINGS")
        registry.note_temporary("I", "WORKER")
        registry.numbers("I", ["SETTINGS", "WORKER"])
        time.sleep(0.01)
        infos = [{"targetId": "SETTINGS", "type": "page", "url": "chrome://settings/"},
                 {"targetId": "WORKER", "type": "service_worker", "url": "https://s/sw.js"},
                 {"targetId": "PAGE", "type": "page", "url": "https://s/"}]

        async def send(method, params=None, session=None, timeout=30):
            return {"targetInfos": infos}

        state.browser = SimpleNamespace(send=send)
        run(state.refresh_targets())
        self.assertEqual(sorted(state.target_infos), ["PAGE"])
        self.assertEqual(sorted(registry.temporaries("I")), ["SETTINGS", "WORKER"])
        infos[:] = [infos[2]]
        time.sleep(0.01)
        run(state.refresh_targets())
        self.assertEqual(registry.temporaries("I"), [])


class CapacityFirst(unittest.TestCase):
    def full_state(self):
        from ardia_cli.browse import tabs

        state = reader_state()
        other = peer(state.registry, "other-session")
        for index in range(tabs.MAX_TEMPORARIES):
            other.note_temporary("I", f"HELD{index}")
        return state

    def test_a_full_registry_refuses_before_any_tab_is_created(self):
        from ardia_cli.browse import temptabs

        state = self.full_state()
        owned = []
        with self.assertRaises(BrowseError) as caught:
            run(temptabs.create(state, owned))
        self.assertEqual(caught.exception.code, "temporary_limit")
        self.assertEqual(state.browser.created, [])
        self.assertEqual(owned, [])

    def test_a_failed_create_gives_its_reserved_slot_back(self):
        from ardia_cli.browse import tabs, temptabs
        from ardia_cli.browse.errors import Gated

        state = reader_state()
        other = peer(state.registry, "other-session")
        for index in range(tabs.MAX_TEMPORARIES - 1):
            other.note_temporary("I", f"HELD{index}")

        async def refuse(method, params=None, session=None, timeout=30):
            raise Gated("Target.createTarget")

        browser, state.browser = state.browser, SimpleNamespace(send=refuse)
        with self.assertRaises(BrowseError):
            run(temptabs.create(state, []))
        state.browser = browser
        owned = []
        target = run(temptabs.create(state, owned))
        self.assertEqual(owned, [target])
        self.assertEqual(state.registry.temporaries("I"), [target])

    def test_a_slot_left_by_an_earlier_run_is_freed_by_the_next_sweep(self):
        from ardia_cli.browse import temptabs
        from ardia_cli.browse.tabs import Registry

        state = reader_state()
        earlier = Registry(state.registry.browse_fd, state.registry.key, state.registry.session)
        slot = earlier.reserve_temporary("I")
        self.assertEqual(state.registry.temporaries("I"), [slot])
        run(temptabs.sweep(state))
        self.assertEqual(state.registry.temporaries("I"), [])
        self.assertEqual(state.browser.closed, [])

    def test_a_registry_write_failing_after_the_create_keeps_closing_the_tab_until_it_is_gone(self):
        from ardia_cli.browse import temptabs

        state = reader_state()
        state.browser.close_fails = True

        async def go():
            with mock.patch.object(type(state.registry), "note_temporary", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    await temptabs.create(state, [])
            self.assertEqual(state.browser.created, ["R1"])
            self.assertEqual(state.extras["must_close"], {"R1"})
            await asyncio.sleep(0.05)
            self.assertEqual(state.extras["must_close"], {"R1"})
            state.browser.close_fails = False
            await asyncio.wait_for(state.extras["must_close_task"], 5)

        with mock.patch.object(temptabs, "RETRY_FIRST", 0.02):
            run(go())
        self.assertEqual(state.browser.closed, ["R1"])
        self.assertEqual(state.extras["must_close"], set())
        self.assertEqual(state.registry.temporaries("I"), [])


class ShutdownDrain(unittest.TestCase):
    def queued_state(self, close_fails):
        from ardia_cli.browse import temptabs

        state = reader_state()
        state.browser.close_fails = close_fails

        async def queue():
            with mock.patch.object(type(state.registry), "note_temporary", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    await temptabs.create(state, [])

        return state, queue

    def shut_down(self, state):
        from ardia_cli.browse import daemon as daemon_module

        disconnected = []

        async def disconnect():
            disconnected.append(True)

        state.disconnect = disconnect
        state.pages = {}
        holder = SimpleNamespace(state=state, bare_ctx=lambda: None)
        return daemon_module.Daemon._cleanup(holder), disconnected

    def test_shutdown_closes_what_the_queue_still_holds(self):
        state, queue = self.queued_state(close_fails=True)

        async def go():
            await queue()
            state.browser.close_fails = False
            cleanup, disconnected = self.shut_down(state)
            await cleanup
            return disconnected

        self.assertEqual(run(go()), [True])
        self.assertEqual(state.browser.closed, ["R1"])
        self.assertEqual(state.extras["must_close"], set())
        self.assertEqual(state.registry.temporaries("I"), [])

    def test_shutdown_records_a_tab_it_could_not_close_so_the_next_run_recovers_it(self):
        from ardia_cli.browse import temptabs
        from ardia_cli.browse.tabs import Registry

        state, queue = self.queued_state(close_fails=True)

        async def go():
            await queue()
            started = asyncio.get_running_loop().time()
            cleanup, disconnected = self.shut_down(state)
            await cleanup
            return asyncio.get_running_loop().time() - started, disconnected

        with mock.patch.object(temptabs, "DRAIN_BUDGET", 0.3):
            took, disconnected = run(go())
        self.assertLess(took, 2)
        self.assertEqual(disconnected, [True])
        self.assertEqual(state.registry.temporaries("I"), ["R1"])
        after = reader_state(Registry(state.registry.browse_fd, state.registry.key, state.registry.session))
        after.browser.urls = dict(state.browser.urls)
        run(temptabs.sweep(after))
        self.assertEqual(after.browser.closed, ["R1"])
        self.assertEqual(after.registry.temporaries("I"), [])


class RegistryBounds(unittest.TestCase):
    def registry(self, key="mine", session="mine"):
        return scratch_registry(key, session)

    def test_temporaries_are_capped_per_instance(self):
        from ardia_cli.browse import tabs

        one = self.registry("one", "one")
        two = peer(one, "two")
        for index in range(tabs.MAX_TEMPORARIES):
            (one if index % 2 else two).note_temporary("I", f"T{index}")
        with self.assertRaises(BrowseError) as caught:
            one.note_temporary("I", "ONE_TOO_MANY")
        self.assertEqual(caught.exception.code, "temporary_limit")
        self.assertIn(str(tabs.MAX_TEMPORARIES), caught.exception.message)

    def test_a_full_registry_fits_its_byte_budget_and_keeps_every_owner(self):
        from ardia_cli.browse import paths, tabs

        mine = self.registry("mine", "séssion-ünïcode-🙂" * 2)
        long = lambda index: f"{index:064X}"
        for index in range(tabs.MAX_TEMPORARIES):
            mine.note_temporary("I", long(index))
        for index in range(tabs.MAX_TEMPORARIES):
            mine.reserve_close("I", long(index))
        for start in range(0, tabs.MAX_IDS * 3, 500):
            mine.numbers("I", [long(10_000 + index) for index in range(start, start + 500)])
        raw = (paths.read_private_json(tabs.Registry.file_for("I"), mine.browse_fd, None, tabs.MAX_FILE))
        size = len(json.dumps(raw, ensure_ascii=False).encode())
        self.assertLessEqual(size, tabs.FILE_BUDGET)
        self.assertEqual(sorted(mine.temporaries("I")), sorted(long(index) for index in range(tabs.MAX_TEMPORARIES)))
        protected = tabs.MAX_TEMPORARIES * 2 * 400 + 64 * 1024
        self.assertLess(protected, tabs.FILE_BUDGET)

    def test_unused_ids_go_before_any_ownership(self):
        from ardia_cli.browse import paths, tabs

        mine = self.registry()
        dead = peer(mine, "dead")
        dead.note_temporary("I", "DEAD_OWNED")
        name = tabs.Registry.file_for("I")
        raw = paths.read_private_json(name, mine.browse_fd, None, tabs.MAX_FILE)
        raw["ids"] = {f"{index:064X}": [index + 1, index] for index in range(tabs.MAX_IDS)}
        raw["ids"]["DEAD_OWNED"] = [999999, 0]
        paths.write_private_json(name, mine.browse_fd, raw)
        with mock.patch.object(tabs, "FILE_BUDGET", 40_000):
            mine.note_opened("I", "X")
            raw = paths.read_private_json(name, mine.browse_fd, None, tabs.MAX_FILE)
            self.assertLessEqual(len(json.dumps(raw, ensure_ascii=False).encode()), 40_000)
        self.assertIn("DEAD_OWNED", raw["opened"])
        self.assertIn("DEAD_OWNED", raw["ids"])
        self.assertIn("X", raw["opened"])


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
        state = SimpleNamespace(connected=True, pages={}, instance="I", registry=scratch_registry(), target_infos={}, extras={})
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
        self.assertNotIn("pages not shown", readpages.render(records, {}))
        text = readpages.render(records, {"max_output": daemon.OUTPUT_CAP})
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
