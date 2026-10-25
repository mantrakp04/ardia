import assert from "node:assert/strict";
import { test } from "node:test";
const { DIAL_PITCH, PROFILE_SWITCHER_HEIGHT, dialDrag, dialIndexAt, moveTo, reorderTarget } = await import("./dial.ts");

test("the dial uses the cylinder pitch and the 52 pt footer", () => {
  assert.equal(DIAL_PITCH, 36);
  assert.equal(PROFILE_SWITCHER_HEIGHT, 52);
});

test("dialIndexAt rounds to the nearest slot and clamps", () => {
  assert.equal(dialIndexAt(0, 2, 5), 2);
  assert.equal(dialIndexAt(18, 2, 5), 1);
  assert.equal(dialIndexAt(-18, 2, 5), 3);
  assert.equal(dialIndexAt(400, 2, 5), 0);
  assert.equal(dialIndexAt(-400, 2, 5), 4);
});

test("dialDrag follows the pointer between the ends", () => {
  assert.equal(dialDrag(0, 2, 5), 0);
  assert.equal(dialDrag(30, 2, 5), 30);
  assert.equal(dialDrag(-30, 2, 5), -30);
});

test("dialDrag rubber-bands past the first and last profile", () => {
  const right = dialDrag(200, 0, 3);
  const left = dialDrag(-200, 2, 3);
  assert.ok(right > 0 && right < 200, String(right));
  assert.ok(left < 0 && left > -200, String(left));
});

test("reorderTarget moves by whole slots and clamps", () => {
  assert.equal(reorderTarget(1, 36, 4), 2);
  assert.equal(reorderTarget(1, -36, 4), 0);
  assert.equal(reorderTarget(1, 400, 4), 3);
});

test("moveTo reorders and leaves unknown ids alone", () => {
  assert.deepEqual(moveTo(["a", "b", "c"], "a", 2), ["b", "c", "a"]);
  assert.deepEqual(moveTo(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  assert.deepEqual(moveTo(["a", "b", "c"], "b", 1), ["a", "b", "c"]);
  const ids = ["a", "b", "c"];
  assert.equal(moveTo(ids, "z", 0), ids);
});
