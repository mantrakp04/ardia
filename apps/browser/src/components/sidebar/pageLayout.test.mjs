import assert from "node:assert/strict";
import { test } from "node:test";
const { pageLayout } = await import("./pageLayout.ts");

const ROW = 41;
const gridHeight = (count) => Math.ceil(count / 3) * ROW;
const at = (overrides) =>
  pageLayout({ tiles: 3, previewed: 3, dockRoom: 300, gridHeight, dragging: false, fixedBeforeDrag: true, listHeight: 0, dockAbove: Infinity, ...overrides });

test("tiles that fit 40 % of the sidebar stay fixed above the list; a taller dock scrolls with it", () => {
  assert.equal(at({ tiles: 3 }).dockFixed, true);
  assert.equal(at({ tiles: 21, dockRoom: 287 }).dockFixed, true);
  assert.equal(at({ tiles: 24, dockRoom: 287 }).dockFixed, false);
  assert.equal(at({ tiles: 0, dockRoom: -10 }).dockFixed, true);
  assert.equal(at({ tiles: 3, dockRoom: Infinity }).dockFixed, true);
});

test("the fixed or scrolling choice is frozen for a drag", () => {
  assert.equal(at({ tiles: 24, dockRoom: 287, dragging: true, fixedBeforeDrag: true }).dockFixed, true);
  assert.equal(at({ tiles: 3, dragging: true, fixedBeforeDrag: false }).dockFixed, false);
});

test("a drag that previews more tiles than fit caps the dock at its room", () => {
  assert.equal(at({ tiles: 3, previewed: 23, dragging: true, fixedBeforeDrag: true }).capped, true);
  assert.equal(at({ tiles: 3, previewed: 21, dragging: true, fixedBeforeDrag: true }).capped, false);
  assert.equal(at({ tiles: 3, previewed: 23, dragging: false }).capped, false);
  assert.equal(at({ tiles: 30, previewed: 40, dragging: true, fixedBeforeDrag: false }).capped, false);
});

test("New Tab docks once the list passes the height it has to pass", () => {
  assert.equal(at({ listHeight: 600, dockAbove: 599 }).docked, true);
  assert.equal(at({ listHeight: 599, dockAbove: 599 }).docked, false);
  assert.equal(at({ listHeight: 5000, dockAbove: Infinity }).docked, false);
});
