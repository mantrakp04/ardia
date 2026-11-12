import assert from "node:assert/strict";
import { test } from "node:test";
const { BASE_SIDEBAR_METRICS, SIDEBAR_GROUP, SIDEBAR_ROW, SIDEBAR_SCALE, SIDEBAR_SCALES, SIDEBAR_TILE, sidebarMetrics, validSidebarScale } = await import("./sidebarMetrics.ts");

test("the sidebar size runs from 80% to 120% in 5% steps, 90% included, 100% by default", () => {
  assert.deepEqual(SIDEBAR_SCALES, [80, 85, 90, 95, 100, 105, 110, 115, 120]);
  assert.equal(SIDEBAR_SCALE.default, 100);
  for (const v of SIDEBAR_SCALES) assert.ok(validSidebarScale(v), String(v));
  for (const v of [75, 93, 100.5, 125, "90", null, undefined, Number.NaN]) assert.equal(validSidebarScale(v), false, String(v));
});

test("at 100% every metric is today's size, so the default sidebar doesn't move", () => {
  const m = sidebarMetrics(100);
  assert.equal(m, BASE_SIDEBAR_METRICS);
  assert.equal(m.rowHeight, SIDEBAR_ROW.height);
  assert.equal(m.rowGap, SIDEBAR_ROW.gap);
  assert.equal(m.rowPitch, SIDEBAR_ROW.height + SIDEBAR_ROW.gap);
  assert.deepEqual(m.group, {
    indent: SIDEBAR_GROUP.indent,
    border: SIDEBAR_GROUP.border,
    radius: SIDEBAR_GROUP.radius,
    innerRadius: SIDEBAR_GROUP.radius - SIDEBAR_GROUP.border,
    inset: SIDEBAR_GROUP.inset,
    membersPadBottom: SIDEBAR_GROUP.inset - SIDEBAR_GROUP.border,
  });
  assert.deepEqual(m.tile, { height: SIDEBAR_TILE.height, gap: SIDEBAR_TILE.gap, minWidth: SIDEBAR_TILE.minWidth, slot: SIDEBAR_TILE.height + SIDEBAR_TILE.gap });
});

test("a scale lands every size on half points, keeps the hairline border, and grows with the percentage", () => {
  const m = sidebarMetrics(90);
  assert.equal(m.rowHeight, 30.5);
  assert.equal(m.rowGap, 2.5);
  assert.equal(m.tile.height, 37);
  assert.equal(m.group.border, SIDEBAR_GROUP.border);
  assert.equal(m.px(13), 11.5);
  for (const percent of SIDEBAR_SCALES) {
    const s = sidebarMetrics(percent);
    for (const v of [s.rowHeight, s.rowGap, s.tile.height, s.tile.gap, s.group.indent, s.group.radius]) assert.equal(v * 2, Math.round(v * 2), `${percent}: ${v}`);
  }
  const heights = SIDEBAR_SCALES.map((p) => sidebarMetrics(p).rowHeight);
  assert.deepEqual([...heights].sort((a, b) => a - b), heights);
  assert.ok(sidebarMetrics(80).rowHeight < sidebarMetrics(120).rowHeight);
});

test("a percentage outside the choices reads as 100%", () => {
  for (const v of [93, 0, 500, Number.NaN]) assert.equal(sidebarMetrics(v), BASE_SIDEBAR_METRICS, String(v));
  assert.equal(sidebarMetrics(85), sidebarMetrics(85));
});
