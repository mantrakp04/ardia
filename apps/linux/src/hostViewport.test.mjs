import assert from "node:assert/strict";
import test from "node:test";
import { backdropCovers, watchTabViewport } from "./hostViewport.ts";

test("viewport observation tracks transforms, scroll, visual zoom, overlays, and document visibility", () => {
  const previous = Object.fromEntries(["window", "document", "getComputedStyle", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"].map((key) => [key, globalThis[key]]));
  const windowEvents = new EventTarget();
  const visualViewport = new EventTarget();
  const documentEvents = new EventTarget();
  let rect = { x: 200, y: 50, width: 800, height: 600, left: 200, top: 50, right: 1000, bottom: 650 };
  let frame;
  let blocked = false;
  let cards = [];
  let cardAtSample = false;
  let disconnected = false;
  const element = { isConnected: true, parentElement: null, getBoundingClientRect: () => rect, contains: () => false };
  const selectors = [];
  const document = Object.assign(documentEvents, { hidden: false, querySelectorAll: (selector) => { selectors.push(selector); return selector.includes("ardia-sidebar-peek") ? [] : cards; }, querySelector: () => null, elementFromPoint: () => blocked ? {} : cardAtSample ? cards[0] : element });
  globalThis.window = Object.assign(windowEvents, { innerWidth: 1280, innerHeight: 800, visualViewport });
  globalThis.document = document;
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  globalThis.ResizeObserver = class { observe() {} disconnect() { disconnected = true; } };
  globalThis.requestAnimationFrame = (callback) => { frame = callback; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  const updates = [];
  try {
    const stop = watchTabViewport(element, () => true, (update) => updates.push(update));
    assert.equal(updates.at(-1).visible, true);
    assert.deepEqual(selectors.at(-1).split(",").map((part) => part.trim()), ['[data-testid="ardia-sidebar-hover"] > div > div', '[data-testid="ardia-page-overlay"] > div > div']);
    rect = { ...rect, x: 250, left: 250, right: 1050 };
    windowEvents.dispatchEvent(new Event("scroll"));
    assert.equal(updates.at(-1).rect.x, 250);
    rect = { ...rect, width: 720, right: 970 };
    visualViewport.dispatchEvent(new Event("resize"));
    assert.equal(updates.at(-1).rect.width, 720);
    cards = [{ getBoundingClientRect: () => ({ x: 192, y: 48, left: 192, top: 48, right: 456, bottom: 160, width: 264, height: 112 }), contains: () => false }];
    cardAtSample = true;
    frame();
    assert.equal(updates.at(-1).visible, true);
    assert.deepEqual(updates.at(-1).occlusions, [{ x: 192, y: 48, width: 264, height: 112, paintOutset: 32 }]);
    cardAtSample = false;
    cards = [{ getBoundingClientRect: () => ({ x: 192, y: 200, left: 192, top: 200, right: 456, bottom: 312, width: 264, height: 112 }), contains: () => false }];
    frame();
    assert.equal(updates.at(-1).visible, true);
    assert.deepEqual(updates.at(-1).occlusions, [{ x: 192, y: 200, width: 264, height: 112, paintOutset: 32 }]);
    blocked = true;
    frame();
    assert.equal(updates.at(-1).visible, false);
    blocked = false;
    cards = [];
    frame();
    assert.equal(updates.at(-1).occlusions, undefined);
    document.hidden = true;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(updates.at(-1).visible, false);
    document.hidden = false;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(updates.at(-1).visible, true);
    stop();
    assert.equal(disconnected, true);
    const count = updates.length;
    windowEvents.dispatchEvent(new Event("scroll"));
    assert.equal(updates.length, count);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("an open extension popup keeps the page under it painted and live, cut out around the popup, while its outside-click layer stays transparent", () => {
  const previous = Object.fromEntries(["window", "document", "getComputedStyle", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"].map((key) => [key, globalThis[key]]));
  const box = (x, y, width, height) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height });
  const page = { isConnected: true, parentElement: null, getBoundingClientRect: () => box(190, 47, 763, 1026), contains: (node) => node === page };
  const field = {};
  const popupView = { isConnected: true, parentElement: null, getBoundingClientRect: () => box(705, 48, 239, 119), contains: (node) => node === popupView || node === field };
  const popup = { getBoundingClientRect: () => box(704, 47, 241, 121), contains: (node) => node === popup || node === field || node === popupView };
  const dismiss = { getBoundingClientRect: () => box(0, 0, 953, 1080), contains: (node) => node === dismiss };
  const other = { getBoundingClientRect: () => box(0, 0, 953, 1080), contains: (node) => node === other };
  let open = true;
  let catcher = dismiss;
  const selected = { '[data-testid="ardia-extension-popup"]': () => (open ? popup : null), '[data-testid="ardia-extension-popup-dismiss"]': () => (open ? dismiss : null) };
  const inPopup = (x, y) => x >= 704 && x < 945 && y >= 47 && y < 168;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 953, innerHeight: 1080 });
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    querySelectorAll: () => [],
    querySelector: (selector) => selected[selector]?.() ?? null,
    elementFromPoint: (x, y) => (!open ? page : inPopup(x, y) ? field : catcher),
  });
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  let frame;
  globalThis.requestAnimationFrame = (callback) => { frame = callback; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const updates = [];
    const stop = watchTabViewport(page, () => true, (update) => updates.push(update));
    assert.equal(updates.at(-1).visible, true);
    assert.deepEqual(updates.at(-1).occlusions, [{ x: 704, y: 47, width: 241, height: 121, paintOutset: 32 }]);
    catcher = other;
    frame();
    assert.equal(updates.at(-1).visible, false);
    catcher = dismiss;
    open = false;
    frame();
    assert.equal(updates.at(-1).visible, true);
    assert.equal(updates.at(-1).occlusions, undefined);
    stop();
    open = true;
    const own = [];
    const stopOwn = watchTabViewport(popupView, () => true, (update) => own.push(update));
    assert.equal(own.at(-1).visible, true);
    assert.equal(own.at(-1).occlusions, undefined);
    stopOwn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("a selection popover over the page and an open extension popup are both cut out of the page", () => {
  const previous = Object.fromEntries(["window", "document", "getComputedStyle", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"].map((key) => [key, globalThis[key]]));
  const box = (x, y, width, height) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height });
  const page = { isConnected: true, parentElement: null, getBoundingClientRect: () => box(190, 47, 763, 1026), contains: (node) => node === page };
  const bar = { getBoundingClientRect: () => box(500, 300, 87, 32), contains: (node) => node === bar };
  const popup = { getBoundingClientRect: () => box(704, 47, 241, 121), contains: (node) => node === popup };
  const dismiss = { getBoundingClientRect: () => box(0, 0, 953, 1080), contains: (node) => node === dismiss };
  const selected = { '[data-testid="ardia-extension-popup"]': popup, '[data-testid="ardia-extension-popup-dismiss"]': dismiss };
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 953, innerHeight: 1080 });
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    querySelectorAll: (selector) => (selector.includes('"ardia-page-overlay"') ? [bar] : []),
    querySelector: (selector) => selected[selector] ?? null,
    elementFromPoint: () => dismiss,
  });
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const updates = [];
    const stop = watchTabViewport(page, () => true, (update) => updates.push(update));
    assert.equal(updates.at(-1).visible, true);
    assert.deepEqual(updates.at(-1).occlusions, [
      { x: 500, y: 300, width: 87, height: 32, paintOutset: 32 },
      { x: 704, y: 47, width: 241, height: 121, paintOutset: 32 },
    ]);
    stop();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("a backdrop is reused while its occluders move or grow and retaken when a new occluder appears beside them", () => {
  const card = { x: 192, y: 64, width: 264, height: 126, paintOutset: 32 };
  const bar = { x: 977, y: 209, width: 87, height: 32, paintOutset: 32 };
  assert.equal(backdropCovers([], [card]), false);
  assert.equal(backdropCovers([card], [card]), true);
  assert.equal(backdropCovers([card], [{ ...card, y: 70, height: 130 }]), true);
  assert.equal(backdropCovers([{ ...bar, x: 980, width: 81 }], [bar]), true);
  assert.equal(backdropCovers([card], [card, bar]), false);
  assert.equal(backdropCovers([card, bar], [bar]), true);
});

test("a peeked sidebar over the page's left edge is cut out of the page instead of hiding it", () => {
  const previous = Object.fromEntries(["window", "document", "getComputedStyle", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"].map((key) => [key, globalThis[key]]));
  const box = (x, y, width, height) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height });
  const page = { isConnected: true, parentElement: null, getBoundingClientRect: () => box(8, 8, 1264, 784), contains: (node) => node === page };
  const row = {};
  const peek = { getBoundingClientRect: () => box(5, 5, 240, 790), contains: (node) => node === peek };
  const other = {};
  let peeking = true;
  let rightSide = page;
  globalThis.window = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 800 });
  globalThis.document = Object.assign(new EventTarget(), {
    hidden: false,
    querySelectorAll: (selector) => (selector === '[data-testid="ardia-sidebar-peek"]' && peeking ? [peek] : []),
    querySelector: () => null,
    elementFromPoint: (x) => (x < 245 ? row : rightSide),
  });
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible", opacity: "1" });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  let frame;
  globalThis.requestAnimationFrame = (callback) => { frame = callback; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const updates = [];
    const stop = watchTabViewport(page, () => true, (update) => updates.push(update));
    assert.equal(updates.at(-1).visible, true);
    assert.deepEqual(updates.at(-1).occlusions, [{ x: 5, y: 5, width: 240, height: 790, paintOutset: 32 }]);
    rightSide = other;
    frame();
    assert.equal(updates.at(-1).visible, false);
    rightSide = page;
    peeking = false;
    frame();
    assert.equal(updates.at(-1).visible, false);
    assert.equal(updates.at(-1).occlusions, undefined);
    stop();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
