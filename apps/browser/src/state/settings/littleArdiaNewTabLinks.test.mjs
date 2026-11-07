import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { loadSession } = await import("../session/persist.ts");
const { DEFAULT_SETTINGS } = await import("./settings.ts");
const { settingsAdapter } = await import("../sync/settingsAdapter.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const KEY = "littleArdiaOpensNewTabLinks";
const PROFILE = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const doc = (version, settings, settingsMeta) => ({
  version,
  profiles: { default: PROFILE },
  profileOrder: ["default"],
  settings,
  ...(settingsMeta ? { settingsMeta } : {}),
  windows: [],
  windowOrder: [],
  tabs: [],
  groups: [],
  splits: [],
  closedTabs: [],
  closedWindows: [],
});
const load = (saved) => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify(saved));
  S().hydrate(loadSession());
  return { on: S().settings[KEY], chosen: S().settingsMeta.chosen.includes(KEY), inferred: S().settingsMeta.inferred.includes(KEY) };
};
const pushed = () => settingsAdapter.extract(() => undefined).values.has(`set:${KEY}`);

test("new-tab links open inside Little Ardia by default", () => {
  assert.equal(DEFAULT_SETTINGS[KEY], true);
});

test("a saved off the user never touched turns on, and stays unchosen so sync doesn't publish it", () => {
  assert.deepEqual(load(doc(9, { ...DEFAULT_SETTINGS, [KEY]: false, tabLayout: "top" }, { chosen: ["tabLayout"], inferred: [] })), { on: true, chosen: false, inferred: false });
  assert.equal(S().settings.tabLayout, "top");
  assert.equal(pushed(), false);
});

test("an off the user turned off by hand stays off and still syncs", () => {
  assert.deepEqual(load(doc(9, { ...DEFAULT_SETTINGS, [KEY]: false }, { chosen: [KEY], inferred: [] })), { on: false, chosen: true, inferred: false });
  assert.equal(pushed(), true);
});

test("an off only filled in for the user (chosen and inferred) turns on", () => {
  assert.deepEqual(load(doc(9, { ...DEFAULT_SETTINGS, [KEY]: false }, { chosen: [KEY, "tabLayout"], inferred: [KEY, "tabLayout"] })), { on: true, chosen: false, inferred: false });
  assert.deepEqual(S().settingsMeta, { chosen: ["tabLayout"], inferred: ["tabLayout"] });
});

test("a file from before settingsMeta with the old off turns on", () => {
  assert.equal(load(doc(7, { ...DEFAULT_SETTINGS, [KEY]: false })).on, true);
});

test("a current file keeps an off as it is: the change runs once", () => {
  assert.equal(load(doc(10, { ...DEFAULT_SETTINGS, [KEY]: false }, { chosen: [], inferred: [] })).on, false);
});

test("an on stays on", () => {
  assert.equal(load(doc(9, { ...DEFAULT_SETTINGS, [KEY]: true }, { chosen: [KEY], inferred: [] })).on, true);
});
