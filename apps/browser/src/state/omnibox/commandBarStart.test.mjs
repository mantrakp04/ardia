import assert from "node:assert/strict";
import { test } from "node:test";
const { isCommandBarStart, keepsOpenTab, commandBarTabLimit, commandBarStartFlags } = await import("./commandBarStart.ts");
const { useBrowser } = await import("../browser/store.ts");

test("accepts only known keys with the right types", () => {
  assert.ok(isCommandBarStart({}));
  assert.ok(isCommandBarStart({ openTabs: {} }));
  assert.ok(isCommandBarStart({ openTabs: { hidePinned: true, hideTopApps: false, limit: 0 } }));
  assert.ok(isCommandBarStart({ openTabs: { limit: 20 } }));
  assert.ok(!isCommandBarStart({ openTabs: { limit: 21 } }));
  assert.ok(!isCommandBarStart({ openTabs: { limit: 2.5 } }));
  assert.ok(!isCommandBarStart({ openTabs: { hidePinned: "yes" } }));
  assert.ok(!isCommandBarStart({ openTabs: { other: true } }));
  assert.ok(!isCommandBarStart({ history: {} }));
  assert.ok(!isCommandBarStart([]));
  assert.ok(!isCommandBarStart(null));
});

test("hides pinned rows and Top Apps separately", () => {
  const row = { as: "row" };
  const tile = { as: "tile" };
  assert.ok(keepsOpenTab({}, row) && keepsOpenTab({}, tile) && keepsOpenTab({}, null));
  assert.ok(!keepsOpenTab({ openTabs: { hidePinned: true } }, row));
  assert.ok(keepsOpenTab({ openTabs: { hidePinned: true } }, tile));
  assert.ok(!keepsOpenTab({ openTabs: { hideTopApps: true } }, tile));
  assert.ok(keepsOpenTab({ openTabs: { hidePinned: true, hideTopApps: true } }, null));
});

test("limit defaults to eight", () => {
  assert.equal(commandBarTabLimit({}), 8);
  assert.equal(commandBarTabLimit({ openTabs: { limit: 3 } }), 3);
});

test("telemetry flags never carry anything but booleans and the limit", () => {
  assert.deepEqual(commandBarStartFlags({ openTabs: { hidePinned: true, limit: 4 } }), {
    setting_commandBarStart_hidePinned: "true",
    default_commandBarStart_hidePinned: "false",
    setting_commandBarStart_hideTopApps: "false",
    default_commandBarStart_hideTopApps: "false",
    setting_commandBarStart_limit: "4",
    default_commandBarStart_limit: "8",
  });
  assert.equal(commandBarStartFlags("bad").setting_commandBarStart_limit, "8");
});

test("the setting round-trips through the store", () => {
  useBrowser.getState().hydrate({});
  assert.deepEqual(useBrowser.getState().settings.commandBarStart, {});
  useBrowser.getState().updateSettings({ commandBarStart: { openTabs: { hidePinned: true } } });
  assert.deepEqual(useBrowser.getState().settings.commandBarStart, { openTabs: { hidePinned: true } });
});
