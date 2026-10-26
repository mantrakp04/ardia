import assert from "node:assert/strict";
import { test } from "node:test";
import { DOWNLOADS_PANEL, downloadsPlacement } from "./downloadsPlacement.ts";

const WINDOW = { width: 1200, height: 800 };
const FALLBACK = { topStrip: false, footer: false, footerBottom: 30 };
const { width, margin, arrowGap, arrowHeight } = DOWNLOADS_PANEL;

test("sidebar header button: the panel hangs below it, its arrow on the button's centre", () => {
  const button = { x: 149, y: 9, width: 34, height: 34 };
  const p = downloadsPlacement(WINDOW, button, FALLBACK);
  assert.equal(p.arrow, "top");
  assert.equal(p.top, button.y + button.height + arrowGap);
  assert.equal(p.left, 166 - width / 2);
  assert.equal(p.left + p.arrowX, 166);
  assert.equal(p.room, WINDOW.height - p.top - arrowHeight - margin);
});

test("top strip button at the right edge: the panel stays 8 pt inside the window", () => {
  const button = { x: WINDOW.width - 8 - 34, y: 4, width: 34, height: 34 };
  const p = downloadsPlacement(WINDOW, button, { ...FALLBACK, topStrip: true });
  assert.equal(p.arrow, "top");
  assert.equal(p.left + p.width, WINDOW.width - margin);
  assert.equal(p.left + p.arrowX, button.x + 17);
});

test("sidebar footer button: the panel opens upward from it", () => {
  const button = { x: 6, y: WINDOW.height - 5 - 34, width: 34, height: 34 };
  const p = downloadsPlacement(WINDOW, button, { ...FALLBACK, footer: true });
  assert.equal(p.arrow, "bottom");
  assert.equal(p.top, undefined);
  assert.equal(p.bottom, WINDOW.height - button.y + arrowGap);
  assert.equal(p.left, margin);
  assert.equal(p.left + p.arrowX, 23);
  assert.equal(p.room, button.y - arrowGap - arrowHeight - margin);
});

test("no visible button (sidebar hidden, Little Ardia): the old fixed spot, no arrow", () => {
  assert.deepEqual(downloadsPlacement(WINDOW, null, FALLBACK), { width, left: 10, top: 44, arrow: "none", arrowX: width / 2, room: WINDOW.height - 44 - margin });
  const strip = downloadsPlacement(WINDOW, null, { ...FALLBACK, topStrip: true });
  assert.equal(strip.left + strip.width, WINDOW.width - margin);
  const footer = downloadsPlacement(WINDOW, null, { ...FALLBACK, footer: true });
  assert.equal(footer.bottom, 30);
  assert.equal(footer.arrow, "none");
});

test("a button parked off screen counts as hidden", () => {
  const p = downloadsPlacement(WINDOW, { x: -10_000 + 149, y: 9, width: 34, height: 34 }, FALLBACK);
  assert.equal(p.arrow, "none");
  assert.equal(downloadsPlacement(WINDOW, { x: 149, y: -10_000, width: 34, height: 34 }, FALLBACK).arrow, "none");
});

test("a window narrower than the panel shrinks it to fit", () => {
  const p = downloadsPlacement({ width: 260, height: 500 }, { x: 200, y: 4, width: 34, height: 34 }, FALLBACK);
  assert.equal(p.width, 260 - margin * 2);
  assert.equal(p.left, margin);
});
