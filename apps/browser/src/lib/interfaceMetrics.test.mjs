import assert from "node:assert/strict";
import { test } from "node:test";
import { interfaceMetrics, INTERFACE_SIZES, normalizeInterfaceSize, scaleMetrics, scaleTextMetrics } from "./interfaceMetrics.ts";
import { toolbarRowOf, urlFieldOf } from "./toolbarRow.ts";
for (const preset of INTERFACE_SIZES) test(`${preset}: row, toolbar and field use the same factor`, () => {
  const m = interfaceMetrics(preset);
  assert.equal(m.rowHeight, 34 * m.factor);
  assert.equal(m.rowGap, 3 * m.factor);
  for (const compact of [false, true]) {
    const row = toolbarRowOf(compact, preset);
    const base = toolbarRowOf(compact);
    assert.equal(row.height, base.height * m.factor);
    assert.equal(urlFieldOf(row).top + row.field / 2, row.center);
  }
  assert.ok(Object.isFrozen(m));
});
test("150% text and rows are 19.5 and 51 points; invalid values use 100%", () => {
  assert.equal(13 * interfaceMetrics("150").factor, 19.5);
  assert.equal(interfaceMetrics("150").rowHeight, 51);
  for (const bad of [undefined, null, 150, "175", {}, ""]) assert.equal(normalizeInterfaceSize(bad), "100");
  const baseline = Object.freeze({ height: 34, fontSize: 13, opacity: 0.5 });
  assert.equal(scaleMetrics(baseline, 1.5).height, 51);
  assert.deepEqual(baseline, { height: 34, fontSize: 13, opacity: 0.5 });
});

test("resolved baseline text overrides scale once", () => {
  const baseline = { fontSize: 13, lineHeight: 18, letterSpacing: 0.2 };
  assert.deepEqual(scaleTextMetrics(baseline, 1.5), { fontSize: 19.5, lineHeight: 27, letterSpacing: 0.30000000000000004 });
  assert.equal(scaleTextMetrics({ ...baseline, fontSize: 16 }, 1.5).fontSize, 24);
  assert.equal(baseline.fontSize, 13);
});


test("glyph sizes stay baseline while their frames grow", () => {
  for (const preset of INTERFACE_SIZES) {
    const { factor } = interfaceMetrics(preset);
    const resolved = scaleMetrics({ glyph: 13, glyphBox: 16, opacity: 0.5 }, factor);
    assert.equal(resolved.glyph, 13);
    assert.equal(resolved.glyphBox, 16 * factor);
    assert.equal(resolved.opacity, 0.5);
  }
});
