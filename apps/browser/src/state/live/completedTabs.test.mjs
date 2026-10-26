import assert from "node:assert/strict";
import { after, test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { openLiveItem, startLiveEngine } = await import("./engine.ts");
const { applyFetch, createFolder, finishCompleting, live, removeFolder, updateFolder } = await import("./store.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

const pr = (id, number) => ({
  id,
  source: "github",
  url: `https://github.com/o/r/pull/${number}`,
  title: `PR ${number}`,
  subtitle: "",
  icon: null,
  updatedAt: 0,
  section: "authored",
  pr: { number, repo: "o/r", headRef: `h${number}`, baseRef: "main" },
});

S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
const w = S().createWindow({ url: "https://start.example/" });
const start = S().windows[w].tabIds[0];
startLiveEngine();
after(() => live().folderOrder.forEach(removeFolder));

function mergeWithTabOpen(showCompleted) {
  const id = createFolder("default", "pullRequests", []);
  updateFolder(id, { showCompleted });
  const merging = pr(`m-${id}`, 1);
  applyFetch(id, [merging, pr(`o-${id}`, 2)], {});
  const tab = openLiveItem(w, id, merging, { background: true });
  applyFetch(id, [pr(`o-${id}`, 2)], { [merging.id]: "merged" });
  return { id, tab, merging };
}

test("with Show Completed off, a merged pull request's open tab leaves the folder once its merge has played", () => {
  const { id, tab, merging } = mergeWithTabOpen(false);
  assert.deepEqual(S().tabs[tab].liveItem, { folderId: id, itemId: merging.id }, "the row keeps its tab while the merge plays");
  finishCompleting(id, [merging.id]);
  assert.equal(S().tabs[tab].liveItem, undefined);
  assert.ok(S().windows[w].tabIds.includes(tab), "the tab stays open, in the tab list");
});

test("with Show Completed on, a merged pull request's open tab stays in the folder", () => {
  const { id, tab, merging } = mergeWithTabOpen(true);
  finishCompleting(id, [merging.id]);
  assert.deepEqual(S().tabs[tab].liveItem, { folderId: id, itemId: merging.id });
});

test("turning Show Completed off takes the tabs of pull requests that already completed out of the folder", () => {
  const { id, tab, merging } = mergeWithTabOpen(true);
  finishCompleting(id, [merging.id]);
  updateFolder(id, { showCompleted: false });
  assert.equal(S().tabs[tab].liveItem, undefined);
});

test("a merged pull request's tab you're looking at stays in the folder until you switch away", () => {
  const { id, tab, merging } = mergeWithTabOpen(false);
  S().activate(tab);
  finishCompleting(id, [merging.id]);
  assert.deepEqual(S().tabs[tab].liveItem, { folderId: id, itemId: merging.id });
  S().activate(start);
  assert.equal(S().tabs[tab].liveItem, undefined);
  assert.ok(live().completed[id].some((c) => c.item.id === merging.id));
});
