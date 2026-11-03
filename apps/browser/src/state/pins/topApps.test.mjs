import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
const stub = await import("../../test-native/index.ts");
const folders = await import("./tileFolders.ts");
const writes = await import("./syncWrites.ts");

const S = () => useBrowser.getState();
const reset = (shareTopApps = true) => {
  S().hydrate({});
  S().updateSettings({ shareTopApps });
};
const loaded = (id) => !!S().tabs[id]?.page.nav || !!S().tabs[id]?.page.adopt;
const shown = (w) => model.activeTabId(S(), w);
const view = (w, p) => model.viewTabIds(S(), w, p);
const topApps = (w, p) => view(w, p).filter((id) => S().tabs[id].pin?.as === "tile").map((id) => S().tabs[id].pinnedUrl);
const rows = (w, p) => view(w, p).filter((id) => S().tabs[id].pin?.as === "row").map((id) => S().tabs[id].pinnedUrl);
const tileOf = (w, p, url) => view(w, p).find((id) => !!S().tabs[id].pin && S().tabs[id].pinnedUrl === url);
const pages = (url) => Object.values(S().tabs).filter((t) => t.pinnedUrl === url && (t.page.nav || t.page.adopt));

function spaces({ shareWith = true } = {}) {
  const w = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[w].tabIds;
  S().newTab(w, { url: "https://a.com" });
  S().pinTabs([mail], true);
  S().activate(mail);
  const work = S().createProfile({ name: "Work", shareWith: shareWith ? "default" : null });
  S().switchProfile(w, work);
  return { w, mail, work };
}

test("profiles that share data show the same Top Apps; pinning or unpinning one in either shows in both", () => {
  reset();
  const { w, work } = spaces();
  assert.deepEqual(topApps(w, work), ["https://mail.com"], "Work got Personal's Top App");
  const docs = S().newTab(w, { url: "https://docs.com" });
  S().pinTabs([docs], true);
  assert.deepEqual(topApps(w, "default"), ["https://mail.com", "https://docs.com"], "a Top App pinned in Work shows in Personal");
  S().togglePin(tileOf(w, "default", "https://mail.com"));
  assert.deepEqual(topApps(w, work), ["https://docs.com"], "unpinned in Personal, gone from Work");
});

test("one live page per Top App: opening it in the other profile takes the same tab, no reload", () => {
  reset();
  const { w, mail, work } = spaces();
  S().updateTab(mail, { url: "https://mail.com/inbox/42", title: "Inbox (42)" }, { isLoading: false });
  const copy = tileOf(w, work, "https://mail.com");
  assert.notEqual(copy, mail);
  S().activate(copy);
  assert.equal(shown(w), mail, "Work shows the very tab Personal loaded");
  assert.equal(S().tabs[mail].profileId, work);
  assert.equal(S().tabs[mail].url, "https://mail.com/inbox/42", "where Personal left it");
  assert.equal(tileOf(w, work, "https://mail.com"), mail, "in Work's tile slot");
  assert.equal(S().tabs[copy].profileId, "default", "the copy took its slot in Personal");
  assert.equal(S().tabs[copy].page.holderId, mail, "frozen on the one page");
  assert.equal(pages("https://mail.com").length, 1, "one page, one renderer");

  S().switchProfile(w, "default");
  assert.equal(shown(w), mail, "back in Personal, the page comes along on its own");
  assert.equal(S().tabs[mail].profileId, "default");
  assert.equal(S().tabs[copy].profileId, work);
  assert.equal(S().tabs[copy].page.holderId, mail);
  assert.equal(pages("https://mail.com").length, 1);
  assert.equal(loaded(mail), true);
});

test("Top Apps that both profiles already had become one; pinned rows stay each profile's own", () => {
  reset(false);
  const w = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[w].tabIds;
  const notes = S().newTab(w, { url: "https://notes.com" });
  S().pinTabs([mail], true);
  S().pinTabs([notes], true, true);
  const work = S().createProfile({ name: "Work", shareWith: "default" });
  S().switchProfile(w, work);
  const own = S().newTab(w, { url: "https://mail.com" });
  const jira = S().newTab(w, { url: "https://jira.com" });
  S().pinTabs([own], true);
  S().pinTabs([jira], true);
  assert.deepEqual(topApps(w, "default"), ["https://mail.com"], "off: each keeps its own");

  S().updateSettings({ shareTopApps: true });
  assert.deepEqual(topApps(w, "default"), ["https://mail.com", "https://jira.com"]);
  assert.deepEqual(topApps(w, work), ["https://mail.com", "https://jira.com"], "Work's own mail tile is kept, not doubled");
  assert.equal(tileOf(w, work, "https://mail.com"), own);
  assert.deepEqual(rows(w, "default"), ["https://notes.com"]);
  assert.deepEqual(rows(w, work), [], "pinned rows are not shared");
});

test("profiles with their own data, and the setting turned off, keep separate Top Apps and pages", () => {
  reset();
  const apart = spaces({ shareWith: false });
  assert.deepEqual(topApps(apart.w, apart.work), [], "separate data: nothing shared");

  reset(false);
  const { w, mail, work } = spaces();
  assert.deepEqual(topApps(w, work), [], "off: Work starts without Personal's Top Apps");
  const own = S().newTab(w, { url: "https://mail.com" });
  S().pinTabs([own], true);
  S().activate(own);
  assert.equal(loaded(own), true, "off: Work loads its own page");
  assert.equal(S().tabs[mail].profileId, "default");
  assert.equal(pages("https://mail.com").length, 2);
});

test("closing the Top App in either profile unloads its one page; a relaunch keeps one page and one family", () => {
  reset();
  const { w, mail, work } = spaces();
  const copy = tileOf(w, work, "https://mail.com");
  S().activate(copy);
  S().closeTab(mail);
  assert.equal(pages("https://mail.com").length, 0, "closing it in Work unloads it everywhere");
  assert.deepEqual(topApps(w, "default"), ["https://mail.com"], "and keeps both tiles");
  assert.deepEqual(topApps(w, work), ["https://mail.com"]);

  stub.docs.clear();
  reset();
  const stop = startPersistence();
  const again = spaces();
  S().activate(tileOf(again.w, again.work, "https://mail.com"));
  flushPersistence();
  stop();
  S().hydrate(loadSession());
  assert.deepEqual(topApps(again.w, "default"), ["https://mail.com"]);
  assert.deepEqual(topApps(again.w, again.work), ["https://mail.com"]);
  assert.ok(pages("https://mail.com").length <= 1, "never two pages after a relaunch");
  S().activate(tileOf(again.w, again.work, "https://mail.com"));
  S().switchProfile(again.w, "default");
  S().activate(tileOf(again.w, "default", "https://mail.com"));
  assert.equal(pages("https://mail.com").length, 1, "one page however often you switch");
});

test("merging picks the same tile whichever profile is on screen, so two Macs agree", () => {
  const winner = (showWork) => {
    reset(false);
    const w = S().createWindow({ url: "https://mail.com" });
    const [mail] = S().windows[w].tabIds;
    S().pinTabs([mail], true);
    const work = S().createProfile({ name: "Work", shareWith: "default" });
    S().switchProfile(w, work);
    const own = S().newTab(w, { url: "https://mail.com" });
    S().pinTabs([own], true);
    if (!showWork) S().switchProfile(w, "default");
    S().updateSettings({ shareTopApps: true });
    const key = (id) => S().tabs[id].pinKey ?? id;
    return [key(tileOf(w, "default", "https://mail.com")), key(tileOf(w, work, "https://mail.com")), mail];
  };
  const [a1, b1, mail1] = winner(true);
  const [a2, b2, mail2] = winner(false);
  assert.equal(a1, b1);
  assert.equal(a2, b2);
  assert.equal(a1, mail1, "the first profile's tile wins, by profile order");
  assert.equal(a2, mail2);
});

test("a profile coming back from parked pins takes the circle's Top Apps; it never brings an unpinned one back", () => {
  reset();
  const { w, work } = spaces();
  const docs = S().newTab(w, { url: "https://docs.com" });
  S().pinTabs([docs], true);
  const w2 = S().createWindow({ url: "https://b.com" });
  S().closeWindow(w);
  assert.deepEqual(topApps(w2, "default"), ["https://mail.com", "https://docs.com"]);
  S().togglePin(tileOf(w2, "default", "https://docs.com"));
  S().switchProfile(w2, work);
  assert.deepEqual(topApps(w2, "default"), ["https://mail.com"], "docs stays unpinned");
  assert.deepEqual(topApps(w2, work), ["https://mail.com"]);
});

test("Move to Profile on a shared Top App carries its page over and keeps the tile in both", () => {
  reset();
  const { w, mail, work } = spaces();
  S().switchProfile(w, "default");
  S().moveTabToProfile(mail, work);
  assert.equal(S().windows[w].profileId, work);
  assert.equal(shown(w), mail, "the same page, now in Work");
  assert.deepEqual(topApps(w, "default"), ["https://mail.com"]);
  assert.deepEqual(topApps(w, work), ["https://mail.com"]);
  assert.equal(pages("https://mail.com").length, 1);
});

test("making a shared Top App a pinned row, or turning sharing off, never wakes a second page", () => {
  reset();
  let { w, work } = spaces();
  S().activate(tileOf(w, work, "https://mail.com"));
  S().placeTabs([shown(w)], { pinned: true, row: true });
  assert.deepEqual(rows(w, work), ["https://mail.com"]);
  assert.deepEqual(topApps(w, "default"), [], "the row is Work's own");
  assert.equal(pages("https://mail.com").length, 1);

  reset();
  ({ w, work } = spaces());
  S().activate(tileOf(w, work, "https://mail.com"));
  S().updateSettings({ shareTopApps: false });
  assert.equal(Object.values(S().tabs).some((t) => t.page.kind === "frozen"), false, "no copy stays frozen on another profile's page");
  assert.equal(pages("https://mail.com").length, 1);
});

test("deleting the profile that holds a shared page hands the page to the profile that's left", () => {
  reset();
  const { w, mail, work } = spaces();
  S().activate(tileOf(w, work, "https://mail.com"));
  assert.equal(S().tabs[mail].profileId, work);
  S().deleteProfile(work);
  assert.equal(S().tabs[mail]?.profileId, "default", "the same tab, back in Personal");
  assert.equal(loaded(mail), true);
  assert.deepEqual(topApps(w, "default"), ["https://mail.com"]);
});

test("turning sharing on when both profiles have the same Top App loaded keeps one page, the one on screen", () => {
  reset(false);
  const w = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[w].tabIds;
  S().pinTabs([mail], true);
  S().activate(mail);
  const work = S().createProfile({ name: "Work", shareWith: "default" });
  S().switchProfile(w, work);
  const own = S().newTab(w, { url: "https://mail.com" });
  S().pinTabs([own], true);
  S().activate(own);
  assert.equal(pages("https://mail.com").length, 2, "off: each profile has its own page");
  S().switchProfile(w, "default");
  S().updateSettings({ shareTopApps: true });
  assert.equal(pages("https://mail.com").length, 1, "one page once they share");
  assert.equal(shown(w), mail, "Personal, on screen, keeps its page");
  assert.equal(loaded(mail), true);
  assert.equal(S().tabs[own].page.holderId, mail, "Work's copy is frozen on it");
});

test("deleting the profile that holds a shared page hands it to a sibling that never opened the tile", () => {
  reset();
  const { mail, work } = spaces();
  S().updateTab(mail, { url: "https://mail.com/draft/unsaved" }, { isLoading: false });
  S().deleteProfile("default");
  assert.equal(S().tabs[mail]?.profileId, work, "the live tab moved to Work");
  assert.equal(S().tabs[mail].url, "https://mail.com/draft/unsaved", "at the page Personal left it");
  assert.equal(pages("https://mail.com").length, 1);
});

test("opening a shared Top App in a folder from the other profile keeps the folder in both", () => {
  reset();
  const { w, mail, work } = spaces();
  S().switchProfile(w, "default");
  const docs = S().newTab(w, { url: "https://docs.com" });
  S().pinTabs([docs], true);
  useBrowser.setState(folders.newTileFolder(S(), [mail, tileOf(w, "default", "https://docs.com")], "Apps").state);
  const folderOf = (p) => view(w, p).filter((id) => S().tabs[id].pin?.as === "tile").map((id) => S().tabs[id].pin.folder?.id ?? null);
  const [folder] = folderOf("default");
  assert.ok(folder);
  assert.deepEqual(folderOf(work), [folder, folder], "Work mirrors the folder");
  S().switchProfile(w, work);
  S().activate(tileOf(w, work, "https://mail.com"));
  assert.equal(shown(w), mail, "Work took Personal's page");
  assert.deepEqual(folderOf(work), [folder, folder], "still one folder in Work");
  assert.deepEqual(folderOf("default"), [folder, folder], "and in Personal");
});

function foldered() {
  reset();
  const w = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[w].tabIds;
  const docs = S().newTab(w, { url: "https://docs.com" });
  S().pinTabs([mail, docs], true);
  const work = S().createProfile({ name: "Work", shareWith: "default" });
  useBrowser.setState(folders.newTileFolder(S(), [mail, docs], "Apps").state);
  return { w, mail, work, folder: S().tabs[mail].pin.folder.id };
}
const foldersIn = (w, p) => view(w, p).filter((id) => S().tabs[id].pin?.as === "tile").map((id) => S().tabs[id].pin.folder?.id ?? null);

test("a shared Top App's page moving to the other profile's window keeps its folder in both", () => {
  const { w, mail, work, folder } = foldered();
  const w2 = S().createWindow({ profileId: work, url: "https://work.com" });
  S().activate(tileOf(w2, work, "https://mail.com"));
  assert.equal(S().tabs[mail].windowId, w2, "the page went to Work's window");
  assert.deepEqual(foldersIn(w2, work), [folder, folder]);
  assert.deepEqual(foldersIn(w, "default"), [folder, folder]);
});

test("deleting the profile holding a page in a folder keeps the folder in the profile that's left", () => {
  const { w, work, folder } = foldered();
  S().switchProfile(w, work);
  S().deleteProfile("default");
  assert.deepEqual(foldersIn(w, work), [folder, folder]);
});

test("a parked profile's Top App opens at the pinned URL chosen in its sibling", () => {
  reset();
  const { w, work } = spaces();
  const w2 = S().createWindow({ profileId: work, url: "https://work.com" });
  S().closeWindow(w);
  const copy = tileOf(w2, work, "https://mail.com");
  S().activate(copy);
  S().updateTab(copy, { url: "https://mail.com/new-home" }, { isLoading: false });
  S().setPinnedUrl(copy);
  S().closeTab(copy);
  S().switchProfile(w2, "default");
  const restored = tileOf(w2, "default", "https://mail.com/new-home");
  S().activate(restored);
  assert.equal(S().tabs[restored].page.nav.url, "https://mail.com/new-home");
});

test("turning sharing back on keeps a pinned row the other profile made from a shared Top App", () => {
  reset();
  const { w, work } = spaces();
  S().updateSettings({ shareTopApps: false });
  S().placeTabs([tileOf(w, work, "https://mail.com")], { pinned: true, row: true });
  S().updateSettings({ shareTopApps: true });
  assert.deepEqual(rows(w, work), ["https://mail.com"], "Work keeps its row");
  assert.deepEqual(topApps(w, "default"), ["https://mail.com"], "Personal keeps its tile");
});

const syncRemoves = (id) => {
  const s = S();
  writes.fromSync(() => useBrowser.setState({ tabs: Object.fromEntries(Object.entries(s.tabs).filter(([k]) => k !== id)), windows: { ...s.windows, [s.tabs[id].windowId]: { ...s.windows[s.tabs[id].windowId], tabIds: s.windows[s.tabs[id].windowId].tabIds.filter((k) => k !== id) } } }));
};

test("a Top App edit in a profile that's behind on sync carries only that change to its sibling", () => {
  reset();
  const { w, work } = spaces();
  const docs = S().newTab(w, { url: "https://docs.com" });
  S().pinTabs([docs], true);
  syncRemoves(tileOf(w, work, "https://mail.com"));
  assert.deepEqual(topApps(w, work), ["https://docs.com"], "Work hasn't got Mail back from sync yet");
  const news = S().newTab(w, { url: "https://news.com" });
  S().pinTabs([news], true);
  assert.deepEqual(topApps(w, "default").sort(), ["https://docs.com", "https://mail.com", "https://news.com"], "Personal keeps Mail and gets News");
});

test("a relaunch doesn't merge the profiles' Top Apps again", () => {
  stub.docs.clear();
  reset();
  const stop = startPersistence();
  const { w, work } = spaces();
  syncRemoves(tileOf(w, "default", "https://mail.com"));
  assert.deepEqual(topApps(w, "default"), []);
  flushPersistence();
  stop();
  const saved = loadSession();
  S().hydrate({});
  S().hydrate(saved);
  const after = S().windowOrder[0];
  assert.deepEqual(topApps(after, "default"), [], "Personal's synced unpin stays");
  assert.deepEqual(topApps(after, work), ["https://mail.com"], "Work keeps its copy until its own sync");
});
