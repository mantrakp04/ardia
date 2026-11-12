import assert from "node:assert/strict";
import { test } from "node:test";
const { PAGE_FRAME, pageFrameInsetOf, pageFrameOf } = await import("./windowLayout.ts");

const off = { borderlessMode: false, zeroInFullScreen: false, fullScreen: false, zeroWhenTabsHidden: false, tabsHidden: false };

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

test("full screen and tabs hidden with Zero in full screen when tabs are hidden on is edge to edge", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, { ...off, zeroWhenTabsHidden: true, fullScreen: true, tabsHidden: true }), 0);
  assert.equal(pageFrameInsetOf(5, { ...off, zeroWhenTabsHidden: true, fullScreen: true, tabsHidden: true }), 0);
});

test("tabs hidden alone with Zero in full screen when tabs are hidden on keeps the slider", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, { ...off, zeroWhenTabsHidden: true, tabsHidden: true }), PAGE_FRAME.default);
  assert.equal(pageFrameInsetOf(5, { ...off, zeroWhenTabsHidden: true, tabsHidden: true }), 5);
});

test("full screen alone with Zero in full screen when tabs are hidden on keeps the slider", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, { ...off, zeroWhenTabsHidden: true, fullScreen: true }), PAGE_FRAME.default);
  assert.equal(pageFrameInsetOf(5, { ...off, zeroWhenTabsHidden: true, fullScreen: true }), 5);
});

test("borderless mode zeros the inset whatever the other options are", () => {
  assert.equal(pageFrameInsetOf(PAGE_FRAME.default, { ...off, borderlessMode: true }), 0);
  assert.equal(pageFrameInsetOf(9, { ...off, borderlessMode: true, fullScreen: true, tabsHidden: true }), 0);
});

test("a zero frame is square; a positive frame follows the window radius minus the inset", () => {
  assert.equal(pageFrameOf(0, 19, 12).radius, 0);
  assert.equal(pageFrameOf(9, 19, 12).radius, 10);
  assert.equal(pageFrameOf(12, 19, 12).radius, 7);
  assert.equal(pageFrameOf(0, 19, 12).peek.radius, 12, "the sidebar peek floats, so it keeps its rounded corners");
  assert.equal(pageFrameOf(0, 19, 20).peek.radius, 15);
});
