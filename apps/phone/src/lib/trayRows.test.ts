import assert from "node:assert/strict";
import { test } from "node:test";
import { wholeRowsHeight } from "./trayRows.ts";

test("the list ends after the last row that fits whole, so no row is cut by the keyboard or the tray's edge", () => {
  assert.equal(wholeRowsHeight([66, 132, 198, 264], 230), 198);
  assert.equal(wholeRowsHeight([66, 132, 198, 264], 264), null);
  assert.equal(wholeRowsHeight([66, 132], 230), null);
});

test("a row measured past the room is enough to trim, even before the rows after it are measured", () => {
  assert.equal(wholeRowsHeight([66, 132, 198, 264, 0], 230), 198);
  assert.equal(wholeRowsHeight([66, 132, 0, 264], 230), null);
});

test("with no room measured, or not even one whole row, the list keeps its full height", () => {
  assert.equal(wholeRowsHeight([66, 132], 0), null);
  assert.equal(wholeRowsHeight([90, 180], 60), null);
});
