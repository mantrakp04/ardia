import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../browser/store.ts";
import { settingsAdapter, settingsToReapply } from "./settingsAdapter.ts";
import { inTodaysNames } from "./adapters.ts";
import { Clock, emptyScope, syncScope } from "../../platform/sync.ts";

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

for (const [name, legacy] of [["spaceSwitcherIcons", "profileSwitcherIcons"], ["warnBeforeMovingTabsToSpace", "warnBeforeMovingTabsToProfile"]]) {
  for (const newest of [name, legacy]) for (const reverse of [false, true]) test(`${name} picks the newest alias ${newest} with reversed ingestion ${reverse}`, async () => {
    useBrowser.getState().hydrate({});
    useBrowser.setState({ settingsMeta: { chosen: [], inferred: [] } });
    const clock = new Clock("local", null, () => 1000);
    const files = [name, legacy].map((key) => ({ id: key, payload: JSON.stringify({ v: 1, kind: "log", device: key, seq: 1, at: 1000, ops: [{ k: `set:${key}`, h: clock.at(key === newest ? 200 : 100), v: { v: key === newest } }] }) }));
    if (reverse) files.reverse();
    await syncScope({ scope: "app", state: emptyScope(), clock, device: "local", now: () => 1000, adapters: [inTodaysNames(settingsAdapter)], transport: {
      read: async () => ({ files, pending: [], damaged: [], present: files.map((f) => f.id) }),
      write: async () => assert.fail("unchosen settings must not publish"),
      remove: async () => {},
    } });
    assert.equal(useBrowser.getState().settings[name], true);
  });
  test(`${name} replays the newest cached alias after restart`, () => {
    useBrowser.getState().hydrate({});
    const oldValue = useBrowser.getState().settings[name];
    const clock = new Clock("local", null, () => 1000);
    const records = {
      [`set:${legacy}`]: { v: { v: oldValue }, h: clock.at(100), o: ["remote", 1] },
      [`set:${name}`]: { v: { v: !oldValue }, h: clock.at(200), o: ["remote", 2] },
    };
    assert.deepEqual(settingsToReapply(records), [`set:${name}`]);
    settingsAdapter.apply(new Map(Object.entries(records).map(([k, r]) => [k, r.v])), new Set([`set:${legacy}`]), () => undefined, { stamp: (key) => records[key]?.h });
    assert.equal(useBrowser.getState().settings[name], !oldValue);
  });
}
