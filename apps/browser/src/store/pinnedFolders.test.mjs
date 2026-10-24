import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const organize = await import("./organize.ts");
const { sidebarEntries } = await import("../components/sidebar/entries.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const home = (id) => S().tabs[id].pinnedUrl || S().tabs[id].url;
const homes = (ids) => ids.map((id) => S().tabs[id].pinnedUrl);
const folderOf = (w, name) => Object.values(S().groups).find((g) => g.pinned && g.windowId === w && g.name === name);
const members = (w, name) => (folderOf(w, name)?.tabIds ?? []).map(home);
const rows = (w) => sidebarEntries(S(), w).pinned.filter((e) => e.startsWith("t:")).map((e) => home(e.slice(2)));
const pinnedSequence = (w) =>
  sidebarEntries(S(), w).pinned.map((e) => (e.startsWith("g:") ? S().groups[e.slice(2)].name : new URL(home(e.slice(2))).hostname.replace(".com", "")));

function pinnedRows(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  S().pinTabs(ids, true, true);
  return { w, ids };
}

test("a new folder takes a pinned row, keeps its pinned URL, and lists as a pinned group", () => {
  reset();
  const { w, ids: [a, b] } = pinnedRows("a", "b");
  const g = S().newFolder([a], "Work");
  assert.ok(g);
  assert.equal(S().groups[g].pinned, true);
  assert.deepEqual(members(w, "Work"), ["https://a.com/"]);
  assert.equal(S().tabs[a].pinned, false);
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/", "the page keeps its home");
  assert.equal(organize.hasPinnedPage(S(), S().tabs[a]), true);
  const e = sidebarEntries(S(), w);
  assert.deepEqual(e.pinned.filter((x) => x.startsWith("t:")).map((x) => home(x.slice(2))), ["https://b.com/"]);
  assert.deepEqual(e.pinned.filter((x) => x.startsWith("g:")), [`g:${g}`]);
  assert.ok(S().pinChoices.default[organize.groupChoiceKey(g)], "the folder is a choice to sync");
  assert.equal(organize.isFolder(S(), S().groups[g]), true);
  assert.ok(S().tabs[b].pinned);
});

test("a folder takes the slot of the row it was made from, among the other rows", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedRows("a", "b", "c");
  assert.deepEqual(pinnedSequence(w), ["a", "b", "c"]);
  S().newFolder([b], "Mid");
  assert.deepEqual(pinnedSequence(w), ["a", "Mid", "c"]);
  S().removeFromFolder([b]);
  assert.deepEqual(pinnedSequence(w), ["a", "c", "b"]);
  assert.ok([a, b, c].every((id) => S().tabs[id].pinned));
});

test("move a row into an existing folder, take pages out, move between folders", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedRows("a", "b", "c");
  const g = S().newFolder([a], "One");
  S().placeTabs([b], { pinned: false, groupId: g });
  assert.deepEqual(members(w, "One"), ["https://a.com/", "https://b.com/"]);
  assert.deepEqual(rows(w), ["https://c.com/"]);

  const g2 = S().newFolder([c], "Two");
  S().placeTabs([b], { pinned: false, groupId: g2 });
  assert.deepEqual(members(w, "One"), ["https://a.com/"]);
  assert.deepEqual(members(w, "Two"), ["https://c.com/", "https://b.com/"]);
  assert.deepEqual(homes([b, c]), ["https://b.com/", "https://c.com/"], "a folder to folder move keeps the home");

  S().removeFromFolder([a]);
  assert.equal(folderOf(w, "One"), undefined, "an emptied folder goes away");
  assert.equal(S().tabs[a].pinned, true);
  assert.equal(S().tabs[a].pinnedAsRow, true);
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/");
  assert.deepEqual(rows(w), ["https://a.com/"]);
  assert.deepEqual(members(w, "Two"), ["https://c.com/", "https://b.com/"]);
});

test("a new folder from several pages, and from pages already in a folder", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedRows("a", "b", "c");
  const first = S().newFolder([a, b], "Pair");
  assert.deepEqual(members(w, "Pair"), ["https://a.com/", "https://b.com/"]);
  const second = S().newFolder([b, c], "Moved");
  assert.notEqual(first, second);
  assert.deepEqual(members(w, "Pair"), ["https://a.com/"]);
  assert.deepEqual(members(w, "Moved"), ["https://b.com/", "https://c.com/"], "in the sidebar's order");
  assert.equal(S().newFolder([], "Empty"), "");
  const plain = S().newTab(w, { url: "https://plain.com/" });
  assert.equal(S().newFolder([plain], "Plain"), "", "only pinned pages go into a folder");
});

test("a regular tab dropped into a folder has no pinned URL, and one leaving a folder for the list loses it", () => {
  reset();
  const { w, ids: [a] } = pinnedRows("a");
  const plain = S().newTab(w, { url: "https://plain.com/" });
  const g = S().newFolder([a], "F");
  S().placeTabs([plain], { pinned: false, groupId: g });
  assert.equal(S().tabs[plain].pinnedUrl, null);
  assert.equal(organize.awayFromPin(S().tabs[plain], organize.inFolder(S(), plain)), false);
  S().placeTabs([a], { pinned: false, beforeId: null });
  assert.equal(S().tabs[a].pinnedUrl, null, "no longer a pinned page");
  assert.equal(organize.hasPinnedPage(S(), S().tabs[a]), false);
});

test("a page in a folder keeps Back to Pinned URL, Replace Pin and Edit Pinned Page", () => {
  reset();
  const { ids: [a] } = pinnedRows("a");
  S().newFolder([a], "F");
  S().navigate(a, "https://a.com/other");
  S().updateTab(a, { url: "https://a.com/other" });
  assert.equal(organize.awayFromPin(S().tabs[a], organize.inFolder(S(), a)), true);
  S().returnToPinnedUrl(a);
  assert.equal(S().tabs[a].navigation?.url, "https://a.com/", "navigates back to the pinned URL");
  S().updateTab(a, { url: "https://a.com/other" });
  S().setPinnedUrl(a);
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/other");
  S().setPinnedUrl(a, "https://a.com/edited");
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/edited");
  assert.equal(S().tabs[a].pinned, false, "still a folder member");
});

test("closing a folder page unloads it at its pinned URL, like a pinned row", () => {
  reset();
  const { w, ids: [a, b] } = pinnedRows("a", "b");
  S().newFolder([a], "F");
  S().updateTab(a, { url: "https://a.com/deep" });
  S().closeTab(a);
  assert.equal(S().tabs[a].unloaded, true);
  assert.equal(S().tabs[a].url, "https://a.com/");
  assert.deepEqual(members(w, "F"), ["https://a.com/"]);
  assert.ok(S().tabs[b]);
});

test("collapse, rename and icon are the group's own and survive a relaunch with the pages and their homes", () => {
  stub.docs.clear();
  reset();
  const stop = startPersistence();
  const { w, ids: [a, b] } = pinnedRows("a", "b");
  const g = S().newFolder([a, b], "Reading");
  S().updateGroup(g, { collapsed: true, icon: "book", name: "Reading list" });
  S().updateTab(b, { url: "https://b.com/deep" });
  flushPersistence();
  stop();
  S().hydrate(loadSession());
  const back = folderOf(w, "Reading list");
  assert.ok(back, "the folder came back");
  assert.equal(back.collapsed, true);
  assert.equal(back.icon, "book");
  assert.equal(back.pinned, true);
  assert.deepEqual(back.tabIds.map((id) => S().tabs[id].pinnedUrl), ["https://a.com/", "https://b.com/"]);
  assert.ok(back.tabIds.every((id) => !S().tabs[id].pinned));
});

test("the last window's close parks the folder with its homes and the next window adopts it", () => {
  reset();
  const { w, ids: [a, b] } = pinnedRows("a", "b");
  S().newFolder([a, b], "Park");
  S().updateTab(b, { url: "https://b.com/deep" });
  S().closeWindow(w);
  const parked = S().parkedPins.default;
  assert.deepEqual(parked.tabs.map((t) => [t.groupId, t.pinnedUrl, t.url]), [
    [parked.groups[0].id, "https://a.com/", "https://a.com/"],
    [parked.groups[0].id, "https://b.com/", "https://b.com/"],
  ]);
  const n = S().createWindow();
  const folder = Object.values(S().groups).find((g) => g.pinned && g.windowId === n);
  assert.equal(folder.name, "Park");
  assert.deepEqual(folder.tabIds.map((id) => S().tabs[id].pinnedUrl), ["https://a.com/", "https://b.com/"]);
  assert.ok(folder.tabIds.every((id) => S().tabs[id].unloaded));
});

test("another window of the profile mirrors the folder, its pages and their homes, and later changes", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedRows("a", "b", "c");
  const second = S().createWindow({ url: "https://other.com/" });
  const g = S().newFolder([a, b], "Shared");
  const mirror = folderOf(second, "Shared");
  assert.ok(mirror, "the second window shows the folder");
  assert.deepEqual(mirror.tabIds.map(home), ["https://a.com/", "https://b.com/"]);
  assert.deepEqual(mirror.tabIds.map((id) => S().tabs[id].pinnedUrl), ["https://a.com/", "https://b.com/"]);
  assert.deepEqual(rows(second), ["https://c.com/"]);

  S().placeTabs([c], { pinned: false, groupId: g });
  assert.deepEqual(folderOf(second, "Shared").tabIds.map(home), ["https://a.com/", "https://b.com/", "https://c.com/"]);
  assert.deepEqual(rows(second), []);

  S().removeFromFolder([a]);
  assert.deepEqual(folderOf(second, "Shared").tabIds.map(home), ["https://b.com/", "https://c.com/"]);
  assert.deepEqual(rows(second), ["https://a.com/"]);
  assert.deepEqual(rows(w), ["https://a.com/"]);
});

test("moving the folder's pages out releases them as pinned rows in order; the folder is gone", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedRows("a", "b", "c");
  const g = S().newFolder([a, b], "Out");
  S().releaseFolder(g);
  assert.equal(S().groups[g], undefined);
  assert.deepEqual(rows(w), ["https://c.com/", "https://a.com/", "https://b.com/"]);
  assert.ok([a, b].every((id) => S().tabs[id].pinned && S().tabs[id].pinnedAsRow));
  assert.ok(S().tabs[c].pinned);
});

test("deleting a folder keeps its pages in Recently Deleted, and restoring brings back the folder with their homes", () => {
  reset();
  const { w, ids: [a, b] } = pinnedRows("a", "b");
  const g = S().newFolder([a, b], "Doomed");
  S().updateTab(b, { url: "https://b.com/deep" });
  S().deleteGroup(g);
  assert.equal(folderOf(w, "Doomed"), undefined);
  const entry = S().deletedGroups.at(-1);
  assert.equal(entry.group.pinned, true);
  assert.deepEqual(entry.tabs.map((t) => t.pinnedUrl), ["https://a.com/", "https://b.com/"]);
  S().restoreClosed(entry.id, w);
  const back = folderOf(w, "Doomed");
  assert.ok(back);
  assert.deepEqual(back.tabIds.map((id) => S().tabs[id].pinnedUrl), ["https://a.com/", "https://b.com/"]);
});

test("duplicating a folder copies its pages with their homes", () => {
  reset();
  const { ids: [a] } = pinnedRows("a");
  const g = S().newFolder([a], "Dup");
  const copy = S().duplicateGroup(g);
  assert.ok(copy && copy !== g);
  assert.deepEqual(S().groups[copy].tabIds.map((id) => S().tabs[id].pinnedUrl), ["https://a.com/"]);
  assert.equal(S().groups[copy].pinned, true);
});

test("a pinned tile is not folded; only rows and folder pages are", () => {
  reset();
  const w = S().createWindow({ url: "https://tile.com/" });
  const [tile] = S().windows[w].tabIds;
  S().pinTabs([tile], true);
  assert.equal(organize.canFold(S(), tile), false);
  assert.equal(S().newFolder([tile], "No"), "");
  S().pinTabs([tile], true, true);
  assert.equal(organize.canFold(S(), tile), true);
});

test("saved state from before folders loads as it did, and its pinned group members have no home", () => {
  const tab = (id, u, extra = {}) => ({ id, windowId: "w", profileId: "default", url: u, title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0, ...extra });
  S().hydrate({
    windows: { w: { id: "w", profileId: "default", incognito: false, tabIds: ["m", "n", "u"], activeTabIds: { default: "u" }, sidebarOpen: true, frame: null, createdAt: 0 } },
    windowOrder: ["w"],
    tabs: { m: tab("m", "https://m.com/"), n: tab("n", "https://n.com/"), u: tab("u", "https://u.com/") },
    groups: { g: { id: "g", windowId: "w", profileId: "default", name: "Old", icon: null, color: null, collapsed: false, pinned: true, tabIds: ["m", "n"], createdAt: 0 } },
  });
  assert.deepEqual(S().groups.g.tabIds, ["m", "n"]);
  assert.equal(organize.hasPinnedPage(S(), S().tabs.m), false);
  assert.equal(organize.awayFromPin(S().tabs.m, true), false);
  S().updateTab("m", { url: "https://m.com/elsewhere" });
  assert.equal(organize.awayFromPin(S().tabs.m, true), false);
  assert.equal(model.inPinnedContainer(S(), "m"), true);
});

test("regular groups never take folder pages, whichever way they are asked", () => {
  reset();
  const { w, ids: [a, b] } = pinnedRows("a", "b");
  const plain = S().newTab(w, { url: "https://plain.com/" });
  const other = S().newTab(w, { url: "https://other.com/" });
  const g = S().newFolder([a, b], "Keep");
  const expectedHomes = ["https://a.com/", "https://b.com/"];
  assert.equal(S().createGroup([a, b]), "");
  const mixed = S().groupTabs([a, plain], { pinned: false, name: "Mixed" });
  assert.deepEqual(S().groups[mixed].tabIds, [plain], "only the plain tab is grouped");
  const regular = S().createGroup([other]);
  S().addTabsToGroup(regular, [a]);
  S().groupOnto([a], other);
  assert.deepEqual(S().groups[g].tabIds, [a, b]);
  assert.deepEqual(S().groups[regular].tabIds, [other]);
  assert.deepEqual(homes([a, b]), expectedHomes);
  assert.ok(organize.inFolder(S(), a));
});

test("a nested group made inside a folder keeps its pages' homes and stays pinned", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedRows("a", "b", "c");
  const outer = S().newFolder([a, b, c], "Outer");
  const inner = S().groupTabs([b, c], { name: "Inner" });
  assert.equal(S().groups[inner].parentId, outer);
  assert.equal(S().groups[inner].pinned, true);
  assert.deepEqual(homes([a, b, c]), ["https://a.com/", "https://b.com/", "https://c.com/"]);
  assert.ok([a, b, c].every((id) => organize.inFolder(S(), id) && organize.hasPinnedPage(S(), S().tabs[id])));
  assert.deepEqual(sidebarEntries(S(), w).pinned, [`g:${outer}`]);
});

test("a page in a nested folder of a folder closes at its home, leaves as a row, and is kept by Close Folder", () => {
  reset();
  const { w, ids: [a, b, c, d] } = pinnedRows("a", "b", "c", "d");
  const outer = S().newFolder([a, b, c], "Outer");
  const inner = S().groupTabs([b, c], { name: "Inner" });
  S().updateTab(b, { url: "https://b.com/deep" });
  assert.equal(organize.awayFromPin(S().tabs[b], organize.inFolder(S(), b)), true);
  S().closeTab(b);
  assert.equal(S().tabs[b].unloaded, true);
  assert.equal(S().tabs[b].url, "https://b.com/");
  S().updateTab(c, { url: "https://c.com/deep" });
  S().closeGroup(inner);
  assert.equal(S().tabs[c].url, "https://c.com/", "closing the inner folder unloads its pages");
  assert.ok(S().groups[inner], "and keeps it");
  S().updateTab(a, { url: "https://a.com/deep" });
  S().closeGroup(outer);
  assert.equal(S().tabs[a].url, "https://a.com/");
  assert.deepEqual(S().groups[outer].tabIds, [a, b, c]);
  S().removeFromFolder([c]);
  assert.equal(S().tabs[c].pinned, true);
  assert.equal(S().tabs[c].pinnedUrl, "https://c.com/");
  assert.equal(S().groups[inner].tabIds.length, 1);
  assert.deepEqual(rows(w).sort(), ["https://c.com/", "https://d.com/"]);
});

test("moving a nested folder out of its folder clears its pages' homes, and into a folder gives them one", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedRows("a", "b", "c");
  const outer = S().newFolder([a, b, c], "Outer");
  const inner = S().groupTabs([b, c], { name: "Inner" });
  S().updateTab(c, { url: "https://c.com/deep" });
  S().moveGroup(inner, { pinned: false, parentId: null, beforeId: null });
  assert.equal(S().groups[inner].pinned, false);
  assert.deepEqual(homes([b, c]), [null, null]);
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/");
  S().moveGroup(inner, { pinned: true, parentId: outer });
  assert.equal(S().groups[inner].pinned, true);
  assert.deepEqual(homes([b, c]), [null, null], "a page without a home stays plain inside the folder");
  assert.equal(organize.isFolder(S(), S().groups[inner]), true, "a nested group is part of its root's folder");
  assert.ok(w);
});

test("deleting a folder with a nested folder and restoring it brings every page's home back", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedRows("a", "b", "c");
  const outer = S().newFolder([a, b, c], "Outer");
  S().groupTabs([b, c], { name: "Inner" });
  S().updateTab(c, { url: "https://c.com/deep" });
  S().deleteGroup(outer);
  S().restoreClosed(S().deletedGroups.at(-1).id, w);
  const back = folderOf(w, "Outer");
  assert.ok(back);
  const inner = Object.values(S().groups).find((g) => g.name === "Inner");
  assert.equal(inner.parentId, back.id);
  assert.equal(inner.pinned, true);
  assert.deepEqual(back.tabIds.map((id) => S().tabs[id].pinnedUrl), ["https://a.com/", "https://b.com/", "https://c.com/"]);
});

test("releasing a folder that holds a nested folder turns every page into a row", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedRows("a", "b", "c");
  const outer = S().newFolder([a, b, c], "Outer");
  S().groupTabs([b, c], { name: "Inner" });
  S().releaseFolder(outer);
  assert.deepEqual(Object.values(S().groups), []);
  assert.deepEqual(rows(w), ["https://a.com/", "https://b.com/", "https://c.com/"]);
});

test("closing a folder unloads its pages at their homes and keeps the folder", () => {
  reset();
  const { w, ids: [a, b] } = pinnedRows("a", "b");
  const keep = S().newTab(w, { url: "https://keep.com/" });
  const g = S().newFolder([a, b], "Stay");
  S().updateTab(a, { url: "https://a.com/deep" });
  S().closeGroup(g);
  assert.deepEqual(S().groups[g].tabIds, [a, b]);
  assert.equal(S().groups[g].pinned, true);
  assert.ok([a, b].every((id) => S().tabs[id].unloaded));
  assert.equal(S().tabs[a].url, "https://a.com/");
  assert.deepEqual(homes([a, b]), ["https://a.com/", "https://b.com/"]);
  assert.ok(S().tabs[keep]);
  assert.equal(S().closedGroups.length, 0);
});

test("an ordinary pinned group is not a folder until a pinned page goes into it; Pin Group sets no homes", () => {
  reset();
  const w = S().createWindow({ url: "https://a.com/" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://b.com/" });
  const g = S().createGroup([a, b], { name: "Plain" });
  S().moveGroup(g, { pinned: true });
  assert.equal(S().groups[g].pinned, true);
  assert.deepEqual(homes([a, b]), [null, null]);
  assert.equal(organize.isFolder(S(), S().groups[g]), false);
  assert.equal(organize.inFolder(S(), a), false);
  assert.equal(organize.groupLabel(S(), { ...S().groups[g], name: "", tabIds: [] }), "New Group");
  S().moveGroup(g, { pinned: false });
  assert.equal(S().groups[g].pinned, false);
});

test("a pinned row moved into a plain pinned group turns it into a folder, and it is a plain group again when the last home leaves", () => {
  reset();
  const { w, ids: [a] } = pinnedRows("a");
  const b = S().newTab(w, { url: "https://b.com/" });
  const c = S().newTab(w, { url: "https://c.com/" });
  const g = S().groupTabs([b, c], { name: "Mine" });
  assert.equal(S().groups[g].pinned, true);
  assert.equal(organize.isFolder(S(), S().groups[g]), false);
  assert.deepEqual(organize.foldersOf(S(), w, "default").map((x) => x.id), [g], "listed by Move to Folder");
  S().placeTabs([a], { pinned: false, groupId: g });
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/");
  assert.equal(organize.isFolder(S(), S().groups[g]), true);
  assert.equal(organize.inFolder(S(), b), true);
  S().removeFromFolder([a]);
  assert.equal(organize.isFolder(S(), S().groups[g]), false);
  assert.deepEqual(S().groups[g].tabIds, [b, c]);
});

test("closing a plain pinned group goes to Recently Closed as before, and closing a folder unloads it", () => {
  reset();
  const { w, ids: [a] } = pinnedRows("a");
  const b = S().newTab(w, { url: "https://b.com/" });
  const keep = S().newTab(w, { url: "https://keep.com/" });
  const plain = S().groupTabs([b], { name: "Plain" });
  S().closeGroup(plain);
  assert.equal(S().groups[plain], undefined);
  assert.equal(S().closedGroups.length, 1);
  assert.equal(S().tabs[b], undefined);
  const g = S().newFolder([a], "F");
  S().closeGroup(g);
  assert.ok(S().groups[g]);
  assert.equal(S().tabs[a].unloaded, true);
  assert.equal(S().closedGroups.length, 1);
  assert.ok(S().tabs[keep]);
});

test("moving pages out of a folder makes homed pages rows and leaves the others plain tabs", () => {
  reset();
  const { w, ids: [a] } = pinnedRows("a");
  const plain = S().newTab(w, { url: "https://plain.com/" });
  const g = S().newFolder([a], "F");
  S().placeTabs([plain], { pinned: false, groupId: g });
  S().releaseFolder(g);
  assert.equal(S().groups[g], undefined);
  assert.equal(S().tabs[a].pinned, true);
  assert.equal(S().tabs[plain].pinned, false);
  assert.equal(S().tabs[plain].pinnedUrl, null);
  assert.equal(organize.inFolder(S(), plain), false);
});

test("the calendar checks see a pinned page in a folder, and not a plain member", () => {
  reset();
  const { w, ids: [a] } = pinnedRows("a");
  const plain = S().newTab(w, { url: "https://plain.com/" });
  const g = S().newFolder([a], "F");
  S().placeTabs([plain], { pinned: false, groupId: g });
  assert.equal(organize.hasPinnedPage(S(), S().tabs[a]), true);
  assert.equal(organize.hasPinnedPage(S(), S().tabs[plain]), false);
});

test("a page that leaves its folder for another window or profile keeps no stale home", () => {
  reset();
  const { ids: [a, b, c] } = pinnedRows("a", "b", "c");
  S().newFolder([a, b, c], "Away");
  const second = S().createWindow({ url: "https://other.com/" });
  const solo = S().createWindow({ url: "https://solo.com/" });
  S().moveTabsToWindow([a], second);
  assert.ok(organize.inFolder(S(), a) || S().tabs[a].pinnedUrl === null, "in the mirrored folder with its home, or out with none");
  S().moveTabsToWindow([c], solo);
  assert.equal(S().tabs[c].windowId, solo);
  const work = S().createProfile({ name: "Work" });
  S().moveTabToProfile(b, work);
  assert.equal(S().tabs[b].pinnedUrl, null);
});

test("a folder page moved to another window of the profile lands in its mirror of the folder with its home", () => {
  reset();
  const { ids: [a, b] } = pinnedRows("a", "b");
  const second = S().createWindow({ url: "https://other.com/" });
  S().newFolder([a, b], "Shared");
  S().updateTab(a, { url: "https://a.com/deep" });
  S().moveTabsToWindow([a], second);
  assert.equal(S().tabs[a].windowId, second);
  assert.equal(S().tabs[a].pinnedUrl, "https://a.com/");
  assert.ok(organize.inFolder(S(), a));
});

test("a folder page's menu actions: Unpin takes it out of the folder and clears its home, Top Apps makes it a tile", () => {
  reset();
  const { w, ids: [a, b] } = pinnedRows("a", "b");
  S().newFolder([a, b], "F");
  S().togglePin(a);
  assert.equal(S().tabs[a].pinned, false);
  assert.equal(organize.inFolder(S(), a), false);
  assert.equal(S().tabs[a].pinnedUrl, null);
  S().pinTabs([b], true, false);
  assert.equal(S().tabs[b].pinned, true);
  assert.equal(S().tabs[b].pinnedAsRow, undefined);
  assert.equal(S().tabs[b].pinnedUrl, "https://b.com/");
  assert.equal(folderOf(w, "F"), undefined);
});

test("a menu 'Unpin' of a plain folder page also leaves it a list tab, not a row", () => {
  reset();
  const { w, ids: [a, b] } = pinnedRows("a", "b");
  const plain = S().newTab(w, { url: "https://plain.com/" });
  const g = S().newFolder([a], "F");
  S().placeTabs([plain], { pinned: false, groupId: g });
  S().pinTabs([plain], false);
  assert.equal(organize.inFolder(S(), plain), false);
  assert.equal(S().tabs[plain].pinned, false);
  assert.ok(S().tabs[b].pinned);
});

test("the last window's close parks a nested folder's pages with their homes, and the next window adopts them nested", () => {
  reset();
  const { w, ids: [a, b, c] } = pinnedRows("a", "b", "c");
  S().newFolder([a, b, c], "Outer");
  S().groupTabs([b, c], { name: "Inner" });
  S().updateTab(c, { url: "https://c.com/deep" });
  S().closeWindow(w);
  const parked = S().parkedPins.default;
  assert.deepEqual(parked.tabs.map((t) => [t.pinnedUrl, t.url]), [
    ["https://a.com/", "https://a.com/"],
    ["https://b.com/", "https://b.com/"],
    ["https://c.com/", "https://c.com/"],
  ]);
  const n = S().createWindow();
  const inner = Object.values(S().groups).find((g) => g.windowId === n && g.name === "Inner");
  const outer = Object.values(S().groups).find((g) => g.windowId === n && g.name === "Outer");
  assert.equal(inner.parentId, outer.id);
  assert.deepEqual(outer.tabIds.map((id) => S().tabs[id].pinnedUrl), ["https://a.com/", "https://b.com/", "https://c.com/"]);
  assert.ok(outer.tabIds.every((id) => organize.hasPinnedPage(S(), S().tabs[id])));
});

test("a folder page pulled into a split leaves its folder without a home, so a new group around it is not a folder", () => {
  reset();
  const { w, ids: [a] } = pinnedRows("a");
  const plain = S().newTab(w, { url: "https://plain.com/" });
  S().newFolder([a], "F");
  S().createSplit([plain, a]);
  assert.equal(organize.inFolder(S(), a), false);
  assert.equal(S().tabs[a].pinnedUrl, null);
  const g = S().groupTabs([a, plain], { name: "Mine" });
  assert.equal(organize.isFolder(S(), S().groups[g]), false);
});

test("ungrouping a folder root leaves no home on its pages", () => {
  reset();
  const { ids: [a, b] } = pinnedRows("a", "b");
  const g = S().newFolder([a, b], "F");
  S().ungroup(g);
  assert.deepEqual(homes([a, b]), [null, null]);
});

test("grouping never gives a plain pinned group a stray home", () => {
  reset();
  const { w } = pinnedRows("a");
  const x = S().newTab(w, { url: "https://x.com/" });
  S().updateTab(x, { pinnedUrl: "https://x.com/" });
  const g = S().groupTabs([x], { name: "Stray" });
  assert.equal(S().tabs[x].pinnedUrl, null);
  assert.equal(organize.isFolder(S(), S().groups[g]), false);
  const y = S().newTab(w, { url: "https://y.com/" });
  S().updateTab(y, { pinnedUrl: "https://y.com/" });
  const h = S().createGroup([y]);
  S().updateGroup(h, { pinned: true });
  assert.equal(S().tabs[y].pinnedUrl, null);
});

test("groupTabs, pinned by default, never takes a folder page out of its folder", () => {
  reset();
  const { w, ids: [a, b] } = pinnedRows("a", "b");
  const plain = S().newTab(w, { url: "https://plain.com/" });
  const g = S().newFolder([a, b], "F");
  const made = S().groupTabs([a, plain]);
  assert.deepEqual(S().groups[g].tabIds, [a, b]);
  assert.deepEqual(S().groups[made].tabIds, [plain]);
  assert.deepEqual(homes([a, b]), ["https://a.com/", "https://b.com/"]);
});

test("an unnamed nested group's label follows its root's folder-ness", () => {
  reset();
  const { ids: [a, b, c] } = pinnedRows("a", "b", "c");
  const outer = S().newFolder([a, b, c], "Outer");
  const inner = S().groupTabs([b, c]);
  S().updateTab(b, { title: "", url: "", pinnedUrl: "https://b.com/" });
  S().updateTab(c, { title: "", url: "", pinnedUrl: "https://c.com/" });
  const label = () => organize.groupLabel(S(), S().groups[inner]);
  assert.equal(label(), "New Folder");
  S().updateTab(a, { pinnedUrl: null });
  S().updateTab(b, { pinnedUrl: null });
  S().updateTab(c, { pinnedUrl: null });
  assert.equal(label(), "New Group");
  assert.ok(outer);
});

test("a folder made by the new-folder action starts with the card index dividers icon, and plain groups keep theirs", () => {
  reset();
  const { w, ids: [a] } = pinnedRows("a");
  const g = S().newFolder([a], "Icon");
  assert.equal(S().groups[g].icon, "\u{1F5C2}\u{FE0F}");
  S().updateGroup(g, { icon: "🔥" });
  assert.equal(S().groups[g].icon, "🔥");
  const x = S().newTab(w, { url: "https://x.com/" });
  const y = S().newTab(w, { url: "https://y.com/" });
  const plainIcon = S().createGroup([x], { name: "Plain", icon: "🌟" });
  const plainNone = S().createGroup([y], { name: "Bare" });
  assert.equal(S().groups[plainIcon].icon, "🌟");
  assert.equal(S().groups[plainNone].icon, null);
});

test("a folder page moved to a window whose mirrored copy is loaded leaves no home on the copy left behind", () => {
  reset();
  const { ids: [a, b] } = pinnedRows("a", "b");
  const second = S().createWindow({ url: "https://other.com/" });
  S().newFolder([a, b], "Shared");
  const copy = S().groups[Object.keys(S().groups).find((id) => S().groups[id].windowId === second && S().groups[id].pinned)].tabIds.find((id) => home(id) === "https://a.com/");
  S().updateTab(copy, { navigation: model.navigationTo("https://a.com/") });
  S().moveTabsToWindow([a], second);
  for (const t of Object.values(S().tabs)) {
    if (t.pinnedUrl) assert.ok(t.pinned || organize.inFolder(S(), t.id), `${t.url} has a home outside a folder`);
  }
});

test("adding a tab with a stray home to a plain pinned group does not make it a folder", () => {
  reset();
  const w = S().createWindow({ url: "https://a.com/" });
  const x = S().newTab(w, { url: "https://x.com/" });
  const y = S().newTab(w, { url: "https://y.com/" });
  const g = S().groupTabs([y], { name: "Plain" });
  S().updateTab(x, { pinnedUrl: "https://x.com/" });
  S().addTabsToGroup(g, [x]);
  assert.equal(S().tabs[x].pinnedUrl, null);
  assert.equal(organize.isFolder(S(), S().groups[g]), false);
});
