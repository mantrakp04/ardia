import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");

const S = () => useBrowser.getState();

function twoWindows() {
  S().hydrate({});
  const from = S().createWindow({ url: "https://a.com/" });
  const moved = S().newTab(from, { url: "https://b.com/" });
  const to = S().createWindow({ url: "https://c.com/" });
  return { from, to, moved };
}

test("a move the engine refuses goes back to the window it came from", () => {
  const { from, to, moved } = twoWindows();
  assert.equal(S().moveTabsToWindow([moved], to), to);
  assert.equal(S().tabs[moved].windowId, to);
  assert.ok(!S().windows[from].tabIds.includes(moved));

  S().returnRefusedMove(moved, from);

  assert.equal(S().tabs[moved].windowId, from);
  assert.ok(S().windows[from].tabIds.includes(moved));
  assert.ok(!S().windows[to].tabIds.includes(moved));
  assert.equal(S().tabs[moved].url, "https://b.com/");
});

test("a refusal names no window, or a window that is gone: the tab stays", () => {
  const { from, to, moved } = twoWindows();
  S().moveTabsToWindow([moved], to);
  S().returnRefusedMove(moved, "");
  assert.equal(S().tabs[moved].windowId, to);
  S().closeWindow(from);
  S().returnRefusedMove(moved, from);
  assert.equal(S().tabs[moved].windowId, to);
  assert.ok(S().windows[to].tabIds.includes(moved));
});

test("a refusal for a tab already back in its window changes nothing", () => {
  const { from, moved } = twoWindows();
  const before = S();
  S().returnRefusedMove(moved, from);
  assert.equal(S(), before);
});
