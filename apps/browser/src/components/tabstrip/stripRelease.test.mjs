import assert from "node:assert/strict";
import { test } from "node:test";
const { releaseDrop } = await import("./model.ts");

function release(o = {}) {
  const calls = [];
  const landing = { dx: 40, commit: () => {} };
  const outcome = releaseDrop({
    local: false,
    lifted: false,
    from: 2,
    drops: false,
    crossed: false,
    ...o,
    endWindowDrag: () => (calls.push("endWindowDrag"), !!o.windowTookIt),
    landAcross: () => (calls.push("landAcross"), o.lands ? landing : null),
    clearAim: () => void calls.push("clearAim"),
    dropOnto: () => (calls.push("dropOnto"), !!o.onto),
    move: () => (calls.push("move"), !!o.moves),
  });
  return { outcome: outcome.kind === "across" ? { kind: "across", dx: outcome.landing.dx } : outcome, calls };
}

test("a tab let go over the page, another window or outside goes with the window drag, and nothing in the strip moves", () => {
  assert.deepEqual(release({ windowTookIt: true }), { outcome: { kind: "handedOff" }, calls: ["endWindowDrag"] });
  assert.deepEqual(release({ lifted: true }), { outcome: { kind: "handedOff" }, calls: ["endWindowDrag"] });
});

test("a split pane or member with no slot and no drop of its own just goes back", () => {
  assert.deepEqual(release({ local: true, from: -1 }), { outcome: { kind: "handedOff" }, calls: [] });
  assert.deepEqual(release({ from: -1 }), { outcome: { kind: "handedOff" }, calls: ["endWindowDrag"] });
});

test("a tab carried across into the pinned dock, or a pin out of it, lands there", () => {
  assert.deepEqual(release({ crossed: true, lands: true }), { outcome: { kind: "across", dx: 40 }, calls: ["endWindowDrag", "landAcross"] });
});

test("a crossing with nowhere to land falls back to the strip, aim cleared first", () => {
  assert.deepEqual(release({ crossed: true }), { outcome: { kind: "settle" }, calls: ["endWindowDrag", "landAcross", "clearAim", "dropOnto", "move"] });
});

test("let go onto a tab or group drops onto it before any reorder", () => {
  assert.deepEqual(release({ onto: true }), { outcome: { kind: "dropped" }, calls: ["endWindowDrag", "clearAim", "dropOnto"] });
});

test("a drop of its own or a multi-tab reorder lands at once, anything else settles into its slot", () => {
  assert.deepEqual(release({ moves: true }), { outcome: { kind: "dropped" }, calls: ["endWindowDrag", "clearAim", "dropOnto", "move"] });
  assert.deepEqual(release(), { outcome: { kind: "settle" }, calls: ["endWindowDrag", "clearAim", "dropOnto", "move"] });
  assert.deepEqual(release({ from: -1, drops: true }), { outcome: { kind: "handedOff" }, calls: ["endWindowDrag", "clearAim", "dropOnto", "move"] });
});

test("a drag that never left its strip (a group member) only settles, without the window drag or drops onto", () => {
  assert.deepEqual(release({ local: true }), { outcome: { kind: "settle" }, calls: ["clearAim"] });
  assert.deepEqual(release({ local: true, crossed: true, lands: true }), { outcome: { kind: "across", dx: 40 }, calls: ["landAcross"] });
});
