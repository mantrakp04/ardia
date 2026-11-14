import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { DEFAULT_SETTINGS, parseSettings } = await import("../settings/settings.ts");
const { settingsAdapter, SYNCED_SETTINGS } = await import("../sync/settingsAdapter.ts");
const { readConfig } = await import("../config/configSettings.ts");
const { settingsSnapshot } = await import("../telemetry/settingsSnapshot.ts");
const { sidebarEntries } = await import("./entries.ts");
const { entryHeight, firstPaintEntries, foldedGroupHeight, rowSpan } = await import("./geometry.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const profile = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const tab = (i) => ({
  id: `t${i}`, windowId: "w", profileId: "default", url: `https://example.com/${i}`, title: `Tab ${i}`, favicon: null, pinned: false,
  muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, page: { kind: "idle" }, openerId: null, createdAt: i, lastActiveAt: i,
});

function hydrate(sidebarScale, { collapsed = false } = {}) {
  const tabs = Array.from({ length: 40 }, (_, i) => tab(i));
  S().hydrate({
    profiles: { default: profile },
    windows: { w: { id: "w", profileId: "default", kind: "main", tabIds: tabs.map((t) => t.id), activeTabIds: { default: "t0" }, sidebarOpen: true, frame: [0, 0, 1200, 800], createdAt: 0 } },
    tabs: Object.fromEntries(tabs.map((t) => [t.id, t])),
    groups: { g: { id: "g", windowId: "w", profileId: "default", name: "G", icon: null, color: "blue", collapsed, pinned: false, tabIds: ["t2", "t3", "t4", "t5", "t6"], createdAt: 0 } },
    settings: { sidebarScale },
  });
  return sidebarEntries(S(), "w", "default").list;
}

test("the setting saves only one of the offered percentages, and syncs", () => {
  assert.equal(DEFAULT_SETTINGS.sidebarScale, 100);
  assert.equal(parseSettings({ sidebarScale: 90 }).sidebarScale, 90);
  for (const bad of [93, 130, "90", null]) assert.equal(parseSettings({ sidebarScale: bad }).sidebarScale, 100, String(bad));
  assert.ok(SYNCED_SETTINGS.includes("sidebarScale"));
});

test("another Mac's sidebar size applies through sync, and a size this build doesn't offer is ignored", () => {
  hydrate(100);
  settingsAdapter.apply(new Map([["set:sidebarScale", { v: 90 }]]), ["set:sidebarScale"]);
  assert.equal(S().settings.sidebarScale, 90);
  settingsAdapter.apply(new Map([["set:sidebarScale", { v: 92 }]]), ["set:sidebarScale"]);
  assert.equal(S().settings.sidebarScale, 90);
});

test("config.json takes a sidebar size and names the choices when it's wrong", () => {
  const read = (settings) => readConfig(JSON.stringify({ settings }), DEFAULT_SETTINGS);
  assert.deepEqual(read({ sidebarScale: 85 }).patch, { sidebarScale: 85 });
  const wrong = read({ sidebarScale: 130 });
  assert.deepEqual(wrong.patch, {});
  assert.deepEqual(wrong.problems, ["config.json: sidebarScale must be 80, 85, 90, 95, 100, 105, 110, 115 or 120"]);
});

test("the daily settings snapshot reports the chosen size against the default", () => {
  const snap = settingsSnapshot({ ...DEFAULT_SETTINGS, sidebarScale: 90 });
  assert.equal(snap.setting_sidebarScale, "90");
  assert.equal(snap.default_sidebarScale, "100");
});

test("row and group heights follow the size, so reveal and lazy mounting measure what the sidebar draws", () => {
  const list = hydrate(100);
  assert.deepEqual(list.slice(0, 4), ["t:t0", "t:t1", "g:g", "t:t7"]);
  assert.equal(entryHeight(S(), "w", "default", "t:t0"), 34);
  assert.equal(entryHeight(S(), "w", "default", "g:g"), 219.5);
  assert.deepEqual(rowSpan(S(), "w", "default", "t7", false), { section: "list", top: 296.5, height: 34 });
  assert.deepEqual(rowSpan(S(), "w", "default", "t3", false), { section: "list", top: 145.5, height: 34 });

  S().updateSettings({ sidebarScale: 90 });
  assert.equal(entryHeight(S(), "w", "default", "t:t0"), 30.5);
  assert.equal(entryHeight(S(), "w", "default", "g:g"), 196);
  assert.deepEqual(rowSpan(S(), "w", "default", "t7", false), { section: "list", top: 264.5, height: 30.5 });
  assert.deepEqual(rowSpan(S(), "w", "default", "t3", false), { section: "list", top: 130, height: 30.5 });
  assert.deepEqual(rowSpan(S(), "w", "default", "t0", true), { section: "list", top: 33, height: 30.5 });
});

test("a smaller sidebar mounts more rows on first paint, a larger one fewer", () => {
  hydrate(80, { collapsed: true });
  const small = firstPaintEntries(S(), "w", "default", sidebarEntries(S(), "w", "default").list, true);
  hydrate(120, { collapsed: true });
  const large = firstPaintEntries(S(), "w", "default", sidebarEntries(S(), "w", "default").list, true);
  hydrate(100, { collapsed: true });
  const base = firstPaintEntries(S(), "w", "default", sidebarEntries(S(), "w", "default").list, true);
  assert.ok(small > base && base > large, `${small} ${base} ${large}`);
});

test("a folded group's drag pitch shrinks with the size", () => {
  hydrate(100, { collapsed: true });
  const base = foldedGroupHeight("w", "default", "g");
  S().updateSettings({ sidebarScale: 80 });
  const small = foldedGroupHeight("w", "default", "g");
  assert.equal(base, 35);
  assert.equal(small, 28);
});
