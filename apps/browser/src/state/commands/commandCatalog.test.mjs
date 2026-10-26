import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const { COMMANDS, shortcutSources, staticShortcutSources } = await import("./commandCatalog.ts");
const { formatShortcut } = await import("./shortcuts.ts");

const swift = ["MainMenu.swift", "MainMenu+Shortcuts.swift"]
  .map((name) => readFileSync(new URL(`../../../../../packages/shell/ios/${name}`, import.meta.url), "utf8"))
  .join("\n");

const FUNCTION_KEYS = {
  NSF5FunctionKey: "",
  NSF7FunctionKey: "",
  NSF12FunctionKey: "",
  NSUpArrowFunctionKey: "",
  NSDownArrowFunctionKey: "",
  NSLeftArrowFunctionKey: "",
  NSRightArrowFunctionKey: "",
  NSPageUpFunctionKey: "",
  NSPageDownFunctionKey: "",
};
const NAMED_KEYS = { leftArrow: "", rightArrow: "" };
const SWIFT_ESCAPES = { "\\t": "\t", "\\r": "\r", "\\u{8}": "\u0008" };

const section = (from, to) => swift.slice(swift.indexOf(from), swift.indexOf(to));
const menuSource = [
  section("static func build() -> NSMenu", "static func keyEquivalent("),
  section("private static func videoTourItem()", "private static func extensionIcon"),
  section("private static func buildProfileMenus", "private static let modifierNames"),
].join("\n");
const dynamicCommands = new Set([...section("private static let dynamicCommands", "private static func walk").matchAll(/"(\w+)"/g)].map((m) => m[1]));

const ITEM = new RegExp(
  [
    String.raw`(cmd|std|CommandItem)\("((?:[^"\\]|\\.)*)",\s*`,
    String.raw`(?:"(\w+)"|(#selector\([^)]*\)\)|MenuTarget\.undoAction|Selector\(\("[^"]+"\)\)))`,
    String.raw`(?:,\s*arg:\s*"((?:[^"\\]|\\.)*)")?`,
    String.raw`(?:,\s*(?:key:\s*)?("(?:[^"\\]|\\.)*"|functionKey\(\w+\)|leftArrow|rightArrow))?`,
    String.raw`(?:,\s*(\.\w+|\[[^\]]*\]))?\)`,
    String.raw`((?:\.\w+\(\))*)`,
  ].join(""),
  "g",
);

function swiftKey(token) {
  if (!token) return "";
  if (token.startsWith('"')) return token.slice(1, -1).replace(/\\t|\\r|\\u\{8\}/g, (e) => SWIFT_ESCAPES[e]);
  const functionKey = /^functionKey\((\w+)\)$/.exec(token);
  if (functionKey) return FUNCTION_KEYS[functionKey[1]];
  return NAMED_KEYS[token];
}

function swiftModifiers(token) {
  if (token === undefined) return ["command"];
  return [...token.matchAll(/\.(\w+)/g)].map((m) => m[1]);
}

function standardId(selector) {
  if (selector === "MenuTarget.undoAction") return "std:undo:";
  const literal = /Selector\(\("([^"]+)"\)\)/.exec(selector);
  if (literal) return `std:${literal[1]}`;
  const named = /#selector\((?:\w+\.)*(\w+)\((_:)?\)\)/.exec(selector);
  return `std:${named[1]}${named[2] ? ":" : ""}`;
}

function nativeItems() {
  const items = [];
  for (const [, kind, title, command, selector, arg, keyToken, modsToken, suffix] of menuSource.matchAll(ITEM)) {
    const id = kind === "std" ? standardId(selector) : arg ? `${command}:${arg}` : command;
    const key = swiftKey(keyToken);
    const item = { id, title, key, modifiers: key ? swiftModifiers(modsToken) : [], hidden: suffix.includes("hiddenShortcut") };
    if (id === "selectTab:\\($0)") {
      for (let n = 1; n <= 8; n++) items.push({ ...item, id: `selectTab:${n}`, title: `Select Tab ${n}`, key: String(n) });
    } else items.push(item);
  }
  return items;
}

function nativeGroups() {
  const groups = new Map();
  for (const item of nativeItems()) {
    if (!dynamicCommands.has(item.id.split(":")[0])) groups.set(item.id, [...(groups.get(item.id) ?? []), item]);
  }
  return new Map(
    [...groups].map(([id, items]) => {
      const primary = items.find((i) => !i.hidden) ?? items[0];
      const keys = [primary, ...items.filter((i) => i !== primary)].filter((i) => i.key).map((i) => formatShortcut(i));
      return [id, { title: primary.title, keys: [...new Set(keys)] }];
    }),
  );
}

test("the menu bar source parses into its known items", () => {
  const groups = nativeGroups();
  assert.ok(groups.size > 120, `parsed ${groups.size} shortcut ids`);
  assert.deepEqual(groups.get("closeTab")?.keys, ["⌘W"]);
  assert.deepEqual(groups.get("nextTab")?.keys, ["⇧⌘]", "⌘}", "⌥⌘→", "⌃⇟", "⌥⌘↓"]);
  assert.deepEqual(groups.get("std:toggleFullScreen:")?.keys, ["🌐F", "⌃⌘F"]);
});

test("every menu bar shortcut id is in the catalog with the same default keys", () => {
  const catalog = new Map(staticShortcutSources().map((s) => [s.id, s.keys.map(formatShortcut)]));
  for (const [id, native] of nativeGroups()) {
    assert.ok(catalog.has(id), `${id} is missing from commandCatalog.ts`);
    assert.deepEqual(catalog.get(id), native.keys, `${id} default keys`);
  }
});

test("every menu bar command has the catalog's title", () => {
  for (const [id, native] of nativeGroups()) {
    if (id.startsWith("std:")) continue;
    const [command, arg] = id.split(":");
    const spec = COMMANDS[command];
    assert.equal((arg ? spec?.variants?.[arg] : spec)?.title, native.title, `${id} title`);
  }
});

test("every catalog default key is bound by the menu bar", () => {
  const native = nativeGroups();
  for (const source of staticShortcutSources()) {
    if (!source.keys.length) continue;
    assert.deepEqual(source.keys.map(formatShortcut), native.get(source.id)?.keys ?? [], `${source.id} has keys the menu bar doesn't bind`);
  }
});

test("profiles get ⌃1 to ⌃9 in order, as the Profiles menu numbers them", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const keys = new Map(shortcutSources(ids, []).map((s) => [s.id, s.keys.map(formatShortcut)]));
  assert.deepEqual(keys.get("switchProfile:p0"), ["⌃1"]);
  assert.deepEqual(keys.get("switchProfile:p8"), ["⌃9"]);
  assert.deepEqual(keys.get("switchProfile:p9"), []);
  assert.ok(swift.includes(`key: i < 9 ? "\\(i + 1)" : "", .control)`), "MainMenu.swift still numbers profiles with ⌃");
});
