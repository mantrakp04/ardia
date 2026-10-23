import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { themeArea, themeBackdrop, sanitizeTheme, opaqueThemeTint, mixOklab, resolveTheme } = await import("./profileTheme.ts");

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
});

test("a dark look without its own angle keeps the default diagonal, not the light look's angle", () => {
  const { mode: _mode, ...look } = THEME;
  const theme = { ...THEME, angle: 270, dark: look };
  assert.equal(themeBackdrop(resolveTheme(theme, true), true).themeAngle, 135);
  assert.equal(resolveTheme({ ...theme, dark: { ...look, angle: 0 } }, true).angle, 0);
  assert.equal(resolveTheme(theme, false).angle, 270);
});
