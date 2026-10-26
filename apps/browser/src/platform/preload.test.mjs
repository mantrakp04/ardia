import assert from "node:assert/strict";
import { mock, test } from "node:test";

globalThis.__DEV__ = false;
const { docs } = await import("../test-native/index.ts");
const ks = await import("./killSwitches.ts");

mock.timers.enable({ apis: ["setTimeout"] });
const preload = await import("./preload.ts");
const setSwitches = (switches) => {
  docs.set("switches-cache.json", JSON.stringify({ version: 1, switches }));
  ks.reloadSwitches();
};

test("no page is made ahead until a moment after launch", () => {
  setSwitches({});
  assert.equal(preload.newTabPrewarmOn(), false);
  mock.timers.tick(1499);
  assert.equal(preload.prewarmAllowed(), false);
  mock.timers.tick(1);
  assert.equal(preload.prewarmAllowed(), true);
  assert.equal(preload.newTabPrewarmOn(), true);
});

test("newTabPrewarm follows its switch (and the bench's own setting)", () => {
  preload.setLaunchSettledForTests(true);
  setSwitches({});
  assert.equal(preload.newTabPrewarmOn(), true);
  setSwitches({ newTabPrewarm: false });
  assert.equal(preload.newTabPrewarmOn(), false);
  setSwitches({});
  preload.setNewTabPrewarm(false);
  assert.equal(preload.newTabPrewarmOn(), false);
  preload.setNewTabPrewarm(true);
  assert.equal(preload.newTabPrewarmOn(), true);
});
