import assert from "node:assert/strict";
import { test } from "node:test";
import { barCandidates, barLayout } from "./barLayout.ts";

const frames = { a: { x: 0, width: 70 }, b: { x: 74, width: 80 }, c: { x: 158, width: 90 } };
const layout = (width, ids = ["a", "b", "c"], measured = frames) =>
  barLayout(ids, measured, width, 28, { gap: 4, shrink: true });

test("measured chips reserve overflow space without clipping clickable items", () => {
  for (const [width, visible] of [[190, ["a", "b"]], [120, ["a"]], [25, []]]) {
    assert.deepEqual(layout(width), { width, overflowing: true, visible });
  }
  assert.deepEqual(layout(300), { width: 252, overflowing: false, visible: ["a", "b", "c"] });
});

test("unmeasured and removed groups do not leave clickable or reserved space", () => {
  assert.deepEqual(layout(100, ["a"], {}), { width: 100, overflowing: false, visible: [] });
  assert.deepEqual(layout(300, ["a"]), { width: 74, overflowing: false, visible: ["a"] });
});

test("bookmark items fill the lane and stay measurable before their first layout", () => {
  assert.deepEqual(barLayout(["a"], {}, 100, 28, { unmeasuredVisible: true }), {
    width: 100, overflowing: false, visible: ["a"],
  });
  assert.deepEqual(barLayout(["a", "b", "c"], frames, 190, 28), {
    width: 190, overflowing: true, visible: ["a", "b"],
  });
  assert.equal(barLayout(["a"], frames, 300, 28).width, 300);
});

test("unmeasured bookmarks can leave a gap before the last visible item", () => {
  const { visible } = barLayout(["a", "b", "c"], { a: frames.a, b: frames.b }, 120, 28, {
    unmeasuredVisible: true,
  });
  assert.deepEqual(visible, ["a", "c"]);
  assert.equal(["a", "b", "c"].findIndex((id) => !visible.includes(id)), 1);
});

test("candidate mounting stays bounded while measuring the first overflowing chip in both sizes", () => {
  const groups = Array.from({ length: 10000 }, (_, id) => String(id));
  for (const padding of [7, 10]) {
    for (const width of [0, 18, 100, 190, 500]) {
      const gap = 4;
      const minimum = padding * 2 + gap;
      const candidates = barCandidates(groups, width, minimum);
      assert.equal(candidates.length, Math.floor(width / minimum) + 1);
      const measured = Object.fromEntries(candidates.map((id, index) => [id, { x: index * minimum, width: padding * 2 }]));
      const result = barLayout(candidates, measured, width, 28, { gap, shrink: true, overflowing: true });
      assert.equal(result.overflowing, true);
      assert.ok(result.visible.every((id) => measured[id].x + measured[id].width <= width - 28));
      assert.equal(groups.filter((id) => !result.visible.includes(id)).length, groups.length - result.visible.length);
    }
  }
  assert.deepEqual(barCandidates(["a", "b"], 500, 18), ["a", "b"]);
  assert.deepEqual(barCandidates([], 500, 18), []);
});

test("an unmeasured candidate tail still reserves the overflow button for retained groups", () => {
  assert.deepEqual(barLayout(["a", "b"], { a: frames.a }, 80, 28, { shrink: true, overflowing: true }), {
    width: 80, overflowing: true, visible: [],
  });
});
