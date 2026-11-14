import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli.browse import audit, capture, commands, script, vault
from ardia_cli.browse.errors import BrowseError
from ardia_cli.browse.state import State


class Stop(Exception):
    pass


class FakePage:
    def __init__(self, target):
        self.target_id = target
        self.main_frame = "F"
        self.frames = {"F": {"origin": "https://user.example"}}
        self.url = "https://user.example/draft"
        self.navigations = 0
        self.init_scripts = {}

    async def refresh_frames(self):
        return self.frames

    async def call(self, *args, **kwargs):
        return {}

    async def send(self, *args, **kwargs):
        return {}


class BorrowedTab(unittest.TestCase):
    def setUp(self):
        self.state = State({"session": "t", "data_root": "/nowhere"}, lambda: None)
        self.state.instance = "I"
        self.state.target_infos = {"USER": {"targetId": "USER", "url": "https://user.example/draft"}}
        self.state.current = "USER"
        self.state.extras["attached"] = "USER"
        self.user = FakePage("USER")
        self.mine = FakePage("MINE")
        self.mine.frames = {"F": {"origin": ""}}
        self.mine.url = "about:blank"
        self.navigated = []

        async def page(target=None):
            return self.user if (target or self.state.current) == "USER" else self.mine

        async def connect():
            return None

        async def new_tab(ctx, url, *args, **kwargs):
            self.state.current = "MINE"
            self.state.target_infos["MINE"] = {"targetId": "MINE", "url": "about:blank"}
            return self.mine

        async def navigate(ctx, page, url, *args):
            self.navigated.append((page.target_id, url))
            raise Stop()

        self.state.page = page
        self.state.connect = connect
        patches = [mock.patch.object(commands, "new_tab", new_tab), mock.patch.object(commands, "navigate", navigate),
                   mock.patch.object(audit, "navigate", navigate)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def run_command(self, function, argv, name=""):
        ctx = commands.Ctx(self.state, {}, "/", {}, None, name)
        with self.assertRaises(Stop):
            asyncio.run(function(ctx, argv))
        return self.navigated

    def test_vitals_with_a_url_opens_its_own_tab(self):
        self.assertEqual(self.run_command(commands.cmd_vitals, ["example.com"]), [("MINE", "https://example.com")])
        self.assertIn("since this session uses your tab", self.state.extras["notice"])

    def test_diff_url_opens_its_own_tab(self):
        self.assertEqual(self.run_command(commands.cmd_diff, ["url", "a.example", "b.example"]), [("MINE", "https://a.example")])

    def test_a11y_with_a_url_opens_its_own_tab(self):
        self.assertEqual(self.run_command(audit.cmd_a11y, ["example.com"]), [("MINE", "https://example.com")])

    def test_record_with_a_url_opens_its_own_tab(self):
        with mock.patch.object(capture.shutil, "which", lambda name: "/usr/bin/ffmpeg"):
            self.assertEqual(self.run_command(capture.cmd_record, ["start", "/tmp/x.webm", "example.com"]), [("MINE", "https://example.com")])

    def test_auth_login_on_another_origin_opens_its_own_tab(self):
        meta = {"url": "https://login.example/", "origins": ["https://login.example"]}
        with mock.patch.object(vault, "load_meta", lambda root, name: meta), mock.patch.object(vault, "read_secret", lambda name, utf8: "pw"):
            self.assertEqual(self.run_command(vault.login, ["work"]), [("MINE", "https://login.example/")])

    def test_back_forward_reload_and_pushstate_refuse_a_borrowed_tab(self):
        ctx = lambda name: commands.Ctx(self.state, {}, "/", {}, None, name)
        for function, argv, name in ((commands.cmd_history, [], "back"), (commands.cmd_history, [], "forward"),
                                     (commands.cmd_reload, [], "reload"), (commands.cmd_pushstate, ["/x"], "pushstate")):
            with self.assertRaises(BrowseError) as caught:
                asyncio.run(function(ctx(name), argv))
            self.assertEqual(caught.exception.code, "borrowed_tab", name)
            self.assertIn("ardia browse tab t", caught.exception.message)

    def refused(self, function, argv, name=""):
        with self.assertRaises(BrowseError) as caught:
            asyncio.run(function(commands.Ctx(self.state, {}, "/", {}, None, name), argv))
        self.assertEqual(caught.exception.code, "borrowed_tab", argv)
        self.assertIn("pick it with `ardia browse tab t", caught.exception.message)
        return caught.exception.message

    def test_storage_changes_refuse_a_borrowed_tab_and_reads_still_work(self):
        for kind in ("local", "session"):
            self.assertIn(f"won't clear the {kind} storage of it", self.refused(commands.cmd_storage, [kind, "clear"]))
            self.refused(commands.cmd_storage, [kind, "set", "k", "v"])
            self.refused(commands.cmd_storage, [kind, "remove", "k"])
        result = asyncio.run(commands.cmd_storage(commands.Ctx(self.state, {}, "/", {}, None, "storage"), ["local"]))
        self.assertEqual(result.text, "(empty)")

    def test_set_device_asks_for_touch_before_it_changes_the_viewport(self):
        from ardia_cli import command_metrics
        from ardia_cli.browse.errors import Gated

        self.state.current = "MINE"
        self.state.target_infos["MINE"] = {"targetId": "MINE", "url": "about:blank"}
        sent = []

        async def send(method, params=None, **kwargs):
            sent.append(method)
            if method == "Emulation.setTouchEmulationEnabled":
                raise Gated(method)
            return {}

        self.mine.send = send
        with self.assertRaises(Gated):
            asyncio.run(commands.cmd_set(commands.Ctx(self.state, {}, "/", {}, None, "set"), ["device", "iphone", "14"]))
        self.assertEqual(sent, ["Emulation.setTouchEmulationEnabled"])
        self.assertNotIn("emulation", self.state.leases)
        request = {"argv": ["set"], "options": {}}
        command_metrics.begin(request)
        self.addCleanup(command_metrics.current.set, None)
        asyncio.run(commands.cmd_set(commands.Ctx(self.state, {}, "/", {}, None, "set"), ["viewport", "390", "844"]))
        self.assertEqual(sent[-1], "Emulation.setDeviceMetricsOverride")
        self.assertIn("emulation", self.state.leases)
        self.assertTrue(command_metrics.answer_fields(request)["metrics"]["viewport_set"])

    def own_tab_on_the_token_path(self):
        from ardia_cli.browse import tabs

        self.state.current = "MINE"
        self.state.target_infos["MINE"] = {"targetId": "MINE", "url": "https://mine.example/"}
        self.state.endpoint = mock.Mock(explicit=False)
        self.mine.url = "https://mine.example/"
        calls = []

        async def app_tab_map(state):
            return {"MINE": "tab-mine"}

        async def app_call(state, method, params, timeout=0):
            calls.append((method, params))
            return {"ok": True}

        for patch in (mock.patch.object(tabs, "app_tab_map", app_tab_map), mock.patch.object(tabs, "app_call", app_call)):
            patch.start()
            self.addCleanup(patch.stop)
        return calls, tabs

    def test_set_viewport_takes_the_sessions_tab_off_screen_first(self):
        calls, _ = self.own_tab_on_the_token_path()
        sent = []

        async def send(method, params=None, **kwargs):
            sent.append(method)
            return {}

        self.mine.send = send
        set_viewport = lambda: asyncio.run(commands.cmd_set(commands.Ctx(self.state, {}, "/", {}, None, "set"), ["viewport", "390", "844"]))
        set_viewport()
        self.assertEqual(calls, [("offscreen", {"tab": "tab-mine"})])
        self.assertEqual(sent, ["Emulation.setDeviceMetricsOverride"])
        self.assertEqual(self.state.extras["offscreen"], {"MINE"})
        set_viewport()
        self.assertEqual(len(calls), 1)

    def test_a_tab_ardia_wont_take_off_screen_gets_no_viewport(self):
        from ardia_cli import control

        _, tabs = self.own_tab_on_the_token_path()
        sent = []

        async def send(method, params=None, **kwargs):
            sent.append(method)
            return {}

        self.mine.send = send
        for error, code, says in ((control.MethodError("refused", "That tab is shown in a window, so it can't go off-screen."), "viewport_needs_hidden_tab", "open <url>` (without --show)"),
                                  (control.MethodError("unknown_method", "no such method"), "viewport_unsupported", "update Ardia")):
            async def app_call(state, method, params, timeout=0):
                raise error

            with mock.patch.object(tabs, "app_call", app_call), self.assertRaises(BrowseError) as caught:
                asyncio.run(commands.cmd_set(commands.Ctx(self.state, {}, "/", {}, None, "set"), ["viewport", "390", "844"]))
            self.assertEqual(caught.exception.code, code)
            self.assertIn(says, caught.exception.message)
        self.assertEqual(sent, [])
        self.assertFalse(self.state.extras.get("offscreen"))

    def test_showing_or_resetting_an_off_screen_tab_reloads_it_in_a_new_tab(self):
        self.state.current = "MINE"
        self.state.target_infos["MINE"] = {"targetId": "MINE", "url": "https://mine.example/"}
        self.mine.url = "https://mine.example/a"
        self.state.opened.add("MINE")
        self.state.set_offscreen("MINE", True)
        fresh = FakePage("FRESH")
        fresh.url = "https://mine.example/a"
        opened, closed = [], []

        async def new_tab(ctx, url, label=None, window=False, show=False):
            opened.append(url)
            self.state.current = "FRESH"
            self.state.target_infos["FRESH"] = {"targetId": "FRESH", "url": url}
            return fresh

        async def send(method, params=None, *args, **kwargs):
            closed.append((method, params))
            return {}

        self.state.browser = mock.Mock(send=send)
        self.state.registry = mock.Mock(reserve_close=lambda instance, target: True, finish_close=lambda instance, target: None)
        with mock.patch.object(commands, "new_tab", new_tab):
            result = asyncio.run(commands.cmd_set(commands.Ctx(self.state, {}, "/", {}, None, "set"), ["viewport", "reset"]))
        self.assertEqual(opened, ["https://mine.example/a"])
        self.assertEqual(closed, [("Target.closeTarget", {"targetId": "MINE"})])
        self.assertFalse(self.state.extras.get("offscreen"))
        self.assertNotIn("offscreen", self.state.leases)
        self.assertEqual(self.state.current, "FRESH")
        self.assertIn("reloaded in a new background tab", result.text)

    def test_a_reset_whose_new_tab_fails_keeps_the_off_screen_tab_and_its_lease(self):
        self.state.current = "MINE"
        self.state.target_infos["MINE"] = {"targetId": "MINE", "url": "https://mine.example/"}
        self.mine.url = "https://mine.example/a"
        self.state.opened.add("MINE")
        self.state.labels["work"] = "MINE"
        self.state.set_offscreen("MINE", True)
        sent = []

        async def new_tab(ctx, url, label=None, window=False, show=False):
            raise BrowseError("Navigation to https://mine.example/a timed out")

        async def send(method, params=None, *args, **kwargs):
            sent.append(method)
            return {}

        self.state.browser = mock.Mock(send=send)
        self.state.registry = mock.Mock(reserve_close=lambda instance, target: True, finish_close=lambda instance, target: None)
        with mock.patch.object(commands, "new_tab", new_tab), self.assertRaises(BrowseError):
            asyncio.run(commands.cmd_set(commands.Ctx(self.state, {}, "/", {}, None, "set"), ["viewport", "reset"]))
        self.assertNotIn("Target.closeTarget", sent)
        self.assertIn("MINE", self.state.extras.get("offscreen"))
        self.assertIn("offscreen", self.state.leases)
        self.assertEqual(self.state.labels.get("work"), "MINE")

    def test_open_on_a_crashed_tab_recovers_to_a_blank_page_before_its_init_scripts(self):
        self.state.current = "MINE"
        self.state.extras["attached"] = "USER"
        self.state.target_infos["MINE"] = {"targetId": "MINE", "url": "https://mine.example/"}
        self.mine.crashed = True
        steps = []

        async def navigate(ctx, page, url, *args):
            steps.append(("navigate", url))
            if url == "about:blank":
                page.crashed = False
                return
            raise Stop()

        async def apply_open_options(ctx, page):
            steps.append(("options", page.crashed))

        ctx = commands.Ctx(self.state, {"no_changes": True}, "/", {}, None, "open")
        with mock.patch.object(commands, "navigate", navigate), mock.patch.object(commands, "apply_open_options", apply_open_options), self.assertRaises(Stop):
            asyncio.run(commands.cmd_open(ctx, ["https://dest.example/", "--init-script", "window.hooked = 1"]))
        self.assertEqual(steps, [("navigate", "about:blank"), ("options", False), ("navigate", "https://dest.example/")])

    def test_each_off_screen_tab_of_a_session_is_remembered(self):
        from ardia_cli.browse import tabs

        other, fresh = FakePage("OTHER"), FakePage("FRESH")
        pages = {"MINE": self.mine, "OTHER": other, "FRESH": fresh}
        for page, url in ((self.mine, "https://mine.example/a"), (other, "https://mine.example/b"), (fresh, "https://mine.example/a")):
            page.url = url
            self.state.target_infos[page.target_id] = {"targetId": page.target_id, "url": url}
        self.state.opened.update(("MINE", "OTHER"))
        self.state.endpoint = mock.Mock(explicit=False)
        moved, sent, opened, closed = [], [], [], []

        async def page(target=None):
            return pages[target or self.state.current]

        async def app_tab_map(state):
            return {"MINE": "tab-a", "OTHER": "tab-b", "FRESH": "tab-fresh"}

        async def app_call(state, method, params, timeout=0):
            moved.append(params["tab"])
            return {"ok": True}

        async def page_send(method, params=None, **kwargs):
            sent.append(method)
            return {}

        async def new_tab(ctx, url, label=None, window=False, show=False):
            opened.append(url)
            self.state.current = "FRESH"
            return fresh

        async def browser_send(method, params=None, *args, **kwargs):
            if method == "Target.closeTarget":
                closed.append(params["targetId"])
            return {}

        for each in pages.values():
            each.send = page_send
        self.state.page = page
        self.state.browser = mock.Mock(send=browser_send)
        self.state.registry = mock.Mock(reserve_close=lambda instance, target: True, finish_close=lambda instance, target: None)
        run = lambda *argv: asyncio.run(commands.cmd_set(commands.Ctx(self.state, {}, "/", {}, None, "set"), list(argv)))
        patches = (mock.patch.object(tabs, "app_tab_map", app_tab_map), mock.patch.object(tabs, "app_call", app_call), mock.patch.object(commands, "new_tab", new_tab))
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

        self.state.current = "MINE"
        run("viewport", "390", "844")
        self.state.current = "OTHER"
        run("viewport", "400", "700")
        self.assertEqual(moved, ["tab-a", "tab-b"])
        self.assertEqual(self.state.extras["offscreen"], {"MINE", "OTHER"})

        self.state.current = "MINE"
        result = run("viewport", "reset")
        self.assertIn("reloaded in a new background tab", result.text)
        self.assertEqual((opened, closed), (["https://mine.example/a"], ["MINE"]))
        self.assertEqual(self.state.extras["offscreen"], {"OTHER"})
        self.assertIn("offscreen", self.state.leases)
        self.assertNotIn("Emulation.clearDeviceMetricsOverride", sent)

        run("viewport", "500", "600")
        self.assertEqual(moved, ["tab-a", "tab-b", "tab-fresh"])
        self.assertEqual(self.state.extras["offscreen"], {"OTHER", "FRESH"})

        self.state.forget_target("OTHER")
        self.assertEqual(self.state.extras["offscreen"], {"FRESH"})

    def test_the_off_screen_lease_follows_the_off_screen_tabs(self):
        self.state.set_offscreen("A", True)
        self.state.set_offscreen("B", True)
        self.assertIn("offscreen", self.state.leases)
        self.state.set_offscreen("A", False)
        self.assertIn("offscreen", self.state.leases)
        self.state.forget_target("B")
        self.assertNotIn("offscreen", self.state.leases)
        self.assertEqual(self.state.offscreen, set())

    def ordinary_and_off_screen(self, engine_says_off_screen):
        self.state.current = "MINE"
        self.state.extras.pop("attached", None)
        self.state.target_infos["MINE"] = {"targetId": "MINE", "url": "https://mine.example/a"}
        self.mine.url = "https://mine.example/a"
        self.state.endpoint = mock.Mock(explicit=False)
        sent, browser_calls, opened = [], [], []

        async def page_send(method, params=None, **kwargs):
            sent.append(method)
            return {}

        async def browser_send(method, params=None, *args, **kwargs):
            browser_calls.append(method)
            if method == "Target.getTargetInfo":
                return {"targetInfo": {"targetId": params["targetId"], **({"ardiaOffscreen": True} if engine_says_off_screen else {})}}
            return {}

        async def new_tab(ctx, url, label=None, window=False, show=False):
            opened.append(url)
            self.state.current = "FRESH"
            return FakePage("FRESH")

        self.mine.send = page_send
        self.state.browser = mock.Mock(send=browser_send)
        self.state.registry = mock.Mock(reserve_close=lambda instance, target: True, finish_close=lambda instance, target: None)
        patch = mock.patch.object(commands, "new_tab", new_tab)
        patch.start()
        self.addCleanup(patch.stop)
        return sent, browser_calls, opened

    def test_resetting_an_ordinary_tab_keeps_the_off_screen_lease(self):
        sent, _, opened = self.ordinary_and_off_screen(False)
        self.state.set_offscreen("OTHER", True)
        self.state.leases.add("emulation")
        result = asyncio.run(commands.cmd_set(commands.Ctx(self.state, {}, "/", {}, None, "set"), ["viewport", "reset"]))
        self.assertEqual(result.text, "✓ Viewport reset")
        self.assertEqual((sent, opened), (["Emulation.clearDeviceMetricsOverride"], []))
        self.assertNotIn("emulation", self.state.leases)
        self.assertIn("offscreen", self.state.leases)

    def test_reset_asks_the_engine_whether_a_tab_another_session_left_is_off_screen(self):
        sent, browser_calls, opened = self.ordinary_and_off_screen(True)
        result = asyncio.run(commands.cmd_set(commands.Ctx(self.state, {}, "/", {}, None, "set"), ["viewport", "reset"]))
        self.assertIn("reloaded in a new background tab", result.text)
        self.assertEqual(opened, ["https://mine.example/a"])
        self.assertEqual(browser_calls, ["Target.getTargetInfo", "Target.closeTarget"])
        self.assertNotIn("Emulation.clearDeviceMetricsOverride", sent)
        self.assertEqual(self.state.offscreen, set())
        self.assertNotIn("offscreen", self.state.leases)

    def test_cookie_changes_refuse_a_borrowed_tab(self):
        self.refused(commands.cmd_cookies, ["clear"])
        self.refused(commands.cmd_cookies, ["set", "a", "b"])
        self.refused(commands.cmd_cookies, ["set", "--curl", "cookies.txt"])

    def test_settings_state_load_init_scripts_and_routes_refuse_a_borrowed_tab(self):
        from ardia_cli.browse import capture

        for argv in (["credentials", "u", "p"], ["headers", "{}"], ["offline", "on"], ["viewport", "800", "600"], ["geo", "1", "2"]):
            self.refused(commands.cmd_set, argv)
        self.refused(commands.cmd_state, ["load", "/tmp/state.json"])
        self.refused(commands.cmd_addinitscript, ["window.x = 1"])
        self.refused(capture.network_route, ["*/api/*", "--abort"])

    def test_auth_login_never_types_into_a_borrowed_tab_even_on_its_origin(self):
        meta = {"url": "https://user.example/login", "origins": ["https://user.example"]}
        with mock.patch.object(vault, "load_meta", lambda root, name: meta), mock.patch.object(vault, "read_secret", lambda name, utf8: "pw"):
            self.assertEqual(self.run_command(vault.login, ["work"]), [("MINE", "https://user.example/login")])

    def test_storage_clear_works_once_the_tab_is_picked(self):
        self.state.extras.pop("attached")
        result = asyncio.run(commands.cmd_storage(commands.Ctx(self.state, {}, "/", {}, None, "storage"), ["local", "clear"]))
        self.assertEqual(result.text, "✓ Storage cleared")

    def test_a_tab_picked_on_purpose_is_driven(self):
        self.state.extras.pop("attached")
        self.assertEqual(self.run_command(commands.cmd_vitals, ["example.com"]), [("USER", "https://example.com")])

    def test_script_goto_goes_through_open(self):
        self.assertIn('goto: async (url) => (await browse("open"', script.PRELUDE if hasattr(script, "PRELUDE") else Path(script.__file__).read_text())


if __name__ == "__main__":
    unittest.main()
