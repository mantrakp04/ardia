import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const { COMMANDS, settingChange, settingChecks, shortcutSources, staticShortcutSources, variantArg } = await import("./commandCatalog.ts");
const { SETTING_SPECS } = await import("../settings/settings.ts");
const { formatShortcut } = await import("./shortcuts.ts");

const { TABLE_FILES, renderSwift, renderUnion } = await import("../../../scripts/command-tables.mjs");

test("the generated BrowserCommand union and Swift command table match the catalog (node apps/browser/scripts/command-tables.mjs)", () => {
  assert.equal(readFileSync(TABLE_FILES.union, "utf8"), renderUnion());
  assert.equal(readFileSync(TABLE_FILES.swift, "utf8"), renderSwift());
});

test("the menu bar lays out every command and variant that has a default key", () => {
  const layout = readFileSync(new URL("../../../../../packages/shell/ios/MainMenu.swift", import.meta.url), "utf8");
  const laid = new Set(
    [...layout.matchAll(/(?:cmd|hidden|CommandItem)\(\.(\w+)(?:,\s*arg:\s*"([^"]*)")?/g)].map((m) => (m[2] === undefined ? m[1] : `${m[1]}:${m[2]}`)),
  );
  const missing = Object.entries(COMMANDS).flatMap(([command, spec]) => [
    ...(spec.keys?.length && !laid.has(command) ? [command] : []),
    ...Object.entries(spec.variants ?? {})
      .filter(([arg, variant]) => variant.keys?.length && !laid.has(`${command}:${arg}`) && !laid.has(`${command}:\\($0)`))
      .map(([arg]) => `${command}:${arg}`),
  ]);
  assert.deepEqual(missing, []);
});

test("no two shortcut ids share a default key", () => {
  const holders = new Map();
  for (const source of staticShortcutSources()) {
    for (const key of source.keys) holders.set(formatShortcut(key), [...(holders.get(formatShortcut(key)) ?? []), source.id]);
  }
  assert.deepEqual([...holders].filter(([, ids]) => ids.length > 1), []);
});

test("profiles get ⌃1 to ⌃9 in order", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
  const keys = new Map(shortcutSources(ids, []).map((s) => [s.id, s.keys.map(formatShortcut)]));
  assert.deepEqual(keys.get("switchProfile:p0"), ["⌃1"]);
  assert.deepEqual(keys.get("switchProfile:p8"), ["⌃9"]);
  assert.deepEqual(keys.get("switchProfile:p9"), []);
});

test("a command that chooses a setting offers exactly the setting's values", () => {
  for (const [command, spec] of Object.entries(COMMANDS)) {
    if (spec.chooses) assert.deepEqual(Object.keys(spec.variants).sort(), [...SETTING_SPECS[spec.chooses].values].sort(), command);
    if (spec.toggles) assert.equal(typeof SETTING_SPECS[spec.toggles].default, "boolean", command);
  }
});

test("setting commands change their setting and check the menu item that matches it", () => {
  const defaults = Object.fromEntries(Object.entries(SETTING_SPECS).map(([key, spec]) => [key, spec.default]));
  const settings = { ...defaults, appearance: "dark", bookmarksBar: "newTab", showFullUrl: true, allowJavaScriptFromAppleEvents: false };
  assert.deepEqual(settingChange("setAppearance", "light", settings), { appearance: "light" });
  assert.equal(settingChange("setAppearance", "sepia", settings), undefined);
  assert.equal(settingChange("setBookmarksBar", null, settings), undefined);
  assert.deepEqual(settingChange("toggleFullUrl", null, settings), { showFullUrl: false });
  assert.equal(settingChange("reload", null, settings), undefined);
  assert.deepEqual(settingChecks(settings).sort(), ["setAppearance:dark", "setBookmarksBar:newTab", "toggleFullUrl"]);
});

test("a variant argument is read only when the catalog lists it", () => {
  assert.equal(variantArg("togglePin", "row"), "row");
  assert.equal(variantArg("togglePin", "tile"), "tile");
  assert.equal(variantArg("togglePin", "toString"), undefined);
  assert.equal(variantArg("togglePin", null), undefined);
});
