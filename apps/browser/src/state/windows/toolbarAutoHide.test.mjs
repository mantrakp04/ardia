import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { noteScroll, revealToolbar, setToolbarPeek, toolbarMode, useToolbarAutoHide } = await import("./toolbarAutoHide.ts");

const script = readFileSync(new URL("../../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const source = script.match(/const scrollDirection = (\(\) => \{[\s\S]*?\n {2}\});\n/)?.[1];
assert.ok(source, "page_script.js defines scrollDirection");
const scrollDirection = new Function(`return ${source}`)();
const wiring = script.match(/const direction = scrollDirection\(\);[\s\S]*?(?=\n {2}const measureScroll)/)?.[0];
assert.ok(wiring, "page_script.js wires scrollDirection to the page's input events");

function wire() {
  const listeners = {};
  const clock = { now: 1000 };
  const build = new Function("scrollDirection", "addEventListener", "performance", "document", `${wiring}\nreturn direction;`);
  const direction = build(scrollDirection, (type, listener) => (listeners[type] = listener), { now: () => clock.now }, {});
  return { direction, listeners, clock };
}

function page({ range = 2000, height = 800 } = {}) {
  const { direction: d, listeners, clock } = wire();
  d.rebase(0);
  const sent = [];
  return {
    sent,
    d,
    listeners,
    to(y, { dt = 16, viewport = height, max = range, user = true } = {}) {
      clock.now += dt;
      const state = d.scrolled(y, max, viewport, clock.now, user);
      if (state) sent.push(state);
      return state;
    },
    wheel(deltaY, { deltaX = 0, pinch = false } = {}) {
      listeners.wheel({ deltaX, deltaY, ctrlKey: pinch });
    },
    pause(ms = 500) {
      clock.now += ms;
    },
    resize(viewport) {
      d.resized(viewport, clock.now);
    },
  };
}

test("scrolling down past the threshold reports down once per gesture", () => {
  const p = page();
  for (let y = 4; y <= 200; y += 4) p.to(y);
  assert.deepEqual(p.sent, ["down"]);
  p.pause();
  for (let y = 204; y <= 300; y += 4) p.to(y);
  assert.deepEqual(p.sent, ["down", "down"]);
});

test("jitter under the thresholds doesn't flip it", () => {
  const p = page();
  for (let y = 10; y <= 300; y += 10) p.to(y);
  for (const y of [295, 300, 292, 299, 290, 300]) p.to(y);
  assert.deepEqual(p.sent, ["down"]);
  p.to(287);
  assert.deepEqual(p.sent, ["down", "up"]);
  for (const y of [290, 300, 305]) p.to(y);
  assert.deepEqual(p.sent, ["down", "up"]);
  p.to(320);
  assert.deepEqual(p.sent, ["down", "up", "down"]);
});

test("the top of the page reports top", () => {
  const p = page();
  for (let y = 20; y <= 200; y += 20) p.to(y);
  for (let y = 180; y >= 0; y -= 20) p.to(y);
  assert.deepEqual(p.sent, ["down", "up", "top"]);
});

test("a page with little to scroll never hides the bar", () => {
  const p = page({ range: 100 });
  for (let y = 5; y <= 100; y += 5) p.to(y);
  assert.deepEqual(p.sent, []);
});

test("the bar's own resize moving the scroll position doesn't flip it back (no loop)", () => {
  const p = page({ range: 1000 });
  for (let y = 10; y <= 1000; y += 10) p.to(y);
  assert.deepEqual(p.sent, ["down"]);
  p.resize(821);
  p.to(979, { viewport: 821, max: 979 });
  p.to(979, { viewport: 821, max: 979 });
  assert.deepEqual(p.sent, ["down"]);
  const q = page({ range: 1000 });
  for (let y = 10; y <= 1000; y += 10) q.to(y);
  q.to(979, { viewport: 821, max: 979 });
  assert.deepEqual(q.sent, ["down"]);
  q.pause(400);
  for (let y = 975; y >= 940; y -= 5) q.to(y, { viewport: 821, max: 979 });
  assert.deepEqual(q.sent, ["down", "up"]);
});

test("a quick reversal right after the bar hides still shows it", () => {
  const p = page({ range: 3000 });
  for (let y = 10; y <= 300; y += 10) p.to(y);
  assert.deepEqual(p.sent, ["down"]);
  p.resize(821);
  for (let y = 290; y >= 250; y -= 10) p.to(y, { viewport: 821 });
  assert.deepEqual(p.sent, ["down", "up"]);
});

test("a chat loading older messages while wheeling up (a jump down) doesn't hide the bar again (#1138)", () => {
  const p = page({ range: 20000 });
  p.to(3000, { user: false });
  p.pause();
  p.wheel(30);
  for (let y = 3030; y <= 3300; y += 30) p.to(y);
  assert.deepEqual(p.sent, ["down"]);
  p.pause();
  p.wheel(-30);
  for (let y = 3270; y >= 3000; y -= 30) p.to(y);
  assert.deepEqual(p.sent, ["down", "up"]);
  p.to(3000 + 2280);
  for (let k = 0; k < 10; k++) p.to(5280 - 30 * (k + 1));
  p.to(5000 + 2280);
  assert.deepEqual(p.sent, ["down", "up"]);
});

test("a bottom-pinned chat re-pinning after the show resize doesn't hide the bar again", () => {
  const p = page({ range: 1000 });
  p.wheel(100);
  for (let y = 10; y <= 1000; y += 10) p.to(y);
  p.resize(821);
  p.to(979, { viewport: 821, max: 979 });
  assert.deepEqual(p.sent, ["down"]);
  p.pause();
  p.wheel(-100);
  for (const y of [974, 968, 962, 956, 950, 944]) p.to(y, { viewport: 821, max: 979 });
  assert.deepEqual(p.sent, ["down", "up"]);
  p.resize(800);
  p.to(1000, { viewport: 800, max: 1000 });
  for (const y of [995, 990, 985, 980]) p.to(y, { viewport: 800, max: 1000 });
  assert.deepEqual(p.sent, ["down", "up"]);
});

test("a bottom-pinned chat re-pinning after the hide resize doesn't show the bar again", () => {
  const p = page({ range: 1000 });
  p.to(900, { user: false });
  p.pause();
  p.wheel(100);
  for (const y of [910, 920, 930, 940]) p.to(y);
  assert.deepEqual(p.sent, ["down"]);
  p.resize(821);
  for (const y of [950, 960, 970, 979]) p.to(y, { viewport: 821, max: 979 });
  for (const y of [955, 935]) p.to(y, { viewport: 821, max: 979 });
  assert.deepEqual(p.sent, ["down"]);
  p.wheel(-100);
  for (const y of [930, 925, 920, 915]) p.to(y, { viewport: 821, max: 979 });
  assert.deepEqual(p.sent, ["down", "up"]);
});

test("wheeling the other way right after the bar hides or shows still flips it", () => {
  const p = page({ range: 3000 });
  p.wheel(100);
  for (let y = 10; y <= 300; y += 10) p.to(y);
  p.resize(821);
  p.wheel(-100);
  for (let y = 290; y >= 250; y -= 10) p.to(y, { viewport: 821 });
  assert.deepEqual(p.sent, ["down", "up"]);
  p.resize(800);
  p.pause(400);
  p.wheel(100);
  for (let y = 260; y <= 300; y += 10) p.to(y);
  assert.deepEqual(p.sent, ["down", "up", "down"]);
});

test("a wheel event with no delta (a gesture's start or end) keeps the wheel's direction", () => {
  const p = page({ range: 3000 });
  p.wheel(100);
  p.to(600);
  p.wheel(0);
  p.to(560);
  assert.deepEqual(p.sent, ["down"]);
});

test("input with no vertical wheel direction clears the last one, so a move against it counts", () => {
  const inputs = {
    "a key": (p) => p.listeners.keydown({}),
    "a click": (p) => p.listeners.mousedown({}),
    "a touch": (p) => p.listeners.touchstart({}),
    "a drag with a button down": (p) => p.listeners.mousemove({ buttons: 1 }),
    "a pinch": (p) => p.wheel(-100, { pinch: true }),
    "a sideways wheel": (p) => p.wheel(0, { deltaX: 40 }),
  };
  for (const [name, input] of Object.entries(inputs)) {
    const p = page({ range: 3000 });
    p.wheel(100);
    p.to(600);
    assert.deepEqual(p.sent, ["down"], name);
    p.to(560);
    assert.deepEqual(p.sent, ["down"], name);
    input(p);
    p.to(520);
    assert.deepEqual(p.sent, ["down", "up"], name);
  }
  const hover = page({ range: 3000 });
  hover.wheel(100);
  hover.to(600);
  hover.listeners.mousemove({ buttons: 0 });
  hover.to(560);
  hover.to(520);
  assert.deepEqual(hover.sent, ["down"]);
});

test("a page that only scrolls a little once hidden still shows it going up", () => {
  const p = page({ range: 130 });
  for (let y = 10; y <= 130; y += 10) p.to(y);
  assert.deepEqual(p.sent, ["down"]);
  p.resize(821);
  p.to(109, { viewport: 821, max: 109 });
  p.pause(400);
  for (let y = 105; y >= 80; y -= 5) p.to(y, { viewport: 821, max: 109 });
  assert.deepEqual(p.sent, ["down", "up"]);
});

test("the page scrolling itself (scroll restoration, a chat) doesn't hide it", () => {
  const p = page();
  p.to(3000, { user: false });
  for (let y = 3020; y <= 3400; y += 20) p.to(y, { user: false });
  assert.deepEqual(p.sent, []);
  p.pause();
  p.to(3410);
  p.to(3440);
  assert.deepEqual(p.sent, ["down"]);
  p.to(0, { user: false });
  assert.deepEqual(p.sent, ["down", "top"]);
});

test("one jump (End, Space) counts", () => {
  const p = page();
  p.to(1200);
  assert.deepEqual(p.sent, ["down"]);
});

test("the mode: shown unless the page scrolled down and nothing needs the bar", () => {
  const base = { enabled: true, hasPage: true, scrolledDown: true, peek: false, needsBar: false };
  assert.equal(toolbarMode(base), "collapsed");
  assert.equal(toolbarMode({ ...base, peek: true }), "peek");
  assert.equal(toolbarMode({ ...base, enabled: false }), "shown");
  assert.equal(toolbarMode({ ...base, hasPage: false }), "shown");
  assert.equal(toolbarMode({ ...base, scrolledDown: false }), "shown");
  assert.equal(toolbarMode({ ...base, needsBar: true }), "shown");
  assert.equal(toolbarMode({ ...base, needsBar: true, peek: true }), "shown");
});

test("page reports, reveals and peeks", () => {
  useBrowser.getState().hydrate({});
  const w = useBrowser.getState().createWindow({ url: "https://a.com" });
  const tabId = useBrowser.getState().newTab(w, { url: "https://example.com" });
  const st = () => useToolbarAutoHide.getState();
  noteScroll(tabId, "down");
  assert.equal(st().scrolledDown[tabId], true);
  setToolbarPeek(tabId, true);
  assert.equal(st().peek[tabId], true);
  noteScroll(tabId, "down");
  assert.equal(st().peek[tabId], undefined);
  noteScroll(tabId, "up");
  assert.equal(st().scrolledDown[tabId], undefined);
  noteScroll(tabId, "down");
  noteScroll(tabId, "top");
  assert.equal(st().scrolledDown[tabId], undefined);
  noteScroll(tabId, "down");
  setToolbarPeek(tabId, true);
  revealToolbar(tabId);
  assert.equal(st().scrolledDown[tabId], undefined);
  assert.equal(st().peek[tabId], undefined);
  noteScroll(tabId, "down");
  useBrowser.getState().closeTab(tabId);
  assert.equal(st().scrolledDown[tabId], undefined);
});

test("with Hide toolbar while scrolling off, a page's scrolling is not kept, and turning it off shows every toolbar", () => {
  useBrowser.getState().hydrate({});
  const w = useBrowser.getState().createWindow({ url: "https://a.com" });
  const tabId = useBrowser.getState().newTab(w, { url: "https://example.com" });
  const st = () => useToolbarAutoHide.getState();
  noteScroll(tabId, "down");
  setToolbarPeek(tabId, true);
  useBrowser.getState().updateSettings({ hideToolbarWhileScrolling: false });
  assert.deepEqual(st(), { scrolledDown: {}, peek: {} });
  noteScroll(tabId, "down");
  assert.deepEqual(st().scrolledDown, {});
  useBrowser.getState().updateSettings({ hideToolbarWhileScrolling: true });
  noteScroll(tabId, "down");
  assert.equal(st().scrolledDown[tabId], true);
});
