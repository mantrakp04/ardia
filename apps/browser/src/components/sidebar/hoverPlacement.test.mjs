import assert from "node:assert/strict";
import { test } from "node:test";
import { HOVER_CARD_GAP, HOVER_CARD_HEADER, HOVER_CARD_PAD, hoverCardAt, hoverCardBox, sidebarEdgeOf } from "./hoverPlacement.ts";

const LEFT = { side: "left", windowWidth: 1200, sidebarEdge: 250 };
const RIGHT = { side: "right", windowWidth: 1200, sidebarEdge: 950 };
const ROW = { x: 9, y: 120, width: 232, height: 34 };
const RIGHT_ROW = { x: 959, y: 120, width: 232, height: 34 };

test("left sidebar: the card keeps the card gap from the page's edge, not the row's", () => {
  const at = hoverCardAt(ROW, LEFT);
  assert.equal(at.x, 250 + HOVER_CARD_GAP);
  assert.deepEqual(hoverCardBox(at, LEFT), { left: 258, top: at.top });
});

test("right sidebar: the card opens leftward, the same gap short of the page's edge", () => {
  const at = hoverCardAt(RIGHT_ROW, RIGHT);
  assert.equal(at.x, 950 - HOVER_CARD_GAP);
  assert.deepEqual(hoverCardBox(at, RIGHT), { right: 1200 - 942, top: at.top });
});

test("the card's icon and title line up with the hovered row's", () => {
  const at = hoverCardAt(ROW, LEFT);
  assert.equal(at.top + HOVER_CARD_PAD + HOVER_CARD_HEADER / 2, ROW.y + ROW.height / 2);
});

test("the top clamps 8 pt inside the window on both sides", () => {
  assert.equal(hoverCardAt({ ...ROW, y: 0 }, LEFT).top, 8);
  assert.equal(hoverCardAt({ ...RIGHT_ROW, y: 0 }, RIGHT).top, 8);
});

test("a Top Apps tile's card clears the sidebar instead of covering the tiles beside it", () => {
  for (const tile of [{ x: 9, y: 54, width: 53.5, height: 41 }, { x: 68.5, y: 101, width: 53.5, height: 41 }, { x: 187.5, y: 54, width: 53.5, height: 41 }]) {
    assert.equal(hoverCardAt(tile, LEFT).x, 250 + HOVER_CARD_GAP);
  }
  assert.equal(hoverCardAt({ x: 1138, y: 54, width: 53.5, height: 41 }, RIGHT).x, 950 - HOVER_CARD_GAP);
});

test("a card for something past the sidebar's edge still opens beside it", () => {
  assert.equal(hoverCardAt({ x: 240, y: 60, width: 60, height: 40 }, LEFT).x, 300 + HOVER_CARD_GAP);
  assert.equal(hoverCardAt({ x: 900, y: 60, width: 60, height: 40 }, RIGHT).x, 900 - HOVER_CARD_GAP);
});

test("a peeking sidebar's card keeps the gap from the floating panel's edge", () => {
  assert.equal(sidebarEdgeOf("left", 1200, 250, [-Infinity, 255]), 255);
  assert.equal(sidebarEdgeOf("right", 1200, 250, [945, Infinity]), 945);
  assert.equal(sidebarEdgeOf("left", 1200, 250, undefined), 250);
  assert.equal(sidebarEdgeOf("right", 1200, 250, undefined), 950);
  const tile = { x: 133, y: 63, width: 53.5, height: 41 };
  assert.equal(hoverCardAt(tile, { side: "left", windowWidth: 1200, sidebarEdge: 255 }).x, 255 + HOVER_CARD_GAP);
});
