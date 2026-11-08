import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { profileTheme, PROFILE_COLORS } = await import("./theme.ts");
const { colorRoles } = await import("./tokens.ts");
const { luminance } = await import("../../lib/color.ts");
const { selectionLightnessDelta, visibleSelection, MIN_SELECTION_LIGHTNESS, MIN_FLIPPED_SELECTION_LIGHTNESS } = await import("../../lib/selectionContrast.ts");

const flat = (r, g, b, mode) => {
  const color = { r, g, b, a: 1 };
  return { stops: [{ x: 0.2, y: 0.2, color }, { x: 0.8, y: 0.8, color }], intensity: 0.6, mode, grain: 0, texture: "grain", translucency: 1 };
};

const GREYS = [0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95, 0.98, 1];
const TINTED = [[0.02, 0.03, 0.1], [0.1, 0.01, 0.03], [1, 0.98, 0.92], [0.9, 1, 0.95], [0.05, 0.1, 0.06]];

const customThemes = () =>
  [...GREYS.map((v) => [v, v, v]), ...TINTED].flatMap(([r, g, b]) =>
    ["dark", "light"].map((mode) => ({ label: `${[r, g, b]} ${mode}`, theme: profileTheme({ color: "neutral", theme: flat(r, g, b, mode) }, mode === "dark") })),
  );

test("built-in presets keep Dia's selected-tab fill, neutral included", () => {
  for (const dark of [true, false])
    for (const color of Object.keys(PROFILE_COLORS)) {
      const theme = profileTheme({ color }, dark);
      const base = colorRoles[dark ? "dark" : "light"];
      assert.equal(theme.tabSelected, base.tabSelected, `${color} ${dark ? "dark" : "light"}`);
      assert.equal(theme.pinnedSelectedFill, base.pinnedSelectedFill, `${color} ${dark ? "dark" : "light"} pinned`);
    }
});

test("every custom profile colour shows its selected tab against the sidebar", () => {
  for (const { label, theme } of customThemes()) {
    assert.ok(selectionLightnessDelta(theme.tabSelected, theme.windowTint) >= MIN_SELECTION_LIGHTNESS - 1e-9, `${label}: ${theme.tabSelected} on ${theme.windowTint}`);
    assert.ok(selectionLightnessDelta(theme.pinnedSelectedFill, theme.windowTint) >= MIN_SELECTION_LIGHTNESS - 1e-9, `${label} pinned`);
  }
});

test("a near-black profile gets a lighter selected tab, as Arc draws it", () => {
  const theme = profileTheme({ color: "neutral", theme: flat(0.02, 0.02, 0.02, "dark") }, true);
  const [backdrop] = theme.windowTint;
  assert.ok(luminance(theme.tabSelected.slice(0, 7)) > luminance(backdrop), theme.tabSelected);
  assert.ok(selectionLightnessDelta(theme.tabSelected, theme.windowTint) >= MIN_FLIPPED_SELECTION_LIGHTNESS - 1e-9);
});

test("a near-white profile gets a darker selected tab", () => {
  const theme = profileTheme({ color: "neutral", theme: flat(1, 1, 1, "light") }, false);
  assert.ok(luminance(theme.tabSelected.slice(0, 7)) < luminance(theme.windowTint[0]), theme.tabSelected);
});

test("a fill that already shows is returned as is", () => {
  assert.equal(visibleSelection("rgba(18,18,18,0.5)", "#FFFFFF", ["#342123"]), "rgba(18,18,18,0.5)");
});
