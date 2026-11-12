import assert from "node:assert/strict";
import { test } from "node:test";
import { Animated } from "react-native";
const { sharedTileSides, sharedTilesMotion } = await import("./sharedTiles.ts");

const at = ({ config }, pos) => {
  const { inputRange: x, outputRange: y } = config;
  if (pos <= x[0]) return y[0];
  if (pos >= x.at(-1)) return y.at(-1);
  const i = x.findIndex((v, n) => pos >= v && pos <= x[n + 1]);
  return y[i] + ((pos - x[i]) / (x[i + 1] - x[i])) * (y[i + 1] - y[i]);
};

const profiles = {
  lone: { id: "lone", dataId: "home" },
  home: { id: "home", shareTopApps: true },
  work: { id: "work", dataId: "home", shareTopApps: true },
  solo: { id: "solo", shareTopApps: true },
  side: { id: "side", dataId: "solo", shareTopApps: true },
};
const state = { profiles, profileOrder: ["lone", "home", "work", "solo", "side"] };

test("a page's Top Apps hold still only toward a neighbour that shares the same set", () => {
  assert.deepEqual(sharedTileSides(state, 0), { before: false, after: false }, "the neighbour shares but this profile doesn't");
  assert.deepEqual(sharedTileSides(state, 1), { before: false, after: true });
  assert.deepEqual(sharedTileSides(state, 2), { before: true, after: false }, "the next profile shares a different set");
  assert.deepEqual(sharedTileSides(state, 3), { before: false, after: true });
  assert.deepEqual(sharedTileSides(state, 4), { before: true, after: false });
});

test("shared Top Apps stay where they are for the whole switch and cross-fade, unshared ones ride their page", () => {
  const width = 260;
  const pos = new Animated.Value(1);
  const page = (slot, p) => (p - slot) * -width;
  const home = sharedTilesMotion(pos, 1, width, sharedTileSides(state, 1));
  const work = sharedTilesMotion(pos, 2, width, sharedTileSides(state, 2));
  for (const p of [1, 1.1, 1.25, 1.5, 1.8, 2]) {
    assert.ok(Math.abs(page(1, p) + at(home.transform[0].translateX, p)) < 1e-9, `home's grid at ${p}`);
    assert.ok(Math.abs(page(2, p) + at(work.transform[0].translateX, p)) < 1e-9, `work's grid at ${p}`);
    assert.ok(Math.abs(at(home.opacity, p) + at(work.opacity, p) - 1) < 1e-9, `the two grids add up to one at ${p}`);
  }
  for (const p of [2, 2.4, 3]) assert.equal(at(work.transform[0].translateX, p), 0, `work's grid slides with its page toward solo at ${p}`);
  assert.equal(at(work.opacity, 2.5), 1);
  assert.equal(at(home.opacity, 0.5), 1, "home's grid slides with its page toward lone");
  assert.equal(at(home.transform[0].translateX, 0.5), 0);
});
