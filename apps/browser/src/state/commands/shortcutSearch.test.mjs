import assert from "node:assert/strict";
import { test } from "node:test";
const { shortcutMatchesQuery } = await import("./shortcutSearch.ts");
const { parseShortcut } = await import("./shortcuts.ts");

const autoHide = { id: "toggleSidebar", title: "Auto-Hide Tabs", path: ["View", "Auto-Hide Tabs"] };
const dark = { id: "setAppearance:dark", title: "Dark", path: ["View", "Appearance", "Dark"] };
const bringToFront = { id: "system:Window > Bring All to Front", title: "Bring All to Front", path: ["Window", "Bring All to Front"] };
const cmdS = parseShortcut("⌘S");
const none = { key: "", modifiers: [] };

test("the command bar's keywords find a shortcut by what people call it", () => {
  for (const query of ["sidebar", "toggle sidebar", "hide sidebar", "Show Sidebar", "focus mode"]) {
    assert.ok(shortcutMatchesQuery(query, autoHide, cmdS), query);
  }
  assert.ok(shortcutMatchesQuery("dark mode", dark, none));
});

test("a query that names nothing about the command doesn't match it", () => {
  for (const query of ["bookmarks", "sidebar downloads", "reload"]) assert.equal(shortcutMatchesQuery(query, autoHide, cmdS), false, query);
  assert.equal(shortcutMatchesQuery("sidebar", dark, none), false);
});

test("title, menu path and keys still match, and an empty query matches everything", () => {
  assert.ok(shortcutMatchesQuery("auto-hide", autoHide, cmdS));
  assert.ok(shortcutMatchesQuery("view", autoHide, cmdS));
  assert.ok(shortcutMatchesQuery("⌘S", autoHide, cmdS));
  assert.equal(shortcutMatchesQuery("⌘S", autoHide, none), false);
  assert.ok(shortcutMatchesQuery("appearance", dark, none));
  assert.ok(shortcutMatchesQuery("window front", bringToFront, none));
  assert.ok(shortcutMatchesQuery("  ", bringToFront, none));
});
