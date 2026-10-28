import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { profileTheme } = await import("./theme.ts");
const { colorRoles, siteToolbarRoles } = await import("./tokens.ts");
const { isLightBackground, siteScopedTheme, toolbarPalette } = await import("./toolbarColors.ts");

const dark = profileTheme(undefined, true);
const light = profileTheme(undefined, false);

test("light and dark backgrounds split where the toolbar's ink flips", () => {
  assert.equal(isLightBackground("#F3EEE4"), true);
  assert.equal(isLightBackground("#F6F8FC"), true);
  assert.equal(isLightBackground("#1F1F1F"), false);
  assert.equal(isLightBackground("#000000"), false);
});

test("with no website colour the bar keeps the window's own theme", () => {
  const palette = toolbarPalette(dark, null);
  assert.equal(siteScopedTheme(dark, palette), dark);
});

test("a light site in a dark theme gives the bar the toolbar's dark ink", () => {
  const palette = toolbarPalette(dark, "#F3EEE4");
  const scoped = siteScopedTheme(dark, palette);
  assert.equal(scoped.dark, false);
  assert.equal(scoped.textTab, siteToolbarRoles.onLight.text);
  assert.equal(scoped.textTertiary, siteToolbarRoles.onLight.secondary);
  assert.equal(scoped.icon, palette.icon);
  assert.equal(scoped.toolbarHover, palette.hover);
  assert.equal(scoped.toolbarPressed, palette.pressed);
  assert.equal(scoped.divider, palette.divider);
  assert.equal(scoped.faviconTile, colorRoles.light.faviconTile);
  assert.equal(scoped.accent, dark.accent);
});

test("a dark site in a light theme gives the bar the toolbar's light ink", () => {
  const scoped = siteScopedTheme(light, toolbarPalette(light, "#1F1F1F"));
  assert.equal(scoped.dark, true);
  assert.equal(scoped.textTab, siteToolbarRoles.onDark.text);
  assert.equal(scoped.icon, siteToolbarRoles.onDark.icon);
  assert.equal(scoped.faviconTile, colorRoles.dark.faviconTile);
});

test("the same site colour gives the same theme object, so the bar doesn't re-render for nothing", () => {
  assert.equal(siteScopedTheme(dark, toolbarPalette(dark, "#1F1F1F")), siteScopedTheme(dark, toolbarPalette(dark, "#1F1F1F")));
});
