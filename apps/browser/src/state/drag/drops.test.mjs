import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const drops = await import("./drops.ts");
const { stripEntries } = await import("../tabs/topStrip.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const host = (id) => new URL(S().tabs[id].url).hostname.split(".")[0];

function windowWith(...hosts) {
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

function dockWith() {
  reset();
  const { w, ids } = windowWith("t1", "t2", "c", "d", "e", "u");
  const [t1, t2, c, d, e] = ids;
  S().pinTabs([t1, t2], true);
  S().pinTabs([c, d, e], true, true);
  return { w, ids };
}

const dockSlots = (w) =>
  stripEntries(S(), w, S().windows[w].profileId).flatMap((e) => (e.kind === "dock" ? e.ids.filter((cell) => !e.members.has(cell)).map((cell) => ({ tabIds: [cell] })) : []));

const dock = (w) => {
  const pinned = S().windows[w].tabIds.filter((id) => !!S().tabs[id].pin);
  return { tiles: pinned.filter((id) => !(S().tabs[id].pin?.as === "row")).map(host), rows: pinned.filter((id) => (S().tabs[id].pin?.as === "row")).map(host) };
};

function dragInDock(w, id, to) {
  const slots = dockSlots(w);
  const from = slots.findIndex((slot) => slot.tabIds[0] === id);
  return S().dropTabs([id], drops.slotDrop(S(), [id], slots, from, to, { pinned: true, groupId: null }));
}

test("top strip dock: a row dragged before the first row lands there, past the tiles", () => {
  const { w, ids: [, , c, , e] } = dockWith();
  assert.deepEqual(dock(w), { tiles: ["t1", "t2"], rows: ["c", "d", "e"] });
  assert.equal(dockSlots(w)[2].tabIds[0], c);
  dragInDock(w, e, 2);
  assert.deepEqual(dock(w), { tiles: ["t1", "t2"], rows: ["e", "c", "d"] });
});

test("top strip dock: a row dragged to the end goes last, a tile dragged past a tile swaps with it", () => {
  const { w, ids: [t1, , c] } = dockWith();
  dragInDock(w, c, 4);
  assert.deepEqual(dock(w), { tiles: ["t1", "t2"], rows: ["d", "e", "c"] });
  dragInDock(w, t1, 1);
  assert.deepEqual(dock(w), { tiles: ["t2", "t1"], rows: ["d", "e", "c"] });
  assert.equal(host(S().windows[w].tabIds.at(-1)), "u", "the unpinned tab stays after the dock");
});

test("top strip dock: a row dragged over the tiles stays a row, first among the rows", () => {
  const { w, ids: [, , , , e] } = dockWith();
  dragInDock(w, e, 0);
  assert.deepEqual(dock(w), { tiles: ["t1", "t2"], rows: ["e", "c", "d"] });
  assert.equal((S().tabs[e].pin?.as === "row"), true);
});

test("a drop on its own slot moves nothing", () => {
  const { w, ids: [, , c] } = dockWith();
  assert.deepEqual(drops.slotDrop(S(), [c], dockSlots(w), 2, 2, { pinned: true, groupId: null }), drops.NO_DROP);
  assert.equal(dragInDock(w, c, 2), false);
});

test("the tabs that move together: the selection when the dragged tab is in it, else that tab alone", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  S().pinTabs([a], true);
  S().setSelection(w, [d, a]);
  assert.deepEqual(drops.movingTabIds(S(), d), [a, d], "window order, pinned and unpinned alike");
  assert.deepEqual(drops.movingTabIds(S(), b), [b]);
  S().setSelection(w, [c]);
  assert.deepEqual(drops.movingTabIds(S(), c), [c]);
});

test("one drop vocabulary: each zone gives the same drop to the sidebar and the strip, and refuses what can't land", () => {
  reset();
  const { ids: [a, b] } = windowWith("a", "b");
  const g = S().groupTabs([a], { name: "G" });
  const tab = { kind: "tab" };
  assert.deepEqual(drops.resolveDrop(S(), tab, { zone: "pinnedRows", beforeId: null }), { type: "tabs", placement: { pinned: true, row: true, beforeId: null, last: true } });
  assert.deepEqual(drops.resolveDrop(S(), tab, { zone: "tiles", beforeId: b }), { type: "tabs", placement: { pinned: true, row: false, beforeId: b, tileFolder: null } });
  assert.deepEqual(drops.resolveDrop(S(), { kind: "tab", folderId: "f" }, { zone: "tiles", beforeId: null }), { type: "tabs", placement: { pinned: true, row: false, beforeId: null } });
  assert.deepEqual(drops.resolveDrop(S(), tab, { zone: "group", groupId: g, beforeId: null }), { type: "tabs", placement: { pinned: false, groupId: g, beforeId: null } });
  assert.deepEqual(drops.resolveDrop(S(), { kind: "group", groupId: g }, { zone: "list", beforeId: b }), { type: "group", groupId: g, placement: { pinned: false, parentId: null, beforeId: b } });
  assert.deepEqual(drops.resolveDrop(S(), { kind: "live" }, { zone: "pinnedRows", beforeId: null }), { type: "live" });
  assert.equal(drops.resolveDrop(S(), { kind: "split" }, { zone: "tiles", beforeId: null }).type, "none", "a split never becomes a tile");
  assert.equal(drops.resolveDrop(S(), { kind: "split" }, { zone: "onto", targetId: b }).type, "none");
  assert.equal(drops.resolveDrop(S(), { kind: "tab", external: true }, { zone: "folder", ontoId: b }).type, "none");
  assert.equal(drops.resolveDrop(S(), { kind: "live" }, { zone: "list", beforeId: null }).type, "none");
  assert.equal(drops.resolveDrop(S(), { kind: "group", groupId: g }, { zone: "group", groupId: g, beforeId: null }).type, "none", "a group can't nest in itself");
  assert.equal(drops.resolveDrop(S(), tab, null).type, "none");
});

test("dropping a tab onto another groups them, and an unchanged drop reports nothing moved", () => {
  reset();
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  assert.equal(S().dropTabs([c], drops.resolveDrop(S(), { kind: "tab" }, { zone: "onto", targetId: a })), true);
  const group = Object.values(S().groups)[0];
  assert.deepEqual(group.tabIds, [a, c]);
  assert.deepEqual(S().windows[w].tabIds, [a, c, b]);
  assert.equal(S().dropTabs([c], drops.NO_DROP), false);
});

test("clicks: ⌘ adds to the selection from the shown tab, ⇧ selects the range from the last clicked tab, a plain click clears it", () => {
  reset();
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  S().clickTab(w, b);
  assert.equal(S().windows[w].activeTabIds[S().windows[w].profileId], b);
  S().clickTab(w, d, { metaKey: true });
  assert.deepEqual(S().selection[w], [b, d]);
  S().clickTab(w, a, { shiftKey: true });
  assert.deepEqual(S().selection[w], [a, b, c, d], "the range runs from d, the last ⌘-clicked tab");
  S().clickTab(w, b, { metaKey: true });
  assert.deepEqual(S().selection[w], [a, c, d]);
  S().clickTab(w, c);
  assert.deepEqual(S().selection[w], []);
  assert.equal(S().windows[w].activeTabIds[S().windows[w].profileId], c);
  S().clickTab(w, c, { metaKey: true });
  assert.deepEqual(S().selection[w], [], "⌘-clicking the shown tab alone selects nothing");
});

const shape = (w) => S().windows[w].tabIds.map((id) => {
  const g = Object.values(S().groups).find((x) => x.tabIds.includes(id));
  return g ? `${host(id)}{${g.name}}` : host(id);
});

test("⌃⇧⇞/⇟: a tab steps over a whole group, a member steps inside its group and leaves it at the edge, a split moves as one", () => {
  reset();
  const { w, ids: [a, b, c, d, e, f] } = windowWith("a", "b", "c", "d", "e", "f");
  S().createGroup([b, c], { name: "G" });
  S().createSplit([e, f]);
  assert.deepEqual(shape(w), ["a", "b{G}", "c{G}", "d", "e", "f"]);
  S().moveTabBy(d, -1);
  assert.deepEqual(shape(w), ["a", "d", "b{G}", "c{G}", "e", "f"]);
  S().moveTabBy(d, 1);
  assert.deepEqual(shape(w), ["a", "b{G}", "c{G}", "d", "e", "f"]);
  S().moveTabBy(c, -1);
  assert.deepEqual(shape(w), ["a", "c{G}", "b{G}", "d", "e", "f"]);
  S().moveTabBy(c, -1);
  assert.deepEqual(shape(w), ["a", "c", "b{G}", "d", "e", "f"]);
  S().moveTabBy(b, 1);
  assert.deepEqual(shape(w), ["a", "c", "b", "d", "e", "f"]);
  S().moveTabBy(d, 1);
  assert.deepEqual(shape(w), ["a", "c", "b", "e", "f", "d"]);
  S().moveTabBy(f, -1);
  assert.deepEqual(shape(w), ["a", "c", "e", "f", "b", "d"]);
  S().moveTabBy(a, -1);
  assert.deepEqual(shape(w), ["a", "c", "e", "f", "b", "d"]);
});

test("⌃⇧⇞/⇟: a tab stays in its pin section, and a list tab never steps into a pinned group", () => {
  reset();
  const { w, ids: [t, r, p, l1, l2] } = windowWith("t", "r", "p", "l1", "l2");
  S().pinTabs([t], true);
  S().pinTabs([r], true, true);
  S().groupTabs([p], { pinned: true, name: "P" });
  const before = shape(w);
  S().moveTabBy(l1, -1);
  S().moveTabBy(p, 1);
  S().moveTabBy(r, 1);
  S().moveTabBy(r, -1);
  S().moveTabBy(t, 1);
  assert.deepEqual(shape(w), before);
  S().moveTabBy(l2, -1);
  assert.equal(shape(w).indexOf("l2"), shape(w).indexOf("l1") - 1);
});

test("⌃⇧⇞/⇟: a pinned row steps over a pinned group beside it, one block at a time", () => {
  reset();
  const { w, ids: [r1, g, r2] } = windowWith("r1", "g", "r2", "l");
  S().pinTabs([r1], true, true);
  S().groupTabs([g], { pinned: true, name: "G" });
  S().pinTabs([r2], true, true);
  S().placeTabs([r1], { pinned: true, row: true, beforeId: g });
  S().placeTabs([r2], { pinned: true, row: true, last: true });
  const pinnedArea = () => shape(w).filter((h) => h !== "l");
  assert.deepEqual(pinnedArea(), ["r1", "g{G}", "r2"]);
  S().moveTabBy(r1, 1);
  assert.deepEqual(pinnedArea(), ["g{G}", "r1", "r2"]);
  S().moveTabBy(r1, 1);
  assert.deepEqual(pinnedArea(), ["g{G}", "r2", "r1"]);
  S().moveTabBy(r1, 1);
  assert.deepEqual(pinnedArea(), ["g{G}", "r2", "r1"]);
  S().moveTabBy(r2, -1);
  assert.deepEqual(pinnedArea(), ["r2", "g{G}", "r1"]);
});
