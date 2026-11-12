import assert from "node:assert/strict";
import { test } from "node:test";
const { menuBarBindings, menuBarRevision, menuCommandAlternate, menuShortcut, resolvedShortcuts, setMenuBarShortcuts, shortcutHint } = await import("./commandShortcuts.ts");

const state = (shortcuts, profileOrder = ["work", "home"]) => ({ settings: { shortcuts }, profileOrder });
const item = (id, key, modifiers, remappable = true) => (remappable ? { id, title: id, path: [], remappable } : { id, title: id, path: [], remappable, key, modifiers });

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

test("the menu bar gets every binding resolved, so it shows what Settings and the hints show", () => {
  setMenuBarShortcuts([item("newTab", "t", ["command"]), item("toggleSidebar", "s", ["command"]), item("findInPage", "f", ["command"]), item("nextTab", "]", ["shift", "command"]), item("reload", "r", ["command"]), item("switchProfile:home", "", []), item("system:Edit > Emoji & Symbols", "e", ["control", "command"], false)]);
  const bindings = menuBarBindings(state({ newTab: ["s", "command"], findInPage: ["L", "command"], nextTab: ["}", "command"], reload: [""] }));
  assert.deepEqual(bindings.newTab, [["s", "command"]]);
  assert.deepEqual(bindings.toggleSidebar, [["f", "shift", "command"]]);
  assert.deepEqual(bindings.findInPage, [["l", "shift", "command"]]);
  assert.deepEqual(bindings.nextTab, [["}", "command"]]);
  assert.deepEqual(bindings.reload, []);
  assert.equal(bindings["system:Edit > Emoji & Symbols"], undefined);
  assert.deepEqual(bindings["switchProfile:home"], [["2", "control"]]);
  assert.deepEqual(bindings["newWindow:home"], [["2", "control", "command"]]);
  assert.deepEqual(menuBarBindings(state({ "switchProfile:home": ["k", "command"] }))["newWindow:home"], []);
});

test("a profile bound with fn keeps its ↗ shortcut in the menu bar, and a ⌘fn binding has no ↗ shortcut", () => {
  setMenuBarShortcuts([item("switchProfile:work", "", []), item("switchProfile:home", "", [])]);
  assert.deepEqual(menuBarBindings(state({ "switchProfile:home": ["k", "control", "function"] }))["newWindow:home"], [["k", "control", "function", "command"]]);
  assert.deepEqual(menuBarBindings(state({ "switchProfile:home": ["k", "command", "function"] }))["newWindow:home"], []);
  assert.equal(menuCommandAlternate("switchProfile:home", state({ "switchProfile:home": ["k", "command", "function"] })), null);
  assert.deepEqual(menuCommandAlternate("switchProfile:home", state({ "switchProfile:home": ["k", "control", "function"] })), { modifiers: ["command"] });
});

test("a remappable item's default comes from the catalog, a fixed one's from the menu bar", () => {
  setMenuBarShortcuts([item("toggleSidebar", "s", ["command"]), item("switchProfile:work", "", []), item("system:Edit > Emoji & Symbols", "e", ["control", "command"], false)]);
  const resolved = resolvedShortcuts(state({}));
  assert.deepEqual(resolved.defaultsOf("toggleSidebar").map((k) => k.key), ["s", "l", "f"]);
  assert.deepEqual(resolved.defaultsOf("switchProfile:work"), [{ key: "1", modifiers: ["control"] }]);
  assert.deepEqual(resolved.defaultsOf("system:Edit > Emoji & Symbols"), [{ key: "e", modifiers: ["control", "command"] }]);
});
