import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from ardia_cli import command_metrics
from ardia_cli.browse import commands, daemon, script
from ardia_cli.browse.errors import BrowseError
from test_browse_pages import FakeController, run, scratch_registry

WORKER_UNDER_NODE = r"""
const vm = require("vm");
const posted = [];
globalThis.self = globalThis;
globalThis.postMessage = (message) => {
  posted.push(message);
  if (message.type === "request") {
    const answers = JSON.parse(process.argv[2]);
    setImmediate(() => onmessage({ data: { type: "reply", id: message.request.id, answer: answers[message.request.argv[0]] } }));
  }
  if (message.type === "done") process.stdout.write(JSON.stringify(posted));
};
vm.runInThisContext(process.argv[1]);
"""


def run_worker(source: str, answers: dict) -> list:
    code, _ = script.worker_source(source)
    done = subprocess.run(["node", "-e", WORKER_UNDER_NODE, code, json.dumps(answers)], capture_output=True, text=True, timeout=30)
    if done.returncode:
        raise AssertionError(done.stderr)
    return json.loads(done.stdout)


@unittest.skipUnless(shutil.which("node"), "needs node to run the script's worker")
class WorkerApi(unittest.TestCase):
    def test_page_eval_is_page_evaluate_and_says_it_came_through_the_alias(self):
        posted = run_worker("return [await page.eval((x) => x + 1, 2), await page.evaluate('document.title')];",
                            {"eval": {"ok": True, "data": {"result": 3}}})
        requests = [message["request"] for message in posted if message["type"] == "request"]
        self.assertEqual([request["argv"] for request in requests], [["eval", "((x) => x + 1)(2)"], ["eval", "document.title"]])
        self.assertEqual([request["via"] for request in requests], ["page.eval", "page.evaluate"])
        self.assertEqual(posted[-1]["result"], {"kind": "done", "value": [3, 3]})

    def test_focus_keyboard_and_dblclick_are_commands(self):
        posted = run_worker("await page.focus('#q'); await page.keyboard('SFO'); await page.dblclick('#c'); return 1;",
                            {name: {"ok": True, "text": "✓"} for name in ("focus", "keyboard", "dblclick")})
        self.assertEqual([message["request"]["argv"] for message in posted if message["type"] == "request"],
                         [["focus", "#q"], ["keyboard", "type", "SFO"], ["dblclick", "#c"]])

    def test_document_outside_the_page_is_a_reference_error_with_its_line(self):
        posted = run_worker("const a = 1;\nreturn document.title;", {})
        result = posted[-1]["result"]
        self.assertEqual((result["kind"], result["name"], result["message"], result["line"]),
                         ("error", "ReferenceError", "document is not defined", 2))


class Hints(unittest.TestCase):
    def setUp(self):
        self.metrics = command_metrics.Metrics("script", False, True)
        token = command_metrics.current.set(self.metrics)
        self.addCleanup(command_metrics.current.reset, token)

    def run_script(self, replies, source="page.goto('x')"):
        controller = FakeController(replies)
        state = SimpleNamespace(connected=True, pages={}, instance="I", registry=scratch_registry(), target_infos={}, extras={})

        async def connect():
            return None

        async def open_controller(state, owned):
            owned.append(controller.target_id)
            return controller

        async def fake_dispatch(ctx, name, argv):
            return commands.Result({"result": 3}, "3")

        state.connect = connect
        state.forget_target = lambda target_id: None
        state.browser = SimpleNamespace(send=mock.AsyncMock(return_value={}))
        ctx = commands.Ctx(state, {}, "/", {}, source, "script")
        with mock.patch.object(script, "open_controller", open_controller), mock.patch.object(daemon, "dispatch", fake_dispatch):
            try:
                return run(script.run(ctx, source, 5))
            except BrowseError as error:
                return error

    def test_document_or_window_in_the_script_points_at_page_evaluate(self):
        for name in ("document", "window", "localStorage"):
            error = self.run_script([{"kind": "error", "message": f"{name} is not defined", "name": "ReferenceError", "line": 1, "logs": []}])
            self.assertEqual(error.message, f"line 1: ReferenceError: {name} is not defined\nthe script runs outside the page, so it has no "
                                            "document or window: put page code in page.evaluate(() => …), or use `ardia browse eval`")
        self.assertTrue(self.metrics.values["script_page_world_hint"])

    def test_a_script_variable_inside_page_evaluate_says_to_pass_it(self):
        error = self.run_script([{"kind": "error", "message": "Evaluation error: ReferenceError: sel is not defined\n    at <anonymous>:1:31",
                                  "name": "Error", "line": 2, "logs": [], "command": ["eval", "(() => document.querySelector(sel))()"]}])
        self.assertTrue(error.message.endswith("\npage.evaluate(fn) runs fn inside the page, where the script's own variables don't exist: "
                                               "pass sel as its argument, page.evaluate((sel) => …, sel)"), error.message)

    def test_other_errors_get_no_hint(self):
        for reply in (
            {"kind": "error", "message": "x is not defined", "name": "ReferenceError", "line": 1, "logs": []},
            {"kind": "error", "message": "ReferenceError: sel is not defined", "name": "Error", "line": 1, "logs": [], "command": ["click", "#a"]},
            {"kind": "error", "message": "Element not found: #nope", "name": "Error", "line": 1, "logs": [], "command": ["click", "#nope"]},
        ):
            error = self.run_script([reply])
            self.assertNotIn("page.evaluate", error.message)
        self.assertNotIn("script_page_world_hint", self.metrics.values)

    def test_the_eval_alias_is_counted(self):
        self.run_script([
            {"kind": "request", "type": "call", "id": 1, "argv": ["eval", "1"], "via": "page.evaluate", "line": 1},
            {"kind": "done", "value": 3, "logs": []},
        ])
        self.assertNotIn("script_eval_alias", self.metrics.values)
        self.run_script([
            {"kind": "request", "type": "call", "id": 1, "argv": ["eval", "1"], "via": "page.eval", "line": 1},
            {"kind": "done", "value": 3, "logs": []},
        ])
        self.assertTrue(self.metrics.values["script_eval_alias"])
        self.assertEqual(command_metrics.clean(self.metrics.values)["script_eval_alias"], True)


if __name__ == "__main__":
    unittest.main()
