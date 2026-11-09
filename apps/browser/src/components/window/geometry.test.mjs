import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { splitGeometry } = await import("./geometry.ts");
const GAP = 9;

const split = (ids, sizes, orientation = "horizontal") => ({ id: "s", orientation, slots: ids.map((tabId, i) => ({ size: sizes[i], tabId })) });

test("split panes sit the card's 9 pt apart and fill it to the last point, whatever the width's parity", () => {
  for (const width of [1158, 1159, 1160.5, 801]) {
    const { panes, dividers } = splitGeometry(split(["a", "b"], [0.5, 0.5]), width, 700, GAP);
    assert.equal(panes.b.x - (panes.a.x + panes.a.width), GAP, `${width}: the gap`);
    assert.equal(panes.b.x + panes.b.width, width, `${width}: the right pane ends at the card's edge`);
    assert.equal(dividers[0].rect.width, GAP);
  }
  const three = splitGeometry(split(["a", "b", "c"], [1 / 3, 1 / 3, 1 / 3]), 1001, 700, GAP).panes;
  assert.equal(three.c.x + three.c.width, 1001);
  const tall = splitGeometry(split(["a", "b"], [0.5, 0.5], "vertical"), 900, 701, GAP).panes;
  assert.equal(tall.b.y + tall.b.height, 701);
});
