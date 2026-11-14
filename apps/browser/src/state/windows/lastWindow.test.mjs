import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { startWindowCloseGuard } = await import("./windowClose.ts");
const { openLastWindowOrNew } = await import("./lastWindow.ts");
const { closeTab } = await import("../browser/actions.ts");
const { tabsShownIn } = await import("../browser/model.ts");
const { loadSession, flushPersistence, startPersistence } = await import("../session/persist.ts");
const { shellNativeModules, windows } = await import("../../test-native/shell.ts");

const S = () => useBrowser.getState();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const asked = [];
shellNativeModules.ArdiaDialogs.confirm = (options) => {
  asked.push(options);
  return Promise.resolve({ confirmed: true, suppressed: false });
};
startPersistence();
startWindowCloseGuard();

async function closeByUser(id) {
  asked.length = 0;
  windows.emit({ type: "closeRequest", id });
  await tick();
  await tick();
  return asked.map((d) => d.title);
}

const FRAME = [120, 80, 1180, 760];
const urlOf = (id) => S().tabs[id].url;
const pinnedUrls = (w) => S().windows[w].tabIds.filter((id) => S().tabs[id].pin).map(urlOf);
const listUrls = (w) => S().windows[w].tabIds.filter((id) => !S().tabs[id].pin).map(urlOf);
const shownUrl = (w) => urlOf(S().windows[w].activeTabIds[S().windows[w].profileId]);
const onlyWindow = () => {
  assert.equal(S().windowOrder.length, 1, "one window");
  return S().windowOrder[0];
};

function arcWindow() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[w].tabIds;
  const cal = S().newTab(w, { url: "https://cal.com" });
  S().pinTabs([mail, cal], true);
  const a = S().newTab(w, { url: "https://a.com" });
  const b = S().newTab(w, { url: "https://b.com" });
  const c = S().newTab(w, { url: "https://c.com" });
  S().createGroup([b, c], { name: "Reading" });
  S().activate(a);
  S().setWindowFrame(w, FRAME);
  S().toggleSidebar(w);
  return { w, a, b, c };
}

test("closing the only window with the close button asks nothing and keeps it to bring back", async () => {
  const { w } = arcWindow();
  assert.deepEqual(await closeByUser(w), []);
  assert.equal(S().windows[w], undefined);
  const entry = S().closedWindows.at(-1);
  assert.equal(entry.lastWindow, true);
  assert.deepEqual(entry.tabs.map((t) => t.url), ["https://a.com", "https://b.com", "https://c.com"], "the unpinned tabs, pins parked");
});

test("closing one of two windows still warns and isn't kept as the last window", async () => {
  const { w } = arcWindow();
  S().createWindow({ url: "https://other.com" });
  assert.deepEqual(await closeByUser(w), ["Close 3 tabs?"]);
  assert.equal(S().windows[w], undefined);
  assert.equal(S().closedWindows.at(-1).lastWindow, undefined);
});

test("a private or Little Ardia window left open doesn't stop the last regular window being kept", async () => {
  const { w } = arcWindow();
  S().createWindow({ kind: "private", url: "https://secret.com" });
  S().createWindow({ kind: "small", url: "https://little.com" });
  assert.deepEqual(await closeByUser(w), []);
  assert.equal(S().closedWindows.at(-1).lastWindow, true);
});

test("the Dock brings the last window back as it was: frame, sidebar, tabs in order, shown tab, groups, pins once", async () => {
  const { w } = arcWindow();
  const before = { pinned: pinnedUrls(w), list: listUrls(w) };
  await closeByUser(w);
  const closedBefore = S().closedWindows.length;
  const id = openLastWindowOrNew("dock");
  assert.equal(onlyWindow(), id);
  const back = S().windows[id];
  assert.deepEqual(back.frame, FRAME);
  assert.equal(tabsShownIn(S(), id), false);
  assert.equal(back.profileId, "default");
  assert.deepEqual(pinnedUrls(id), before.pinned, "pins back, not doubled");
  assert.deepEqual(listUrls(id), before.list, "tabs in the same order");
  assert.equal(shownUrl(id), "https://a.com");
  const groups = Object.values(S().groups).filter((g) => g.windowId === id && !g.pinned);
  assert.deepEqual(groups.map((g) => [g.name, g.tabIds.map(urlOf)]), [["Reading", ["https://b.com", "https://c.com"]]]);
  assert.equal(S().closedWindows.length, closedBefore - 1, "no longer in Recently Closed");
  assert.deepEqual(S().parkedPins, {}, "the park is empty");
});

test("a pinned tab that was showing is showing again", async () => {
  const { w } = arcWindow();
  const cal = S().windows[w].tabIds.find((id) => urlOf(id) === "https://cal.com");
  S().activate(cal);
  await closeByUser(w);
  const id = openLastWindowOrNew("dock");
  assert.equal(shownUrl(id), "https://cal.com");
});

test("a split of unpinned tabs comes back as a split", async () => {
  const { w, a } = arcWindow();
  const d = S().newTab(w, { url: "https://d.com" });
  S().createSplit([a, d], "vertical");
  await closeByUser(w);
  const id = openLastWindowOrNew("dock");
  const splits = Object.values(S().splits).filter((v) => v.windowId === id);
  assert.equal(splits.length, 1);
  assert.equal(splits[0].orientation, "vertical");
  assert.deepEqual(splits[0].slots.map((slot) => urlOf(slot.tabId)), ["https://a.com", "https://d.com"]);
});

test("another profile's window comes back in that profile", async () => {
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  const w = S().createWindow({ url: "https://w1.com", profileId: work });
  S().newTab(w, { url: "https://w2.com" });
  await closeByUser(w);
  const id = openLastWindowOrNew("dock");
  assert.equal(S().windows[id].profileId, work);
  assert.deepEqual(listUrls(id), ["https://w1.com", "https://w2.com"]);
});

test("with nothing kept the Dock opens a new window", () => {
  S().hydrate({});
  const id = openLastWindowOrNew("dock");
  assert.equal(onlyWindow(), id);
  assert.deepEqual(S().windows[id].tabIds.map(urlOf), [""]);
});

test("a window closed from its last tab isn't brought back: that tab was closed on purpose", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  await closeTab(S().windows[w].tabIds[0]);
  await tick();
  assert.equal(S().windows[w], undefined);
  assert.equal(S().closedWindows.at(-1)?.lastWindow, undefined);
  const id = openLastWindowOrNew("dock");
  assert.deepEqual(S().windows[id].tabIds.map(urlOf), [""]);
});

test("a newer window closed empty wins over the older kept one", async () => {
  const { w } = arcWindow();
  await closeByUser(w);
  const fresh = S().createWindow();
  assert.deepEqual(await closeByUser(fresh), []);
  const marked = S().closedWindows.filter((c) => c.lastWindow);
  assert.equal(marked.length, 1);
  assert.deepEqual(marked[0].tabs.map((t) => t.url), [""], "the newer one, its New Tab and its pins, is the one kept; the older one is only in Recently Closed");
  const id = openLastWindowOrNew("dock");
  assert.deepEqual(listUrls(id), [""]);
  assert.deepEqual(pinnedUrls(id), ["https://mail.com", "https://cal.com"]);
});

test("a window opened while the last one animates out keeps it from being the last", async () => {
  const { w } = arcWindow();
  const gates = [];
  const animate = shellNativeModules.ArdiaAppWindows.animateWindowClose;
  shellNativeModules.ArdiaAppWindows.animateWindowClose = () => new Promise((resolve) => gates.push(resolve));
  try {
    await closeByUser(w);
    S().createWindow({ url: "https://new.com" });
  } finally {
    gates.splice(0).forEach((resolve) => resolve());
    shellNativeModules.ArdiaAppWindows.animateWindowClose = animate;
  }
  await tick();
  await tick();
  assert.equal(S().windows[w], undefined);
  assert.equal(S().closedWindows.at(-1).lastWindow, undefined);
});

test("quitting with no window open and relaunching brings the last window back", async () => {
  const { w } = arcWindow();
  await closeByUser(w);
  flushPersistence();
  S().hydrate(loadSession());
  assert.equal(S().windowOrder.length, 0);
  assert.equal(S().closedWindows.at(-1).lastWindow, true, "kept on disk");
  const id = openLastWindowOrNew("launch");
  assert.deepEqual(listUrls(id), ["https://a.com", "https://b.com", "https://c.com"]);
  assert.deepEqual(pinnedUrls(id), ["https://mail.com", "https://cal.com"]);
  assert.deepEqual(S().windows[id].frame, FRAME);
});

test("with Start fresh on, a relaunch opens a new window instead", async () => {
  const { w } = arcWindow();
  await closeByUser(w);
  S().updateSettings({ restoreSession: false });
  flushPersistence();
  try {
    S().hydrate(loadSession());
    assert.equal(S().closedWindows.some((c) => c.lastWindow), false);
    const id = openLastWindowOrNew("launch");
    assert.deepEqual(listUrls(id), [""]);
    assert.deepEqual(pinnedUrls(id), ["https://mail.com", "https://cal.com"], "pins still come back");
  } finally {
    S().updateSettings({ restoreSession: true });
  }
});

test("the restored window is the one Reopen Closed Window would have brought back, so the menu stops listing it", async () => {
  const { w } = arcWindow();
  await closeByUser(w);
  const entry = S().closedWindows.at(-1).id;
  openLastWindowOrNew("dock");
  assert.equal(S().closedWindows.some((c) => c.id === entry), false);
});

test("a window with only pinned tabs in another profile comes back in that profile, frame, sidebar and shown pin", async () => {
  S().hydrate({});
  const work = S().createProfile({ name: "Work" });
  const w = S().createWindow({ url: "https://w-mail.com", profileId: work });
  const [mail] = S().windows[w].tabIds;
  const cal = S().newTab(w, { url: "https://w-cal.com" });
  S().pinTabs([mail, cal], true);
  S().activate(cal);
  S().setWindowFrame(w, FRAME);
  S().toggleSidebar(w);
  for (const id of S().windows[w].tabIds.filter((id) => !S().tabs[id].pin)) S().closeTab(id);
  assert.deepEqual(listUrls(w), [], "only pins left");
  assert.deepEqual(await closeByUser(w), []);
  const id = openLastWindowOrNew("dock");
  assert.equal(onlyWindow(), id);
  assert.equal(S().windows[id].profileId, work);
  assert.deepEqual(S().windows[id].frame, FRAME);
  assert.equal(tabsShownIn(S(), id), false);
  assert.deepEqual(pinnedUrls(id), ["https://w-mail.com", "https://w-cal.com"]);
  assert.equal(shownUrl(id), "https://w-cal.com");
  assert.equal(S().closedWindows.some((c) => c.tabs.length === 0), false, "the pins-only entry is used up");
});

test("a pins-only entry that's no longer the last window leaves Recently Closed", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://mail.com" });
  S().pinTabs(S().windows[w].tabIds, true);
  for (const id of S().windows[w].tabIds.filter((id) => !S().tabs[id].pin)) S().closeTab(id);
  await closeByUser(w);
  assert.equal(S().closedWindows.at(-1).tabs.length, 0);
  const fresh = S().createWindow({ url: "https://new.com" });
  await closeByUser(fresh);
  assert.equal(S().closedWindows.some((c) => c.tabs.length === 0), false);
});

test("a Dock click while the last window is still animating out brings that window back", async () => {
  const { w } = arcWindow();
  const gates = [];
  const animate = shellNativeModules.ArdiaAppWindows.animateWindowClose;
  shellNativeModules.ArdiaAppWindows.animateWindowClose = () => new Promise((resolve) => gates.push(resolve));
  try {
    await closeByUser(w);
    assert.ok(S().windows[w], "still animating");
    const id = openLastWindowOrNew("dock");
    assert.equal(onlyWindow(), id);
    assert.deepEqual(listUrls(id), ["https://a.com", "https://b.com", "https://c.com"]);
  } finally {
    gates.splice(0).forEach((resolve) => resolve());
    shellNativeModules.ArdiaAppWindows.animateWindowClose = animate;
  }
  await tick();
  await tick();
  assert.equal(S().windowOrder.length, 1, "the late animation end closes nothing more");
});

test("a second Dock click while the restored window appears focuses it instead of opening another", async () => {
  const { w } = arcWindow();
  await closeByUser(w);
  const first = openLastWindowOrNew("dock");
  windows.focused = null;
  const second = openLastWindowOrNew("dock");
  assert.equal(second, first);
  assert.equal(onlyWindow(), first);
  await tick();
  assert.equal(windows.focused, first);
});

test("a new window that takes the pins of a pins-only closed window drops that entry, and keeps entries with tabs", async () => {
  S().hydrate({});
  const other = S().createWindow({ url: "https://kept.com" });
  S().newTab(other, { url: "https://kept2.com" });
  const w = S().createWindow({ url: "https://mail.com" });
  const cal = S().newTab(w, { url: "https://cal.com" });
  S().pinTabs(S().windows[w].tabIds, true);
  S().activate(cal);
  for (const id of S().windows[w].tabIds.filter((id) => !S().tabs[id].pin)) S().closeTab(id);
  await closeByUser(other);
  await closeByUser(w);
  assert.deepEqual(S().closedWindows.map((c) => c.tabs.length), [2, 0]);
  const fresh = S().createWindow();
  assert.deepEqual(pinnedUrls(fresh), ["https://mail.com", "https://cal.com"]);
  assert.deepEqual(S().closedWindows.map((c) => c.tabs.length), [2], "the pins-only entry is used up; the one with tabs stays");
});
