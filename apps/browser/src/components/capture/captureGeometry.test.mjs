import assert from "node:assert/strict";
import { test } from "node:test";
const { dragRect, paneUnder } = await import("./captureGeometry.ts");

const card = { width: 1000, height: 700 };

test("a drag makes the same rectangle whichever corner it starts from, kept inside the card", () => {
  assert.deepEqual(dragRect({ x: 100, y: 80 }, { x: 300, y: 200 }, card), { x: 100, y: 80, width: 200, height: 120 });
  assert.deepEqual(dragRect({ x: 300, y: 200 }, { x: 100, y: 80 }, card), { x: 100, y: 80, width: 200, height: 120 });
  assert.deepEqual(dragRect({ x: 900, y: 650 }, { x: 1200, y: 900 }, card), { x: 900, y: 650, width: 100, height: 50 });
  assert.deepEqual(dragRect({ x: 20, y: 20 }, { x: -50, y: -10 }, card), { x: 0, y: 0, width: 20, height: 20 });
});

test("the capture comes from the pane that holds most of the selection, cut to that pane", () => {
  const panes = { left: { x: 0, y: 0, width: 496, height: 700 }, right: { x: 503, y: 0, width: 497, height: 700 } };
  assert.deepEqual(paneUnder({ x: 400, y: 100, width: 200, height: 100 }, panes), { tabId: "right", rect: { x: 503, y: 100, width: 97, height: 100 } });
  assert.deepEqual(paneUnder({ x: 300, y: 100, width: 250, height: 100 }, panes), { tabId: "left", rect: { x: 300, y: 100, width: 196, height: 100 } });
  assert.equal(paneUnder({ x: 497, y: 100, width: 5, height: 100 }, panes), null);
});

test("a click or a sliver captures nothing", () => {
  const panes = { only: { x: 0, y: 0, width: 1000, height: 700 } };
  assert.equal(paneUnder({ x: 10, y: 10, width: 0, height: 0 }, panes), null);
  assert.equal(paneUnder({ x: 10, y: 10, width: 300, height: 3 }, panes), null);
  assert.deepEqual(paneUnder({ x: 10, y: 10, width: 4, height: 4 }, panes), { tabId: "only", rect: { x: 10, y: 10, width: 4, height: 4 } });
});
