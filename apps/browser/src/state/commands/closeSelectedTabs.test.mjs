import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { runCommand } = await import("./commands.ts");
const { menuState } = await import("./menuState.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();

function windowWith(...hosts) {
  S().hydrate({});
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  S().setFocusedWindow(w);
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

const urls = (w) => S().windows[w].tabIds.map((id) => S().tabs[id].url);

test("⌘W closes every tab in a sidebar multi-selection, not only the active one", () => {
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  S().activate(b);
  S().setSelection(w, [b, c, d]);
  assert.equal(menuState(S()).titles.closeTab, "Close 3 Tabs");
  runCommand({ command: "closeTab", arg: null, windowId: w });
  assert.deepEqual(urls(w), ["https://a.com/"]);
  assert.deepEqual(S().selection[w] ?? [], []);
  assert.equal(S().tabs[a]?.url, "https://a.com/");
  assert.equal(S().tabs[b], undefined);
  assert.equal(S().tabs[c], undefined);
  assert.equal(S().tabs[d], undefined);
});

test("⌘W still closes only the active tab when nothing is multi-selected", () => {
  const { w, ids: [a, b] } = windowWith("a", "b");
  S().activate(b);
  S().setSelection(w, []);
  runCommand({ command: "closeTab", arg: null, windowId: w });
  assert.deepEqual(urls(w), ["https://a.com/"]);
  assert.equal(S().tabs[a]?.url, "https://a.com/");
  assert.equal(S().tabs[b], undefined);
});

test("⌘W dismisses the command bar before closing a multi-selection", () => {
  const { w, ids: [, b, c] } = windowWith("a", "b", "c");
  S().activate(b);
  S().setSelection(w, [b, c]);
  S().openPanel(w, "https://search.example/");
  assert.equal(S().windowUi[w].panel.open, true);
  assert.equal(menuState(S()).titles.closeTab, undefined, "menu stays Close Tab while ⌘W only dismisses the bar");
  runCommand({ command: "closeTab", arg: null, windowId: w });
  assert.equal(S().windowUi[w].panel.open, false);
  assert.equal(menuState(S()).titles.closeTab, "Close 2 Tabs");
  assert.ok(S().tabs[b]);
  assert.ok(S().tabs[c]);
});

test("⌘W on a selection with a pinned tab unloads the pinned tab and closes the rest", () => {
  const { w, ids: [a, b, c, d] } = windowWith("a", "b", "c", "d");
  S().pinTabs([b], true);
  S().activate(c);
  S().setSelection(w, [b, c, d]);
  assert.equal(menuState(S()).titles.closeTab, "Close 3 Tabs");
  runCommand({ command: "closeTab", arg: null, windowId: w });
  assert.ok(S().tabs[a]);
  assert.ok(S().tabs[b]?.pin, "the pinned tab stays in the sidebar");
  assert.notEqual(S().tabs[b]?.page.kind, "loaded");
  assert.equal(S().tabs[c], undefined);
  assert.equal(S().tabs[d], undefined);
});
