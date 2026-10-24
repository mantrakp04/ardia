import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadsGeometry } from "./downloadsGeometry.ts";

test("top strip pointer clears the corner while staying under the button", () => {
  const panel = downloadsGeometry({ width: 800, height: 600 }, { x: 775, y: 4, height: 34 }, false);
  assert.ok(Math.abs(panel.left + panel.pointerX - 775) <= 17);
  assert.ok(panel.pointerX <= panel.width - 32);
  assert.equal(panel.edge, 40);
  assert.equal(panel.below, true);
  assert.ok(panel.left + panel.width <= 792);
});

test("sidebar header centers the bubble under the button when room allows", () => {
  const panel = downloadsGeometry({ width: 1000, height: 800 }, { x: 236, y: 10, height: 34 }, false);
  assert.equal(panel.left + panel.pointerX, 236);
  assert.equal(panel.pointerX, panel.width / 2);
  assert.equal(panel.width, 288);
  assert.equal(panel.maxHeight, 384);
});

test("footer opens upward and keeps its pointer aligned near the left edge", () => {
  const panel = downloadsGeometry({ width: 800, height: 600 }, { x: 23, y: 561, height: 34 }, true);
  assert.equal(panel.below, false);
  assert.equal(panel.edge, 41);
  assert.ok(Math.abs(panel.left + panel.pointerX - 23) <= 17);
  assert.equal(panel.pointerX, 32);
});

test("short windows constrain the list while retaining header and footer", () => {
  const panel = downloadsGeometry({ width: 280, height: 300 }, { x: 250, y: 4, height: 34 }, false);
  assert.equal(panel.width, 264);
  assert.equal(panel.left, 8);
  assert.equal(panel.maxHeight, 140.5);
  assert.ok(panel.edge + panel.maxHeight + 10 + 101.5 + 8 <= 300);
});

test("an anchor near the bottom flips above when below has no room", () => {
  const panel = downloadsGeometry({ width: 800, height: 600 }, { x: 400, y: 500, height: 34 }, false);
  assert.equal(panel.below, false);
  assert.equal(panel.edge, 102);
  assert.equal(panel.left + panel.pointerX, 400);
});

test("a hidden peek strip anchor cannot place the panel outside the window", () => {
  const panel = downloadsGeometry({ width: 800, height: 600 }, { x: 775, y: -10000, height: 34 }, false);
  assert.equal(panel.below, true);
  assert.equal(panel.edge, 36);
  assert.ok(panel.left >= 8);
  assert.ok(panel.left + panel.width <= 792);
  assert.ok(panel.edge >= 0 && panel.edge <= 600);
  assert.ok(panel.edge + panel.maxHeight + 10 + 101.5 + 8 <= 600);
});
