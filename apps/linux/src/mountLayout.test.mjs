import assert from "node:assert/strict";
import test from "node:test";
import { reportMountLayout, watchLayout } from "./shims/web/mountLayout.ts";

function element({ left = 0, top = 0, width = 0, height = 0, parent = null, offsetParent = parent, connected = true, border = [0, 0], scroll = [0, 0] } = {}) {
  return {
    nodeType: 1,
    isConnected: connected,
    offsetLeft: left,
    offsetTop: top,
    offsetWidth: width,
    offsetHeight: height,
    clientLeft: border[0],
    clientTop: border[1],
    scrollLeft: scroll[0],
    scrollTop: scroll[1],
    parentNode: parent,
    offsetParent,
  };
}

const viewport = { scrollX: 0, scrollY: 0 };

test("a field mounted inside an opening command bar reports its layout during the commit, before any later key", () => {
  const panel = element({ left: 200, top: 120, width: 520, height: 107, border: [1, 1] });
  const row = element({ left: 12, top: 10, width: 496, height: 40, parent: panel });
  const field = element({ left: 36, top: 8, width: 440, height: 24, parent: row, offsetParent: row });
  const events = [];
  reportMountLayout(field, (event) => events.push(event), viewport);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].nativeEvent.layout, { x: 36, y: 8, width: 440, height: 24, left: 249, top: 139 });
  assert.equal(events[0].nativeEvent.target, field);
  assert.equal(typeof events[0].timeStamp, "number");
});

test("the mount layout matches react-native-web's measure, including page scroll", () => {
  const scroller = element({ left: 0, top: 0, width: 800, height: 600, scroll: [0, 50] });
  const field = element({ left: 20, top: 300, width: 200, height: 22, parent: scroller });
  const events = [];
  reportMountLayout(field, (event) => events.push(event), { scrollX: 0, scrollY: 10 });
  assert.deepEqual(events[0].nativeEvent.layout, { x: 20, y: 250, width: 200, height: 22, left: 20, top: 240 });
});

test("fields without a layout handler, detached fields and fields without a parent report nothing", () => {
  const events = [];
  const parent = element({ width: 100, height: 100 });
  assert.doesNotThrow(() => reportMountLayout(element({ parent }), undefined, viewport));
  reportMountLayout(element({ parent, connected: false }), (event) => events.push(event), viewport);
  reportMountLayout(element({ parent: null }), (event) => events.push(event), viewport);
  reportMountLayout(null, (event) => events.push(event), viewport);
  assert.equal(events.length, 0);
});

function observers() {
  const state = { resize: null, mutation: null, observed: new Set(), watchingDocument: false, frames: [] };
  globalThis.ResizeObserver = class {
    constructor(callback) {
      state.resize = callback;
    }
    observe(node) {
      state.observed.add(node);
    }
    unobserve(node) {
      state.observed.delete(node);
    }
    disconnect() {
      state.observed.clear();
      state.resize = null;
    }
  };
  globalThis.MutationObserver = class {
    constructor(callback) {
      state.mutation = callback;
    }
    observe() {
      state.watchingDocument = true;
    }
    disconnect() {
      state.watchingDocument = false;
      state.mutation = null;
    }
  };
  globalThis.document = { documentElement: {} };
  globalThis.requestAnimationFrame = (callback) => state.frames.push(callback);
  const timeout = globalThis.setTimeout;
  return {
    state,
    resized: (...nodes) => state.resize(nodes.map((target) => ({ target }))),
    mutated: (...targets) => state.mutation(targets.map((target) => ({ target }))),
    afterPaint: async () => {
      for (const frame of state.frames.splice(0)) frame();
      await new Promise((resolve) => timeout(resolve, 5));
    },
    restore: () => {
      delete globalThis.ResizeObserver;
      delete globalThis.MutationObserver;
      delete globalThis.document;
      delete globalThis.requestAnimationFrame;
    },
  };
}

function bookmarksBar() {
  const bar = element({ left: 0, top: 0, width: 600, height: 28 });
  const other = element({ width: 600, height: 400 });
  const items = [
    element({ left: 8, top: 4, width: 50, height: 20, parent: bar }),
    element({ left: 62, top: 4, width: 60, height: 20, parent: bar }),
    element({ left: 126, top: 4, width: 70, height: 20, parent: bar }),
  ];
  const reports = [];
  const stops = items.map((item, index) => watchLayout(item, () => (event) => reports.push(`${index} ${event.nativeEvent.layout.x} ${event.nativeEvent.layout.width}`), viewport));
  return { bar, other, items, reports, stop: () => stops.forEach((stop) => stop()) };
}

test("a bookmark that grows moves the ones after it, and each moved bookmark reports its new x like a frame change on macOS", () => {
  const o = observers();
  const b = bookmarksBar();
  assert.deepEqual(b.reports, ["0 8 50", "1 62 60", "2 126 70"]);
  o.resized(...b.items, b.bar);
  assert.deepEqual(b.reports, ["0 8 50", "1 62 60", "2 126 70"]);
  b.items[0].offsetWidth = 120;
  b.items[1].offsetLeft += 70;
  b.items[2].offsetLeft += 70;
  o.resized(b.items[0]);
  assert.deepEqual(b.reports.slice(3), ["0 8 120", "1 132 60", "2 196 70"]);
  b.stop();
  o.restore();
});

test("moves without any resize, such as a sibling inserted or a style change, report after the next paint, and changes elsewhere cost nothing", async () => {
  const o = observers();
  const b = bookmarksBar();
  b.items[0].offsetLeft += 30;
  b.items[1].offsetLeft += 30;
  b.items[2].offsetLeft += 30;
  o.mutated(b.bar);
  assert.deepEqual(b.reports.length, 3);
  await o.afterPaint();
  assert.deepEqual(b.reports.slice(3), ["0 38 50", "1 92 60", "2 156 70"]);
  b.items[2].offsetTop = 40;
  o.mutated(b.items[2]);
  await o.afterPaint();
  assert.equal(b.reports.length, 7);
  b.items[1].offsetLeft = 0;
  o.mutated(b.other);
  await o.afterPaint();
  assert.equal(b.reports.length, 7);
  b.stop();
  o.restore();
});

test("a resized parent re-measures its children, and the last unmount stops every observer", () => {
  const o = observers();
  const b = bookmarksBar();
  assert.equal(o.state.observed.has(b.bar), true);
  assert.equal(o.state.watchingDocument, true);
  b.items[2].offsetLeft = 500;
  o.resized(b.bar);
  assert.deepEqual(b.reports.at(-1), "2 500 70");
  b.stop();
  assert.equal(o.state.observed.size, 0);
  assert.equal(o.state.watchingDocument, false);
  assert.equal(o.state.resize, null);
  o.restore();
});
