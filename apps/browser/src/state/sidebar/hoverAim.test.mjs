import assert from "node:assert/strict";
import { test } from "node:test";
const { cardReach } = await import("./hoverAim.ts");

const leftTileCard = { x: 69, y: 48, width: 264, height: 152 };

test("a point on the card is covered by it, whatever lies beneath", () => {
  assert.equal(cardReach(leftTileCard, { x: 40, y: 96 }, { x: 128, y: 74 }), "covered");
  assert.equal(cardReach(leftTileCard, null, { x: 100, y: 140 }), "covered");
});

test("leaving the left tile down and right toward Unpin keeps aiming at the card", () => {
  const exit = { x: 45, y: 96 };
  assert.equal(cardReach(leftTileCard, exit, { x: 55, y: 104 }), "aiming");
  assert.equal(cardReach(leftTileCard, exit, { x: 66, y: 125 }), "aiming");
});

test("heading away from the card or straight down past it is not aiming", () => {
  const exit = { x: 45, y: 96 };
  assert.equal(cardReach(leftTileCard, exit, { x: 30, y: 110 }), "away");
  assert.equal(cardReach(leftTileCard, exit, { x: 47, y: 260 }), "away");
  assert.equal(cardReach(leftTileCard, null, { x: 55, y: 104 }), "away");
});

test("a card on the anchor's left side is aimed at leftward", () => {
  const card = { x: 10, y: 100, width: 100, height: 80 };
  assert.equal(cardReach(card, { x: 150, y: 140 }, { x: 130, y: 145 }), "aiming");
  assert.equal(cardReach(card, { x: 150, y: 140 }, { x: 170, y: 140 }), "away");
});
