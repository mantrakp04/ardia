import { after, test } from "node:test";
await import("../../test-native/index.ts");
const D = await import("./fixtures/dragScene.mjs");
const { world, mixedScene, regionsOf } = await import("./fixtures/dragWorld.mjs");
const { recorder, golden } = await import("./fixtures/dragTrace.mjs");
const { S, entryKey, sceneLayout, mount } = D;
const liveStore = await import("../../state/live/store.ts");

const traces = golden("dragZones");
after(() => traces.write());

const DOWN = [140, 160, 185, 200, 215, 240, 255, 270, 285, 300, 315, 330, 345, 360, 375, 390, 405, 420, 440, 460, 480, 500, 530, 560, 590, 620, 650];
const UP = [...DOWN].reverse();

async function sweep(t, title, scene, keyOf, path, { commit = true, x = 60, at = null, viewport } = {}) {
  const m = scene();
  const { c } = mount({ entries: m.L.entries, regions: m.regions, ...(viewport ? { viewport } : {}) });
  const r = recorder(c, m.w);
  const key = keyOf(m);
  const f = m.L.entries.find((e) => e.key === key).frame;
  await r.begin(key, at?.x ?? f.x + 20, at?.y ?? f.y + 10);
  for (const p of path) (typeof p === "number" ? r.move(x, p) : r.move(p.x, p.y));
  await r.end(commit);
  traces.check(t, title, r.steps);
}

test("list row: down and up through pinned rows, the pinned group, the list, a group and its nested group, then dropped", (t) =>
  sweep(t, "list row sweep", mixedScene, (m) => entryKey("tab", m.id.c), [...UP, ...DOWN.slice(0, 12)]));

test("list row: the same path cancelled leaves the store as it was", (t) =>
  sweep(t, "list row cancelled", mixedScene, (m) => entryKey("tab", m.id.c), [...UP.slice(0, 15)], { commit: false }));

test("group: never into its own subtree; nests through another group's header; pinned and list", (t) =>
  sweep(t, "group sweep", mixedScene, (m) => entryKey("group", m.G), [...DOWN, ...UP]));

test("nested group: dragged out of its parent and back into it", (t) =>
  sweep(t, "nested group sweep", mixedScene, (m) => entryKey("group", m.H), [...DOWN, ...UP.slice(0, 18)]));

test("split row: one row of pitch, into groups, pinned rows and the list, never onto", (t) =>
  sweep(t, "split sweep", mixedScene, (m) => entryKey("split", m.SP), [...UP, ...DOWN.slice(0, 16)]));

test("pinned row: onto other rows, into the pinned group, the end of the pinned area and the list", (t) =>
  sweep(t, "pinned row sweep", mixedScene, (m) => entryKey("tab", m.id.p1), [...DOWN, ...UP]));

test("group member: dragged out of a nested group, into the outer group and the list", (t) =>
  sweep(t, "member sweep", mixedScene, (m) => entryKey("tab", m.id.h1), [...UP, ...DOWN]));

test("collapsed nested group: a row on its header goes into it, its body is not a target", (t) =>
  sweep(t, "collapsed header", () => mixedScene({ collapsedH: true }), (m) => entryKey("tab", m.id.c), [...UP]));

test("collapsed pinned group: a group nests through its header only", (t) =>
  sweep(t, "collapsed pinned header", () => mixedScene({ pinnedGroupCollapsed: true }), (m) => entryKey("group", m.G), [...UP, ...DOWN]));

test("onto: only the middle half of a row, no x test", (t) =>
  sweep(t, "onto bounds", mixedScene, (m) => entryKey("tab", m.id.c), [
    { x: 60, y: 325 }, { x: 5, y: 325 }, { x: 239, y: 325 }, { x: 60, y: 316.6 }, { x: 60, y: 333.4 }, { x: 60, y: 333.5 }, { x: 60, y: 325 }, { x: 60, y: 316.5 },
  ]));

test("away: 40 pt past either side of the sidebar, strictly; back in resumes", async (t) => {
  await sweep(t, "away bounds", mixedScene, (m) => entryKey("tab", m.id.c), [
    { x: 240, y: 330 }, { x: 240.5, y: 330 }, { x: 60, y: 330 }, { x: 241, y: 220 }, { x: 60, y: 220 },
  ]);
  await sweep(t, "away left bound", mixedScene, (m) => entryKey("tab", m.id.c), [{ x: 60, y: 330 }, { x: 10, y: 330 }, { x: 9.5, y: 330 }, { x: 60, y: 330 }], { viewport: { x: 50, y: 100, w: 200, h: 700 } });
});

test("away: a drag outside the window", (t) =>
  sweep(t, "away outside window", mixedScene, (m) => entryKey("tab", m.id.c), [{ x: 60, y: 330 }, { x: 60, y: -3000 }, { x: 60, y: 330 }]));

test("pinned rows: tabs keep 6 pt of hysteresis over the list's top edge; groups use the edge itself", async (t) => {
  const edge = (m) => m.regions.list.y;
  const around = (m) => [edge(m) + 8, edge(m) + 5, edge(m) + 1, edge(m) - 1, edge(m) - 5, edge(m) - 7, edge(m) - 5, edge(m) + 1, edge(m) + 5, edge(m) + 7];
  const m = mixedScene();
  await sweep(t, "row hysteresis", mixedScene, (s) => entryKey("tab", s.id.c), around(m));
  await sweep(t, "group edge", mixedScene, (s) => entryKey("group", s.G), around(m));
});

function liveScene({ open = false } = {}) {
  const W = world("a", "b", "p1", "p2");
  const { id } = W;
  S().pinTabs([id.p1, id.p2], true, true);
  const L1 = liveStore.createFolder(S().windows[W.w].profileId, "pullRequests");
  const L2 = liveStore.createFolder(S().windows[W.w].profileId, "documents");
  const L = sceneLayout({ top: 150 });
  L.row(id.p1, { section: "pinnedRows" });
  L.live(L1, { collapsed: !open, rows: 2 });
  L.row(id.p2, { section: "pinnedRows" });
  L.live(L2);
  L.tail("pinnedGroups");
  L.skip(10);
  const listTop = L.y;
  L.row(id.a).row(id.b).tail("list");
  return { ...W, L1, L2, L, regions: regionsOf(L, { pinnedGroups: [150, listTop], list: [listTop, L.y] }) };
}

test("live folder: moves only among the pinned blocks, by the list's edge, with no list fallback", (t) =>
  sweep(t, "live sweep", liveScene, (m) => entryKey("live", m.L1), [...DOWN, ...UP]));

test("pinned rows: a tabless live folder can be the gap while the anchor comes from the next block", (t) =>
  sweep(t, "row past live", liveScene, (m) => entryKey("tab", m.id.a), [...UP]));

test("ties: the same transformed y goes by x, then by registration order; a midpoint lands after", async (t) => {
  const scene = () => {
    const W = world("a", "b", "c", "d");
    const { id } = W;
    const L = sceneLayout({ top: 200 });
    L.row(id.a).row(id.b);
    const y = L.y;
    L.row(id.c);
    L.entries.at(-1).frame = { x: 100, y, w: 86, h: D.ROW };
    L.skip(-D.PITCH).row(id.d);
    L.entries.at(-1).frame = { x: 6, y, w: 86, h: D.ROW };
    L.tail("list");
    return { ...W, L, regions: regionsOf(L, { list: [200, L.y] }) };
  };
  await sweep(t, "tie order", scene, (m) => entryKey("tab", m.id.a), [{ x: 60, y: 274 + D.ROW / 2 }, { x: 60, y: 274 + D.ROW / 2 + 0.01 }, { x: 60, y: 300 }, { x: 60, y: 320 }]);
});

test("groups of the same shown height keep registration order, and the smaller of two nested groups wins", async (t) => {
  const scene = () => {
    const W = world("a", "x", "y", "z");
    const { id } = W;
    const OUTER = S().groupTabs([id.x, id.y], { pinned: false, name: "Outer" });
    const INNER = S().groupTabs([id.x, id.y], { name: "Inner" });
    const L = sceneLayout({ top: 200 });
    L.row(id.a);
    L.group(OUTER, {}, (m) => L.group(INNER, { parent: OUTER, depth: 1 }, (n) => L.row(id.x, n).row(id.y, n)));
    const outer = L.entries.find((e) => e.key === entryKey("group", OUTER));
    const inner = L.entries.find((e) => e.key === entryKey("group", INNER));
    L.row(id.z).tail("list");
    return { ...W, OUTER, INNER, L, outer, inner, regions: regionsOf(L, { list: [200, L.y] }) };
  };
  await sweep(t, "nested smallest", scene, (m) => entryKey("tab", m.id.z), [...UP]);
  const equal = () => {
    const m = scene();
    m.inner.frame = { ...m.outer.frame };
    return m;
  };
  await sweep(t, "equal heights", equal, (m) => entryKey("tab", m.id.z), [...UP]);
});

test("onto: overlapping rows go to the first registered", async (t) => {
  const scene = () => {
    const W = world("a", "b", "c");
    const { id } = W;
    const L = sceneLayout({ top: 200 });
    L.row(id.a).row(id.b);
    L.entries.at(-1).frame = { ...L.entries.at(-2).frame, y: L.entries.at(-2).frame.y + 4 };
    L.row(id.c).tail("list");
    return { ...W, L, regions: regionsOf(L, { list: [200, L.y] }) };
  };
  await sweep(t, "onto overlap", scene, (m) => entryKey("tab", m.id.c), [{ x: 60, y: 218 }, { x: 60, y: 222 }, { x: 60, y: 226 }]);
});

test("a selection drags as one: every selected row is a source, the pitch is the selection's", async (t) => {
  const scene = () => {
    const m = mixedScene();
    S().setSelection(m.w, [m.id.a, m.id.b, m.id.c]);
    return m;
  };
  await sweep(t, "selection sweep", scene, (m) => entryKey("tab", m.id.c), [...UP]);
});

test("a move that would empty an ancestor of the dragged group is refused, and nothing else takes the drop", async (t) => {
  const scene = () => {
    const W = world("a", "x");
    const { id } = W;
    const OUTER = S().groupTabs([id.x], { pinned: false, name: "Outer" });
    const INNER = S().groupTabs([id.x], { name: "Inner" });
    const L = sceneLayout({ top: 200 });
    L.row(id.a);
    L.group(OUTER, {}, (m) => L.group(INNER, { parent: OUTER, depth: 1 }, (n) => L.row(id.x, n)));
    L.tail("list");
    return { ...W, OUTER, INNER, L, regions: regionsOf(L, { list: [200, L.y] }) };
  };
  await sweep(t, "emptied ancestor", scene, (m) => entryKey("group", m.INNER), [...UP, ...DOWN]);
});
