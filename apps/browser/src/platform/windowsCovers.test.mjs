import assert from "node:assert/strict";
import { test } from "node:test";
import { holesFor } from "../../../../packages/expo-windows/src/engine/covers.ts";

const card = { x: 100, y: 50, width: 600, height: 400, radius: 12 };
const popover = { x: 650, y: 60, width: 200, height: 100, radius: 8 };

test("a Peek's page keeps the card behind it, and the page under the Peek gets the card's hole", () => {
  const peekPage = { x: 110, y: 90, width: 580, height: 350 };
  const basePage = { x: 0, y: 40, width: 900, height: 600 };
  assert.deepEqual(holesFor(peekPage, [card, popover], true), [[650, 60, 200, 100, 8]], "a popover over part of the Peek still cuts it");
  assert.deepEqual(holesFor(basePage, [card, popover], false), [
    [100, 50, 600, 400, 12],
    [650, 60, 200, 100, 8],
  ]);
  assert.deepEqual(holesFor(peekPage, [card], false), [[100, 50, 600, 400, 12]], "an ordinary page under a cover that encloses it is still hidden");
  assert.deepEqual(holesFor(peekPage, [{ x: 0, y: 0, width: 50, height: 50, radius: 0 }], true), [], "a cover elsewhere cuts nothing");
});
