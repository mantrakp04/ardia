import assert from "node:assert/strict";
import { test } from "node:test";
const { headingTop, newTabBarTop } = await import("./newTabLayout.ts");

const HEADING = 80;

test("the Incognito heading stays inside the page at the smallest window", () => {
  const top = newTabBarTop(400, 0, HEADING);
  assert.ok(headingTop(top, HEADING) >= 16, `the heading's top is ${headingTop(top, HEADING).toFixed(1)} pt`);
});

test("a tall window keeps the bar where it was", () => {
  assert.equal(newTabBarTop(900, 0, HEADING), newTabBarTop(900, 0));
  assert.equal(newTabBarTop(900, 0), Math.max(900 / 2 - 158, 100) + 38 + 1);
});
