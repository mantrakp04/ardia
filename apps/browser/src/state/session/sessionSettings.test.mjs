import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { flushPersistence, loadSession, startPersistence } = await import("./persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const PROFILE = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const CASES = {
  legacyTrue: { batterySaver: true, newTabPosition: "top" },
  legacyFalse: { batterySaver: false, newTabPosition: "top" },
  legacyTrueChosen: { batterySaver: true, chosen: ["batterySaver", "tabLayout"], inferred: [], tabLayout: "top" },
  legacyTrueInferred: { batterySaver: true, chosen: ["batterySaver"], inferred: ["batterySaver"] },
  missingMeta: { tabLayout: "top", sidebarWidth: 300 },
  chosen: { tabLayout: "top", chosen: ["tabLayout"], inferred: ["appearance"], appearance: "dark" },
  migrated: { tabLayout: "top", newTabButtonPosition: "bottom", newTabPosition: "top", chosen: ["tabLayout", "newTabPosition", "newTabButtonPosition"], inferred: [] },
  linkKeys: { peekModifier: "alt", splitLinkModifier: "alt", chosen: ["peekModifier", "splitLinkModifier"], inferred: [] },
  empty: {},
};
const BEFORE = {"legacyTrue":{"chosen":["newTabPosition","newTabButtonPosition"],"inferred":["newTabPosition","newTabButtonPosition"],"batterySaverWhen":"lowBattery","newTabButtonPosition":"top","newTabPosition":"top","tabLayout":"sidebar","peekModifier":"shift","splitLinkModifier":"altShift","keys":72},"legacyFalse":{"chosen":["newTabPosition","batterySaverWhen","newTabButtonPosition"],"inferred":["newTabPosition","batterySaverWhen","newTabButtonPosition"],"batterySaverWhen":"never","newTabButtonPosition":"top","newTabPosition":"top","tabLayout":"sidebar","peekModifier":"shift","splitLinkModifier":"altShift","keys":72},"legacyTrueChosen":{"chosen":["tabLayout","batterySaverWhen"],"inferred":[],"batterySaverWhen":"unplugged","newTabButtonPosition":"bottom","newTabPosition":"bottom","tabLayout":"top","peekModifier":"shift","splitLinkModifier":"altShift","keys":72},"legacyTrueInferred":{"chosen":[],"inferred":[],"batterySaverWhen":"lowBattery","newTabButtonPosition":"bottom","newTabPosition":"bottom","tabLayout":"sidebar","peekModifier":"shift","splitLinkModifier":"altShift","keys":72},"missingMeta":{"chosen":["tabLayout","sidebarWidth"],"inferred":["tabLayout","sidebarWidth"],"batterySaverWhen":"lowBattery","newTabButtonPosition":"bottom","newTabPosition":"bottom","tabLayout":"top","peekModifier":"shift","splitLinkModifier":"altShift","keys":72},"chosen":{"chosen":["tabLayout"],"inferred":["appearance"],"batterySaverWhen":"lowBattery","newTabButtonPosition":"bottom","newTabPosition":"bottom","tabLayout":"top","peekModifier":"shift","splitLinkModifier":"altShift","keys":72},"migrated":{"chosen":["tabLayout","newTabPosition","newTabButtonPosition"],"inferred":[],"batterySaverWhen":"lowBattery","newTabButtonPosition":"bottom","newTabPosition":"top","tabLayout":"top","peekModifier":"shift","splitLinkModifier":"altShift","keys":72},"linkKeys":{"chosen":["peekModifier","splitLinkModifier"],"inferred":[],"batterySaverWhen":"lowBattery","newTabButtonPosition":"bottom","newTabPosition":"bottom","tabLayout":"sidebar","peekModifier":"alt","splitLinkModifier":"altShift","keys":72},"empty":{"chosen":[],"inferred":[],"batterySaverWhen":"lowBattery","newTabButtonPosition":"bottom","newTabPosition":"bottom","tabLayout":"sidebar","peekModifier":"shift","splitLinkModifier":"altShift","keys":72}};

const doc = (version, settings) => ({ version, profiles: { default: PROFILE }, profileOrder: ["default"], settings, windows: [], windowOrder: [], tabs: [], groups: [], splits: [], closedTabs: [], closedWindows: [] });
const loaded = () => {
  const { settings: st, settingsMeta } = S();
  return { chosen: settingsMeta.chosen, inferred: settingsMeta.inferred, batterySaverWhen: st.batterySaverWhen, newTabButtonPosition: st.newTabButtonPosition, newTabPosition: st.newTabPosition, tabLayout: st.tabLayout, peekModifier: st.peekModifier, splitLinkModifier: st.splitLinkModifier, keys: Object.keys(st).length + 2 };
};

for (const version of [3, 4, 7]) {
  for (const [name, settings] of Object.entries(CASES)) {
    test(`a version ${version} file's settings (${name}) load to the same values and the same chosen and inferred keys as before`, () => {
      stub.docs.clear();
      stub.docs.set("session.json", JSON.stringify(doc(version, structuredClone(settings))));
      S().hydrate(loadSession());
      assert.deepEqual(loaded(), BEFORE[name]);
      assert.equal("chosen" in S().settings || "inferred" in S().settings, false);
    });
  }
}

test("an old Mac's battery saver turned off stays both chosen and inferred, so sync neither publishes nor drops it", () => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify(doc(7, { batterySaver: false, newTabPosition: "top" })));
  S().hydrate(loadSession());
  assert.ok(S().settingsMeta.chosen.includes("batterySaverWhen") && S().settingsMeta.inferred.includes("batterySaverWhen"));
  assert.equal(S().settings.batterySaverWhen, "never");
});

test("settings and their bookkeeping save apart, read back the same, and a change marks the key chosen", () => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify(doc(7, structuredClone(CASES.chosen))));
  const stop = startPersistence();
  S().updateSettings({ appearance: "light" });
  flushPersistence();
  stop();
  const saved = JSON.parse(stub.docs.get("session.json"));
  assert.ok(saved.version >= 8);
  assert.equal("chosen" in saved.settings || "inferred" in saved.settings, false);
  assert.deepEqual(saved.settingsMeta, { chosen: ["tabLayout", "appearance"], inferred: [] });
  S().hydrate(loadSession());
  assert.deepEqual(S().settingsMeta, { chosen: ["tabLayout", "appearance"], inferred: [] });
  assert.equal(S().settings.appearance, "light");
});
