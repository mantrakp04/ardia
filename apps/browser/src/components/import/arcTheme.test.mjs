import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { parseArcTheme } = await import("./arcTheme.ts");
const { themeArea, themeLayerAlpha, themeUnderlayAlpha, themeBackdrop, sanitizeTheme, padColor, padPosition, resolveTheme } = await import("../../lib/profileTheme.ts");

const fixtures = new URL("../../../../../packages/import/fixtures/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(`arc-themes/${name}.json`, fixtures), "utf8"));
const gradientOf = (theme) => theme.background.single._0.style.color._0.blendedGradient._0;
const rgb = (c) => ({ r: c.red, g: c.green, b: c.blue, a: c.alpha });
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

function onLightDesktop(theme, x, y) {
  const a = themeLayerAlpha(theme);
  const u = themeUnderlayAlpha(theme, false);
  const under = u + 0.93 * (1 - u);
  return themeArea(theme, x, y, 1200, 800).map((v) => a * v + (1 - a) * under);
}

function near(actual, expected, tolerance, label) {
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= tolerance, `${label}: ${actual.map((n) => n.toFixed(3))} vs ${expected.map((n) => n.toFixed(3))}`));
}

test("green to pink space: two base colours kept exactly, light mode, grain", () => {
  const raw = fixture("green-pink");
  const theme = parseArcTheme(raw);
  const g = gradientOf(raw);
  assert.equal(theme.stops.length, 2);
  assert.deepEqual(theme.stops.map((s) => s.color), g.baseColors.map(rgb));
  assert.equal(theme.intensity, g.modifiers.intensityFactor);
  assert.equal(theme.grain, g.modifiers.noiseFactor);
  assert.equal(theme.texture, "grain");
  assert.equal(theme.mode, "light");
  assert.equal(theme.translucency, 1);
  near(onLightDesktop(theme, 0, 0), hex("#7FCB98"), 0.06, "top-left");
  near(onLightDesktop(theme, 1200, 800), hex("#D45CA8"), 0.06, "bottom-right");
});

test("blue to teal space: the third colour comes from Arc's overlay, mode follows the system", () => {
  const raw = fixture("blue-teal");
  const theme = parseArcTheme(JSON.stringify(raw));
  const g = gradientOf(raw);
  assert.equal(theme.stops.length, 3);
  assert.deepEqual(theme.stops.map((s) => s.color), [...g.baseColors, g.overlayColors[1]].map(rgb));
  assert.equal(theme.mode, "auto");
  assert.equal(theme.intensity, 0.75);
  assert.equal(theme.grain, 0.3);
  near(onLightDesktop(theme, 600, 0), hex("#8C8FD0"), 0.08, "top");
  near(onLightDesktop(theme, 600, 800), hex("#6DB3C8"), 0.08, "bottom");
});

test("single colour, extended range and a texture", () => {
  const theme = parseArcTheme(fixture("single-orange"));
  assert.equal(theme.stops.length, 1);
  assert.deepEqual(theme.stops[0].color, { r: 1.0721, g: 0.4103, b: -0.0207, a: 1 });
  assert.equal(theme.texture, "sand");
  assert.equal(theme.mode, "dark");
  assert.equal(theme.grain, 1);
  assert.equal(themeBackdrop(theme, true).themeGrain, 0.15);
});

test("an opaque basic colour per appearance keeps both looks and picks one when rendering", () => {
  const theme = parseArcTheme(fixture("basic-appearance"));
  assert.equal(theme.mode, "auto");
  assert.deepEqual(theme.stops[0].color, { r: 0.86, g: 0.9, b: 0.97, a: 1 });
  assert.deepEqual(theme.dark.stops[0].color, { r: 0.08, g: 0.1, b: 0.16, a: 1 });
  assert.equal(theme.translucency, 0);
  assert.equal(themeLayerAlpha(theme), 1);
  assert.deepEqual(resolveTheme(theme, false).stops[0].color, theme.stops[0].color);
  assert.deepEqual(resolveTheme(theme, true).stops[0].color, theme.dark.stops[0].color);
  assert.equal(resolveTheme(theme, true).dark, undefined);
  const forcedDark = parseArcTheme({ ...fixture("basic-appearance"), windowAppearance: { single: { _0: "dark" } } });
  assert.equal(forcedDark.mode, "dark");
  assert.deepEqual(forcedDark.stops[0].color, { r: 0.08, g: 0.1, b: 0.16, a: 1 });
  assert.equal(forcedDark.dark, undefined);
});

test("oversized input is capped before it is walked", () => {
  const raw = fixture("green-pink");
  const g = gradientOf(raw);
  g.baseColors = [...g.baseColors, ...Array.from({ length: 100_000 }, () => g.baseColors[0])];
  g.overlayColors = Array.from({ length: 100_000 }, () => g.baseColors[1]);
  const theme = parseArcTheme(raw);
  assert.equal(theme.stops.length, 3);
  assert.equal(parseArcTheme(JSON.stringify(raw)), null);
  assert.equal(parseArcTheme("x".repeat(70 * 1024)), null);
  assert.equal(sanitizeTheme({ stops: Array.from({ length: 1e5 }, () => 7), mode: "auto" }), null);
});

test("Arc's intensity maps to its layer alpha at full translucency", () => {
  const theme = parseArcTheme(fixture("green-pink"));
  assert.ok(Math.abs(themeLayerAlpha(theme) - (0.2 + 0.55 * 0.8)) < 1e-9);
  assert.equal(themeUnderlayAlpha(theme, false), 0.5);
  assert.ok(Math.abs(themeUnderlayAlpha(theme, true) - 0.175) < 1e-9);
});

test("broken or foreign input is rejected", () => {
  for (const input of [null, "", "{", "[]", {}, { background: {} }, { background: { single: { _0: { style: { color: { _0: { blendedGradient: { _0: { baseColors: [] } } } } } } } } }])
    assert.equal(parseArcTheme(input), null);
});

test("stored themes are sanitised", () => {
  assert.equal(sanitizeTheme({ stops: [] }), null);
  const t = sanitizeTheme({ stops: [{ color: { r: 0.2, g: 0.3, b: 0.4 }, x: 3, y: -1 }, 1, 2, 3], mode: "weird", grain: 5, texture: "silk", translucency: -2 });
  assert.equal(t.stops.length, 1);
  assert.deepEqual([t.stops[0].x, t.stops[0].y], [1, 0]);
  assert.equal(t.mode, "auto");
  assert.equal(t.grain, 1);
  assert.equal(t.texture, "grain");
  assert.equal(t.translucency, 0);
});

test("the colour pad round-trips hue and saturation", () => {
  for (const [x, y] of [[0.9, 0.5], [0.2, 0.3], [0.5, 0.95], [0.6, 0.6]]) {
    const p = padPosition(padColor(x, y));
    assert.ok(Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01, `${x},${y} -> ${p.x},${p.y}`);
  }
});

test("a colour can go black, keeps its brightness and alpha while moved, and gets its hue back", async () => {
  const { withStopAt, withStopLightness, stopLightness } = await import("../../lib/profileTheme.ts");
  const theme = { stops: [{ x: 0.9, y: 0.5, color: padColor(0.9, 0.5) }], intensity: 1, mode: "dark", grain: 0, texture: "grain", translucency: 0 };
  const black = withStopLightness(theme, 0, 0);
  assert.deepEqual(black.stops[0].color, { r: 0, g: 0, b: 0, a: 1 });
  const moved = withStopAt(black, 0, 0.2, 0.3);
  assert.equal(stopLightness(moved.stops[0]), 0);
  const translucent = { ...theme, stops: [{ ...theme.stops[0], color: { ...theme.stops[0].color, a: 0.5 } }] };
  assert.equal(withStopAt(translucent, 0, 0.2, 0.3).stops[0].color.a, 0.5);
  assert.equal(withStopLightness(translucent, 0, 0.2).stops[0].color.a, 0.5);
  near(Object.values(withStopLightness(moved, 0, 0.6).stops[0].color).slice(0, 3), Object.values(padColor(0.2, 0.3)).slice(0, 3), 1e-9, "hue back");
});
