import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { runCommand } = await import("../commands/commands.ts");
const { openSplitPane } = await import("./actions.ts");
const { webviews } = await import("../../platform/webviews.ts");
const { activeTabId } = await import("../browser/model.ts");
const { splitOf } = await import("./splits.ts");
const S = () => useBrowser.getState();
S().hydrate({});

test("Focus Next and Previous Split Pane give the keyboard to the pane they activate", () => {
  const windowId = S().createWindow({ url: "https://a.example/" });
  openSplitPane(windowId, { url: "https://b.example/" });
  const split = splitOf(S(), activeTabId(S(), windowId));
  assert.ok(split, "a split opened");
  const focused = [];
  for (const id of Object.keys(S().tabs)) webviews.set(id, { focus: async () => void focused.push(id) });
  const before = activeTabId(S(), windowId);
  runCommand({ command: "focusNextPane", windowId });
  const next = activeTabId(S(), windowId);
  assert.notEqual(next, before);
  assert.deepEqual(focused, [next], "the newly active pane's page takes the keyboard");
  runCommand({ command: "focusPreviousPane", windowId });
  assert.deepEqual(focused, [next, before]);
});

test("with no split, Focus Next Split Pane leaves the keyboard where it is", () => {
  const windowId = S().createWindow({ url: "https://alone.example/" });
  const focused = [];
  for (const id of Object.keys(S().tabs)) webviews.set(id, { focus: async () => void focused.push(id) });
  runCommand({ command: "focusNextPane", windowId });
  runCommand({ command: "focusPreviousPane", windowId });
  assert.deepEqual(focused, []);
});
