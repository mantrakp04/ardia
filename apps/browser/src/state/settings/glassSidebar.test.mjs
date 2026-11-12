import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, parseSettings } from "./settings.ts";
import { isConfigSettingKey } from "./configAllowlist.ts";
import { useBrowser } from "../browser/store.ts";
import { flushPersistence, loadSession, startPersistence } from "../session/persist.ts";
import { settingsAdapter, SYNCED_SETTINGS } from "../sync/settingsAdapter.ts";
import { settingsSnapshot } from "../telemetry/settingsSnapshot.ts";
import { docs } from "../../test-native/index.ts";

test("floating glass is opt-in, accepts only booleans and is configurable", () => {
  assert.equal(DEFAULT_SETTINGS.glassSidebar, false);
  assert.equal(parseSettings({ glassSidebar: true }).glassSidebar, true);
  for (const value of [null, "true", 1, {}]) assert.equal(parseSettings({ glassSidebar: value }).glassSidebar, false);
  assert.ok(isConfigSettingKey("glassSidebar"));
});

test("floating glass persists and syncs independently of control style", () => {
  docs.clear();
  useBrowser.getState().hydrate({ settings: { interfaceStyle: "classic" } });
  const stop = startPersistence();
  try {
    useBrowser.getState().updateSettings({ glassSidebar: true, interfaceStyle: "classic" });
    flushPersistence();
  } finally {
    stop();
  }
  useBrowser.getState().hydrate({ settings: { glassSidebar: false } });
  useBrowser.getState().hydrate(loadSession());
  assert.equal(useBrowser.getState().settings.glassSidebar, true);
  assert.equal(useBrowser.getState().settings.interfaceStyle, "classic");
  assert.ok(SYNCED_SETTINGS.includes("glassSidebar"));
  settingsAdapter.apply(new Map([["set:glassSidebar", { v: false }]]), ["set:glassSidebar"]);
  assert.equal(useBrowser.getState().settings.glassSidebar, false);
  assert.equal(useBrowser.getState().settings.interfaceStyle, "classic");
});

test("the consent-gated settings snapshot includes glass adoption and its default", () => {
  const snapshot = settingsSnapshot({ ...DEFAULT_SETTINGS, glassSidebar: true });
  assert.equal(snapshot.setting_glassSidebar, "true");
  assert.equal(snapshot.default_glassSidebar, "false");
});
