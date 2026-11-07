import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli.browse import actions, commands, inputs
from ardia_cli.browse.errors import BrowseError, CdpError, Gated, OutcomeUnknown
from ardia_cli.browse.page import Element

QUADS = {1: [10, 10, 110, 10, 110, 40, 10, 40], 2: [10, 200, 110, 200, 110, 230, 10, 230]}


class FakeRenderer:
    def __init__(self, draggable=True, starts_drag=True, refused=(), failing=()):
        self.main_frame = "F"
        self.frames = {"F": {"loader": "L"}}
        self.sent = []
        self.counts = {"mousedown": 0, "mouseup": 0, "mousemove": 0, "dragstart": 0, "dragend": 0, "drop": 0}
        self.draggable = draggable
        self.starts_drag = starts_drag
        self.refused = set(refused)
        self.failing = set(failing)
        self.drag_intercepted = None
        self.dragging = False
        self.input = inputs.Input(self)
        mouse = inputs.human_mouse_class()(self)
        mouse._position = (300.0, 300.0)
        self.input.mouse = mouse

    def loader(self, frame):
        return self.frames.get(frame, {}).get("loader")

    async def refresh_frames(self):
        return self.frames

    async def require_visible(self):
        return None

    async def call(self, function, *args, frame=None, **kwargs):
        if "inputWatch" in function:
            return dict(self.counts, activeFrame=False)
        if "draggable" in function:
            return self.draggable
        if "ardiaBrowse.info" in function:
            return {"connected": True}
        if "ardiaBrowse.rect" in function:
            quad = QUADS[args[0].backend_id]
            return {"x": quad[0], "y": quad[1], "width": quad[2] - quad[0], "height": quad[5] - quad[1]}
        if "ardiaBrowse.viewport" in function:
            return {"width": 1280, "height": 800, "scrollX": 0, "scrollY": 0, "docWidth": 1280, "docHeight": 800}
        return None

    async def execute_command(self, command, timeout=60):
        await self.send(command["method"], command.get("params"))
        return {}

    async def execute_command_nowait(self, command):
        await self.send(command["method"], command.get("params"))

    async def send(self, method, params=None, input_event=False, timeout=30, mutation=False):
        params = dict(params or {})
        kind = params.get("type")
        if (method, kind) in self.failing or (method, params.get("enabled")) in self.failing:
            raise CdpError(method, "boom")
        if method in self.refused:
            raise Gated(method)
        self.sent.append((method, kind if kind is not None else params.get("enabled")))
        if method == "DOM.getContentQuads":
            return {"quads": [QUADS[params["backendNodeId"]]]}
        if method == "Input.dispatchMouseEvent":
            if kind == "mousePressed":
                self.counts["mousedown"] += 1
            elif kind == "mouseMoved" and params.get("buttons") and not self.dragging:
                if self.draggable and self.starts_drag:
                    self.dragging = True
                    self.counts["dragstart"] += 1
                    if self.drag_intercepted is not None and not self.drag_intercepted.done():
                        self.drag_intercepted.set_result({"items": [{"mimeType": "text/plain", "data": "a"}], "dragOperationsMask": 16})
            elif kind == "mouseReleased" and not self.dragging:
                self.counts["mouseup"] += 1
        if method == "Input.dispatchDragEvent" and kind in ("drop", "dragCancel"):
            self.dragging = False
            self.counts["dragend"] += 1
            if kind == "drop":
                self.counts["drop"] += 1
        return {}

    def calls(self):
        return [entry for entry in self.sent if entry[0].startswith("Input.")]


def ends(page):
    return Element("F", "S", 1, "@e1"), Element("F", "T", 2, "@e2")


class HtmlDragTest(unittest.TestCase):
    def test_draggable_source_goes_through_interception_in_order(self):
        page = FakeRenderer()
        outcome = asyncio.run(actions.drag(page, *ends(page), False))
        self.assertEqual(outcome, {"html5": True, "started": True, "dropped": True})
        self.assertEqual(page.calls(), [
            ("Input.setInterceptDrags", True),
            ("Input.dispatchMouseEvent", "mouseMoved"),
            ("Input.dispatchMouseEvent", "mousePressed"),
            ("Input.dispatchMouseEvent", "mouseMoved"),
            ("Input.dispatchDragEvent", "dragEnter"),
            ("Input.dispatchDragEvent", "dragOver"),
            ("Input.dispatchDragEvent", "drop"),
            ("Input.dispatchMouseEvent", "mouseReleased"),
            ("Input.setInterceptDrags", False),
        ])
        self.assertIsNone(page.drag_intercepted)
        self.assertIsNone(page.input.mouse.interception)
        self.assertFalse(page.input.holding)

    def test_humanized_drag_keeps_a_curved_path_of_drag_overs(self):
        page = FakeRenderer()
        outcome = asyncio.run(actions.drag(page, *ends(page), True))
        self.assertTrue(outcome["dropped"])
        kinds = [kind for _, kind in page.calls()]
        self.assertEqual(kinds[0], True)
        self.assertEqual(kinds[-1], False)
        self.assertGreater(kinds.count("dragOver"), 3)
        self.assertEqual(kinds.count("drop"), 1)
        self.assertLess(kinds.index("dragEnter"), kinds.index("drop"))
        self.assertLess(kinds.index("drop"), kinds.index("mouseReleased"))

    def test_refused_interception_fails_before_any_input(self):
        page = FakeRenderer(refused={"Input.setInterceptDrags"})
        with self.assertRaises(Gated) as caught:
            asyncio.run(actions.drag(page, *ends(page), False))
        self.assertEqual(caught.exception.method, "Input.setInterceptDrags")
        self.assertIn("HTML5 draggable", caught.exception.message)
        self.assertEqual(page.calls(), [])
        self.assertIsNone(page.drag_intercepted)

    def test_failure_after_interception_cancels_releases_then_disables(self):
        page = FakeRenderer(failing={("Input.dispatchDragEvent", "dragOver")})
        with self.assertRaises(OutcomeUnknown):
            asyncio.run(actions.drag(page, *ends(page), False))
        kinds = [kind for _, kind in page.calls()]
        self.assertNotIn("drop", kinds)
        self.assertLess(kinds.index("dragCancel"), kinds.index("mouseReleased"))
        self.assertEqual(kinds[-1], False)
        self.assertFalse(page.input.holding)

    def test_cancelled_drag_still_cleans_up(self):
        page = FakeRenderer()

        async def scenario():
            task = asyncio.ensure_future(actions.drag(page, *ends(page), True))
            for _ in range(500):
                if page.dragging:
                    break
                await asyncio.sleep(0.01)
            self.assertTrue(page.dragging)
            await asyncio.sleep(0.05)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            await asyncio.sleep(0.2)

        asyncio.run(scenario())
        kinds = [kind for _, kind in page.calls()]
        self.assertNotIn("drop", kinds)
        self.assertIn("dragCancel", kinds)
        self.assertEqual(kinds[-1], False)
        self.assertFalse(page.input.holding)

    def test_drag_the_page_refuses_to_start_stays_a_mouse_drag(self):
        page = FakeRenderer(starts_drag=False)
        outcome = asyncio.run(actions.drag(page, *ends(page), False))
        self.assertEqual(outcome, {"html5": True, "started": False, "dropped": False})
        kinds = [kind for _, kind in page.calls()]
        self.assertNotIn("dragEnter", kinds)
        self.assertEqual(kinds[-2:], ["mouseReleased", False])

    def test_interception_that_cannot_be_turned_off_is_reported(self):
        page = FakeRenderer(failing={("Input.setInterceptDrags", False)})
        outcome = asyncio.run(actions.drag(page, *ends(page), False))
        self.assertTrue(outcome["interceptionLeftOn"])
        self.assertIn("didn't confirm drag interception was turned off", commands.drag_text(outcome))

    def test_plain_source_never_touches_interception(self):
        page = FakeRenderer(draggable=False)
        outcome = asyncio.run(actions.drag(page, *ends(page), False))
        self.assertEqual(outcome, {"html5": False})
        methods = {method for method, _ in page.calls()}
        self.assertEqual(methods, {"Input.dispatchMouseEvent"})

    def test_hidden_tab_is_refused_and_interception_turned_off(self):
        page = FakeRenderer()

        async def hidden():
            raise BrowseError("hidden", code="tab_hidden")

        page.require_visible = hidden
        with self.assertRaises(BrowseError) as caught:
            asyncio.run(actions.drag(page, *ends(page), False))
        self.assertEqual(caught.exception.code, "tab_hidden")
        self.assertEqual(page.calls(), [("Input.setInterceptDrags", True), ("Input.setInterceptDrags", False)])

    def test_drag_text_says_what_happened(self):
        self.assertEqual(commands.drag_text({"html5": False}), "✓ Done")
        self.assertIn("plain mouse drag", commands.drag_text({"html5": True, "started": False, "dropped": False}))
        self.assertIn("didn't accept the drop", commands.drag_text({"html5": True, "started": True, "dropped": False}))
        self.assertEqual(commands.drag_text({"html5": True, "started": True, "dropped": True}), "✓ Done (HTML5 drag and drop)")


class BackgroundTabTest(unittest.TestCase):
    def make_page(self, flips_after=None):
        from ardia_cli.browse.page import Page

        state = type("S", (), {"background_live": None, "tab_ids": {}, "sessions": {}})()
        state.tab_id = lambda target: "t3"
        page = Page(state, "T")
        seen = {"checks": 0}

        async def hidden():
            seen["checks"] += 1
            return flips_after is None or seen["checks"] <= flips_after

        page.hidden = hidden
        return page, state

    def test_engine_that_keeps_attached_tabs_live_is_detected(self):
        page, state = self.make_page(flips_after=2)
        self.assertTrue(asyncio.run(page.takes_input()))
        self.assertTrue(state.background_live)
        asyncio.run(page.require_visible())

    def test_old_engine_refuses_with_the_exact_hint_and_stops_waiting(self):
        page, state = self.make_page()
        with mock.patch("ardia_cli.browse.page.LIVE_WAIT", 0.15):
            with self.assertRaises(BrowseError) as caught:
                asyncio.run(page.require_visible())
        self.assertFalse(state.background_live)
        self.assertEqual(caught.exception.code, "tab_hidden")
        self.assertIn("use: ardia browse tab t3 --show (or open <url> --show)", caught.exception.message)
        self.assertEqual(caught.exception.data["use"], "ardia browse tab t3 --show")

        async def timed():
            loop = asyncio.get_running_loop()
            started = loop.time()
            self.assertFalse(await page.takes_input())
            return loop.time() - started

        self.assertLess(asyncio.run(timed()), 0.05)


if __name__ == "__main__":
    unittest.main()
