import assert from "node:assert/strict";
import { test } from "node:test";
const { barFit } = await import("./barOverflow.ts");

const ids = (n) => Array.from({ length: n }, (_, i) => `b${i}`);
const row = (children, width) => Object.fromEntries(children.map((id, i) => [id, { x: i * width, width }]));

test("a bar that fits shows every item and no chevron", () => {
  const children = ids(5);
  assert.deepEqual(barFit(children, row(children, 100), 600, 16, 28), { shown: children, visible: children, overflowing: false });
});

test("items past the end, and the room for the chevron, go to the overflow menu", () => {
  const children = ids(8);
  const fit = barFit(children, row(children, 100), 600, 16, 28);
  assert.equal(fit.overflowing, true);
  assert.deepEqual(fit.visible, ids(5));
});

test("a huge bar mounts only the items that could ever fit", () => {
  const children = ids(5000);
  const fit = barFit(children, {}, 800, 16, 28);
  assert.equal(fit.shown.length, 51);
  assert.equal(fit.overflowing, true);
  assert.deepEqual(barFit(children, row(fit.shown, 100), 800, 16, 28).visible, ids(7));
});

test("unmeasured items count as fitting until their frames arrive", () => {
  const children = ids(3);
  assert.deepEqual(barFit(children, {}, 600, 16, 28).visible, children);
});

test("an unmeasured item after one that doesn't fit stays in the overflow menu", () => {
  const children = ids(8);
  const frames = row(ids(7), 100);
  assert.deepEqual(barFit(children, frames, 600, 16, 28).visible, ids(5));
});

test("no room at all still mounts one item to measure", () => {
  assert.deepEqual(barFit(ids(4), {}, -150, 16, 28).shown, ["b0"]);
});
