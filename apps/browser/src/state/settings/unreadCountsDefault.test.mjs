import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { loadSession } = await import("../session/persist.ts");
const { DEFAULT_SETTINGS } = await import("./settings.ts");
const { settingsAdapter } = await import("../sync/settingsAdapter.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const KEY = "showUnreadCounts";
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

test("unread counts are off by default", () => {
  assert.equal(DEFAULT_SETTINGS[KEY], false);
});

test("a saved on the user never touched turns off, keeps each hidden site, and stays unchosen so sync doesn't publish it", () => {
  const saved = { ...DEFAULT_SETTINGS, [KEY]: true, unreadHiddenSites: ["mail.example"], tabLayout: "top" };
  assert.deepEqual(load(doc(10, saved, { chosen: ["tabLayout", "unreadHiddenSites"], inferred: [] })), { on: false, chosen: false, inferred: false });
  assert.deepEqual(S().settings.unreadHiddenSites, ["mail.example"]);
  assert.equal(S().settings.tabLayout, "top");
  assert.equal(pushed(), false);
});

test("an on the user turned on by hand stays on and still syncs", () => {
  assert.deepEqual(load(doc(10, { ...DEFAULT_SETTINGS, [KEY]: true }, { chosen: [KEY], inferred: [] })), { on: true, chosen: true, inferred: false });
  assert.equal(pushed(), true);
});

test("an on only filled in for the user (chosen and inferred) turns off", () => {
  assert.deepEqual(load(doc(10, { ...DEFAULT_SETTINGS, [KEY]: true }, { chosen: [KEY, "tabLayout"], inferred: [KEY, "tabLayout"] })), { on: false, chosen: false, inferred: false });
  assert.deepEqual(S().settingsMeta, { chosen: ["tabLayout"], inferred: ["tabLayout"] });
});

test("an off the user chose stays off, and the migration runs once: a current session keeps its on", () => {
  assert.deepEqual(load(doc(10, { ...DEFAULT_SETTINGS, [KEY]: false }, { chosen: [KEY], inferred: [] })), { on: false, chosen: true, inferred: false });
  assert.equal(load(doc(11, { ...DEFAULT_SETTINGS, [KEY]: true }, { chosen: [], inferred: [] })).on, true);
});

test("an on chosen on another Mac still applies here, since the unchosen local value never wins", () => {
  load(doc(10, { ...DEFAULT_SETTINGS, [KEY]: true }, { chosen: [], inferred: [] }));
  settingsAdapter.apply(new Map([[`set:${KEY}`, { v: true }]]), [`set:${KEY}`]);
  assert.equal(S().settings[KEY], true);
});
