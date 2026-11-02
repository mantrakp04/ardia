import assert from "node:assert/strict";
import { test } from "node:test";
const { revealOffset } = await import("./stripGroups.ts");

test("a selected tab already in view leaves the strip where it is", () => {
  assert.equal(revealOffset(200, 150, 0, 600, 19), null);
  assert.equal(revealOffset(400, 150, 100, 600, 19), null);
});

test("a selected tab past the right edge scrolls just far enough to show it with the edge's padding", () => {
  assert.equal(revealOffset(900, 150, 0, 600, 19), 469);
  assert.equal(revealOffset(500, 150, 0, 600, 19), 69);
});

test("a selected tab past the left edge scrolls back to its start, never before the strip's start", () => {
  assert.equal(revealOffset(300, 150, 500, 600, 19), 281);
  assert.equal(revealOffset(10, 150, 500, 600, 19), 0);
});

test("a tab wider than the strip shows its start", () => {
  assert.equal(revealOffset(1000, 800, 0, 600, 19), 981);
});

test("a selected tab with its own dock cell reveals that cell, not a tile folder that also holds it", async () => {
  const { dockCellOf } = await import("./stripGroups.ts");
  const members = { "folder:f": ["a", "b"], a: ["a"], c: ["c"] };
  const cells = ["folder:f", "c", "a"];
  assert.equal(dockCellOf(cells, (cell) => members[cell], "a"), 2);
  assert.equal(dockCellOf(cells, (cell) => members[cell], "b"), 0);
  assert.equal(dockCellOf(cells, (cell) => members[cell], "z"), -1);
});
