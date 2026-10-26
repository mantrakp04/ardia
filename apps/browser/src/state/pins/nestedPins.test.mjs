import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const host = (id) => new URL(S().tabs[id].pinnedUrl || S().tabs[id].url).hostname.replace(".com", "");
const innermost = (id) => {
  const depth = (g) => (g.parentId && S().groups[g.parentId] ? 1 + depth(S().groups[g.parentId]) : 0);
  return Object.values(S().groups).filter((g) => g.tabIds.includes(id)).sort((a, z) => depth(z) - depth(a))[0];
};
const path = (g) => (g.parentId && S().groups[g.parentId] ? `${path(S().groups[g.parentId])}/${g.name}` : g.name);
const pinnedArea = (w) =>
  model.viewTabIds(S(), w).filter((id) => model.inPinnedContainer(S(), id)).map((id) => {
    const t = S().tabs[id];
    if (t.pinned) return `${t.pinnedAsRow ? "row" : "tile"}:${host(id)}`;
    return `${path(innermost(id))}:${host(id)}`;
  });

function windowWith(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/`, background: true }));
  return { w, ids };
}

function pinnedTree() {
  const { w, ids } = windowWith("home", "tile", "r1", "o1", "i1", "i2", "o2", "r2", "x");
  const [, tile, r1, o1, i1, i2, o2, r2, x] = ids;
  S().pinTabs([tile], true);
  S().pinTabs([r1], true, true);
  const outer = S().groupTabs([o1, i1, i2, o2], { pinned: true, name: "Outer" });
  const inner = S().groupTabs([i1, i2], { name: "Inner" });
  S().pinTabs([r2], true, true);
  const other = S().groupTabs([x], { pinned: true, name: "Other" });
  S().placeTabs([r2], { pinned: true, row: true, beforeId: x });
  return { w, outer, inner, other };
}

const TREE = ["tile:tile", "row:r1", "Outer:o1", "Outer/Inner:i1", "Outer/Inner:i2", "Outer:o2", "row:r2", "Other:x"];
const groupIn = (w, name) => Object.values(S().groups).find((g) => g.windowId === w && g.name === name);

test("a pinned group with a nested group mirrors to another window with its nesting and the rows between groups", () => {
  reset();
  const { w: a } = pinnedTree();
  assert.deepEqual(pinnedArea(a), TREE);
  const b = S().createWindow({ url: "https://b.com/" });
  assert.deepEqual(pinnedArea(b), TREE);
  const [outer, inner] = [groupIn(b, "Outer"), groupIn(b, "Inner")];
  assert.notEqual(outer.id, groupIn(a, "Outer").id, "B has its own copies");
  assert.equal(inner.parentId, outer.id, "nested under B's own copy");
  assert.equal(inner.pinned, true);
  assert.deepEqual(outer.tabIds.map(host), ["o1", "i1", "i2", "o2"], "the parent holds its whole subtree");

  const r2 = model.viewTabIds(S(), b).find((id) => host(id) === "r2");
  S().placeTabs([r2], { pinned: true, row: true, beforeId: outer.tabIds[0] });
  const moved = ["tile:tile", "row:r1", "row:r2", "Outer:o1", "Outer/Inner:i1", "Outer/Inner:i2", "Outer:o2", "Other:x"];
  assert.deepEqual(pinnedArea(b), moved);
  assert.deepEqual(pinnedArea(a), moved, "a row moved between groups in B moves in A");

  const o2 = groupIn(a, "Outer").tabIds.find((id) => host(id) === "o2");
  S().placeTabs([o2], { pinned: false, groupId: groupIn(a, "Inner").id, beforeId: null });
  const nested = ["tile:tile", "row:r1", "row:r2", "Outer:o1", "Outer/Inner:i1", "Outer/Inner:i2", "Outer/Inner:o2", "Other:x"];
  assert.deepEqual(pinnedArea(a), nested);
  assert.deepEqual(pinnedArea(b), nested, "a tab moved into the nested group in A moves in B");

  const r1 = model.viewTabIds(S(), b).find((id) => host(id) === "r1");
  S().placeTabs([r2], { pinned: true, row: true, beforeId: r1 });
  const swapped = ["tile:tile", "row:r2", "row:r1", "Outer:o1", "Outer/Inner:i1", "Outer/Inner:i2", "Outer/Inner:o2", "Other:x"];
  assert.deepEqual(pinnedArea(b), swapped);
  assert.deepEqual(pinnedArea(a), swapped, "a row moved among rows in B moves in A");

  S().updateGroup(groupIn(b, "Inner").id, { name: "Deep" });
  assert.equal(groupIn(a, "Deep")?.parentId, groupIn(a, "Outer").id, "a rename follows and keeps the nesting");
});

test("closing the last window parks the pinned tree; the next window takes it back nested and in order", () => {
  reset();
  const { w } = pinnedTree();
  S().closeWindow(w);
  const park = S().parkedPins.default;
  const byName = Object.fromEntries(park.groups.map((g) => [g.name, g]));
  assert.equal(byName.Inner.parentId, byName.Outer.id);
  assert.equal(byName.Outer.parentId, undefined);
  assert.deepEqual(park.tabs.filter((p) => p.groupId === byName.Inner.id).map((p) => new URL(p.url).hostname), ["i1.com", "i2.com"]);
  const b = S().createWindow({ url: "https://b.com/" });
  assert.deepEqual(pinnedArea(b), TREE);
  assert.equal(groupIn(b, "Inner").parentId, groupIn(b, "Outer").id);
  assert.deepEqual(groupIn(b, "Outer").tabIds.map(host), ["o1", "i1", "i2", "o2"]);
  assert.equal(S().parkedPins.default, undefined, "the park empties");
});

test("parked pins saved before nesting existed load as before", () => {
  reset();
  const snap = (u) => ({ url: u, title: u, favicon: null, profileId: "default", pinned: false, muted: false });
  useBrowser.setState({
    parkedPins: {
      default: {
        tabs: [{ ...snap("https://t.com/"), pinned: true, pinnedUrl: "https://t.com/", id: "t1", groupId: null }, { ...snap("https://m.com/"), id: "m1", groupId: "g1" }],
        groups: [{ id: "g1", name: "G", icon: null, color: null, collapsed: false }],
      },
    },
  });
  const w = S().createWindow({ url: "https://b.com/" });
  assert.deepEqual(pinnedArea(w), ["tile:t", "G:m"]);
  assert.equal(S().groups.g1.parentId, undefined);
});

test("a closed window comes back with its nested groups", () => {
  reset();
  const { w, ids } = windowWith("a", "b", "c", "d");
  S().groupTabs(ids.slice(0, 3), { pinned: false, name: "Outer" });
  S().groupTabs(ids.slice(1, 3), { name: "Inner" });
  S().createWindow({ url: "https://keep.com/" });
  S().closeWindow(w);
  S().restoreClosed(S().closedWindows.at(-1).id);
  const back = Object.values(S().windows).find((x) => x.tabIds.some((id) => host(id) === "a"));
  const [o, i] = [groupIn(back.id, "Outer"), groupIn(back.id, "Inner")];
  assert.equal(i.parentId, o.id);
  assert.deepEqual(o.tabIds.map(host), ["a", "b", "c"]);
  assert.deepEqual(i.tabIds.map(host), ["b", "c"]);
});

test("a closed window restored while its groups' ids are taken maps the nesting to the new ids", () => {
  reset();
  const { w, ids } = windowWith("a", "b", "c");
  const outer = S().groupTabs(ids.slice(0, 2), { pinned: false, name: "Outer" });
  const inner = S().groupTabs(ids.slice(1, 2), { name: "Inner" });
  S().createWindow({ url: "https://keep.com/" });
  S().closeWindow(w);
  const entry = S().closedWindows.at(-1);
  const other = Object.keys(S().windows)[0];
  useBrowser.setState((s) => ({
    groups: { ...s.groups, [outer]: { id: outer, windowId: other, profileId: "default", name: "Taken", icon: null, color: null, collapsed: false, pinned: false, tabIds: [], createdAt: 0 } },
  }));
  S().restoreClosed(entry.id);
  const back = Object.values(S().windows).find((x) => x.tabIds.some((id) => host(id) === "a"));
  const [o, i] = [groupIn(back.id, "Outer"), groupIn(back.id, "Inner")];
  assert.notEqual(o.id, outer);
  assert.equal(i.id, inner);
  assert.equal(i.parentId, o.id);
});
