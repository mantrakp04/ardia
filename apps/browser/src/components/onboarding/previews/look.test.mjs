import assert from "node:assert/strict";
import { test } from "node:test";
const { lookFor } = await import("./look.ts");
const { mergedPalettes } = await import("../../../lib/themeFile.ts");
const { colorRoles, PROFILE_COLORS } = await import("../../ui/tokens.ts");

test("onboarding previews draw with the effective palette and rebuild when its revision changes", () => {
  const plum = PROFILE_COLORS.plum.swatch;
  assert.equal(lookFor(true, plum, null).t.panel, colorRoles.dark.panel);
  const nord = mergedPalettes(colorRoles, { dark: { panel: "#2E3440" }, light: {} }, 1);
  assert.equal(lookFor(true, plum, nord).t.panel, "#2E3440");
  assert.equal(lookFor(true, plum, nord), lookFor(true, plum, nord));
  const red = mergedPalettes(colorRoles, { dark: { panel: "#BF616A" }, light: {} }, 2);
  assert.equal(lookFor(true, plum, red).t.panel, "#BF616A");
  assert.equal(lookFor(true, plum, null).t.panel, colorRoles.dark.panel);
});
