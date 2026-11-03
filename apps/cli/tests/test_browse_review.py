import asyncio
import json
import os
import shutil
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import redact
from ardia_cli.browse import actions, capture, client, commands, daemon, inputs, paths, snapshot
from ardia_cli.browse.errors import BrowseError, CdpError, CdpTimeout, ConnectionLost, Gated, OutcomeUnknown, StaleRef, Unreachable
from ardia_cli.browse.page import Page
from ardia_cli.browse.state import State

SCRATCH = Path.home() / "ardia-scratch"


def scratch(test) -> Path:
    SCRATCH.mkdir(exist_ok=True)
    path = Path(tempfile.mkdtemp(prefix="browse-review-", dir=SCRATCH))
    test.addCleanup(shutil.rmtree, path, ignore_errors=True)
    return path


def run(coro):
    return asyncio.run(coro)


class DeadLinkIsTerminal(unittest.TestCase):
    def test_dead_link_never_reconnects_even_before_the_watcher_runs(self):
        resolved = []
        state = State({"session": "t"}, lambda: resolved.append(1))
        state.browser = SimpleNamespace(alive=False, closed_by_us=False)
        with self.assertRaises(ConnectionLost):
            run(state.connect())
        self.assertEqual(resolved, [])
        self.assertTrue(state.lost)

    def test_our_own_idle_disconnect_still_reconnects(self):
        class Endpoint:
            instance = "same"

        state = State({"session": "t"}, lambda: Endpoint())
        state.instance = "same"
        state.browser = SimpleNamespace(alive=False, closed_by_us=True)
        opened = []

        class FakeBrowser:
            def __init__(self, endpoint, on_event):
                self.alive = True

            async def open(self):
                opened.append(1)

            async def send(self, method, params=None, session=None, timeout=30):
                return {"targetInfos": []}

        with mock.patch("ardia_cli.browse.state.Browser", FakeBrowser):
            run(state.connect())
        self.assertEqual(opened, [1])


def ax_tree(names, base=100):
    nodes = [{"nodeId": "r", "role": {"value": "RootWebArea"}, "name": {"value": ""}, "childIds": [f"n{i}" for i in range(len(names))]}]
    for index, name in enumerate(names):
        nodes.append({"nodeId": f"n{index}", "parentId": "r", "role": {"value": "button"}, "name": {"value": name},
                      "backendDOMNodeId": base + index, "childIds": []})
    return nodes


class SnapshotPage:
    target_id = "T"
    main_frame = "F"

    def __init__(self, names, base=100):
        self.names = names
        self.base = base
        self.live = set()
        self.frames = {"F": {"loader": "L1", "origin": "http://x", "url": "http://x/"}}

    async def refresh_frames(self):
        return self.frames

    def loader(self, frame):
        return self.frames[frame]["loader"]

    async def send(self, method, params=None, input_event=False, timeout=30, mutation=False):
        if method == "Accessibility.getFullAXTree":
            self.live = {self.base + index for index in range(len(self.names))}
            return {"nodes": ax_tree(self.names, self.base)}
        raise AssertionError(method)

    async def resolve_backend(self, backend, frame, label):
        return SimpleNamespace(frame=frame, backend_id=backend, label=label) if backend in self.live else None

    async def call(self, function, *args, frame=None, **kwargs):
        return True


def take(state, page):
    with mock.patch.object(snapshot, "clickable_map", mock.AsyncMock(return_value={})):
        return run(snapshot.take(state, page, interactive=True))


def ref_state(page):
    state = State({"session": "t"}, lambda: None)
    state.instance = "i"
    state.target_infos = {"T": {}}

    async def page_for(target=None):
        return page

    state.page = page_for
    return state


class RefsAreStableAndNeverReassigned(unittest.TestCase):
    def test_repeat_snapshots_of_an_unchanged_page_give_identical_refs(self):
        page = SnapshotPage(["A", "B", "C"])
        state = ref_state(page)
        first = take(state, page)[0]
        for _ in range(5):
            self.assertEqual(take(state, page)[0], first)
        self.assertEqual(sorted(state.refs_json()), ["e1", "e2", "e3"])
        self.assertEqual(state.issued_refs, 3)

    def test_a_new_element_never_inherits_an_old_number(self):
        page = SnapshotPage(["Old"])
        state = ref_state(page)
        take(state, page)
        self.assertEqual(sorted(state.refs_json()), ["e1"])
        page.names, page.base = ["New"], 500
        take(state, page)
        self.assertEqual(sorted(state.refs_json()), ["e2"])
        with self.assertRaisesRegex(StaleRef, "no longer in the page"):
            run(state.resolve_ref("e1"))
        resolved_page, element = run(state.resolve_ref("e2"))
        self.assertEqual(element.backend_id, 500)
        with self.assertRaisesRegex(BrowseError, "Unknown ref"):
            run(state.resolve_ref("e9"))

    def test_a_new_document_gets_new_numbers_and_old_ones_go_stale(self):
        page = SnapshotPage(["A", "B"])
        state = ref_state(page)
        take(state, page)
        page.frames["F"]["loader"] = "L2"
        take(state, page)
        self.assertEqual(sorted(state.refs_json()), ["e3", "e4"])
        with self.assertRaises(StaleRef):
            run(state.resolve_ref("e1"))

    def test_find_reuses_the_snapshot_number_for_the_same_node(self):
        page = SnapshotPage(["A", "B"])
        state = ref_state(page)
        take(state, page)
        self.assertEqual(state.add_ref(page, SimpleNamespace(frame="F", backend_id=101)), "e2")
        self.assertEqual(state.add_ref(page, SimpleNamespace(frame="F", backend_id=7)), "e3")
        self.assertEqual(take(state, page)[0].count("ref=e"), 2)
        self.assertEqual(sorted(state.refs_json()), ["e1", "e2"])


def make_daemon(test):
    root = scratch(test)
    key = paths.session_key("", "port:1", "review")
    config = {"session": "review", "namespace": "", "key": key, "data_root": str(root), "port": 1, "ws": None, "data_dir": None,
              "endpoint_label": "--port 1", "idle_timeout_ms": 60000}
    instance = daemon.Daemon(config)
    test.addCleanup(lambda: instance.lock_fd is not None and os.close(instance.lock_fd))
    return instance


class CloseStopsQueuedWork(unittest.TestCase):
    def test_request_queued_behind_close_is_rejected(self):
        instance = make_daemon(self)
        dispatched = []

        async def fake_dispatch(ctx, name, argv):
            dispatched.append(name)
            return commands.Result()

        async def scenario():
            with mock.patch.object(daemon, "dispatch", fake_dispatch):
                closing = asyncio.ensure_future(instance.execute({"argv": ["close"], "options": {}}))
                await asyncio.sleep(0)
                queued = asyncio.ensure_future(instance.execute({"argv": ["open", "http://x"], "options": {}}))
                await asyncio.gather(closing, queued)
                late = await instance.execute({"argv": ["snapshot"], "options": {}})
                return queued.result(), late

        (code, out, err), late = run(scenario())
        self.assertEqual(dispatched, [])
        self.assertEqual(code, 1)
        self.assertIn("closing", err)
        self.assertIn("closing", late[2])


class TokenNeverPrinted(unittest.TestCase):
    def test_cdp_url_with_a_token_is_refused_even_when_explicit(self):
        endpoint = SimpleNamespace(explicit=True, ws="ws://127.0.0.1:9/devtools/browser/x?token=abcdefghijklmnop")
        state = SimpleNamespace(endpoint=endpoint, connect=mock.AsyncMock())
        ctx = commands.Ctx(state, {}, "/", {}, None, "get")
        with self.assertRaises(BrowseError):
            run(commands.cmd_get(ctx, ["cdp-url"]))

    def test_plain_explicit_url_is_still_printed(self):
        endpoint = SimpleNamespace(explicit=True, ws="ws://127.0.0.1:9/devtools/browser/x")
        state = SimpleNamespace(endpoint=endpoint, connect=mock.AsyncMock())
        ctx = commands.Ctx(state, {}, "/", {}, None, "get")
        self.assertEqual(run(commands.cmd_get(ctx, ["cdp-url"])).text, endpoint.ws)

    def test_render_sanitizes_results_and_errors(self):
        secret = "review-secret-0123456789abcdef"
        redact.add_secret(secret)
        _, out, _ = daemon.render({"json": True}, result=commands.Result({"leak": f"x {secret} y"}, secret))
        self.assertNotIn(secret, out)
        _, out, _ = daemon.render({"json": True}, error=BrowseError(f"boom {secret}", data={"url": f"ws://h/?token={secret}"}))
        self.assertNotIn(secret, out)
        _, _, err = daemon.render({}, error=BrowseError(f"boom {secret}"))
        self.assertNotIn(secret, err)
        _, out, _ = daemon.render({}, result=commands.Result({}, "ws://h/devtools/browser/x?token=zzzzzzzzzzzzzzzzz"))
        self.assertNotIn("zzzzzzzzzzzzzzzzz", out)


class FakeInputPage:
    def __init__(self):
        self.sent = []

    async def send(self, method, params=None, input_event=False, timeout=30, mutation=False):
        self.sent.append((method, dict(params or {})))
        return {}

    async def require_visible(self):
        return None


class HoldsAreReleasedWhenInterrupted(unittest.TestCase):
    def test_cancelled_keydown_is_released(self):
        page = FakeInputPage()
        held = inputs.Input(page)

        async def slow_hold():
            await held.press_combo("Shift", False, down_only=True)
            await asyncio.sleep(10)

        async def scenario():
            task = asyncio.ensure_future(held.gesture("keydown", slow_hold, keep_held=True))
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        run(scenario())
        self.assertFalse(held.holding)
        self.assertEqual(page.sent[-1][1]["type"], "keyUp")

    def test_failed_hold_is_released(self):
        page = FakeInputPage()
        held = inputs.Input(page)

        async def broken():
            await held.press_combo("Shift", False, down_only=True)
            raise BrowseError("boom")

        with self.assertRaises(BrowseError):
            run(held.gesture("keydown", broken, keep_held=True))
        self.assertFalse(held.holding)

    def test_completed_hold_is_kept(self):
        page = FakeInputPage()
        held = inputs.Input(page)
        run(held.gesture("keydown", lambda: held.press_combo("Shift", False, down_only=True), keep_held=True))
        self.assertTrue(held.holding)

    def test_stream_input_is_tracked_and_released_on_disconnect(self):
        page = FakeInputPage()
        page.input = inputs.Input(page)
        ctx = SimpleNamespace(state=SimpleNamespace(extras={"command_lock": None}))

        async def scenario():
            ctx.state.extras["command_lock"] = asyncio.Lock()
            await capture.stream_input(ctx, page, {"type": "input_keyboard", "eventType": "keyDown", "key": "Shift", "code": "ShiftLeft"})
            await capture.stream_input(ctx, page, {"type": "input_mouse", "eventType": "mousePressed", "x": 5, "y": 6, "button": "left", "clickCount": 1})
            self.assertTrue(page.input.holding)
            await capture.release_stream_input(ctx, page)

        run(scenario())
        self.assertFalse(page.input.holding)
        kinds = [params.get("type") for _, params in page.sent]
        self.assertIn("keyUp", kinds)
        self.assertIn("mouseReleased", kinds)


class ClaimPage:
    target_id = "TARGET"

    def __init__(self, refuse=False):
        self.refuse = refuse
        self.runtime_on = False
        self.init_scripts = {}

    async def send(self, method, params=None, input_event=False, timeout=30, mutation=False):
        if self.refuse:
            raise Gated(method)
        return {}

    async def enable_runtime(self):
        self.runtime_on = True


def claim_ctx(test, page):
    root = scratch(test)
    fd = paths.browse_dir(root)
    test.addCleanup(os.close, fd)
    lock = paths.take_lock("me.lock", fd)
    test.addCleanup(os.close, lock)
    state = SimpleNamespace(config={"browse_fd": fd, "key": "me"}, session="me", extras={}, leases=set(), listeners=[],
                            page=mock.AsyncMock(return_value=page), pages={})
    return commands.Ctx(state, {}, "/", {}, None, "x"), root


def claim_kinds(root):
    folder = root / "Browse" / "claims"
    kinds = set()
    for entry in folder.glob("*.json"):
        kinds.update(json.loads(entry.read_text()).get("kinds", []))
    return kinds


class CapturesClaimAndRollBack(unittest.TestCase):
    def test_capture_console_at_open_claims_the_tab(self):
        page = ClaimPage()
        ctx, root = claim_ctx(self, page)
        ctx.options["capture_console"] = True
        run(commands.apply_open_options(ctx, page))
        self.assertIn("console", claim_kinds(root))

    def test_refused_route_leaves_no_claim(self):
        page = ClaimPage(refuse=True)
        ctx, root = claim_ctx(self, page)
        with self.assertRaises(Gated):
            run(capture.network_route(ctx, ["*", "--abort"]))
        self.assertNotIn("route", claim_kinds(root))

    def test_unroute_releases_the_route_claim(self):
        page = ClaimPage()
        ctx, root = claim_ctx(self, page)
        ctx.state.pages = {"TARGET": SimpleNamespace(session_id=None)}
        run(capture.network_route(ctx, ["*", "--abort"]))
        self.assertIn("route", claim_kinds(root))
        run(capture.network_unroute(ctx, []))
        self.assertNotIn("route", claim_kinds(root))


class FakeCallPage(Page):
    def __init__(self, failures):
        super().__init__(SimpleNamespace(frame_for=lambda page: None, sessions={}), "T")
        self.main_frame = "F"
        self.frames = {"F": {"loader": "L"}}
        self.failures = failures
        self.calls = 0

    async def world(self, frame_id=None):
        return 1

    async def refresh_frames(self):
        return self.frames

    async def send(self, method, params=None, input_event=False, timeout=30, mutation=False):
        self.calls += 1
        if self.failures:
            self.failures -= 1
            raise CdpError(method, "Cannot find context with specified id")
        return {"result": {"value": "ok"}}


class MutationsNeverReplay(unittest.TestCase):
    def test_mutation_is_not_retried_after_a_document_change(self):
        page = FakeCallPage(1)
        with self.assertRaises(BrowseError):
            run(page.call("() => history.go(-1)"))
        self.assertEqual(page.calls, 1)

    def test_marked_read_is_retried(self):
        page = FakeCallPage(1)
        self.assertEqual(run(page.call("() => document.title", read=True)), "ok")
        self.assertEqual(page.calls, 2)


class DeliveryPage:
    main_frame = "F"

    def __init__(self, before_fails=False, after_fails=False):
        self.frames = {"F": {"loader": "L"}}
        self.before_fails = before_fails
        self.after_fails = after_fails
        self.checks = 0

    def loader(self, frame):
        return self.frames[frame]["loader"]

    async def refresh_frames(self):
        return self.frames

    async def call(self, function, *args, frame=None, **kwargs):
        self.checks += 1
        if self.checks == 1 and self.before_fails:
            raise BrowseError("no world")
        if self.checks > 1 and self.after_fails:
            raise CdpError("Runtime.callFunctionOn", "Target closed")
        return {"mousedown": 0, "mouseup": 0, "keydown": 0, "activeFrame": False}


class DeliveryIsNeverAssumed(unittest.TestCase):
    def test_monitor_failure_stops_before_dispatch(self):
        page = DeliveryPage(before_fails=True)
        dispatched = []

        async def dispatch():
            dispatched.append(1)

        with self.assertRaises(BrowseError):
            run(actions.expect_input(page, "F", dispatch, {"mousedown": 1}, "The click"))
        self.assertEqual(dispatched, [])

    def test_lost_confirmation_is_an_unknown_outcome(self):
        page = DeliveryPage(after_fails=True)

        async def dispatch():
            return None

        with self.assertRaises(OutcomeUnknown):
            run(actions.expect_input(page, "F", dispatch, {"mousedown": 1}, "The click"))

    def test_partial_delivery_does_not_claim_nothing_happened(self):
        page = DeliveryPage()
        counts = {"mousedown": 0, "mouseup": 0, "activeFrame": False}

        async def call(function, *args, frame=None, **kwargs):
            return dict(counts)

        page.call = call

        async def dispatch():
            counts["mousedown"] += 1

        with mock.patch.object(actions, "DELIVERY_TIMEOUT", 0.2), self.assertRaises(OutcomeUnknown) as caught:
            run(actions.expect_input(page, "F", dispatch, {"mousedown": 1, "mouseup": 1}, "The click"))
        self.assertNotIn("nothing happened", caught.exception.message)
        self.assertIn("mouseup", caught.exception.message)

    def test_inserttext_checks_visibility_and_confirms_input(self):
        page = SimpleNamespace(main_frame="F", sent=[])

        async def require_visible():
            raise BrowseError("hidden", code="tab_hidden")

        page.require_visible = require_visible
        state = SimpleNamespace(page=mock.AsyncMock(return_value=page), frame_for=lambda p: None)
        ctx = commands.Ctx(state, {"humanize": True}, "/", {}, None, "keyboard")
        with self.assertRaisesRegex(BrowseError, "hidden"):
            run(commands.cmd_keyboard(ctx, ["inserttext", "abc"]))


class MutationsCarryUnknownOutcomes(unittest.TestCase):
    def test_navigate_timeout_is_unknown(self):
        page = Page(SimpleNamespace(sessions={}), "T")

        async def timeout(method, params=None, session=None, timeout=30):
            raise CdpTimeout(method, timeout)

        page.browser = SimpleNamespace(send=timeout)
        with self.assertRaises(OutcomeUnknown):
            run(page.send("Page.navigate", {"url": "http://x"}))
        with self.assertRaises(CdpTimeout):
            run(page.send("Page.getFrameTree"))

    def test_daemon_gone_after_a_mutating_request_is_unknown(self):
        server, peer = socket.socketpair()
        self.addCleanup(server.close)

        def drop():
            server.recv(65536)
            server.close()

        import threading

        threading.Thread(target=drop).start()
        with self.assertRaises(OutcomeUnknown):
            client.request(peer, {"argv": ["click", "@e1"]})

    def test_daemon_gone_after_a_read_is_unreachable(self):
        server, peer = socket.socketpair()
        self.addCleanup(server.close)

        def drop():
            server.recv(65536)
            server.close()

        import threading

        threading.Thread(target=drop).start()
        with self.assertRaises(Unreachable):
            client.request(peer, {"argv": ["snapshot"]})

    def test_batch_stops_at_an_unknown_outcome(self):
        seen = []

        async def fake_dispatch(ctx, name, argv):
            seen.append(name)
            if name == "click":
                raise OutcomeUnknown("click", "Ardia didn't answer")
            return commands.Result({"ok": True})

        ctx = commands.Ctx(SimpleNamespace(), {}, "/", {}, None, "batch")
        with mock.patch.object(daemon, "dispatch", fake_dispatch):
            result = run(commands.cmd_batch(ctx, ["get title", "click @e1", "get url"]))
        self.assertEqual(seen, ["get", "click"])
        self.assertEqual([entry.get("code") for entry in result.batch], [None, "outcome_unknown", "not_run"])
        self.assertTrue(result.failed)


class RemovedFrameIsRefused(unittest.TestCase):
    def test_commands_refuse_until_frame_main(self):
        state = State({"session": "t"}, lambda: None)
        page = SimpleNamespace(target_id="T", frames={"F": {}})
        state.frames["T"] = "CHILD"
        with self.assertRaises(BrowseError) as caught:
            state.frame_for(page)
        self.assertEqual(caught.exception.code, "frame_gone")
        with self.assertRaises(BrowseError):
            state.frame_for(page)
        state.frames.pop("T")
        self.assertIsNone(state.frame_for(page))


class BoundedBuffersAndAnswers(unittest.TestCase):
    def test_console_bytes_are_bounded(self):
        page = Page(SimpleNamespace(sessions={}, on_page_event=lambda *a: None, auto_dialog=True), "T")
        big = "x" * (1024 * 1024)
        for _ in range(64):
            page.on_event("Runtime.consoleAPICalled", {"type": "log", "args": [{"type": "string", "value": big}]})
        total = sum(len(json.dumps(item)) for item in page.console.items)
        self.assertLessEqual(total, 16 * 1024 * 1024)
        self.assertTrue(all(len(item["text"]) <= 70 * 1024 for item in page.console.items))
        for _ in range(400):
            page.on_event("Runtime.consoleAPICalled", {"type": "log", "args": [{"type": "string", "value": big}]})
        self.assertLessEqual(sum(len(json.dumps(item)) for item in page.console.items), 16 * 1024 * 1024)
        self.assertGreater(page.console.dropped, 0)

    def test_request_records_are_bounded(self):
        page = Page(SimpleNamespace(sessions={}, on_page_event=lambda *a: None, auto_dialog=True), "T")
        header = "h" * (512 * 1024)
        for index in range(200):
            page.on_event("Network.requestWillBeSent", {"requestId": str(index), "request": {"url": "http://x/", "method": "GET", "headers": {"X": header}}})
        size = sum(len(json.dumps(record)) for record in page.requests.values())
        self.assertLessEqual(size, 32 * 1024 * 1024)

    def test_daemon_refuses_an_oversized_answer(self):
        instance = make_daemon(self)

        async def huge(request):
            return 0, "y" * 5000, ""

        class Reader:
            async def readline(self):
                return b'{"argv": ["snapshot"]}\n'

            async def read(self, size):
                await asyncio.sleep(10)

        class Writer:
            def __init__(self):
                self.data = b""

            def get_extra_info(self, name):
                return None

            def write(self, data):
                self.data += data

            async def drain(self):
                return None

            def close(self):
                return None

        writer = Writer()
        with mock.patch.object(instance, "execute", huge), mock.patch.object(daemon, "MAX_RESPONSE", 1000, create=True), \
                mock.patch.object(daemon.paths, "peer_uid", return_value=os.getuid()):
            writer.get_extra_info = lambda name: object()
            run(instance.handle(Reader(), writer))
        self.assertLessEqual(len(writer.data), 1000)
        self.assertIn(b"too large", writer.data)


class StreamRefusesNullOrigin(unittest.TestCase):
    def test_null_origin_is_refused(self):
        from websockets.asyncio.client import connect

        stream = {"token": "tok", "clients": set(), "input": False, "cast": SimpleNamespace(waiters=[], latest=None), "page": None}
        ctx = SimpleNamespace(state=SimpleNamespace(extras={}))

        async def scenario():
            server = await capture.start_stream_server(ctx, stream, 0)
            port = server.sockets[0].getsockname()[1]
            outcomes = []
            for origin in ("null", None):
                try:
                    async with connect(f"ws://127.0.0.1:{port}/?token=tok", origin=origin, open_timeout=3) as ws:
                        await asyncio.wait_for(ws.recv(), 3)
                        outcomes.append("accepted")
                except Exception as error:
                    outcomes.append(getattr(getattr(error, "response", None), "status_code", type(error).__name__))
            server.close()
            return outcomes

        self.assertEqual(run(scenario()), [403, "accepted"])


class CredentialGuardRunsAfterFocus(unittest.TestCase):
    def test_guard_checks_after_the_awaited_focus(self):
        order = []

        class FocusPage:
            async def focus_element(self, element):
                order.append("focus")

        async def guard():
            order.append("guard")

        target = inputs.FocusedKeyTarget(FocusPage(), {}, object(), guard)
        run(target.focus())
        self.assertEqual(order, ["focus", "guard"])


class SettlePage:
    def __init__(self, connected, replacement=None, loader_after="L"):
        self.connected = connected
        self.replacement = replacement
        self.frames = {"F": {"loader": loader_after}}

    def loader(self, frame):
        return self.frames[frame]["loader"]

    async def refresh_frames(self):
        return self.frames

    async def call(self, function, *args, **kwargs):
        if "isConnected" in function:
            return self.connected
        return {"objectId": "new"} if self.replacement else {"subtype": "null"}

    async def element_from(self, remote, frame, label):
        return SimpleNamespace(frame=frame, backend_id=2, label=label) if remote.get("objectId") else None


class FocusReplacementIsFollowed(unittest.TestCase):
    old = SimpleNamespace(frame="F", backend_id=1, label="@e1")

    def test_still_attached_keeps_the_target(self):
        self.assertEqual(run(actions.settle_focus(SettlePage(True), self.old, "L")), (self.old, False))

    def test_replaced_field_with_focus_on_its_replacement_is_retargeted(self):
        element, retargeted = run(actions.settle_focus(SettlePage(False, replacement=True), self.old, "L"))
        self.assertTrue(retargeted)
        self.assertEqual(element.backend_id, 2)

    def test_focus_anywhere_else_fails(self):
        with self.assertRaises(BrowseError) as caught:
            run(actions.settle_focus(SettlePage(False), self.old, "L"))
        self.assertEqual(caught.exception.code, "element_replaced")

    def test_a_new_document_fails(self):
        with self.assertRaises(BrowseError):
            run(actions.settle_focus(SettlePage(False, replacement=True, loader_after="L2"), self.old, "L"))

    def test_the_vault_never_follows_a_replacement(self):
        import inspect

        from ardia_cli.browse import vault

        source = inspect.getsource(vault.login)
        self.assertNotIn("settle_focus", source)
        self.assertNotIn("tolerate_detach", source)


class AnnotateListsOnlyWhatIsInTheImage(unittest.TestCase):
    def test_legend_skips_boxes_outside_the_viewport(self):
        from ardia_cli.browse import media

        region = (0, 0, 1280, 577)
        self.assertTrue(media.in_image({"x": 8, "y": 21, "width": 100, "height": 37}, region))
        self.assertTrue(media.in_image({"x": 8, "y": 570, "width": 100, "height": 20}, region))
        self.assertFalse(media.in_image({"x": 8, "y": 10317, "width": 58, "height": 21}, region))
        self.assertFalse(media.in_image({"x": 8, "y": -1979, "width": 58, "height": 21}, region))
        self.assertFalse(media.in_image({"x": 8, "y": 40, "width": 0, "height": 0}, region))


class BrokenPipeIsQuiet(unittest.TestCase):
    def test_a_closed_reader_ends_quietly(self):
        import subprocess

        read, write = os.pipe()
        os.close(read)
        try:
            done = subprocess.run([sys.executable, "-m", "ardia_cli", "browse", "--help"], stdout=write, stderr=subprocess.PIPE,
                                  env=dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1])), timeout=60)
        finally:
            os.close(write)
        self.assertEqual(done.stderr.decode(), "")
        self.assertEqual(done.returncode, 141)


if __name__ == "__main__":
    unittest.main()
