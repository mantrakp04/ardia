import assert from "node:assert/strict";
import test from "node:test";
import { domRegionDeps } from "./shellAbove.ts";

const host = { bootstrap: { windowId: "w", profileId: "default", capabilities: [] }, invoke: async () => null, onEvent: () => () => {} };

function tree() {
  const node = (parent) => {
    const self = { parentElement: parent, children: [], listeners: new Map() };
    self.contains = (other) => { for (let n = other; n; n = n.parentElement) if (n === self) return true; return false; };
    self.addEventListener = (type, run) => self.listeners.set(type, run);
    self.removeEventListener = (type) => self.listeners.delete(type);
    return self;
  };
  const body = node(null);
  const slider = node(body);
  const overlay = node(slider);
  const row = node(overlay);
  return { body, slider, overlay, row };
}

test("an overlay is watched for its own subtree and for style or class changes on every ancestor", () => {
  const previous = globalThis.MutationObserver;
  const observed = [];
  let fire = () => {};
  let disconnected = false;
  globalThis.MutationObserver = class {
    constructor(callback) { fire = callback; }
    observe(target, options) { observed.push({ target, options }); }
    disconnect() { disconnected = true; }
  };
  try {
    const { body, slider, overlay } = tree();
    let changes = 0;
    const stop = domRegionDeps(host).watch(overlay, () => changes++);
    assert.deepEqual(observed.map(({ target }) => target), [overlay, slider, body]);
    assert.deepEqual(observed[0].options, { subtree: true, childList: true, attributes: true });
    for (const { options } of observed.slice(1)) assert.deepEqual(options, { attributes: true, attributeFilter: ["style", "class"] });
    fire([]);
    assert.equal(changes, 1);
    assert.ok(overlay.listeners.has("transitionrun"));
    stop();
    assert.equal(disconnected, true);
    assert.equal(overlay.listeners.size, 0);
  } finally {
    globalThis.MutationObserver = previous;
  }
});

test("an animation on an overlay's ancestor or inside it counts as the overlay moving; one elsewhere doesn't", () => {
  const previous = globalThis.document;
  const { body, slider, overlay, row } = tree();
  const other = { contains: (n) => n === other };
  let target = null;
  globalThis.document = { getAnimations: () => (target ? [{ playState: "running", effect: { target } }] : []) };
  try {
    const animating = domRegionDeps(host).animating;
    for (const [moving, expected] of [[slider, true], [body, true], [row, true], [other, false], [null, false]]) {
      target = moving;
      assert.equal(animating([overlay]), expected);
    }
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
