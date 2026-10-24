import assert from "node:assert/strict";
import { test } from "node:test";
import { filterOverviewTabs, moveSelection, overviewColumns } from "./tabOverviewFilter.ts";

const tabs = [
  { id: "a", title: "GitHub · ardia", url: "https://github.com/mantrakp04/ardia" },
  { id: "b", title: "MDN grid", url: "https://developer.mozilla.org/docs/Web/CSS/grid" },
  { id: "c", title: "Inbox", url: "https://mail.google.com/" },
];

test("an empty query keeps every tab", () => {
  assert.equal(filterOverviewTabs(tabs, "  "), tabs);
});

test("every word has to match the title or the url", () => {
  assert.deepEqual(filterOverviewTabs(tabs, "git ardia").map((t) => t.id), ["a"]);
  assert.deepEqual(filterOverviewTabs(tabs, "MOZILLA").map((t) => t.id), ["b"]);
  assert.deepEqual(filterOverviewTabs(tabs, "grid inbox"), []);
});

test("columns fit the minimum card width", () => {
  assert.equal(overviewColumns(0), 1);
  assert.equal(overviewColumns(200), 1);
  assert.equal(overviewColumns(482), 2);
  assert.equal(overviewColumns(1200), 4);
});

test("arrows move through the grid and stop at its edges", () => {
  assert.equal(moveSelection(0, 7, 3, "ArrowRight"), 1);
  assert.equal(moveSelection(0, 7, 3, "ArrowLeft"), 0);
  assert.equal(moveSelection(1, 7, 3, "ArrowDown"), 4);
  assert.equal(moveSelection(5, 7, 3, "ArrowDown"), 5);
  assert.equal(moveSelection(4, 7, 3, "ArrowUp"), 1);
  assert.equal(moveSelection(6, 7, 3, "ArrowRight"), 6);
  assert.equal(moveSelection(3, 0, 3, "ArrowRight"), -1);
});
