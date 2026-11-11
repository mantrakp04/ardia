import assert from "node:assert/strict";
import { test } from "node:test";
const { PAGE_FRAME, pageFrameInsetOf } = await import("./windowLayout.ts");

test("a window keeps the page frame slider", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, false, false), PAGE_FRAME.default);
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, true, false), PAGE_FRAME.default);
  assert.equal(pageFrameInsetOf(0, true, false), 0);
  assert.equal(pageFrameInsetOf(12, true, false), 12);
});

test("full screen with Zero in full screen on is edge to edge", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, true, true), 0);
  assert.equal(pageFrameInsetOf(5, true, true), 0);
  assert.equal(pageFrameInsetOf(12, true, true), 0);
});

test("full screen with Zero in full screen off keeps the slider", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, false, true), PAGE_FRAME.default);
  assert.equal(pageFrameInsetOf(5, false, true), 5);
  assert.equal(pageFrameInsetOf(0, false, true), 0);
});
