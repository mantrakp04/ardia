import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const P = await import("./profileTheme.ts");
const { profileTheme, PROFILE_COLORS } = await import("./theme.ts");
const { themeArea, themeBackdrop, sanitizeTheme, opaqueThemeTint, mixOklab, resolveTheme, readableDark, padColor, startingTheme } = P;

const color = (r, g, b) => ({ r, g, b, a: 1 });
const THEME = {
  stops: [
    { x: 0.2, y: 0.3, color: color(0.3, 0.75, 0.45) },
    { x: 0.8, y: 0.7, color: color(0.85, 0.3, 0.65) },
    { x: 0.5, y: 0.9, color: { r: 0.2, g: 0.4, b: 0.9, a: 0.8 } },
  ],
  intensity: 0.8,
  mode: "auto",
  grain: 0,
  texture: "grain",
  translucency: 1,
};

function diagonalArea(theme, x, y, width, height) {
  const [c0, c1 = c0, c2] = theme.stops.map((s) => s.color);
  const short = Math.min(width, height), long = Math.max(width, height);
  const start = short / 2 - (short * short) / (2 * long);
  const end = long + short / 2 + (short * short) / (2 * long);
  const t = Math.min(1, Math.max(0, (x + y - start) / (end - start) / 0.75));
  const base = mixOklab(c0, c1, t);
  if (!c2) return base;
  const a = Math.min(1, Math.max(0, y / height)) * c2.a;
  return base.map((v, i) => v + ([c2.r, c2.g, c2.b][i] - v) * a);
}

function near(actual, expected, label) {
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9, `${label}: ${actual} vs ${expected}`));
}

const points = (width, height) => [0, 0.2, 0.5, 0.8, 1].flatMap((u) => [0, 0.3, 0.6, 1].map((v) => [u * width, v * height]));

test("a theme without an angle keeps the fixed top-left to bottom-right diagonal", () => {
  for (const [width, height] of [[1200, 800], [800, 1200], [1, 1]]) {
    for (const theme of [THEME, { ...THEME, stops: THEME.stops.slice(0, 2) }]) {
      for (const [x, y] of points(width, height)) {
        const old = diagonalArea(theme, x, y, width, height);
        near(themeArea(theme, x, y, width, height), old, `${width}×${height} at ${x},${y}`);
        near(themeArea({ ...theme, angle: 135 }, x, y, width, height), old, `135° at ${x},${y}`);
      }
    }
  }
});

test("a theme without an angle keeps its old opaque tint corners", () => {
  const over = (theme, x, y) => {
    const a = P.themeLayerAlpha(theme);
    const under = P.themeUnderColor(theme, false);
    const grey = parseInt(under.slice(1, 3), 16) / 255;
    return diagonalArea(theme, x, y, 1, 1).map((v) => a * Math.min(1, Math.max(0, v)) + (1 - a) * grey);
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const [top, bottom] = opaqueThemeTint(THEME, false);
  hex(top).forEach((v, i) => assert.ok(Math.abs(v - over(THEME, 0, 0)[i]) < 1 / 255 + 1e-6, "top-left"));
  hex(bottom).forEach((v, i) => assert.ok(Math.abs(v - over(THEME, 1, 1)[i]) < 1 / 255 + 1e-6, "bottom-right"));
});

test("an angle turns the whole gradient, the third colour with it", () => {
  const turned = { ...THEME, angle: 315 };
  for (const [x, y] of points(1200, 800)) near(themeArea(turned, x, y, 1200, 800), themeArea(THEME, 1200 - x, 800 - y, 1200, 800), `315° at ${x},${y}`);
  const across = { ...THEME, stops: THEME.stops.slice(0, 2), angle: 90 };
  near(themeArea(across, 0, 0, 1200, 800), themeArea(across, 0, 800, 1200, 800), "90° is the same down the left edge");
  assert.deepEqual(opaqueThemeTint(turned, false), opaqueThemeTint(THEME, false).reverse(), "the tint's corners swap with the turned gradient");
});

test("the angle survives sanitizing, in both looks, and reaches the backdrop", () => {
  const t = sanitizeTheme({ ...THEME, angle: -45, dark: { ...THEME, angle: 405 } });
  assert.equal(t.angle, 315);
  assert.equal(t.dark.angle, 45);
  assert.equal(themeBackdrop(t, false).themeAngle, 315);
  const plain = sanitizeTheme({ ...THEME, angle: "east" });
  assert.ok(!("angle" in plain), "no angle field when there was none to keep");
  assert.equal(themeBackdrop(plain, false).themeAngle, 135);
  assert.deepEqual(sanitizeTheme(THEME), THEME, "an old theme loads unchanged");
});

test("a dark look without its own angle keeps the default diagonal, not the light look's angle", () => {
  const { mode: _mode, ...look } = THEME;
  const theme = { ...THEME, angle: 270, dark: look };
  assert.equal(themeBackdrop(resolveTheme(theme, true), true).themeAngle, 135);
  assert.equal(resolveTheme({ ...theme, dark: { ...look, angle: 0 } }, true).angle, 0);
  assert.equal(resolveTheme(theme, false).angle, 270);
});

const solid = (c, extra = {}) => ({ stops: [{ x: 0.5, y: 0.5, color: c }], intensity: 1, mode: "light", grain: 0, texture: "grain", translucency: 0, ...extra });

test("a black theme gets light text even in light mode, and a white one dark text in dark mode", () => {
  assert.equal(readableDark(solid(color(0, 0, 0)), false), true);
  assert.equal(readableDark(solid(color(1, 1, 1)), true), false);
  const black = profileTheme({ color: "plum", theme: solid(color(0, 0, 0)) }, false);
  assert.equal(black.dark, true);
  assert.equal(black.textPrimary, "#FFFFFF");
  assert.equal(black.backdrop.themeAppearance, "dark", "the native backdrop goes dark with the text");
  const white = profileTheme({ color: "plum", theme: solid(color(1, 1, 1), { mode: "dark" }) }, true);
  assert.equal(white.dark, false);
  assert.equal(white.backdrop.themeAppearance, "light");
});

test("no theme the old colour pad could make changes appearance in light mode, nor at its defaults in dark", () => {
  for (let h = 0; h < 1; h += 0.02) for (let r = 0; r <= 0.5; r += 0.05) {
    const x = 0.5 + r * Math.cos(h * 2 * Math.PI), y = 0.5 + r * Math.sin(h * 2 * Math.PI);
    for (const intensity of [0, 0.5, 1]) for (const translucency of [0, 0.5, 1]) {
      assert.equal(readableDark(solid(padColor(x, y), { intensity, translucency }), false), false, `${x},${y}`);
    }
  }
  for (const spec of Object.values(PROFILE_COLORS)) {
    const theme = startingTheme(spec.swatch);
    assert.equal(readableDark(theme, false), false, spec.name);
    assert.equal(readableDark(theme, true), true, spec.name);
    assert.equal(profileTheme({ color: "plum", theme }, true).backdrop.themeAppearance, "auto", spec.name);
  }
});
