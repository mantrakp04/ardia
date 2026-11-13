import assert from "node:assert/strict";
import test from "node:test";
import {
  deckCardAt,
  deckDragKind,
  deckGeometry,
  deckLeading,
  deckLift,
  deckScrollDuringDrag,
  deckSettleTarget,
  deckSettleVelocity,
  deckShouldClose,
  deckVisibleWidth,
  focusedIndex,
  initialDeckScroll,
  openingDeckScroll,
  scrollAfterRemoving,
  titleReveal,
} from "./deckGeometry.ts";

const pixel7 = deckGeometry(412, 915, 48, 24);

test("the deck geometry matches Compose's TabsDeckGeometry for a Pixel 7", () => {
  assert.equal(pixel7.focusLeading, 412 * (66 / 440));
  assert.equal(pixel7.spacing, Math.min(pixel7.cardWidth, 412 * (218 / 440)));
  assert.equal(deckLeading(pixel7, 0), pixel7.focusLeading);
  assert.equal(deckLeading(pixel7, 2), pixel7.focusLeading + 2 * pixel7.spacing);
  assert.ok(deckLeading(pixel7, -1) > 0 && deckLeading(pixel7, -1) < pixel7.focusLeading);
  assert.ok(deckLeading(pixel7, -10) > -1, "cards to the left pile up at the edge instead of leaving the screen");
  assert.equal(deckVisibleWidth(pixel7, 0, true), pixel7.cardWidth);
  assert.equal(deckVisibleWidth(pixel7, 0, false), pixel7.spacing);
});

test("a drag that starts upward on a card lifts it; anything else scrolls the deck", () => {
  assert.equal(deckDragKind(1, 3, -20), "lift");
  assert.equal(deckDragKind(1, -30, -20), "scroll");
  assert.equal(deckDragKind(1, 2, 20), "scroll");
  assert.equal(deckDragKind(-1, 0, -40), "scroll");
  assert.equal(deckLift(-80), -80);
  assert.equal(deckLift(50), 6);
});

test("a lifted card closes on a flick or past a third of its height, and not when pulled down", () => {
  const h = pixel7.cardHeight;
  assert.equal(deckShouldClose(-40, -900, h), true);
  assert.equal(deckShouldClose(-h / 3 - 1, 0, h), true);
  assert.equal(deckShouldClose(-h / 3 - 1, 400, h), false);
  assert.equal(deckShouldClose(-h / 4, -100, h), false);
  assert.equal(deckShouldClose(30, -900, h), false);
});

test("a horizontal drag scrolls a card per spacing, rubber-bands past the ends and settles to the projected card", () => {
  assert.equal(deckScrollDuringDrag(pixel7, 1, -pixel7.spacing, 4), 2);
  assert.ok(deckScrollDuringDrag(pixel7, 0, pixel7.spacing * 2, 4) > -1);
  assert.ok(deckScrollDuringDrag(pixel7, 3, -pixel7.spacing * 3, 4) < 4);
  assert.equal(deckSettleTarget(pixel7, 1.2, 0, 4), 1);
  assert.equal(deckSettleTarget(pixel7, 1.2, -2000, 4), 3);
  assert.equal(deckSettleTarget(pixel7, 1.2, 2000, 4), 0);
  assert.equal(deckSettleTarget(pixel7, 9, 0, 4), 3);
  assert.equal(deckSettleVelocity(pixel7, 2, 2, -500), 0);
  assert.ok(deckSettleVelocity(pixel7, 1.5, 2, -500) > 0);
});

test("a tap lands on the topmost card under it", () => {
  const y = pixel7.cardCenterY;
  assert.equal(deckCardAt(pixel7, 3, 1, deckLeading(pixel7, 0) + 10, y), 1);
  assert.equal(deckCardAt(pixel7, 3, 1, deckLeading(pixel7, 1) + 10, y), 2);
  assert.equal(deckCardAt(pixel7, 3, 1, 200, 2), -1);
});

test("the deck opens where Compose's DeckOrder does, and keeps focus sensible after a close", () => {
  assert.equal(initialDeckScroll(5), 3);
  assert.equal(initialDeckScroll(1), 0);
  assert.equal(openingDeckScroll(4, 5), 3);
  assert.equal(openingDeckScroll(2, 5), 2);
  assert.equal(scrollAfterRemoving(0, 2, 3), 1);
  assert.equal(scrollAfterRemoving(3, 3, 3), 2);
  assert.equal(focusedIndex(-0.4, 3), 0);
});

test("a header's title fades in between 52 and 84 points of visible card", () => {
  assert.equal(titleReveal(40), 0);
  assert.equal(titleReveal(68), 0.5);
  assert.equal(titleReveal(200), 1);
});
