import assert from "node:assert/strict";
import { test } from "node:test";
const { menuBarRevision, menuCommandAlternate, menuShortcut, resolvedShortcuts, setMenuBarShortcuts, shortcutHint } = await import("./commandShortcuts.ts");

const state = (shortcuts, profileOrder = ["work", "home"]) => ({ settings: { shortcuts }, profileOrder });
const item = (id, defaultKey, defaultModifiers, remappable = true) => ({ id, title: id, path: [], key: defaultKey, modifiers: defaultModifiers, defaultKey, defaultModifiers, remappable, aliases: [] });

test("hints follow a rebinding and drop the default it took", () => {
  const s = state({ closeTab: ["t", "command"] });
  assert.equal(shortcutHint("closeTab", s), "⌘T");
  assert.equal(shortcutHint("newTab", s), undefined);
  assert.deepEqual(menuShortcut("closeTab", s), { key: "t", modifiers: ["command"] });
  assert.deepEqual(menuShortcut("newTab", s), {});
});

test("profiles keep ⌃1 and ⌃2 in their order, and a deleted profile's override takes nothing", () => {
  assert.equal(shortcutHint("switchProfile:home", state({})), "⌃2");
  const s = state({ "switchProfile:gone": ["t", "command"] });
  assert.equal(shortcutHint("newTab", s), "⌘T");
});

test("a function-key binding isn't offered to context menus, which can't show it", () => {
  assert.deepEqual(menuShortcut("closeTab", state({ closeTab: ["w", "function"] })), {});
});

test("once the menu bar list is known, an extension item it no longer lists takes nothing", () => {
  const overrides = { "openExtension:gone": ["t", "command"], "openExtension:here": ["w", "command"] };
  assert.equal(shortcutHint("newTab", state(overrides)), undefined);
  setMenuBarShortcuts([item("newTab", "t", ["command"]), item("closeTab", "w", ["command"]), item("openExtension:here", "", [])]);
  const s = state(overrides);
  assert.equal(shortcutHint("newTab", s), "⌘T");
  assert.equal(shortcutHint("openExtension:here", s), "⌘W");
  assert.equal(shortcutHint("closeTab", s), undefined);
});

test("the menu bar's fixed system items count for conflicts", () => {
  setMenuBarShortcuts([item("duplicateTab", "", []), item("system:Edit > Emoji & Symbols", "e", ["control", "command"], false)]);
  const resolved = resolvedShortcuts(state({ duplicateTab: ["e", "control", "command"] }));
  assert.deepEqual(resolved.conflictsOf("duplicateTab"), ["system:Edit > Emoji & Symbols"]);
});

const menu = (...extra) => [item("newTab", "t", ["command"]), item("closeTab", "w", ["command"]), item("switchProfile:work", "1", ["control"]), ...extra];

test("a newer menu bar snapshot without the extension gives New Tab its ⌘T back, and says so", () => {
  const s = state({ "openExtension:x": ["t", "command"] });
  setMenuBarShortcuts(menu(item("openExtension:x", "", [])));
  assert.equal(shortcutHint("newTab", s), undefined);
  const revision = menuBarRevision();
  setMenuBarShortcuts(menu());
  assert.equal(menuBarRevision(), revision + 1);
  assert.equal(shortcutHint("newTab", s), "⌘T");
});

test("an override on an item this build's menu bar doesn't have takes nothing", () => {
  setMenuBarShortcuts(menu());
  assert.equal(shortcutHint("newTab", state({ showOnboarding: ["t", "command"] })), "⌘T");
});

test("a profile's ↗ alternate goes when its ⌘ keys are another binding or its shortcut has ⌘", () => {
  setMenuBarShortcuts(menu());
  assert.deepEqual(menuCommandAlternate("switchProfile:work", state({})), { key: "1", modifiers: ["control", "command"] });
  assert.equal(menuCommandAlternate("switchProfile:work", state({ "switchProfile:work": ["k", "control"], closeTab: ["k", "control", "command"] })), null);
  assert.equal(menuCommandAlternate("switchProfile:work", state({ "switchProfile:work": ["k", "command"] })), null);
  assert.deepEqual(menuCommandAlternate("switchProfile:work", state({ "switchProfile:work": [""] })), { modifiers: ["command"] });
});
