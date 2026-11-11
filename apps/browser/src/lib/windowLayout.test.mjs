import assert from "node:assert/strict";
import { test } from "node:test";
const { PAGE_FRAME, pageFrameInsetOf } = await import("./windowLayout.ts");

const off = { zeroInFullScreen: false, fullScreen: false, zeroWhenTabsHidden: false, tabsHidden: false };

test("with neither option the page frame slider still applies", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, off), PAGE_FRAME.default);
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, { ...off, zeroInFullScreen: true, zeroWhenTabsHidden: true }), PAGE_FRAME.default);
  assert.equal(pageFrameInsetOf(12, { ...off, fullScreen: true, tabsHidden: true }), 12);
});

test("full screen with Zero in full screen on is edge to edge", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, { ...off, zeroInFullScreen: true, fullScreen: true }), 0);
  assert.equal(pageFrameInsetOf(5, { ...off, zeroInFullScreen: true, fullScreen: true }), 0);
});

test("full screen with Zero in full screen off keeps the slider", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, { ...off, fullScreen: true }), PAGE_FRAME.default);
  assert.equal(pageFrameInsetOf(5, { ...off, fullScreen: true }), 5);
});

test("tabs hidden with Zero when tabs are hidden on is edge to edge", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, { ...off, zeroWhenTabsHidden: true, tabsHidden: true }), 0);
  assert.equal(pageFrameInsetOf(5, { ...off, zeroWhenTabsHidden: true, tabsHidden: true }), 0);
});

test("tabs hidden with Zero when tabs are hidden off keeps the slider", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, { ...off, tabsHidden: true }), PAGE_FRAME.default);
  assert.equal(pageFrameInsetOf(5, { ...off, tabsHidden: true }), 5);
});
