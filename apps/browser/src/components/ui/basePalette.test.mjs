import assert from "node:assert/strict";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

globalThis.__DEV__ = false;

const { useBrowser } = await import("../../state/browser/store.ts");
const { useBasePalette } = await import("../../state/config/basePalette.ts");
const { useProfileLook } = await import("../../state/profiles/hooks.ts");
const { mergedPalettes } = await import("../../lib/themeFile.ts");
const { profileTheme, scopedTheme, themeFor } = await import("./theme.ts");
const { siteScopedTheme, toolbarPalette } = await import("./toolbarColors.ts");
const { colorRoles } = await import("./tokens.ts");

const S = () => useBrowser.getState();
const nord = (revision, accent = "#88C0D0") =>
  mergedPalettes(colorRoles, { dark: { accent, faviconTile: "#111111" }, light: { panel: "#ECEFF4", faviconTile: "#EEEEEE" } }, revision);

test("the file's roles are the base under profile colours and custom themes, and incognito gets the dark ones", () => {
  const palette = nord(1);
  assert.equal(themeFor("plum:dark", palette).accent, "#88C0D0");
  assert.equal(themeFor("plum:dark", palette).backdrop, themeFor("plum:dark", palette).backdrop);
  assert.deepEqual(themeFor("blue:dark", palette).windowTint, themeFor("blue:dark").windowTint, "profile colours still add their tint");
  assert.equal(themeFor("plum:light", palette).panel, "#ECEFF4");
  assert.equal(themeFor("incognito", palette).accent, "#88C0D0");
  assert.equal(themeFor("plum:dark").accent, colorRoles.dark.accent);
  const custom = { color: "plum", theme: { stops: [{ x: 0.5, y: 0.5, color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } }], intensity: 0.6, mode: "dark", grain: 0.2, texture: "grain", translucency: 1 } };
  assert.equal(profileTheme(custom, true, "own", palette).accent, "#88C0D0");
  assert.equal(scopedTheme(true, undefined, false, "own", palette).panel, colorRoles.dark.panel);
});

test("every cache built from roles depends on the palette: a new revision gives new themes, toolbar palettes and site themes", () => {
  const a = nord(1);
  const b = nord(2, "#123456");
  assert.notEqual(themeFor("plum:dark", a), themeFor("plum:dark", b));
  assert.equal(themeFor("plum:dark", a), themeFor("plum:dark", a));
  assert.equal(themeFor("plum:dark", b).accent, "#123456");
  const themed = themeFor("plum:dark", a);
  assert.notEqual(toolbarPalette(themed, null), toolbarPalette(themeFor("plum:dark"), null));
  const site = siteScopedTheme(themed, toolbarPalette(themed, "#FFFFFF"));
  assert.equal(site.faviconTile, "#EEEEEE", "a light site toolbar takes the light palette's role from the file");
});

test("a profile look reruns when the base palette changes, even while profile, appearance and settings stay the same", () => {
  S().hydrate({});
  S().createWindow({ url: "https://a.com/" });
  const id = S().settings.defaultProfileId;
  useBasePalette.setState({ palette: null, theme: null });
  const h = mount(() => useProfileLook(id, (profile, appDark, settings, palette) => profileTheme(profile, true, "own", palette)));
  assert.equal(h.value.accent, colorRoles.dark.accent);
  useBasePalette.setState({ palette: nord(5), theme: "nord" });
  assert.equal(h.value.accent, "#88C0D0");
  useBasePalette.setState({ palette: null, theme: null });
  assert.equal(h.value.accent, colorRoles.dark.accent);
});
