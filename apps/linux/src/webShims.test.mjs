import assert from "node:assert/strict";
import test from "node:test";

const frames = new Map();
let nextFrame = 1;
const reported = [];
const windowListeners = new Map();
globalThis.document = { hidden: false, addEventListener: () => {} };
globalThis.window = {
  innerHeight: 800,
  addEventListener: (type, listener) => windowListeners.set(type, listener),
  removeEventListener: () => {},
};
globalThis.requestAnimationFrame = (callback) => {
  frames.set(nextFrame, callback);
  return nextFrame++;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
globalThis.reportError = (error) => reported.push(error);

const { subscribeFrames } = await import("./shims/web/gl/clock.ts");
const { paletteColors, PALETTES } = await import("./shims/web/gl/colors.ts");
const { trackHover } = await import("./shims/web/motion/hover.ts");

function runFrame(now) {
  const pending = [...frames];
  frames.clear();
  for (const [, callback] of pending) callback(now);
}

test("a ticker that throws is reported and the frame loop keeps animating every other view", () => {
  const ticks = [];
  const stopBroken = subscribeFrames(() => {
    throw new Error("broken view");
  });
  const stopHealthy = subscribeFrames((dt) => ticks.push(dt));
  runFrame(1000);
  runFrame(1016);
  runFrame(1032);
  assert.equal(ticks.length, 3);
  assert.equal(reported.length, 3);
  assert.equal(frames.size, 1);
  stopBroken();
  stopHealthy();
  runFrame(1048);
  assert.equal(frames.size, 0);
});

test("palette names only match the palettes themselves, never properties every object inherits", () => {
  assert.equal(paletteColors(["pink"]).length, PALETTES.pink.length);
  assert.equal(paletteColors(["toString"]), null);
  assert.equal(paletteColors(["constructor"]), null);
  assert.equal(paletteColors(["__proto__"]), null);
  assert.deepEqual(paletteColors(["#FF0000"]), [[1, 0, 0, 1]]);
});

function hoverNode(rect) {
  return { isConnected: true, getBoundingClientRect: () => rect, closest: () => null };
}

function hoverEntry(node, calls, label) {
  return { node: () => node, enter: () => (e) => calls.push(`${label} enter ${e.nativeEvent.clientX},${e.nativeEvent.clientY}`), leave: () => () => calls.push(`${label} leave`), inside: false };
}

test("a hover area that appears under a pointer that has stopped moving gets its enter right away, and its leave once the pointer goes", () => {
  const box = { left: 100, top: 100, right: 200, bottom: 150, width: 100, height: 50 };
  const point = (x, y) => ({ clientX: x, clientY: y, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
  windowListeners.get("pointermove")(point(120, 110));
  const calls = [];
  const stopFirst = trackHover(hoverEntry(hoverNode(box), calls, "first"));
  assert.deepEqual(calls, ["first enter 20,10"]);
  const stopAway = trackHover(hoverEntry(hoverNode({ ...box, left: 300, right: 400 }), calls, "away"));
  assert.deepEqual(calls, ["first enter 20,10"]);
  windowListeners.get("pointermove")(point(130, 112));
  assert.deepEqual(calls, ["first enter 20,10"]);
  windowListeners.get("pointermove")(point(320, 112));
  assert.deepEqual(calls, ["first enter 20,10", "first leave", "away enter 20,12"]);
  stopFirst();
  stopAway();
});
