import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./store.ts");
const model = await import("./model.ts");
const { cleanedTabsFor } = await import("../pins/closedTabs.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const { startFavicons } = await import("../favicons/favicons.ts");
const { startHistory } = await import("../history/engineSync.ts");
const { historyOf } = await import("../history/history.ts");
const { startBookmarks } = await import("../bookmarks/engineSync.ts");
const { startProfileDataCleanup } = await import("../spaces/spaceData.ts");
const { startPrivateSessions } = await import("../windows/privateSessions.ts");
const startApp = () => {
  const stops = [startPersistence(), startFavicons(), startHistory(), startBookmarks(), startProfileDataCleanup(), startPrivateSessions()];
  return () => stops.forEach((stop) => stop());
};
const drop = await import("../drag/windowDrop.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const HOUR = 3_600_000;
const OLD = () => Date.now() - 13 * HOUR;
const saved = () => stub.docs.get("session.json") ?? "";
const settle = () => new Promise((resolve) => setTimeout(resolve, 1700));

function privateWindowWith(...urls) {
  const w = S().createWindow({ kind: "private", url: urls[0] });
  const ids = [model.viewTabIds(S(), w)[0]];
  for (const url of urls.slice(1)) ids.push(S().newTab(w, { url }));
  return { w, ids };
}


test("incognito window: own space, closing records nothing, history ignored", () => {
  S().hydrate({});
  const w = S().createWindow({ kind: "private", url: "secret.com" });
  const tab = S().tabs[model.activeTabId(S(), w)];
  assert.equal(tab.spaceId, `incognito:${w}@default`);
  stub.historyDbs.clear();
  assert.equal(S().importHistory(tab.spaceId, [{ url: "https://secret.com/", title: "S", visits: 1, lastVisit: Date.now() }]), 0);
  S().removeHistory(tab.spaceId, ["https://secret.com/"]);
  assert.equal(S().history[model.engineProfileForSpace(S(), tab.spaceId)], undefined);
  assert.equal(stub.historyDbs.size, 0, "nothing reaches Chrome's history, not even the default space's");
  S().newTab(w, { url: "x.com" });
  S().closeTab(model.viewTabIds(S(), w)[1]);
  assert.equal(S().closedTabs.length, 1);
  S().closeWindow(w);
  assert.equal(S().closedTabs.length, 0);
  assert.equal(S().closedWindows.length, 0);
});

test("cleaning up a private window keeps its tabs in memory, out of session.json, and in that window", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startApp();
  const normal = S().createWindow({ url: "https://public.example/" });
  const { w, ids: [, stale, dupe] } = privateWindowWith("https://secret.example/a", "https://secret.example/old", "https://secret.example/a");
  S().activate(model.viewTabIds(S(), w)[0]);
  S().updateTab(stale, { lastActiveAt: OLD() });
  assert.equal(S().cleanUpTabs(w), 2);
  assert.ok(!S().tabs[stale] && !S().tabs[dupe]);

  assert.equal(S().cleanedTabs.length, 0, "the saved list never sees private tabs");
  assert.equal(cleanedTabsFor(S(), w).length, 2);
  assert.equal(cleanedTabsFor(S(), normal).length, 0, "a regular window doesn't list them");
  flushPersistence();
  assert.ok(saved().includes("public.example"));
  assert.ok(!saved().includes("secret.example"));

  S().restoreCleaned(undefined, normal);
  S().restoreCleaned(cleanedTabsFor(S(), w)[0].id, normal);
  assert.equal(model.viewTabIds(S(), normal).length, 1);
  assert.equal(cleanedTabsFor(S(), w).length, 1, "an entry id alone still restores into its own window");
  S().restoreCleaned(undefined, w);
  assert.equal(cleanedTabsFor(S(), w).length, 0);
  assert.equal(model.viewTabIds(S(), w).length, 3);
  assert.ok(model.viewTabIds(S(), w).every((id) => model.isIncognitoSpace(S().tabs[id].spaceId)));

  S().updateTab(model.viewTabIds(S(), w)[1], { lastActiveAt: OLD() });
  S().cleanUpTabs(w);
  assert.equal(cleanedTabsFor(S(), w).length, 1);
  S().closeWindow(w);
  assert.deepEqual(S().privateCleanedTabs, {}, "closing the window forgets them");
  flushPersistence();
  assert.ok(!saved().includes("secret.example"));
  stop();
});

test("private entries an older build saved are dropped when the session loads, and never written again", () => {
  stub.docs.clear();
  const privateEntry = {
    kind: "tab", id: "ct-old", windowId: "w-private", index: 0, group: null, closedAt: Date.now(),
    tab: { url: "https://secret.example/", title: "Secret", favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null, spaceId: "incognito:w-private" },
  };
  const publicEntry = { ...privateEntry, id: "ct-ok", tab: { ...privateEntry.tab, url: "https://public.example/", spaceId: "default" } };
  stub.docs.set("session.json", JSON.stringify({ version: 8, profiles: { default: { id: "default", name: "Personal", icon: null, engineId: "", createdAt: 0 } }, spaces: { default: { id: "default", name: "Personal", color: "plum", icon: null, profileId: "default", createdAt: 0 } }, spaceOrder: ["default"], settings: {}, windows: [], windowOrder: [], focusedWindowId: null, tabs: [], groups: [], splits: [], closedTabs: [], closedWindows: [], cleanedTabs: [privateEntry, publicEntry] }));
  const stop = startApp();
  assert.deepEqual(S().cleanedTabs.map((c) => c.id), ["ct-ok"]);
  S().createWindow({ url: "https://public.example/" });
  flushPersistence();
  assert.ok(!saved().includes("secret.example"));
  stop();
  const data = loadSession();
  assert.deepEqual(data.cleanedTabs.map((c) => c.id), ["ct-ok"]);
});

test("cleaned tabs leave Recently Cleaned a week after their clean-up", () => {
  stub.docs.clear();
  const DAY = 24 * HOUR;
  const entry = (id, url, closedAt) => ({
    kind: "tab", id, windowId: "w-gone", index: 0, group: null, closedAt,
    tab: { url, title: id, favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null, spaceId: "default" },
  });
  const stale = entry("ct-stale", "https://stale.example/", Date.now() - 8 * DAY);
  const recent = entry("ct-recent", "https://recent.example/", Date.now() - HOUR);
  stub.docs.set("session.json", JSON.stringify({ version: 8, profiles: { default: { id: "default", name: "Personal", icon: null, engineId: "", createdAt: 0 } }, spaces: { default: { id: "default", name: "Personal", color: "plum", icon: null, profileId: "default", createdAt: 0 } }, spaceOrder: ["default"], settings: {}, windows: [], windowOrder: [], focusedWindowId: null, tabs: [], groups: [], splits: [], closedTabs: [], closedWindows: [], cleanedTabs: [stale, recent] }));
  const stop = startApp();
  assert.deepEqual(S().cleanedTabs.map((c) => c.id), ["ct-recent"], "launch drops the entry older than a week");
  const w = S().createWindow({ url: "https://public.example/" });
  assert.deepEqual(cleanedTabsFor(S(), w).map((c) => c.id), ["ct-recent"]);

  useBrowser.setState({ cleanedTabs: [stale, recent] });
  assert.deepEqual(cleanedTabsFor(S(), w).map((c) => c.id), ["ct-recent"], "the list and its count read only the last 7 days");
  S().restoreCleaned(undefined, w);
  const urls = model.viewTabIds(S(), w).map((id) => S().tabs[id].url);
  assert.ok(urls.includes("https://recent.example/"));
  assert.ok(!urls.includes("https://stale.example/"), "Restore All brings back only the recent one");

  useBrowser.setState({ cleanedTabs: [stale] });
  const old = S().newTab(w, { url: "https://idle.example/" });
  S().activate(model.viewTabIds(S(), w)[0]);
  S().updateTab(old, { lastActiveAt: OLD() });
  S().cleanUpTabs(w);
  assert.ok(!S().cleanedTabs.some((c) => c.id === "ct-stale"), "the next clean-up drops the expired entry");
  assert.ok(S().cleanedTabs.some((c) => c.tab.url === "https://idle.example/"));
  stop();
});

test("session.json filters private tabs out of every closed and parked list", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startApp();
  S().createWindow({ url: "https://public.example/" });
  const snap = { url: "https://secret.example/", title: "", favicon: null, pin: null, muted: false, zoom: 1, customTitle: null, customIcon: null, spaceId: "incognito:w-x" };
  useBrowser.setState({
    closedTabs: [{ kind: "tab", id: "c1", tab: snap, windowId: "w-x", index: 0, group: null, closedAt: 1 }],
    closedWindows: [{ kind: "window", id: "c2", window: { spaceId: "incognito:w-x", sidebarOpen: true, frame: null }, tabs: [{ ...snap, active: true }], groups: [], closedAt: 1 }],
    closedGroups: [{ kind: "group", id: "c3", group: { id: "g", name: "", icon: null, color: null, pinned: false }, tabs: [snap], windowId: "w-x", index: 0, closedAt: 1 }],
    deletedGroups: [{ kind: "group", id: "c4", group: { id: "g", name: "", icon: null, color: null, pinned: false }, tabs: [snap], windowId: "w-x", index: 0, closedAt: Date.now() }],
    parkedPins: { "incognito:w-x": { tabs: [{ ...snap, id: "t", groupId: null }], groups: [] } },
  });
  flushPersistence();
  assert.ok(saved().includes("public.example"));
  assert.ok(!saved().includes("secret.example"));
  assert.ok(!saved().includes("incognito:"));
  stop();
});

const download = (id, space, state = "finished") => ({
  id,
  url: `https://files.example/${id}`,
  filename: `${id}.zip`,
  path: `/tmp/${id}.zip`,
  state,
  paused: false,
  received: 1,
  total: 1,
  speed: 0,
  mimeType: "application/zip",
  profile: space,
});

test("incognito downloads never reach downloads.json and leave with their window", () => {
  stub.docs.clear();
  S().hydrate({});
  const stop = startApp();
  const normal = S().createWindow();
  const incognito = S().createWindow({ kind: "private" });
  const privateSpace = S().windows[incognito].spaceId;
  S().upsertDownload(download("1", ""));
  S().upsertDownload(download("2", privateSpace, "downloading"));
  flushPersistence();
  const savedDownloads = JSON.parse(stub.docs.get("downloads.json")).downloads;
  assert.deepEqual(savedDownloads.map((d) => d.id), ["1"]);

  S().closeWindow(incognito);
  assert.deepEqual(S().downloads.map((d) => d.id), ["1"]);
  assert.ok(S().windows[normal]);
  S().upsertDownload(download("2", privateSpace, "cancelled"));
  assert.deepEqual(S().downloads.map((d) => d.id), ["1"]);

  const data = loadSession();
  assert.deepEqual(data.downloads.map((d) => d.id), ["saved-0"]);
  stop();
});

test("favicons: incognito icons stay in memory and in their own space; nothing is written", async () => {
  const { noteFavicon, resolveFavicon, useFavicons } = await import("../favicons/favicons.ts");
  const { webviews } = await import("../../platform/webviews.ts");
  stub.docs.clear();
  const stop = startApp();
  const normal = S().createWindow({ url: "https://site.example/a" });
  const incognito = S().createWindow({ kind: "private", url: "https://secret.example/x" });
  const [normalTab] = S().windows[normal].tabIds;
  const [privateTab] = S().windows[incognito].tabIds;
  const privateSpace = S().windows[incognito].spaceId;
  const handle = (uri) => ({ downloadFavicon: () => Promise.resolve({ uri, width: 32, height: 32 }) });
  webviews.set(normalTab, handle("data:image/png;base64,SITE"));
  webviews.set(privateTab, handle("data:image/png;base64,AAAA"));

  noteFavicon(normalTab, "https://site.example/favicon.ico");
  noteFavicon(privateTab, "https://secret.example/favicon.ico");
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(resolveFavicon("https://site.example/a")?.uri, "data:image/png;base64,SITE");
  assert.equal(resolveFavicon("https://secret.example/x"), null);
  assert.equal(resolveFavicon("https://secret.example/x", null, "default"), null);
  assert.equal(resolveFavicon("https://secret.example/x", null, privateSpace)?.uri, "data:image/png;base64,AAAA");
  assert.equal(resolveFavicon("https://site.example/a", null, privateSpace)?.uri, "data:image/png;base64,SITE");

  flushPersistence();
  assert.ok(![...stub.docs.keys()].some((k) => k.startsWith("favicons")), "Chrome keeps icons; the app writes none");
  assert.ok(![...stub.docs.values()].some((v) => String(v).includes("secret.example")));

  S().closeWindow(incognito);
  assert.equal(useFavicons.getState().spaces[privateSpace], undefined);
  webviews.clear();
  stop();
});

test("incognito windows neither give nor take dragged tabs", () => {
  S().hydrate({});
  const b = S().createWindow({ url: "c.com" });
  S().setWindowFrame(b, [1000, 100, 800, 600]);
  const i = S().createWindow({ kind: "private", url: "d.com" });
  S().newTab(i, { url: "e.com" });
  S().setWindowFrame(i, [0, 100, 800, 600]);
  const [tab] = model.viewTabIds(S(), i);
  assert.deepEqual(drop.windowUnder(S(), i, 1200, 300), { outside: true, overWindow: null });
  assert.equal(drop.dropTabsOutside([tab], i, 1200, 300), null);
  assert.equal(S().tabs[tab].windowId, i);
});

test("clearing a time range removes visits, not pages", () => {
  S().hydrate({});
  const t0 = 1_700_000_000_000;
  const entry = (url, times) => ({ url, title: url, favicon: null, visits: times.length, lastVisit: times.at(-1), visitTimes: times });
  useBrowser.setState({ history: { "": { list: [entry("https://b.com/", [t0 - 5 * 60_000]), entry("https://a.com/", [t0 - 5 * HOUR, t0 - 10 * 60_000])], floor: -Infinity, ready: true } } });
  assert.deepEqual(historyOf(S(), "default").map((h) => [h.url, h.visits]), [["https://b.com/", 1], ["https://a.com/", 2]]);

  S().clearHistory("default", t0 - HOUR);
  const [a, ...rest] = historyOf(S(), "default");
  assert.equal(rest.length, 0, "b.com was only visited in the last hour");
  assert.equal(a.url, "https://a.com/");
  assert.equal(a.visits, 1);
  assert.equal(a.lastVisit, t0 - 5 * HOUR);
  assert.deepEqual(a.visitTimes, [t0 - 5 * HOUR]);

  S().clearHistory("default");
  assert.deepEqual(historyOf(S(), "default"), []);
});

test("deleting a Space retains its Profile until that unused Profile is explicitly deleted", () => {
  S().hydrate({});
  const work = S().createSpace({ name: "Work", profileId: S().createProfile({ name: "Work" }) });
  S().setDefaultSpace(work);
  S().deleteSpace("default");
  assert.deepEqual(S().orphanedProfileData, []);
  assert.ok(S().profiles.default);
  S().deleteProfile("default");
  assert.deepEqual(S().orphanedProfileData, [""]);
  S().deleteSpace(work);
  assert.ok(S().spaces[work], "the default and final Space remain");
});

test("a Profile cannot be deleted while a Space uses it", () => {
  S().hydrate({});
  const shared = S().createSpace({ name: "Shared", profileId: "default" });
  S().createProfile({ name: "Other" });
  S().deleteProfile("default");
  assert.ok(S().profiles.default);
  assert.ok(S().spaces[shared]);
  assert.deepEqual(S().orphanedProfileData, []);
});

test("queued space data is deleted once, and stays queued in session.json until that succeeds", async () => {
  stub.docs.clear();
  stub.deletedProfileData.length = 0;
  stub.profileDataLeft.set("", ["passwords"]);
  S().hydrate({});
  const stop = startApp();
  const work = S().createSpace({ name: "Work", profileId: S().createProfile({ name: "Work" }) });
  S().createWindow({ spaceId: work, url: "https://work.example/" });
  S().setDefaultSpace(work);
  S().deleteSpace("default");
  S().deleteProfile("default");
  await settle();
  assert.deepEqual(stub.deletedProfileData, [""]);
  assert.deepEqual(S().orphanedProfileData, [""], "a failed deletion stays queued");
  flushPersistence();
  stop();
  assert.deepEqual(loadSession().orphanedProfileData, [""]);

  stub.profileDataLeft.clear();
  const again = startApp();
  await settle();
  assert.deepEqual(stub.deletedProfileData, ["", ""]);
  assert.deepEqual(S().orphanedProfileData, []);
  flushPersistence();
  assert.deepEqual(loadSession().orphanedProfileData, []);
  again();
});

test("deleting a space keeps the data others share", () => {
  S().hydrate({});
  const a = S().createSpace({ name: "A", profileId: S().createProfile({ name: "A" }) });
  S().importHistory(a, [{ url: "https://a.com/", title: "A", visits: 1, lastVisit: 2 }]);
  const bookmark = S().addBookmark({ spaceId: a, url: "https://b.com/", title: "B" });
  const b = S().createSpace({ name: "B", profileId: S().spaces[a].profileId });
  S().deleteSpace(a);
  assert.equal(S().spaces[a], undefined);
  assert.equal(model.engineProfileForSpace(b), S().spaces[b].profileId, "still on A's engine context");
  assert.ok(S().bookmarks.nodes[bookmark], "shared bookmarks stay");
  assert.deepEqual(historyOf(S(), b).map((h) => h.url), ["https://a.com/"]);
  S().importHistory(b, [{ url: "https://c.com/", title: "C", visits: 1, lastVisit: 3 }]);
  assert.equal(historyOf(S(), b).length, 2);
  S().deleteSpace(b);
  assert.ok(S().bookmarks.nodes[bookmark], "Space deletion never erases its Profile’s bookmarks");
});
