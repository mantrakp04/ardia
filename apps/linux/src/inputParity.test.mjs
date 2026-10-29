import assert from "node:assert/strict";
import { test } from "node:test";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { activeTabId } from "../../browser/src/state/browser/model.ts";
import { shortcutHint, shortcutOf, resolvedShortcuts, setMenuBarShortcuts, menuShortcut } from "../../browser/src/state/commands/commandShortcuts.ts";
import { formatShortcut, comboKey, sameShortcut } from "../../browser/src/state/commands/shortcuts.ts";
import { shortcutSources } from "../../browser/src/state/commands/commandCatalog.ts";
import { menuShortcuts } from "../../browser/src/platform/commands.ts";
import { modifiersOf } from "../../browser/src/lib/keys.ts";
import { openModeFor, openUrl } from "./rawBookmarkActions.ts";
import { primaryModifiers } from "./clickModifiers.ts";
import { keyboardCombo, linuxBindings, linuxMenuShortcuts, linuxNativeBindings } from "./shortcuts.ts";

const state = () => useBrowser.getState();
const reset = () => state().hydrate({});
const event = (mods = {}) => ({ nativeEvent: { metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods } });
const keyboard = (code, mods = {}) => ({ code, key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
const bindingAt = (bindings, combo) => bindings.find((binding) => binding.keyCode === combo.keyCode && binding.modifiers === combo.flags);
const setOverrides = (shortcuts) => state().updateSettings({ shortcuts });

function assertCatalog() {
  const s = state();
  const items = linuxMenuShortcuts(s.settings.shortcuts, s.profileOrder);
  const bindings = linuxBindings(s.settings.shortcuts, s.profileOrder);
  const resolved = resolvedShortcuts(s);
  for (const source of shortcutSources(s.profileOrder, Object.keys(s.settings.shortcuts))) {
    const item = items.find((item) => item.id === source.id);
    const effective = resolved.bindings.get(source.id)?.[0];
    assert.equal(shortcutHint(source.id, s), effective && formatShortcut(effective), source.id);
    assert.deepEqual({ key: item.defaultKey, modifiers: item.defaultModifiers }, source.keys[0] ?? { key: "", modifiers: [] }, source.id);
    assert.deepEqual({ key: item.key, modifiers: item.modifiers }, effective ?? { key: "", modifiers: [] }, source.id);
    for (const shortcut of resolved.bindings.get(source.id) ?? []) {
      const combo = keyboardCombo(keyboard("", { key: shortcut.key, ctrlKey: shortcut.modifiers.includes("command"), metaKey: shortcut.modifiers.includes("control"), altKey: shortcut.modifiers.includes("option"), shiftKey: shortcut.modifiers.includes("shift") }));
      const binding = bindingAt(bindings, combo);
      assert.equal(binding?.command + (binding?.arg ? `:${binding.arg}` : ""), source.id, source.id);
      const holders = resolved.holdersOf(shortcut);
      assert.ok(holders.includes(source.id));
    }
  }
  for (const binding of bindings) {
    const id = binding.command + (binding.arg ? `:${binding.arg}` : "");
    const shortcuts = resolved.bindings.get(id);
    assert.ok(shortcuts?.length, id);
  }
  assert.equal(new Set(bindings.map((binding) => `${binding.keyCode}:${binding.modifiers}`)).size, bindings.length);
  assert.deepEqual(items.filter((item) => resolved.conflictsOf(item.id).length), []);
}

test("current shared hints, Settings defaults and aliases, conflicts and Linux dispatch share one catalog before and after Settings loads", async () => {
  reset();
  const profile = state().profileOrder[0];
  for (const [id, hint, code, mods] of [
    ["downloads", "Ctrl+J", "KeyJ", { ctrlKey: true }],
    ["devTools", "Ctrl+Shift+I", "KeyI", { ctrlKey: true, shiftKey: true }],
    ["tabSwitcher:forward", "Ctrl+Tab", "Tab", { ctrlKey: true }],
    ["tabSwitcher:backward", "Ctrl+Shift+Tab", "Tab", { ctrlKey: true, shiftKey: true }],
    [`switchProfile:${profile}`, "Super+1", "Digit1", { metaKey: true }],
  ]) {
    assert.equal(shortcutHint(id), hint);
    const binding = bindingAt(linuxBindings({}, state().profileOrder), keyboardCombo(keyboard(code, mods)));
    assert.equal(binding.command + (binding.arg ? `:${binding.arg}` : ""), id);
  }
  assertCatalog();
  const items = await menuShortcuts();
  assert.ok(items.some((item) => item.id === `switchProfile:${profile}`));
  setMenuBarShortcuts(items);
  assertCatalog();
});

test("recorded physical Ctrl and Super use semantic identities consistently for hints, native flags, displacement, disable and reset", () => {
  reset();
  const combo = keyboardCombo(keyboard("KeyJ", { ctrlKey: true }));
  assert.deepEqual(combo.modifiers, ["command"]);
  setOverrides({ focusCommandBar: [combo.key, ...combo.modifiers] });
  assert.equal(shortcutHint("focusCommandBar"), "Ctrl+J");
  assert.equal(shortcutHint("downloads"), "Ctrl+Alt+L");
  assert.deepEqual(menuShortcut("focusCommandBar"), { key: "j", modifiers: ["command"] });
  assert.equal(bindingAt(linuxBindings(state().settings.shortcuts), combo).command, "focusCommandBar");
  assert.equal(bindingAt(linuxNativeBindings(linuxBindings(state().settings.shortcuts)), keyboardCombo(keyboard("KeyL", { ctrlKey: true }))).suppressed, true);
  assertCatalog();
  setOverrides({ focusCommandBar: ["k", "control"], toggleSidebar: [""] });
  assert.equal(shortcutHint("focusCommandBar"), "Super+K");
  assert.equal(bindingAt(linuxBindings(state().settings.shortcuts), keyboardCombo(keyboard("KeyK", { metaKey: true }))).command, "focusCommandBar");
  assert.equal(shortcutHint("toggleSidebar"), undefined);
  assert.equal(bindingAt(linuxNativeBindings(linuxBindings(state().settings.shortcuts)), keyboardCombo(keyboard("KeyS", { ctrlKey: true }))).suppressed, true);
  assertCatalog();
  setOverrides({});
  assert.equal(shortcutHint("downloads"), "Ctrl+J");
  assert.equal(shortcutHint("focusCommandBar"), "Ctrl+L");
  assertCatalog();
});

test("duplicate custom shortcuts report both holders and use deterministic native dispatch", () => {
  reset();
  setOverrides({ downloads: ["q", "command"], devTools: ["q", "command"] });
  const resolved = resolvedShortcuts(state());
  assert.deepEqual(resolved.conflictsOf("downloads"), ["devTools"]);
  assert.deepEqual(resolved.conflictsOf("devTools"), ["downloads"]);
  const combo = keyboardCombo(keyboard("KeyQ", { ctrlKey: true }));
  assert.equal(bindingAt(linuxBindings(state().settings.shortcuts), combo).command, resolved.holdersOf(shortcutOf("downloads"))[0]);
});

test("profile reorder, addition and removal refresh the loaded catalog and obsolete overrides do not displace defaults", () => {
  reset();
  setMenuBarShortcuts(linuxMenuShortcuts({}, state().profileOrder));
  const original = state().profileOrder[0];
  const added = state().createProfile({ name: "Input fixture" });
  assert.equal(shortcutHint(`switchProfile:${added}`), "Super+2");
  state().reorderProfiles([added, original]);
  assert.equal(shortcutHint(`switchProfile:${added}`), "Super+1");
  assert.equal(bindingAt(linuxBindings({}, state().profileOrder), keyboardCombo(keyboard("Digit1", { metaKey: true }))).arg, added);
  state().deleteProfile(added);
  setOverrides({ [`switchProfile:${added}`]: ["t", "command"] });
  assert.equal(shortcutHint("newTab"), "Ctrl+T");
  assert.equal(shortcutHint(`switchProfile:${added}`), undefined);
  assertCatalog();
});

test("shifted aliases normalize before conflicts and punctuation recording roundtrips", () => {
  reset();
  const combo = keyboardCombo(keyboard("Semicolon", { ctrlKey: true, shiftKey: true }));
  assert.equal(combo.key, ";");
  setOverrides({ downloads: [combo.key, ...combo.modifiers] });
  assert.equal(bindingAt(linuxBindings(state().settings.shortcuts), combo).command, "downloads");
  assert.equal(shortcutHint("downloads"), "Ctrl+Shift+;");
  const sources = shortcutSources([], []);
  for (const source of sources) {
    const combos = source.keys.map(comboKey);
    if (["openSplitPane", "focusNextPane", "focusPreviousPane"].includes(source.id)) assert.equal(new Set(combos).size, 1);
  }
  const defaults = linuxMenuShortcuts().find((item) => item.id === "devTools");
  assert.ok(sameShortcut(keyboardCombo(keyboard("KeyI", { ctrlKey: true, shiftKey: true })), { key: defaults.defaultKey, modifiers: defaults.defaultModifiers }));
});

test("Linux menu labels use physical names for Tab, function keys, Super and Ctrl, and Ctrl alone reveals command alternates", () => {
  assert.equal(formatShortcut({ key: "\t", modifiers: ["command", "shift"] }), "Ctrl+Shift+Tab");
  assert.equal(formatShortcut({ key: String.fromCharCode(0xf709), modifiers: [] }), "F6");
  assert.equal(formatShortcut({ key: "1", modifiers: ["control"] }), "Super+1");
  assert.equal(primaryModifiers({ ctrlKey: true }).metaKey, true);
  assert.equal(primaryModifiers({ metaKey: true }).metaKey, false);
});

for (const layout of ["sidebar", "top"]) {
  test(`${layout}: Ctrl toggles selection, Ctrl+Shift retains toggle semantics, Shift ranges and ordinary activation survive`, () => {
    reset();
    state().updateSettings({ tabLayout: layout });
    const windowId = state().createWindow({ url: "https://one.test" });
    const first = state().windows[windowId].tabIds[0];
    const second = state().newTab(windowId, { url: "https://two.test", background: true });
    const third = state().newTab(windowId, { url: "https://three.test", background: true });
    state().clickTab(windowId, second, modifiersOf(event({ ctrlKey: true })));
    assert.deepEqual(state().selection[windowId], [first, second]);
    assert.equal(activeTabId(state(), windowId), first);
    state().clickTab(windowId, third, modifiersOf(event({ ctrlKey: true, shiftKey: true })));
    assert.deepEqual(state().selection[windowId], [first, second, third]);
    state().clickTab(windowId, second, modifiersOf(event({ ctrlKey: true })));
    assert.deepEqual(state().selection[windowId], [first, third]);
    state().clickTab(windowId, first, modifiersOf(event()));
    state().clickTab(windowId, third, modifiersOf(event({ shiftKey: true })));
    assert.deepEqual(state().selection[windowId], [first, second, third]);
    state().clickTab(windowId, second, modifiersOf(event({ metaKey: true })));
    assert.deepEqual(state().selection[windowId], []);
    assert.equal(activeTabId(state(), windowId), second);
  });
}

for (const [mods, mode] of [
  [{ ctrlKey: true }, "background"], [{ ctrlKey: true, shiftKey: true }, "foreground"],
  [{ shiftKey: true }, "window"], [{ middle: true }, "background"], [{ middle: true, shiftKey: true }, "foreground"],
  [{}, "current"], [{ metaKey: true }, "current"], [{ altKey: true }, "split"],
]) {
  test(`bookmark ${JSON.stringify(mods)} opens ${mode} and preserves source identity`, () => {
    reset();
    const windowId = state().createWindow({ url: "https://source.test" });
    const source = activeTabId(state(), windowId);
    const physical = { ...mods };
    assert.equal(openModeFor(physical), mode);
    assert.deepEqual(physical, mods);
    openUrl("https://bookmark.test", windowId, openModeFor(physical));
    if (mode === "split") {
      assert.equal(Object.keys(state().splits).length, 1);
      assert.equal(state().tabs[source].url, "https://source.test");
    } else if (mode === "window") {
      assert.equal(state().windowOrder.length, 2);
      assert.equal(activeTabId(state(), windowId), source);
    } else if (mode === "current") {
      assert.equal(state().windows[windowId].tabIds.length, 1);
      assert.equal(state().tabs[source].navigation.url, "https://bookmark.test");
    } else {
      assert.equal(state().windows[windowId].tabIds.length, 2);
      assert.equal(state().tabs[source].url, "https://source.test");
      assert.equal(activeTabId(state(), windowId) === source, mode === "background");
    }
  });
}
