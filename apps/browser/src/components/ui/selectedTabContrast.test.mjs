import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { inkOn, profileTheme, scopedTheme, surfaceTheme, tintTheme, PROFILE_COLORS } = await import("./theme.ts");
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

const vivid = (stops, mode = "dark") => ({ stops, intensity: 1, mode, grain: 0, texture: "grain", translucency: 1 });
const grey = (v) => ({ r: v, g: v, b: v, a: 1 });
const rgb = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255, a: 1 });
const solid = (color, mode) => vivid([{ x: 0.2, y: 0.2, color }, { x: 0.8, y: 0.8, color }], mode);
const custom = (look) => profileTheme({ color: "neutral", theme: look }, look.mode === "dark");
const SIDEBAR_INK = ["textPrimary", "textTab", "textSecondary", "textTertiary", "icon", "iconDisabled", "mark", "placeholder", "tabHover", "tabPressed", "pinnedResting", "divider"];

test("an ink keeps the mode's own colour until it drops below 3:1, as Arc keeps white on a dark theme's mid-tone row", () => {
  assert.equal(inkOn(["#9B837E"], true), "#FFFFFF");
  assert.equal(inkOn(["#805C5B"], true), "#FFFFFF");
  assert.equal(inkOn(["#C4C4C4"], true), "#000000");
  assert.equal(inkOn(["#080808"], true), "#FFFFFF");
  assert.equal(inkOn(["#EEEEEE"], false), "#000000");
  assert.equal(inkOn(["#4A4A4A"], false), "#FFFFFF");
});

test("a selected row's title keeps the mode's ink unless it can't be read on that row", () => {
  assert.equal(custom(solid(grey(0))).rowSelectedText, "#FFFFFF");
  assert.equal(custom(solid(grey(0.88))).rowSelectedText, "#000000");
  assert.equal(custom(solid(rgb(128, 92, 91))).rowSelectedText, "#FFFFFF");
  assert.equal(profileTheme({ color: "neutral", theme: flat(0.95, 0.62, 0.78, "light") }, false).rowSelectedText, "#000000");
  for (const dark of [true, false])
    for (const color of Object.keys(PROFILE_COLORS)) assert.equal(profileTheme({ color }, dark).rowSelectedText, colorRoles[dark ? "dark" : "light"].tabSelectedText);
});

test("a light custom colour in dark mode draws its sidebar text, glyphs and hover in the light palette", () => {
  const theme = custom(solid(grey(0.88)));
  const sidebar = tintTheme(theme);
  assert.ok(theme.dark);
  assert.equal(sidebar.dark, false);
  for (const role of SIDEBAR_INK) assert.equal(sidebar[role], colorRoles.light[role], role);
  assert.equal(sidebar.tabSelected, theme.tabSelected);
  assert.equal(sidebar.pinnedSelectedFill, theme.pinnedSelectedFill);
  assert.equal(sidebar.rowSelectedText, "#000000");
  assert.equal(sidebar.windowTint, theme.windowTint);
  assert.equal(theme.textTab, colorRoles.dark.textTab);
});

test("a dark custom colour keeps its white sidebar text, the owner's mid-tone included", () => {
  for (const look of [solid(grey(0)), solid(grey(0.02)), solid(rgb(128, 92, 91))]) {
    const theme = custom(look);
    assert.equal(tintTheme(theme), theme);
  }
});

test("a black-to-white gradient keeps white sidebar text, since black reads no better on its dark end", () => {
  const theme = custom(vivid([{ x: 0, y: 0, color: grey(0) }, { x: 1, y: 1, color: grey(1) }]));
  assert.equal(tintTheme(theme), theme);
  assert.equal(tintTheme(theme).textTab, colorRoles.dark.textTab);
});

test("every custom colour's sidebar text reads at 3:1 on its tint, or takes the ink that reads better", () => {
  const ratio = (text, row) => {
    const [a, b] = [luminance(text), luminance(row)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const worst = (text, rows) => Math.min(...rows.map((row) => ratio(text, row)));
  for (const { label, theme } of customThemes()) {
    const text = tintTheme(theme).textPrimary;
    const other = text === "#FFFFFF" ? "#000000" : "#FFFFFF";
    assert.ok(worst(text, theme.windowTint) >= 3 || worst(text, theme.windowTint) >= worst(other, theme.windowTint), `${label}: ${text} on ${theme.windowTint}`);
  }
});

test("built-in presets keep their sidebar and strip palette", () => {
  for (const dark of [true, false])
    for (const color of [...Object.keys(PROFILE_COLORS), "incognito"]) {
      const theme = color === "incognito" ? profileTheme(undefined, dark) : profileTheme({ color }, dark);
      assert.equal(tintTheme(theme), theme, `${color} ${dark}`);
    }
});

test("a strip's selected chip, drawn on the card, keeps the mode's ink unless the card on the tint can't hold it", () => {
  for (const look of [solid(grey(0.88)), solid(rgb(128, 92, 91)), solid(grey(0.02))]) {
    const theme = custom(look);
    assert.equal(theme.tabSelectedText, "#FFFFFF", theme.windowTint.join(" "));
    assert.ok(inkOn(theme.windowTint.map((tint) => over(theme.card, tint)), true) === theme.tabSelectedText);
  }
  assert.equal(profileTheme({ color: "neutral", theme: flat(0.95, 0.62, 0.78, "light") }, false).tabSelectedText, "#000000");
  for (const dark of [true, false])
    for (const color of Object.keys(PROFILE_COLORS)) assert.equal(profileTheme({ color }, dark).tabSelectedText, colorRoles[dark ? "dark" : "light"].tabSelectedText);
});

test("whatever is drawn on its own surface inside a flipped tint gets the window theme back", () => {
  const theme = custom(solid(grey(0.88)));
  const tint = tintTheme(theme);
  assert.notEqual(tint, theme);
  assert.equal(surfaceTheme(tint), theme);
  assert.equal(surfaceTheme(theme), theme);
  const plum = profileTheme({ color: "plum" }, true);
  assert.equal(surfaceTheme(tintTheme(plum)), plum);
});

test("an emphasised title on the tint can use textPrimary: the presets draw it as tabSelectedText", () => {
  for (const mode of ["dark", "light"]) assert.equal(colorRoles[mode].textPrimary, colorRoles[mode].tabSelectedText);
});

test("with Adjust text to the colour off, a custom colour keeps the mode's own inks and Arc's selected fill", () => {
  for (const look of [solid(grey(0.88)), solid(rgb(128, 92, 91)), solid(grey(0.02))]) {
    const on = custom(look);
    const off = profileTheme({ color: "neutral", theme: look }, true, "own", null, false);
    assert.equal(off.adaptiveInk, false);
    assert.equal(tintTheme(off), off);
    assert.equal(off.rowSelectedText, colorRoles.dark.tabSelectedText);
    assert.equal(off.tabSelectedText, colorRoles.dark.tabSelectedText);
    assert.equal(off.textTab, colorRoles.dark.textTab);
    assert.equal(off.tabSelected, on.tabSelected);
    assert.equal(off.pinnedSelectedFill, on.pinnedSelectedFill);
    assert.deepEqual(off.windowTint, on.windowTint);
  }
  assert.equal(tintTheme(custom(solid(grey(0.88)))).textTab, colorRoles.light.textTab);
  assert.equal(custom(solid(grey(0.88))).rowSelectedText, "#000000");
});

test("Adjust text to the colour doesn't touch built-in colours or incognito", () => {
  for (const dark of [true, false]) {
    for (const color of Object.keys(PROFILE_COLORS)) assert.equal(profileTheme({ color }, dark, "own", null, false), profileTheme({ color }, dark, "own", null, true));
    assert.equal(scopedTheme(true, undefined, dark, "own", null, false), scopedTheme(true, undefined, dark, "own", null, true));
  }
});
