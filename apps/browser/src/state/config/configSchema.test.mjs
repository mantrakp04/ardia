import assert from "node:assert/strict";
import { test } from "node:test";
import { accepts, keywordsOutsideSubset } from "./schemaCheck.test.mjs";
const { SETTING_KEYS, SETTING_SPECS } = await import("../settings/settings.ts");
const { CONFIG_SETTING_KEYS, CONFIG_EXCLUDED_KEYS } = await import("../settings/configAllowlist.ts");
const { configSchema, schemaFiles } = await import("./configSchema.ts");
const { shortcutCatalog } = await import("./configShortcuts.ts");
const { parseThemeFile, themeSchema } = await import("../../lib/themeFile.ts");
const { colorRoles } = await import("../../components/ui/tokens.ts");

const SAMPLES = [
  true, false, 0, -1, 0.5, 1, 2, 900, Number.MAX_SAFE_INTEGER, "", "google", "top", "chromium", null, [], ["a"], [1], [900, 640], [0, 5], [900, 640, 1],
  {}, { a: ["x"] }, { a: "chromium" }, { a: "gecko" }, { a: 1 }, { a: [1] },
  [{ id: "a", name: "b", keyword: "c", url: "d" }], [{ id: 1 }], [{ profile: "p", extensionId: "e", name: "n", keyword: "k", url: "u" }],
];

test("every setting is either on the config allowlist or deliberately left out, never both", () => {
  const allowed = new Set(CONFIG_SETTING_KEYS);
  const excluded = new Set(CONFIG_EXCLUDED_KEYS);
  for (const key of SETTING_KEYS) assert.ok(allowed.has(key) !== excluded.has(key), `${key} must be in exactly one list`);
  assert.equal(allowed.size + excluded.size, SETTING_KEYS.length, "no stale names in either list");
  assert.deepEqual([...excluded].sort(), [
    "allowJavaScriptFromAppleEvents", "cliControl", "customSearchEngines", "customSearchUrl", "defaultProfileId", "extensionSearchEngines",
    "pageEngine", "protectedVideoInWebKit", "websiteEngines",
  ]);
});

test("each setting's schema and its validator agree on its default and on every sample", () => {
  for (const key of SETTING_KEYS) {
    const spec = SETTING_SPECS[key];
    assert.equal(accepts(spec.schema, spec.default), true, `${key}: default`);
    for (const value of [...SAMPLES, ...(spec.values ?? [])]) assert.equal(accepts(spec.schema, value), spec.valid(value), `${key}: ${JSON.stringify(value)}`);
  }
});

test("config.schema.json lists the allowlist with defaults, shortcuts by command id, and only the subset the CLI checks", () => {
  const schema = configSchema();
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(keywordsOutsideSubset(schema), []);
  const settings = schema.properties.settings;
  assert.deepEqual(Object.keys(settings.properties), [...CONFIG_SETTING_KEYS]);
  assert.equal(settings.additionalProperties, false);
  for (const key of CONFIG_SETTING_KEYS) assert.ok(accepts(settings.properties[key], settings.properties[key].default), key);
  assert.deepEqual(settings.properties.selectedTabGlow.enum, ["full", "soft", "off"]);
  assert.equal(settings.properties.selectedTabGlow.default, "full");
  const shortcuts = settings.properties.shortcuts;
  assert.deepEqual(Object.keys(shortcuts.properties), [...shortcutCatalog().keys()]);
  assert.match(shortcuts.properties.newTab.description, /New Tab \(default ⌘T\)/);
  assert.match(shortcuts.description, /cmd\+shift\+t/);
  assert.equal(accepts(shortcuts, { newTab: "cmd+t", reopenClosedTab: "" }), true);
  assert.equal(accepts(shortcuts, { notACommand: "cmd+t" }), false);
  assert.equal(accepts(schema.properties.theme, "nord"), true);
  assert.equal(accepts(schema.properties.theme, null), true);
  assert.equal(accepts(schema.properties.theme, "Nord!"), false);
  assert.equal(accepts(schema, { $schema: "./config.schema.json", theme: "nord", settings: { tabLayout: "top" }, other: 1 }), true);
  assert.equal(accepts(schema, { settings: { cliControl: true } }), false);
});

test("theme.schema.json has every role but dark with Ardia's values as defaults, and agrees with the app's own check", () => {
  const schema = themeSchema(colorRoles);
  assert.deepEqual(keywordsOutsideSubset(schema), []);
  for (const mode of ["dark", "light"]) {
    const roles = schema.properties[mode].properties;
    assert.equal("dark" in roles, false);
    assert.equal(roles.accent.default, colorRoles[mode].accent);
    assert.deepEqual(roles.tabSelectedBorder.default, colorRoles[mode].tabSelectedBorder);
    assert.equal(Object.keys(roles).length, Object.keys(colorRoles[mode]).length - 1);
  }
  const colours = ["#abc", "#AABBCC", "#aabbcc80", "rgb(1, 2, 3)", "rgba(255,0,0,0.5)", "rgba(1,2,3,1.0)", "#abcd", "red", "rgb(256,0,0)", "rgba(1,2,3,2)", "rgb(1,2)", 5];
  const numbers = [0, 0.5, 1, 2, -1, 50, 100, 150, "1"];
  const pairs = [["#000", "#fff"], ["#000"], ["#000", "nope"], "#000"];
  const cases = [
    ...colours.map((v) => ["accent", v]),
    ...numbers.flatMap((v) => [["grain", v], ["panelShadowOpacity", v], ["tabSelectedShadowRadius", v]]),
    ...pairs.map((v) => ["tabSelectedBorder", v]),
    ["notARole", "#000"],
  ];
  for (const [role, value] of cases) {
    const doc = { dark: { [role]: value } };
    const parsed = parseThemeFile("themes/t.json", JSON.stringify(doc), colorRoles);
    assert.equal(accepts(schema, doc), parsed.problems.length === 0, `${role}: ${JSON.stringify(value)} ${parsed.problems}`);
  }
});

test("the schema files are written as 2-space JSON with a final newline", () => {
  const files = schemaFiles(colorRoles);
  assert.deepEqual(Object.keys(files), ["config.schema.json", "theme.schema.json"]);
  for (const text of Object.values(files)) {
    assert.ok(text.endsWith("}\n"));
    assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  }
});
