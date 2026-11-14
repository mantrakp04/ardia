import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { activeTabId } = await import("../browser/model.ts");
const { webviews } = await import("../../platform/webviews.ts");
const { runCommand } = await import("./commands.ts");

test("⌥⌘I and F12 both toggle DevTools, so a second press closes them as in Chrome; ⌥⌘C inspects and ⌥⌘J opens the console", () => {
  useBrowser.getState().hydrate({});
  const w = useBrowser.getState().createWindow({ url: "https://a.example/" });
  const panels = [];
  webviews.set(activeTabId(useBrowser.getState(), w), { showDevTools: (panel) => panels.push(panel ?? "show") });
  for (const command of ["devTools", "toggleDevTools", "inspectElements", "javaScriptConsole"]) runCommand({ command, arg: null, windowId: w });
  assert.deepEqual(panels, ["toggle", "toggle", "inspect", "console"]);
});
