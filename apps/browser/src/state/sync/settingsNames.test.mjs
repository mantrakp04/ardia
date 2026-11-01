import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { settingsAdapter, settingsToReapply } from "./settingsAdapter.ts";
import { inTodaysNames } from "./adapters.ts";

test("renamed Space settings retain their legacy sync record IDs", () => {
  useBrowser.getState().hydrate({});
  const adapter = inTodaysNames(settingsAdapter);
  const visible = new Map([["set:profileSwitcherIcons", { v: true }], ["set:warnBeforeMovingTabsToProfile", { v: false }]]);
  adapter.apply(visible, [...visible.keys()]);
  assert.equal(useBrowser.getState().settings.spaceSwitcherIcons, true);
  assert.equal(useBrowser.getState().settings.warnBeforeMovingTabsToSpace, false);
  useBrowser.getState().updateSettings({ spaceSwitcherIcons: true, warnBeforeMovingTabsToSpace: false });
  const values = adapter.extract(() => undefined).values;
  assert.deepEqual(values.get("set:profileSwitcherIcons"), { v: true });
  assert.deepEqual(values.get("set:warnBeforeMovingTabsToProfile"), { v: false });
  assert.ok(!values.has("set:spaceSwitcherIcons"));
});

test("records written by earlier local Spaces builds still apply", () => {
  useBrowser.getState().hydrate({});
  const visible = new Map([["set:spaceSwitcherIcons", { v: true }], ["set:warnBeforeMovingTabsToSpace", { v: false }]]);
  settingsAdapter.apply(visible, [...visible.keys()]);
  assert.equal(useBrowser.getState().settings.spaceSwitcherIcons, true);
  assert.equal(useBrowser.getState().settings.warnBeforeMovingTabsToSpace, false);
});

test("joining can reapply unchosen settings from legacy wire names", () => {
  useBrowser.getState().hydrate({});
  const keys = settingsToReapply({ "set:profileSwitcherIcons": { v: { v: true }, h: "1" }, "set:warnBeforeMovingTabsToProfile": { v: { v: false }, h: "1" } });
  assert.deepEqual(keys.sort(), ["set:profileSwitcherIcons", "set:warnBeforeMovingTabsToProfile"].sort());
});

test("joining can reapply settings cached by earlier local Spaces builds", () => {
  useBrowser.getState().hydrate({});
  const keys = settingsToReapply({ "set:spaceSwitcherIcons": { v: { v: true }, h: "1" }, "set:warnBeforeMovingTabsToSpace": { v: { v: false }, h: "1" } });
  assert.deepEqual(keys.sort(), ["set:spaceSwitcherIcons", "set:warnBeforeMovingTabsToSpace"].sort());
});
