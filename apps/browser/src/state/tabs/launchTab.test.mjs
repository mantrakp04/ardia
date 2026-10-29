import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const { launchTab } = await import("./launchTab.ts");
const { loadSession, flushPersistence, startPersistence } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
startPersistence();
const tab = (id, windowId, url, profileId = "default") => ({
  id, windowId, profileId, url, title: "", favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null,
  pinnedUrl: null, page: { kind: "idle" }, openerId: null, createdAt: 0, lastActiveAt: 0,
});
const win = (id, tabIds, active, extra = {}) => ({
  id, profileId: "default", kind: "main", tabIds, activeTabIds: { default: active }, sidebarOpen: true, frame: null, createdAt: 0, ...extra,
});
const PROFILES = {
  default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
  work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 0 },
};
const hydrate = (windows, tabs, extra = {}) =>
  S().hydrate({ profiles: PROFILES, windows: Object.fromEntries(windows.map((w) => [w.id, w])), tabs: Object.fromEntries(tabs.map((t) => [t.id, t])), ...extra });

test("the focused window's active web page, under its engine profile", () => {
  hydrate([win("w1", ["a", "b"], "b"), win("w2", ["c"], "c")], [tab("a", "w1", "https://a.com/"), tab("b", "w1", "https://b.com/x"), tab("c", "w2", "http://c.com/")], { focusedWindowId: "w1" });
  assert.deepEqual(launchTab(S(), (S().ui.focusOrder[0] ?? null)), { id: "b", url: "https://b.com/x", profile: "" });
  assert.deepEqual(launchTab(S(), "w2"), { id: "c", url: "http://c.com/", profile: "" });
  assert.equal(S().tabs.b.page.nav?.url, "https://b.com/x");
});

test("another profile's tab names that profile's engine profile", () => {
  hydrate([win("w1", ["a"], null, { profileId: "work", activeTabIds: { work: "a" } })], [tab("a", "w1", "https://a.com/", "work")], { focusedWindowId: "w1" });
  assert.deepEqual(launchTab(S(), "w1"), { id: "a", url: "https://a.com/", profile: "work" });
});

test("nothing for a page the engine doesn't load at launch", () => {
  for (const url of ["", "about:blank", "ardia://history", "chrome://settings", "file:///tmp/x.html", "javascript:alert(1)"]) {
    hydrate([win("w1", ["a"], "a")], [tab("a", "w1", url)], { focusedWindowId: "w1" });
    assert.equal(launchTab(S(), "w1"), null, url);
  }
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1" });
  assert.equal(launchTab(S(), null), null, "no focused window");
  assert.equal(launchTab(S(), "gone"), null);
  assert.equal(launchTab({ ...S(), settings: { ...S().settings, restoreSession: false } }, "w1"), null, "a session the user doesn't restore");
  assert.equal(launchTab({ ...S(), windows: { w1: { ...S().windows.w1, kind: "private" } } }, "w1"), null, "private");
  assert.equal(launchTab({ ...S(), windows: { w1: { ...S().windows.w1, kind: "small" } } }, "w1"), null, "Little Ardia");
});

test("session.json's hint is what the next launch claims", () => {
  hydrate([win("w1", ["a", "b"], "a"), win("w2", ["c"], "c")], [tab("a", "w1", "https://a.com/"), tab("b", "w1", "https://b.com/"), tab("c", "w2", "https://c.com/")], { focusedWindowId: "w2" });
  S().activate("b");
  S().setFocusedWindow("w1");
  flushPersistence();
  const saved = JSON.parse(stub.docs.get("session.json"));
  assert.deepEqual(saved.launchTab, { id: "b", url: "https://b.com/", profile: "" });
  S().hydrate(loadSession());
  assert.deepEqual(launchTab(S(), (S().ui.focusOrder[0] ?? null)), saved.launchTab);
});

test("a reopened tab not shown yet keeps its back/forward list across a relaunch; nothing else pending does", () => {
  const waking = (id, wake, profileId) => ({ ...tab(id, "w1", `https://${id}.com/`, profileId), page: { kind: "idle", wake } });
  hydrate(
    [win("w1", ["a", "b", "c", "p"], "a")],
    [tab("a", "w1", "https://a.com/"), waking("b", "restore:old-b"), waking("c", "tab:42"), waking("p", "restore:old-p", "incognito:w9@default")],
    { focusedWindowId: "w1" },
  );
  flushPersistence();
  const saved = Object.fromEntries(JSON.parse(stub.docs.get("session.json")).tabs.map((t) => [t.id, t.page.wake]));
  assert.deepEqual(saved, { a: undefined, b: "restore:old-b", c: undefined, p: undefined }, "only a regular tab's restore");
  S().hydrate(loadSession());
  assert.equal(S().tabs.b.page.wake, "restore:old-b");
  S().activate("b");
  assert.equal(S().tabs.b.page.adopt, "restore:old-b", "shown, it wakes with its list");
  S().setFocusedWindow("w1");
  assert.deepEqual(launchTab(S(), "w1"), { id: "b", url: "https://b.com/", profile: "" }, "woken, the next launch loads it by its address");
  S().updateTab("b", { page: { kind: "idle", wake: "restore:old-b" } });
  assert.equal(launchTab(S(), "w1"), null, "not woken yet: it keeps its list");
});

test("a tab the engine made (a link, an extension, DevTools) is the hint once adopted, and the relaunch claims it", () => {
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1" });
  const id = S().newTab("w1", { url: "https://made.example/page", adoptId: "tab:7" });
  assert.equal(S().tabs[id].page.adopt, "tab:7");
  assert.deepEqual(savedHint(), { id, url: "https://made.example/page", profile: "" });
  S().hydrate(loadSession());
  assert.equal(S().tabs[id].page.adopt, undefined, "the relaunch loads it by its address");
  assert.deepEqual(launchTab(S(), (S().ui.focusOrder[0] ?? null)), { id, url: "https://made.example/page", profile: "" });
  assert.equal(S().tabs[id].page.nav?.url, "https://made.example/page");
});

test("no hint when the next launch won't restore the session", () => {
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1" });
  S().updateSettings({ restoreSession: false });
  flushPersistence();
  assert.equal(JSON.parse(stub.docs.get("session.json")).launchTab, null);
});

const savedHint = () => (flushPersistence(), JSON.parse(stub.docs.get("session.json")).launchTab);

test("staleness: a navigation, a switch, a close and a window change all move the hint", () => {
  hydrate([win("w1", ["a", "b"], "a"), win("w2", ["c"], "c")], [tab("a", "w1", "https://a.com/"), tab("b", "w1", "https://b.com/"), tab("c", "w2", "https://c.com/")], { focusedWindowId: "w1" });
  assert.deepEqual(savedHint(), { id: "a", url: "https://a.com/", profile: "" });
  S().updateTab("a", { url: "https://a.com/next", title: "Next" }, { isLoading: false, canGoBack: true, canGoForward: false });
  assert.equal(savedHint().url, "https://a.com/next", "navigated");
  S().activate("b");
  assert.equal(savedHint().id, "b", "switched");
  S().closeTab("b");
  assert.equal(savedHint().id, "a", "closed: the tab shown next");
  S().setFocusedWindow("w2");
  assert.equal(savedHint().id, "c", "another window in front");
  S().updateTab("c", { url: "ardia://history" });
  assert.equal(savedHint(), null, "now one of the app's own pages");
});

test("staleness: after a crash the file read at launch has the hint of its own session", () => {
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1" });
  flushPersistence();
  S().updateTab("a", { url: "https://a.com/lost", title: "" }, { isLoading: false, canGoBack: true, canGoForward: false });
  const onDisk = JSON.parse(stub.docs.get("session.json"));
  S().hydrate(loadSession());
  assert.deepEqual(launchTab(S(), (S().ui.focusOrder[0] ?? null)), onDisk.launchTab);
  assert.equal(onDisk.launchTab.url, "https://a.com/");
});

test("switched off (launchTab): no hint is saved, so the engine starts nothing", async () => {
  const ks = await import("../../platform/killSwitches.ts");
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1" });
  stub.docs.set("switches-cache.json", JSON.stringify({ version: 1, switches: { launchTab: false } }));
  ks.reloadSwitches();
  try {
    S().updateTab("a", { url: "https://a.com/off", title: "" }, { isLoading: false, canGoBack: true, canGoForward: false });
    assert.equal(savedHint(), null);
  } finally {
    stub.docs.delete("switches-cache.json");
    ks.reloadSwitches();
  }
  S().updateTab("a", { url: "https://a.com/on", title: "" }, { isLoading: false, canGoBack: true, canGoForward: false });
  assert.equal(savedHint().url, "https://a.com/on");
});

test("session.json names the profile the next launch opens links from other apps in", () => {
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1", lastProfileId: "work" });
  flushPersistence();
  assert.equal(JSON.parse(stub.docs.get("session.json")).linkProfile, "work");
  hydrate([win("w1", ["a"], "a")], [tab("a", "w1", "https://a.com/")], { focusedWindowId: "w1" });
  flushPersistence();
  assert.equal(JSON.parse(stub.docs.get("session.json")).linkProfile, "");
});
