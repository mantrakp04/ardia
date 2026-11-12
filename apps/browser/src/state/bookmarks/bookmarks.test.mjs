import assert from "node:assert/strict";
import { test } from "node:test";

const setTimeoutHoldingExit = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => {
  const timer = setTimeoutHoldingExit(callback, ms, ...args);
  return ms >= 1_000 ? timer.unref() : timer;
};
const { useBrowser } = await import("../browser/store.ts");
const { bookmarkRoots, bookmarkUuidFor, isBookmarked, ownerOfBookmark } = await import("./bookmarks.ts");
const { allArcHolders, restoreArcFolders } = await import("./bookmarkGroups.ts");
const { migrateBookmarksFile, reloadBookmarks, startBookmarks } = await import("./engineSync.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const settle = () => new Promise((r) => setTimeout(r, 0));
const cpuMs = (since) => {
  const { user, system } = process.cpuUsage(since);
  return (user + system) / 1000;
};

function chromeTree(profile = "") {
  const db = stub.chromeBookmarks(profile);
  const walk = (id) => {
    const n = db.get(id);
    return n.k === "u" ? `${n.t}=${n.u}` : { [n.t]: n.children.map(walk) };
  };
  return { bar: walk("bar"), other: walk("other") };
}
function storeTree(profileId = "default") {
  const b = S().bookmarks;
  const roots = bookmarkRoots(S(), profileId);
  const walk = (id) => {
    const n = b.nodes[id];
    return n.kind === "url" ? `${n.title}=${n.url}` : { [n.title]: n.children.map(walk) };
  };
  return { bar: walk(roots.bar), other: walk(roots.other) };
}

function legacyFile() {
  const bar = "bm-bar1", other = "bm-other1";
  const node = (id, parentId, extra) => ({ id, parentId, addedAt: 5, ...extra });
  return {
    version: 2,
    bookmarks: {
      roots: { default: { bar, other }, gone: { bar: "bm-x", other: "bm-y" } },
      nodes: {
        [bar]: node(bar, null, { kind: "folder", title: "Bookmarks Bar", children: ["bm-a", "bm-f"] }),
        [other]: node(other, null, { kind: "folder", title: "Other Bookmarks", children: ["bm-c"] }),
        "bm-a": node("bm-a", bar, { kind: "url", title: "A", url: "https://a.example/", favicon: null }),
        "bm-f": node("bm-f", bar, { kind: "folder", title: "F", children: ["bm-b"] }),
        "bm-b": node("bm-b", "bm-f", { kind: "url", title: "B", url: "https://b.example/", favicon: null }),
        "bm-c": node("bm-c", other, { kind: "url", title: "C", url: "https://c.example/", favicon: null }),
      },
    },
  };
}

test("bookmarks.json moves into Chrome once, each bookmark under the UUID sync renames it to", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  stub.docs.set("bookmarks.json", JSON.stringify(legacyFile()));
  assert.equal(await migrateBookmarksFile({ keepMs: 0 }), "moved");
  const expected = { bar: { "Bookmarks Bar": ["A=https://a.example/", { F: ["B=https://b.example/"] }] }, other: { "Other Bookmarks": ["C=https://c.example/"] } };
  assert.deepEqual(chromeTree(), expected);
  assert.ok(stub.chromeBookmarks("").has(bookmarkUuidFor("bm-b")), "the UUID its old id maps to");
  assert.equal(stub.chromeBookmarks("").get(bookmarkUuidFor("bm-b")).key, "bm-b", "the old id stays its sync key");
  assert.equal(stub.docs.has("bookmarks.json"), false);

  stub.chromeBookmarkEdit("", [{ op: "move", id: bookmarkUuidFor("bm-c"), parent: "bar", index: 0 }]);
  stub.docs.set("bookmarks.json", JSON.stringify(legacyFile()));
  assert.equal(await migrateBookmarksFile({ keepMs: 0 }), "moved");
  assert.deepEqual(chromeTree(), { bar: { "Bookmarks Bar": ["C=https://c.example/", ...expected.bar["Bookmarks Bar"]] }, other: { "Other Bookmarks": [] } });
  assert.equal(await migrateBookmarksFile({ keepMs: 0 }), "none");
});

test("the store's tree and Chrome's stay alike: the app's edits go as ops, an extension's come back", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  const stop = startBookmarks();
  await settle();
  await reloadBookmarks();
  assert.ok(S().bookmarksReady[""]);
  const same = () => assert.deepEqual(chromeTree(), storeTree());

  const a = S().addBookmark({ profileId: "default", url: "https://a.example/", title: "A" });
  const f = S().addBookmarkFolder({ profileId: "default", title: "F" });
  const g = S().addBookmarkFolder({ profileId: "default", title: "G", parentId: f });
  const b = S().addBookmark({ profileId: "default", url: "https://b.example/", title: "B", parentId: g });
  await settle();
  same();
  S().moveBookmark(a, f, 0);
  S().moveBookmark(g, bookmarkRoots(S(), "default").other);
  S().updateBookmark(b, { title: "B, renamed", url: "https://b2.example/" });
  await settle();
  same();
  S().moveBookmark(a, bookmarkRoots(S(), "default").bar, 0);
  S().removeBookmark(f);
  await settle();
  same();
  const removed = S().removeBookmarks([g]);
  await settle();
  S().restoreBookmarks(removed);
  await settle();
  same();
  assert.ok(stub.chromeBookmarks("").has(b), "ids are Chrome's UUIDs");

  const sent = stub.bookmarkOpsSent.length;
  stub.chromeBookmarkEdit("", [{ op: "add", id: "0f0f0f0f-0000-4000-8000-000000000001", k: "u", t: "Ext", u: "https://ext.example/", a: 1, parent: "bar", index: 1 }]);
  await settle();
  await reloadBookmarks();
  same();
  assert.equal(S().bookmarks.nodes["0f0f0f0f-0000-4000-8000-000000000001"]?.title, "Ext");
  assert.equal(stub.bookmarkOpsSent.length, sent, "the app sends nothing back for it");
  stop();
});

test("select all and delete clears a 2,400-bookmark import from the store and Chrome in one go, and undo puts every one back in place", async () => {
  S().hydrate({});
  useBrowser.setState({ bookmarks: { nodes: {} } });
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  const stop = startBookmarks();
  await settle();
  await reloadBookmarks();
  const roots = bookmarkRoots(S(), "default");
  const kept = S().addBookmark({ profileId: "default", url: "https://kept.example/", title: "Kept" });
  const links = Array.from({ length: 2100 }, (_, i) => ({ title: `Page ${i}`, url: `https://example.test/${i}` }));
  const folders = Array.from({ length: 3 }, (_, f) => ({ title: `Folder ${f}`, children: Array.from({ length: 100 }, (_, i) => ({ title: `F${f} ${i}`, url: `https://example.test/f${f}/${i}` })) }));
  S().addBookmarkTree("default", [...folders.slice(0, 2), ...links, folders[2]], roots.bar);
  await settle();
  const before = storeTree();
  assert.deepEqual(chromeTree(), before);
  const all = [...S().bookmarks.nodes[roots.bar].children];
  assert.equal(all.length, 2104);

  const doomed = all.filter((id) => id !== kept);
  const started = process.cpuUsage();
  const removed = S().removeBookmarks(doomed);
  const removeMs = cpuMs(started);
  assert.equal(removed.places.length, 2103);
  assert.equal(removed.nodes.length, 2403, "the folders' links go with them");
  assert.deepEqual(S().bookmarks.nodes[roots.bar].children, [kept]);
  await settle();
  assert.deepEqual(chromeTree().bar, { "Bookmarks Bar": ["Kept=https://kept.example/"] });

  const restoring = process.cpuUsage();
  S().restoreBookmarks(removed);
  const restoreMs = cpuMs(restoring);
  await settle();
  assert.deepEqual(storeTree(), before);
  assert.deepEqual(chromeTree(), before);
  assert.ok(removeMs < 250 && restoreMs < 250, `remove ${removeMs.toFixed(0)} ms of CPU, restore ${restoreMs.toFixed(0)} ms of CPU`);
  stop();
});

test("undo puts deleted rows back between the rows that stayed, in every folder they came from", () => {
  S().hydrate({});
  useBrowser.setState({ bookmarks: { nodes: {} } });
  const roots = (S().addBookmarkTree("default", []), bookmarkRoots(S(), "default"));
  const [a, b, c, d, e] = S().addBookmarkTree("default", ["A", "B", "C", "D", "E"].map((t) => ({ title: t, url: `https://${t}.example/` })), roots.bar);
  const [x, y, z] = S().addBookmarkTree("default", ["X", "Y", "Z"].map((t) => ({ title: t, url: `https://${t}.example/` })), roots.other);
  const removed = S().removeBookmarks([e, a, c, y, z]);
  assert.deepEqual(S().bookmarks.nodes[roots.bar].children, [b, d]);
  assert.deepEqual(S().bookmarks.nodes[roots.other].children, [x]);
  S().restoreBookmarks(removed);
  assert.deepEqual(S().bookmarks.nodes[roots.bar].children, [a, b, c, d, e]);
  assert.deepEqual(S().bookmarks.nodes[roots.other].children, [x, y, z]);
});

test("an edit made at launch, before Chrome's tree is read, reaches Chrome and stays", async () => {
  useBrowser.setState({ bookmarks: { nodes: {} } });
  S().hydrate({});
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  stub.chromeBookmarkEdit("", [{ op: "add", id: "0f0f0f0f-0000-4000-8000-0000000000a1", k: "u", t: "In Chrome", u: "https://chrome.example/", a: 1, parent: "bar" }]);
  S().addBookmark({ profileId: "default", url: "https://early.example/", title: "Early" });
  const stop = startBookmarks();
  await reloadBookmarks();
  assert.deepEqual(chromeTree().bar, { "Bookmarks Bar": ["Early=https://early.example/", "In Chrome=https://chrome.example/"] });
  assert.deepEqual(storeTree(), chromeTree());
  stop();
});

test("ops Chrome can't apply (an extension moved things meanwhile) stop there: nothing the store kept is removed", async () => {
  useBrowser.setState({ bookmarks: { nodes: {} } });
  S().hydrate({});
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  const stop = startBookmarks();
  await reloadBookmarks();
  const b = S().addBookmarkFolder({ profileId: "default", title: "B" });
  const f = S().addBookmarkFolder({ profileId: "default", title: "F" });
  const a = S().addBookmarkFolder({ profileId: "default", title: "A", parentId: f });
  await reloadBookmarks();
  const db = stub.chromeBookmarks("");
  db.get("bar").children = db.get("bar").children.filter((c) => c !== b);
  db.get(a).children.push(b);
  db.get(b).parent = a;
  S().moveBookmark(a, b, 0);
  S().removeBookmark(f);
  await reloadBookmarks();
  assert.ok(db.has(a) && db.has(b), "A and B are still in Chrome");
  assert.deepEqual(storeTree(), chromeTree(), "the store shows Chrome's tree");
  stop();
});

test("at launch the bar shows the last tree read from Chrome until Chrome's loads, and nothing of it is written back", async () => {
  useBrowser.setState({ bookmarks: { nodes: {} } });
  S().hydrate({});
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  stub.chromeBookmarkEdit("", [{ op: "add", id: "0f0f0f0f-0000-4000-8000-0000000000c1", k: "u", t: "Now", u: "https://now.example/", a: 1, parent: "bar" }]);
  const node = (id, parentId, x) => ({ id, parentId, addedAt: 1, ...x });
  const gone = "0f0f0f0f-0000-4000-8000-0000000000c2";
  stub.docs.set("bookmarks-cache.json", JSON.stringify({ version: 1, trees: { "": [
    node("bar@default", null, { kind: "folder", title: "Bookmarks Bar", children: [gone] }),
    node("other@default", null, { kind: "folder", title: "Other Bookmarks", children: [] }),
    node(gone, "bar@default", { kind: "url", title: "Deleted since", url: "https://gone.example/", favicon: null }),
  ] } }));
  const stop = startBookmarks();
  assert.deepEqual(storeTree().bar, { "Bookmarks Bar": ["Deleted since=https://gone.example/"] }, "the cache shows at once");
  assert.ok(!S().bookmarksReady[""], "sync waits for Chrome's tree");
  await reloadBookmarks();
  assert.deepEqual(storeTree(), chromeTree(), "then Chrome's tree");
  assert.ok(!stub.chromeBookmarks("").has(gone), "the cache's stale bookmark isn't written back");
  stop();
});

test("a launch with bookmarks.json shows its tree at once, then moves it into Chrome", async () => {
  S().hydrate({});
  stub.docs.clear();
  stub.bookmarkDbs.clear();
  stub.docs.set("bookmarks.json", JSON.stringify(legacyFile()));
  const expected = { bar: { "Bookmarks Bar": ["A=https://a.example/", { F: ["B=https://b.example/"] }] }, other: { "Other Bookmarks": ["C=https://c.example/"] } };
  const stop = startBookmarks();
  assert.deepEqual(storeTree(), expected, "the file's tree shows before anything is read");
  for (let i = 0; i < 50 && JSON.stringify(chromeTree()) !== JSON.stringify(expected); i++) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(chromeTree(), expected);
  await reloadBookmarks();
  assert.deepEqual(storeTree(), expected);
  stop();
});

test("profiles that share data share one tree, owned by whichever comes first in the profile order, Arc holders included", () => {
  S().hydrate({});
  const a = S().createProfile({ name: "A" });
  const b = S().createProfile({ name: "B", shareWith: a });
  assert.deepEqual(bookmarkRoots(S(), b), bookmarkRoots(S(), a), "one tree for both");
  const x = S().addBookmark({ profileId: b, url: "https://x.example/", title: "X" });
  assert.ok(isBookmarked(S(), a, "https://x.example/"), "added through B, bookmarked in A");
  assert.equal(ownerOfBookmark(S(), x), a, "A comes first");
  S().reorderProfiles(["default", b, a]);
  assert.equal(ownerOfBookmark(S(), x), b, "after a reorder, B does");

  const holder = S().addBookmarkFolder({ profileId: a, title: "Home (Arc)" });
  const reading = S().addBookmarkFolder({ profileId: a, title: "Reading", parentId: holder });
  S().addBookmark({ profileId: a, url: "https://r.example/", title: "R", parentId: reading });
  const second = S().addBookmarkFolder({ profileId: a, title: "Work (Arc)" });
  const dev = S().addBookmarkFolder({ profileId: a, title: "Dev", parentId: second });
  S().addBookmark({ profileId: a, url: "https://d.example/", title: "D", parentId: dev });
  assert.deepEqual(allArcHolders(S()), [holder, second]);
  const inA = S().createWindow({ profileId: a });
  assert.deepEqual(restoreArcFolders(holder, null).map((g) => S().groups[g].profileId), [b], "with no window, the first profile in the order");
  assert.deepEqual(restoreArcFolders(second, inA).map((g) => S().groups[g].profileId), [a], "from A's window, A");
});

test("deleting one of two sharing profiles keeps the tree; deleting the last drops it and its ready mark", () => {
  S().hydrate({});
  const a = S().createProfile({ name: "A" });
  const b = S().createProfile({ name: "B", shareWith: a });
  useBrowser.setState({ bookmarksReady: { [a]: true } });
  const x = S().addBookmark({ profileId: b, url: "https://x.example/", title: "X" });
  S().deleteProfile(a);
  assert.ok(S().bookmarks.nodes[x], "B still has it");
  assert.ok(S().bookmarksReady[a], "and the engine stays ready");
  S().deleteProfile(b);
  assert.equal(S().bookmarks.nodes[x], undefined);
  assert.equal(S().bookmarks.nodes[`bar@${a}`], undefined);
  assert.equal(S().bookmarksReady[a], undefined);
});
