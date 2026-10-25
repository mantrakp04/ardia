import assert from "node:assert/strict";
import { test } from "node:test";
import { filterOverviewTabs, matchesQuery, moveInGrid, overviewColumns, overviewGrid } from "./tabOverviewFilter.ts";

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

test("folder names and tab text match word by word", () => {
  assert.equal(matchesQuery("Web Development", "dev web"), true);
  assert.equal(matchesQuery("Web Development", "web design"), false);
  assert.equal(matchesQuery("anything", "   "), true);
});

const sections = [["f1", "f2"], ["p1", "p2", "p3", "p4"], ["o1", "o2", "o3"]];

test("the grid starts a new row for each section, as the cards are laid out", () => {
  assert.deepEqual(overviewGrid(sections, 3, null), [["f1", "f2"], ["p1", "p2", "p3"], ["p4"], ["o1", "o2", "o3"]]);
});

test("down and up keep the column across a partial row and a section break", () => {
  const rows = overviewGrid(sections, 3, null);
  assert.equal(moveInGrid(rows, "f2", "ArrowDown"), "p2");
  assert.equal(moveInGrid(rows, "p3", "ArrowDown"), "p4", "a short row takes its last card");
  assert.equal(moveInGrid(rows, "p4", "ArrowDown"), "o1");
  assert.equal(moveInGrid(rows, "o3", "ArrowUp"), "p4");
  assert.equal(moveInGrid(rows, "p2", "ArrowUp"), "f2");
  assert.equal(moveInGrid(rows, "f1", "ArrowUp"), "f1");
  assert.equal(moveInGrid(rows, "o2", "ArrowDown"), "o2");
});

test("left and right run along the rows and wrap between them", () => {
  const rows = overviewGrid(sections, 3, null);
  assert.equal(moveInGrid(rows, "f2", "ArrowRight"), "p1");
  assert.equal(moveInGrid(rows, "p1", "ArrowLeft"), "f2");
  assert.equal(moveInGrid(rows, "f1", "ArrowLeft"), "f1");
  assert.equal(moveInGrid(rows, "o3", "ArrowRight"), "o3");
});

test("an open folder's tabs sit in rows under the folder and are reachable with the arrows", () => {
  const rows = overviewGrid(sections, 3, { after: "f1", keys: ["t1", "t2", "t3", "t4", "t5"], columns: 4 });
  assert.deepEqual(rows, [["f1", "f2"], ["t1", "t2", "t3", "t4"], ["t5"], ["p1", "p2", "p3"], ["p4"], ["o1", "o2", "o3"]]);
  assert.equal(moveInGrid(rows, "f1", "ArrowDown"), "t1");
  assert.equal(moveInGrid(rows, "t5", "ArrowDown"), "p1");
  assert.equal(moveInGrid(rows, "p1", "ArrowUp"), "t5");
});

test("with nothing selected, any arrow picks the first card; an empty grid has none", () => {
  assert.equal(moveInGrid(overviewGrid(sections, 3, null), null, "ArrowDown"), "f1");
  assert.equal(moveInGrid([], null, "ArrowDown"), null);
});
