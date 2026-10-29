import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { bookmarkRoots } = await import("../bookmarks/bookmarks.ts");
const model = await import("../browser/model.ts");
const { migrateHistoryFile, reloadHistory, startHistory } = await import("../history/engineSync.ts");
const { historyOf } = await import("../history/history.ts");
const { reloadBookmarks, startBookmarks } = await import("../bookmarks/engineSync.ts");
const { flushPersistence, loadSession, startPersistence } = await import("./persist.ts");
const { firstWindowCommitted } = await import("../../lib/afterFirstWindow.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const view = (w) => model.viewTabIds(S(), w).map((id) => S().tabs[id].url);
const active = (w) => model.activeTabId(S(), w);

let clock = Date.now();
function at(fn) {
  const now = Date.now;
  Date.now = () => (clock += 1000);
  try {
    return fn();
  } finally {
    Date.now = now;
  }
}
const select = (id) => at(() => S().activate(id));

function windowWith(...hosts) {
  const w = at(() => S().createWindow({ url: `${hosts[0]}.com` }));
  const ids = [model.viewTabIds(S(), w)[0]];
  for (const h of hosts.slice(1)) ids.push(at(() => S().newTab(w, { url: `${h}.com` })));
  return { w, ids };
}

test("hydrate repairs dangling references", () => {
  S().hydrate({
    profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } },
    windows: {
      w1: { id: "w1", profileId: "gone", kind: "main", tabIds: ["t1", "missing"], activeTabIds: { gone: "missing" }, sidebarOpen: true, frame: null, createdAt: 0 },
      w2: { id: "w2", profileId: "default", kind: "main", tabIds: [], activeTabIds: {}, sidebarOpen: true, frame: null, createdAt: 0 },
    },
    tabs: {
      t1: { id: "t1", windowId: "w1", profileId: "default", url: "https://a.com", title: "", favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null, page: { kind: "idle" }, openerId: null, createdAt: 0, lastActiveAt: 0 },
      t2: { id: "t2", windowId: "nowhere", profileId: "default", url: "https://b.com", title: "", favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null, page: { kind: "idle" }, openerId: null, createdAt: 0, lastActiveAt: 0 },
    },
    groups: { g: { id: "g", windowId: "w1", profileId: "default", name: "", icon: null, color: null, collapsed: false, pinned: false, tabIds: ["missing"], createdAt: 0 } },
  });
  assert.deepEqual(S().windowOrder, ["w1"]);
  assert.equal(S().windows.w1.profileId, "default");
  assert.equal(active("w1"), "t1");
  assert.equal(S().tabs.t2, undefined);
  assert.deepEqual(S().groups, {});
});

test("a reopened window's tabs wake with their back/forward list", () => {
  reset();
  S().createWindow({ url: "keep.com" });
  const w = S().createWindow({ url: "a.com" });
  const [a] = S().windows[w].tabIds;
  const b = S().newTab(w, { url: "b.com", background: true });
  const lazy = S().newTab(w, { url: "c.com", background: true, snapshot: { url: "https://c.com" } });
  S().updateTab(lazy, { page: { kind: "idle" } });
  S().closeWindow(w);
  S().reopenClosedWindow();
  const w2 = S().windowOrder.at(-1);
  const [ra, rb, rc] = S().windows[w2].tabIds.map((id) => S().tabs[id]);
  assert.match(ra.page.adopt, new RegExp(`^restore:${a}$`), "the shown tab loads with its history");
  assert.match(rb.page.wake, new RegExp(`^restore:${b}$`), "the others keep it until they wake");
  assert.equal(rb.page.nav, undefined);
  assert.equal(rc.page.wake, undefined, "a tab that never loaded has none");
  S().activate(rb.id);
  assert.match(S().tabs[rb.id].page.adopt, new RegExp(`^restore:${b}$`));
  assert.equal(S().tabs[rb.id].page.wake, undefined);
});

test("profiles sharing data read one engine's history and bookmarks after the session is saved and loaded again", async () => {
  reset();
  stub.docs.clear();
  stub.historyDbs.clear();
  const stopSaving = startPersistence();
  const a = S().createProfile({ name: "A" });
  const b = S().createProfile({ name: "B", shareWith: a });
  stub.chromeVisit(a, "https://a.com/", "A");
  stub.chromeBookmarkEdit(a, [{ op: "add", id: "0f0f0f0f-0000-4000-8000-0000000000b1", k: "u", t: "Shared", u: "https://shared.example/", a: 1, parent: "bar" }]);
  flushPersistence();
  stopSaving();
  reset();
  useBrowser.setState({ bookmarks: { nodes: {} }, history: {} });
  assert.equal(model.engineProfile(S(), b), b, "registry follows the loaded profiles");
  S().hydrate(loadSession());
  assert.equal(model.engineProfile(S(), b), a);
  const stops = [startHistory(), startBookmarks()];
  await reloadHistory();
  await reloadBookmarks();
  const barOf = (profileId) => S().bookmarks.nodes[bookmarkRoots(S(), profileId).bar].children.map((id) => S().bookmarks.nodes[id].title);
  assert.deepEqual(historyOf(S(), b).map((h) => h.url), ["https://a.com/"]);
  assert.equal(historyOf(S(), a), historyOf(S(), b));
  assert.deepEqual(barOf(b), ["Shared"]);
  assert.deepEqual(bookmarkRoots(S(), a), bookmarkRoots(S(), b));
  stops.forEach((stop) => stop());
});

const flushEvents = () => new Promise((r) => setTimeout(r, 0));
const DAY = 86_400_000;

test("history.json moves into Chrome once: Chrome's own visits aren't doubled, a second run adds nothing", async () => {
  reset();
  stub.docs.clear();
  stub.historyDbs.clear();
  const now = Date.now();
  const work = S().createProfile({ name: "Work" });
  const shared = S().createProfile({ name: "Shared", shareWith: work });
  stub.chromeVisit("", "https://a.com/", "A", now - DAY + 20_000);
  stub.chromeVisit("", "https://d.com/", "D", now - DAY);
  const entry = (url, times, title = url) => ({ url, title, favicon: null, visits: times.length, lastVisit: times.at(-1), visitTimes: times });
  const list = [
    entry("https://a.com/", [now - DAY]),
    entry("https://b.com/", [now - 3 * DAY, now - 2 * DAY]),
    entry("https://d.com/", [now - DAY, now - DAY + 30_000]),
    entry("https://old.com/", [now - 200 * DAY]),
  ];
  const workList = [entry("https://c.com/", [now - DAY])];
  stub.docs.set("history.json", JSON.stringify({ version: 2, history: { default: list, [work]: workList, [shared]: workList, gone: [entry("https://x.com/", [now])] } }));

  assert.equal(await migrateHistoryFile(now, { keepMs: 0 }), "moved");
  const visits = (profile, url) => stub.chromeHistory(profile).get(url)?.visits.length ?? 0;
  assert.equal(visits("", "https://a.com/"), 1, "a visit Chrome has isn't added again");
  assert.equal(visits("", "https://b.com/"), 2);
  assert.equal(visits("", "https://d.com/"), 2, "one visit Chrome has accounts for one saved visit");
  assert.equal(visits("", "https://old.com/"), 0, "Chrome has expired what's older than 90 days");
  assert.equal(visits(work, "https://c.com/"), 1, "profiles sharing data add their list once");
  assert.equal(stub.historyDbs.get(null).has("gone"), false, "a deleted profile's list goes");
  assert.equal(stub.docs.has("history.json"), false, "the file is deleted");

  stub.docs.set("history.json", JSON.stringify({ version: 2, history: { default: list, [work]: workList } }));
  assert.equal(await migrateHistoryFile(now, { keepMs: 0 }), "moved");
  assert.deepEqual([visits("", "https://a.com/"), visits("", "https://b.com/"), visits("", "https://d.com/"), visits(work, "https://c.com/")], [1, 2, 2, 1]);
  assert.equal(await migrateHistoryFile(now, { keepMs: 0 }), "none");
});

test("history.json's move goes before watching Chrome's history; the view then has the moved visits", async () => {
  reset();
  stub.docs.clear();
  stub.historyDbs.clear();
  stub.historyWatches.length = 0;
  const now = Date.now();
  const entry = (url, times) => ({ url, title: url, favicon: null, visits: times.length, lastVisit: times.at(-1), visitTimes: times });
  stub.docs.set("history.json", JSON.stringify({ version: 2, history: { default: [entry("https://moved.com/", [now - DAY, now - 1000])] } }));
  const stop = startHistory();
  assert.deepEqual(stub.historyWatches, [], "not watched while the file moves");
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(stub.docs.has("history.json"));
  assert.equal(stub.chromeHistory("").size, 0, "nothing moved before the first window");
  firstWindowCommitted();
  for (let i = 0; i < 50 && !historyOf(S(), "default").length; i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(stub.historyWatches, [""], "watched once it's in");
  assert.equal(historyOf(S(), "default")[0]?.url, "https://moved.com/");
  assert.equal(historyOf(S(), "default")[0].visits, 2);
  stop();
});

test("history is a view of Chrome's: visits, deletions and a relaunch all read back what Chrome has", async () => {
  reset();
  stub.docs.clear();
  stub.historyDbs.clear();
  const stop = startHistory();
  await reloadHistory();
  const urls = () => historyOf(S(), "default").map((h) => h.url);
  stub.chromeVisit("", "https://a.com/", "A");
  stub.chromeVisit("", "https://b.com/", "B");
  await flushEvents();
  assert.deepEqual(urls(), ["https://b.com/", "https://a.com/"]);
  assert.ok(S().history[""].ready);

  S().removeHistory("default", ["https://a.com/"]);
  assert.deepEqual(urls(), ["https://b.com/"], "gone from the view at once");
  await flushEvents();
  assert.equal(stub.chromeHistory("").has("https://a.com/"), false, "and from Chrome");
  await reloadHistory();
  assert.deepEqual(urls(), ["https://b.com/"], "a relaunch doesn't bring it back");

  const before = historyOf(S(), "default");
  await reloadHistory();
  assert.deepEqual(historyOf(S(), "default"), before);
  stop();
});

test("⌘W on a pinned tab unloads its page; the tile stays with its title, icon and pinned URL", () => {
  reset();
  const { w, ids: [p, a] } = windowWith("mail", "a");
  S().togglePin(p);
  S().updateTab(p, { title: "Inbox", favicon: "data:mail" });
  select(p);
  S().closeTab(p);
  const tile = S().tabs[p];
  assert.ok(tile, "the pinned tab still exists");
  assert.equal(!!tile.pin, true);
  assert.equal(tile.url, "https://mail.com");
  assert.equal(tile.title, "Inbox");
  assert.equal(tile.favicon, "data:mail");
  assert.equal(tile.page.nav, undefined, "no page: its web view unmounts");
  assert.equal(tile.page.adopt, undefined);
  assert.equal(tile.page.kind, "asleep");
  assert.deepEqual(view(w), ["https://mail.com", "https://a.com"]);
  assert.equal(active(w), a);
});

test("holding ⌘W over pinned tiles ends by closing the window: no unloaded page wakes", () => {
  reset();
  const { w, ids: [x] } = windowWith("x", "a");
  S().togglePin(x);
  select(x);
  const wakes = [];
  for (let i = 0; i < 10 && S().windows[w]; i++) {
    const before = S().tabs[x].page.nav;
    S().closeTab(active(w));
    if (S().windows[w] && !before && S().tabs[x].page.nav) wakes.push(i);
  }
  assert.deepEqual(wakes, [], "x.com never loads again");
  assert.equal(S().windows[w], undefined, "the window closed, as in Dia");
  assert.deepEqual(S().parkedPins.default.tabs.map((t) => t.id), [x], "the tile waits for the profile's next window");
});

const sidebar = (w) =>
  model.viewTabIds(S(), w).filter((id) => model.inPinnedContainer(S(), id)).map((id) => {
    const t = S().tabs[id];
    const g = Object.values(S().groups).find((g) => g.tabIds.includes(id));
    return `${g ? `${g.name}/` : ""}${t.url}${t.page.nav || t.page.adopt ? " (loaded)" : ""}`;
  });

function pinnedWindow() {
  const { w, ids: [mail, docs, jira, wiki, a] } = windowWith("mail", "docs", "jira", "wiki", "a");
  S().togglePin(mail);
  S().togglePin(docs);
  const work = S().groupTabs([jira, wiki], { pinned: true });
  S().updateGroup(work, { name: "Work" });
  select(a);
  select(mail);
  return { w, mail, work };
}
const PINS = ["https://mail.com", "https://docs.com", "Work/https://jira.com", "Work/https://wiki.com"];

test("⌘W until the window closes, then ⌘N: the pinned tabs and pinned groups are back, in order, unloaded", () => {
  reset();
  const { w, mail, work } = pinnedWindow();
  assert.deepEqual(sidebar(w), ["https://mail.com (loaded)", "https://docs.com (loaded)", "Work/https://jira.com (loaded)", "Work/https://wiki.com (loaded)"]);
  for (let i = 0; i < 12 && S().windows[w]; i++) S().closeTab(active(w));
  assert.equal(S().windows[w], undefined, "the window closed");
  const n = S().createWindow();
  assert.deepEqual(sidebar(n), PINS, "same tiles, same order, the group still pinned, nothing loaded");
  assert.equal(S().tabs[active(n)].url, "", "the new window shows a New Tab page");
  assert.equal(S().tabs[mail].windowId, n, "same tab id (its key in sync)");
  assert.equal(S().groups[work].pinned, true);
  assert.deepEqual(S().parkedPins, {}, "the park is empty");
  const n2 = S().createWindow();
  assert.deepEqual(sidebar(n2), PINS, "a second window shows them too, unloaded copies (store/pinMirror.ts)");
});

test("⇧⌘T after the close, then ⌘N: no second set of pinned tabs", () => {
  reset();
  const { w } = pinnedWindow();
  S().closeWindow(w);
  S().reopenClosed(null);
  const restored = (S().ui.focusOrder[0] ?? null);
  assert.notEqual(restored, w);
  assert.deepEqual(sidebar(restored), PINS, "the reopened window has them");
  assert.deepEqual(model.viewTabIds(S(), restored).filter((id) => !model.inPinnedContainer(S(), id)).map((id) => S().tabs[id].url), ["https://a.com"]);
  const n = S().createWindow();
  assert.deepEqual(sidebar(n), PINS, "⌘N: the same pins, one copy each");
  assert.equal(Object.values(S().tabs).filter((t) => t.windowId === restored && t.url === "https://mail.com").length, 1, "no second set in the reopened window");
});

test("quit and relaunch after the window closed: the next window has the pinned tabs, unloaded", () => {
  stub.docs.clear();
  reset();
  const stop = startPersistence();
  const { w } = pinnedWindow();
  S().closeWindow(w);
  flushPersistence();
  stop();
  S().hydrate(loadSession());
  assert.equal(S().windowOrder.length, 0, "no window restored");
  const n = S().createWindow();
  assert.deepEqual(sidebar(n), PINS);
});

test("a session.json with the right version but broken lists loads what is whole and drops the rest", () => {
  reset();
  const tab = { id: "t1", windowId: "w1", profileId: "default", url: "https://kept.example/", title: "Kept", favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, openerId: null, createdAt: 0, lastActiveAt: 0 };
  const window = { id: "w1", profileId: "default", incognito: false, tabIds: ["t1"], activeTabIds: { default: "t1" }, sidebarOpen: true, frame: null, createdAt: 0 };
  for (const broken of [
    { windows: {}, tabs: {}, groups: "no", splits: 7, closedTabs: null },
    { windows: [{ id: "w2", profileId: "default" }, window, 3, null], tabs: [tab, { id: "t2" }, "x"], groups: [{ id: "g", tabIds: "t1" }], closedTabs: [{ id: "c" }], closedWindows: [{ id: "cw", tabs: [null] }] },
  ]) {
    stub.docs.set("session.json", JSON.stringify({ version: 4, profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } }, profileOrder: ["default"], ...broken }));
    reset();
    assert.doesNotThrow(() => S().hydrate(loadSession() ?? {}));
  }
  assert.deepEqual(Object.keys(S().windows), ["w1"]);
  assert.equal(S().tabs.t1.url, "https://kept.example/");
  assert.deepEqual(S().groups, {});
  assert.deepEqual(S().closedTabs, []);
  assert.deepEqual(S().closedWindows, []);
  stub.docs.delete("session.json");
});
