import assert from "node:assert/strict";
import { test } from "node:test";
import { configureProfileStartup, startupEngineProfiles } from "./startupEngineProfiles.ts";

const profiles = { default: {}, work: {}, alias: { dataId: "work" }, dormant: {} };
const state = { profiles, windows: { a: { profileId: "default" }, b: { profileId: "work" }, c: { profileId: "alias" } } };

test("before startup policy is configured reads retain their original behavior", () => {
  assert.deepEqual(startupEngineProfiles(state), ["", "work", "dormant"]);
});

test("selected mode deduplicates three selected windows by engine data and retains default", () => {
  assert.deepEqual(startupEngineProfiles(state, true), ["", "work"]);
  assert.deepEqual(startupEngineProfiles({ ...state, windows: {} }, true), []);
  const windows = { ...state.windows, a: { profileId: "dormant" } };
  assert.deepEqual(startupEngineProfiles({ ...state, windows }, true), ["dormant", "work"]);
});

test("private windows use their original profile without loading a private engine", () => {
  const privateId = "incognito:p@work";
  const withPrivate = { ...profiles, [privateId]: {} };
  const windows = { private: { profileId: privateId }, missing: { profileId: "missing" } };
  const copy = structuredClone({ profiles: withPrivate, windows });
  assert.deepEqual(startupEngineProfiles(copy, true), ["work"]);
  assert.deepEqual(copy, { profiles: withPrivate, windows });
});

test("startup policy follows the saved setting when configured for a launch", () => {
  configureProfileStartup({ loadProfilesWhenOpened: true });
  assert.deepEqual(startupEngineProfiles(state), ["", "work"]);
  configureProfileStartup({ loadProfilesWhenOpened: false });
  assert.deepEqual(startupEngineProfiles(state), ["", "work", "dormant"]);
});
