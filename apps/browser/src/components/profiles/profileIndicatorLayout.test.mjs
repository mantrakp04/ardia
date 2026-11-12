import assert from "node:assert/strict";
import { test } from "node:test";
import { profileIndicatorLayout } from "./profileIndicatorLayout.ts";

test("narrow headers reserve space for an ellipsized profile name", () => {
  assert.deepEqual(profileIndicatorLayout(32, 100, true), { shown: true, pad: 4, width: 32 });
  assert.deepEqual(profileIndicatorLayout(60, 100, true), { shown: true, pad: 9, width: 60 });
});

test("profile names never overlap neighbouring controls", () => {
  for (let room = 0; room <= 300; room++) {
    for (const textWidth of [undefined, 0, 20, 80, 500]) {
      const { width, pad, shown } = profileIndicatorLayout(room, textWidth, true);
      assert.ok(width <= room);
      if (shown) assert.ok(width - 2 * pad > 0);
    }
  }
});

test("hidden and full-width indicators keep existing dimensions", () => {
  assert.equal(profileIndicatorLayout(31, 100, true).shown, false);
  assert.equal(profileIndicatorLayout(200, 100, false).width, 0);
  assert.deepEqual(profileIndicatorLayout(200, 100, true), { shown: true, pad: 9, width: 118 });
});
