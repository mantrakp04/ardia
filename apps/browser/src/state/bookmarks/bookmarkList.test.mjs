import assert from "node:assert/strict";
import { test } from "node:test";
const { clickSelection, NO_SELECTION, rowWindow, ROW_WINDOW_STEP, selectAll, selectedInOrder } = await import("./bookmarkList.ts");

const ids = Array.from({ length: 2500 }, (_, i) => `b${i}`);
const picked = (selection) => selectedInOrder(ids, selection);

test("⌘A selects every row of the folder, in list order, however many there are", () => {
  const all = selectAll(ids);
  assert.equal(all.selected.size, 2500);
  assert.deepEqual(picked(all), ids);
  assert.equal(all.anchor, "b0");
  assert.deepEqual(picked(selectAll([])), []);
});

test("a click selects one row, ⌘-click toggles, ⇧-click extends from the anchor either way", () => {
  let s = clickSelection(ids, NO_SELECTION, "b10", {});
  assert.deepEqual(picked(s), ["b10"]);
  s = clickSelection(ids, s, "b12", { metaKey: true });
  assert.deepEqual(picked(s), ["b10", "b12"]);
  s = clickSelection(ids, s, "b10", { metaKey: true });
  assert.deepEqual(picked(s), ["b12"]);
  assert.equal(s.anchor, "b10");
  s = clickSelection(ids, s, "b7", { shiftKey: true });
  assert.deepEqual(picked(s), ["b7", "b8", "b9", "b10"]);
  s = clickSelection(ids, s, "b13", { shiftKey: true });
  assert.deepEqual(picked(s), ["b10", "b11", "b12", "b13"]);
});

test("⇧-click after ⌘A narrows to the range from the first row; a plain click after ⌘A selects just that row", () => {
  assert.deepEqual(picked(clickSelection(ids, selectAll(ids), "b3", { shiftKey: true })), ["b0", "b1", "b2", "b3"]);
  assert.deepEqual(picked(clickSelection(ids, selectAll(ids), "b3", {})), ["b3"]);
});

test("rows that left the list (deleted elsewhere) don't count toward the selection", () => {
  const s = selectAll(ids);
  assert.deepEqual(selectedInOrder(["b1", "gone", "b2"], s), ["b1", "b2"]);
});

test("only the rows near the viewport are rendered, at any scroll position, never past the ends", () => {
  const row = 36;
  const top = rowWindow(2500, row, 0, 900);
  assert.equal(top.first, 0);
  assert.ok(top.end * row >= 900 * 1.5, "the viewport and half a viewport below it");
  assert.ok(top.end < 100, `${top.end} rows rendered at the top`);

  for (const y of [0, 17, 1000, 36 * 1234 + 5, 36 * 2499]) {
    const w = rowWindow(2500, row, y, 900);
    assert.ok(w.first * row <= Math.max(0, y - 450), `rows above the viewport at ${y}`);
    assert.ok(w.end * row >= Math.min(2500 * row, y + 900 + 450), `rows below the viewport at ${y}`);
    assert.ok(w.end - w.first < 100, `${w.end - w.first} rows at ${y}`);
    assert.ok(w.first % ROW_WINDOW_STEP === 0 || w.end === 2500);
  }
  assert.equal(rowWindow(2500, row, 36 * 5000, 900).end, 2500);
  assert.deepEqual(rowWindow(5, row, 0, 900), { first: 0, end: 5 });
  assert.deepEqual(rowWindow(0, row, 0, 900), { first: 0, end: 0 });
});

test("small scrolls keep the same window, so a scroll doesn't re-render the list every frame", () => {
  const at = (y) => rowWindow(2500, 36, y, 900).first;
  const bandStart = 450 + 36 * ROW_WINDOW_STEP * 16;
  const firsts = new Set(Array.from({ length: 36 * ROW_WINDOW_STEP }, (_, i) => at(bandStart + i)));
  assert.equal(firsts.size, 1);
});
