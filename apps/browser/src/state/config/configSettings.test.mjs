import assert from "node:assert/strict";
import { test } from "node:test";
const { DEFAULT_SETTINGS } = await import("../settings/settings.ts");
const { readConfig } = await import("./configSettings.ts");
const { parseConfigShortcut, configShortcuts } = await import("./configShortcuts.ts");

const read = (settings, doc, current = DEFAULT_SETTINGS) => readConfig(JSON.stringify({ settings, ...doc }), current);

test("the file's valid settings that differ from the current ones make the patch; equal ones don't", () => {
  const current = { ...DEFAULT_SETTINGS, tabLayout: "top" };
  const { patch, problems, theme } = read({ tabLayout: "top", selectedTabGlow: "soft", mutedSites: ["a.com"], glassTintAmount: 0.8 }, { theme: "nord" }, current);
  assert.deepEqual(patch, { selectedTabGlow: "soft", mutedSites: ["a.com"] });
  assert.deepEqual(problems, []);
  assert.equal(theme, "nord");
});

test("a wrong value skips that setting with a message saying what's allowed, and the rest still applies", () => {
  const { patch, problems } = read({ selectedTabGlow: "bright", sidebarWidth: -3, glassTintAmount: 4, warnBeforeQuitting: "yes", cleanUpInactiveTabsAfterMinutes: 0, littleArdiaSize: [1], tabLayout: "top" });
  assert.deepEqual(patch, { tabLayout: "top" });
  assert.deepEqual(problems, [
    "config.json: selectedTabGlow must be full, soft or off",
    "config.json: sidebarWidth must be a number above 0",
    "config.json: glassTintAmount must be a number from 0 to 1",
    "config.json: warnBeforeQuitting must be true or false",
    "config.json: cleanUpInactiveTabsAfterMinutes must be a number above 0 or null",
    "config.json: littleArdiaSize must be a list of 2 numbers above 0",
  ]);
});

test("settings left off the allowlist and unknown keys are reported and never applied", () => {
  const { patch, problems } = read({ cliControl: true, allowJavaScriptFromAppleEvents: true, pageEngine: "webkit", customSearchUrl: "https://x/?q=%s", tabLaout: "top" });
  assert.deepEqual(patch, {});
  assert.deepEqual(problems, [
    "config.json: cliControl can't be set from a file",
    "config.json: allowJavaScriptFromAppleEvents can't be set from a file",
    "config.json: pageEngine can't be set from a file",
    "config.json: customSearchUrl can't be set from a file",
    "config.json: tabLaout isn't a setting",
  ]);
});

test("searchEngine must name an engine that exists, a custom one included", () => {
  assert.deepEqual(read({ searchEngine: "duckduckgo" }).patch, { searchEngine: "duckduckgo" });
  assert.match(read({ searchEngine: "askjeeves" }).problems[0], /^config\.json: searchEngine must name an existing engine \(google, /);
  const withCustom = { ...DEFAULT_SETTINGS, customSearchEngines: [{ id: "engine-1", name: "Mine", keyword: "m", url: "https://m/?q=%s" }] };
  assert.deepEqual(read({ searchEngine: "engine-1" }, {}, withCustom).patch, { searchEngine: "engine-1" });
});

test("a file that doesn't parse, or whose root or settings isn't an object, changes nothing and leaves the theme as it is", () => {
  const broken = readConfig('{ "settings": { "tabLayout": "top", }', DEFAULT_SETTINGS);
  assert.deepEqual(broken.patch, {});
  assert.equal(broken.theme, undefined);
  assert.match(broken.problems[0], /^config\.json: isn't valid JSON/);
  assert.deepEqual(readConfig("[]", DEFAULT_SETTINGS).problems, ["config.json: must be an object"]);
  assert.deepEqual(read(7).problems, ["config.json: settings must be an object"]);
  assert.equal(read({}, { theme: "Not A Name" }).theme, undefined);
  assert.equal(read({}, { theme: null }).theme, null);
  assert.equal(readConfig("{}", DEFAULT_SETTINGS).theme, null);
});

test("shortcuts read as cmd+shift+t or glyphs, one per command", () => {
  assert.deepEqual(parseConfigShortcut("cmd+shift+t"), { key: "t", modifiers: ["shift", "command"] });
  assert.deepEqual(parseConfigShortcut("Shift+Cmd+T"), { key: "t", modifiers: ["shift", "command"] });
  assert.deepEqual(parseConfigShortcut("⌘⇧T"), { key: "t", modifiers: ["shift", "command"] });
  assert.deepEqual(parseConfigShortcut("ctrl+opt+space"), { key: " ", modifiers: ["control", "option"] });
  assert.deepEqual(parseConfigShortcut("alt+f5"), { key: String.fromCharCode(0xf708), modifiers: ["option"] });
  assert.deepEqual(parseConfigShortcut("cmd+up"), { key: "", modifiers: ["command"] });
  assert.deepEqual(parseConfigShortcut("cmd+,"), { key: ",", modifiers: ["command"] });
  assert.deepEqual(parseConfigShortcut("cmd++"), { key: "+", modifiers: ["command"] });
  assert.deepEqual(parseConfigShortcut("fn+f"), { key: "f", modifiers: ["function"] });
  for (const bad of ["cmd+", "cmd+foo", "hyper+t", "f21", "⌘", "⌘Foo", "cmd+shift"]) assert.equal(parseConfigShortcut(bad), null, bad);
});

test("file shortcuts become stored overrides: \"\" unbinds, the default clears the override, a command left out keeps its own", () => {
  const current = { closeTab: ["w", "command", "option"], newWindow: ["m", "command"] };
  const { overrides, problems } = configShortcuts("config.json", { newTab: "cmd+shift+n", reopenClosedTab: "", newWindow: "⌘N", nope: "cmd+k", "system:Edit > Copy": "cmd+c", findInPage: 7, print: "cmd+foo" }, current);
  assert.deepEqual(overrides, { closeTab: ["w", "command", "option"], newTab: ["n", "shift", "command"], reopenClosedTab: [""] });
  assert.deepEqual(problems, [
    "config.json: shortcuts.nope isn't a command",
    "config.json: shortcuts.system:Edit > Copy can't be rebound",
    'config.json: shortcuts.findInPage must be a string like "cmd+shift+t", "⇧⌘T" or ""',
    'config.json: shortcuts.print "cmd+foo" isn\'t a shortcut (try "cmd+shift+t" or "⇧⌘T")',
  ]);
  assert.deepEqual(read({ shortcuts: { newTab: "⌘T" } }).patch, {}, "the default on a command without an override is no change");
  assert.deepEqual(read({ shortcuts: { newTab: "cmd+y" } }).patch, { shortcuts: { newTab: ["y", "command"] } });
});

test("both link modifiers on alt settle on one fixed pair instead of flipping on every reconcile, and the conflict is reported", async () => {
  const { useBrowser } = await import("../browser/store.ts");
  const S = () => useBrowser.getState();
  S().hydrate({});
  const text = JSON.stringify({ settings: { peekModifier: "alt", splitLinkModifier: "alt" } });
  const pairs = [];
  for (let i = 0; i < 3; i++) {
    const { patch, problems } = readConfig(text, S().settings);
    assert.match(problems[0], /peekModifier and splitLinkModifier can't both be alt/);
    if (Object.keys(patch).length) S().updateSettings(patch);
    pairs.push(`${S().settings.peekModifier}/${S().settings.splitLinkModifier}`);
  }
  assert.deepEqual(pairs, ["alt/altShift", "alt/altShift", "alt/altShift"]);
  S().updateSettings({ peekModifier: "alt", splitLinkModifier: "altShift" });
  assert.deepEqual(readConfig(JSON.stringify({ settings: { splitLinkModifier: "alt" } }), S().settings).patch, {}, "the file's half of the pair yields to the fixed precedence too");
});

test("a shortcut equal to any of the command's defaults is no override, so the other default stays", () => {
  assert.deepEqual(read({ shortcuts: { zoomIn: "cmd+=" } }).patch, {});
  assert.deepEqual(read({ shortcuts: { zoomIn: "⌘+" } }).patch, {});
  assert.deepEqual(read({ shortcuts: { zoomIn: "cmd+shift+=" } }).patch, { shortcuts: { zoomIn: ["=", "shift", "command"] } });
});

test("a settings key that is present but not an object is an error and applies nothing", () => {
  assert.deepEqual(read(null), { patch: {}, theme: null, problems: ["config.json: settings must be an object"] });
  assert.deepEqual(readConfig(JSON.stringify({ theme: "nord" }), DEFAULT_SETTINGS), { patch: {}, theme: "nord", problems: [] });
});
