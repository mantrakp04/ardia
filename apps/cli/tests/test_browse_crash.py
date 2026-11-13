import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli.browse.errors import BrowseError
from ardia_cli.browse.state import State


class FakeBrowser:
    def __init__(self, state):
        self.state = state
        self.crashed = True
        self.sent = []
        self.link = mock.Mock()

    async def send(self, method, params=None, session=None, timeout=30):
        self.sent.append(method)
        if method == "Target.attachToTarget":
            return {"sessionId": "S"}
        if method == "Inspector.enable" and self.crashed:
            self.state.on_event("Inspector.targetCrashed", {}, session)
            await asyncio.sleep(0)
            return {}
        if method == "Page.getFrameTree":
            return {"frameTree": {"frame": {"id": "F", "url": "https://mine.example/", "loaderId": "L", "securityOrigin": "https://mine.example"}}}
        if method == "Page.getLayoutMetrics":
            return {"cssVisualViewport": {"clientWidth": 800, "clientHeight": 600}}
        return {}


class CrashedTab(unittest.TestCase):
    def setUp(self):
        self.state = State({"session": "t", "data_root": "/nowhere"}, lambda: None)
        self.state.instance = "I"
        self.state.target_infos = {"T": {"targetId": "T", "url": "https://mine.example/", "type": "page"}}
        self.browser = FakeBrowser(self.state)
        self.state.browser = self.browser

        async def connect():
            return None

        self.state.connect = connect

    def test_a_tab_that_crashed_before_the_session_attached_waits_for_a_reload_then_enables_its_page(self):
        async def run():
            page = await self.state.page("T")
            self.assertTrue(page.crashed)
            self.assertTrue(page.needs_enable)
            self.assertEqual(self.browser.sent, ["Target.attachToTarget", "Inspector.enable"])
            with self.assertRaises(BrowseError) as refused:
                await page.send("Runtime.evaluate", {"expression": "1"})
            self.assertEqual(refused.exception.code, "tab_crashed")
            await self.state.page("T")
            self.assertNotIn("Page.enable", self.browser.sent)

            self.browser.crashed = False
            self.state.on_event("Inspector.targetReloadedAfterCrash", {}, "S")
            self.assertFalse(page.crashed)
            again = await self.state.page("T")
            self.assertIs(again, page)
            self.assertFalse(page.needs_enable)
            self.assertIn("Page.enable", self.browser.sent)
            self.assertIn("Page.setLifecycleEventsEnabled", self.browser.sent)
            self.assertEqual(page.main_frame, "F")

        asyncio.run(run())

    def test_a_crash_while_attached_fails_the_waiting_calls_as_crashed(self):
        async def run():
            self.browser.crashed = False
            page = await self.state.page("T")
            self.assertFalse(page.crashed)

            async def hang(method, params=None, session=None, timeout=30):
                await asyncio.sleep(30)

            self.browser.send = hang
            waiting = asyncio.ensure_future(page.send("Runtime.evaluate", {"expression": "1"}))
            await asyncio.sleep(0)
            self.state.on_event("Inspector.targetCrashed", {}, "S")
            with self.assertRaises(BrowseError) as failed:
                await waiting
            self.assertEqual(failed.exception.code, "tab_crashed")
            self.assertEqual(page.session_id, "S")

        asyncio.run(run())

    def test_a_page_setup_cut_short_by_a_second_crash_is_retried_after_the_next_reload(self):
        async def run():
            page = await self.state.page("T")
            self.assertTrue(page.needs_enable)
            self.browser.crashed = False
            self.state.on_event("Inspector.targetReloadedAfterCrash", {}, "S")
            healthy_send = self.browser.send

            async def crash_during_enable(method, params=None, session=None, timeout=30):
                if method == "Page.enable":
                    raise BrowseError("The tab's page crashed", code="tab_crashed")
                return await healthy_send(method, params, session, timeout)

            self.browser.send = crash_during_enable
            with self.assertRaises(BrowseError):
                await self.state.page("T")
            self.assertTrue(page.needs_enable)

            self.browser.send = healthy_send
            await self.state.page("T")
            self.assertFalse(page.needs_enable)
            self.assertEqual(page.main_frame, "F")

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
