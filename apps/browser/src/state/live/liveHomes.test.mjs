import assert from "node:assert/strict";
import { test } from "node:test";

const { useBrowser } = await import("../browser/store.ts");
const { openLiveItem, syncLiveHomes } = await import("./engine.ts");
const { applyFetch, createFolder, finishCompleting, removeFolder, live } = await import("./store.ts");

const URL = "https://github.com/o/r/pull/1";
const item = { id: "i", source: "github", url: URL, title: "PR", subtitle: "", icon: null, updatedAt: 0, section: "authored", pr: { number: 1, repo: "o/r", headRef: "h", baseRef: "main" } };
const S = () => useBrowser.getState();

function folderWithOpenItem() {
  const folderId = createFolder("p", "pullRequests", []);
  applyFetch(folderId, [item], {});
  S().hydrate({});
  const w = S().createWindow({ url: "https://x.com/" });
  return { folderId, w };
}

test("a merged item's open tab keeps its home once the item moves to Completed", () => {
  const { folderId, w } = folderWithOpenItem();
  const t = openLiveItem(w, folderId, item);
  assert.equal(S().tabs[t].pinnedUrl, URL);
  applyFetch(folderId, [], { i: "merged" });
  finishCompleting(folderId, ["i"]);
  assert.deepEqual(live().items[folderId], []);
  syncLiveHomes();
  assert.equal(S().tabs[t].pinnedUrl, URL);
  S().closeTabs([t]);
  removeFolder(folderId);
});

test("opening an item from Completed gives its tab the item's page as home", () => {
  const { folderId, w } = folderWithOpenItem();
  applyFetch(folderId, [], { i: "merged" });
  finishCompleting(folderId, ["i"]);
  const t = openLiveItem(w, folderId, item);
  assert.equal(S().tabs[t].pinnedUrl, URL);
  S().closeTabs([t]);
  removeFolder(folderId);
});

test("a tab loses its home once the item has left the folder altogether", () => {
  const { folderId, w } = folderWithOpenItem();
  const t = openLiveItem(w, folderId, item);
  applyFetch(folderId, [], {});
  syncLiveHomes();
  assert.equal(S().tabs[t].pinnedUrl, null);
  S().closeTabs([t]);
  removeFolder(folderId);
});
