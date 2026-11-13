import assert from "node:assert/strict";
import { test } from "node:test";

const { switcherCapsuleEnds, switcherCellWidth, switcherRoom } = await import("./switcherBand.ts");
const { SIDEBAR_FOOTER_DOWNLOADS } = await import("../sidebar/geometry.ts");
const { SIDEBAR_MIN_WIDTH } = await import("../sidebar/tokens.ts");
const { DEFAULT_SIDEBAR_WIDTH } = await import("../../lib/windowLayout.ts");

const dots = (n) => Array.from({ length: n }, () => null);
const icons = (n) => Array.from({ length: n }, () => "symbol:house.fill");
const downloadsRight = SIDEBAR_FOOTER_DOWNLOADS.left + SIDEBAR_FOOTER_DOWNLOADS.size;

function capsuleLeftEdge(width, marks, ends) {
  const cells = marks.reduce((sum, icon) => sum + switcherCellWidth(icon), 0);
  return (width - (cells + ends.left + ends.right)) / 2;
}

test("a capsule beside Downloads never reaches the button, at any width or count", () => {
  for (let width = SIDEBAR_MIN_WIDTH; width <= 400; width += 5)
    for (const marks of [...Array.from({ length: 14 }, (_, i) => dots(i + 2)), ...Array.from({ length: 8 }, (_, i) => icons(i + 2))]) {
      const ends = switcherCapsuleEnds(marks, switcherRoom(width, true));
      if (ends) assert.ok(capsuleLeftEdge(width, marks, ends) > downloadsRight, `${marks.length} marks at ${width} pt`);
    }
});

test("the reviewer's crowded footers drop the capsule and keep the marks", () => {
  assert.equal(switcherCapsuleEnds(dots(6), switcherRoom(SIDEBAR_MIN_WIDTH, true)), null);
  assert.equal(switcherCapsuleEnds(dots(9), switcherRoom(DEFAULT_SIDEBAR_WIDTH, true)), null);
  assert.deepEqual(switcherCapsuleEnds(dots(4), switcherRoom(SIDEBAR_MIN_WIDTH, true)), { left: 8, right: 8 });
  assert.deepEqual(switcherCapsuleEnds(dots(7), switcherRoom(DEFAULT_SIDEBAR_WIDTH, true)), { left: 8, right: 8 });
});

test("without Downloads the capsule keeps the sidebar's own inset", () => {
  assert.deepEqual(switcherCapsuleEnds(dots(9), switcherRoom(SIDEBAR_MIN_WIDTH, false)), { left: 8, right: 8 });
  assert.equal(switcherCapsuleEnds(dots(11), switcherRoom(SIDEBAR_MIN_WIDTH, false)), null);
});

test("each end centres its own mark in the round end", () => {
  assert.deepEqual(switcherCapsuleEnds(["symbol:house.fill", null, null], 400), { left: 1, right: 8 });
  assert.deepEqual(switcherCapsuleEnds(icons(3), 400), { left: 1, right: 1 });
});
