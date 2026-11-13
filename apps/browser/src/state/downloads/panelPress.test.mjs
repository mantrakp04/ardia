import assert from "node:assert/strict";
import { test } from "node:test";
const { downloadsClosedByThisPress, noteDownloadsClosedByPress } = await import("./panelPress.ts");

test("the Downloads button press that closed the panel from outside doesn't reopen it", () => {
  noteDownloadsClosedByPress("w1", 1000);
  assert.equal(downloadsClosedByThisPress("w1", 1200), true);
});

test("a later press on the button opens the panel again", () => {
  noteDownloadsClosedByPress("w1", 1000);
  assert.equal(downloadsClosedByThisPress("w1", 2000), false);
  assert.equal(downloadsClosedByThisPress("w1", 2100), false);
});

test("a close in one window doesn't swallow the button in another", () => {
  noteDownloadsClosedByPress("w1", 1000);
  assert.equal(downloadsClosedByThisPress("w2", 1100), false);
});

test("one outside close swallows one toggle only", () => {
  noteDownloadsClosedByPress("w1", 1000);
  assert.equal(downloadsClosedByThisPress("w1", 1100), true);
  assert.equal(downloadsClosedByThisPress("w1", 1150), false);
});
