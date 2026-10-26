import assert from "node:assert/strict";
import { test } from "node:test";
const { profileTheme } = await import("./theme.ts");

const arcLight = {
  stops: [{ color: { r: 0.95, g: 0.92, b: 0.89, a: 1 }, x: 0.5, y: 0.5 }],
  intensity: 0.6,
  grain: 0,
  texture: "grain",
  translucency: 1,
  mode: "light",
};

const arcCream = { ...arcLight, intensity: 1 };

test("a space whose theme says Light goes dark with a dark app when it follows the appearance", () => {
  const own = profileTheme({ color: "plum", theme: arcCream }, true, "own");
  const follows = profileTheme({ color: "plum", theme: arcCream }, true, "app");
  assert.equal(own.dark, false, "off: the theme keeps its own Light");
  assert.equal(follows.dark, true, "on: it follows the dark app");
  const stop = (t) => t.backdrop.themeColors.slice(0, 3);
  const ownDark = profileTheme({ color: "plum", theme: { ...arcCream, mode: "dark" } }, true, "own");
  assert.deepEqual(stop(ownDark), [0.95, 0.92, 0.89], "a theme's own Dark keeps its colours");
  stop(follows).forEach((v, i) => assert.ok(Math.abs(v - [0.95, 0.92, 0.89][i] * 0.4) < 1e-9, "an opaque cream white text can't read on is darkened to 40%"));
  assert.equal(follows.backdrop.themeAppearance, "auto", "the window follows the app too");
  const tinted = profileTheme({ color: "plum", theme: arcLight }, true, "app");
  assert.equal(tinted.dark, true);
  assert.deepEqual(stop(tinted), [0.95, 0.92, 0.89], "the same cream at 60% intensity already reads with white text over the dark underlay, so it keeps its colours");
});

test("in a light app nothing changes", () => {
  const own = profileTheme({ color: "plum", theme: arcLight }, false, "own");
  const follows = profileTheme({ color: "plum", theme: arcLight }, false, "app");
  assert.equal(follows.dark, false);
  assert.deepEqual(follows.windowTint, own.windowTint);
});

test("in a light app, a dark theme that renders too dark for black text gets white text", () => {
  const night = { ...arcLight, stops: [{ color: { r: 0.08, g: 0.09, b: 0.14, a: 1 }, x: 0.5, y: 0.5 }], intensity: 1, mode: "dark" };
  const follows = profileTheme({ color: "plum", theme: night }, false, "app");
  assert.equal(follows.dark, true, "white text on the dark backdrop, not black");
  assert.equal(follows.textPrimary, profileTheme({ color: "plum", theme: night }, false, "own").textPrimary);
  assert.equal(follows.backdrop.themeAppearance, "dark", "the window draws dark to match");
  const tinted = profileTheme({ color: "plum", theme: { ...night, intensity: 0.6 } }, false, "app");
  assert.equal(tinted.dark, false, "a light tint of the same colour still reads with black text, so it follows the light app");
  assert.equal(tinted.backdrop.themeAppearance, "auto");
});

test("a light theme that already reads with white text keeps its colours when it follows a dark app", () => {
  const blue = { ...arcLight, stops: [{ color: { r: 0.12, g: 0.25, b: 0.62, a: 1 }, x: 0.5, y: 0.5 }], intensity: 1 };
  const follows = profileTheme({ color: "plum", theme: blue }, true, "app");
  assert.equal(follows.dark, true);
  assert.deepEqual(follows.backdrop.themeColors.slice(0, 3), [0.12, 0.25, 0.62]);
});

test("utility windows keep the app's appearance whatever the theme says", () => {
  const night = { ...arcLight, stops: [{ color: { r: 0.08, g: 0.09, b: 0.14, a: 1 }, x: 0.5, y: 0.5 }], intensity: 1, mode: "dark" };
  const settings = profileTheme({ color: "plum", theme: night }, false, "utility");
  assert.equal(settings.dark, false);
  assert.equal(settings.backdrop.themeAppearance, "auto");
  const cream = profileTheme({ color: "plum", theme: arcLight }, true, "utility");
  assert.equal(cream.dark, true);
  assert.equal(cream.backdrop.themeAppearance, "auto");
});
