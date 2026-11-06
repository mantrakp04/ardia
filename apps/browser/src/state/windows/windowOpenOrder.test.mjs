import assert from "node:assert/strict";
import { test } from "node:test";

const { windowOpens } = await import("./windowOpenOrder.ts");

const state = (order, focused) => ({
  windowOrder: order,
  windows: Object.fromEntries(order.map((id) => [id, { id }])),
  ui: { focusOrder: focused ? [focused] : [] },
});

test("launch: the focused window first, the rest behind it in window order", () => {
  assert.deepEqual(windowOpens(state(["a", "b", "c", "d"], "b"), ["a", "b", "c", "d"], true), [
    { id: "b", focus: true },
    { id: "a", focus: false, behind: "b" },
    { id: "c", focus: false, behind: "b" },
    { id: "d", focus: false, behind: "b" },
  ]);
});

test("one window, or no focused one", () => {
  assert.deepEqual(windowOpens(state(["a"], "a"), ["a"], true), [{ id: "a", focus: true }]);
  assert.deepEqual(windowOpens(state(["a", "b"], null), ["a", "b"], true), [{ id: "a", focus: false }, { id: "b", focus: false }]);
  assert.deepEqual(windowOpens(state(["a", "b"], "gone"), ["a", "b"], true), [{ id: "a", focus: false }, { id: "b", focus: false }]);
});

test("after launch: only the windows asked for, the focused one last so it comes to front", () => {
  assert.deepEqual(windowOpens(state(["a", "b", "c"], "c"), ["c"], false), [{ id: "c", focus: true }]);
  assert.deepEqual(windowOpens(state(["a", "b", "c"], "a"), ["c"], false), [{ id: "c", focus: false }]);
  assert.deepEqual(windowOpens(state(["a", "b", "c"], "c"), ["b", "c"], false), [{ id: "b", focus: false }, { id: "c", focus: true }]);
});
