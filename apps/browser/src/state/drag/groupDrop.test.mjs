import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { viewTabIds } = await import("../browser/model.ts");
const drop = await import("./windowDrop.ts");

const S = () => useBrowser.getState();
const host = (id) => new URL(S().tabs[id].url).hostname.replace(".com", "");
const groupsIn = (w) =>
  Object.values(S().groups)
    .filter((g) => g.windowId === w)
    .map((g) => ({ name: g.name, parent: g.parentId ? S().groups[g.parentId].name : null, tabs: g.tabIds.map(host) }))
    .sort((a, z) => a.name.localeCompare(z.name));

function twoWindows() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const ids = [S().windows[w].tabIds[0], ...["b", "c", "d"].map((h) => S().newTab(w, { url: `https://${h}.com/` }))];
  S().setWindowFrame(w, [0, 100, 800, 600]);
  const other = S().createWindow({ url: "https://x.com/" });
  S().setWindowFrame(other, [1000, 100, 800, 600]);
  const g = S().groupTabs([ids[1], ids[2], ids[3]], { name: "Videos", pinned: false });
  const inner = S().groupTabs([ids[2], ids[3]], { name: "Music", pinned: false });
  return { w, other, ids, g, inner };
}

test("a group dropped over another window moves there whole, nested group included", () => {
  const { w, other, g } = twoWindows();
  assert.equal(drop.dropGroupOutside(g, w, 1200, 300), other);
  assert.deepEqual(viewTabIds(S(), w).map(host), ["a"]);
  assert.deepEqual(viewTabIds(S(), other).map(host), ["x", "b", "c", "d"]);
  assert.deepEqual(groupsIn(other), [
    { name: "Music", parent: "Videos", tabs: ["c", "d"] },
    { name: "Videos", parent: null, tabs: ["b", "c", "d"] },
  ]);
  assert.deepEqual(groupsIn(w), []);
});

test("a group dropped on empty desktop opens a new window under the pointer with the group in it", () => {
  const { w, other, g } = twoWindows();
  let asked = null;
  const made = drop.dropGroupOutside(g, w, 2500, 300, (frame) => (asked = frame));
  assert.ok(made && made !== w && made !== other);
  assert.deepEqual(asked, [2410, -130, 800, 600]);
  assert.deepEqual(S().windows[made].frame, asked);
  assert.deepEqual(groupsIn(made).map((x) => x.name), ["Music", "Videos"]);
  assert.deepEqual(viewTabIds(S(), w).map(host), ["a"]);
});

test("a nested group dragged out leaves its parent behind", () => {
  const { w, other, inner } = twoWindows();
  assert.equal(drop.dropGroupOutside(inner, w, 1200, 300), other);
  assert.deepEqual(groupsIn(w), [{ name: "Videos", parent: null, tabs: ["b"] }]);
  assert.deepEqual(groupsIn(other), [{ name: "Music", parent: null, tabs: ["c", "d"] }]);
});

test("a pinned group, or one holding every tab of its window, stays put", () => {
  const { w, ids } = twoWindows();
  const pinned = S().groupTabs([ids[0]], { name: "Pinned" });
  assert.equal(drop.dropGroupOutside(pinned, w, 1200, 300), null);
  assert.equal(S().groups[pinned].windowId, w);
  S().hydrate({});
  const solo = S().createWindow({ url: "https://a.com/" });
  S().setWindowFrame(solo, [0, 100, 800, 600]);
  const only = S().groupTabs([S().windows[solo].tabIds[0]], { name: "All", pinned: false });
  assert.equal(drop.dropGroupOutside(only, solo, 2500, 300), null);
  assert.equal(S().groups[only].windowId, solo);
});
