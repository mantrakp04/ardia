import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const { groupEntries, sidebarEntries, numberedTabs } = await import("../components/sidebar/entries.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const host = (id) => new URL(S().tabs[id].url).hostname.replace(".com", "");
const hosts = (ids) => ids.map(host);
const order = (w) => hosts(S().windows[w].tabIds);
const rows = (groupId) => groupEntries(S(), groupId).map((e) => (e.startsWith("g:") ? `[${S().groups[e.slice(2)].name}]` : host(e.slice(2))));

function windowWith(...names) {
  const w = S().createWindow({ url: `https://${names[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of names.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/`, background: true }));
  return { w, ids };
}

function nested() {
  const { w, ids } = windowWith("a", "b", "c", "d", "e");
  const [a, b, c, d, e] = ids;
  const outer = S().groupTabs([a, b, c, d], { pinned: false, name: "Outer" });
  const inner = S().groupTabs([b, c], { name: "Inner" });
  return { w, a, b, c, d, e, outer, inner };
}

test("grouping tabs inside a group nests the new group there, the parent keeps the whole subtree", () => {
  reset();
  const { w, outer, inner, b, c } = nested();
  assert.equal(S().groups[inner].parentId, outer);
  assert.equal(S().groups[inner].pinned, false);
  assert.deepEqual(hosts(S().groups[outer].tabIds), ["a", "b", "c", "d"]);
  assert.deepEqual(hosts(S().groups[inner].tabIds), ["b", "c"]);
  assert.deepEqual(rows(outer), ["a", "[Inner]", "d"]);
  assert.deepEqual(sidebarEntries(S(), w).list, [`g:${outer}`, `t:${S().windows[w].tabIds[4]}`]);
  assert.deepEqual(hosts(numberedTabs(S(), w)), ["a", "b", "c", "d", "e"]);
  assert.equal(S().groups[inner].tabIds.includes(b) && S().groups[inner].tabIds.includes(c), true);
});

test("tabs move into a nested group, up to its parent, and out to the list", () => {
  reset();
  const { w, outer, inner, a, c, d, e } = nested();
  S().placeTabs([e], { pinned: false, groupId: inner, beforeId: null });
  assert.deepEqual(rows(outer), ["a", "[Inner]", "d"]);
  assert.deepEqual(rows(inner), ["b", "c", "e"]);
  assert.deepEqual(order(w), ["a", "b", "c", "e", "d"]);
  S().placeTabs([c], { pinned: false, groupId: outer, beforeId: d });
  assert.deepEqual(rows(inner), ["b", "e"]);
  assert.deepEqual(rows(outer), ["a", "[Inner]", "c", "d"]);
  S().placeTabs([a], { pinned: false, groupId: inner, beforeId: null });
  assert.deepEqual(rows(outer), ["[Inner]", "c", "d"]);
  assert.deepEqual(order(w), ["b", "e", "a", "c", "d"]);
  S().placeTabs([e], { pinned: false, beforeId: null });
  assert.deepEqual(rows(inner), ["b", "a"]);
  assert.equal(S().groups[outer].tabIds.includes(e), false);
  assert.deepEqual(order(w), ["b", "a", "c", "d", "e"]);
});

test("Remove from Group takes a tab up one level; ungrouping a nested group hands its tabs to the parent", () => {
  reset();
  const { outer, inner, b, c } = nested();
  S().removeTabsFromGroup([b]);
  assert.deepEqual(rows(outer), ["a", "[Inner]", "b", "d"]);
  assert.deepEqual(rows(inner), ["c"]);
  S().ungroup(inner);
  assert.equal(S().groups[inner], undefined);
  assert.deepEqual(rows(outer), ["a", "c", "b", "d"]);
  assert.equal(S().groups[outer].tabIds.includes(c), true);
});

test("ungrouping a root makes its nested groups roots", () => {
  reset();
  const { w, outer, inner } = nested();
  S().ungroup(outer);
  assert.equal(S().groups[inner].parentId, undefined);
  assert.equal(sidebarEntries(S(), w).list.includes(`g:${inner}`), true);
});

test("a group moves into another group, and never into its own subtree", () => {
  reset();
  const { w, ids } = windowWith("a", "b", "c", "d", "e", "f");
  const [a, b, c, d, e] = ids;
  const one = S().groupTabs([a, b], { pinned: false, name: "One" });
  const two = S().groupTabs([d, e], { pinned: false, name: "Two" });
  S().moveGroup(two, { pinned: false, parentId: one, beforeId: b });
  assert.equal(S().groups[two].parentId, one);
  assert.deepEqual(rows(one), ["a", "[Two]", "b"]);
  assert.deepEqual(order(w), ["a", "d", "e", "b", "c", "f"]);
  const before = S().groups;
  S().moveGroup(one, { pinned: false, parentId: two });
  assert.equal(S().groups, before, "refused: Two is inside One");
  S().moveGroup(two, { pinned: false, beforeId: c });
  assert.equal(S().groups[two].parentId, undefined);
  assert.deepEqual(rows(one), ["a", "b"]);
  assert.deepEqual(order(w), ["a", "b", "d", "e", "c", "f"]);
  S().moveGroup(two, { pinned: true, parentId: null });
  S().moveGroup(one, { pinned: false, parentId: two });
  assert.equal(S().groups[one].pinned, true, "a nested group takes its root's pin");
  assert.deepEqual(sidebarEntries(S(), w).pinnedGroups, [two]);
});

test("closing a group closes its subtree, and Recently Closed brings the tree back", () => {
  reset();
  const { w, outer, inner } = nested();
  S().updateGroup(inner, { collapsed: true });
  S().closeGroup(outer);
  assert.deepEqual(order(w), ["e"]);
  assert.equal(Object.keys(S().groups).length, 0);
  const entry = S().closedGroups.at(-1);
  assert.equal(entry.nested.length, 1);
  S().restoreClosed(entry.id, w);
  const root = Object.values(S().groups).find((g) => !g.parentId);
  const child = Object.values(S().groups).find((g) => g.parentId);
  assert.equal(child.parentId, root.id);
  assert.equal(child.name, "Inner");
  assert.equal(child.collapsed, true);
  assert.deepEqual(hosts(root.tabIds), ["a", "b", "c", "d"]);
  assert.deepEqual(rows(root.id), ["a", "[Inner]", "d"]);
});

test("closing a nested group leaves the parent, and its restore goes back inside", () => {
  reset();
  const { w, outer, inner } = nested();
  S().closeGroup(inner);
  assert.deepEqual(rows(outer), ["a", "d"]);
  S().restoreClosed(S().closedGroups.at(-1).id, w);
  const back = Object.values(S().groups).find((g) => g.parentId === outer);
  assert.ok(back);
  assert.deepEqual(hosts(back.tabIds), ["b", "c"]);
  assert.deepEqual(hosts(S().groups[outer].tabIds).sort(), ["a", "b", "c", "d"]);
});

test("duplicating a group copies its nested groups", () => {
  reset();
  const { outer } = nested();
  const copy = S().duplicateGroup(outer);
  assert.deepEqual(rows(copy), ["a", "[Inner]", "d"]);
  assert.notEqual(groupEntries(S(), copy)[1], groupEntries(S(), outer)[1]);
});

test("New Nested Group adds a group with a new tab at the end of its parent", () => {
  reset();
  const { w, outer } = nested();
  const child = S().newNestedGroup(outer);
  assert.equal(S().groups[child].parentId, outer);
  assert.equal(S().groups[child].tabIds.length, 1);
  assert.equal(groupEntries(S(), outer).at(-1), `g:${child}`);
  assert.equal(S().windows[w].tabIds.indexOf(S().groups[child].tabIds[0]), 4);
});

test("saved groups without parentId load as before; a dangling parentId is dropped", () => {
  reset();
  const { w, outer, inner } = nested();
  const data = { windows: S().windows, windowOrder: S().windowOrder, tabs: S().tabs, profiles: S().profiles, groups: { ...S().groups, [inner]: { ...S().groups[inner], parentId: "gone" } } };
  delete data.groups[outer];
  S().hydrate(JSON.parse(JSON.stringify(data)));
  assert.equal(S().groups[inner].parentId, undefined);
  assert.deepEqual(sidebarEntries(S(), w).list[0], `t:${S().windows[w].tabIds[0]}`);
  assert.ok(sidebarEntries(S(), w).list.includes(`g:${inner}`));
});

const chainsOf = (url) =>
  Object.values(S().groups)
    .filter((g) => !g.parentId && g.tabIds.some((id) => S().tabs[id]?.url === url))
    .map((g) => g.name);

test("moving a group into the parent that holds only it keeps the parent; taking the only child out is refused", () => {
  reset();
  const { ids } = windowWith("a", "b", "c");
  const outer = S().groupTabs([ids[1], ids[2]], { pinned: false, name: "Outer" });
  const inner = S().groupTabs([ids[1], ids[2]], { name: "Inner" });
  S().moveGroup(inner, { pinned: false, parentId: outer });
  assert.equal(S().groups[outer].tabIds.length, 2);
  assert.equal(S().groups[inner].parentId, outer);
  S().moveGroup(inner, { pinned: false, parentId: null });
  assert.ok(S().groups[outer], "Outer isn't deleted behind the user's back");
  assert.equal(S().groups[inner].parentId, outer);
});

test("a reopened tab goes back to its group wherever it is now, in one chain only", () => {
  reset();
  const { w, ids } = windowWith("a", "b", "c", "d", "e");
  const [a, b, c, d, e] = ids;
  const outer = S().groupTabs([a, b, c, d], { pinned: false, name: "Outer" });
  const inner = S().groupTabs([b, c], { name: "Inner" });
  S().closeTab(b);
  S().moveGroup(inner, { pinned: false, parentId: null, beforeId: e });
  S().reopenClosedTab(w);
  assert.deepEqual(chainsOf("https://b.com/"), ["Inner"]);
  S().closeTab(Object.values(S().tabs).find((t) => t.url === "https://b.com/").id);
  S().ungroup(inner);
  S().reopenClosedTab(w);
  assert.deepEqual(chainsOf("https://b.com/"), ["Inner"], "Inner is gone: it's made again, as the root it was when b closed");
  assert.equal(S().groups[outer].tabIds.length, 2);
});

test("nesting repair keeps a tab in a single chain", () => {
  reset();
  const { ids } = windowWith("a", "b", "c");
  const one = S().groupTabs([ids[0], ids[1]], { pinned: false, name: "One" });
  const inner = S().groupTabs([ids[1]], { name: "Inner" });
  const two = S().groupTabs([ids[2]], { pinned: false, name: "Two" });
  useBrowser.setState({ groups: { ...S().groups, [two]: { ...S().groups[two], tabIds: [...S().groups[two].tabIds, ids[1]] } } });
  assert.equal(S().groups[two].tabIds.includes(ids[1]), false);
  assert.ok(S().groups[inner].tabIds.includes(ids[1]) && S().groups[one].tabIds.includes(ids[1]));
});

const sectionsInOrder = (w) => {
  const s = S();
  const pinnedMember = new Set(Object.values(s.groups).filter((g) => g.pinned).flatMap((g) => g.tabIds));
  const rank = (id) => (s.tabs[id].pinned ? (s.tabs[id].pinnedAsRow ? 1 : 0) : pinnedMember.has(id) ? 2 : 3);
  const ranks = s.windows[w].tabIds.map(rank);
  return ranks.every((r, i) => i === 0 || ranks[i - 1] <= r);
};
const contiguous = (w, groupId) => {
  const ids = S().windows[w].tabIds;
  const at = S().groups[groupId].tabIds.map((id) => ids.indexOf(id));
  return at.every((x, i) => i === 0 || x === at[i - 1] + 1);
};

test("pinning a nested group under an unpinned parent leaves its tabs in the list, in order", () => {
  reset();
  const { w, inner, outer } = nested();
  S().pinTabs([S().windows[w].tabIds.at(-1)], true, true);
  S().updateGroup(inner, { pinned: true });
  assert.equal(S().groups[inner].pinned, false);
  assert.ok(sectionsInOrder(w), "tiles, rows, pinned groups, then the list");
  assert.ok(contiguous(w, outer) && contiguous(w, inner));
});

test("a new tab in a pinned group, or a new nested group in one, lands inside the group with a pinned group after it", () => {
  reset();
  const { w, ids } = windowWith("a", "b", "c", "d");
  const one = S().groupTabs([ids[0], ids[1]], { pinned: true, name: "One" });
  const two = S().groupTabs([ids[2]], { pinned: true, name: "Two" });
  const t = S().newTabInGroup(one);
  assert.equal(S().windows[w].tabIds.indexOf(t), S().windows[w].tabIds.indexOf(ids[1]) + 1);
  const child = S().newNestedGroup(one);
  assert.ok(contiguous(w, one) && contiguous(w, two) && contiguous(w, child));
  assert.ok(sectionsInOrder(w));
});

test("a cleaned-up duplicate from a nested group comes back inside its chain", () => {
  reset();
  const { w, a, b, c, outer, inner } = nested();
  S().removeTabsFromGroup([b]);
  const twin = S().newTab(w, { url: "https://c.com/", background: true });
  S().activate(a);
  for (const id of S().windows[w].tabIds) S().updateTab(id, { lastActiveAt: Date.now() });
  S().updateTab(c, { lastActiveAt: 1 });
  assert.equal(S().cleanUpTabs(w, { inactiveForMs: 1e12 }), 1);
  assert.equal(S().tabs[c], undefined);
  assert.equal(S().groups[inner], undefined, "the nested group went with its last tab");
  S().restoreCleaned();
  const back = Object.values(S().tabs).find((t) => t.url === "https://c.com/" && t.id !== twin).id;
  const chain = Object.values(S().groups).filter((g) => g.tabIds.includes(back)).map((g) => g.name).sort();
  assert.deepEqual(chain, ["Inner", "Outer"]);
  assert.ok(contiguous(w, outer));
});

test("nesting deeper than 64 levels keeps every level", () => {
  reset();
  const { w, ids } = windowWith("a", "b");
  let parent = S().groupTabs([ids[0]], { pinned: false, name: "L0" });
  for (let i = 1; i <= 70; i++) parent = S().groupTabs([ids[0]], { name: `L${i}` });
  assert.equal(S().groups[parent].name, "L70");
  let depth = 0;
  for (let g = S().groups[parent]; g.parentId; g = S().groups[g.parentId]) depth++;
  assert.equal(depth, 70);
  assert.ok(contiguous(w, parent));
});

test("a saved or synced nested group pinned unlike its root settles to the root's pin and its section", () => {
  reset();
  const { w, outer, inner } = nested();
  S().pinTabs([S().windows[w].tabIds.at(-1)], true, true);
  const data = { windows: S().windows, windowOrder: S().windowOrder, tabs: S().tabs, profiles: S().profiles, groups: { ...S().groups, [inner]: { ...S().groups[inner], pinned: true } } };
  S().hydrate(JSON.parse(JSON.stringify(data)));
  assert.equal(S().groups[inner].pinned, false);
  assert.ok(sectionsInOrder(w));
  assert.ok(contiguous(w, outer) && contiguous(w, inner));
  useBrowser.setState({ groups: { ...S().groups, [inner]: { ...S().groups[inner], pinned: true } } });
  assert.equal(S().groups[inner].pinned, false);
  assert.ok(sectionsInOrder(w) && contiguous(w, outer));
});

test("settling a nested group pinned unlike its root keeps pinned groups ahead of the list", async () => {
  const { settleNesting } = await import("./groups.ts");
  const tab = (id, extra = {}) => ({ id, windowId: "w", profileId: "default", url: `https://${id}.example/`, pinned: false, ...extra });
  const tabs = { e: tab("e", { pinned: true, pinnedAsRow: true }), b: tab("b"), c: tab("c"), p: tab("p"), a: tab("a"), d: tab("d") };
  const group = (id, tabIds, extra = {}) => ({ id, windowId: "w", profileId: "default", name: id, icon: null, color: null, collapsed: false, pinned: false, tabIds, createdAt: 0, ...extra });
  const groups = {
    O: group("O", ["b", "c", "a", "d"]),
    I: group("I", ["b", "c"], { parentId: "O", pinned: true }),
    P: group("P", ["p"], { pinned: true }),
  };
  const windows = { w: { id: "w", profileId: "default", tabIds: ["e", "b", "c", "p", "a", "d"], activeTabIds: {} } };
  const settled = settleNesting({ tabs, groups, windows });
  assert.equal(settled.groups.I.pinned, false);
  assert.deepEqual(settled.windows.w.tabIds, ["e", "p", "b", "c", "a", "d"]);
});
