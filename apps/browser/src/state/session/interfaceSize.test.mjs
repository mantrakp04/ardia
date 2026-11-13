import assert from "node:assert/strict";
import { test } from "node:test";
const stub = await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { parseSettings, SETTING_SPECS } = await import("../settings/settings.ts");
const { CONFIG_SETTING_KEYS, CONFIG_EXCLUDED_KEYS } = await import("../settings/configAllowlist.ts");
const { settingsAdapter, SYNCED_SETTINGS } = await import("../sync/settingsAdapter.ts");
const { loadSession, startPersistence, flushPersistence } = await import("./persist.ts");
const { settingsSnapshot } = await import("../telemetry/settingsSnapshot.ts");
const { entryHeight, entriesHeight } = await import("../sidebar/geometry.ts");
const { toolbarGeometry } = await import("../../components/window/geometry.ts");
const S = () => useBrowser.getState();
test("interface size validates, is classified once, and stays local in both sync directions", () => {
  assert.equal(parseSettings({}).interfaceSize, "100");
  assert.equal(parseSettings({ interfaceSize: "bad" }).interfaceSize, "100");
  assert.equal(SETTING_SPECS.interfaceSize.synced, false);
  assert.equal([...CONFIG_SETTING_KEYS, ...CONFIG_EXCLUDED_KEYS].filter((k) => k === "interfaceSize").length, 1);
  assert.ok(!SYNCED_SETTINGS.includes("interfaceSize"));
  S().hydrate({});
  S().updateSettings({ interfaceSize: "150" });
  assert.ok(!settingsAdapter.extract(() => undefined).values.has("set:interfaceSize"));
  settingsAdapter.apply(new Map([["set:interfaceSize", { v: "110" }]]), ["set:interfaceSize"]);
  assert.equal(S().settings.interfaceSize, "150");
  assert.equal(settingsSnapshot(S().settings).setting_interfaceSize, "150");
});
test("v11 defaults without inventing a choice, then v12 persists a real choice", () => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify({ version: 11, settings: {}, settingsMeta: { chosen: [], inferred: [] } }));
  S().hydrate(loadSession());
  assert.equal(S().settings.interfaceSize, "100");
  assert.ok(!S().settingsMeta.chosen.includes("interfaceSize"));
  const stop = startPersistence();
  S().updateSettings({ interfaceSize: "125" });
  flushPersistence();
  stop();
  const saved = JSON.parse(stub.docs.get("session.json"));
  assert.equal(saved.version, 12);
  S().hydrate(loadSession());
  assert.equal(S().settings.interfaceSize, "125");
  assert.ok(S().settingsMeta.chosen.includes("interfaceSize"));
});
test("state geometry and toolbar cache respond to every preset without changing page zoom", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://example.com" });
  const id = S().windows[w].tabIds[0];
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [id]: { ...s.tabs[id], zoom: 1.25 } } }));
  const zoom = S().tabs[id].zoom;
  const baseline = toolbarGeometry({ sidebarButton: true });
  for (const preset of ["100", "110", "125", "150"]) {
    S().updateSettings({ interfaceSize: preset });
    const factor = Number(preset) / 100;
    assert.equal(entryHeight(S(), w, "default", `tab:${id}`), 34 * factor);
    assert.equal(entriesHeight(S(), w, "default", [`tab:${id}`, `tab:${id}`]), 71 * factor);
    assert.equal(toolbarGeometry({ sidebarButton: true, interfaceSize: preset }).back, baseline.back * factor);
    assert.equal(S().tabs[id].zoom, zoom);
  }
});
