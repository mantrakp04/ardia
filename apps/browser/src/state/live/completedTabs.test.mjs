import assert from "node:assert/strict";
import { after, test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { openLiveItem, refreshFolder, startLiveEngine } = await import("./engine.ts");
const { SOURCES } = await import("./sources.ts");
const { createFolder, finishCompleting, hideItems, live, removeFolder, updateFolder } = await import("./store.ts");

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

const listed = new Map();
const merged = new Set();
SOURCES.github.fetch = async (folder) => listed.get(folder.id) ?? [];
SOURCES.github.resolveGone = async (items) => Object.fromEntries(items.filter((it) => merged.has(it.id)).map((it) => [it.id, "merged"]));

S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"] });
const w = S().createWindow({ url: "https://start.example/" });
const start = S().windows[w].tabIds[0];
startLiveEngine();
after(() => live().folderOrder.forEach(removeFolder));

async function folderOf(showCompleted, count = 2) {
  const id = createFolder("default", "pullRequests", ["github"]);
  updateFolder(id, { showCompleted });
  const prs = Array.from({ length: count }, (_, i) => pr(`${id}:${i}`, i + 1));
  listed.set(id, prs);
  await refreshFolder(id);
  return { id, prs };
}

async function merge(id, prs) {
  for (const it of prs) merged.add(it.id);
  listed.set(id, listed.get(id).filter((it) => !merged.has(it.id)));
  await refreshFolder(id);
}

const inFolder = (tab, id) => S().tabs[tab].liveItem?.folderId === id;

async function mergeWithTabOpen(showCompleted) {
  const { id, prs } = await folderOf(showCompleted);
  const tab = openLiveItem(w, id, prs[0], { background: true });
  await merge(id, [prs[0]]);
  return { id, tab, merging: prs[0] };
}

test("with Show Completed off, a merged pull request's open tab closes once its merge has played", async () => {
  const { id, tab, merging } = await mergeWithTabOpen(false);
  assert.ok(inFolder(tab, id), "the row keeps its tab while the merge plays");
  finishCompleting(id, [merging.id]);
  assert.equal(S().tabs[tab], undefined);
  assert.ok(!S().windows[w].tabIds.includes(tab), "the tab doesn't move to the tab list");
});

test("with Show Completed on, a merged pull request's open tab stays in the folder", async () => {
  const { id, tab, merging } = await mergeWithTabOpen(true);
  finishCompleting(id, [merging.id]);
  assert.ok(inFolder(tab, id));
});

test("turning Show Completed off closes the tabs of pull requests that already completed", async () => {
  const { id, tab, merging } = await mergeWithTabOpen(true);
  finishCompleting(id, [merging.id]);
  updateFolder(id, { showCompleted: false });
  assert.equal(S().tabs[tab], undefined);
});

test("a merged pull request's tab you're looking at stays open until you switch away", async () => {
  const { id, tab, merging } = await mergeWithTabOpen(false);
  S().activate(tab);
  finishCompleting(id, [merging.id]);
  assert.ok(inFolder(tab, id));
  S().activate(start);
  assert.equal(S().tabs[tab], undefined);
});

test("a merged pull request's tab left selected in a profile the window isn't showing closes", async () => {
  const { id, tab, merging } = await mergeWithTabOpen(false);
  S().activate(tab);
  S().switchProfile(w, S().createProfile({ name: "Work" }));
  finishCompleting(id, [merging.id]);
  assert.equal(S().tabs[tab], undefined);
  S().switchProfile(w, "default");
});

test("a merged pull request's tab showing as a pane of the split on screen stays open until the split is off screen", async () => {
  const { id, tab, merging } = await mergeWithTabOpen(false);
  const beside = S().newTab(w, { url: "https://beside.example/" });
  S().createSplit([beside, tab]);
  S().activate(beside);
  finishCompleting(id, [merging.id]);
  assert.ok(inFolder(tab, id));
  S().activate(start);
  assert.equal(S().tabs[tab], undefined);
});

test("a merged pull request's tab closes however many pull requests merge in the same refresh", async () => {
  const { id, prs } = await folderOf(false, 30);
  const tab = openLiveItem(w, id, prs[29], { background: true });
  await merge(id, prs);
  finishCompleting(id, prs.map((it) => it.id));
  assert.equal(S().tabs[tab], undefined);
});

test("a hidden pull request's tab closes when it merges", async () => {
  const { id, prs } = await folderOf(false);
  const tab = openLiveItem(w, id, prs[0], { background: true });
  hideItems(id, [prs[0]]);
  await merge(id, [prs[0]]);
  assert.equal(S().tabs[tab], undefined);
});

test("a pull request that drops out of the folder without completing keeps its tab in the folder", async () => {
  const { id, prs } = await folderOf(false);
  const tab = openLiveItem(w, id, prs[0], { background: true });
  listed.set(id, [prs[1]]);
  await refreshFolder(id);
  assert.ok(inFolder(tab, id));
});

test("a tab opened from the Completed list closes when Show Completed is turned off", async () => {
  const { id, prs } = await folderOf(true);
  await merge(id, [prs[0]]);
  finishCompleting(id, [prs[0].id]);
  const tab = openLiveItem(w, id, prs[0], { background: true });
  assert.ok(inFolder(tab, id));
  updateFolder(id, { showCompleted: false });
  assert.equal(S().tabs[tab], undefined);
});
