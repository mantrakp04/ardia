import assert from "node:assert/strict";
import { test } from "node:test";
const { overPins, pinGrid, pinGridHeight, pinSlot, PIN_ZONE_HYSTERESIS } = await import("./pinZone.ts");

const TILE = 41;
const grid = { x: 6, y: 54, w: 178 };

test("the grid lays out the count it will have after the drop", () => {
  assert.deepEqual(pinGrid(3, 178), { columns: 3, width: 55 });
  assert.deepEqual(pinGrid(4, 178), { columns: 2, width: 86 });
  assert.deepEqual(pinGrid(2, 178), { columns: 2, width: 86 });
  assert.deepEqual(pinGrid(4, 240), { columns: 4, width: 55.5 });
  assert.deepEqual(pinGrid(0, 178), { columns: 1, width: 178 });
});

test("the rows stay balanced as in Arc, at most four across", () => {
  const columns = (n, w) => pinGrid(n, w).columns;
  assert.equal(columns(5, 451), 3);
  assert.equal(columns(5, 295), 3);
  assert.equal(columns(5, 147), 2);
  assert.equal(columns(4, 408), 4);
  assert.equal(columns(4, 261), 4);
  assert.equal(columns(4, 168), 2);
  assert.equal(columns(9, 432), 3);
  assert.equal(columns(9, 290), 3);
  assert.equal(columns(9, 180), 3);
  assert.equal(columns(9, 144), 2);
  assert.equal(columns(7, 400), 4);
  assert.equal(columns(6, 400), 3);
  assert.equal(columns(3, 400), 3);
});

test("a full row never overflows the grid", () => {
  for (let w = 120; w <= 400; w += 0.5)
    for (let n = 1; n <= 12; n++) {
      const { columns, width } = pinGrid(n, w);
      assert.ok(columns * width + (columns - 1) * 6 <= w + 1e-9, `${n} tiles in ${w}`);
    }
});

test("the slot under the pointer is the tile's index after the drop", () => {
  assert.equal(pinSlot(grid, 3, TILE, 30, 74), 0);
  assert.equal(pinSlot(grid, 3, TILE, 95, 74), 1);
  assert.equal(pinSlot(grid, 3, TILE, 155, 74), 2);
  assert.equal(pinSlot(grid, 3, TILE, 155, 105), 2);
  assert.equal(pinSlot(grid, 4, TILE, 155, 74), 1);
  assert.equal(pinSlot(grid, 4, TILE, 30, 120), 2);
  assert.equal(pinSlot(grid, 4, TILE, 155, 120), 3);
  assert.equal(pinSlot(grid, 5, TILE, 155, 74), 2);
  assert.equal(pinSlot(grid, 5, TILE, 155, 160), 4);
  assert.equal(pinSlot(grid, 4, TILE, -40, 10), 0);
});

test("a sideways drag below the tiles stays on the same row's slots", () => {
  const slots = [30, 60, 95, 120, 155].map((x) => pinSlot(grid, 3, TILE, x, 54 + TILE + 10));
  assert.deepEqual(slots, [0, 0, 1, 1, 2]);
});

test("the pin zone reaches the list, and the boundary doesn't flip-flop", () => {
  const list = 117;
  assert.equal(overPins(105, list, false), true);
  assert.equal(overPins(list - 2, list, false), false);
  assert.equal(overPins(list - 2, list, true), true);
  assert.equal(overPins(list + PIN_ZONE_HYSTERESIS - 1, list, true), true);
  assert.equal(overPins(list + PIN_ZONE_HYSTERESIS + 1, list, true), false);
  let over = true;
  const flips = [];
  for (const y of [110, 116, 119, 121, 118, 122, 117, 115, 112, 110]) {
    const next = overPins(y, list, over);
    if (next !== over) flips.push(y);
    over = next;
  }
  assert.deepEqual(flips, []);
});

test("the grid's height is its row count after the drop", () => {
  assert.equal(pinGridHeight(3, 178, TILE), 41);
  assert.equal(pinGridHeight(4, 178, TILE), 88);
  assert.equal(pinGridHeight(2, 178, TILE), 41);
  assert.equal(pinGridHeight(0, 178, TILE), 41);
  assert.equal(pinGridHeight(7, 178, TILE), 135);
});
