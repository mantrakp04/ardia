import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { openInMainWindow } = await import("./actions.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };

function mainWindowWithThreeTabs(newTabPosition) {
  S().hydrate({ profiles: { default: PERSONAL }, profileOrder: ["default"], windows: {}, tabs: {} });
  const main = S().createWindow({ url: "https://a.example/" });
  const [a] = S().windows[main].tabIds;
  const b = S().newTab(main, { url: "https://b.example/", background: true });
  const c = S().newTab(main, { url: "https://c.example/", background: true });
  S().activate(b);
  S().updateSettings({ newTabPosition });
  const small = S().createWindow({ kind: "small", url: "https://little.example/" });
  const moved = S().windows[small].tabIds[0];
  return { main, small, a, b, c, moved };
}

const urlsOf = (windowId) => S().windows[windowId].tabIds.map((id) => S().tabs[id].url);

for (const [position, expected] of [
  ["bottom", ["https://a.example/", "https://b.example/", "https://c.example/", "https://little.example/"]],
  ["top", ["https://little.example/", "https://a.example/", "https://b.example/", "https://c.example/"]],
  ["nextToCurrent", ["https://a.example/", "https://b.example/", "https://little.example/", "https://c.example/"]],
]) {
  test(`Open in Ardia puts the Little Ardia tab where a new tab goes with "New tabs open at" set to ${position}`, () => {
    const { main, small, moved } = mainWindowWithThreeTabs(position);
    openInMainWindow(small);
    assert.equal(S().windows[small], undefined);
    assert.deepEqual(urlsOf(main), expected);
    assert.equal(S().windows[main].activeTabIds.default, moved);
  });
}

const PLACEMENTS = [
  ["bottom", ["https://a.example/", "https://b.example/", "https://c.example/", "https://little.example/"]],
  ["top", ["https://little.example/", "https://a.example/", "https://b.example/", "https://c.example/"]],
  ["nextToCurrent", ["https://a.example/", "https://b.example/", "https://little.example/", "https://c.example/"]],
];

for (const [position, expected] of PLACEMENTS) {
  test(`Move to Window places tabs from another window where a new tab goes with "Add new tabs" set to ${position}, keeping their order`, () => {
    const { main } = mainWindowWithThreeTabs(position);
    const other = S().createWindow({ url: "https://x.example/" });
    S().newTab(other, { url: "https://y.example/", background: true });
    const moved = [...S().windows[other].tabIds];
    S().moveTabsToWindow(moved, main);
    const at = expected.indexOf("https://little.example/");
    const movedUrls = moved.map((id) => S().tabs[id].url);
    assert.deepEqual(urlsOf(main), [...expected.slice(0, at), ...movedUrls, ...expected.slice(at + 1)]);
    assert.ok(moved.every((id) => S().tabs[id].windowId === main));
  });
}

test("a tab moved below a current tab that sits inside a group lands after the group, not in it", () => {
  const { main, small, b, c, moved } = mainWindowWithThreeTabs("nextToCurrent");
  const g = S().createGroup([b, c], { name: "G" });
  S().activate(b);
  openInMainWindow(small);
  assert.deepEqual(urlsOf(main), ["https://a.example/", "https://b.example/", "https://c.example/", "https://little.example/"]);
  assert.deepEqual(S().groups[g].tabIds, [b, c]);
  assert.equal(S().tabs[moved].windowId, main);
});

test("tabs of several profiles moved at once each land by their own profile's current tab", () => {
  const { main, b } = mainWindowWithThreeTabs("nextToCurrent");
  const work = S().createProfile({ name: "Work" });
  S().switchProfile(main, work);
  const w1 = S().windows[main].activeTabIds[work];
  S().newTab(main, { url: "https://w2.example/", background: true });
  const other = S().createWindow({ url: "https://p.example/" });
  const p = S().windows[other].tabIds[0];
  S().switchProfile(other, work);
  const q = S().windows[other].activeTabIds[work];
  S().navigate(q, "https://q.example/");
  S().mergeAllWindows(main);
  const ids = S().windows[main].tabIds;
  assert.equal(ids.indexOf(p), ids.indexOf(b) + 1);
  assert.equal(ids.indexOf(q), ids.indexOf(w1) + 1);
  assert.ok([p, q].every((id) => S().tabs[id].windowId === main));
});

test("a tab moved below a current tab that is one pane of a split lands after the whole split", () => {
  const { main, small, a, b, moved } = mainWindowWithThreeTabs("nextToCurrent");
  S().createSplit([a, b]);
  S().activate(a);
  openInMainWindow(small);
  assert.deepEqual(urlsOf(main), ["https://a.example/", "https://b.example/", "https://little.example/", "https://c.example/"]);
  assert.equal(S().tabs[moved].windowId, main);
});
