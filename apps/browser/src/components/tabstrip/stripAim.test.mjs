import assert from "node:assert/strict";
import { test } from "node:test";
const { aimDrop, dragGeometry, MEMBERS_INSET } = await import("./stripGroups.ts");

const tabs = dragGeometry([{ tabIds: ["a"], width: 100 }, { tabIds: ["b"], width: 100 }, { tabIds: ["c"], width: 100 }], 4);
const all = () => true;
const aim = (from, pointer, target = all) => aimDrop(tabs, from, pointer, target, 43);

test("dragging right: the next tab's near side and middle hold the room, its far quarter passes it", () => {
  assert.deepEqual(aim(0, 110), { to: 0, onto: null });
  assert.deepEqual(aim(0, 129), { to: 0, onto: null });
  assert.deepEqual(aim(0, 154), { to: 0, onto: 1 });
  assert.deepEqual(aim(0, 178), { to: 0, onto: 1 });
  assert.deepEqual(aim(0, 180), { to: 1, onto: null });
  assert.deepEqual(aim(0, 260), { to: 1, onto: 2 });
  assert.deepEqual(aim(0, 320), { to: 2, onto: null });
});

test("dragging left mirrors it", () => {
  assert.deepEqual(aim(2, 200), { to: 2, onto: null });
  assert.deepEqual(aim(2, 154), { to: 2, onto: 1 });
  assert.deepEqual(aim(2, 129), { to: 1, onto: null });
  assert.deepEqual(aim(2, 50), { to: 1, onto: 0 });
  assert.deepEqual(aim(2, 10), { to: 0, onto: null });
});

test("slots that take no drop reorder at their centre", () => {
  const none = () => false;
  assert.deepEqual(aim(0, 153, none), { to: 0, onto: null });
  assert.deepEqual(aim(0, 155, none), { to: 1, onto: null });
});

test("a wide group's ends stay narrow", () => {
  const strip = dragGeometry([{ tabIds: ["a"], width: 100 }, { tabIds: ["g1", "g2", "g3"], width: 400 + MEMBERS_INSET }], 4);
  assert.deepEqual(aimDrop(strip, 0, 104 + 30, all, 43), { to: 0, onto: null });
  assert.deepEqual(aimDrop(strip, 0, 104 + 50, all, 43), { to: 0, onto: 1 });
  assert.deepEqual(aimDrop(strip, 0, 104 + 400, all, 43), { to: 1, onto: null });
});
