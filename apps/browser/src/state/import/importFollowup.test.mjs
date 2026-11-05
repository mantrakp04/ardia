import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { bookmarkRoots } = await import("../bookmarks/bookmarks.ts");
const { restoreArcFolders, addFolderToSidebar } = await import("../bookmarks/bookmarkGroups.ts");
const { importArcSpace, importTabs } = await import("./apply.ts");
const { withDraftGroups, MAX_DRAFT_LINKS } = await import("../groups/draftGroups.ts");

const S = () => useBrowser.getState();
const P = "default";
const pinnedGroups = () => Object.values(S().groups).filter((g) => g.pinned);

function start() {
  useBrowser.setState({ bookmarks: { nodes: {} } });
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  S().addBookmark({ profileId: P, url: "https://seed.example/", title: "seed" });
  return { w, bar: bookmarkRoots(S(), P).bar };
}

function nestedFolder(parentId, outer, inner, url) {
  const f = S().addBookmarkFolder({ profileId: P, title: outer, parentId });
  const sub = S().addBookmarkFolder({ profileId: P, title: inner, parentId: f });
  S().addBookmark({ profileId: P, url, title: "A", parentId: sub });
  return f;
}

test("restoring an Arc folder that adds no group keeps the folder and its bookmarks", () => {
  const { w, bar } = start();
  addFolderToSidebar(nestedFolder(bar, "Work", "Alpha", "https://a.example/"), w);
  const holder = S().addBookmarkFolder({ profileId: P, title: "Home (Arc)", parentId: bar });
  const work = nestedFolder(holder, "Work", "Beta", "https://a.example/");
  assert.deepEqual(restoreArcFolders(holder, w), []);
  const kept = S().bookmarks.nodes[work];
  assert.ok(kept, "Work is kept");
  const beta = S().bookmarks.nodes[kept.children[0]];
  assert.equal(beta?.title, "Beta", "and Beta inside it");
  assert.equal(S().bookmarks.nodes[beta.children[0]]?.url, "https://a.example/");
});

test("re-importing an Arc space after renaming its group adds no page that's already pinned", () => {
  start();
  const space = { id: "s", name: "Home", profileId: P, tabs: [], pinned: [{ type: "folder", title: "Work", children: [{ type: "url", title: "A", url: "https://a.example/" }, { type: "url", title: "B", url: "https://b.example/" }] }] };
  assert.equal(importArcSpace(P, space).tabs, 2);
  const g = pinnedGroups().find((x) => x.name === "Work");
  S().updateGroup(g.id, { name: "Renamed" });
  assert.equal(importArcSpace(P, space).tabs, 0);
  assert.equal(pinnedGroups().filter((x) => !x.parentId).length, 1, "no second Work");
});

test("a folder past the link limit imports up to it and reports the rest", () => {
  const { w } = start();
  const n = MAX_DRAFT_LINKS + 25;
  const draft = { title: "Huge", children: [{ title: "Deep", children: Array.from({ length: n }, (_, i) => ({ title: `L${i}`, url: `https://l${i}.example/` })) }] };
  const [next, { made, skipped }] = withDraftGroups(S(), w, P, [draft]);
  assert.equal(made.length, 1);
  assert.equal(next.groups[made[0]].tabIds.length, MAX_DRAFT_LINKS);
  assert.equal(skipped, 25);
});

test("the link limit counts each folder on its own", () => {
  const { w } = start();
  const links = (prefix, n) => Array.from({ length: n }, (_, i) => ({ title: `${prefix}${i}`, url: `https://${prefix}${i}.example/` }));
  const [, { made, skipped }] = withDraftGroups(S(), w, P, [{ title: "One", children: links("one", 3000) }, { title: "Two", children: links("two", 3000) }]);
  assert.equal(made.length, 2);
  assert.equal(skipped, 0);
});

test("a folder with more links than a call can take as arguments doesn't throw", () => {
  const { w } = start();
  const draft = { title: "Wide", children: Array.from({ length: 140_000 }, (_, i) => ({ title: `L${i}`, url: `https://w${i}.example/` })) };
  assert.doesNotThrow(() => withDraftGroups(S(), w, P, [draft]));
});

test("pages that differ only in their credentials' case aren't the same page", () => {
  start();
  assert.equal(importTabs(P, [{ url: "https://User:Secret@example.com/path", title: "a", pinned: true }], null), 1);
  assert.equal(importTabs(P, [{ url: "https://user:secret@example.com/path", title: "b", pinned: true }], null), 1);
  assert.equal(importTabs(P, [{ url: "https://user:secret@EXAMPLE.com/path", title: "c", pinned: true }], null), 0, "the host's case still doesn't matter");
});

test("renaming the deepest group of a 64-level pinned chain over 2,000 tabs stays quick", () => {
  const { w } = start();
  let draft = null;
  for (let level = 63; level >= 0; level--) {
    const links = Array.from({ length: 31 }, (_, i) => ({ title: `L${level}-${i}`, url: `https://d${level}-${i}.example/` }));
    draft = { title: `Level ${level}`, children: draft ? [...links, draft] : links };
  }
  const [next, { made }] = withDraftGroups(S(), w, P, [draft]);
  useBrowser.setState(next);
  assert.equal(made.length, 1);
  assert.ok(Object.keys(S().tabs).length >= 1985);
  const deepest = Object.values(S().groups).find((g) => g.name === "Level 63" && g.windowId === w);
  const t0 = performance.now();
  S().updateGroup(deepest.id, { name: "Deepest" });
  const ms = performance.now() - t0;
  assert.equal(S().groups[deepest.id].name, "Deepest");
  assert.ok(ms < 250, `${ms.toFixed(0)} ms`);
});
