import assert from "node:assert/strict";
import { test } from "node:test";
import { toastBottom } from "./placement.ts";

const base = { keyboardLift: null, safeBottom: 24, barClearance: 64, hostBottomY: 2400 / 2.75, barTopY: null, gap: 8 };

test("over the deck the toast sits a gap above the bar's measured top, whatever the phone", () => {
  assert.equal(toastBottom({ ...base, hostBottomY: 872, barTopY: 700 }), 180);
  assert.equal(toastBottom({ ...base, hostBottomY: 915, barTopY: 760 }), 163);
});

test("with no deck bar it clears the system area and the page bar, and the keyboard wins when it is up", () => {
  assert.equal(toastBottom(base), 88);
  assert.equal(toastBottom({ ...base, barTopY: 860, hostBottomY: 872 }), 88);
  assert.equal(toastBottom({ ...base, keyboardLift: 300, barTopY: 700, hostBottomY: 872 }), 308);
});
