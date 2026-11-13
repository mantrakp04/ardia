import assert from "node:assert/strict";
import { test } from "node:test";
import { idleProfiles, PROFILE_IDLE_MS } from "./idleProfiles.ts";

test("a profile must remain unused for five continuous minutes", () => {
  const ready = idleProfiles();
  assert.deepEqual(ready(["work"], new Set(), 0), []);
  assert.deepEqual(ready(["work"], new Set(), PROFILE_IDLE_MS - 1), []);
  assert.deepEqual(ready(["work"], new Set(), PROFILE_IDLE_MS), ["work"]);
  assert.deepEqual(ready(["work"], new Set(), PROFILE_IDLE_MS + 60_000), ["work"]);
});

test("selection in any window resets the grace period regardless of focus", () => {
  const ready = idleProfiles();
  ready(["work", "personal"], new Set(["personal"]), 0);
  assert.deepEqual(ready(["work", "personal"], new Set(["work", "personal"]), PROFILE_IDLE_MS), []);
  assert.deepEqual(ready(["work", "personal"], new Set(["personal"]), PROFILE_IDLE_MS + 1), []);
  assert.deepEqual(ready(["work", "personal"], new Set(["personal"]), 2 * PROFILE_IDLE_MS + 1), ["work"]);
});

test("a released and reloaded profile gets a fresh grace period, including Default", () => {
  const ready = idleProfiles();
  ready([""], new Set(), 0);
  assert.deepEqual(ready([""], new Set(), PROFILE_IDLE_MS), [""]);
  ready([], new Set(), PROFILE_IDLE_MS);
  assert.deepEqual(ready([""], new Set(), PROFILE_IDLE_MS + 1), []);
});

test("each configured delay waits for its full interval", () => {
  for (const delay of [5, 15, 60, 120]) {
    const ready = idleProfiles();
    const ms = delay * 60_000;
    ready(["work"], new Set(), 0, ms);
    assert.deepEqual(ready(["work"], new Set(), ms - 1, ms), []);
    assert.deepEqual(ready(["work"], new Set(), ms, ms), ["work"]);
  }
});

test("turning unloading off clears elapsed idle time", () => {
  const ready = idleProfiles();
  ready(["work"], new Set(), 0);
  assert.deepEqual(ready(["work"], new Set(), PROFILE_IDLE_MS, null), []);
  assert.deepEqual(ready(["work"], new Set(), PROFILE_IDLE_MS + 1), []);
  assert.deepEqual(ready(["work"], new Set(), 2 * PROFILE_IDLE_MS + 1), ["work"]);
});

test("unloading respects the Off choice and Memory Saver", async () => {
  const { profileUnloadDelay } = await import("./idleProfiles.ts");
  for (const [value, minutes] of [["never", null], ["5m", 5], ["15m", 15], ["1h", 60], ["2h", 120]]) {
    assert.equal(profileUnloadDelay({ memorySaver: true, unloadProfilesAfter: value }), minutes === null ? null : minutes * 60_000);
    assert.equal(profileUnloadDelay({ memorySaver: false, unloadProfilesAfter: value }), null);
  }
});
