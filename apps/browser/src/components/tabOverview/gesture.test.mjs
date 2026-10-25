import assert from "node:assert/strict";
import { test } from "node:test";
import { PINCH_SPAN, pinchEndsOpen, pinchProgress } from "./gesture.ts";

test("pinching in reveals the overview in step with the fingers", () => {
  assert.equal(pinchProgress(0, false), 0);
  assert.equal(pinchProgress(-PINCH_SPAN / 2, false), 0.5);
  assert.equal(pinchProgress(-2, false), 1);
  assert.equal(pinchProgress(0.3, false), 0, "pinching out from a page does nothing");
});

test("pinching out of the overview hides it in step, and pinching further in keeps it", () => {
  assert.equal(pinchProgress(0, true), 1);
  assert.equal(pinchProgress(PINCH_SPAN / 2, true), 0.5);
  assert.equal(pinchProgress(-0.4, true), 1);
});

test("a short pinch springs back; a deliberate one carries through", () => {
  assert.equal(pinchEndsOpen(0.2, false), false);
  assert.equal(pinchEndsOpen(0.5, false), true);
  assert.equal(pinchEndsOpen(0.8, true), true);
  assert.equal(pinchEndsOpen(0.3, true), false);
});
