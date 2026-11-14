import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const windowsKeys = await import("./windowsKeys.ts");
const windowsNotation = await import("./keyNotation.windows.ts");
const macNotation = await import("./keyNotation.ts");
const { keyText } = await import("./keyText.ts");
const { windowsKeyText } = await import("./windowsKeyText.ts");
const { comboKey } = await import("./shortcuts.ts");
const { COMMANDS, staticShortcutSources } = await import("./commandCatalog.ts");
const windowsShortcuts = await import("./shortcuts.ts");

const { WINDOWS_KEYS, formatWindowsShortcut, parseWindowsShortcut, windowsDefaultKeys } = windowsKeys;

function nativeRows() {
  const table = readFileSync(new URL("../../../windows/Ardia/CommandTable.h", import.meta.url), "utf8");
  const rows = table.slice(table.indexOf("kCommandRows[]"), table.indexOf("kSystemRows[]"));
  const unescape = (text) => text.replace(/\\\\/g, "\\");
  return [...rows.matchAll(/\{"([^"]*)", "(?:[^"\\]|\\.)*"(?: ARDIA_ELLIPSIS)?, "[^"]*", "((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"/g)]
    .filter((m) => m[1])
    .map((m) => ({ id: m[1], mac: unescape(m[2]), windows: unescape(m[3]) }));
}
const NATIVE_MODIFIERS = { cmd: "command", option: "option", ctrl: "control", shift: "shift", fn: "function" };
const macFromNative = (part) => {
  const parts = part.split("+");
  const key = parts.pop();
  return { key: parseWindowsShortcut(key).key, modifiers: parts.map((p) => NATIVE_MODIFIERS[p]) };
};
const nativeCombos = (list) => list.split("|").filter((part) => part && part !== "none").map((part) => comboKey(parseWindowsShortcut(part)));

test("the Windows defaults are exactly the Windows column of CommandTable.h", () => {
  const rows = nativeRows();
  assert.ok(rows.length > 100);
  const native = new Map(rows.map((row) => [row.id, nativeCombos(row.windows)]));
  for (const [id, combos] of native) assert.deepEqual(windowsDefaultKeys(id).map((k) => comboKey(parseWindowsShortcut(k))), combos, id);
  const positions = new Map(rows.map((row) => [row.id, row.windows.split("|").filter(Boolean).map((part) => (part === "none" ? null : comboKey(parseWindowsShortcut(part))))]));
  for (const [id, keys] of Object.entries(WINDOWS_KEYS)) assert.deepEqual(keys.map((k) => (k === null ? null : comboKey(parseWindowsShortcut(k)))), positions.get(id), id);
  for (const id of Object.keys(WINDOWS_KEYS)) assert.ok(native.has(id), `${id} is not a CommandTable.h row`);
});

test("every command with a Mac key that Windows lists has a Windows entry", () => {
  const listed = new Set(nativeRows().map((row) => row.id));
  const missing = staticShortcutSources().filter((s) => listed.has(s.id) && s.keys.length && !Object.hasOwn(WINDOWS_KEYS, s.id)).map((s) => s.id);
  assert.deepEqual(missing, []);
});

test("no two commands share a Windows default", () => {
  const holders = new Map();
  for (const [id, keys] of Object.entries(WINDOWS_KEYS)) {
    for (const key of keys.filter((k) => k !== null)) holders.set(comboKey(parseWindowsShortcut(key)), [...(holders.get(comboKey(parseWindowsShortcut(key))) ?? []), id]);
  }
  for (let n = 1; n <= 9; n++) {
    const key = comboKey(parseWindowsShortcut(windowsKeys.windowsProfileSwitchKey(n)));
    holders.set(key, [...(holders.get(key) ?? []), `switchProfile:${n}`]);
  }
  assert.deepEqual([...holders].filter(([, ids]) => ids.length > 1), []);
});

test("Windows shortcuts read and print the way the native menus print them", () => {
  for (const keys of Object.values(WINDOWS_KEYS)) for (const key of keys) if (key !== null) assert.equal(formatWindowsShortcut(parseWindowsShortcut(key)), key);
  assert.deepEqual(parseWindowsShortcut("Ctrl+Shift+T"), { key: "t", modifiers: ["control", "shift"] });
  assert.deepEqual(parseWindowsShortcut("ctrl+alt+shift+c"), { key: "c", modifiers: ["control", "option", "shift"] });
  assert.deepEqual(parseWindowsShortcut("Ctrl++"), { key: "+", modifiers: ["control"] });
  assert.equal(formatWindowsShortcut({ key: "", modifiers: ["control", "shift"] }), "Ctrl+Shift+PgDn");
  assert.equal(formatWindowsShortcut({ key: "", modifiers: [] }), "F11");
  assert.equal(formatWindowsShortcut({ key: "", modifiers: [] }), "F24");
  assert.equal(formatWindowsShortcut({ key: "t", modifiers: ["shift", "command"] }), "Ctrl+Shift+T");
  assert.equal(formatWindowsShortcut({ key: "", modifiers: ["control"] }), "");
});

test("Windows still reads a shortcut written in Mac glyphs, Command as Ctrl", () => {
  assert.deepEqual(parseWindowsShortcut("⇧⌘T"), { key: "t", modifiers: ["control", "shift"] });
  assert.deepEqual(parseWindowsShortcut("⌥⌘I"), { key: "i", modifiers: ["control", "option"] });
  assert.deepEqual(parseWindowsShortcut("⌘+"), { key: "+", modifiers: ["control"] });
  assert.deepEqual(parseWindowsShortcut("⇥"), { key: "\t", modifiers: [] });
  assert.deepEqual(parseWindowsShortcut("F5"), { key: "", modifiers: [] });
});

test("the Windows notation module gives Alt+1 to Alt+9 to profiles and Ctrl as the menu alternate", () => {
  assert.equal(windowsNotation.profileSwitchKey(1), "Alt+1");
  assert.equal(windowsNotation.ALTERNATE_MODIFIER, "control");
  assert.equal(windowsNotation.formatShortcut({ key: "t", modifiers: ["control"] }), "Ctrl+T");
  assert.deepEqual(windowsNotation.defaultKeys("newTab", ["⌘T"]), ["Ctrl+T"]);
  assert.deepEqual(windowsNotation.defaultKeys("std:quit:", ["⌘Q"]), []);
});

test("the Mac notation is unchanged: glyphs, Mac defaults, ⌃1 for profiles, Command as the menu alternate", () => {
  assert.equal(macNotation.formatShortcut({ key: "t", modifiers: ["shift", "command"] }), "⇧⌘T");
  assert.deepEqual(macNotation.parseShortcut("⌥⇧⌘C"), { key: "c", modifiers: ["option", "shift", "command"] });
  assert.equal(macNotation.profileSwitchKey(1), "⌃1");
  assert.equal(macNotation.ALTERNATE_MODIFIER, "command");
  assert.deepEqual(macNotation.defaultKeys("newTab", COMMANDS.newTab.keys), ["⌘T"]);
  assert.deepEqual(macNotation.defaultKeys("duplicateTab", undefined), []);
  assert.equal(keyText("⇧⌘W"), "⇧⌘W");
  assert.equal(keyText("⌥⇧"), "⌥⇧");
});

test("Windows prose names each Mac shortcut by the Windows key of the same command", () => {
  const cases = {
    "⌘T": "Ctrl+T",
    "⌘L": "Ctrl+L",
    "⌘S": "Ctrl+S",
    "⌘,": "Ctrl+,",
    "⌘Y": "Ctrl+H",
    "⌥⌘B": "Ctrl+Shift+O",
    "⌃⇧=": "Ctrl+\\",
    "⌃⇧]": "Alt+Shift+]",
    "⇧⌘W": "Ctrl+Shift+W",
    "⌘+": "Ctrl+Plus",
    "⌘-": "Ctrl+-",
    "⌘Z": "Ctrl+Z",
    "⌘Q": "Alt+F4",
    "⌃1": "Alt+1",
    "⌃9": "Alt+9",
    "⌃Tab": "Ctrl+Tab",
    "⌘": "Ctrl",
    "⌥": "Alt",
    "⇧": "Shift",
    "⌥⇧": "Alt+Shift",
    "⌥⌘": "Ctrl+Alt",
  };
  for (const [mac, windows] of Object.entries(cases)) assert.equal(windowsKeyText(mac), windows, mac);
});

test("on Windows a synced Mac override with Command reads as Ctrl, so it takes Ctrl+T from New Tab", () => {
  const { resolveShortcuts } = windowsShortcuts;
  const sources = [
    { id: "newTab", keys: [parseWindowsShortcut("Ctrl+T")] },
    { id: "closeTab", keys: [parseWindowsShortcut("Ctrl+W")] },
  ];
  const resolved = resolveShortcuts(sources, { closeTab: ["t", "command"] }, windowsNotation.storedModifiers);
  assert.deepEqual(resolved.bindings.get("closeTab"), [{ key: "t", modifiers: ["control"] }]);
  assert.deepEqual(resolved.bindings.get("newTab"), []);
  assert.deepEqual(windowsNotation.storedModifiers(["command", "function", "shift"]), ["control", "shift"]);
});

test("the Mac keeps a stored override's modifiers as they are", () => {
  assert.deepEqual(macNotation.storedModifiers(["command", "function", "control"]), ["command", "function", "control"]);
  const sources = [
    { id: "newTab", keys: [macNotation.parseShortcut("⌘T")] },
    { id: "closeTab", keys: [macNotation.parseShortcut("⌘W")] },
  ];
  const resolved = windowsShortcuts.resolveShortcuts(sources, { closeTab: ["t", "command", "function"] });
  assert.deepEqual(resolved.bindings.get("closeTab"), [{ key: "t", modifiers: ["command", "function"] }]);
  assert.deepEqual(resolved.bindings.get("newTab"), [{ key: "t", modifiers: ["command"] }]);
});

test("Windows prose pairs each Mac alias with the Windows key at the same place in the native table", () => {
  const cases = {
    "⇧⌘L": "Ctrl+Shift+L",
    "⇧⌘F": "Ctrl+Shift+F",
    "⌘[": "Ctrl+[",
    "⌘←": "Alt+Left",
    "⌘}": "Ctrl+}",
    "⌘=": "Ctrl+=",
    "⌥⌘L": "Ctrl+Alt+L",
    "⌥⌘↓": "Ctrl+Alt+Down",
  };
  for (const [mac, windows] of Object.entries(cases)) assert.equal(windowsKeyText(mac), windows, mac);
});

test("Windows prose reads a Unicode minus as the zoom-out hyphen", () => {
  assert.equal(windowsKeyText("⌘−"), "Ctrl+-");
  assert.equal(keyText("⌘−"), "⌘−");
});

test("the native table's Mac column lists each command's Mac keys in the catalog's order", () => {
  const macKeys = new Map(staticShortcutSources().map((s) => [s.id, s.keys.map(comboKey)]));
  for (const row of nativeRows()) {
    const native = row.mac.split("|").filter(Boolean).map((part) => comboKey(macFromNative(part)));
    if (macKeys.has(row.id) && native.length) assert.deepEqual(native, macKeys.get(row.id), row.id);
  }
});

test("names that Object.prototype carries are never read as keys or modifiers", () => {
  for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
    assert.equal(typeof parseWindowsShortcut(`${name}+t`).key, "string", name);
    assert.ok(parseWindowsShortcut(`${name}+t`).modifiers.every((m) => typeof m === "string"), name);
    assert.equal(typeof windowsKeys.windowsKeyName(name), "string", name);
  }
});
