import assert from "node:assert/strict";
import { test } from "node:test";
const { hoverSlotOpenings } = await import("./hoverShift.ts");
const { HoverSlot } = await import("./HoverSlot.tsx");

const host = (parent) => ({ type: "RCTView", stateNode: { measureInWindow() {} }, return: parent, memoizedProps: {} });
const slot = (parent, reserve = "hover") => host({ type: HoverSlot, return: parent, memoizedProps: { reserve } });
const allowed = (views) => {
  const ok = hoverSlotOpenings(views);
  return views.map((v) => ok.has(v.host));
};

test("a close slot opening at the end and the title narrowing by as much isn't movement (tab rows)", () => {
  const row = host(null);
  const title = host(row);
  const close = slot(row);
  assert.deepEqual(allowed([{ host: title, was: [10, 0, 160, 18], now: [10, 0, 138, 18] }, { host: close, was: [170, 0, 0, 18], now: [148, 0, 22, 18] }]), [true, true]);
});

test("a slot opening at the start pushes its neighbour's left edge by as much (the Pinned fold)", () => {
  const row = host(null);
  const fold = slot(row);
  const line = host(row);
  assert.deepEqual(allowed([{ host: fold, was: [9, 0, 0, 16], now: [9, 0, 55, 16] }, { host: line, was: [9, 7, 160, 1], now: [64, 7, 105, 1] }]), [true, true]);
});

test("a line squeezed from both sides, and the dashes inside it that move with it, aren't movement (the Clear divider)", () => {
  const row = host(null);
  const fold = slot(row);
  const line = host(row);
  const dash = host(line);
  const actions = slot(row);
  const views = [
    { host: fold, was: [15, 0, 0, 16], now: [15, 0, 55, 16] },
    { host: line, was: [15, 7, 160, 1], now: [70, 7, 59.5, 1] },
    { host: dash, was: [15, 6, 160, 2], now: [70, 6, 160, 2] },
    { host: actions, was: [175, 0, 0, 16], now: [129.5, 0, 45.5, 16] },
  ];
  assert.deepEqual(allowed(views), [true, true, true, true]);
});

test("anything else still counts: a slot that always reserves, a sibling that moves too far, a child that resizes", () => {
  const row = host(null);
  const always = slot(row, "always");
  const title = host(row);
  assert.deepEqual(allowed([{ host: title, was: [10, 0, 160, 18], now: [10, 0, 138, 18] }, { host: always, was: [170, 0, 0, 18], now: [148, 0, 22, 18] }]), [false, false]);
  const fold = slot(row);
  const line = host(row);
  const dash = host(line);
  assert.deepEqual(
    allowed([
      { host: fold, was: [9, 0, 0, 16], now: [9, 0, 55, 16] },
      { host: line, was: [9, 7, 160, 1], now: [70, 7, 99, 1] },
      { host: dash, was: [9, 6, 160, 2], now: [70, 6, 150, 2] },
    ]),
    [true, false, false],
  );
  const unrelated = host(row);
  assert.deepEqual(allowed([{ host: unrelated, was: [0, 30, 100, 20], now: [0, 34, 100, 20] }]), [false]);
});
