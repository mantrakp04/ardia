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

test("a row that doesn't fit at one icon cell per profile falls back to dots, mixed or not", () => {
  const fits = Math.floor(ROOM / profileSwitcher.iconCell);
  assert.equal(switcherLayout([...Array(fits - 1).fill(HOUSE), null], true, ROOM).icons, true);
  assert.equal(switcherLayout([...Array(fits).fill(HOUSE), null], true, ROOM).icons, false);
});
