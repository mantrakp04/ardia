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
