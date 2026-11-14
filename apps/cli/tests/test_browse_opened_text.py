import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli.browse import changes, commands, snapshot
from ardia_cli.browse import cli as browse_cli
from ardia_cli.browse.snapshot import Node

LONG_ROW = ("Priya Raman Starred Nov 5 Kontor kickoff next week Hi Jordan, Now that the Kontor contract is signed, "
            "could you set up the kickoff? Let's do Wednesday the 11th at 2:00 PM")


def node(role, name="", ref=None, backend=None, children=(), frame="F", **props):
    item = Node(role, name, "", dict(props), backend, list(children), ref)
    item.frame = frame
    return item


def seat(number: int, free: bool) -> Node:
    props = {} if free else {"disabled": True}
    return node("button", f"Seat {number}A, window, {'available' if free else 'occupied'}", f"e{number}", number, **props)


def row(ref, role="button", name="", attrs=(), value="", level=0):
    line = f'{role} "{name}" [{", ".join([*attrs, "ref=" + ref])}]'
    return {"ref": ref, "level": level, "role": role, "name": name, "value": value, "attrs": list(attrs), "line": line}


def report(added=(), removed=(), url=None, document="same", text=None):
    out = {"rerendered": [], "document": document, "url": url, "title": None, "added": list(added), "removed": list(removed),
           "changed": [], "network": [], "context": list(added)}
    if text is not None:
        out["text"] = text
    return out


class ShorterNamesInSnapshots(unittest.TestCase):
    def test_a_long_name_is_clipped_with_an_ellipsis_but_the_ref_keeps_the_full_name(self):
        button = node("button", LONG_ROW, "e9", 9)
        line = snapshot._line(button, 0, False)
        self.assertLess(len(line), 125)
        self.assertIn("…", line)
        self.assertTrue(line.startswith('- button "Priya Raman Starred Nov 5 Kontor kickoff next week'))
        self.assertEqual(button.name, LONG_ROW)

    def test_text_nodes_keep_their_whole_text(self):
        text = node("StaticText", LONG_ROW)
        self.assertIn(LONG_ROW, snapshot._line(text, 0, False))

    def test_find_with_a_copied_clipped_name_matches_by_prefix(self):
        clipped = snapshot.shown_name(LONG_ROW)
        tree = [
            {"nodeId": "1", "role": {"value": "button"}, "name": {"value": LONG_ROW}, "backendDOMNodeId": 1},
            {"nodeId": "2", "role": {"value": "button"}, "name": {"value": "Kofi Mensah " + LONG_ROW}, "backendDOMNodeId": 2},
        ]
        for exact in (False, True):
            found, _ = commands.role_candidates(tree, "button", clipped, exact)
            self.assertEqual([item[0]["backendDOMNodeId"] for item in found], [1])

    def test_a_plain_prefix_still_matches(self):
        tree = [{"nodeId": "1", "role": {"value": "button"}, "name": {"value": LONG_ROW}, "backendDOMNodeId": 1}]
        found, how = commands.role_candidates(tree, "button", "Priya Raman Starred", False)
        self.assertEqual((len(found), how), (1, "partial"))


class SnapshotListsChoicesNotDisabledRuns(unittest.TestCase):
    def test_disabled_members_of_a_long_run_become_one_count_line(self):
        seats = [seat(number, number % 4 == 0) for number in range(1, 21)]
        text = snapshot.render([node("group", "Seat map", children=seats)], interactive=True)
        lines = text.splitlines()
        self.assertEqual([line for line in lines if "available" in line], [f'- button "Seat {n}A, window, available" [ref=e{n}]' for n in (4, 8, 12, 16, 20)])
        self.assertIn("- 15 disabled buttons (Seat 1A, window, occupied … Seat 19A, window, occupied)", lines)
        self.assertNotIn("occupied\" [disabled", text)

    def test_short_runs_and_runs_with_few_disabled_stay_as_they_are(self):
        short = [seat(number, number > 3) for number in range(1, 6)]
        self.assertEqual(snapshot.render(short, interactive=True).count("disabled"), 3)
        mostly_free = [seat(number, number > 2) for number in range(1, 15)]
        self.assertEqual(snapshot.render(mostly_free, interactive=True).count("[disabled"), 2)

    def test_children_of_a_hidden_disabled_member_are_hidden_too(self):
        menus = [node("button", f"Menu {n}", f"e{n}", n, children=[node("option", f"Item {n}", f"e{100 + n}", 100 + n)],
                      **({"disabled": True} if n % 2 else {})) for n in range(1, 15)]
        text = snapshot.render(menus, interactive=True)
        self.assertNotIn("Item 1\"", text)
        self.assertIn('option "Item 2"', text)


class ChangeReportListsEnabledChoices(unittest.TestCase):
    def test_a_mixed_run_lists_enabled_members_and_counts_disabled(self):
        rows = [row(f"e{n}", name=f"Seat {n}A, {'available' if n % 3 == 0 else 'occupied'}", attrs=() if n % 3 == 0 else ("disabled",))
                for n in range(1, 31)]
        text = changes.render(report(rows))
        self.assertIn('+ button "Seat 3A, available" [ref=e3]', text)
        self.assertIn('+ button "Seat 30A, available" [ref=e30]', text)
        self.assertIn("+ 20 disabled buttons (Seat 1A, occupied … Seat 29A, occupied)", text)
        self.assertNotIn("Seat 1A, occupied\" [", text)

    def test_a_run_without_disabled_members_stays_one_line(self):
        rows = [row(f"e{n}", name=f"Fare {n}") for n in range(1, 31)]
        self.assertIn("+ 30 buttons (Fare 1 … Fare 30; e1…e30)", changes.render(report(rows)))


class ChangeReportShowsOpenedText(unittest.TestCase):
    def opened(self, more=False):
        return {"lines": ["## Kontor kickoff next week [@e77]", "Hi Jordan, could you set up the kickoff? [@e80]"],
                "refs": {"e77", "e80"}, "more": more, "where": "article"}

    def test_text_follows_the_added_rows_and_plain_rows_in_it_are_not_repeated(self):
        added = [row("e77", "heading", "Kontor kickoff next week", ("level=2",)), row("e80", "link", "set up the kickoff"),
                 row("e81", "checkbox", "Remind me", ("checked=false",))]
        text = changes.render(report(added, text=self.opened()))
        self.assertEqual(text.splitlines(), [
            "changes:",
            '+ checkbox "Remind me" [checked=false, ref=e81]',
            "text:",
            "  ## Kontor kickoff next week [@e77]",
            "  Hi Jordan, could you set up the kickoff? [@e80]",
        ])

    def test_a_cut_text_says_where_to_read_the_rest(self):
        text = changes.render(report([row("e77", "heading", "x", ("level=2",))], text={**self.opened(True), "where": "[role=dialog]"}))
        self.assertTrue(text.endswith("  … more: read -s '[role=dialog]'"))

    def test_data_carries_the_text(self):
        data = changes.as_data(report([], text=self.opened()))
        self.assertEqual(data["text"], {"lines": self.opened()["lines"], "more": False, "where": "article"})

    def test_a_navigation_keeps_the_report_under_the_output_cap(self):
        rows = [row(f"e{n}", ("link", "button")[n % 2], f"Footer link number {n} with a long enough name") for n in range(1, 150)]
        text = {"lines": ["x" * 90] * 32, "refs": set(), "more": True, "where": "main"}
        rendered = changes.render(report(rows, rows[:60], url={"from": "http://a.test/", "to": "http://a.test/#/next"}, text=text))
        self.assertLess(len(rendered), 6000)
        self.assertIn("more lines", rendered)
        self.assertIn("- 60 of the last view's nodes removed", rendered)

    def test_text_that_only_repeats_row_names_adds_nothing(self):
        rows = [row("e1", "textbox", "Merchant"), row("e2", "button", "Save line"), row("e3", "heading", "Add line", ("level=2",))]
        self.assertFalse(changes.adds_text(["## Add line [@e3]", "Merchant [@e1]", "Save line [@e2]"], rows))
        self.assertTrue(changes.adds_text(["## Add line [@e3]", "Thanks for shopping at Staples Market St. Here's a copy of your receipt."], rows))


class OpenedAnchors(unittest.TestCase):
    def test_a_new_level_two_heading_or_a_new_container_with_new_rows_is_opened(self):
        heading = node("heading", "Kontor kickoff", "e77", 77, level=2)
        small = node("heading", "Details", "e78", 78, level=3)
        dialog = node("dialog", "Share", None, 90, children=[node("button", "Copy link", "e91", 91)])
        old_region = node("region", "Filters", None, 95, children=[node("button", "Apply", "e96", 96)])
        tree = [node("main", children=[heading, small, dialog, old_region])]
        added = [row("e77", "heading", "Kontor kickoff", ("level=2",)), row("e78", "heading", "Details", ("level=3",)),
                 row("e91", name="Copy link"), row("e96", name="Apply")]
        before = changes.View("t", "L", "u", "", [], frozenset({("F", 95)}))
        anchors = changes.opened_anchors({**report(added), "back": []}, tree, before)
        self.assertEqual([item.backend for item in anchors], [77, 90])

    def test_rows_redrawn_as_they_were_open_nothing(self):
        heading = node("heading", "Inbox", "e9", 9, level=1)
        added = [row("e9", "heading", "Inbox", ("level=1",))]
        rep = {**report(added), "back": [], "rerendered": [(row("e1", "heading", "Inbox", ("level=1",)), added[0])]}
        self.assertEqual(changes.opened_anchors(rep, [heading], None), [])


class OneRedrawnNode(unittest.TestCase):
    def test_a_single_node_redrawn_as_it_was_is_one_line_not_an_add_and_a_remove(self):
        def view(rows):
            return changes.View("t", "L", "http://x/", "", rows)

        remove = row("e46", name="Remove new row")
        editor = row("e47", "textbox", "SKU, new row")
        report = changes.diff(view([remove, editor]), view([row("e48", name="Remove new row")]))
        self.assertEqual(changes.render(report).splitlines(), [
            "changes:",
            "+ 1 redrawn as they were, with new refs: e48",
            '- textbox "SKU, new row" [ref=e47]',
        ])
        self.assertEqual(changes.as_data(report)["rerendered"], [{"ref": "e48", "was": "e46"}])


class NoTextOption(unittest.TestCase):
    def test_no_text_is_a_global_and_a_batch_line_option(self):
        found, rest = browse_cli.split_globals(["click", "@e1", "--no-text"])
        self.assertEqual((found, rest), ({"no_text": True}, ["click", "@e1"]))
        self.assertTrue(browse_cli.options_from(found, {})["no_text"])
        self.assertEqual(commands.batch_line_options(["click", "@e1", "--no-text"]), (["click", "@e1"], {"no_text": True}))

    def test_no_text_skips_the_page_walk(self):
        ctx = SimpleNamespace(options={"no_text": True}, state=None)
        rep = report([row("e1", "heading", "x", ("level=2",))], url={"from": "a", "to": "b"})
        with mock.patch.object(changes, "page_text") as walk:
            asyncio.run(changes.add_text(ctx, None, [], rep, None))
        walk.assert_not_called()
        self.assertNotIn("text", rep)


if __name__ == "__main__":
    unittest.main()
