import asyncio
import inspect
import json
import os
import shlex
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli.browse import actions, claims, client, inputs, media, paths, plugins, readurl, snapshot, vault
from ardia_cli.browse import cli as browse_cli
from ardia_cli.browse import commands, daemon
from ardia_cli.browse.errors import BrowseError, ConnectionLost, Gated, OutcomeUnknown, StaleRef, Usage
from ardia_cli.browse.page import Ring
from ardia_cli.browse.state import Ref, RestartedBrowser, State

SCRATCH = Path.home() / "ardia-scratch"


def scratch_dir(test) -> Path:
    SCRATCH.mkdir(exist_ok=True)
    path = Path(tempfile.mkdtemp(prefix="browse-test-", dir=SCRATCH))
    test.addCleanup(shutil.rmtree, path, ignore_errors=True)
    return path


def race_for_lock(root: str, name: str, barrier, results):
    fd = paths.browse_dir(Path(root), create=False)
    barrier.wait(10)
    try:
        lock = paths.take_lock(name, fd)
    except OSError as error:
        results.put(f"{type(error).__name__}: {error}")
        barrier.wait(10)
        return
    results.put("busy" if lock is None else "held")
    barrier.wait(10)


class RecordingExecutor:
    def __init__(self):
        self.commands = []

    async def _execute_command(self, command):
        self.commands.append(command)
        return {}


def typed_text(commands) -> str:
    out = []
    for command in commands:
        params = command["params"]
        if params.get("type") in ("keyDown", "rawKeyDown"):
            if params.get("key") == "Backspace":
                out.append("\b")
            elif params.get("text"):
                out.append(params["text"])
    return "".join(out)


async def no_sleep(_seconds, *args, **kwargs):
    return None


class SteadyKeyboardTest(unittest.TestCase):
    def test_pydoll_still_routes_typos_through_should_make_typo(self):
        from pydoll.interactions.keyboard import Keyboard

        self.assertTrue(hasattr(Keyboard, "_should_make_typo"), "pydoll renamed Keyboard._should_make_typo")
        source = inspect.getsource(Keyboard._process_char_with_typo)
        self.assertIn("self._should_make_typo()", source, "pydoll no longer asks _should_make_typo before a typo")
        humanized = inspect.getsource(Keyboard._type_text_humanized)
        self.assertIn("_process_char_with_typo", humanized, "pydoll's humanized typing bypasses _process_char_with_typo")

    def test_no_typos_even_when_pydoll_would_always_make_one(self):
        text = "The quick brown fox, jumps over 13 lazy dogs!"
        with mock.patch("pydoll.interactions.keyboard.DEFAULT_TYPO_PROBABILITY", 1.0), mock.patch("asyncio.sleep", no_sleep):
            from pydoll.interactions.keyboard import Keyboard

            plain = RecordingExecutor()
            asyncio.run(Keyboard(plain)._type_text_humanized(text))
            self.assertNotEqual(typed_text(plain.commands), text, "the control run should make typos at probability 1")
            steady = RecordingExecutor()
            asyncio.run(inputs.steady_keyboard_class()(steady).type_text(text, humanize=True))
        self.assertEqual(typed_text(steady.commands), text)
        downs = [c for c in steady.commands if c["params"]["type"] == "keyDown"]
        ups = [c for c in steady.commands if c["params"]["type"] == "keyUp"]
        self.assertEqual(len(downs), len(text))
        self.assertEqual(len(ups), len(text))

    def test_default_timing_is_pydolls(self):
        from pydoll.interactions.keyboard import TimingConfig

        keyboard = inputs.steady_keyboard_class()(RecordingExecutor())
        self.assertEqual(keyboard._timing, TimingConfig())


class KeysTest(unittest.TestCase):
    def test_combos(self):
        self.assertEqual(inputs.parse_combo("Enter"), ([], "Enter"))
        self.assertEqual(inputs.parse_combo("Control+a"), (["Control"], "a"))
        self.assertEqual(inputs.parse_combo("Control+Shift+s"), (["Control", "Shift"], "s"))
        self.assertEqual(inputs.parse_combo("Shift"), (["Shift"], None))
        self.assertEqual(inputs.parse_combo("Meta++"), (["Meta"], "+"))
        with self.assertRaises(Usage):
            inputs.parse_combo("Hyper+a")
        with self.assertRaises(Usage):
            inputs.parse_key("NotAKey")
        self.assertEqual(inputs.parse_key("Enter")[2], 13)
        self.assertEqual(inputs.parse_key("esc")[0], "Escape")

    def test_humanize_env(self):
        self.assertFalse(inputs.humanize_default({}))
        self.assertFalse(inputs.humanize_default({"AGENT_BROWSER_NO_HUMANIZE": "1"}))
        self.assertTrue(inputs.humanize_default({"AGENT_BROWSER_HUMANIZE": "1"}))
        self.assertFalse(inputs.humanize_default({"AGENT_BROWSER_HUMANIZE": "0"}))
        self.assertFalse(inputs.humanize_default({"AGENT_BROWSER_HUMANIZE": "1", "AGENT_BROWSER_NO_HUMANIZE": "1"}))


class FakePage:
    def __init__(self, fail_on=None, hidden=False):
        self.sent = []
        self.fail_on = fail_on
        self.is_hidden = hidden

    async def send(self, method, params=None, input_event=False, timeout=30):
        self.sent.append((method, dict(params or {})))
        if self.fail_on and self.fail_on(method, params or {}):
            raise asyncio.CancelledError()
        return {}

    async def require_visible(self):
        if self.is_hidden:
            raise BrowseError("hidden", code="tab_hidden")


class HeldInputTest(unittest.TestCase):
    def test_keydown_held_across_commands_then_released(self):
        page = FakePage()
        held = inputs.Input(page)

        async def run():
            await held.gesture("keydown", lambda: held.press_combo("Shift", False, down_only=True), keep_held=True)
            self.assertTrue(held.holding)
            await held.release_all()

        asyncio.run(run())
        self.assertFalse(held.holding)
        self.assertEqual([p["type"] for m, p in page.sent], ["rawKeyDown", "keyUp"])

    def test_interrupted_press_releases_keys_and_modifiers(self):
        page = FakePage()
        held = inputs.Input(page)

        async def slow_press():
            await held.press_combo("Shift", False, down_only=True)
            await held.press_combo("a", False, down_only=True)
            await asyncio.sleep(10)

        async def run():
            task = asyncio.ensure_future(held.gesture("press", slow_press))
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        asyncio.run(run())
        released = [p["key"] for m, p in page.sent if p.get("type") == "keyUp"]
        self.assertEqual(sorted(released), ["Shift", "a"])
        self.assertFalse(held.holding)

    def test_hidden_tab_refuses_input_before_dispatch(self):
        page = FakePage(hidden=True)
        held = inputs.Input(page)
        with self.assertRaises(BrowseError):
            asyncio.run(held.gesture("click", lambda: held.press_combo("Enter", False)))
        self.assertEqual(page.sent, [])

    def test_mouse_button_released_when_gesture_breaks(self):
        page = FakePage()
        held = inputs.Input(page)

        class Mouse:
            held = "left"
            _pressed_button = "left"
            _position = (10.0, 20.0)

        held.mouse = Mouse()

        async def broken():
            raise BrowseError("boom")

        with self.assertRaises(BrowseError):
            asyncio.run(held.gesture("drag", broken))
        self.assertEqual(page.sent[-1][1]["type"], "mouseReleased")
        self.assertEqual((page.sent[-1][1]["x"], page.sent[-1][1]["y"]), (10, 20))

    def test_human_mouse_marks_the_button_held_before_dispatch(self):
        cls = inputs.human_mouse_class()
        seen = []

        class Handler:
            async def execute_command(self, command, timeout=60):
                seen.append(mouse.held)
                return {}

        mouse = cls(Handler())
        from pydoll.protocol.input.types import MouseButton, MouseEventType

        asyncio.run(mouse._dispatch_button(MouseEventType.MOUSE_PRESSED, MouseButton.LEFT))
        self.assertEqual(seen, [MouseButton.LEFT])
        asyncio.run(mouse._dispatch_button(MouseEventType.MOUSE_RELEASED, MouseButton.LEFT))
        self.assertIsNone(mouse.held)

    def test_humanized_click_moves_before_pressing_and_holds(self):
        cls = inputs.human_mouse_class()
        events = []

        class Handler:
            async def execute_command(self, command, timeout=60):
                events.append((command["params"]["type"], asyncio.get_running_loop().time()))

            async def execute_command_nowait(self, command):
                events.append((command["params"]["type"], asyncio.get_running_loop().time()))

        async def run():
            mouse = cls(Handler())
            mouse._position = (10, 10)
            await mouse.click(400, 300, humanize=True)

        asyncio.run(run())
        kinds = [kind for kind, _ in events]
        first_press = kinds.index("mousePressed")
        self.assertGreater(kinds[:first_press].count("mouseMoved"), 3)
        press = events[first_press][1]
        release = next(t for kind, t in events[first_press:] if kind == "mouseReleased")
        self.assertGreater(release - press, 0.04)


class DeliveryTest(unittest.TestCase):
    class Page:
        main_frame = "F"

        def __init__(self, deliver=True, navigate=False):
            self.counts = {"mousedown": 0, "mouseup": 0, "keydown": 0, "activeFrame": False}
            self.frames = {"F": {"loader": "L1"}}
            self.deliver = deliver
            self.navigate = navigate

        def loader(self, frame):
            return self.frames.get(frame, {}).get("loader")

        async def refresh_frames(self):
            return self.frames

        async def call(self, function, *args, frame=None, **kwargs):
            return dict(self.counts)

        async def dispatch(self):
            if self.deliver:
                self.counts["mousedown"] += 1
                self.counts["mouseup"] += 1
            if self.navigate:
                self.frames["F"]["loader"] = "L2"
            return "done"

    def run_click(self, page):
        with mock.patch.object(actions, "DELIVERY_TIMEOUT", 0.2):
            return asyncio.run(actions.expect_input(page, "F", page.dispatch, {"mousedown": 1, "mouseup": 1}, "The click"))

    def test_delivered_click_passes(self):
        self.assertEqual(self.run_click(self.Page()), "done")

    def test_click_the_page_never_saw_fails(self):
        with self.assertRaises(BrowseError) as caught:
            self.run_click(self.Page(deliver=False))
        self.assertEqual(caught.exception.code, "input_not_delivered")
        self.assertIn("mousedown", caught.exception.message)

    def test_navigation_counts_as_delivered(self):
        self.assertEqual(self.run_click(self.Page(deliver=False, navigate=True)), "done")

    def test_keys_into_a_focused_iframe_are_not_judged_by_the_parent(self):
        page = self.Page(deliver=False)
        page.counts["activeFrame"] = True
        with mock.patch.object(actions, "DELIVERY_TIMEOUT", 0.2):
            self.assertEqual(asyncio.run(actions.expect_input(page, "F", page.dispatch, {"keydown": 1}, "The key press")), "done")


class GlobalsTest(unittest.TestCase):
    def test_split_globals(self):
        found, rest = browse_cli.split_globals(["--session", "s1", "click", "@e1", "--json", "--no-humanize"])
        self.assertEqual(found, {"session": "s1", "json": True, "no_humanize": True})
        self.assertEqual(rest, ["click", "@e1"])

    def test_stream_keeps_its_port(self):
        found, rest = browse_cli.split_globals(["stream", "enable", "--port", "9999"])
        self.assertNotIn("port", found)
        self.assertEqual(rest, ["stream", "enable", "--port", "9999"])
        found, rest = browse_cli.split_globals(["--port", "9333", "snapshot"])
        self.assertEqual(found["port"], "9333")

    def test_launch_flags_refused(self):
        for flag in ("--headed", "--profile", "--proxy", "--extension"):
            with self.assertRaises(Usage):
                browse_cli.split_globals(["open", flag, "x"])

    def test_launch_time_globals_point_at_commands(self):
        for flag, hint in (("--headers", "set headers"), ("--color-scheme", "set media"), ("--download-path", "download")):
            with self.assertRaisesRegex(Usage, hint):
                browse_cli.split_globals(["open", flag, "x"])

    def test_humanize_options(self):
        self.assertFalse(browse_cli.options_from({}, {})["humanize"])
        self.assertTrue(browse_cli.options_from({}, {"AGENT_BROWSER_HUMANIZE": "1"})["humanize"])
        self.assertFalse(browse_cli.options_from({}, {"AGENT_BROWSER_NO_HUMANIZE": "1"})["humanize"])
        self.assertFalse(browse_cli.options_from({"no_humanize": True}, {"AGENT_BROWSER_HUMANIZE": "1"})["humanize"])
        self.assertTrue(browse_cli.options_from({"humanize": True}, {"AGENT_BROWSER_NO_HUMANIZE": "1"})["humanize"])
        self.assertFalse(commands.Ctx(None, {}, "/", {}, None).humanize)
        found, _ = browse_cli.split_globals(["click", "@e1", "--humanize", "--full", "--no-changes"])
        self.assertEqual(found, {"humanize": True, "full": True, "no_changes": True})
        found, rest = browse_cli.split_globals(["screenshot", "--full", "a.png"])
        self.assertEqual((found, rest), ({}, ["screenshot", "--full", "a.png"]))

    def test_cdp_alias(self):
        self.assertEqual(browse_cli.endpoint_choice({"cdp": "9222"}, {}), (None, 9222, None))
        self.assertEqual(browse_cli.endpoint_choice({}, {"AGENT_BROWSER_CDP": "ws://127.0.0.1:1/devtools/browser/x"})[0], "ws://127.0.0.1:1/devtools/browser/x")

    def test_durations(self):
        self.assertEqual(browse_cli.parse_duration("10s"), 10000)
        self.assertEqual(browse_cli.parse_duration("3m"), 180000)
        self.assertEqual(browse_cli.parse_duration("500"), 500)
        with self.assertRaises(Usage):
            browse_cli.parse_duration("soon")

    def test_command_parse(self):
        options, args = commands.parse(["-i", "-d", "3", "--selector=#main", "x"], {"--interactive": "bool", "--depth": "value", "--selector": "value"},
                                       {"-i": "--interactive", "-d": "--depth"})
        self.assertEqual(options, {"interactive": True, "depth": "3", "selector": "#main"})
        self.assertEqual(args, ["x"])
        _, args = commands.parse(["mouse", "-5"])
        self.assertEqual(args, ["mouse", "-5"])
        with self.assertRaises(Usage):
            commands.parse(["--nope"])

    def test_normalize_url(self):
        self.assertEqual(commands.normalize_url("example.com"), "https://example.com")
        self.assertEqual(commands.normalize_url("localhost:3000/x"), "http://localhost:3000/x")
        self.assertEqual(commands.normalize_url("127.0.0.1:8000"), "http://127.0.0.1:8000")
        self.assertEqual(commands.normalize_url("about:blank"), "about:blank")
        self.assertEqual(commands.normalize_url("http://a.b/"), "http://a.b/")

    def test_glob(self):
        self.assertTrue(commands.glob_match("**/dashboard", "https://app.example.com/dashboard"))
        self.assertTrue(commands.glob_match("https://*.example.com/*", "https://app.example.com/x"))
        self.assertFalse(commands.glob_match("https://*.example.com/*", "https://app.example.com/x/y"))
        self.assertTrue(commands.glob_match("dashboard", "https://app.example.com/dashboard?x"))


class PathsTest(unittest.TestCase):
    def test_session_names(self):
        for good in ("default", "a", "task-1.x_y"):
            paths.check_name("s", good)
        for bad in ("", "../x", "a/b", ".hidden", "x" * 65, "sp ace", "é"):
            with self.assertRaises(paths.PathError):
                paths.check_name("s", bad)

    def test_keys_separate_endpoints_and_namespaces(self):
        keys = {paths.session_key("", "token:/a", "s"), paths.session_key("", "port:9", "s"), paths.session_key("n", "token:/a", "s")}
        self.assertEqual(len(keys), 3)

    def test_private_dir_checks(self):
        root = scratch_dir(self)
        fd = paths.browse_dir(root)
        os.close(fd)
        self.assertEqual(stat.S_IMODE(os.stat(root / "Browse").st_mode), 0o700)
        os.chmod(root / "Browse", 0o755)
        with self.assertRaises(paths.PathError):
            paths.browse_dir(root)
        os.chmod(root / "Browse", 0o700)
        other = scratch_dir(self)
        os.symlink(root / "Browse", other / "Browse")
        with self.assertRaises(paths.PathError):
            paths.browse_dir(other)

    def test_lock_is_exclusive(self):
        root = scratch_dir(self)
        fd = paths.browse_dir(root)
        self.addCleanup(os.close, fd)
        first = paths.take_lock("k.lock", fd)
        self.assertIsNotNone(first)
        self.assertIsNone(paths.take_lock("k.lock", fd))
        self.assertTrue(paths.lock_held("k.lock", fd))
        os.close(first)
        self.assertFalse(paths.lock_held("k.lock", fd))

    def test_processes_racing_to_create_one_lock_get_one_holder(self):
        import multiprocessing

        context = multiprocessing.get_context("fork")
        contenders = 8
        for round_number in range(6):
            root = scratch_dir(self)
            paths.browse_dir(root)
            barrier = context.Barrier(contenders)
            results = context.Queue()
            racers = [context.Process(target=race_for_lock, args=(str(root), f"new-{round_number}.lock", barrier, results)) for _ in range(contenders)]
            for racer in racers:
                racer.start()
            outcomes = sorted(results.get(timeout=30) for _ in racers)
            for racer in racers:
                racer.join(10)
            self.assertEqual(outcomes, ["busy"] * (contenders - 1) + ["held"], f"round {round_number}")

    def test_long_socket_paths_bind_relative(self):
        root = scratch_dir(self) / ("deep-" * 20)
        root.mkdir()
        fd = paths.browse_dir(root)
        self.addCleanup(os.close, fd)
        self.assertGreater(len(str(root / "Browse" / ("k" * 24 + ".sock"))), 104)
        name = "k" * 24 + ".sock"
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(server.close)
        previous = os.umask(0o177)
        try:
            with paths.inside(fd):
                server.bind(name)
        finally:
            os.umask(previous)
        server.listen(1)
        self.assertIsNotNone(paths.socket_is_ours(name, fd))
        sock = client.connect(fd, name)
        self.assertIsNotNone(sock)
        sock.close()

    def test_refuses_a_world_readable_socket(self):
        root = scratch_dir(self)
        fd = paths.browse_dir(root)
        self.addCleanup(os.close, fd)
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(server.close)
        with paths.inside(fd):
            server.bind("s.sock")
        os.chmod(root / "Browse" / "s.sock", 0o666)
        with self.assertRaises(BrowseError):
            client.connect(fd, "s.sock")


class ClaimsTest(unittest.TestCase):
    def test_second_live_session_is_refused(self):
        root = scratch_dir(self)
        fd = paths.browse_dir(root)
        self.addCleanup(os.close, fd)
        lock_a = paths.take_lock("a.lock", fd)
        claims.claim(fd, "a", "one", "TARGET", "console")
        with self.assertRaises(BrowseError):
            claims.claim(fd, "b", "two", "TARGET", "network")
        claims.claim(fd, "a", "one", "TARGET", "network")
        os.close(lock_a)
        claims.claim(fd, "b", "two", "TARGET", "network")
        claims.release(fd, "b")
        self.assertEqual([n for n in os.listdir(root / "Browse" / "claims") if n.endswith(".json") and not n.startswith(".")], [])


class TabIdsTest(unittest.TestCase):
    def registries(self):
        from ardia_cli.browse.tabs import Registry

        fd = paths.browse_dir(scratch_dir(self))
        self.addCleanup(os.close, fd)
        locks = [paths.take_lock(f"{key}.lock", fd) for key in ("ka", "kb")]
        for lock in locks:
            self.addCleanup(os.close, lock)
        return fd, Registry(fd, "ka", "one"), Registry(fd, "kb", "two")

    def test_every_session_numbers_a_tab_the_same_and_ids_never_shift(self):
        _, one, two = self.registries()
        self.assertEqual(one.numbers("I", ["A", "B"]), {"A": "t1", "B": "t2"})
        self.assertEqual(two.numbers("I", ["C", "B"]), {"C": "t3", "B": "t2"})
        self.assertEqual(one.numbers("I", ["C"], present=["A", "C"], taken_at=time.time() + 1), {"C": "t3"})
        self.assertEqual(two.numbers("I", ["D", "A"]), {"D": "t4", "A": "t1"})
        self.assertEqual(one.target_of("I", "t4"), "D")
        self.assertIsNone(one.target_of("I", "t2"))
        self.assertEqual(one.numbers("J", ["A"]), {"A": "t1"})
        self.assertIsNone(one.target_of("J", "t4"))

    def test_sessions_see_what_others_opened_and_use_until_they_end(self):
        fd, one, two = self.registries()
        one.note_opened("I", "A")
        one.note_using("I", "A")
        two.note_using("I", "A")
        self.assertEqual(two.others("I"), ({"A": "one"}, {"A": ["one"]}))
        self.assertEqual(one.others("I"), ({}, {"A": ["two"]}))
        one.forget()
        self.assertEqual(two.others("I"), ({}, {}))

    def test_a_session_that_died_without_cleaning_up_is_ignored(self):
        from ardia_cli.browse.tabs import Registry

        fd, one, _ = self.registries()
        ghost = Registry(fd, "gone", "ghost")
        ghost.note_opened("I", "A")
        ghost.note_using("I", "A")
        self.assertEqual(one.others("I"), ({}, {}))

    def state_with(self, registry, targets):
        state = State({"session": registry.session}, lambda: None)
        state.registry = registry
        state.instance = "I"
        state.target_infos = {target: {"targetId": target, "url": url, "title": target} for target, url in targets.items()}
        return state

    def test_app_tab_ids_pair_only_by_the_target_ardia_reports(self):
        from ardia_cli.browse import tabs

        rows = [{"id": "tab-a", "url": "http://b/", "targetId": "A", "pageGeneration": 2}, {"id": "tab-b", "url": "http://a/", "targetId": "B"},
                {"id": "tab-s", "url": "http://s/", "targetId": None}, {"id": "tab-x", "url": "http://x/", "targetId": "GONE"}]
        infos = {"A": {"url": "http://a/"}, "B": {"url": "http://b/"}}
        self.assertEqual(tabs.pair_by_target(rows, infos), {"A": {"app": "tab-a", "generation": 2}, "B": {"app": "tab-b", "generation": None}})
        self.assertEqual(tabs.pair_by_target([{"id": "tab-a", "url": "http://a/"}], infos), {})

    def test_tab_accepts_the_app_tab_id_and_explains_asleep_and_old_ardias(self):
        from ardia_cli.browse import tabs

        _, one, _ = self.registries()
        state = self.state_with(one, {"A": "http://a/", "B1": "http://b/", "B2": "http://b/"})
        windows = [{"id": "w1", "tabs": [{"id": "tab-a", "url": "http://a/", "targetId": "A"}, {"id": "tab-b", "url": "http://b/", "targetId": "B2"},
                                         {"id": "tab-s", "url": "http://s/", "targetId": None}]}]

        async def fake_windows(state):
            return windows

        with mock.patch.object(tabs, "app_windows", fake_windows):
            self.assertEqual(asyncio.run(state.find_tab("tab-a")), "A")
            self.assertEqual(asyncio.run(state.find_tab("tab-b")), "B2")
            for ref, code in (("tab-s", "tab_asleep"), ("tab-zz", "tab_not_found")):
                with self.assertRaises(BrowseError) as caught:
                    asyncio.run(state.find_tab(ref))
                self.assertEqual(caught.exception.code, code, ref)
        windows[0]["tabs"] = [{"id": "tab-a", "url": "http://a/"}]
        with mock.patch.object(tabs, "app_windows", fake_windows), self.assertRaises(BrowseError) as old:
            asyncio.run(state.find_tab("tab-a"))
        self.assertIn("doesn't say which page belongs to tab-a", old.exception.message)
        self.assertEqual(asyncio.run(state.find_tab(state.tab_id("B2"))), "B2")

    def replaced(self, rows, borrowed=False, opened=False):
        from ardia_cli.browse import tabs

        _, one, _ = self.registries()
        state = self.state_with(one, {"OLD": "http://a/"})
        state.current = "OLD"
        if borrowed:
            state.extras["attached"] = "OLD"
        if opened:
            state.opened.add("OLD")
        state.app_tabs["OLD"] = "tab-a"
        state.extras["had_tab"] = True
        state.forget_target("OLD")
        state.target_infos = {"NEW": {"targetId": "NEW", "url": "http://a/", "title": "A"}, "OTHER": {"targetId": "OTHER", "url": "http://a/", "title": "A"}}

        async def refresh():
            return list(state.target_infos.values())

        async def fake_windows(state):
            return [{"id": "w1", "tabs": rows}]

        state.refresh_targets = refresh
        with mock.patch.object(tabs, "app_windows", fake_windows):
            try:
                return state, asyncio.run(state.follow_lost_tab()), None
            except BrowseError as error:
                return state, None, error

    def test_a_session_follows_its_tab_only_where_ardia_says_the_page_went(self):
        state, target, _ = self.replaced([{"id": "tab-a", "url": "http://a/", "targetId": "NEW", "pageGeneration": 3}], borrowed=True)
        self.assertEqual((target, state.current), ("NEW", "NEW"))
        self.assertIn("follows it", state.extras["notice"])
        self.assertEqual(state.extras["attached"], "NEW")
        self.assertNotIn("NEW", state.opened)
        state, target, _ = self.replaced([{"id": "tab-a", "url": "http://a/", "targetId": "NEW"}], opened=True)
        self.assertIn("NEW", state.opened)
        _, _, error = self.replaced([{"id": "tab-a", "url": "http://a/"}])
        self.assertEqual(error.code, "tab_gone")
        self.assertIn("didn't say which page took over", error.message)
        _, _, asleep = self.replaced([{"id": "tab-a", "url": "http://a/", "targetId": None}])
        self.assertEqual(asleep.code, "tab_asleep")

    def test_open_after_following_a_borrowed_tab_still_opens_its_own_tab(self):
        state, _, _ = self.replaced([{"id": "tab-a", "url": "http://a/", "targetId": "NEW"}], borrowed=True)
        borrowed = state.extras.get("attached") if state.current and state.current == state.extras.get("attached") else None
        self.assertEqual(borrowed, "NEW")


def ax(node_id, role, name="", parent=None, children=(), backend=None, value=None, props=None, ignored=False):
    node = {"nodeId": node_id, "role": {"value": role}, "name": {"value": name}, "childIds": list(children), "ignored": ignored}
    if parent:
        node["parentId"] = parent
    if backend:
        node["backendDOMNodeId"] = backend
    if value is not None:
        node["value"] = {"value": value}
    if props:
        node["properties"] = [{"name": k, "value": {"value": v}} for k, v in props.items()]
    return node


TREE = [
    ax("1", "RootWebArea", "Page", children=["2", "5"]),
    ax("2", "main", parent="1", children=["3", "4", "6"]),
    ax("3", "heading", "Log in", parent="2", children=["31"], backend=30, props={"level": 1}),
    ax("31", "StaticText", "Log in", parent="3"),
    ax("4", "generic", "", parent="2", children=["41", "42"], ignored=True),
    ax("41", "textbox", "Email", parent="4", backend=41, value="a@b.co"),
    ax("42", "checkbox", "I agree", parent="4", backend=42, props={"checked": "false"}),
    ax("6", "paragraph", "", parent="2", children=["61"]),
    ax("61", "StaticText", "  ", parent="6"),
    ax("5", "contentinfo", "", parent="1", children=["51"]),
    ax("51", "link", "Privacy", parent="5", backend=51),
]


class SnapshotTest(unittest.TestCase):
    def nodes(self):
        nodes = snapshot.build_tree(TREE)
        counter = 0
        for node in snapshot.walk(nodes):
            if node.role in snapshot.REF_ROLES:
                counter += 1
                node.ref = f"e{counter}"
        return nodes

    def test_full(self):
        self.assertEqual(snapshot.render(self.nodes()), "\n".join([
            "- main",
            '  - heading "Log in" [level=1, ref=e1]',
            '  - textbox "Email" [ref=e2]: a@b.co',
            '  - checkbox "I agree" [checked=false, ref=e3]',
            "  - paragraph",
            "- contentinfo",
            '  - link "Privacy" [ref=e4]',
        ]))

    def test_interactive_compact_depth(self):
        self.assertEqual(snapshot.render(self.nodes(), interactive=True).splitlines()[0], '- heading "Log in" [level=1, ref=e1]')
        self.assertNotIn("paragraph", snapshot.render(self.nodes(), compact=True))
        self.assertEqual(snapshot.render(self.nodes(), depth=0), "- main\n- contentinfo")

    def test_scope(self):
        nodes = snapshot.build_tree(TREE, scope_backend=51)
        self.assertEqual([node.role for node in nodes], ["link"])


class RefsTest(unittest.TestCase):
    def state_with(self, frames):
        state = State({"session": "t"}, lambda: None)
        state.instance = "1:1:/devtools/browser/x"
        state.target_infos = {"T": {"targetId": "T"}}

        class Page:
            target_id = "T"
            main_frame = "F"

            def __init__(self):
                self.frames = frames

            async def refresh_frames(self):
                return self.frames

            async def resolve_backend(self, *args):
                return None

        page = Page()

        async def get_page(target=None):
            return page

        state.page = get_page
        return state

    def test_stale_on_navigation_restart_or_missing_node(self):
        state = self.state_with({"F": {"loader": "L2"}})
        state.refs = {"e1": Ref("e1", state.instance, "T", "F", "L1", 1, 5, "button", "Go")}
        with self.assertRaisesRegex(StaleRef, "navigated"):
            asyncio.run(state.resolve_ref("e1"))
        state.refs["e1"].loader = "L2"
        with self.assertRaisesRegex(StaleRef, "no longer in the page"):
            asyncio.run(state.resolve_ref("e1"))
        state.refs["e1"].instance = "other"
        with self.assertRaisesRegex(StaleRef, "restarted"):
            asyncio.run(state.resolve_ref("e1"))
        with self.assertRaisesRegex(BrowseError, "Unknown ref"):
            asyncio.run(state.resolve_ref("e9"))

    def test_restarted_browser_is_refused(self):
        class Endpoint:
            instance = "2:1:/devtools/browser/y"

        state = State({"session": "t"}, lambda: Endpoint())
        state.instance = "1:1:/devtools/browser/x"
        with self.assertRaises(RestartedBrowser):
            asyncio.run(state.connect())
        self.assertTrue(state.restarted)

    def test_lost_connection_never_reconnects(self):
        state = State({"session": "t"}, lambda: self.fail("must not resolve the endpoint again"))
        state.lost = True
        with self.assertRaises(ConnectionLost):
            asyncio.run(state.connect())

    def test_ref_parsing(self):
        from ardia_cli.browse.state import parse_ref

        self.assertEqual(parse_ref("@e12"), "e12")
        self.assertEqual(parse_ref("ref=e3"), "e3")
        self.assertIsNone(parse_ref("#e3"))
        self.assertIsNone(parse_ref("@ex"))


class RenderTest(unittest.TestCase):
    def test_json_matches_agent_browser(self):
        code, out, err = daemon.render({"json": True}, result=commands.Result({"clicked": "@e1"}))
        self.assertEqual((code, out, err), (0, '{"success":true,"data":{"clicked":"@e1"},"error":null}\n', ""))
        code, out, err = daemon.render({"json": True}, error=BrowseError("Unknown ref: e9"))
        self.assertEqual(json.loads(out), {"success": False, "data": None, "error": "Unknown ref: e9"})
        self.assertEqual(code, 1)

    def test_text(self):
        self.assertEqual(daemon.render({}, result=commands.Result()), (0, "✓ Done\n", ""))
        self.assertEqual(daemon.render({}, error=BrowseError("nope")), (1, "", "✗ nope\n"))

    def test_lost_connection_reports_unknown_outcome(self):
        code, _, err = daemon.render({}, error=ConnectionLost(), name="click")
        self.assertEqual(code, 2)
        self.assertIn("outcome of `click` is unknown", err)
        self.assertEqual(OutcomeUnknown("drag", "x").exit_code, 1)

    def test_page_output_limits(self):
        result = commands.Result({}, "x" * 50, page_content=True)
        _, out, _ = daemon.render({"max_output": "10"}, result=result)
        self.assertTrue(out.startswith("x" * 10 + "\n[output capped at 10 of 50 characters. Narrow it instead:"))
        self.assertIn("Only if you need every line: --max-output 50]", out)
        _, out, _ = daemon.render({"content_boundaries": True}, result=commands.Result({}, "hi", page_content=True))
        self.assertRegex(out, r"^<<<PAGE_CONTENT [0-9a-f]{8}>>>\nhi\n<<<END_PAGE_CONTENT [0-9a-f]{8}>>>\n$")

    def test_gate_message_names_the_method(self):
        error = Gated("Fetch.enable", "network route")
        self.assertIn("`network route` needs Fetch.enable", error.message)
        self.assertIn("isn't allowed for the ardia command", error.message)
        self.assertEqual(error.code, "policy_refused")

    def test_every_documented_command_is_registered_or_skipped(self):
        daemon.load_commands()
        for name in ("open", "snapshot", "click", "dblclick", "type", "fill", "press", "keyboard", "hover", "focus", "check", "uncheck",
                     "select", "drag", "upload", "download", "scroll", "scrollintoview", "wait", "screenshot", "pdf", "eval", "read",
                     "get", "is", "find", "mouse", "set", "back", "forward", "reload", "tab", "network", "cookies", "storage", "console",
                     "errors", "highlight", "clipboard", "diff", "trace", "profiler", "record", "stream", "react", "vitals", "a11y",
                     "pushstate", "addinitscript", "removeinitscript", "batch", "session", "dialog", "frame", "state", "window",
                     "keydown", "keyup"):
            self.assertIn(name, commands.COMMANDS, name)
        for name in ("connect", "inspect", "install", "chat", "profiles"):
            self.assertIn(name, commands.SKIPPED)


class RingTest(unittest.TestCase):
    def test_bounded_with_loss_counter(self):
        ring = Ring(3)
        for value in range(5):
            ring.add(value)
        self.assertEqual(list(ring.items), [2, 3, 4])
        self.assertEqual(ring.dropped, 2)


class PngTest(unittest.TestCase):
    def test_roundtrip_draw_and_diff(self):
        image = media.Image(40, 30, bytearray(b"\xff\xff\xff\xff" * 1200))
        png = media.encode_png(image)
        decoded = media.decode_png(png)
        self.assertEqual((decoded.width, decoded.height), (40, 30))
        same = media.compare_pngs(png, png, 0.1, None)
        self.assertTrue(same["match"])
        image.outline(2, 2, 20, 20, media.LABEL)
        image.text(4, 4, "12", media.WHITE, 1)
        changed = media.compare_pngs(png, media.encode_png(image), 0.1, None)
        self.assertFalse(changed["match"])
        self.assertGreater(changed["diffPixels"], 0)

    def test_decodes_chrome_screenshots_filters(self):
        if not shutil.which("sips"):
            self.skipTest("sips missing")
        folder = scratch_dir(self)
        source = media.Image(17, 9, bytearray(bytes(range(256)) * 3)[: 17 * 9 * 4])
        (folder / "a.png").write_bytes(media.encode_png(source))
        subprocess.run(["sips", "-s", "format", "png", str(folder / "a.png"), "--out", str(folder / "b.png")], capture_output=True, check=True)
        decoded = media.decode_png((folder / "b.png").read_bytes())
        self.assertEqual((decoded.width, decoded.height), (17, 9))


class VaultTest(unittest.TestCase):
    def test_quote_and_refusals(self):
        self.assertEqual(vault.quote('a "b" \\c'), '"a \\"b\\" \\\\c"')
        with self.assertRaises(BrowseError):
            vault.quote("line\nbreak")
        with self.assertRaises(Usage):
            vault.read_password({"password": "x"}, lambda: "")
        self.assertEqual(vault.read_password({"password_stdin": True}, lambda: "s3cret\n"), "s3cret")

    def test_origins(self):
        self.assertEqual(vault.origin_of("https://App.Example.com/login?x"), "https://app.example.com")
        self.assertEqual(vault.origin_of("http://localhost:8000/x"), "http://localhost:8000")
        with self.assertRaises(BrowseError):
            vault.origin_of("http://example.com/")
        with self.assertRaises(BrowseError):
            vault.origin_of("ftp://example.com/")

    def test_secret_never_on_argv_and_round_trips_through_a_scratch_keychain(self):
        if not os.path.exists(vault.SECURITY):
            self.skipTest("no /usr/bin/security")
        folder = scratch_dir(self)
        keychain = folder / "t.keychain-db"
        subprocess.run([vault.SECURITY, "create-keychain", "-p", "scratch", str(keychain)], check=True, capture_output=True)
        self.addCleanup(subprocess.run, [vault.SECURITY, "delete-keychain", str(keychain)], capture_output=True)
        subprocess.run([vault.SECURITY, "unlock-keychain", "-p", "scratch", str(keychain)], check=True, capture_output=True)
        seen = []
        real_run = subprocess.run

        def spy(argv, *args, **kwargs):
            seen.append((list(argv), kwargs.get("input")))
            return real_run(argv, *args, **kwargs)

        secret = 'pä ss"w\\ord'
        root = folder / "data"
        root.mkdir()
        with mock.patch.dict(os.environ, {"ARDIA_BROWSE_KEYCHAIN": str(keychain)}), mock.patch("subprocess.run", spy):
            meta = vault.save(root, "site", {"url": "https://example.com/login", "username": "me", "password_stdin": True}, lambda: secret + "\n")
            self.assertEqual(vault.read_secret("site", meta["utf8"]), secret)
            self.assertEqual(vault.listing(root)[0]["origins"], ["https://example.com"])
            vault.delete(root, "site")
        for argv, stdin in seen:
            self.assertEqual(argv, [vault.SECURITY, "-i"])
            self.assertNotIn(secret, " ".join(argv))
        self.assertTrue(any(stdin and b"add-generic-password" in stdin for _, stdin in seen))
        meta_file = root / "Browse" / "auth"
        self.assertFalse(any(secret in p.read_text() for p in meta_file.glob("*.json")))


class PluginTest(unittest.TestCase):
    def test_protocol(self):
        root = scratch_dir(self)
        script = root / "plugin.py"
        script.write_text(
            "import json, sys\n"
            "request = json.loads(sys.stdin.read())\n"
            "print(json.dumps({'protocol': 'agent-browser.plugin.v1', 'success': True, 'data': {'echo': request}}))\n"
        )
        launcher = root / "plugin"
        launcher.write_text(f"#!/bin/sh\nexec {shlex.quote(sys.executable)} {shlex.quote(str(script))}\n")
        launcher.chmod(0o755)
        plugins.save_registry(root, [{"name": "echo", "command": str(launcher), "capabilities": ["command.run", "credential.read"]}])
        data = plugins.call(root, "echo", "command.run", {"a": 1})
        self.assertEqual(data["echo"], {"protocol": "agent-browser.plugin.v1", "capability": "command.run", "type": "command.run", "request": {"a": 1}})
        with self.assertRaises(BrowseError):
            plugins.credential(root, "echo", "item", None)

    def test_specs(self):
        with self.assertRaises(Usage):
            plugins.resolve_spec("../evil")
        with mock.patch.object(plugins, "run_tool", return_value='"1.2.3"'):
            self.assertEqual(plugins.resolve_spec("agent-browser-plugin-vault"), ("agent-browser-plugin-vault@1.2.3", "agent-browser-plugin-vault", "1.2.3"))
            self.assertEqual(plugins.resolve_spec("@scope/p@2.0.0")[0], "@scope/p@2.0.0")


class ReadTest(unittest.TestCase):
    def test_html_extract_and_filters(self):
        extractor = readurl.TextExtractor()
        extractor.feed("<html><head><title>T</title><style>x{}</style></head><body><nav>menu</nav><h1>Guide</h1><p>Intro text</p>"
                       "<h2>Auth</h2><ul><li>one</li><li>two</li></ul><h2>Other</h2><p>more</p></body></html>")
        text = extractor.text()
        self.assertEqual(text, "# Guide\n\nIntro text\n\n## Auth\n\n- one\n- two\n\n## Other\n\nmore")
        self.assertEqual(readurl.post_process(text, {"filter": "auth"}), "## Auth\n\n- one\n- two")
        self.assertEqual(readurl.post_process(text, {"outline": True}), "Guide\n  Auth\n  Other")


class CookieFileTest(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(commands.parse_cookie_file('[{"name":"a","value":"1"}]'), [("a", "1")])
        self.assertEqual(commands.parse_cookie_file("curl 'https://x' -H 'cookie: a=1; b=2'"), [("a", "1"), ("b", "2")])
        self.assertEqual(commands.parse_cookie_file("Cookie: s=xyz"), [("s", "xyz")])


class ClientDaemonTest(unittest.TestCase):
    def test_daemon_serves_one_session_and_cleans_up(self):
        import warnings

        warnings.simplefilter("ignore", ResourceWarning)
        root = scratch_dir(self)
        key = paths.session_key("", "port:1", "unit")
        config = {"session": "unit", "namespace": "", "key": key, "data_root": str(root), "port": 1, "ws": None, "data_dir": None,
                  "endpoint_label": "--port 1", "idle_timeout_ms": 60000}
        fd = paths.browse_dir(root)
        self.addCleanup(os.close, fd)
        sock = client.ensure_daemon(fd, key, config)
        answer = client.request(sock, {"argv": ["session"], "options": {}, "cwd": str(root), "env": {}, "stdin": None})
        metrics = answer.pop("metrics")
        self.assertEqual(answer, {"exit": 0, "out": "unit\n", "err": ""})
        self.assertEqual(metrics["cdp_calls"], 0)
        self.assertTrue(paths.lock_held(f"{key}.lock", fd))
        mode = stat.S_IMODE(os.lstat(root / "Browse" / f"{key}.sock").st_mode)
        self.assertEqual(mode, 0o600)
        sock = client.ensure_daemon(fd, key, config)
        answer = client.request(sock, {"argv": ["snapshot"], "options": {}, "cwd": str(root), "env": {}, "stdin": None})
        self.assertEqual(answer["exit"], 2)
        sock = client.connect(fd, f"{key}.sock")
        if sock is not None:
            client.request(sock, {"argv": ["close"], "options": {}, "cwd": str(root), "env": {}, "stdin": None})
        for _ in range(100):
            if not paths.lock_held(f"{key}.lock", fd):
                break
            import time

            time.sleep(0.05)
        self.assertFalse(paths.lock_held(f"{key}.lock", fd))
        self.assertFalse((root / "Browse" / f"{key}.sock").exists())


if __name__ == "__main__":
    unittest.main()
