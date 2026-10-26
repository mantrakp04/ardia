import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { awayFromPin } = await import("./organize.ts");
const { settlePinHomes } = await import("./pinHomes.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const go = (id, url) => S().navigated(id, { url, title: "" }, { isLoading: false, canGoBack: true, canGoForward: false });

function windowWith(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/`, background: true }));
  return { w, ids };
}

const groupIn = (w, name) => Object.values(S().groups).find((g) => g.windowId === w && g.name === name);
const memberIn = (w, home) => model.viewTabIds(S(), w).find((id) => !S().tabs[id].pinned && S().tabs[id].pinnedUrl === home);

test("a tab in a pinned group keeps the page it was pinned at and goes back there when closed", () => {
  reset();
  const { ids: [, a, b] } = windowWith("x", "a", "b");
  S().groupTabs([a, b], { pinned: true, name: "Uni" });
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/");
  go(a, "https://a.com/deep/page");
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/", "navigating doesn't move the home");
  assert.equal(awayFromPin(S().tabs[a]), true);
  S().closeTab(a);
  assert.equal(S().tabs[a].url, "https://a.com/", "⌘W unloads it at its home");
  assert.equal(S().tabs[a].unloaded, true);
  assert.equal(awayFromPin(S().tabs[a]), false);
});

test("Back to Pinned URL and Replace Pin work on a pinned group's tab", () => {
  reset();
  const { ids: [, a] } = windowWith("x", "a");
  S().groupTabs([a], { pinned: true, name: "Uni" });
  go(a, "https://a.com/login");
  S().setPinnedUrl(a);
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/login");
  go(a, "https://a.com/elsewhere");
  S().returnToPinnedUrl(a);
  assert.equal(S().tabs[a].navigation?.url ?? S().tabs[a].url, "https://a.com/login");
});

test("a home follows the tab between pinned places and goes when it leaves them", () => {
  reset();
  const { w, ids: [, a, b] } = windowWith("x", "a", "b");
  S().pinTabs([a], true);
  go(a, "https://a.com/away");
  const g = S().groupTabs([b], { pinned: true, name: "Uni" });
  S().placeTabs([a], { pinned: false, groupId: g });
  assert.equal(S().tabs[a].pinned, false);
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/", "a tile moved into a pinned group keeps its home");
  S().placeTabs([a], { pinned: true, row: true });
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/", "and keeps it as a pinned row");
  S().placeTabs([a], { pinned: false, groupId: g });
  S().removeTabsFromGroup([a]);
  assert.equal(S().tabs[a].pinnedUrl, null, "an ordinary tab has no home");
  assert.equal(model.inPinnedContainer(S(), a), false);
  assert.ok(groupIn(w, "Uni"));
});

test("a pinned group's home mirrors to the profile's other windows", () => {
  reset();
  const { ids: [, a] } = windowWith("x", "a");
  S().groupTabs([a], { pinned: true, name: "Uni" });
  go(a, "https://a.com/next");
  const b = S().createWindow({ url: "https://y.com/" });
  const copy = memberIn(b, "https://a.com/");
  assert.ok(copy, "the copy carries the home");
  assert.equal(S().tabs[copy].url, "https://a.com/next", "while it shows the same page as its source");
  S().setPinnedUrl(a);
  assert.ok(memberIn(b, "https://a.com/next"), "Replace Pin reaches the other window");
});

test("saved tabs in pinned groups from before homes get their current page as home", () => {
  const tab = (id, url, pinned = false) => ({ id, url, pinned, pinnedUrl: null });
  const groups = { g: { id: "g", pinned: true, tabIds: ["a"] }, h: { id: "h", pinned: false, tabIds: ["b"] } };
  const tabs = { a: tab("a", "https://a.com/x"), b: tab("b", "https://b.com/"), c: { ...tab("c", "https://c.com/"), pinnedUrl: "https://c.com/" } };
  const next = settlePinHomes({ tabs, groups, windows: {} }, { tabs: {}, groups: {}, windows: {} });
  assert.equal(next.tabs.a.pinnedUrl, "https://a.com/x");
  assert.equal(next.tabs.b.pinnedUrl, null);
  assert.equal(next.tabs.c.pinnedUrl, null, "a stray home outside any pinned place is dropped");
  assert.equal(settlePinHomes({ tabs: next.tabs, groups, windows: {} }, { tabs, groups, windows: {} }), null, "settled state stays put");
});

test("deleting and reopening a pinned group, or duplicating it, keeps each tab's home", () => {
  reset();
  const { w, ids: [, a] } = windowWith("x", "a");
  const g = S().groupTabs([a], { pinned: true, name: "Uni" });
  go(a, "https://a.com/away");
  S().duplicateGroup(g);
  const copies = Object.values(S().groups).filter((x) => x.name === "Uni" && x.id !== g);
  assert.equal(copies.length, 1);
  assert.equal(S().tabs[copies[0].tabIds[0]].pinnedUrl, "https://a.com/", "the duplicate keeps the home");
  S().deleteGroup(g);
  S().restoreClosed(S().deletedGroups.at(-1).id, w);
  const back = Object.values(S().groups).filter((x) => x.name === "Uni" && x.id !== copies[0].id);
  assert.equal(back.length, 1);
  assert.equal(S().tabs[back[0].tabIds[0]].pinnedUrl, "https://a.com/", "the reopened group keeps the home");
});

test("grouping a pinned row onto another keeps the dragged row's home", () => {
  reset();
  const { ids: [, a, b] } = windowWith("x", "a", "b");
  S().pinTabs([a, b], true, true);
  go(a, "https://a.com/away");
  const g = S().groupOnto([a], b);
  assert.ok(g && S().groups[g]?.pinned, "the rows make a pinned group");
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/", "the dragged row keeps its home");
  assert.equal(S().tabs[b].pinnedUrl, "https://b.com/", "and so does the row it went onto");
});
