import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { sidebarEntries } = await import("./entries.ts");
const { rowSpan } = await import("./geometry.ts");
const { sidebarMenuItems } = await import("./sidebarMenu.ts");
const fold = await import("./pinnedFold.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const collapsed = () => fold.pinnedCollapsed(S(), "default");
const foldItem = (w) => sidebarMenuItems(S(), w).find((it) => it.id === "pinnedFold");

function windowWith(...hosts) {
  S().hydrate({});
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

test("the toggle collapses and expands one profile's pinned section, and leaves the others alone", () => {
  windowWith("a");
  const work = S().createProfile({ name: "Work" });
  assert.equal(collapsed(), false);
  fold.togglePinnedFold("default");
  assert.equal(collapsed(), true);
  assert.equal(fold.pinnedCollapsed(S(), work), false);
  fold.togglePinnedFold("default");
  assert.equal(collapsed(), false);
  fold.setPinnedCollapsed("incognito:w@default", true);
  assert.equal(S().profiles["incognito:w@default"], undefined, "a profile that isn't saved has nothing to remember");
});

test("the sidebar menu says Collapse or Expand Pinned Tabs, is off with nothing pinned, and isn't there with tabs on top", () => {
  const { w, ids } = windowWith("a", "b", "c");
  assert.deepEqual(foldItem(w), { id: "pinnedFold", title: "Collapse Pinned Tabs", symbol: "rectangle.compress.vertical", enabled: false });
  S().pinTabs([ids[1]], true, true);
  assert.equal(foldItem(w).enabled, true);
  fold.runPinnedFold(w, "pinnedFold");
  assert.equal(collapsed(), true);
  assert.deepEqual(foldItem(w), { id: "pinnedFold", title: "Expand Pinned Tabs", symbol: "rectangle.expand.vertical", enabled: true });
  assert.equal(fold.runPinnedFold(w, "newTab"), false);
  fold.runPinnedFold(w, "pinnedFold");
  assert.equal(collapsed(), false);
  S().toggleTabLayout(w);
  assert.equal(foldItem(w), undefined);
});

test("pinning a row or a group into a collapsed section opens it; a Top Apps tile or a pin that arrives new doesn't", () => {
  const { w, ids } = windowWith("a", "b", "c", "d", "e");
  S().pinTabs([ids[0]], true, true);
  fold.setPinnedCollapsed("default", true);
  S().pinTabs([ids[1]], true);
  assert.equal(collapsed(), true, "a tile sits in Top Apps, which stays shown");
  S().newTab(w, { url: "https://f.com/" });
  assert.equal(collapsed(), true);
  S().pinTabs([ids[2]], true, true);
  assert.equal(collapsed(), false, "a row joined the pinned section");
  fold.setPinnedCollapsed("default", true);
  S().groupTabs([ids[3], ids[4]], { pinned: true });
  assert.equal(collapsed(), false, "a pinned group of open tabs joined it");
  fold.setPinnedCollapsed("default", true);
  const before = S();
  const synced = { ...before.tabs[ids[0]], id: "synced", pinnedUrl: "https://s.com/", url: "https://s.com/" };
  useBrowser.setState({ tabs: { ...before.tabs, synced }, windows: { ...before.windows, [w]: { ...before.windows[w], tabIds: [...before.windows[w].tabIds, "synced"] } } });
  assert.equal(collapsed(), true, "a pin made elsewhere (sync, a new window's mirror) leaves it as it is");
});

test("collapsed, the active pinned row is the one row the section shows; the others aren't placed", () => {
  const { w, ids } = windowWith("a", "b", "c", "d");
  S().pinTabs([ids[0], ids[1]], true, true);
  const { pinned } = sidebarEntries(S(), w, "default");
  assert.deepEqual(pinned, [`t:${ids[0]}`, `t:${ids[1]}`]);
  S().activate(ids[1]);
  assert.deepEqual(rowSpan(S(), w, "default", ids[1], false), { section: "pinnedGroups", top: 37, height: 34 });
  fold.setPinnedCollapsed("default", true);
  assert.equal(fold.pinnedKept(S(), w, "default", pinned), `t:${ids[1]}`);
  assert.deepEqual(rowSpan(S(), w, "default", ids[1], false), { section: "pinnedGroups", top: 0, height: 34 });
  assert.equal(rowSpan(S(), w, "default", ids[0], false), null);
  S().activate(ids[3]);
  assert.equal(fold.pinnedKept(S(), w, "default", pinned), null);
  assert.equal(rowSpan(S(), w, "default", ids[3], false)?.section, "list");
});

test("a collapsed section stays collapsed across a relaunch", () => {
  stub.docs.clear();
  const { ids } = windowWith("a", "b");
  const stop = startPersistence();
  S().pinTabs([ids[0]], true, true);
  fold.setPinnedCollapsed("default", true);
  flushPersistence();
  stop();
  S().hydrate({});
  assert.equal(collapsed(), false);
  S().hydrate(loadSession());
  assert.equal(collapsed(), true);
});
