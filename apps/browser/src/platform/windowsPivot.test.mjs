import assert from "node:assert/strict";
import { test } from "node:test";
import { aroundCentre } from "../../../../packages/expo-windows/src/animation/pivot.ts";

const centred = (steps) => [{ translateX: "50%" }, { translateY: "50%" }, ...steps, { translateX: "-50%" }, { translateY: "-50%" }];

test("a scale, rotation or skew away from rest turns around the view's centre", () => {
  for (const steps of [[{ scale: 0.94 }], [{ scaleX: 0.5 }, { scaleY: 2 }], [{ rotate: "45deg" }], [{ rotate: 0.3 }], [{ rotateZ: "-4deg" }], [{ skewX: "10deg" }], [{ translateY: 8 }, { scale: 0 }]]) {
    assert.deepEqual(aroundCentre(steps), centred(steps), JSON.stringify(steps));
  }
});

test("a transform at rest, or one that only moves, is left as it is", () => {
  for (const steps of [[], [{ translateX: 12 }], [{ translateX: "50%" }, { translateY: -4 }], [{ scale: 1 }], [{ scaleX: 1 }, { scaleY: 1 }], [{ rotate: "0deg" }], [{ rotate: 0 }, { translateX: 3 }]]) {
    assert.equal(aroundCentre(steps), steps, JSON.stringify(steps));
  }
});

test("a matrix and anything that is not a list of steps pass through", () => {
  const matrix = [{ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }];
  assert.equal(aroundCentre(matrix), matrix);
  assert.equal(aroundCentre(undefined), undefined);
  assert.equal(aroundCentre(null), null);
});
