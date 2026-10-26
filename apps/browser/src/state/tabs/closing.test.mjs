import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { closeIntent, closeKind } = await import("./tabs.ts");
const { viewTabIds } = await import("../browser/model.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();

function windowWith(...hosts) {
  S().hydrate({});
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

test("closing a Peek through either call ends the Peek and records nothing", () => {
  for (const close of [(id) => S().closeTab(id), (id) => S().closeTabs([id])]) {
    const { w, ids: [a] } = windowWith("a", "b");
    const peek = S().openPeek(a, "https://peek.example/", { x: 0, y: 0 });
    const closed = S().closedTabs.length;
    close(peek);
    assert.equal(S().peeks[w], undefined);
    assert.equal(S().tabs[peek], undefined);
    assert.ok(S().tabs[a]);
    assert.equal(S().closedTabs.length, closed);
  }
});

test("⌘W on the last tab closes the window; closing every tab at once keeps it with a New Tab", () => {
  const one = windowWith("a");
  S().closeTab(one.ids[0]);
  assert.equal(S().windows[one.w], undefined);

  const all = windowWith("a", "b");
  S().closeTabs(all.ids);
  assert.ok(S().windows[all.w]);
  const left = viewTabIds(S(), all.w);
  assert.equal(left.length, 1);
  assert.equal(S().tabs[left[0]].url, "");
});

test("closing a pinned tab with regular tabs unloads it and closes only those", () => {
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().pinTabs([a], true, true);
  S().activate(a);
  S().closeTabs([a, b]);
  assert.ok(S().tabs[a], "the pinned row stays");
  assert.equal(!!S().tabs[a].navigation || !!S().tabs[a].adoptId, false, "unloaded");
  assert.equal(S().tabs[b], undefined);
  assert.ok(S().windows[w]);
  assert.equal(S().windows[w].activeTabIds[S().windows[w].profileId], c);
});

test("what ✕ does: close a tab, unload an open pin, remove a closed pinned row", () => {
  const { ids: [a, b, c] } = windowWith("a", "b", "c");
  S().pinTabs([a], true);
  S().pinTabs([b], true, true);
  S().activate(c);
  assert.deepEqual(closeIntent(S(), c), { kind: "close", ids: [c] });
  assert.equal(closeKind(S(), b), "unload");
  S().closeTabs([a, b]);
  assert.equal(closeKind(S(), b), "removePin");
  assert.deepEqual(closeIntent(S(), a), { kind: "unload", ids: [a] }, "a closed tile only unloads");
});
