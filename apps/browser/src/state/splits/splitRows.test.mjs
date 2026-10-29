import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { wokenPage } = await import("../tabs/pageSession.ts");
const { parkWindowPins, adoptParkedPins } = await import("../pins/parkedPins.ts");
const { sidebarEntries, groupEntries, numberedTabs } = await import("../sidebar/entries.ts");
const { splitTabIdsOf } = await import("./splits.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const host = (id) => new URL(S().tabs[id].pinnedUrl || S().tabs[id].url).hostname.replace(".com", "");
const splitOfTab = (id) => Object.values(S().splits).find((v) => splitTabIdsOf(v).includes(id));
const panesOf = (w) => Object.values(S().splits).filter((v) => v.windowId === w).map((v) => splitTabIdsOf(v).map(host));

function windowWith(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/`, background: true }));
  return { w, ids };
}

function splitWindow() {
  const { w, ids } = windowWith("a", "b", "c", "d");
  const [a, b, c, d] = ids;
  const splitId = S().createSplit([b, c]);
  return { w, a, b, c, d, splitId };
}

test("pinning one pane pins the whole split as one pinned row, and unpinning brings it back as one row", () => {
  reset();
  const { w, a, b, c, d, splitId } = splitWindow();
  S().activate(c);
  S().togglePin(c);
  assert.equal(!!S().tabs[b].pin && (S().tabs[b].pin?.as === "row"), true, "the other pane is pinned too");
  assert.equal(!!S().tabs[c].pin && (S().tabs[c].pin?.as === "row"), true, "a pinned split is a pinned row, never Top Apps tiles");
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, c], "the split stays");
  const e = sidebarEntries(S(), w);
  assert.deepEqual(e.tiles, []);
  assert.deepEqual(e.pinned, [`s:${splitId}`], "one pinned row for the split");
  assert.deepEqual(e.list, [`t:${a}`, `t:${d}`]);
  assert.deepEqual(numberedTabs(S(), w).map(host).slice(0, 1), ["c"], "⌘1 is the split's focused pane");

  S().togglePin(b);
  assert.equal(!!S().tabs[b].pin || !!S().tabs[c].pin, false);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, c]);
  assert.deepEqual(sidebarEntries(S(), w).list.filter((x) => x.startsWith("s:")), [`s:${splitId}`]);
});

test("Move to Top Apps on a pinned split pane keeps the split a row", () => {
  reset();
  const { b, c, splitId } = splitWindow();
  S().pinTabs([b], true);
  S().pinTabs([b], true, false);
  assert.equal((S().tabs[b].pin?.as === "row") && (S().tabs[c].pin?.as === "row"), true);
  assert.ok(S().splits[splitId]);
});

test("Move to Group and New Group with Tab take the whole split, shown once inside the group", () => {
  reset();
  const { w, a, b, c, d, splitId } = splitWindow();
  const g = S().groupTabs([a], { pinned: false, name: "G" });
  S().placeTabs([c], { pinned: false, groupId: g });
  assert.deepEqual(S().groups[g].tabIds, [a, b, c].filter((id) => S().groups[g].tabIds.includes(id)));
  assert.deepEqual(new Set(S().groups[g].tabIds), new Set([a, b, c]), "both panes joined the group");
  assert.deepEqual(groupEntries(S(), g), [`t:${a}`, `s:${splitId}`]);
  assert.deepEqual(sidebarEntries(S(), w).list, [`g:${g}`, `t:${d}`], "the split isn't left behind in the list");

  S().removeTabsFromGroup([b]);
  assert.deepEqual(S().groups[g].tabIds, [a], "Remove from Group takes the split out whole");
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, c]);

  const made = S().groupTabs([b], { pinned: false });
  assert.deepEqual(new Set(S().groups[made].tabIds), new Set([b, c]));
  assert.deepEqual(groupEntries(S(), made), [`s:${splitId}`]);
});

test("a split moved into a pinned group stays a split there", () => {
  reset();
  const { w, a, b, c, splitId } = splitWindow();
  const g = S().groupTabs([a], { pinned: true, name: "P" });
  S().placeTabs([b], { pinned: false, groupId: g });
  assert.deepEqual(new Set(S().groups[g].tabIds), new Set([a, b, c]));
  assert.equal(model.inPinnedContainer(S(), c), true);
  assert.deepEqual(sidebarEntries(S(), w).pinned, [`g:${g}`]);
  assert.deepEqual(groupEntries(S(), g), [`t:${a}`, `s:${splitId}`]);
});

test("a tab dropped before a split's second pane in window order lands before the whole split", () => {
  reset();
  const { w, a, b, c, d, splitId } = splitWindow();
  S().movePane(b, 1);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [c, b]);
  S().placeTabs([d], { pinned: false, beforeId: c });
  const order = S().windows[w].tabIds;
  assert.deepEqual(order.map(host), ["a", "d", "b", "c"], "the panes stay together");
  assert.equal(order.includes(a), true);
});

test("a pinned split shows as a split in the profile's other windows, and unsplitting there follows", () => {
  reset();
  const { w, b, splitId } = splitWindow();
  S().pinTabs([b], true);
  const other = S().createWindow({ url: "https://z.com/" });
  assert.deepEqual(panesOf(other), [["b", "c"]], "the other window has its own split of its own copies");
  const copy = Object.values(S().splits).find((v) => v.windowId === other);
  assert.notEqual(copy.id, splitId);
  assert.ok(splitTabIdsOf(copy).every((id) => S().tabs[id].windowId === other && (S().tabs[id].pin?.as === "row")));
  assert.deepEqual(sidebarEntries(S(), other).pinned, [`s:${copy.id}`]);

  S().toggleSplitOrientation(splitId);
  assert.equal(Object.values(S().splits).find((v) => v.windowId === other).orientation, "vertical", "orientation follows");

  S().removeTabFromSplit(b);
  assert.deepEqual(panesOf(w), []);
  assert.deepEqual(panesOf(other), [], "separating it in one window separates it everywhere");
  assert.equal(sidebarEntries(S(), other).pinned.length, 2, "two pinned rows remain");
});

test("a pinned split is parked with its window and comes back a split", () => {
  reset();
  const { w, b, c, splitId } = splitWindow();
  S().pinTabs([b], true);
  const parked = parkWindowPins({}, S().windows[w], S());
  assert.deepEqual(parked.default.splits.map((v) => splitTabIdsOf(v)), [[b, c]]);
  S().hydrate({});
  const n = S().createWindow({ url: "https://z.com/" });
  useBrowser.setState({ parkedPins: parked });
  useBrowser.setState(adoptParkedPins(S(), n, "default"));
  assert.deepEqual(panesOf(n), [["b", "c"]]);
  const v = Object.values(S().splits).find((x) => x.windowId === n);
  assert.equal(v.orientation, S().splits[splitId]?.orientation ?? "horizontal");
  assert.deepEqual(sidebarEntries(S(), n).pinned, [`s:${v.id}`]);
  const order = S().windows[n].tabIds;
  assert.equal(Math.abs(order.indexOf(splitTabIdsOf(v)[0]) - order.indexOf(splitTabIdsOf(v)[1])), 1, "its panes sit together");
});

test("a pinned split survives a relaunch", () => {
  reset();
  const { w, b, c, splitId } = splitWindow();
  S().pinTabs([b], true);
  const saved = JSON.parse(JSON.stringify({ windows: S().windows, tabs: S().tabs, groups: S().groups, splits: S().splits, profiles: S().profiles, windowOrder: S().windowOrder }));
  S().hydrate(saved);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, c]);
  assert.deepEqual(sidebarEntries(S(), w).pinned, [`s:${splitId}`]);
});

test("a pane added to a pinned split is pinned with it, and the other window's copy follows", () => {
  reset();
  const { w, b, c, splitId } = splitWindow();
  S().pinTabs([b], true);
  const other = S().createWindow({ url: "https://z.com/" });
  const r = S().openSplitPane(w, { anchorTabId: c, side: "bottom", url: "https://e.com/" });
  assert.equal(r.ok, true);
  assert.equal(!!S().tabs[r.tabId].pin && (S().tabs[r.tabId].pin?.as === "row"), true, "the new pane is a pinned row like the others");
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]).map(host), ["b", "c", "e"]);
  assert.deepEqual(sidebarEntries(S(), w).pinned, [`s:${splitId}`], "still one pinned row");
  assert.deepEqual(sidebarEntries(S(), w).list.map((e) => host(e.slice(2))), ["a", "d"]);
  assert.deepEqual(panesOf(other), [["b", "c", "e"]], "the other window keeps a split, now of three");
});

test("replacing a pinned split's pane with a tab from the list pins that tab in its place", () => {
  reset();
  const { w, a, b, c, splitId } = splitWindow();
  S().pinTabs([b], true);
  S().replaceSplitPane(c, a);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, a]);
  assert.equal(!!S().tabs[a].pin && (S().tabs[a].pin?.as === "row"), true);
  assert.deepEqual(sidebarEntries(S(), w).pinned, [`s:${splitId}`]);
});

test("a fresh split from a pinned row still leaves the new tab unpinned", () => {
  reset();
  const { w, a } = splitWindow();
  S().pinTabs([a], true, true);
  const r = S().openSplitPane(w, { anchorTabId: a, url: "https://e.com/" });
  assert.equal(!!S().tabs[r.tabId].pin, false);
});

test("parking keeps both panes of a pinned split even at the same page, or at a pinned tile's page", () => {
  reset();
  const { w, ids } = windowWith("a", "b", "b", "b");
  const [, b1, b2, t] = ids;
  S().pinTabs([t], true);
  S().createSplit([b1, b2]);
  S().pinTabs([b1], true);
  const parked = parkWindowPins({}, S().windows[w], S());
  assert.deepEqual(parked.default.splits?.map((v) => splitTabIdsOf(v)), [[b1, b2]], "both panes parked, by identity");
  S().hydrate({});
  const n = S().createWindow({ url: "https://z.com/" });
  useBrowser.setState({ parkedPins: parked });
  useBrowser.setState(adoptParkedPins(S(), n, "default"));
  assert.deepEqual(panesOf(n), [["b", "b"]]);
  const v = Object.values(S().splits).find((x) => x.windowId === n);
  assert.deepEqual(sidebarEntries(S(), n).pinned, [`s:${v.id}`]);
  assert.equal(sidebarEntries(S(), n).tiles.length, 1, "the tile at the same page stays too");
});

test("merging two windows' pins never folds a pinned split's panes into another window's pin at the same page", () => {
  reset();
  const profiles = S().profiles;
  const tab = (id, windowId, url, pinned) => ({ ...model.makeTab(windowId, "default", url, pinned ? { pin: { as: "row" }, pinnedUrl: url } : {}), id });
  const win = (id, tabIds, active) => ({ id, profileId: "default", kind: "main", tabIds, activeTabIds: { default: active }, sidebarOpen: true, frame: null, createdAt: 0 });
  const tabs = Object.fromEntries(
    [tab("a1", "wA", "https://x.com/", true), tab("a2", "wA", "https://y.com/"), tab("b1", "wB", "https://x.com/", true), tab("b2", "wB", "https://x.com/", true), tab("b3", "wB", "https://z.com/")].map((t) => [t.id, t]),
  );
  S().hydrate({
    profiles,
    windows: { wA: win("wA", ["a1", "a2"], "a2"), wB: win("wB", ["b1", "b2", "b3"], "b3") },
    windowOrder: ["wB", "wA"],
    tabs,
    splits: { sp: { id: "sp", windowId: "wB", orientation: "horizontal", slots: [{ size: 0.5, tabId: "b1" }, { size: 0.5, tabId: "b2" }] } },
  });
  assert.deepEqual(splitTabIdsOf(S().splits.sp), ["b1", "b2"], "B's split keeps its own two panes");
  assert.deepEqual(panesOf("wA").map((p) => p.length), [2], "A gets the split too");
  assert.equal(sidebarEntries(S(), "wB").pinned.filter((e) => e.startsWith("s:")).length, 1);
  for (const w of ["wA", "wB"]) assert.equal(model.viewTabIds(S(), w).filter((id) => !!S().tabs[id].pin).length, 3, "A's own pin and the split's two panes, in each window");
});

const loaded = (id) => !!(S().tabs[id].page.nav || S().tabs[id].page.adopt || S().tabs[id].page.holderId);
const shown = (w) => S().windows[w].activeTabIds[S().windows[w].profileId];

test("closing a pane of a pinned split closes the split as one pinned row and keeps it a split", () => {
  reset();
  const { w, a, b, c, d, splitId } = splitWindow();
  S().pinTabs([b], true);
  S().activate(c);
  S().closeTab(c);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, c], "the split stays whole");
  assert.equal((S().tabs[b].pin?.as === "row") && (S().tabs[c].pin?.as === "row"), true, "both panes stay pinned rows");
  assert.equal(loaded(b) || loaded(c), false, "both panes unload together");
  assert.deepEqual(sidebarEntries(S(), w).pinned, [`s:${splitId}`], "still one pinned row");
  assert.ok([a, d].includes(shown(w)), "the window moves off the split");

  S().activate(b);
  assert.equal(shown(w), b);
  S().closeTab(b);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, c], "closing it again from the other pane keeps it a split");
});

test("closing a pane of a three-pane pinned split keeps all three panes", () => {
  reset();
  const { w, b, c, splitId } = splitWindow();
  S().pinTabs([b], true);
  const r = S().openSplitPane(w, { anchorTabId: c, url: "https://e.com/" });
  S().closeTab(r.tabId);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]).map(host), ["b", "c", "e"]);
  assert.equal([b, c, r.tabId].some(loaded), false);
  assert.deepEqual(sidebarEntries(S(), w).pinned, [`s:${splitId}`]);
});

test("closing a pane of a split in a pinned group keeps the split inside the group", () => {
  reset();
  const { w, a, b, c, splitId } = splitWindow();
  const g = S().groupTabs([a], { pinned: true, name: "P" });
  S().placeTabs([b], { pinned: false, groupId: g });
  S().activate(b);
  S().closeTab(b);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, c]);
  assert.equal(loaded(b) || loaded(c), false);
  assert.deepEqual(groupEntries(S(), g), [`t:${a}`, `s:${splitId}`]);
  assert.notEqual(shown(w), c, "the other pane isn't shown alone");
});

test("closing a pinned split's pane in another window keeps the split in every window", () => {
  reset();
  const { w, b, splitId } = splitWindow();
  S().pinTabs([b], true);
  const other = S().createWindow({ url: "https://z.com/" });
  const copy = Object.values(S().splits).find((v) => v.windowId === other);
  S().activate(splitTabIdsOf(copy)[0]);
  S().closeTab(splitTabIdsOf(copy)[0]);
  assert.deepEqual(panesOf(other), [["b", "c"]]);
  assert.deepEqual(panesOf(w), [["b", "c"]]);
  assert.ok(S().splits[splitId]);
});

test("closing the pinned side of a fresh split from a pinned row leaves the unpinned tab on its own", () => {
  reset();
  const { w, a } = splitWindow();
  S().pinTabs([a], true, true);
  const r = S().openSplitPane(w, { anchorTabId: a, url: "https://e.com/" });
  S().activate(a);
  S().closeTab(a);
  assert.equal(splitOfTab(a), undefined, "the split ends");
  assert.equal(loaded(a), false);
  assert.equal(loaded(r.tabId), true, "the unpinned page stays");
  assert.equal(shown(w), r.tabId);
});

test("showing a closed pinned split again wakes every pane as a loaded tab", () => {
  reset();
  const { w, b, c } = splitWindow();
  S().pinTabs([b], true);
  S().activate(b);
  S().closeTab(b);
  assert.equal(S().tabs[b].page.kind === "asleep" && S().tabs[c].page.kind === "asleep", true);
  S().activate(b);
  S().updateTab(c, { page: wokenPage(S().tabs[c]) });
  assert.equal(shown(w), b);
  assert.equal(loaded(b) && loaded(c), true);
  assert.equal(S().tabs[b].page.kind === "asleep" || S().tabs[c].page.kind === "asleep", false, "no pane keeps the closed flag once its page loads");
});

test("a link opened into a split's other pane takes that pane with its own tab and keeps the old pane as a tab after the split", () => {
  reset();
  const { w, a, b, c, d, splitId } = splitWindow();
  S().activate(b);
  const groups = Object.keys(S().groups);
  const result = S().openSplitPane(w, { anchorTabId: b, url: "https://e.com/", side: "right", background: true, adoptId: "tab:42", inPlaceOf: c });
  assert.equal(result.ok, true);
  const e = result.tabId;
  assert.equal(S().tabs[e].page.adopt, "tab:42", "the engine's tab is adopted, not loaded again");
  assert.equal(S().tabs[e].page.nav, null);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, e]);
  assert.equal(splitOfTab(c), undefined);
  assert.deepEqual(S().windows[w].tabIds, [a, b, e, c, d], "the old pane follows the split");
  assert.equal(model.activeTabId(S(), w), b, "the page keeps focus");
  assert.deepEqual(Object.keys(S().groups), groups, "no group is made");
});

test("a full split takes the link in place of the pane after its page, and refuses a new pane without one", () => {
  reset();
  const { w, a, b, c, d, splitId } = splitWindow();
  S().openSplitPane(w, { anchorTabId: c, tabId: d, side: "right" });
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, c, d]);
  assert.deepEqual(S().openSplitPane(w, { anchorTabId: b, url: "https://e.com/", background: true }), { ok: false, reason: "max" });
  const result = S().openSplitPane(w, { anchorTabId: b, url: "https://e.com/", background: true, inPlaceOf: c });
  assert.equal(result.ok, true);
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, result.tabId, d]);
  assert.deepEqual(S().windows[w].tabIds, [a, b, result.tabId, d, c]);
});

test("a link opened into a pinned two-pane split's other pane is pinned in its place, and the other window's copy follows", () => {
  reset();
  const { w, b, c, splitId } = splitWindow();
  S().pinTabs([b], true);
  const other = S().createWindow({ url: "https://z.com/" });
  const r = S().openSplitPane(w, { anchorTabId: b, url: "https://e.com/", side: "right", background: true, adoptId: "tab:7", inPlaceOf: c });
  assert.equal(r.ok, true);
  assert.equal(!!S().tabs[r.tabId].pin && (S().tabs[r.tabId].pin?.as === "row"), true, "the new pane is a pinned row like the page");
  assert.deepEqual(splitTabIdsOf(S().splits[splitId]), [b, r.tabId]);
  assert.deepEqual(sidebarEntries(S(), w).pinned.filter((e) => e.startsWith("s:")), [`s:${splitId}`], "still one pinned split row");
  assert.ok(!sidebarEntries(S(), w).pinned.includes(`t:${r.tabId}`) && !sidebarEntries(S(), w).list.includes(`t:${r.tabId}`), "the new pane shows only in the split row");
  assert.deepEqual(panesOf(other), [["b", "e"]], "the other window keeps the split, with the new pane");
});
