import assert from "node:assert/strict";
import { test } from "node:test";
const { WINDOW_CHROME, captionRoom, captionClearTop } = await import("./windowChrome.ts");
const windows = (await import("./platformChrome.windows.ts")).WINDOW_CHROME;

test("the Mac reserves the traffic lights' 78 points at the leading top and nothing at the trailing top", () => {
  assert.deepEqual(WINDOW_CHROME, { leadingWidth: 78, trailingWidth: 0, titleBarHeight: 0 });
  for (const [fromRight, fromTop] of [[0, 0], [9, 9], [0, 40], [200, 0]]) assert.equal(captionRoom(fromRight, fromTop), 0);
  for (const row of [0, 28, 41]) assert.equal(captionClearTop(9, row, 9), 9);
});

test("Windows reserves the caption buttons' 138 by 32 at the trailing top and nothing at the leading top", () => {
  assert.deepEqual(windows, { leadingWidth: 0, trailingWidth: 138, titleBarHeight: 32 });
  assert.equal(captionRoom(0, 0, windows), 138);
  assert.equal(captionRoom(9, 9, windows), 129);
  assert.equal(captionRoom(9, 31, windows), 129);
  assert.equal(captionRoom(9, 32, windows), 0);
  assert.equal(captionRoom(9, 42, windows), 0);
  assert.equal(captionRoom(138, 0, windows), 0);
  assert.equal(captionRoom(190, 0, windows), 0);
});

test("on Windows a card whose top row is shorter than the caption buttons starts below them", () => {
  assert.equal(captionClearTop(9, 41, 9, windows), 9);
  assert.equal(captionClearTop(9, 28, 9, windows), 9);
  assert.equal(captionClearTop(9, 16, 9, windows), 16);
  assert.equal(captionClearTop(9, 0, 9, windows), 32);
  assert.equal(captionClearTop(9, 0, 190, windows), 9);
});
