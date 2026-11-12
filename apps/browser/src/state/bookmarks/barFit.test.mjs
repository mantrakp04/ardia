import assert from "node:assert/strict";
import { test } from "node:test";
const { barFit } = await import("./barFit.ts");

const ids = (n) => Array.from({ length: n }, (_, i) => `b${i}`);
const fit = (n, width, room, extra = {}) => barFit({ ids: ids(n), widthOf: typeof width === "function" ? width : () => width, room, chevron: 28, gap: 0, minWidth: 14, ...extra });

test("a bar that fits mounts and shows every item, with no chevron", () => {
  assert.deepEqual(fit(3, 100, 300), { mounted: 3, shown: 3, starts: [0, 100, 200] });
});

test("thousands of bookmarks mount only the items that start inside the bar", () => {
  const r = fit(2500, 120, 1000);
  assert.equal(r.mounted, 9);
  assert.equal(r.shown, 8);
});

test("unmeasured items count at the smallest item width, so a cold bar mounts a bounded number", () => {
  const r = fit(2500, () => undefined, 1000);
  assert.equal(r.mounted, Math.ceil(1000 / 14));
  assert.ok(r.mounted < 100);
});

test("the chevron's room comes off only when something overflows", () => {
  assert.equal(fit(3, 100, 300).shown, 3);
  assert.equal(fit(4, 100, 300).shown, 2);
});

test("gaps between items count toward the room", () => {
  assert.deepEqual(fit(3, 100, 300, { gap: 2 }), { mounted: 3, shown: 2, starts: [0, 102, 204] });
});

test("an item wider than the whole bar is hidden behind the chevron", () => {
  assert.deepEqual(fit(2, 190, 150), { mounted: 1, shown: 0, starts: [0] });
});

test("a cold bar converges once its mounted items are measured, and stays put", () => {
  const widths = { b0: 190, b1: 40, b2: 60, b3: 120 };
  const list = Object.keys(widths);
  for (const room of [120, 150, 189, 190, 230, 260, 290, 318, 410]) {
    const measured = new Map();
    const run = () => barFit({ ids: list, widthOf: (id) => measured.get(id), room, chevron: 28, gap: 0, minWidth: 14 });
    let last = run();
    for (let pass = 0; pass < 4; pass++) {
      for (const id of list.slice(0, last.mounted)) measured.set(id, widths[id]);
      const next = run();
      if (pass > 1) assert.deepEqual(next, last, `room ${room}`);
      last = next;
    }
    const ends = list.map((id, i) => list.slice(0, i + 1).reduce((a, k) => a + widths[k], 0));
    const all = ends.every((e) => e <= room);
    assert.equal(last.shown, all ? list.length : ends.filter((e) => e <= room - 28).length, `room ${room}`);
  }
});

const { menuRows, menuScrollStep } = await import("./barFit.ts");

test("a short folder menu renders every row", () => {
  assert.deepEqual(menuRows(12, 0, 600, 28), { first: 0, last: 12 });
});

test("a menu of thousands renders only the rows around what's in view", () => {
  const top = menuRows(2500, 0, 700, 28);
  assert.equal(top.first, 0);
  assert.ok(top.last < 60);
  const step = menuScrollStep(28 * 1000 + 13, 28);
  const middle = menuRows(2500, step, 700, 28);
  assert.ok(middle.first <= 1000 && middle.last >= 1000 + Math.ceil(700 / 28));
  assert.ok(middle.last - middle.first < 80);
  const end = menuRows(2500, menuScrollStep(28 * 2500 - 700, 28), 700, 28);
  assert.equal(end.last, 2500);
});

test("the rendered rows cover the view anywhere inside a scroll step", () => {
  const row = 28, viewport = 500;
  for (let y = 0; y < 28 * 300; y += 37) {
    const r = menuRows(400, menuScrollStep(y, row), viewport, row);
    assert.ok(r.first * row <= y, `top at ${y}`);
    assert.ok(r.last * row >= Math.min(400 * row, y + viewport), `bottom at ${y}`);
  }
});
