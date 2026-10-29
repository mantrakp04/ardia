import assert from "node:assert/strict";
import { test } from "node:test";
import { reorderPoint, SIDEBAR_ROW_SCRIPT } from "../scenarios/d-drag.mjs";

function node(text, box, parent = null, hover = false) {
  return {
    innerText: text,
    parentElement: parent,
    getBoundingClientRect: () => ({ ...box, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }),
    closest: (selector) => (hover && selector === '[data-testid="ardia-sidebar-hover"]' ? {} : null),
  };
}

function sidebarDom() {
  const body = node("Field page\nLink page\nField page", { x: 0, y: 0, width: 1920, height: 1080 });
  const list = node("Field page\nLink page", { x: 5, y: 80, width: 250, height: 80 }, body);
  const fieldRow = node("Field page", { x: 9, y: 90, width: 242, height: 34 }, list);
  const fieldLabel = node("Field page", { x: 44, y: 99, width: 120, height: 16 }, fieldRow);
  const linkRow = node("Link page", { x: 9, y: 126, width: 242, height: 34 }, list);
  const linkLabel = node("Link page", { x: 44, y: 135, width: 110, height: 16 }, linkRow);
  const hover = node("Field page", { x: 262, y: 60, width: 264, height: 110 }, body, true);
  const hoverTitle = node("Field page", { x: 276, y: 72, width: 90, height: 14 }, hover, true);
  const all = [list, fieldRow, fieldLabel, linkRow, linkLabel, hover, hoverTitle];
  body.querySelectorAll = () => all;
  return body;
}

function evaluate(script, body) {
  const previous = globalThis.document;
  globalThis.document = { body };
  try {
    return (0, eval)(script);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

test("a sidebar row is found by its title, skipping the hover card's smaller title, and measured as the whole row", () => {
  const field = evaluate(SIDEBAR_ROW_SCRIPT("Field page"), sidebarDom());
  assert.deepEqual(field, { x: 130, y: 107, top: 90, width: 242, height: 34 });
  assert.equal(evaluate(SIDEBAR_ROW_SCRIPT("Missing page"), sidebarDom()), null);
});

test("a reorder drop aims inside the row's top quarter even after the drag's four-pixel wiggle", () => {
  const field = evaluate(SIDEBAR_ROW_SCRIPT("Field page"), sidebarDom());
  const point = reorderPoint(field);
  assert.equal(point.x, field.x);
  assert.ok(point.y > field.top && point.y + 4 < field.top + field.height / 4, JSON.stringify(point));
});
