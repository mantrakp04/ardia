import assert from "node:assert/strict";
import { test } from "node:test";
const { PINCH_CLOSE_AT, PINCH_OPEN_AT, pinchFollow, pinchOutcome } = await import("./pinch.ts");

test("a small pinch either way springs back; only a deliberate one opens or closes", () => {
  for (const m of [0, 0.05, -0.05, 0.1, -0.1, 0.2, -0.2, PINCH_OPEN_AT - 0.01, PINCH_CLOSE_AT + 0.01]) assert.equal(pinchOutcome(m), "stay", `${m}`);
  assert.equal(pinchOutcome(PINCH_OPEN_AT), "open");
  assert.equal(pinchOutcome(0.8), "open");
  assert.equal(pinchOutcome(PINCH_CLOSE_AT), "close");
  assert.equal(pinchOutcome(-0.7), "close");
});

test("the card follows the fingers: a pinch shrinks it at the fingers' scale, a spread grows it toward the tab", () => {
  assert.deepEqual(pinchFollow(0, 0.12), { progress: 1, expand: 0 });
  const pinched = pinchFollow(-0.25, 0.12);
  assert.equal(pinched.expand, 0);
  assert.ok(Math.abs(0.12 + 0.88 * pinched.progress - 0.75) < 1e-9);
  assert.deepEqual(pinchFollow(-2, 0.12), { progress: 0, expand: 0 });
  assert.deepEqual(pinchFollow(0.2, 0.12), { progress: 1, expand: 0.5 });
  assert.deepEqual(pinchFollow(3, 0.12), { progress: 1, expand: 1 });
  let last = -1;
  for (let m = 0; m <= 0.5; m += 0.05) {
    const { expand } = pinchFollow(m, 0.12);
    assert.ok(expand >= last);
    last = expand;
  }
});
