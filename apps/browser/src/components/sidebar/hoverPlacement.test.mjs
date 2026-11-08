import assert from "node:assert/strict";
import { test } from "node:test";
import { HOVER_CARD_GAP, hoverCardAt, hoverCardBox } from "./hoverPlacement.ts";

const LEFT = { side: "left", windowWidth: 1200, sidebarInnerWidth: 184 };
const RIGHT = { side: "right", windowWidth: 1200, sidebarInnerWidth: 184 };
const ROW = { x: 6, y: 120, width: 178, height: 34 };
const RIGHT_ROW = { x: 1016, y: 120, width: 178, height: 34 };

test("left sidebar: the card opens past the row's right edge", () => {
  const at = hoverCardAt(ROW, LEFT);
  assert.deepEqual(at, { x: 184 + HOVER_CARD_GAP, top: 114 });
  assert.deepEqual(hoverCardBox(at, LEFT), { left: 192, top: 114 });
});

test("right sidebar: the card opens leftward, its right edge a gap short of the row", () => {
  const at = hoverCardAt(RIGHT_ROW, RIGHT);
  assert.deepEqual(at, { x: 1016 - HOVER_CARD_GAP, top: 114 });
  assert.deepEqual(hoverCardBox(at, RIGHT), { right: 1200 - 1008, top: 114 });
});

test("the top clamps 8 pt inside the window on both sides", () => {
  assert.equal(hoverCardAt({ ...ROW, y: 2 }, LEFT).top, 8);
  assert.equal(hoverCardAt({ ...RIGHT_ROW, y: 2 }, RIGHT).top, 8);
});

test("a Top Apps tile's card clears the sidebar instead of covering the tiles beside it", () => {
  const firstColumn = { x: 6, y: 60, width: 56, height: 40 };
  const secondRow = { x: 64, y: 104, width: 56, height: 40 };
  assert.equal(hoverCardAt(firstColumn, LEFT).x, 184 + HOVER_CARD_GAP);
  assert.equal(hoverCardAt(secondRow, LEFT).x, 184 + HOVER_CARD_GAP);
  const rightTile = { x: 1138, y: 60, width: 56, height: 40 };
  assert.equal(hoverCardAt(rightTile, RIGHT).x, 1016 - HOVER_CARD_GAP);
});

test("a card for something past the sidebar's edge still opens beside it", () => {
  assert.equal(hoverCardAt({ x: 150, y: 60, width: 60, height: 40 }, LEFT).x, 210 + HOVER_CARD_GAP);
  assert.equal(hoverCardAt({ x: 990, y: 60, width: 60, height: 40 }, RIGHT).x, 990 - HOVER_CARD_GAP);
});
