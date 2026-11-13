import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// A wheel mouse's horizontal scroll pages Spaces (#325). macOS has already applied the device's natural-scrolling
// setting to `scrollingDeltaX`, so the wheel path must page from the delta's sign alone, as the trackpad path does.
// This runs the very expression `HandleWheel` uses to pick the direction, once per natural-scrolling setting.
const source = readFileSync(new URL("../ios/ArdiaSwipe.mm", import.meta.url), "utf8");
const start = source.indexOf("NSEvent *HandleWheel(");
const handler = source.slice(start, source.indexOf("\n}\n", start));
const decision = handler.match(/BOOL back = (.+);/)?.[1];

test("HandleWheel decides the direction in one expression", () => {
  assert.ok(start >= 0 && decision, "HandleWheel must still pick `back` in a single `BOOL back = ...;` line");
});

const pagesBack = (dx, isDirectionInvertedFromDevice) =>
  new Function("dx", "event", `return !!(${decision});`)(dx, { isDirectionInvertedFromDevice });

for (const inverted of [true, false]) {
  const setting = `natural scrolling ${inverted ? "on" : "off"}`;
  test(`a wheel scrolled left pages back with ${setting}`, () => {
    assert.equal(pagesBack(3, inverted), true);
  });
  test(`a wheel scrolled right pages forward with ${setting}`, () => {
    assert.equal(pagesBack(-3, inverted), false);
  });
}
