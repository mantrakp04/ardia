import assert from "node:assert/strict";
import { test } from "node:test";
const { DEFAULT_SETTINGS, parseSettings, SETTING_KEYS, SETTING_SPECS, parseSettingsMeta } = await import("./settings.ts");
const { useBrowser } = await import("../browser/store.ts");
const { settingsAdapter, SYNCED_SETTINGS } = await import("../sync/settingsAdapter.ts");
const { SETUP_SETTING_KEYS, SETTING_FIELDS } = await import("../presets/setupCode.ts");

const S = () => useBrowser.getState();

test("every default passes its own check", () => {
  for (const key of SETTING_KEYS) assert.ok(SETTING_SPECS[key].valid(DEFAULT_SETTINGS[key]), key);
});

test("dragging a tab onto another in the top tab strip groups them only once turned on", () => {
  assert.equal(DEFAULT_SETTINGS.dragToGroupInTopStrip, false);
});

test("page frame zero options and borderless mode are off by default and synced", () => {
  for (const key of ["borderlessMode", "pageFrameZeroInFullScreen", "pageFrameZeroWhenTabsHidden"]) {
    assert.equal(DEFAULT_SETTINGS[key], false, key);
    assert.ok(SETTING_SPECS[key].synced, key);
    assert.ok(SYNCED_SETTINGS.includes(key), key);
    assert.equal(parseSettings({ [key]: true })[key], true, key);
    assert.equal(parseSettings({ [key]: "yes" })[key], false, key);
  }
});

test("turning on Zero in full screen also turns on Zero in full screen when tabs are hidden", async () => {
  const { choose } = await import("./settings.ts");
  const base = { settings: { ...DEFAULT_SETTINGS }, settingsMeta: { chosen: [], inferred: [] } };
  const onlyFs = choose(base, { pageFrameZeroInFullScreen: true });
  assert.equal(onlyFs.settings.pageFrameZeroInFullScreen, true);
  assert.equal(onlyFs.settings.pageFrameZeroWhenTabsHidden, true);
  const offFs = choose({ ...base, settings: onlyFs.settings, settingsMeta: onlyFs.settingsMeta }, { pageFrameZeroInFullScreen: false });
  assert.equal(offFs.settings.pageFrameZeroInFullScreen, false);
  assert.equal(offFs.settings.pageFrameZeroWhenTabsHidden, true);
});

test("sync also turns on the dependent page-frame flag", () => {
  S().hydrate({ settings: {} });
  settingsAdapter.apply(new Map([["set:pageFrameZeroInFullScreen", { v: true }]]), ["set:pageFrameZeroInFullScreen"]);
  assert.equal(S().settings.pageFrameZeroInFullScreen, true);
  assert.equal(S().settings.pageFrameZeroWhenTabsHidden, true);
});

test("a saved value of the wrong kind reads as the default, and the rest is kept", () => {
  const settings = parseSettings({
    tabLayout: "diagonal",
    sidebarWidth: -4,
    autoPictureInPicture: "yes",
    customSearchEngines: [{ id: 1 }],
    shortcuts: { newTab: ["t", "command"] },
    cleanUpInactiveTabsAfterMinutes: null,
  });
  assert.equal(settings.tabLayout, DEFAULT_SETTINGS.tabLayout);
  assert.equal(settings.sidebarWidth, DEFAULT_SETTINGS.sidebarWidth);
  assert.equal(settings.autoPictureInPicture, true);
  assert.deepEqual(settings.customSearchEngines, []);
  assert.deepEqual(settings.shortcuts, { newTab: ["t", "command"] });
  assert.equal(settings.cleanUpInactiveTabsAfterMinutes, null);
  assert.deepEqual(parseSettingsMeta({ chosen: ["shortcuts"], inferred: "everything" }), { chosen: ["shortcuts"], inferred: [] });
  assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
});

test("Peek and split view never both get ⌥-click from a saved file, and sync takes each record as it is", () => {
  const saved = parseSettings({ peekModifier: "alt", splitLinkModifier: "alt" });
  assert.deepEqual([saved.peekModifier, saved.splitLinkModifier], ["alt", "altShift"]);
  S().hydrate({ settings: { splitLinkModifier: "alt" }, settingsMeta: { chosen: ["splitLinkModifier"], inferred: [] } });
  settingsAdapter.apply(new Map([["set:peekModifier", { v: "alt" }]]), ["set:peekModifier"]);
  assert.deepEqual([S().settings.peekModifier, S().settings.splitLinkModifier], ["alt", "alt"], "moving one locally would make Macs that disagree flip it back and forth");
});

test("a synced value this version can't show is left out", () => {
  S().hydrate({ settings: {} });
  settingsAdapter.apply(
    new Map([
      ["set:selectedTabGlow", { v: "medium" }],
      ["set:showFullUrl", { v: null }],
      ["set:compactToolbar", { v: true }],
    ]),
    ["set:selectedTabGlow", "set:showFullUrl", "set:compactToolbar"],
  );
  assert.equal(S().settings.selectedTabGlow, DEFAULT_SETTINGS.selectedTabGlow);
  assert.equal(S().settings.showFullUrl, false);
  assert.equal(S().settings.compactToolbar, true);
  assert.ok(SYNCED_SETTINGS.includes("compactToolbar"));
});

test("a setup code can carry every value its settings can take", () => {
  for (const key of SETUP_SETTING_KEYS) {
    const values = SETTING_SPECS[key].values;
    if (values) assert.deepEqual(values.filter((v) => !SETTING_FIELDS[key].values.includes(v)), [], key);
  }
});
