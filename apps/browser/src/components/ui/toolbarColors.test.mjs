import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { profileTheme } = await import("./theme.ts");
const { colorRoles, siteToolbarRoles } = await import("./tokens.ts");
const { siteScopedTheme, toolbarPalette } = await import("./toolbarColors.ts");

const dark = profileTheme(undefined, true);
const light = profileTheme(undefined, false);

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

const { siteGroundTheme, tintTheme, surfaceTheme, inkOn } = await import("./theme.ts");
const { ink } = await import("./tokens.ts");
const { selectionLightnessDelta, MIN_SELECTION_LIGHTNESS } = await import("../../lib/selectionContrast.ts");

const SITE_GROUNDS = ["#FFFFFF", "#F6F3ED", "#E63322", "#808080", "#0D1117", "#000000", "#1DA1F2", "#FFE600"];

test("with no website colour the sidebar keeps the window's own theme", () => {
  assert.equal(siteGroundTheme(dark, null), dark);
  assert.equal(siteGroundTheme(light, null), light);
});

test("the sidebar's ground is the website colour itself, whatever the profile's tint", () => {
  for (const theme of [dark, light, profileTheme({ color: "yellow" }, false)])
    for (const ground of SITE_GROUNDS) assert.deepEqual(siteGroundTheme(theme, ground).windowTint, [ground.toLowerCase(), ground.toLowerCase()]);
});

test("a dark site in a light theme gives the sidebar the dark palette, and a light site the light one", () => {
  assert.equal(siteGroundTheme(light, "#0D1117").dark, true);
  assert.equal(siteGroundTheme(dark, "#F6F3ED").dark, false);
  assert.equal(siteGroundTheme(light, "#0D1117").textPrimary, colorRoles.dark.textPrimary);
});

test("sidebar ink stays readable and the selected tab stays visible on every website colour", () => {
  for (const theme of [dark, light])
    for (const ground of SITE_GROUNDS) {
      const onSite = siteGroundTheme(theme, ground);
      const shown = tintTheme(onSite);
      const own = shown.dark ? ink.white : ink.black;
      assert.equal(inkOn(onSite.windowTint, shown.dark), own, `${ground}: ink`);
      assert.ok(selectionLightnessDelta(onSite.tabSelected, onSite.windowTint) >= MIN_SELECTION_LIGHTNESS - 1e-9, `${ground}: selected tab`);
      assert.equal(surfaceTheme(shown), theme, `${ground}: popovers and tooltips keep the window's own theme`);
      assert.equal(surfaceTheme(onSite), theme, `${ground}: also where the ink didn't have to switch`);
    }
});

test("the same website colour gives the same theme object, in any letter case and with alpha", () => {
  assert.equal(siteGroundTheme(light, "#F6F3ED"), siteGroundTheme(light, "#f6f3ed"));
  assert.equal(siteGroundTheme(light, "#F6F3ED"), siteGroundTheme(light, "#F6F3EDFF"));
  assert.notEqual(siteGroundTheme(light, "#F6F3ED"), siteGroundTheme(dark, "#F6F3ED"));
});
