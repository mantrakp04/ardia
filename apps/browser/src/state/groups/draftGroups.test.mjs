import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { bookmarkRoots } = await import("../bookmarks/bookmarks.ts");
const { addFolderToSidebar, allArcHolders, restorableArcHolder, restoreArcFolders } = await import("../bookmarks/bookmarkGroups.ts");
const { importArcSpace } = await import("../import/apply.ts");
const { sidebarEntries } = await import("../sidebar/entries.ts");
const { bookmarkDraft, withDraftGroups } = await import("./draftGroups.ts");

const S = () => useBrowser.getState();
const P = "default";

const tree = (groupId) => {
  const s = S();
  const g = s.groups[groupId];
  const kids = Object.values(s.groups).filter((x) => x.parentId === groupId);
  const out = [];
  const seen = new Set();
  for (const id of g.tabIds) {
    const k = kids.find((x) => x.tabIds.includes(id));
    if (k) {
      if (!seen.has(k.id)) {
        seen.add(k.id);
        out.push({ [k.name]: tree(k.id) });
      }
    } else out.push(s.tabs[id].url);
  }
  return out;
};
const roots = (w) => sidebarEntries(S(), w).pinned.filter((e) => e.startsWith("g:")).map((e) => e.slice(2));

function start() {
  useBrowser.setState({ bookmarks: { nodes: {} } });
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  const bar = bookmarkRoots(S(), P)?.bar ?? (S().addBookmark({ profileId: P, url: "https://seed.example/", title: "seed" }), bookmarkRoots(S(), P).bar);
  return { w, bar };
}

function folderTree(parentId, title, { extras = true, site = "" } = {}) {
  const f = S().addBookmarkFolder({ profileId: P, title, parentId });
  S().addBookmark({ profileId: P, url: `https://${site}a.example/`, title: "A", parentId: f });
  const sub = S().addBookmarkFolder({ profileId: P, title: "Sub", parentId: f });
  S().addBookmark({ profileId: P, url: `https://${site}b.example/`, title: "B", parentId: sub });
  if (extras) {
    S().addBookmarkFolder({ profileId: P, title: "Empty", parentId: f });
    S().addBookmark({ profileId: P, url: "javascript:void(0)", title: "Bookmarklet", parentId: f });
  }
  S().addBookmark({ profileId: P, url: `https://${site}c.example/`, title: "C", parentId: f });
  return f;
}
const titlesIn = (id) => S().bookmarks.nodes[id].children.map((c) => S().bookmarks.nodes[c].title);

test("Add to Sidebar as Group: a pinned group with nested groups, unloaded pinned tabs, bookmarks kept", () => {
  const { w, bar } = start();
  const f = folderTree(bar, "Work");
  const before = Object.keys(S().bookmarks.nodes).length;
  const [g] = addFolderToSidebar(f, w);
  assert.ok(g);
  assert.equal(S().groups[g].name, "Work");
  assert.equal(S().groups[g].pinned, true);
  assert.deepEqual(tree(g), ["https://a.example/", { Sub: ["https://b.example/"] }, "https://c.example/"]);
  for (const id of S().groups[g].tabIds) {
    const t = S().tabs[id];
    assert.equal(t.page.kind, "asleep");
    assert.equal(t.page.nav, undefined);
  }
  assert.equal(Object.keys(S().bookmarks.nodes).length, before, "the bookmarks stay");
  assert.deepEqual(roots(w), [g]);
  assert.deepEqual(addFolderToSidebar(f, w), [], "the same folder again adds nothing");
});

test("Restore Arc Folders as Groups unwraps the holder into top-level pinned groups and deletes it", () => {
  const { w, bar } = start();
  const holder = S().addBookmarkFolder({ profileId: P, title: "Home (Arc)", parentId: bar });
  folderTree(holder, "Reading", { extras: false });
  folderTree(holder, "Dev", { extras: false, site: "dev." });
  const other = S().addBookmarkFolder({ profileId: P, title: "Notes (Arc) old", parentId: bar });
  S().addBookmark({ profileId: P, url: "https://x.example/", title: "X", parentId: other });
  assert.deepEqual(allArcHolders(S()), [holder]);
  const made = restoreArcFolders(holder, w);
  assert.deepEqual(made.map((id) => S().groups[id].name), ["Reading", "Dev"]);
  assert.deepEqual(roots(w), made);
  assert.equal(S().bookmarks.nodes[holder], undefined, "the holder is gone");
  assert.ok(S().bookmarks.nodes[other], "other folders are left alone");
  assert.deepEqual(restoreArcFolders(other, w), []);
});

test("a holder that also holds links is kept after restoring its folders", () => {
  const { w, bar } = start();
  const holder = S().addBookmarkFolder({ profileId: P, title: "Mixed (Arc)", parentId: bar });
  folderTree(holder, "Reading");
  S().addBookmark({ profileId: P, url: "https://loose.example/", title: "Loose", parentId: holder });
  assert.equal(restoreArcFolders(holder, w).length, 1);
  assert.ok(S().bookmarks.nodes[holder]);
});

test("Arc import puts a space's pinned folders straight into nested pinned groups, once", () => {
  const { w } = start();
  const space = {
    id: "s1",
    name: "Home",
    profileId: P,
    tabs: [],
    pinned: [
      { type: "url", title: "Mail", url: "https://mail.example/" },
      {
        type: "folder",
        title: "Projects",
        children: [
          { type: "url", title: "Renamed", pageTitle: "Repo", url: "https://repo.example/" },
          { type: "folder", title: "Inner", children: [{ type: "url", title: "Doc", url: "https://doc.example/" }] },
        ],
      },
    ],
  };
  const bookmarksBefore = Object.keys(S().bookmarks.nodes).length;
  const first = importArcSpace(P, space);
  assert.equal(first.bookmarks, 0);
  assert.equal(first.tabs, 3);
  assert.equal(Object.keys(S().bookmarks.nodes).length, bookmarksBefore, "no (Arc) bookmark folder");
  const [g] = roots(w);
  assert.equal(S().groups[g].name, "Projects");
  assert.deepEqual(tree(g), ["https://repo.example/", { Inner: ["https://doc.example/"] }]);
  const repo = Object.values(S().tabs).find((t) => t.url === "https://repo.example/");
  assert.equal(repo.customTitle, "Renamed");
  importArcSpace(P, { ...space, pinned: space.pinned.filter((n) => n.type === "folder") });
  assert.equal(roots(w).length, 1, "a re-import adds no second group");
});

test("restoring keeps the holder with what couldn't become a group, and moves only the folders that did", () => {
  const { w, bar } = start();
  const holder = S().addBookmarkFolder({ profileId: P, title: "Kept (Arc)", parentId: bar });
  const reading = folderTree(holder, "Reading", { extras: false });
  const empty = S().addBookmarkFolder({ profileId: P, title: "Empty", parentId: holder });
  const scripts = S().addBookmarkFolder({ profileId: P, title: "Scripts", parentId: holder });
  S().addBookmark({ profileId: P, url: "javascript:void(0)", title: "Bookmarklet", parentId: scripts });
  assert.equal(restoreArcFolders(holder, w).length, 1);
  assert.ok(S().bookmarks.nodes[holder], "the holder stays");
  assert.equal(S().bookmarks.nodes[reading], undefined, "the folder that became a group leaves it");
  assert.deepEqual(S().bookmarks.nodes[holder].children, [empty, scripts]);
});

test("an Arc import counts the tabs of the groups it made, not of folders it skipped", () => {
  start();
  const folder = (title, url) => ({ type: "folder", title, children: [{ type: "url", title, url }, { type: "url", title: "Script", url: "javascript:void(0)" }] });
  const space = { id: "s3", name: "Home", profileId: P, tabs: [], pinned: [folder("One", "https://one.example/")] };
  assert.equal(importArcSpace(P, space).tabs, 1);
  assert.equal(importArcSpace(P, { ...space, pinned: [folder("One", "https://one.example/"), folder("Two", "https://two.example/")] }).tabs, 1);
});

test("Restore is offered only for a holder with a folder that can become a group", () => {
  const { bar } = start();
  const empty = S().addBookmarkFolder({ profileId: P, title: "Empty (Arc)", parentId: bar });
  S().addBookmarkFolder({ profileId: P, title: "Nothing", parentId: empty });
  const loose = S().addBookmarkFolder({ profileId: P, title: "Loose (Arc)", parentId: bar });
  S().addBookmark({ profileId: P, url: "https://loose.example/", title: "Loose", parentId: loose });
  const full = S().addBookmarkFolder({ profileId: P, title: "Full (Arc)", parentId: bar });
  const kept = S().addBookmarkFolder({ profileId: P, title: "Kept", parentId: full });
  S().addBookmark({ profileId: P, url: "https://kept.example/", title: "Kept", parentId: kept });
  assert.equal(restorableArcHolder(S(), empty), false);
  assert.equal(restorableArcHolder(S(), loose), false);
  assert.equal(restorableArcHolder(S(), full), true);
  assert.deepEqual(allArcHolders(S()), [full]);
});

test("restoring takes out only the links that became tabs: bookmarklets and empty folders stay where they were", () => {
  const { w, bar } = start();
  const holder = S().addBookmarkFolder({ profileId: P, title: "Home (Arc)", parentId: bar });
  const reading = folderTree(holder, "Reading");
  assert.equal(restoreArcFolders(holder, w).length, 1);
  assert.deepEqual(tree(roots(w)[0]), ["https://a.example/", { Sub: ["https://b.example/"] }, "https://c.example/"]);
  assert.deepEqual(titlesIn(holder), ["Reading"]);
  assert.deepEqual(titlesIn(reading), ["Empty", "Bookmarklet"], "the bookmarklet and the empty folder are kept");
});

test("restoring a folder whose pages are all pinned already adds none and keeps the folder whole", () => {
  const { w, bar } = start();
  addFolderToSidebar(folderTree(bar, "Reading"), w);
  const holder = S().addBookmarkFolder({ profileId: P, title: "Home (Arc)", parentId: bar });
  const reading = folderTree(holder, "Reading");
  assert.deepEqual(restoreArcFolders(holder, w), []);
  assert.equal(roots(w).length, 1);
  assert.deepEqual(titlesIn(reading), ["A", "Sub", "Empty", "Bookmarklet", "C"]);
});

test("a folder with no title is recognised on a second add, like a named one", () => {
  const { w, bar } = start();
  const f = folderTree(bar, "", { extras: false });
  assert.equal(addFolderToSidebar(f, w).length, 1);
  assert.deepEqual(addFolderToSidebar(f, w), [], "the same untitled folder again adds nothing");
  assert.equal(roots(w).length, 1);
});

test("a folder already a pinned group parked with a closed window isn't added again", () => {
  const { w, bar } = start();
  const f = folderTree(bar, "Reading", { extras: false });
  assert.equal(addFolderToSidebar(f, w).length, 1);
  const draft = bookmarkDraft(S().bookmarks, f);
  S().closeWindow(w);
  const parked = S().parkedPins[P];
  assert.ok(parked?.groups.length, "the group is parked");
  S().hydrate({});
  const w2 = S().createWindow({ url: "https://other.example/" });
  useBrowser.setState({ parkedPins: { [P]: parked } });
  const [, { made }] = withDraftGroups(S(), w2, P, [draft]);
  assert.deepEqual(made, []);
});
