import assert from "node:assert/strict";
import { test } from "node:test";
import { DragItems } from "./dragItems.ts";

const controller = (active = false) => ({ items: new Map(), marks: null, active });
const item = (name) => {
  let gap = 12;
  return { name, gap: { stopAnimation() {}, setValue: (v) => (gap = v), value: () => gap } };
};

test("a page's items reach the controller only while the page is live", () => {
  const c = controller();
  const page = new DragItems(c, false);
  const row = item("row");
  page.add("row", row);
  assert.equal(c.items.size, 0);
  page.setLive(true);
  assert.equal(c.items.get("row"), row);
  page.setLive(false);
  assert.equal(c.items.size, 0);
});

test("two pages may use one key: the live page's item wins, whichever page changes first", () => {
  const c = controller();
  const [a, b] = [new DragItems(c, true), new DragItems(c, false)];
  const [tailA, tailB] = [item("a"), item("b")];
  a.add("tail", tailA);
  b.add("tail", tailB);
  b.setLive(true);
  a.setLive(false);
  assert.equal(c.items.get("tail"), tailB);
  a.setLive(true);
  b.setLive(false);
  assert.equal(c.items.get("tail"), tailA);
});

test("a removed item leaves the controller, and doesn't come back when the page is live again", () => {
  const c = controller();
  const page = new DragItems(c, true);
  const remove = page.add("row", item("row"));
  remove();
  assert.equal(c.items.size, 0);
  page.setLive(false);
  page.setLive(true);
  assert.equal(c.items.size, 0);
});

test("a page left during a drag closes its gaps, since the drag's reset only reaches the live page", () => {
  const dragging = controller(true);
  const page = new DragItems(dragging, true);
  const row = item("row");
  page.add("row", row);
  page.setLive(false);
  assert.equal(row.gap.value(), 0);

  const idle = controller(false);
  const other = new DragItems(idle, true);
  const kept = item("kept");
  other.add("kept", kept);
  other.setLive(false);
  assert.equal(kept.gap.value(), 12);
});
