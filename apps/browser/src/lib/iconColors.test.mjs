import assert from "node:assert/strict";
import { test } from "node:test";
import { duotoneColors, iconContrast, iconSurfaces } from "./iconColors.ts";

test("duotone outlines remain visible for very bright and very dark selected colors", () => {
  for (const background of ["#FFFFFF", "#2A2A2A"])
    for (const primary of ["#FFFFFF", "#000000", "#E3AC38", "#4691C3", "#C07A98"]) {
      const result = duotoneColors([primary, "#27B88A"], background, background !== "#FFFFFF");
      assert.ok(iconContrast(result.foreground, background) >= 3, `${primary} on ${background}`);
      assert.equal(result.fill, "#27B88A");
    }
});

test("both selected theme colors update without retaining the previous palette", () => {
  const first = duotoneColors(["#9050B0", "#1BB0B0"], "#FFFFFF", false);
  const second = duotoneColors(["#B05030", "#C0D020"], "#FFFFFF", false);
  assert.notEqual(first.foreground, second.foreground);
  assert.notEqual(first.fill, second.fill);
  assert.deepEqual(duotoneColors(["#9050B0", "#1BB0B0"], "#FFFFFF", false), first);
});

test("a single selected color produces both tones and missing colors remain readable", () => {
  assert.equal(duotoneColors(["#4691C3"], "#FFFFFF", false).fill, "#4691C3");
  for (const dark of [false, true]) {
    const background = dark ? "#2A2A2A" : "#FFFFFF";
    const result = duotoneColors(["invalid"], background, dark);
    assert.ok(iconContrast(result.foreground, background) >= 3);
  }
});


test("icon surfaces composite ordered hex-alpha and rgba fills over each gradient endpoint", () => {
  assert.deepEqual(iconSurfaces(["#000000", "#FFFFFF"], "#FF000080"), ["#800000", "#FF7F7F"]);
  assert.deepEqual(iconSurfaces("#000000", "rgba(255,255,255,0.5)", "rgba(0,0,0,0.5)"), ["#404040"]);
  assert.deepEqual(iconSurfaces("#FFFFFF", "#00000000", null, undefined, "transparent"), ["#FFFFFF"]);
  assert.deepEqual(iconSurfaces(["#FFFFFF", "#FFFFFF"]), ["#FFFFFF"]);
});

test("duotone contrast follows tinted sidebar gradients and translucent row fills", () => {
  const cases = [
    { palette: ["#D37B8B", "#27B88A"], surface: ["#E7CFD3", "#F2E7E9"], overlay: "rgba(255,255,255,0.55)", dark: false },
    { palette: ["#7873AF", "#27B88A"], surface: ["#26222E", "#353037"], overlay: "rgba(255,255,255,0.16)", dark: true },
  ];
  for (const { palette, surface, overlay, dark } of cases) {
    for (const backgrounds of [surface, iconSurfaces(surface, overlay)]) {
      const tones = duotoneColors(palette, backgrounds, dark);
      assert.equal(tones.fill, palette[1]);
      for (const background of backgrounds) assert.ok(iconContrast(tones.foreground, background) >= 3, `${tones.foreground} on ${background}`);
    }
  }
});

test("gradient interiors are included when choosing a readable duotone outline", () => {
  const backgrounds = ["#FF0000", "#0000FF"];
  const tones = duotoneColors(["#777777", "#27B88A"], backgrounds, true);
  for (let step = 0; step <= 100; step++) {
    const red = Math.round(255 * (1 - step / 100));
    const blue = Math.round(255 * step / 100);
    const surface = `#${red.toString(16).padStart(2, "0")}00${blue.toString(16).padStart(2, "0")}`;
    assert.ok(iconContrast(tones.foreground, surface) >= 3, `${tones.foreground} on ${surface}`);
  }
  assert.equal(tones.fill, "#27B88A");
});

test("duotone contrast remains readable through pressed rows, pinned docks and colored group layers", () => {
  const background = ["#26222E", "#353037"];
  const layers = [
    ["rgba(255,255,255,0.31)"],
    ["rgba(255,255,255,0.1)", "rgba(255,255,255,0.25)"],
    ["#E3AC3829"],
    ["#E3AC3829", "rgba(255,255,255,0.31)"],
    ["#E3AC3829", "rgba(18,18,18,0.5)"],
  ];
  for (const palette of [["#4691C3"], ["#7873AF"]]) {
    for (const fills of layers) {
      const surfaces = iconSurfaces(background, ...fills);
      const tones = duotoneColors(palette, surfaces, true);
      for (const surface of surfaces) assert.ok(iconContrast(tones.foreground, surface) >= 3, `${fills} on ${surface}`);
    }
  }
});
