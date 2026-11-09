import io
import json
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import telemetry
from tests.test_automation import Base

TREE = {
    "profiles": [{"id": "default", "name": "Personal"}],
    "windows": [{
        "id": "w-1", "kind": "normal", "focused": True, "profile": "default", "profileName": "Personal", "activeTab": "tab-1",
        "spaces": [{
            "profile": "default", "profileName": "Personal", "shown": True, "activeTab": "tab-1",
            "topApps": [{"type": "tab", "id": "tab-9", "url": "https://mail.example/", "title": "Mail", "pin": "tile", "active": False, "muted": False, "asleep": True}],
            "pinned": [],
            "tabs": [
                {"type": "group", "id": "g-1", "name": "Work", "label": "Work", "icon": "🚀", "color": "blue", "collapsed": False, "pinned": False, "parent": None, "items": [
                    {"type": "tab", "id": "tab-2", "url": "https://b.example/", "title": "B", "pin": None, "active": False, "muted": True, "asleep": False},
                    {"type": "group", "id": "g-2", "name": "", "label": "Docs", "icon": None, "color": "neutral", "collapsed": True, "pinned": False, "parent": "g-1", "items": [
                        {"type": "tab", "id": "tab-3", "url": "https://c.example/", "title": "C", "pin": None, "active": False, "muted": False, "asleep": False},
                    ]},
                ]},
                {"type": "tab", "id": "tab-1", "url": "https://a.example/", "title": "A", "pin": None, "active": True, "muted": False, "asleep": False},
            ],
        }],
    }],
}


class Workspace(Base):
    def serve_ops(self, reply=None):
        server = self.serve()
        server.replies["workspace"] = lambda params: {"result": TREE}

        def apply(params):
            if reply is not None:
                return reply(params)
            results = [{"op": op["op"], "tabs": ["tab-new"], **({"group": "g-new"} if op["op"].startswith("group.") else {})} for op in params["ops"]]
            return {"result": {"ok": True, "applied": len(results), "results": results, "tabs": [], "groups": [], "windows": []}}

        server.replies["apply"] = apply
        return server

    def sent(self, server):
        return [p["ops"] for m, p in server.requests if m == "apply"]

    def test_tree_flat_and_groups(self):
        server = self.serve_ops()
        status, out, _ = self.run_cli("tabs")
        self.assertEqual(status, 0)
        lines = out.splitlines()
        self.assertEqual(lines[0], "window w-1  normal, focused")
        self.assertIn("    Top Apps", lines)
        self.assertTrue(any('group g-1  "Work"  🚀 blue' in line for line in lines))
        self.assertTrue(any(line.startswith("            group g-2") and "collapsed" in line for line in lines))
        self.assertTrue(any(line.strip().startswith("* tab-1  A") for line in lines))
        status, out, _ = self.run_cli("tabs", "--json")
        self.assertEqual(json.loads(out), TREE)
        status, out, _ = self.run_cli("tabs", "--flat", "--json")
        flat = json.loads(out)
        self.assertEqual([t["id"] for t in flat], ["tab-9", "tab-2", "tab-3", "tab-1"])
        self.assertEqual(flat[2]["section"], "Tabs")
        status, out, _ = self.run_cli("groups", "--json")
        groups = json.loads(out)
        self.assertEqual([(g["id"], g["depth"], g["tabs"]) for g in groups], [("g-1", 0, ["tab-2", "tab-3"]), ("g-2", 1, ["tab-3"])])
        self.run_cli("tabs", "--window", "w-1", "--profile", "default")
        self.assertEqual([p for m, p in server.requests if m == "workspace"][-1], {"window": "w-1", "profile": "default"})

    def test_each_command_sends_one_operation(self):
        server = self.serve_ops()
        cases = [
            (["tabs", "open", "a.example", "https://b.example/", "--group", "g-1", "--activate"], {"op": "open", "urls": ["a.example", "https://b.example/"], "group": "g-1", "activate": True}),
            (["tabs", "open", "x.example", "--window", "w-1", "--pin", "row", "--before", "tab-1"], {"op": "open", "urls": ["x.example"], "window": "w-1", "pin": "row", "before": "tab-1"}),
            (["tabs", "move", "tab-1", "tab-2", "--group", "g-1"], {"op": "tab.move", "tabs": ["tab-1", "tab-2"], "group": "g-1"}),
            (["tabs", "move", "tab-3", "--top"], {"op": "tab.move", "tabs": ["tab-3"], "group": None}),
            (["tabs", "move", "tab-3", "--after", "g-1", "--profile", "work"], {"op": "tab.move", "tabs": ["tab-3"], "after": "g-1", "profile": "work"}),
            (["tabs", "pin", "tab-1", "--row"], {"op": "tab.pin", "tabs": ["tab-1"], "as": "row"}),
            (["tabs", "pin", "tab-1"], {"op": "tab.pin", "tabs": ["tab-1"]}),
            (["tabs", "unpin", "tab-1"], {"op": "tab.unpin", "tabs": ["tab-1"]}),
            (["tabs", "sleep", "tab-1", "tab-2"], {"op": "tab.sleep", "tabs": ["tab-1", "tab-2"]}),
            (["tabs", "wake", "tab-1"], {"op": "tab.wake", "tabs": ["tab-1"]}),
            (["tabs", "mute", "tab-1"], {"op": "tab.mute", "tabs": ["tab-1"]}),
            (["tabs", "unmute", "tab-1"], {"op": "tab.unmute", "tabs": ["tab-1"]}),
            (["tabs", "close", "tab-1"], {"op": "tab.close", "tabs": ["tab-1"]}),
            (["tabs", "activate", "tab-2"], {"op": "tab.activate", "tab": "tab-2"}),
            (["tabs", "rename", "tab-2", "Bee"], {"op": "tab.rename", "tab": "tab-2", "title": "Bee"}),
            (["tabs", "rename", "tab-2"], {"op": "tab.rename", "tab": "tab-2", "title": None}),
            (["tabs", "icon", "tab-2", "🔥"], {"op": "tab.icon", "tab": "tab-2", "icon": "🔥"}),
            (["groups", "create", "tab-1", "--name", "Work", "--icon", "🚀", "--color", "blue", "--collapsed", "--unpinned"], {"op": "group.create", "tabs": ["tab-1"], "name": "Work", "icon": "🚀", "color": "blue", "collapsed": True, "pinned": False}),
            (["groups", "create", "--parent", "g-1", "--url", "a.example", "--url", "b.example"], {"op": "group.create", "urls": ["a.example", "b.example"], "parent": "g-1"}),
            (["groups", "update", "g-1", "--collapse", "--reset-icon"], {"op": "group.update", "group": "g-1", "icon": None, "collapsed": True}),
            (["groups", "update", "g-1", "--expand", "--color", "none"], {"op": "group.update", "group": "g-1", "color": "none", "collapsed": False}),
            (["groups", "rename", "g-1", "Play"], {"op": "group.update", "group": "g-1", "name": "Play"}),
            (["groups", "move", "g-2", "--top", "--pin"], {"op": "group.move", "group": "g-2", "parent": None, "pinned": True}),
            (["groups", "move", "g-2", "--parent", "g-1", "--before", "tab-2"], {"op": "group.move", "group": "g-2", "parent": "g-1", "before": "tab-2"}),
            (["groups", "move", "g-2", "--window", "w-2"], {"op": "group.move", "group": "g-2", "window": "w-2"}),
            (["groups", "ungroup", "g-1"], {"op": "group.ungroup", "group": "g-1"}),
            (["groups", "close", "g-1"], {"op": "group.close", "group": "g-1"}),
            (["groups", "delete", "g-1"], {"op": "group.delete", "group": "g-1"}),
        ]
        for argv, op in cases:
            status, _, err = self.run_cli(*argv)
            self.assertEqual(status, 0, (argv, err))
            self.assertEqual(self.sent(server)[-1], [op], argv)

    def test_local_usage_errors_send_nothing(self):
        server = self.serve_ops()
        for argv in (["groups", "update", "g-1"], ["groups", "move", "g-1"], ["tabs", "pin", "t", "--row", "--tile"], ["groups", "update", "g-1", "--icon", "🚀", "--reset-icon"]):
            status, _, err = self.run_cli(*argv)
            self.assertEqual(status, 1, argv)
            self.assertTrue(err.startswith("ardia "), err)
        status, _, _ = self.run_cli("tabs", "move", "t", "--top", "--group", "g")
        self.assertEqual(status, 2)
        self.assertEqual(self.sent(server), [])

    def test_failures_and_partial_batches_exit_1(self):
        partial = {"result": {"ok": False, "applied": 1, "results": [{"op": "tab.mute", "tabs": ["tab-1"]}], "error": {"index": 1, "code": "no_window", "message": "Operation 1 (tab.move): There's no tab x the ardia command can use."}, "tabs": [], "groups": [], "windows": []}}
        self.serve_ops(lambda params: partial)
        with mock.patch.object(sys, "stdin", io.StringIO(json.dumps({"ops": [{"op": "tab.mute", "tabs": ["tab-1"]}, {"op": "tab.move", "tabs": ["x"], "group": None}]}))):
            status, out, err = self.run_cli("apply")
        self.assertEqual(status, 1)
        self.assertIn("muted tab-1", out)
        self.assertIn("There's no tab x", err)
        self.assertIn("1 of 2 operations ran", err)

    def test_method_errors_and_old_apps(self):
        server = self.serve_ops(lambda params: {"error": {"code": "refused", "message": "Operation 0: javascript: isn't a URL Ardia opens."}})
        status, _, err = self.run_cli("tabs", "open", "javascript:alert(1)")
        self.assertEqual(status, 1)
        self.assertIn("isn't a URL Ardia opens", err)
        server.replies.pop("workspace")
        status, _, err = self.run_cli("tabs")
        self.assertEqual(status, 1)
        self.assertIn("update Ardia", err)

    def test_dropped_after_send_may_have_run(self):
        self.serve_ops(lambda params: None)
        status, _, err = self.run_cli("groups", "ungroup", "g-1")
        self.assertEqual(status, 2)
        self.assertIn("may or may not have run", err)

    def test_apply_reads_a_list_or_ops_and_rejects_junk(self):
        server = self.serve_ops()
        ops = [{"op": "group.create", "urls": ["a.example"]}, {"op": "group.update", "group": "$0", "collapsed": True}]
        path = self.temp / "ops.json"
        path.write_text(json.dumps(ops))
        status, out, _ = self.run_cli("apply", str(path))
        self.assertEqual(status, 0)
        self.assertEqual(self.sent(server)[-1], ops)
        self.assertIn("created group g-new with 1 tab", out)
        with mock.patch.object(sys, "stdin", io.StringIO("{nope")):
            status, _, err = self.run_cli("apply", "-")
        self.assertEqual((status, "isn't JSON" in err), (1, True))
        with mock.patch.object(sys, "stdin", io.StringIO("{}")):
            status, _, _ = self.run_cli("apply")
        self.assertEqual(status, 1)
        self.assertEqual(len(self.sent(server)), 1)

    def test_telemetry_counts_steps_and_codes(self):
        self.serve_ops(lambda params: {"error": {"code": "no_window", "message": "There's no group g-9."}})
        call = telemetry.Call(["groups", "close", "g-9"])
        with mock.patch.object(telemetry, "_call", call):
            status, _, _ = self.run_cli_inner("groups", "close", "g-9")
        self.assertEqual(status, 1)
        self.assertEqual(call.metrics.get("batch_steps"), 1)
        self.assertEqual(call.error_code, "no_window")

    def run_cli_inner(self, *argv):
        from ardia_cli import cli
        import contextlib

        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = cli.run(list(argv))
        return status, out.getvalue(), err.getvalue()


EVIL = "Pwned\x1b]52;c;ZXZpbA==\x07\x9b2J\x7f\nnext"


class TerminalEscapes(Base):
    def assert_inert(self, text):
        for char in ("\x1b", "\x07", "\x9b", "\x7f"):
            self.assertNotIn(char, text)
        self.assertNotIn("\nnext", text)

    def test_page_text_is_escaped_in_human_output(self):
        tree = json.loads(json.dumps(TREE))
        space = tree["windows"][0]["spaces"][0]
        space["profileName"] = EVIL
        space["tabs"][1]["title"] = EVIL
        space["tabs"][1]["url"] = "https://a.example/" + EVIL
        space["tabs"][0]["label"] = EVIL
        space["topApps"] = [{"type": "folder", "id": "f-1", "name": EVIL, "items": space["topApps"]}]
        server = self.serve()
        server.replies["workspace"] = lambda params: {"result": tree}
        server.replies["windows"] = lambda params: {"result": [{"id": "w-1", "kind": "normal", "focused": True, "profile": "default", "profileName": EVIL, "tabs": [{"id": "t", "url": EVIL, "title": EVIL, "active": False, "pinned": False, "group": None}]}]}
        for argv in (["tabs"], ["tabs", "--flat"], ["groups"], ["windows"]):
            status, out, _ = self.run_cli(*argv)
            self.assertEqual(status, 0, argv)
            self.assert_inert(out)
            self.assertIn("Pwned", out)
        status, out, _ = self.run_cli("tabs", "--json")
        self.assertEqual(json.loads(out), tree)

    def test_events_pinned_and_history_rows_are_escaped(self):
        from ardia_cli import automation_cli, browsing_cli

        self.assert_inert(automation_cli.describe_event({"event": "tab.navigated", "time": 1, "data": {"tabId": "t", "url": EVIL, "title": EVIL}}))
        self.assert_inert(browsing_cli.describe_pin({"kind": "pinned", "title": EVIL, "url": EVIL, "folder": EVIL, "profile": EVIL}))
        self.assert_inert(browsing_cli.describe_visit({"last_visit": "2026-11-08", "visits": 1, "title": EVIL, "url": EVIL, "profile": "p"}))
        self.assert_inert(browsing_cli.describe_domain({"visits": 1, "domain": EVIL, "pages": 1, "top_title": EVIL, "profile": "p"}))


PAGE = "Héllo 世界 مرحبا 👋🏽\tcol\nline2 \x1b]52;c;ZXZpbA==\x07 \x9b2J \x7f \r end"


class EveryOutputIsInert(Base):
    def test_browse_text_escapes_controls_but_keeps_lines_tabs_and_unicode(self):
        from ardia_cli.browse.commands import Result
        from ardia_cli.browse.daemon import render

        result = Result(data={"title": PAGE}, text=PAGE, page_content=True)
        _, out, _ = render({"json": False}, result=result, name="get")
        for char in ("\x1b", "\x07", "\x9b", "\x7f", "\r"):
            self.assertNotIn(char, out)
        self.assertIn("Héllo 世界 مرحبا 👋🏽\tcol\nline2 ", out)
        _, raw, _ = render({"json": True}, result=result, name="get")
        self.assertEqual(json.loads(raw)["data"]["title"], PAGE)
        self.assertNotIn("\x9b", raw)
        from ardia_cli.browse.errors import BrowseError

        _, _, err = render({"json": False}, error=BrowseError(f"bad {PAGE}"))
        self.assertNotIn("\x1b", err)

    def test_one_writer_guards_every_command_but_json_mode(self):
        from ardia_cli import automation_cli

        def noisy(args):
            sys.stdout.write("hook \x1b]52;c;ZXZpbA==\x07 name\tok\n")
            sys.stderr.write("warn \x1b[2J\n")
            return 0

        with mock.patch.object(automation_cli, "cmd_commands", noisy):
            status, out, err = self.run_cli("commands")
            self.assertEqual(status, 0)
            self.assertNotIn("\x1b", out + err)
            self.assertNotIn("\x07", out)
            self.assertIn("name\tok\n", out)
            status, out, err = self.run_cli("commands", "--json")
            self.assertIn("\x1b", out)
            self.assertNotIn("\x1b", err)


C1_TITLE = "Clear \x9b2J then \x9d0;spoof\x9c and \x7f, café 世界 👋"


class JsonStaysInert(Base):
    def assert_no_c1(self, text):
        for char in ("\x9b", "\x9d", "\x9c", "\x7f"):
            self.assertNotIn(char, text)

    def test_browse_json_escapes_c1_and_decodes_to_the_same_value(self):
        from ardia_cli.browse.commands import Result
        from ardia_cli.browse.daemon import render

        _, out, _ = render({"json": True}, result=Result(data={"title": C1_TITLE}, text=C1_TITLE))
        self.assert_no_c1(out)
        self.assertIn("café 世界 👋", out)
        self.assertEqual(json.loads(out)["data"]["title"], C1_TITLE)

    def test_every_cli_json_output_escapes_c1(self):
        server = self.serve()
        windows = [{"id": "w-1", "kind": "normal", "focused": True, "profile": "default", "profileName": "P", "tabs": [{"id": "t", "url": "https://a.example/", "title": C1_TITLE, "active": True, "pinned": False, "group": None}]}]
        server.replies["windows"] = lambda params: {"result": windows}
        status, out, _ = self.run_cli("windows", "--json")
        self.assertEqual(status, 0)
        self.assert_no_c1(out)
        self.assertEqual(json.loads(out), windows)
        from ardia_cli import printable

        text = json.dumps({"t": C1_TITLE}, ensure_ascii=False)
        self.assertEqual(json.loads(printable.json_safe(text)), {"t": C1_TITLE})


class NamedOutput(Base):
    def test_groups_and_tabs_are_named_next_to_their_ids(self):
        server = self.serve()
        replies = {
            "group.create": {"op": "group.create", "group": "g-1", "label": "Work", "icon": "💼", "tabs": ["tab-1", "tab-2", "tab-3", "tab-4"]},
            "group.update": {"op": "group.update", "group": "g-1", "label": "Work", "icon": "symbol:briefcase"},
            "group.move": {"op": "group.move", "group": "g-1", "label": "Work", "icon": None},
            "group.ungroup": {"op": "group.ungroup", "group": "g-1", "label": "Old\x1b[2J", "icon": "💼", "tabs": ["tab-1"]},
            "tab.move": {"op": "tab.move", "tabs": ["tab-1", "tab-9"]},
        }
        tabs = [{"type": "tab", "id": "tab-1", "title": "Inbox \x1b]52;c;x\x07", "url": "https://mail.example/"}]

        def apply(params):
            op = params["ops"][0]["op"]
            return {"result": {"ok": True, "applied": 1, "results": [replies[op]], "tabs": tabs, "groups": [], "windows": []}}

        server.replies["apply"] = apply
        cases = [
            (["groups", "create", "--name", "Work", "--icon", "💼"], "created group 💼 Work (g-1) with 4 tabs"),
            (["groups", "update", "Work", "--collapse"], "updated group Work (g-1)"),
            (["groups", "move", "Work", "--parent", "Projects"], "moved group Work (g-1)"),
            (["groups", "ungroup", "Old"], "ungrouped 💼 Old\\u001b[2J (g-1)"),
            (["tabs", "move", "tab-1", "tab-9", "--group", "Work"], "moved Inbox \\u001b]52;c;x\\u0007 (tab-1), tab-9"),
        ]
        for argv, line in cases:
            status, out, err = self.run_cli(*argv)
            self.assertEqual((status, out.strip()), (0, line), (argv, err))
        sent = [p["ops"][0] for m, p in server.requests if m == "apply"]
        self.assertEqual(sent[1]["group"], "Work")
        self.assertEqual(sent[2]["parent"], "Projects")
