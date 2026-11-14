import assert from "node:assert/strict";
import { test } from "node:test";
const { crumbSwap } = await import("./timeline.ts");

const valueAt = (stops, ms) => {
  if (ms <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) {
    const [from, a] = stops[k - 1];
    const [to, b] = stops[k];
    if (ms <= to) return a + ((b - a) * (ms - from)) / (to - from);
  }
  return stops[stops.length - 1][1];
};

test("swapping the address crumb never shows the old and the new page on top of each other", () => {
  const at = 520;
  const { leaving, arriving } = crumbSwap(at);
  for (let ms = 0; ms <= 1300; ms += 1) {
    const old = valueAt(leaving.opacity, ms);
    const next = valueAt(arriving.opacity, ms);
    assert.ok(old <= 0.01 || next <= 0.01, `at ${ms} ms the old crumb is at ${old.toFixed(2)} and the new one at ${next.toFixed(2)}`);
  }
  assert.equal(valueAt(leaving.opacity, at - 1), 1);
  assert.equal(valueAt(arriving.opacity, at - 1), 0);
  assert.equal(valueAt(leaving.opacity, 1300), 0);
  assert.equal(valueAt(arriving.opacity, 1300), 1);
});

test("the crumb slides the way the tab rows do: the old one leaves to the left, the new one comes in from the right", () => {
  const { leaving, arriving } = crumbSwap(520);
  assert.equal(valueAt(leaving.x, 520), 0);
  assert.ok(valueAt(leaving.x, 1300) < 0);
  assert.ok(valueAt(arriving.x, 520) > 0);
  assert.equal(valueAt(arriving.x, 1300), 0);
});
