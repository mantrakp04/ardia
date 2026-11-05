import assert from "node:assert/strict";
import { test } from "node:test";
const { mergedPalettes, parseThemeFile, themeColor } = await import("./themeFile.ts");
const { colorRoles } = await import("../components/ui/tokens.ts");

const parse = (doc) => parseThemeFile("themes/nord.json", typeof doc === "string" ? doc : JSON.stringify(doc), colorRoles);

test("theme colours take #RGB, #RRGGBB, #RRGGBBAA, rgb() and rgba(), and come out as hex", () => {
  assert.equal(themeColor("#abc"), "#AABBCC");
  assert.equal(themeColor("#88c0d0"), "#88C0D0");
  assert.equal(themeColor("#88C0D080"), "#88C0D080");
  assert.equal(themeColor("rgb(46, 52, 64)"), "#2E3440");
  assert.equal(themeColor("rgba(255,255,255,0.5)"), "#FFFFFF80");
  assert.equal(themeColor("rgba(255,255,255,1)"), "#FFFFFF");
  for (const bad of ["#abcd", "red", "rgb(256,0,0)", "rgba(0,0,0,1.5)", "rgb(1,2)", " #abc", "#abcdef1", 7, null]) assert.equal(themeColor(bad), null, String(bad));
});

test("a theme keeps its good roles and reports each bad one by file, appearance and role", () => {
  const { roles, problems } = parse({
    $schema: "../theme.schema.json",
    dark: { accent: "#88C0D0", panel: "nope", grain: 0.2, tabSelectedShadowRadius: 400, tabSelectedBorder: ["#fff", "rgba(0,0,0,0.1)"], dark: false, made: "#000" },
    light: { accent: "#5E81AC", panelShadowOpacity: 2 },
    extra: true,
  });
  assert.deepEqual(roles, {
    dark: { accent: "#88C0D0", grain: 0.2, tabSelectedBorder: ["#FFFFFF", "#0000001A"] },
    light: { accent: "#5E81AC" },
  });
  assert.deepEqual(problems, [
    "themes/nord.json: extra isn't a theme key (dark, light)",
    "themes/nord.json: dark.panel must be a colour (#RGB, #RRGGBB, #RRGGBBAA, or rgb or rgba with r, g, b from 0 to 255 and a from 0 to 1)",
    "themes/nord.json: dark.tabSelectedShadowRadius must be a number from 0 to 100",
    "themes/nord.json: dark.dark isn't a colour role",
    "themes/nord.json: dark.made isn't a colour role",
    "themes/nord.json: light.panelShadowOpacity must be a number from 0 to 1",
  ]);
});

test("a theme file that doesn't parse gives no roles, so the caller keeps the last good version", () => {
  assert.equal(parse("{ dark: ").roles, null);
  assert.match(parse("{ dark: ").problems[0], /^themes\/nord\.json: isn't valid JSON/);
  assert.deepEqual(parse([]).problems, ["themes/nord.json: must be an object"]);
  assert.deepEqual(parse({ dark: "#000" }).problems, ["themes/nord.json: dark must be an object of colour roles"]);
});

test("the theme's roles replace Ardia's in the base palettes, and a role left out keeps Ardia's", () => {
  const merged = mergedPalettes(colorRoles, { dark: { accent: "#88C0D0" }, light: {} }, 3);
  assert.equal(merged.revision, 3);
  assert.equal(merged.dark.accent, "#88C0D0");
  assert.equal(merged.dark.panel, colorRoles.dark.panel);
  assert.equal(merged.dark.dark, true);
  assert.deepEqual(merged.light, { ...colorRoles.light });
  assert.equal(mergedPalettes(colorRoles, null, 0).dark, colorRoles.dark);
});
