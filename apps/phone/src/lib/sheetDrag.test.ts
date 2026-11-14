import assert from "node:assert/strict";
import { test } from "node:test";
import { backgroundScale, draggedOffset, rowDeletes, rowOffset, sheetDismisses, sheetProgress } from "./sheetDrag.ts";

test("the sheet's progress runs from 1 when up to 0 when pulled off the screen", () => {
  assert.equal(sheetProgress(0, 800), 1);
  assert.equal(sheetProgress(200, 800), 0.75);
  assert.equal(sheetProgress(900, 800), 0);
  assert.equal(sheetProgress(10, 0), 0);
});

test("dragging moves the sheet down but never above its top", () => {
  assert.equal(draggedOffset(0, 120, 800), 120);
  assert.equal(draggedOffset(100, -300, 800), 0);
  assert.equal(draggedOffset(700, 300, 800), 800);
});

test("a quarter of the way down or a hard flick closes it; a flick back up keeps it", () => {
  assert.equal(sheetDismisses(201, 800, 0), true);
  assert.equal(sheetDismisses(199, 800, 0), false);
  assert.equal(sheetDismisses(40, 800, 1300), true);
  assert.equal(sheetDismisses(400, 800, -50), false);
});

test("the surface behind shrinks by 6% as the sheet comes up", () => {
  assert.equal(backgroundScale(0), 1);
  assert.equal(backgroundScale(1), 0.94);
});

test("an archived row is deleted past 56 points to the left, or by a flick left", () => {
  assert.equal(rowDeletes(-60, 0), true);
  assert.equal(rowDeletes(-40, 0), false);
  assert.equal(rowDeletes(-20, -400), true);
  assert.equal(rowDeletes(-90, 300), false);
  assert.equal(rowOffset(30), 0);
  assert.equal(rowOffset(-30), -30);
});
