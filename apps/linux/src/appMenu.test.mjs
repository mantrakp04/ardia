import assert from "node:assert/strict";
import { test } from "node:test";
import { appMenuChoice, appMenuItems } from "./appMenu.ts";

const state = (overrides = {}) => ({
  checked: ["setAppearance:dark", "toggleFullUrl"],
  disabled: ["back", "togglePin:tile", "reopenClosedWindow"],
  titles: { bookmarkPage: "Edit Bookmark…" },
  profiles: [{ id: "p1", title: "Personal", current: true }, { id: "p2", title: "Work" }],
  windows: [{ id: "w2", title: "Docs" }],
  bookmarkFolders: [{ id: "bar", title: "Bookmarks Bar" }],
  recentBookmarks: [{ id: "b1", title: "Example", url: "https://example.com" }],
  bookmarksBar: [{ id: "f1", title: "Work", children: [{ id: "b2", title: "", url: "https://ardia.dev" }] }],
  otherBookmarks: [],
  recentlyClosed: [],
  recentlyClosedGroups: [],
  warnBeforeQuitting: false,
  extensions: [{ id: "ext", title: "uBlock", enabled: true }],
  ...overrides,
});
const top = (items, title) => items.find((item) => item.title === title);
const find = (items, id) => {
  for (const item of items) {
    if (item.id === id) return item;
    const nested = item.children && find(item.children, id);
    if (nested) return nested;
  }
};

test("the menu mirrors the macOS menu bar's top-level menus", () => {
  assert.deepEqual(appMenuItems(state()).map((item) => item.title), ["Ardia", "File", "Edit", "View", "Tabs", "Bookmarks", "History", "Extensions", "Window", "Help"]);
});

test("items carry the menu state's checks, disabled commands and titles", () => {
  const items = appMenuItems(state());
  assert.equal(find(items, "setAppearance:dark").checked, true);
  assert.equal(find(items, "setAppearance:light").checked, false);
  assert.equal(find(items, "toggleFullUrl").checked, true);
  assert.equal(find(items, "back").enabled, false);
  assert.equal(find(items, "forward").enabled, true);
  assert.equal(find(items, "togglePin:tile"), undefined);
  assert.equal(find(top(items, "Bookmarks").children, "bookmarkPage").title, "Edit Bookmark…");
  assert.equal(find(top(items, "Tabs").children, "moveTabToProfile:p1").checked, true);
  assert.equal(find(items, "openBookmark:b2").title, "https://ardia.dev");
  assert.equal(find(items, "addFolderToSidebar:f1").enabled, true);
  assert.equal(find(items, "openExtension:ext").title, "uBlock");
});

test("empty lists show a disabled placeholder and single profiles hide profile menus", () => {
  const items = appMenuItems(state({ profiles: [{ id: "p1", title: "Personal", current: true }] }));
  const history = top(items, "History").children;
  assert.deepEqual(history.at(-1), { id: "empty", title: "Empty", enabled: false });
  assert.equal(find(items, "menu:Profiles"), undefined);
  assert.equal(find(items, "menu:New Little Ardia Window in Profile"), undefined);
});

test("items show the effective Linux shortcut", () => {
  const items = appMenuItems(state(), new Map([["newTab", { key: "t", modifiers: ["command", "function"] }]]));
  assert.deepEqual(find(items, "newTab"), { id: "newTab", title: "New Tab", enabled: true, checked: false, key: "t", modifiers: ["command"] });
});

test("choices resolve to commands or window actions and ignore structure rows", () => {
  assert.deepEqual(appMenuChoice("newTab"), { kind: "command", command: "newTab", arg: null });
  assert.deepEqual(appMenuChoice("openBookmark:a:b"), { kind: "command", command: "openBookmark", arg: "a:b" });
  assert.deepEqual(appMenuChoice("window:maximize"), { kind: "window", action: "maximize" });
  for (const id of ["menu:File", "header:Recent Bookmarks", "folder:f1", "empty", "window:quit"]) assert.equal(appMenuChoice(id), null);
});
