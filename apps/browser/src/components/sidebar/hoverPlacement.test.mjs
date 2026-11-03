import assert from "node:assert/strict";
import { test } from "node:test";
import { HOVER_CARD_GAP, hoverCardAt, hoverCardBox, playerEdge } from "./hoverPlacement.ts";

const ROW = { x: 6, y: 120, width: 178, height: 34 };
const RIGHT_ROW = { x: 1016, y: 120, width: 178, height: 34 };

test("left sidebar: the card opens past the row's right edge", () => {
  const at = hoverCardAt(ROW, "left");
  assert.deepEqual(at, { x: 184 + HOVER_CARD_GAP, top: 114 });
  assert.deepEqual(hoverCardBox(at, { side: "left", windowWidth: 1200 }), { left: 192, top: 114 });
});

test("right sidebar: the card opens leftward, its right edge a gap short of the row", () => {
  const at = hoverCardAt(RIGHT_ROW, "right");
  assert.deepEqual(at, { x: 1016 - HOVER_CARD_GAP, top: 114 });
  assert.deepEqual(hoverCardBox(at, { side: "right", windowWidth: 1200 }), { right: 1200 - 1008, top: 114 });
});

test("the top clamps 8 pt inside the window on both sides", () => {
  assert.equal(hoverCardAt({ ...ROW, y: 2 }, "left").top, 8);
  assert.equal(hoverCardAt({ ...RIGHT_ROW, y: 2 }, "right").top, 8);
});

test("the mini player clears the sidebar's inner edge on either side", () => {
  const tile = { x: 20, y: 60, width: 40, height: 40 };
  assert.equal(playerEdge(tile, 184, { side: "left", windowWidth: 1200 }), 184);
  const rightTile = { x: 1140, y: 60, width: 40, height: 40 };
  assert.equal(playerEdge(rightTile, 184, { side: "right", windowWidth: 1200 }), 1016);
  assert.equal(playerEdge(RIGHT_ROW, 184, { side: "right", windowWidth: 1200 }), 1016);
});
