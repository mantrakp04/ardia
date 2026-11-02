import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { bookmarkRoots } = await import("./bookmarks.ts");
const { insertTarget, linkTitle, moveTarget, roomOffsets, sameSpot, zoneHitAt } = await import("./barDrop.ts");
const { beginBookmarkDrag, dropLinksAt, endBookmarkDrag, moveBookmarkDrag, registerDropZone, useBarDrag } = await import("./barDrag.ts");
const { closeFolderMenus, openFolderMenu, useFolderMenus } = await import("./folderMenus.ts");

const S = () => useBrowser.getState();

function seed() {
  useBrowser.setState({ bookmarks: { nodes: {} } });
  S().hydrate({});
  const add = (title, parentId) => S().addBookmark({ profileId: "default", url: `https://${title.toLowerCase()}.example/`, title, parentId });
  const a = add("A");
  const b = add("B");
  const f = S().addBookmarkFolder({ profileId: "default", title: "F" });
  const c = add("C");
  const x = add("X", f);
  const g = S().addBookmarkFolder({ profileId: "default", title: "G", parentId: f });
  const y = add("Y", g);
  const roots = bookmarkRoots(S(), "default");
  return { a, b, c, f, g, x, y, bar: roots.bar, other: roots.other };
}

const titles = (id) => S().bookmarks.nodes[id].children.map((c) => S().bookmarks.nodes[c].title);

const move = (id, spot) => {
  const t = moveTarget(S().bookmarks, id, spot);
  if (t) S().moveBookmark(id, t.parentId, t.index);
  return t;
};

test("a bar item lands in the gap it was dropped in, either way along the bar", () => {
  const n = seed();
  assert.deepEqual(titles(n.bar), ["A", "B", "F", "C"]);
  move(n.a, { parentId: n.bar, slot: 3 });
  assert.deepEqual(titles(n.bar), ["B", "F", "A", "C"]);
  move(n.c, { parentId: n.bar, slot: 0 });
  assert.deepEqual(titles(n.bar), ["C", "B", "F", "A"]);
  move(n.c, { parentId: n.bar, slot: 4 });
  assert.deepEqual(titles(n.bar), ["B", "F", "A", "C"]);
});

test("dropping a bookmark back where it was moves nothing", () => {
  const n = seed();
  assert.equal(moveTarget(S().bookmarks, n.b, { parentId: n.bar, slot: 1 }), null);
  assert.equal(moveTarget(S().bookmarks, n.b, { parentId: n.bar, slot: 2 }), null);
  assert.equal(moveTarget(S().bookmarks, n.x, { into: n.f }), null);
});

test("onto a folder appends; into a folder's menu lands at the row; out of a menu onto the bar and into another folder", () => {
  const n = seed();
  move(n.a, { into: n.f });
  assert.deepEqual(titles(n.f), ["X", "G", "A"]);
  move(n.b, { parentId: n.f, slot: 1 });
  assert.deepEqual(titles(n.f), ["X", "B", "G", "A"]);
  move(n.x, { parentId: n.bar, slot: 0 });
  assert.deepEqual(titles(n.bar), ["X", "F", "C"]);
  move(n.b, { into: n.g });
  assert.deepEqual(titles(n.g), ["Y", "B"]);
  move(n.y, { parentId: n.f, slot: 0 });
  assert.deepEqual(titles(n.f), ["Y", "G", "A"]);
  move(n.a, { parentId: n.f, slot: 0 });
  assert.deepEqual(titles(n.f), ["A", "Y", "G"]);
});

test("a folder never goes into itself or a folder inside it", () => {
  const n = seed();
  assert.equal(moveTarget(S().bookmarks, n.f, { into: n.f }), null);
  assert.equal(moveTarget(S().bookmarks, n.f, { into: n.g }), null);
  assert.equal(moveTarget(S().bookmarks, n.f, { parentId: n.g, slot: 0 }), null);
  assert.deepEqual(moveTarget(S().bookmarks, n.g, { parentId: n.bar, slot: 0 }), { parentId: n.bar, index: 0 });
});

test("the spot under the pointer: gaps by midpoint, the middle half of a folder drops into it, the dragged item counts as gone", () => {
  const items = [
    { id: "a", start: 0, size: 40, folder: false },
    { id: "f", start: 40, size: 60, folder: true },
    { id: "b", start: 100, size: 40, folder: false },
  ];
  assert.deepEqual(zoneHitAt(items, 10, null), { slot: 0 });
  assert.deepEqual(zoneHitAt(items, 30, null), { slot: 1 });
  assert.deepEqual(zoneHitAt(items, 50, null), { slot: 1 });
  assert.deepEqual(zoneHitAt(items, 70, null), { into: "f" });
  assert.deepEqual(zoneHitAt(items, 90, null), { slot: 2 });
  assert.deepEqual(zoneHitAt(items, 130, null), { slot: 3 });
  assert.deepEqual(zoneHitAt(items, 30, "a"), { into: "f" });
  assert.deepEqual(zoneHitAt(items, 75, "a"), { slot: 2 });
  assert.deepEqual(zoneHitAt(items, 75, "f"), { slot: 3 });
});

test("items make room for the gap: those after the dragged one close up, those from the slot on move over", () => {
  assert.deepEqual(roomOffsets(["a", "b", "c", "d"], null, 2, 30), [0, 0, 30, 30]);
  assert.deepEqual(roomOffsets(["a", "b", "c", "d"], "b", 3, 30), [0, 0, -30, 0]);
  assert.deepEqual(roomOffsets(["a", "b", "c", "d"], "c", 1, 30), [0, 30, 0, 0]);
  assert.deepEqual(roomOffsets(["a", "b", "c", "d"], "b", 1, 30), [0, 0, 0, 0]);
  assert.deepEqual(roomOffsets(["a", "b", "c", "d"], "b", null, 30), [0, 0, -30, -30]);
});

test("dropped links and tabs go in at the spot, titled by their text or their host", () => {
  const n = seed();
  const at = insertTarget(S().bookmarks, { parentId: n.bar, slot: 1 });
  assert.deepEqual(at, { parentId: n.bar, index: 1 });
  assert.deepEqual(insertTarget(S().bookmarks, { into: n.f }), { parentId: n.f, index: 2 });
  assert.equal(linkTitle("https://www.news.example/a", null), "news.example");
  assert.equal(linkTitle("https://news.example/a", "  Today's news "), "Today's news");
  assert.ok(sameSpot({ parentId: "p", slot: 1, zone: "z" }, { parentId: "p", slot: 1, zone: "z" }));
  assert.ok(!sameSpot({ parentId: "p", slot: 1, zone: "z" }, { parentId: "p", slot: 1, zone: "y" }));
});

test("a drag session: the zone under the pointer decides, a menu zone wins over the bar, the drop goes through the store", () => {
  const n = seed();
  const bar = registerDropZone("bar", {
    windowId: "w",
    depth: 0,
    resolve: (x, y) => (y < 30 ? { spot: x < 50 ? { parentId: n.bar, slot: 0, zone: "bar" } : { into: n.f } } : undefined),
  });
  const menu = registerDropZone("menu", {
    windowId: "w",
    depth: 1,
    resolve: (x, y) => (y >= 20 && y < 100 ? { spot: { parentId: n.f, slot: Math.floor((y - 20) / 28), zone: "menu" } } : undefined),
  });
  openFolderMenu("w", { parentId: n.f, fromIndex: 0, anchor: { x: 0, y: 0, width: 10, height: 10 }, level: 0 });
  beginBookmarkDrag({ windowId: "w", id: n.x, panel: n.f, x: 10, y: 30, grab: { x: 0, y: 0, width: 10, height: 10 }, sidebarEdge: 0 });
  assert.deepEqual(useBarDrag.getState().spot, { parentId: n.f, slot: 0, zone: "menu" });
  moveBookmarkDrag(10, 10);
  assert.deepEqual(useBarDrag.getState().spot, { parentId: n.bar, slot: 0, zone: "bar" });
  moveBookmarkDrag(10, 25);
  assert.deepEqual(useBarDrag.getState().spot, { parentId: n.f, slot: 0, zone: "menu" });
  moveBookmarkDrag(10, 10);
  endBookmarkDrag(true);
  assert.deepEqual(titles(n.bar), ["X", "A", "B", "F", "C"]);
  assert.equal(useBarDrag.getState().source, null);
  assert.equal(useFolderMenus.getState().panels.length, 0, "a drag out of a menu closes it");

  beginBookmarkDrag({ windowId: "w", id: n.f, panel: null, x: 60, y: 10, grab: { x: 0, y: 0, width: 10, height: 10 }, sidebarEdge: 0 });
  moveBookmarkDrag(60, 10);
  assert.equal(useBarDrag.getState().spot, null, "a folder can't be dropped on itself");
  endBookmarkDrag(true);
  assert.deepEqual(titles(n.bar), ["X", "A", "B", "F", "C"]);

  assert.ok(dropLinksAt("w", 60, 10, [{ url: "https://new.example/", text: "New" }, { url: "javascript:alert(1)" }]));
  assert.deepEqual(titles(n.f), ["G", "New"]);
  assert.ok(!dropLinksAt("w", 60, 500, [{ url: "https://lost.example/" }]));
  bar();
  menu();
  closeFolderMenus();
});

test("a drop reaches Chrome's bookmarks as a move, so sync and the bookmark manager see the same tree", async () => {
  const stub = await import("../../test-native/index.ts");
  const { reloadBookmarks, startBookmarks } = await import("./engineSync.ts");
  const settle = () => new Promise((r) => setTimeout(r, 0));
  useBrowser.setState({ bookmarks: { nodes: {} } });
  S().hydrate({});
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  const stop = startBookmarks();
  await settle();
  await reloadBookmarks();
  const add = (title, parentId) => S().addBookmark({ profileId: "default", url: `https://${title.toLowerCase()}.example/`, title, parentId });
  const a = add("A");
  const f = S().addBookmarkFolder({ profileId: "default", title: "F" });
  const x = add("X", f);
  await settle();
  const bar = bookmarkRoots(S(), "default").bar;
  const zone = registerDropZone("sync", { windowId: "w", depth: 0, resolve: (px) => ({ spot: px < 10 ? { parentId: bar, slot: 0 } : { into: f } }) });
  beginBookmarkDrag({ windowId: "w", id: x, panel: f, x: 0, y: 0, grab: { x: 0, y: 0, width: 1, height: 1 }, sidebarEdge: 0 });
  endBookmarkDrag(true);
  beginBookmarkDrag({ windowId: "w", id: a, panel: null, x: 20, y: 0, grab: { x: 0, y: 0, width: 1, height: 1 }, sidebarEdge: 0 });
  endBookmarkDrag(true);
  await settle();
  const db = stub.chromeBookmarks("");
  const walk = (id) => {
    const n = db.get(id);
    return n.k === "u" ? n.t : { [n.t]: n.children.map(walk) };
  };
  assert.deepEqual(walk("bar"), { "Bookmarks Bar": ["X", { F: ["A"] }] });
  zone();
  stop();
});
