import assert from "node:assert/strict";
import { test } from "node:test";
import { keyboardCombo, linuxBindings, linuxMenuShortcuts, linuxNativeBindings, recordableShortcut, utilityBindings } from "./shortcuts.ts";

const commandAt = (bindings, keyCode, modifiers) => bindings.find((binding) => binding.keyCode === keyCode && binding.modifiers === modifiers);
const event = (code, modifiers = {}) => ({ code, key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers });

test("Settings exposes the Linux bindings with their defaults and aliases", () => {
  const items = linuxMenuShortcuts();
  assert(items.length > 60);
  assert.equal(items.find((item) => item.id === "newTab").defaultKey, "t");
  assert.deepEqual(items.find((item) => item.id === "focusCommandBar").defaultModifiers, ["command"]);
  assert(items.find((item) => item.id === "toggleSidebar").aliases.length > 0);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
});

test("physical Linux Control reaches the native new-tab and address-bar commands", () => {
  const bindings = linuxBindings();
  for (const [code, command] of [["KeyT", "newTab"], ["KeyL", "focusCommandBar"], ["Comma", "openSettings"]]) {
    const combo = keyboardCombo(event(code, { ctrlKey: true }));
    assert.equal(commandAt(bindings, combo.keyCode, combo.flags)?.command, command);
  }
  assert.equal(keyboardCombo(event("KeyL", { metaKey: true })).flags, 16);
});

test("Ctrl+Tab and Ctrl+Shift+Tab retain their direction", () => {
  const bindings = linuxBindings();
  assert.equal(commandAt(bindings, 9, 4)?.arg, "forward");
  assert.equal(commandAt(bindings, 9, 6)?.arg, "backward");
  assert.equal(commandAt(bindings, 34, 4)?.command, "nextTab");
});

test("a custom binding takes priority over another command's defaults", () => {
  const bindings = linuxBindings({ focusCommandBar: ["t", "command"] });
  assert.equal(commandAt(bindings, 84, 4)?.command, "focusCommandBar");
  assert(!commandAt(bindings, 76, 4));
  assert.equal(bindings.filter((binding) => binding.keyCode === 84 && binding.modifiers === 4).length, 1);
});

test("remapping and disabling remove every alias, and resetting restores them", () => {
  const bindings = linuxBindings({ toggleSidebar: ["q", "command", "shift"], newTab: [""] });
  assert.equal(commandAt(bindings, 81, 6)?.command, "toggleSidebar");
  assert(!commandAt(bindings, 83, 4));
  assert(!commandAt(bindings, 76, 6));
  assert(!commandAt(bindings, 84, 4));
  assert.equal(commandAt(linuxBindings(), 83, 4)?.command, "toggleSidebar");
});

test("numbered profile commands use native profile identities and skip missing profiles", () => {
  const bindings = linuxBindings({}, ["work", "personal"]);
  assert.equal(commandAt(bindings, 49, 16)?.arg, "work");
  assert.equal(commandAt(bindings, 50, 16)?.arg, "personal");
  assert(!commandAt(bindings, 51, 16));
});

test("function-key bindings record and dispatch without modifiers", () => {
  const combo = keyboardCombo(event("F6"));
  const binding = commandAt(linuxBindings({ focusCommandBar: [combo.key] }), combo.keyCode, combo.flags);
  assert.equal(binding?.command, "focusCommandBar");
  assert.equal(binding?.keyCode, 117);
});

test("the recorder takes Ctrl, Super and Alt combinations and function keys, as Chromium on Linux does; Shift, AltGr and bare keys alone are refused", () => {
  const typed = (code, key, modifiers) => ({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers });
  for (const accepted of [typed("KeyK", "k", { ctrlKey: true }), typed("KeyK", "k", { metaKey: true }), typed("KeyU", "U", { altKey: true, shiftKey: true }), typed("KeyK", "k", { altKey: true }), typed("F6", "F6", {})]) {
    assert.equal(recordableShortcut(accepted), true, JSON.stringify(accepted));
  }
  for (const refused of [typed("KeyK", "K", { shiftKey: true }), typed("KeyK", "k", {}), typed("KeyQ", "@", {}), typed("AltLeft", "Alt", { altKey: true }), typed("ShiftLeft", "Shift", { shiftKey: true, altKey: true })]) {
    assert.equal(recordableShortcut(refused), false, JSON.stringify(refused));
  }
  const combo = keyboardCombo(typed("KeyU", "U", { altKey: true, shiftKey: true }));
  assert.deepEqual([combo.key, combo.modifiers], ["u", ["option", "shift"]]);
  const binding = commandAt(linuxBindings({ duplicateTab: [combo.key, ...combo.modifiers] }), combo.keyCode, combo.flags);
  assert.equal(binding?.command, "duplicateTab");
  assert.deepEqual([binding.keyCode, binding.modifiers], [85, 10]);
});

test("obsolete overrides do not steal current default bindings", () => {
  assert.equal(commandAt(linuxBindings({ removedCommand: ["t", "command"] }), 84, 4)?.command, "newTab");
});

test("displaced defaults remain registered to consume Chromium's accelerators", () => {
  const active = linuxBindings({ newTab: [""], focusCommandBar: ["q", "command"] });
  const native = linuxNativeBindings(active);
  assert.equal(commandAt(native, 84, 4)?.suppressed, true);
  assert.equal(commandAt(native, 76, 4)?.suppressed, true);
  assert.equal(commandAt(native, 81, 4)?.command, "focusCommandBar");
  assert(!commandAt(native, 81, 4)?.suppressed);
});

test("utility windows consume browser shortcuts they cannot perform", () => {
  const active = linuxBindings().filter((binding) => ["closeTab", "openSettings", "findInPage"].includes(binding.command));
  assert.equal(commandAt(linuxNativeBindings(active), 84, 4)?.suppressed, true);
});

test("utility windows keep the help shortcuts a browser window plays, so Show Onboarding works from Settings", () => {
  const combo = keyboardCombo(event("KeyO", { ctrlKey: true, altKey: true }));
  const bindings = utilityBindings(linuxBindings({ showOnboarding: ["o", "command", "option"] }));
  assert.equal(commandAt(bindings, combo.keyCode, combo.flags)?.command, "showOnboarding");
  assert.equal(commandAt(utilityBindings(linuxBindings()), 84, 4), undefined);
  assert.equal(commandAt(utilityBindings(linuxBindings()), 87, 4)?.command, "closeTab");
});

test("Ctrl+J dispatches the advertised Downloads command", () => {
  assert.equal(commandAt(linuxBindings(), 74, 4)?.command, "downloads");
});

test("Ctrl+Shift+Q quits Ardia and Settings lists it as a remappable Ardia shortcut", () => {
  const combo = keyboardCombo(event("KeyQ", { ctrlKey: true, shiftKey: true }));
  const binding = commandAt(linuxBindings(), combo.keyCode, combo.flags);
  assert.equal(binding?.command, "quit");
  assert.equal(binding?.arg, null);
  assert(!commandAt(linuxBindings(), 81, 4));
  const item = linuxMenuShortcuts().find((entry) => entry.id === "std:quit:");
  assert.equal(item.title, "Quit Ardia");
  assert.deepEqual(item.path, ["Ardia"]);
  assert.equal(item.defaultKey, "q");
  assert.deepEqual([...item.defaultModifiers].sort(), ["command", "shift"]);
  assert.equal(commandAt(linuxBindings({ "std:quit:": ["q", "command", "option"] }), 81, 12)?.command, "quit");
  assert(!commandAt(linuxBindings({ "std:quit:": ["q", "command", "option"] }), 81, 6));
  assert.equal(linuxMenuShortcuts().filter((entry) => entry.id.startsWith("std:")).length, 1);
});

test("Ctrl+Shift+C, Chrome's Inspect Element key, opens Inspect Elements next to Ctrl+Alt+C", () => {
  const bindings = linuxBindings();
  for (const modifiers of [{ ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }]) {
    const combo = keyboardCombo(event("KeyC", modifiers));
    assert.equal(commandAt(bindings, combo.keyCode, combo.flags)?.command, "inspectElements");
  }
  const item = linuxMenuShortcuts().find((entry) => entry.id === "inspectElements");
  assert.equal(item.defaultKey, "c");
  assert.deepEqual([...item.defaultModifiers].sort(), ["command", "shift"]);
  assert.deepEqual(item.aliases, [["c", "option", "command"]]);
  const copy = linuxMenuShortcuts().find((entry) => entry.id === "copyUrl");
  assert.equal(copy.key, "");
  assert.equal(copy.remappable, true);
  const remapped = keyboardCombo(event("KeyU", { ctrlKey: true, shiftKey: true }));
  assert.equal(commandAt(linuxBindings({ copyUrl: ["u", "command", "shift"] }), remapped.keyCode, remapped.flags)?.command, "copyUrl");
});
