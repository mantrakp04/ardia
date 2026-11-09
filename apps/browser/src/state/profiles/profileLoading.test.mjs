import assert from "node:assert/strict";
import { test } from "node:test";

const setTimeoutHoldingExit = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => {
  const timer = setTimeoutHoldingExit(callback, ms, ...args);
  return ms >= 1_000 ? timer.unref() : timer;
};
globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
const { mount } = await import("../../test-hooks.mjs");
const { useBrowser } = await import("../browser/store.ts");
const { reloadLaunchConfigForTests } = await import("../../platform/launchConfig.ts");
const { reloadSwitches } = await import("../../platform/killSwitches.ts");
const loading = await import("./profileLoading.ts");
const { startBookmarks, reloadBookmarks } = await import("../bookmarks/engineSync.ts");
const { bookmarkRoots } = await import("../bookmarks/bookmarks.ts");
const { startHistory } = await import("../history/engineSync.ts");
const { historyOf } = await import("../history/history.ts");
const { startFavicons, useFavicon } = await import("../favicons/favicons.ts");
const { useProfileDataStats } = await import("./hooks.ts");
const { passwordsAdapter } = await import("../sync/adapters.ts");

const S = () => useBrowser.getState();
const settle = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeoutHoldingExit(r, 0));
};
const until = async (check, what) => {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeoutHoldingExit(r, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
};

const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 },
  play: { id: "play", name: "Play", color: "green", icon: null, createdAt: 2 },
};
const tab = (id, windowId, profileId, url) => ({
  id, windowId, profileId, url, title: id, favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null,
  pinnedUrl: null, page: { kind: "idle" }, openerId: null, createdAt: 0, lastActiveAt: 0,
});
const win = (id, profileId, tabIds, extra = {}) => ({
  id, profileId, kind: "main", tabIds, activeTabIds: { [profileId]: tabIds[0] }, sidebarOpen: true, frame: null, createdAt: 0, ...extra,
});

function launchWith({ settings = {}, switches = {}, windows, loaded = [""], known = true } = {}) {
  stub.docs.delete("switches-cache.json");
  stub.launch.switches = switches;
  reloadLaunchConfigForTests();
  reloadSwitches();
  stub.loadedEngineProfiles.clear();
  for (const engine of loaded) stub.loadedEngineProfiles.add(engine);
  stub.profilesLoadedCall.known = known;
  const ws = windows ?? [win("w1", "work", ["t-work", "t-play", "t-default"])];
  const tabs = [tab("t-work", "w1", "work", "https://work.example/"), tab("t-play", "w1", "play", "https://play.example/"), tab("t-default", "w1", "default", "https://home.example/")];
  for (const w of ws.slice(1)) tabs.push(...w.tabIds.map((id) => tab(id, w.id, w.profileId, `https://${id}.example/`)));
  S().hydrate({
    profiles: PROFILES, profileOrder: ["default", "work", "play"], settings,
    windows: Object.fromEntries(ws.map((w) => [w.id, w])), tabs: Object.fromEntries(tabs.map((t) => [t.id, t])), focusedWindowId: "w1",
  });
  return loading.startProfileLoading();
}

const opened = () => Object.keys(loading.useProfileLoading.getState().opened).sort();
const callsFor = (profile, since = 0) => stub.engineCalls.slice(since).filter((c) => c.profile === profile && c.domain !== "profiles");

test("a launch opens only the profiles its windows show, plus those the engine already loaded", async () => {
  const stop = launchWith();
  await settle();
  assert.equal(loading.useProfileLoading.getState().deferred, true);
  assert.deepEqual(opened(), ["", "work"]);
  assert.equal(loading.profileOpened("play"), false);
  assert.deepEqual(loading.openedEngineProfiles(S()), ["", "work"]);
  stop();
});

test("a private window opens the profile it's private to", async () => {
  const stop = launchWith({ loaded: [], windows: [win("w1", "work", ["t-work", "t-play", "t-default"]), win("w2", "incognito:w2@play", ["p1"], { kind: "private" })] });
  await settle();
  assert.deepEqual(opened(), ["play", "work"]);
  stop();
});

test("off in Settings, off by its kill switch, or on a build without profiles.loaded: every profile loads at launch", async () => {
  for (const options of [{ settings: { loadProfilesWhenOpened: false } }, { switches: { lazyProfiles: false } }, { known: false }]) {
    const stop = launchWith(options);
    await settle();
    assert.equal(loading.useProfileLoading.getState().deferred, false, JSON.stringify(options));
    assert.equal(loading.profileOpened("play"), true);
    assert.deepEqual(loading.openedEngineProfiles(S()), ["", "work", "play"]);
    stop();
  }
});

test("a profile opens when a window shows it, or when the engine loads it for anything else", async () => {
  const stop = launchWith({ loaded: [] });
  await settle();
  const seen = [];
  const listening = loading.onProfilesOpened((engines) => seen.push(engines));
  S().switchProfile("w1", "play");
  assert.equal(loading.profileOpened("play"), true);
  stub.emitEvent("profiles.loaded", { profile: "" });
  assert.equal(loading.profileOpened(""), true);
  assert.deepEqual(seen, [["play"], [""]]);
  listening();
  stop();
});

test("at launch nothing reads a deferred profile; its bookmarks, history and favicons load when it opens, current", async () => {
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  stub.historyDbs.clear();
  stub.chromeFavicons.clear();
  const node = (id, parentId, x) => ({ id, parentId, addedAt: 1, ...x });
  const kept = "0f0f0f0f-0000-4000-8000-00000000b001";
  const renamed = "0f0f0f0f-0000-4000-8000-00000000b002";
  const deleted = "0f0f0f0f-0000-4000-8000-00000000b003";
  const created = "0f0f0f0f-0000-4000-8000-00000000b004";
  stub.docs.set("bookmarks-cache.json", JSON.stringify({ version: 1, trees: { play: [
    node("bar@play", null, { kind: "folder", title: "Bookmarks Bar", children: [kept, renamed, deleted] }),
    node("other@play", null, { kind: "folder", title: "Other Bookmarks", children: [] }),
    node(kept, "bar@play", { kind: "url", title: "Kept", url: "https://kept.example/", favicon: null }),
    node(renamed, "bar@play", { kind: "url", title: "Old name", url: "https://renamed.example/", favicon: null }),
    node(deleted, "bar@play", { kind: "url", title: "Deleted", url: "https://deleted.example/", favicon: null }),
  ] } }));
  stub.chromeBookmarkEdit("play", [
    { op: "add", id: kept, k: "u", t: "Kept", u: "https://kept.example/", a: 1, parent: "bar", index: 0 },
    { op: "add", id: renamed, k: "u", t: "New name", u: "https://renamed.example/", a: 1, parent: "bar", index: 1 },
    { op: "add", id: created, k: "u", t: "Created", u: "https://created.example/", a: 1, parent: "bar", index: 2 },
  ]);
  stub.chromeHistory("play").set("https://played.example/", { title: "Played", visits: [Date.now() - 1000] });
  stub.chromeFavicons.set("play|https://play.example/", "data:image/png;base64,UExBWQ==");

  const stop = launchWith({ loaded: [""] });
  const since = stub.engineCalls.length;
  const stops = [startBookmarks(), startHistory(), startFavicons()];
  const icon = mount(() => useFavicon("https://play.example/", null, "play"));
  const stats = mount(() => useProfileDataStats("play"));
  await settle(12);
  await reloadBookmarks();
  assert.deepEqual(callsFor("play", since), [], "nothing asks the engine for the deferred profile");
  assert.ok(callsFor("work", since).some((c) => c.domain === "history"), "the shown profile loads");
  const titles = () => bookmarkRoots(S(), "play") && S().bookmarks.nodes["bar@play"].children.map((id) => S().bookmarks.nodes[id]?.title);
  assert.deepEqual(titles(), ["Kept", "Old name", "Deleted"], "its bar shows the last tree read until it opens");
  assert.equal(icon.value, null);
  assert.match(stats.value, /^History not loaded yet · 3 bookmarks$/);

  S().switchProfile("w1", "play");
  await until(() => titles()?.join() === "Kept,New name,Created", "Chrome's tree for the opened profile");
  await until(() => historyOf(S(), "play").some((h) => h.url === "https://played.example/"), "its history");
  await until(() => icon.value, "its favicon");
  assert.deepEqual(callsFor("play", since).map((c) => `${c.domain}.${c.verb}`).filter((v) => v === "bookmarks.tree" || v === "history.query" || v === "favicons.get").sort(),
    ["bookmarks.tree", "favicons.get", "history.query"]);
  assert.match(stats.value, /^1 page in history · 3 bookmarks$/);
  assert.ok(!stub.chromeBookmarks("play").has(deleted), "the cache's deleted bookmark isn't written back");
  icon.unmount();
  stats.unmount();
  for (const s of stops) s();
  stop();
});

test("a deferred profile's cached bookmarks survive a cache save and a relaunch, and an edit to them opens it and reaches Chrome", async () => {
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  const node = (id, parentId, x) => ({ id, parentId, addedAt: 1, ...x });
  const cached = "0f0f0f0f-0000-4000-8000-00000000c001";
  stub.docs.set("bookmarks-cache.json", JSON.stringify({ version: 1, trees: { play: [
    node("bar@play", null, { kind: "folder", title: "Bookmarks Bar", children: [cached] }),
    node("other@play", null, { kind: "folder", title: "Other Bookmarks", children: [] }),
    node(cached, "bar@play", { kind: "url", title: "Cached", url: "https://cached.example/", favicon: null }),
  ] } }));
  stub.chromeBookmarkEdit("play", [{ op: "add", id: cached, k: "u", t: "Cached", u: "https://cached.example/", a: 1, parent: "bar", index: 0 }]);
  let stop = launchWith();
  let sync = startBookmarks();
  await reloadBookmarks();
  S().addBookmark({ profileId: "work", url: "https://work-mark.example/", title: "Work mark" });
  sync();
  const trees = JSON.parse(stub.docs.get("bookmarks-cache.json")).trees;
  assert.deepEqual(trees.play.map((n) => n.title).sort(), ["Bookmarks Bar", "Cached", "Other Bookmarks"], "the save keeps the deferred profile's tree");
  stop();

  stop = launchWith();
  sync = startBookmarks();
  await reloadBookmarks();
  assert.equal(S().bookmarks.nodes[cached]?.title, "Cached", "and the next launch shows it");
  assert.equal(loading.profileOpened("play"), false);
  S().addBookmark({ profileId: "play", url: "https://added.example/", title: "Added while deferred" });
  assert.equal(loading.profileOpened("play"), true, "the edit opens the profile");
  await until(() => [...stub.chromeBookmarks("play").values()].some((n) => n.t === "Added while deferred"), "the edit in Chrome");
  assert.ok(stub.chromeBookmarks("play").has(cached), "and nothing else is lost");
  sync();
  stop();
});

test("sync leaves a deferred profile's passwords alone until it opens", async () => {
  const stop = launchWith();
  await settle();
  let reads = 0;
  const logins = { read: async () => (reads++, []), save: async () => true };
  const adapter = passwordsAdapter("play", logins)(true);
  assert.equal(await adapter.extract(), null);
  assert.equal(reads, 0);
  S().switchProfile("w1", "play");
  assert.notEqual(await adapter.extract(), null);
  assert.equal(reads, 1);
  stop();
});

test("a window prepares only opened neighbours for its profile swipe", async () => {
  const stop = launchWith();
  await settle();
  const neighbours = mount(() => loading.useOpenedEngines(["", "play"]));
  assert.deepEqual(neighbours.value, [""]);
  loading.openProfile("play");
  assert.deepEqual(neighbours.value, ["", "play"]);
  neighbours.unmount();
  stop();
});
