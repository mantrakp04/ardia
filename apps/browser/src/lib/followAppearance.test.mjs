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

test("a space whose theme says Light goes dark with a dark app when it follows the appearance", () => {
  const own = profileTheme({ color: "plum", theme: arcLight }, true, false);
  const follows = profileTheme({ color: "plum", theme: arcLight }, true, true);
  assert.equal(own.dark, false, "off: the theme keeps its own Light");
  assert.equal(follows.dark, true, "on: it follows the dark app");
  const stop = (t) => t.backdrop.themeColors.slice(0, 3);
  const ownDark = profileTheme({ color: "plum", theme: { ...arcLight, mode: "dark" } }, true, false);
  assert.deepEqual(stop(ownDark), [0.95, 0.92, 0.89], "a theme's own Dark keeps its colours");
  stop(follows).forEach((v, i) => assert.ok(Math.abs(v - [0.95, 0.92, 0.89][i] * 0.4) < 1e-9, "its colour stops are darkened to 40% so white text reads"));
  assert.equal(follows.backdrop.themeAppearance, "auto", "the window follows the app too");
});

test("in a light app nothing changes", () => {
  const own = profileTheme({ color: "plum", theme: arcLight }, false, false);
  const follows = profileTheme({ color: "plum", theme: arcLight }, false, true);
  assert.equal(follows.dark, false);
  assert.deepEqual(follows.windowTint, own.windowTint);
});
