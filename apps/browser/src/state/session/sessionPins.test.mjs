import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { flushPersistence, loadSession, startPersistence } = await import("./persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const PROFILE = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const FOLDER = { id: "tf-1", name: "Work", renamedAt: 7 };
const snap = (u, extra = {}) => ({ url: `https://${u}.com/`, title: u, favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, profileId: "default", ...extra });
const tab = (id, extra = {}) => ({ ...snap(id), id, windowId: "w1", pinnedUrl: null, openerId: null, createdAt: 0, lastActiveAt: 0, ...extra });

function oldDocument(version) {
  return {
    version,
    profiles: { default: PROFILE },
    profileOrder: ["default"],
    windows: [{ id: "w1", profileId: "default", incognito: false, tabIds: ["tile", "folded", "row", "plain", "stray"], activeTabIds: { default: "plain" }, sidebarOpen: true, frame: null, createdAt: 0 }],
    windowOrder: ["w1"],
    focusedWindowId: "w1",
    tabs: [
      tab("tile", { pinned: true, pinnedUrl: "https://tile.com/" }),
      tab("folded", { pinned: true, pinnedUrl: "https://folded.com/", tileFolder: FOLDER }),
      tab("row", { pinned: true, pinnedUrl: "https://row.com/", pinnedAsRow: true, tileFolder: FOLDER }),
      tab("plain"),
      tab("stray", { pinnedAsRow: true, tileFolder: FOLDER }),
    ],
    groups: [],
    splits: [],
    closedTabs: [{ kind: "tab", id: "c1", tab: snap("closedRow", { pinned: true, pinnedAsRow: true }), windowId: "w1", index: 0, group: null, closedAt: Date.now() }],
    cleanedTabs: [{ kind: "tab", id: "c2", tab: snap("cleaned", { tileFolder: FOLDER }), windowId: "w1", index: 0, group: null, closedAt: Date.now() }],
    closedWindows: [{ kind: "window", id: "c3", window: { profileId: "default", sidebarOpen: true, frame: null }, tabs: [{ ...snap("inWindow", { pinned: true, tileFolder: FOLDER }), active: true }], groups: [], closedAt: Date.now() }],
    closedGroups: [{ kind: "group", id: "c4", group: { id: "g", name: "G", icon: null, color: null, pinned: true }, tabs: [snap("member")], windowId: "w1", index: 0, closedAt: Date.now() }],
    deletedGroups: [{ kind: "group", id: "c5", group: { id: "h", name: "H", icon: null, color: null, pinned: false }, tabs: [snap("deleted", { pinned: true })], windowId: "w1", index: 0, closedAt: Date.now() }],
    parkedPins: { default: { tabs: [{ ...snap("parked", { pinned: true, tileFolder: FOLDER }), id: "parked", groupId: null }, { ...snap("parkedRow", { pinned: true, pinnedAsRow: true }), id: "parkedRow", groupId: null }], groups: [] } },
  };
}

const TILE = { as: "tile" };
const ROW = { as: "row" };
const FOLDED = { as: "tile", folder: FOLDER };

function assertPins() {
  const s = S();
  assert.deepEqual(
    Object.fromEntries(["tile", "folded", "row", "plain", "stray"].map((id) => [id, s.tabs[id].pin])),
    { tile: TILE, folded: FOLDED, row: ROW, plain: null, stray: null },
    "a row has no folder, and an unpinned tab's stray row and folder flags are gone",
  );
  assert.deepEqual(s.closedTabs[0].tab.pin, ROW);
  assert.equal(s.cleanedTabs[0].tab.pin, null);
  assert.deepEqual(s.closedWindows.at(-1).tabs[0].pin, FOLDED);
  assert.equal(s.closedGroups[0].tabs[0].pin, null);
  assert.deepEqual(s.deletedGroups[0].tabs[0].pin, TILE);
  assert.deepEqual(s.parkedPins.default.tabs.map((p) => p.pin), [FOLDED, ROW]);
  for (const t of [...Object.values(s.tabs), ...s.closedTabs.map((c) => c.tab), ...s.parkedPins.default.tabs])
    for (const k of ["pinned", "pinnedAsRow", "tileFolder"]) assert.equal(k in t, false, `${t.id ?? t.url} has ${k}`);
}

for (const version of [2, 3, 4, 5]) {
  test(`a version ${version} session.json loads every tab and saved tab with one pin: tile, folder, row or none`, () => {
    stub.docs.clear();
    stub.docs.set("session.json", JSON.stringify(oldDocument(version)));
    S().hydrate(loadSession());
    assertPins();
  });
}

test("the pins save as they are and read back the same", () => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify(oldDocument(5)));
  const stop = startPersistence();
  S().updateTab("plain", { title: "touched" });
  flushPersistence();
  stop();
  const saved = JSON.parse(stub.docs.get("session.json"));
  assert.ok(saved.version >= 6);
  assert.deepEqual(saved.tabs.find((t) => t.id === "folded").pin, FOLDED);
  S().hydrate(loadSession());
  assertPins();
});

test("a pin of a kind this version doesn't know, or a broken folder, reads as unpinned or a plain tile", () => {
  stub.docs.clear();
  const doc = oldDocument(6);
  doc.tabs = doc.tabs.map(({ pinned: _p, pinnedAsRow: _r, tileFolder: _f, ...t }) => ({ ...t, pin: t.id === "tile" ? { as: "dock" } : t.id === "folded" ? { as: "tile", folder: { id: 3 } } : t.id === "row" ? "row" : null }));
  stub.docs.set("session.json", JSON.stringify(doc));
  S().hydrate(loadSession());
  assert.equal(S().tabs.tile.pin, null);
  assert.deepEqual(S().tabs.folded.pin, TILE);
  assert.equal(S().tabs.row.pin, null);
});

test("a duplicated group and a reopened closed group make tabs with one pin field, nothing from the old shape", () => {
  stub.docs.clear();
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const b = S().newTab(w, { url: "https://b.com/", background: true });
  const c = S().newTab(w, { url: "https://c.com/", background: true });
  const g = S().groupTabs([b, c], { pinned: false, name: "G" });
  const copy = S().duplicateGroup(g);
  S().deleteGroup(g);
  S().reopenClosedTab();
  const made = Object.values(S().tabs).filter((t) => t.id !== b && t.id !== c && t.url !== "https://a.com/");
  assert.ok(made.length >= 2 && S().groups[copy]);
  for (const t of made) assert.equal("pinned" in t, false, `${t.url} has the old pinned field`);
});
