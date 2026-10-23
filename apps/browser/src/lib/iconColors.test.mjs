import assert from "node:assert/strict";
import { test } from "node:test";
import { duotoneColors, iconContrast } from "./iconColors.ts";

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
