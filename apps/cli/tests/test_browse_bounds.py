import asyncio
import socket
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import telemetry
from ardia_cli.browse import actions, client, commands, daemon, limits
from ardia_cli.browse.errors import BrowseError, Gated, OutcomeUnknown, Unreachable
from tests.test_browse_review import make_daemon


def run(coro):
    return asyncio.run(coro)


class CommandsAreBounded(unittest.TestCase):
    def test_limits_follow_the_command(self):
        self.assertEqual(limits.command_limit("select", ["#guests", "a", "b"], 25), limits.COMMAND_LIMIT)
        self.assertEqual(limits.command_limit("batch", [], 25), 600)
        self.assertEqual(limits.command_limit("script", ["--timeout", "5m"], 25), 300 + limits.LIMIT_MARGIN)
        self.assertEqual(limits.command_limit("script", [], 25), limits.SCRIPT_DEFAULT + limits.LIMIT_MARGIN)
        self.assertEqual(limits.command_limit("wait", ["400000"], 25), 400 + limits.LIMIT_MARGIN)
        self.assertEqual(limits.command_limit("wait", ["--text", "x", "--timeout", "180000"], 25), 180 + limits.LIMIT_MARGIN)

    def test_the_client_waits_past_the_daemons_own_limits(self):
        self.assertEqual(limits.answer_deadline({"argv": ["click", "@e1"], "options": {}}),
                         limits.QUEUE_WAIT + limits.COMMAND_LIMIT + limits.LIMIT_MARGIN)
        self.assertEqual(limits.answer_deadline({"argv": ["wait", "400000"], "options": {}}),
                         limits.QUEUE_WAIT + 400 + 2 * limits.LIMIT_MARGIN)
        self.assertEqual(limits.answer_deadline({"argv": ["wait", "--text", "x"], "options": {"timeout_ms": 200000}}),
                         limits.QUEUE_WAIT + 200 + 2 * limits.LIMIT_MARGIN)
        self.assertEqual(limits.answer_deadline({"argv": [], "options": {}}),
                         limits.QUEUE_WAIT + limits.COMMAND_LIMIT + limits.LIMIT_MARGIN)

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


class SilentDaemon(unittest.TestCase):
    def ask(self, argv):
        ours, daemon_end = socket.socketpair()
        self.addCleanup(daemon_end.close)
        metrics = {}
        with mock.patch.object(limits, "answer_deadline", return_value=0.2), \
                mock.patch.object(telemetry, "note_count", lambda key, value: metrics.update({key: value})):
            started = time.monotonic()
            with self.assertRaises(BrowseError) as caught:
                client.request(ours, {"argv": argv, "options": {}})
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(metrics, {"daemon_answer_timed_out": True})
        return caught.exception

    def test_a_read_that_gets_no_answer_is_unreachable(self):
        error = self.ask(["snapshot"])
        self.assertIsInstance(error, Unreachable)
        self.assertIn("didn't answer in 0.2 s", error.message)

    def test_an_action_that_gets_no_answer_has_an_unknown_outcome(self):
        error = self.ask(["click", "@e1"])
        self.assertIsInstance(error, OutcomeUnknown)
        self.assertEqual(error.code, "outcome_unknown")


if __name__ == "__main__":
    unittest.main()
