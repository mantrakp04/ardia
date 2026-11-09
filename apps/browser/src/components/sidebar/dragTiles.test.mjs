import { after, test } from "node:test";
await import("../../test-native/index.ts");
const D = await import("./fixtures/dragScene.mjs");
const { world, regionsOf } = await import("./fixtures/dragWorld.mjs");
const { recorder, golden } = await import("./fixtures/dragTrace.mjs");
const { useFolderPanel } = await import("../../state/sidebar/tileFolderUi.ts");
const { addToTileFolder, tileFolderOf } = await import("../../state/pins/tileFolders.ts");
const { useBrowser } = await import("../../state/browser/store.ts");
const { S, entryKey, sceneLayout, mount, TILE } = D;

const traces = golden("dragTiles");
after(() => traces.write());

const GRID_TOP = 60;

function tilesScene({ tiles = 5, balanced = false, folder = 0, panel = false, emptyPanel = false } = {}) {
  const names = Array.from({ length: tiles }, (_, i) => `t${i + 1}`);
  const W = world("a", "b", "c", ...names);
  const { id } = W;
  if (tiles) S().pinTabs(names.map((n) => id[n]), true);
  if (balanced) S().updateSettings({ balancedTopApps: true });
  let folderId = null;
  const members = names.slice(0, folder).map((n) => id[n]);
  if (folder > 1) {
    useBrowser.setState(addToTileFolder(S(), members.slice(1), members[0]), true);
    folderId = tileFolderOf(S().tabs[members[0]]).id;
  }
  const cells = folderId ? [{ folderId, members }, ...names.slice(folder).map((n) => id[n])] : names.map((n) => id[n]);
  const L = sceneLayout({ top: GRID_TOP });
  const grid = L.tiles(cells, { balanced }).frame;
  L.skip(20);
  const listTop = L.y;
  L.row(id.a).row(id.b).row(id.c).tail("list");
  const regions = { tiles: tiles ? grid : { ...grid, h: TILE }, ...regionsOf(L, { list: [listTop, L.y] }) };
  if (panel && folderId) {
    useFolderPanel.setState({ open: { windowId: W.w, folderId, anchor: { x: 6, y: GRID_TOP, width: 56, height: TILE } } });
    const P = sceneLayout({ top: 120, x: 26, width: 150 });
    if (!emptyPanel) P.folderMembers(members);
    L.entries.push(...P.entries);
    regions.folder = { x: 20, y: 110, w: 162, h: emptyPanel ? 120 : P.y - 110 + 10 };
  }
  return { ...W, L, grid, folderId, members, regions, viewport: { x: 0, y: listTop - 4, w: 200, h: 600 } };
}

const cellCentre = (m, i, dx = 0) => {
  const cell = m.L.entries.filter((e) => e.spec.section === "tiles" && e.spec.kind === "tile")[i].frame;
  return { x: cell.x + cell.w / 2 + dx, y: cell.y + cell.h / 2 };
};

async function run(t, title, scene, keyOf, path, { commit = true, setup = () => {} } = {}) {
  const m = scene();
  const { c } = mount({ entries: m.L.entries, regions: m.regions, viewport: m.viewport, ...m.mountOptions });
  setup(c, m);
  const r = recorder(c, m.w);
  const key = keyOf(m);
  const f = m.L.entries.find((e) => e.key === key).frame;
  await r.begin(key, f.x + Math.min(20, f.w / 2), f.y + 10);
  for (const p of path) {
    const at = typeof p === "function" ? p(m, c, r) : p;
    if (at) r.move(at.x, at.y);
  }
  await r.end(commit);
  traces.check(t, title, r.steps);
}

const across = (m) => [0, 1, 2, 3, 4].flatMap((i) => [cellCentre(m, i, -20), cellCentre(m, i, 20)]);
const tile = (n) => (m) => entryKey("tab", m.id[n]);

test("a tile reordered along the grid: before and after each cell's middle, back to its own slot", (t) =>
  run(t, "tile reorder", tilesScene, tile("t1"), [(m) => cellCentre(m, 2, 20), (m) => cellCentre(m, 4, -20), (m) => cellCentre(m, 3, 20), (m) => cellCentre(m, 0, -10)]));

test("a tile swept across every cell's edges", async (t) => {
  const m = tilesScene();
  await run(t, "tile sweep", tilesScene, tile("t3"), across(m));
});

test("balanced rows: the same sweep on Arc's grid", async (t) => {
  const m = tilesScene({ balanced: true });
  await run(t, "balanced sweep", () => tilesScene({ balanced: true }), tile("t3"), across(m));
});

test("a list row pinned into a full row of tiles grows the grid by a row and moves the list down", async (t) => {
  const m = tilesScene({ tiles: 6 });
  await run(t, "row into tiles", () => tilesScene({ tiles: 6 }), (s) => entryKey("tab", s.id.c), [{ x: 60, y: 260 }, { x: 60, y: 200 }, ...[0, 2, 5].flatMap((i) => [cellCentre(m, i, -20), cellCentre(m, i, 20)]), { x: 150, y: 130 }, { x: 60, y: 200 }]);
});

test("the grid grows only up to the dock's room while it's fixed", async (t) => {
  const m = tilesScene({ tiles: 3 });
  const scene = () => ({ ...tilesScene({ tiles: 3 }), mountOptions: { tilesRoom: TILE + 10 } });
  await run(t, "room clip", scene, (s) => entryKey("tab", s.id.c), [cellCentre(m, 0, -20), cellCentre(m, 2, 20), { x: 60, y: 300 }]);
});

test("a scrolling grid: tiles move with the list's scroll and a drop previews against where they show", async (t) => {
  const m = tilesScene();
  const scene = () => ({ ...tilesScene(), mountOptions: { tilesFixed: false } });
  await run(t, "scrolling grid", scene, tile("t1"), [
    cellCentre(m, 2, 20),
    (_, c) => void (c.scrollY = 30),
    { x: cellCentre(m, 2, 20).x, y: cellCentre(m, 2, 20).y },
    { x: cellCentre(m, 2, 20).x, y: cellCentre(m, 2, 20).y - 30 },
    { x: 60, y: 300 },
  ]);
});

test("an empty grid: a row taken to the tiles region pins it", (t) =>
  run(t, "empty grid", () => tilesScene({ tiles: 0 }), (s) => entryKey("tab", s.id.c), [{ x: 60, y: 200 }, { x: 60, y: 120 }, { x: 60, y: 80 }, { x: 60, y: 61 }, { x: 60, y: 200 }, { x: 60, y: 70 }]));

test("a folder tile takes one cell: the grid doesn't grow and no row moves", async (t) => {
  const m = tilesScene({ tiles: 6, folder: 3 });
  await run(t, "folder tile reorder", () => tilesScene({ tiles: 6, folder: 3 }), (s) => entryKey("tileFolder", s.folderId), [cellCentre(m, 1, -20), cellCentre(m, 3, 20), cellCentre(m, 2), { x: 60, y: 300 }, cellCentre(m, 3, -20)]);
});

test("held folder: a tile over another's middle for 400 ms makes a folder; moving to another cancels the hold", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const m = tilesScene();
  await run(t, "hold to fold", tilesScene, tile("t1"), [
    cellCentre(m, 2),
    () => void t.mock.timers.tick(399),
    cellCentre(m, 2, 1),
    () => void t.mock.timers.tick(1),
    cellCentre(m, 2, 2),
    cellCentre(m, 2, 56 * 0.4),
    cellCentre(m, 3),
    () => void t.mock.timers.tick(200),
    cellCentre(m, 4),
    () => void t.mock.timers.tick(399),
    cellCentre(m, 4, 1),
    () => void t.mock.timers.tick(1),
    cellCentre(m, 4, 1),
  ]);
});

test("held folder: before the hold is ready, a pointer 40 % off the middle is an edge, not the centre", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const m = tilesScene();
  await run(t, "hold reach", tilesScene, tile("t1"), [
    cellCentre(m, 2, -56 * 0.29),
    cellCentre(m, 2, -56 * 0.31),
    cellCentre(m, 2, -56 * 0.1),
    () => void t.mock.timers.tick(400),
    cellCentre(m, 2, -56 * 0.1),
    cellCentre(m, 2, -56 * 0.4),
    cellCentre(m, 2, -56 * 0.44),
    cellCentre(m, 2, -56 * 0.46),
  ]);
});

test("an existing folder takes a tile or a list row at once; a folder tile never enters another", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const m = tilesScene({ tiles: 6, folder: 2 });
  const scene = () => tilesScene({ tiles: 6, folder: 2 });
  await run(t, "tile onto folder", scene, tile("t4"), [cellCentre(m, 0), cellCentre(m, 0, 2)]);
  await run(t, "row onto folder", scene, (s) => entryKey("tab", s.id.a), [cellCentre(m, 0), cellCentre(m, 0, 2)]);
  await run(t, "folder over tile", scene, (s) => entryKey("tileFolder", s.folderId), [cellCentre(m, 2), () => void t.mock.timers.tick(500), cellCentre(m, 2, 1)]);
});

test("folder panel: members reorder inside it, a member that leaves stays away for the drag, and it leaves the folder", async (t) => {
  const scene = () => tilesScene({ tiles: 5, folder: 3, panel: true });
  const m = scene();
  const member = (i) => m.L.entries.filter((e) => e.spec.section === "folder" && e.spec.kind === "row")[i].frame;
  await run(t, "panel reorder", scene, (s) => `fm:${s.members[0]}`, [D.centre(member(1), 10), D.centre(member(2), 10), D.centre(member(2), 30)]);
  await run(t, "panel leave", scene, (s) => `fm:${s.members[0]}`, [D.centre(member(1), 10), { x: 60, y: 330 }, D.centre(member(1), 10), D.centre(member(2), 30), { x: 60, y: 300 }]);
  await run(t, "panel cancel", scene, (s) => `fm:${s.members[1]}`, [{ x: 60, y: 300 }, D.centre(member(0))], { commit: false });
});

test("folder panel: a list row over an empty panel gets no drop, and nothing behind it takes one", (t) =>
  run(t, "empty panel", () => tilesScene({ tiles: 5, folder: 3, panel: true, emptyPanel: true }), (s) => entryKey("tab", s.id.c), [{ x: 60, y: 300 }, { x: 100, y: 150 }, { x: 100, y: 220 }, { x: 100, y: 290 }]));

test("folder panel: a list row dragged into the panel joins the folder before the member it's above", (t) =>
  run(t, "row into panel", () => tilesScene({ tiles: 5, folder: 3, panel: true }), (s) => entryKey("tab", s.id.c), [{ x: 60, y: 300 }, { x: 100, y: 125 }, { x: 100, y: 175 }, { x: 100, y: 222 }, { x: 100, y: 300 }]));
