import assert from "node:assert/strict";
import { test } from "node:test";
const { comboKey, formatShortcut, parseShortcut, resolveShortcuts } = await import("./shortcuts.ts");

const source = (id, ...keys) => ({ id, keys: keys.map(parseShortcut) });
const menu = [
  source("newTab", "⌘T"),
  source("closeTab", "⌘W"),
  source("reopenClosedTab", "⇧⌘T"),
  source("toggleSidebar", "⌘S", "⇧⌘L"),
  source("duplicateTab"),
  { id: "system:Window > Bring All to Front", keys: [parseShortcut("⌥⌘B")], fixed: true },
];
const hints = (resolved, id) => (resolved.bindings.get(id) ?? []).map(formatShortcut);

test("binding Close Tab to ⌘T takes it from New Tab without a conflict", () => {
  const resolved = resolveShortcuts(menu, { closeTab: ["t", "command"] });
  assert.deepEqual(hints(resolved, "closeTab"), ["⌘T"]);
  assert.deepEqual(hints(resolved, "newTab"), []);
  assert.deepEqual(resolved.conflictsOf("closeTab"), []);
  assert.deepEqual(resolved.conflictsOf("newTab"), []);
});

test("two shortcuts you set to the same keys conflict", () => {
  const resolved = resolveShortcuts(menu, { closeTab: ["t", "command"], duplicateTab: ["t", "command"] });
  assert.deepEqual(resolved.conflictsOf("closeTab"), ["duplicateTab"]);
  assert.deepEqual(resolved.conflictsOf("duplicateTab"), ["closeTab"]);
  assert.deepEqual(hints(resolved, "newTab"), []);
});

test("an override whose menu item is gone takes nothing", () => {
  const resolved = resolveShortcuts(menu, { "switchProfile:deleted": ["t", "command"] });
  assert.deepEqual(hints(resolved, "newTab"), ["⌘T"]);
  assert.equal(resolved.bindings.has("switchProfile:deleted"), false);
});

test("a cleared shortcut has no keys and takes none", () => {
  const resolved = resolveShortcuts(menu, { newTab: [""] });
  assert.deepEqual(hints(resolved, "newTab"), []);
  assert.deepEqual(hints(resolved, "closeTab"), ["⌘W"]);
});

test("a taken alias goes and the rest of the defaults stay", () => {
  const resolved = resolveShortcuts(menu, { duplicateTab: ["l", "shift", "command"] });
  assert.deepEqual(hints(resolved, "toggleSidebar"), ["⌘S"]);
  assert.deepEqual(resolved.conflictsOf("duplicateTab"), []);
});

test("an override replaces every default of its own action", () => {
  const resolved = resolveShortcuts(menu, { toggleSidebar: ["e", "command"] });
  assert.deepEqual(hints(resolved, "toggleSidebar"), ["⌘E"]);
});

test("a fixed system item keeps its keys, so taking them is a conflict", () => {
  const resolved = resolveShortcuts(menu, { duplicateTab: ["b", "option", "command"] });
  assert.deepEqual(hints(resolved, "system:Window > Bring All to Front"), ["⌥⌘B"]);
  assert.deepEqual(resolved.conflictsOf("duplicateTab"), ["system:Window > Bring All to Front"]);
});

test("an uppercase key means shift, as in the menu bar", () => {
  assert.equal(comboKey({ key: "T", modifiers: ["command"] }), comboKey({ key: "t", modifiers: ["shift", "command"] }));
  const resolved = resolveShortcuts(menu, { closeTab: ["T", "command"] });
  assert.deepEqual(hints(resolved, "reopenClosedTab"), []);
});

test("shortcuts print the way Settings shows them and parse back", () => {
  for (const text of ["⌘T", "⇧⌘]", "⌥⇧⌘C", "⌃⇥", "⌘↩", "⇧⌘⌫", "⌃⇟", "F12", "⌃F5", "🌐F", "⌘+", "⌘,"]) {
    assert.equal(formatShortcut(parseShortcut(text)), text);
  }
  assert.deepEqual(parseShortcut("⇧⌘C"), { key: "c", modifiers: ["shift", "command"] });
});
