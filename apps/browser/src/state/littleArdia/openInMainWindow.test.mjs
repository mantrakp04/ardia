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

test("Move to Window places tabs from another window where a new tab goes too, keeping their order", () => {
  const { main, a } = mainWindowWithThreeTabs("top");
  const other = S().createWindow({ url: "https://x.example/" });
  S().newTab(other, { url: "https://y.example/", background: true });
  S().moveTabsToWindow(S().windows[other].tabIds, main);
  assert.deepEqual(urlsOf(main), ["https://y.example/", "https://x.example/", "https://a.example/", "https://b.example/", "https://c.example/"]);
  assert.equal(S().tabs[a].windowId, main);
});
