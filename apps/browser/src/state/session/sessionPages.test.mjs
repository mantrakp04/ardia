import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { flushPersistence, loadSession, startPersistence } = await import("./persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const PROFILE = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const oldTab = (id, extra = {}) => ({
  id, windowId: "w1", profileId: "default", url: `https://${id}.com/`, title: id, favicon: null, pin: null, muted: false, zoom: 1,
  customTitle: null, customIcon: null, pinnedUrl: null, openerId: null, createdAt: 0, lastActiveAt: 0, ...extra,
});
const oldDocument = (version) => ({
  version,
  profiles: { default: PROFILE },
  profileOrder: ["default"],
  windows: [{ id: "w1", profileId: "default", incognito: false, tabIds: ["lazy", "asleep", "reopened", "reopenedAsleep", "chrome", "loaded"], activeTabIds: { default: "loaded" }, sidebarOpen: true, frame: null, createdAt: 0 }],
  windowOrder: ["w1"],
  focusedWindowId: "w1",
  tabs: [
    oldTab("lazy"),
    oldTab("asleep", { unloaded: true }),
    oldTab("reopened", { wakeAdoptId: "restore:old-r" }),
    oldTab("reopenedAsleep", { unloaded: true, wakeAdoptId: "restore:old-s" }),
    oldTab("chrome", { wakeAdoptId: "tab:42" }),
    oldTab("loaded", { navigation: { url: "https://loaded.com/", seq: 3 }, adoptId: "clone:x", pageIn: "nowhere" }),
  ],
  groups: [],
  splits: [],
  closedTabs: [],
  closedWindows: [],
});
const pages = () => Object.fromEntries(["lazy", "asleep", "reopened", "reopenedAsleep", "chrome"].map((id) => [id, S().tabs[id].page]));
const EXPECTED = {
  lazy: { kind: "idle" },
  asleep: { kind: "asleep" },
  reopened: { kind: "idle", wake: "restore:old-r" },
  reopenedAsleep: { kind: "asleep", wake: "restore:old-s" },
  chrome: { kind: "idle" },
};

for (const version of [2, 3, 4]) {
  test(`a version ${version} session.json loads every tab with the page it had: lazy, asleep, waking into its saved list`, () => {
    stub.docs.clear();
    stub.docs.set("session.json", JSON.stringify(oldDocument(version)));
    S().hydrate(loadSession());
    assert.deepEqual(pages(), EXPECTED);
    assert.equal(S().tabs.loaded.page.kind, "loaded", "the shown tab loads at launch");
    assert.equal(S().tabs.loaded.page.nav.url, "https://loaded.com/");
    assert.equal("navigation" in S().tabs.lazy || "unloaded" in S().tabs.asleep || "wakeAdoptId" in S().tabs.reopened || "pageIn" in S().tabs.loaded, false);
  });
}

test("saving writes the current version with only an idle or asleep page and a regular tab's restore id; it reads back the same", () => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify(oldDocument(4)));
  const stop = startPersistence();
  S().updateTab("lazy", { title: "lazy!" });
  flushPersistence();
  stop();
  const saved = JSON.parse(stub.docs.get("session.json"));
  assert.ok(saved.version >= 5);
  const byId = Object.fromEntries(saved.tabs.map((t) => [t.id, t]));
  assert.deepEqual(byId.loaded.page, { kind: "idle" }, "a live page saves as idle");
  assert.deepEqual(byId.reopenedAsleep.page, { kind: "asleep", wake: "restore:old-s" });
  for (const t of saved.tabs) for (const k of ["navigation", "adoptId", "wakeAdoptId", "pageIn", "unloaded"]) assert.equal(k in t, false, `${t.id} has ${k}`);
  S().hydrate(loadSession());
  assert.deepEqual(pages(), EXPECTED);
});

test("a page of a kind the disk never holds, or garbage, reads as idle", () => {
  stub.docs.clear();
  const doc = oldDocument(5);
  doc.tabs = doc.tabs.map((t) => {
    const { unloaded: _u, wakeAdoptId: _w, navigation: _n, adoptId: _a, pageIn: _p, ...rest } = t;
    return { ...rest, page: t.id === "lazy" ? { kind: "frozen", holderId: "x" } : t.id === "asleep" ? "nonsense" : { kind: "idle" } };
  });
  stub.docs.set("session.json", JSON.stringify(doc));
  S().hydrate(loadSession());
  assert.equal(S().tabs.lazy.page.kind, "idle");
  assert.equal(S().tabs.asleep.page.kind, "idle");
});
