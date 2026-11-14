import assert from "node:assert/strict";
import { test } from "node:test";
import { backdropStops, choiceAfterMatchToggle, lookForApp, lookOf, presetLook, showsTheme, spaceTone, windowTintStops } from "./profileLook.ts";

const presets = [
  { key: "plum", swatch: "#C07A98", tint: "#B25B6B" },
  { key: "blue", swatch: "#4691C3" },
  { key: "green", swatch: "#3EB489" },
  { key: "neutral", swatch: "#8E8E93" },
];

const plum = presetLook(presets[0]!);
const macTheme = { color: null, theme: { colors: ["#FF6A00", "#7A3CFF"], darkColors: ["#401A00", "#1E0F40"] } };

test("a preset keeps the window tint the app always had", () => {
  assert.deepEqual(windowTintStops(plum, false), ["#E7CFD3", "#F2E7E9"]);
  assert.deepEqual(windowTintStops(plum, true), ["#342123", "#3B3031"]);
  assert.deepEqual(windowTintStops(presetLook(presets[1]!), false), ["#D0DDE7", "#E7EDF2"]);
  assert.deepEqual(windowTintStops(presetLook(presets[3]!), true), ["#1F1B1A", "#231F1E"]);
  assert.equal(presetLook(presets[1]!).tint, "#5B8FB2");
});

test("a Mac theme tints the windows from the mix of its colours, not the nearest preset", () => {
  const look = lookOf(macTheme, presets, "plum");
  assert.equal(look.preset, null);
  assert.equal(look.swatch, "#BD5380");
  assert.equal(look.tint, "#B25B80");
  assert.equal(look.isNeutral, false);
  assert.deepEqual(windowTintStops(look, false), ["#E7CFD9", "#F2E7EB"]);
});

test("the start page draws the Mac's own gradient, with its dark colours in dark mode", () => {
  const look = lookOf(macTheme, presets, "plum");
  assert.equal(showsTheme(look, false, true), true);
  assert.deepEqual(backdropStops(look, false, true), ["#FF6A00", "#7A3CFF"]);
  assert.deepEqual(backdropStops(look, true, true), ["#401A00", "#1E0F40"]);
  assert.deepEqual(backdropStops(look, false, false), windowTintStops(look, false));
  const lightOnly = lookOf({ color: null, theme: { colors: ["#FF6A00", "#7A3CFF"], darkColors: null } }, presets, "plum");
  assert.deepEqual(backdropStops(lightOnly, true, true), ["#FF6A00", "#7A3CFF"]);
});

test("a one-colour theme or a plain colour has no gradient to draw", () => {
  const single = lookOf({ color: null, theme: { colors: ["#FF6A00"], darkColors: null } }, presets, "plum");
  assert.equal(showsTheme(single, false, true), false);
  assert.deepEqual(backdropStops(single, false, true), windowTintStops(single, false));
});

test("a Mac colour that is a preset is that preset, by name or by hex", () => {
  assert.equal(lookOf({ color: "#4691C3", theme: null }, presets, "plum").preset, "blue");
  assert.equal(lookOf({ color: "Green", theme: null }, presets, "plum").preset, "green");
  assert.equal(lookOf({ color: "#4691C4", theme: null }, presets, "plum").preset, null);
  assert.equal(lookOf({ color: null, theme: null }, presets, "plum").preset, "plum");
});

test("a grey Mac theme is neutral and tints grey", () => {
  const look = lookOf({ color: null, theme: { colors: ["#808080", "#7A7A7A"], darkColors: null } }, presets, "plum");
  assert.equal(look.isNeutral, true);
  assert.equal(look.tint, "#868686");
});

test("a chosen colour wins over the Mac, and Match My Mac needs sync", () => {
  assert.equal(lookForApp("green", true, macTheme, presets, "plum").preset, "green");
  assert.equal(lookForApp(null, true, macTheme, presets, "plum").swatch, "#BD5380");
  assert.equal(lookForApp(null, false, macTheme, presets, "plum").preset, "plum");
  assert.equal(lookForApp(null, true, null, presets, "plum").preset, "plum");
});

test("turning Match My Mac off keeps the Mac's colour when it is a preset, else goes back to plum", () => {
  assert.equal(choiceAfterMatchToggle(true, plum, "plum"), null);
  assert.equal(choiceAfterMatchToggle(false, lookOf({ color: "#4691C3", theme: null }, presets, "plum"), "plum"), "blue");
  assert.equal(choiceAfterMatchToggle(false, lookOf(macTheme, presets, "plum"), "plum"), "plum");
});

test("synced Spaces take the shown profile's own colours, softened toward the background", () => {
  assert.deepEqual(spaceTone(macTheme, false, false, presets, "plum"), ["#FFE1CC", "#E4D8FF"]);
  assert.deepEqual(spaceTone(macTheme, true, false, presets, "plum"), ["#301400", "#160B30"]);
  assert.deepEqual(spaceTone({ color: "blue", theme: null }, false, false, presets, "plum"), ["#DAE9F3", "#D3E5F1"]);
  assert.deepEqual(spaceTone(null, true, false, presets, "plum"), ["#412934", "#36222B"]);
});
