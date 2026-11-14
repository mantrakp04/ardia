import assert from "node:assert/strict";
import { test } from "node:test";
import { profileSeed } from "./profile-seed.mjs";

for (const count of [1, 2, 4, 8, 16]) {
  test(`${count} clean profiles have one selected window and one lazy local tab each`, () => {
    const seed = profileSeed("http://127.0.0.1:9000", count, true);
    assert.equal(Object.keys(seed.profiles).length, count);
    assert.equal(seed.windows.length, 1);
    assert.equal(seed.windows[0].profileId, "default");
    assert.deepEqual(seed.windows[0].frame, [100, 100, 1100, 760]);
    assert.equal(seed.windows[0].createdAt, 0);
    assert.equal(seed.tabs.length, count);
    assert.equal(new Set(seed.tabs.map((tab) => tab.profileId)).size, count);
    assert.ok(seed.tabs.every((tab) => tab.page.kind === "idle" && tab.lastActiveAt === 0 && tab.url.startsWith("http://127.0.0.1:9000/")));
    assert.equal(seed.settings.loadProfilesWhenOpened, true);
    assert.equal(seed.settings.unloadProfilesAfter, "5m");
    assert.equal(seed.settings.memorySaver, true);
    const control = profileSeed("http://127.0.0.1:9000", count, false);
    seed.settings.loadProfilesWhenOpened = false;
    assert.deepEqual(seed, control, "the preload setting is the only fixture difference");
  });
}

test("invalid profile counts are rejected", () => {
  for (const count of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => profileSeed("http://localhost", count));
});

test("the unload interval is the only fixture difference between matched profile runs", () => {
  const unloading = profileSeed("http://127.0.0.1:9000", 8, false, "5m");
  const control = profileSeed("http://127.0.0.1:9000", 8, false, "never");
  unloading.settings.unloadProfilesAfter = "never";
  assert.deepEqual(unloading, control);
});
