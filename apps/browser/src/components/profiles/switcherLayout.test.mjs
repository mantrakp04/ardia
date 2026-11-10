import assert from "node:assert/strict";
import { test } from "node:test";
const { switcherLayout } = await import("./switcherLayout.ts");
const { profileSwitcher } = await import("./tokens.ts");

const HOUSE = "symbol:house.fill";
const CODE = "symbol:chevron.left.forwardslash.chevron.right";
const ROOM = 174;

test("a row with icons gives a profile without one the same cell as the icons", () => {
  assert.deepEqual(switcherLayout([HOUSE, CODE, null], true, ROOM), {
    marks: [HOUSE, CODE, null],
    cell: profileSwitcher.iconCell,
    icons: true,
    mixed: true,
  });
});

test("a row where every profile has an icon is not mixed", () => {
  const row = switcherLayout([HOUSE, CODE], true, ROOM);
  assert.equal(row.cell, profileSwitcher.iconCell);
  assert.equal(row.mixed, false);
});

test("with the setting off, or no icons at all, the row stays dots in dot cells", () => {
  for (const row of [switcherLayout([HOUSE, CODE, null], false, ROOM), switcherLayout([null, null, null], true, ROOM)]) {
    assert.deepEqual(row, { marks: [null, null, null], cell: profileSwitcher.dotCell, icons: false, mixed: false });
  }
});

test("a mixed row that fits with its dot cells but not at 26 pt each shrinks every cell to one whole point that fits", () => {
  const icons = [...Array(6).fill(HOUSE), null];
  const row = switcherLayout(icons, true, ROOM);
  assert.equal(row.icons, true);
  assert.equal(row.cell, Math.floor(ROOM / 7));
  assert.ok(row.cell * icons.length <= ROOM);
});

test("a row where every profile has an icon never shrinks: it keeps 26 pt cells or falls back to dots", () => {
  assert.equal(switcherLayout(Array(6).fill(HOUSE), true, ROOM).cell, profileSwitcher.iconCell);
  assert.equal(switcherLayout(Array(7).fill(HOUSE), true, ROOM).icons, false);
});

test("a mixed row that doesn't fit even with dot cells falls back to dots, as before", () => {
  assert.equal(switcherLayout([...Array(6).fill(HOUSE), null, null], true, ROOM).icons, false);
});
