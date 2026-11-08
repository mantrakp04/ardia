import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli.browse import actions, commands, daemon
from ardia_cli.browse.errors import BrowseError, Gated
from tests.test_browse_review import make_daemon


def run(coro):
    return asyncio.run(coro)


class CommandsAreBounded(unittest.TestCase):
    def test_limits_follow_the_command(self):
        self.assertEqual(daemon.command_limit("select", ["#guests", "a", "b"], 25), daemon.COMMAND_LIMIT)
        self.assertEqual(daemon.command_limit("batch", [], 25), 600)
        self.assertEqual(daemon.command_limit("script", ["--timeout", "5m"], 25), 300 + daemon.LIMIT_MARGIN)
        self.assertEqual(daemon.command_limit("script", [], 25), daemon.SCRIPT_DEFAULT + daemon.LIMIT_MARGIN)
        self.assertEqual(daemon.command_limit("wait", ["400000"], 25), 400 + daemon.LIMIT_MARGIN)
        self.assertEqual(daemon.command_limit("wait", ["--text", "x", "--timeout", "180000"], 25), 180 + daemon.LIMIT_MARGIN)

    def test_a_hung_command_is_stopped_and_frees_the_session(self):
        instance = make_daemon(self)
        started = asyncio.Event()

        async def hanging(ctx, name, argv):
            if name == "select":
                started.set()
                await asyncio.sleep(3600)
            return commands.Result({}, "✓ snapshot")

        async def scenario():
            with mock.patch.object(daemon, "dispatch", hanging), mock.patch.object(daemon, "command_limit", lambda name, argv, timeout: 0.3):
                hung = asyncio.ensure_future(instance.execute({"argv": ["select", "#g", "a"], "options": {}}))
                await started.wait()
                queued = await instance.execute({"argv": ["snapshot"], "options": {}})
                return await hung, queued

        (code, out, err), queued = run(scenario())
        self.assertEqual(code, 1)
        self.assertIn("`select` didn't finish within 0.3 s and was stopped, so its outcome is unknown", err)
        self.assertEqual(queued[:2], (0, "✓ snapshot\n"))
        self.assertFalse(instance.lock.locked())

    def test_a_queued_command_gives_up_with_output_instead_of_waiting_forever(self):
        instance = make_daemon(self)
        started = asyncio.Event()

        async def slow(ctx, name, argv):
            started.set()
            await asyncio.sleep(1)
            return commands.Result()

        async def scenario():
            with mock.patch.object(daemon, "dispatch", slow), mock.patch.object(daemon, "QUEUE_WAIT", 0.2):
                running = asyncio.ensure_future(instance.execute({"argv": ["select", "#g", "a"], "options": {}}))
                await started.wait()
                waited = await instance.execute({"argv": ["tab", "list"], "options": {}})
                await running
                return waited

        code, _, err = run(scenario())
        self.assertEqual(code, 1)
        self.assertIn("This session is still running `select`", err)


class Element(SimpleNamespace):
    pass


class ViewportPage:
    def __init__(self, sizes, gated=False):
        self.sizes = list(sizes)
        self.sent = []
        self.gated = gated
        self.target_id = "T"
        self.main_frame = "F"
        self.state = SimpleNamespace(leases=set(), tab_id=lambda target: "t4")

    async def call(self, function, *args, **kwargs):
        size = self.sizes[0] if len(self.sizes) == 1 else self.sizes.pop(0)
        return {"width": size, "height": size}

    async def send(self, method, params=None, **kwargs):
        self.sent.append(method)
        if self.gated and method.startswith("Emulation."):
            raise Gated(method)
        if method == "Emulation.setDeviceMetricsOverride":
            self.sizes = [800]
        return {}


class ZeroViewport(unittest.TestCase):
    def test_a_tab_that_lays_out_soon_is_waited_for(self):
        page = ViewportPage([0, 0, 900])
        run(actions.laid_out(page))
        self.assertEqual(page.sent, [])

    def test_a_tab_with_no_size_gets_a_temporary_viewport_that_is_cleared_after(self):
        page = ViewportPage([0])
        with mock.patch.object(actions, "LAYOUT_WAIT", 0.2):
            run(actions.laid_out(page))
        self.assertEqual(page.sent, ["Emulation.setDeviceMetricsOverride"])
        run(actions.restore_metrics(page))
        self.assertEqual(page.sent[-1], "Emulation.clearDeviceMetricsOverride")
        run(actions.restore_metrics(page))
        self.assertEqual(page.sent.count("Emulation.clearDeviceMetricsOverride"), 1)

    def test_without_emulation_it_says_the_tab_has_no_size(self):
        page = ViewportPage([0], gated=True)
        with mock.patch.object(actions, "LAYOUT_WAIT", 0.2), self.assertRaises(BrowseError) as caught:
            run(actions.laid_out(page))
        self.assertEqual(caught.exception.code, "no_viewport")
        self.assertIn("no size yet (0×0", caught.exception.message)
        self.assertIn("ardia browse tab t4 --show", caught.exception.message)

    def test_a_viewport_the_session_set_itself_is_left_alone(self):
        page = ViewportPage([0], gated=False)
        page.state.leases.add("emulation")
        with mock.patch.object(actions, "LAYOUT_WAIT", 0.2), self.assertRaises(BrowseError):
            run(actions.laid_out(page))
        self.assertEqual(page.sent, [])


class TextareaFill(unittest.TestCase):
    def fill(self, tag):
        sent = []

        class Page:
            def loader(self, frame):
                return "L"

            async def call(self, function, *args, **kwargs):
                if "ardiaBrowse.info" in function:
                    return {"tag": tag, "type": "text" if tag == "input" else None, "editable": True, "disabled": False, "value": ""}
                return True

        async def nothing(*args, **kwargs):
            return None

        async def settle(page, element, loader):
            return element, False

        async def insert(page, element, text):
            sent.append(("insert", text))

        async def typed(page, element, text, humanize, guard=None):
            sent.append(("type", text))

        with mock.patch.multiple(actions, focus_field=nothing, settle_focus=settle, clear_field=nothing, insert_text=insert, type_into=typed):
            run(actions.fill(Page(), Element(frame="F", label="@e3"), "line one\nline two", False))
        return sent

    def test_a_textarea_gets_its_text_in_one_insert_and_an_input_is_typed(self):
        self.assertEqual(self.fill("textarea"), [("insert", "line one\nline two")])
        self.assertEqual(self.fill("div"), [("insert", "line one\nline two")])
        self.assertEqual(self.fill("input"), [("type", "line one\nline two")])


if __name__ == "__main__":
    unittest.main()
