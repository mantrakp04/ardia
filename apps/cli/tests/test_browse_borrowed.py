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

        async def taken(method, params=None, **kwargs):
            raise Gated(method, reason="on a tab the user can see")

        self.mine.send = taken
        command_metrics.begin(request)
        with self.assertRaises(Gated):
            asyncio.run(commands.cmd_set(commands.Ctx(self.state, {}, "/", {}, None, "set"), ["viewport", "390", "844"]))
        self.assertTrue(command_metrics.answer_fields(request)["metrics"]["viewport_tab_taken"])

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
