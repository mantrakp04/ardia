import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { profileTheme, PROFILE_COLORS } = await import("./theme.ts");
const { arcSelectedFill, colorRoles } = await import("./tokens.ts");
const { luminance, over } = await import("../../lib/color.ts");
const { selectionLightnessDelta, visibleSelection, MIN_SELECTION_LIGHTNESS } = await import("../../lib/selectionContrast.ts");

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

test("every light custom profile colour shows its selected tab against the sidebar", () => {
  for (const { label, theme } of customThemes().filter(({ theme }) => !theme.dark)) {
    assert.ok(selectionLightnessDelta(theme.tabSelected, theme.windowTint) >= MIN_SELECTION_LIGHTNESS - 1e-9, `${label}: ${theme.tabSelected} on ${theme.windowTint}`);
    assert.ok(selectionLightnessDelta(theme.pinnedSelectedFill, theme.windowTint) >= MIN_SELECTION_LIGHTNESS - 1e-9, `${label} pinned`);
  }
});

test("every dark custom profile colour gets Arc's white selected tab, light greys and black-to-white gradients included", () => {
  const vivid = (stops) => ({ stops, intensity: 1, mode: "dark", grain: 0, texture: "grain", translucency: 1 });
  const grey = (v) => ({ r: v, g: v, b: v, a: 1 });
  const extremes = [
    vivid([{ x: 0.2, y: 0.2, color: grey(0.88) }, { x: 0.8, y: 0.8, color: grey(0.88) }]),
    vivid([{ x: 0, y: 0, color: grey(0) }, { x: 1, y: 1, color: grey(1) }]),
  ].map((look) => profileTheme({ color: "neutral", theme: look }, true));
  for (const theme of [...customThemes().map(({ theme }) => theme).filter((theme) => theme.dark), ...extremes]) {
    assert.ok(theme.dark);
    assert.equal(theme.tabSelected, arcSelectedFill.dark, theme.windowTint.join(" "));
  }
});

test("dark custom colours from black to mid-grey all get Arc's lighter selected tab, so a small colour change can't swap it", () => {
  for (let v = 0; v <= 0.3 + 1e-9; v += 0.005) {
    const theme = profileTheme({ color: "neutral", theme: flat(v, v, v, "dark") }, true);
    assert.equal(theme.tabSelected, arcSelectedFill.dark, `grey ${v.toFixed(3)}`);
    assert.ok(luminance(over(theme.tabSelected, theme.windowTint[0])) > luminance(theme.windowTint[0]));
  }
});

test("a light custom colour gets Arc's white selected tab", () => {
  const theme = profileTheme({ color: "neutral", theme: flat(0.95, 0.62, 0.78, "light") }, false);
  assert.equal(theme.tabSelected, arcSelectedFill.light);
});

test("a near-white profile gets a darker selected tab", () => {
  const theme = profileTheme({ color: "neutral", theme: flat(1, 1, 1, "light") }, false);
  assert.ok(luminance(theme.tabSelected.slice(0, 7)) < luminance(theme.windowTint[0]), theme.tabSelected);
});

test("a fill that already shows is returned as is", () => {
  assert.equal(visibleSelection(arcSelectedFill.dark, "#000000", ["#342123"]), arcSelectedFill.dark);
});
