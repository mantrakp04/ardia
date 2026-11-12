import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { besidePeekSpan, historyMenuLeft, pageSurfaceLeft } = await import("./pageAnchors.ts");
const { space } = await import("../ui/tokens.ts");

const M = space.m;
const PANE = 1200;
const W = 340;
const TOOLBAR = { sidebarButton: null, back: 21, forward: 55, reload: 89, urlLeft: 120 };
const sidebarLeft = { toolbar: null, sidebarRight: false };
const sidebarRight = { toolbar: null, sidebarRight: true };
const toolbar = (right) => ({ toolbar: TOOLBAR, sidebarRight: right });

test("address in a left sidebar: site controls and prompts hug the pane's left edge", () => {
  assert.equal(pageSurfaceLeft(sidebarLeft, "siteButton", PANE, W), M);
  assert.equal(pageSurfaceLeft(sidebarLeft, "prompt", PANE, W), M);
});

test("address in a right sidebar: site controls and prompts hug the pane's right edge, next to the field", () => {
  assert.equal(pageSurfaceLeft(sidebarRight, "siteButton", PANE, W), PANE - W - M);
  assert.equal(pageSurfaceLeft(sidebarRight, "prompt", PANE, W), PANE - W - M);
});

test("address in the toolbar: site controls at the field's right end, prompts under the URL, whichever side the sidebar is on", () => {
  for (const right of [false, true]) {
    assert.equal(pageSurfaceLeft(toolbar(right), "siteButton", PANE, W), PANE - W - M);
    assert.equal(pageSurfaceLeft(toolbar(right), "prompt", PANE, W), TOOLBAR.urlLeft);
  }
});

test("a pane narrower than the surface keeps it at the margin, never off the pane's left", () => {
  assert.equal(pageSurfaceLeft(sidebarRight, "siteButton", 200, W), M);
  assert.equal(pageSurfaceLeft(toolbar(false), "prompt", 200, W), M);
});

test("history menu: under its button with a toolbar, at the sidebar's edge without one", () => {
  assert.equal(historyMenuLeft(toolbar(true), 30, PANE, 260), 30);
  assert.equal(historyMenuLeft(sidebarLeft, 30, PANE, 260), M);
  assert.equal(historyMenuLeft(sidebarRight, 30, PANE, 260), PANE - 260 - M);
});

test("sidebar peeking from the left: popovers start past the peek, inside the focused pane", () => {
  const pane = { x: 600, y: 0, width: 600, height: 800 };
  assert.deepEqual(besidePeekSpan([-Infinity, 300], 10, PANE, pane), { left: 600 + M, room: PANE });
  assert.deepEqual(besidePeekSpan([-Infinity, 900], 10, PANE, pane), { left: 890 + M, room: PANE });
});

test("sidebar peeking from the right: popovers end before the peek and inside the focused pane", () => {
  const full = { x: 0, y: 0, width: PANE, height: 800 };
  assert.deepEqual(besidePeekSpan([950, Infinity], 10, PANE, full), { left: Infinity, room: 940 });
  const leftPane = { x: 0, y: 0, width: 600, height: 800 };
  assert.deepEqual(besidePeekSpan([950, Infinity], 10, PANE, leftPane), { left: Infinity, room: 600 });
});
