import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { WINDOW_DRAG_ROUTES, watchWindowDrag } from "./windowDrag.ts";

function harness(options = {}, withHost = true) {
  const previous = globalThis.window;
  const windowListeners = new Map();
  globalThis.window = {
    addEventListener: (type, listener) => windowListeners.set(type, listener),
    removeEventListener: (type, listener) => windowListeners.get(type) === listener && windowListeners.delete(type),
  };
  const child = {};
  let down;
  const element = { addEventListener: (type, listener) => type === "mousedown" && (down = listener), removeEventListener: (type, listener) => down === listener && (down = undefined), contains: (node) => node === child || node === element };
  const calls = [];
  const settings = { titleBarDoubleClick: true, clickable: false, onRegionClick: () => calls.push("click"), onRegionDoubleClick: () => calls.push("regionDoubleClick"), ...options };
  const host = withHost ? { move: async () => calls.push("move"), doubleClick: async () => calls.push("doubleClick") } : null;
  const stop = watchWindowDrag(element, () => settings, host, (error) => calls.push(`error ${error}`));
  const event = (fields) => ({ button: 0, buttons: 1, detail: 1, ctrlKey: false, defaultPrevented: false, screenX: 100, screenY: 100, target: element, prevented: false, preventDefault() { this.prevented = true; }, ...fields });
  return {
    calls, child, element, windowListeners, settings,
    press: (fields) => { const e = event(fields); down?.(e); return e; },
    moveTo: (x, y, buttons = 1) => windowListeners.get("mousemove")?.(event({ screenX: x, screenY: y, buttons })),
    release: () => windowListeners.get("mouseup")?.(event({ buttons: 0 })),
    stop: () => { stop(); globalThis.window = previous; },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("dragging the region past the threshold asks the window manager to move the window once", async () => {
  const h = harness();
  const pressed = h.press();
  assert.equal(pressed.prevented, true);
  h.moveTo(101, 102);
  await settle();
  assert.deepEqual(h.calls, []);
  h.moveTo(104, 100);
  h.moveTo(140, 100);
  await settle();
  assert.deepEqual(h.calls, ["move"]);
  assert.equal(h.windowListeners.size, 0);
  h.stop();
});

test("a plain click does nothing, a double-click runs the title bar action, and region double-clicks go to the handler", async () => {
  const h = harness();
  h.press();
  h.release();
  h.press({ detail: 2 });
  await settle();
  assert.deepEqual(h.calls, ["doubleClick"]);
  h.settings.titleBarDoubleClick = false;
  h.press({ detail: 2 });
  await settle();
  assert.deepEqual(h.calls, ["doubleClick", "regionDoubleClick"]);
  h.stop();
});

test("presses on children, other buttons, Ctrl and handled presses are left alone, and a released drag never moves", async () => {
  const h = harness();
  assert.equal(h.press({ target: h.child }).prevented, false);
  h.press({ button: 2 });
  h.press({ ctrlKey: true });
  h.press({ defaultPrevented: true });
  assert.equal(h.windowListeners.size, 0);
  h.press();
  h.moveTo(150, 150, 0);
  h.moveTo(200, 200);
  await settle();
  assert.deepEqual(h.calls, []);
  h.stop();
});

test("a clickable region clicks on release, drags past the threshold and never double-clicks", async () => {
  const h = harness({ clickable: true });
  h.press({ target: h.child });
  h.release();
  h.press({ target: h.child, detail: 2 });
  h.release();
  h.press();
  h.moveTo(100, 110);
  await settle();
  assert.deepEqual(h.calls, ["click", "click", "move"]);
  h.stop();
});

test("a failed move is reported and stopping removes every listener", async () => {
  const h = harness();
  h.stop();
  assert.equal(h.press().prevented, false);
  const failing = harness();
  const calls = [];
  const stop = watchWindowDrag(failing.element, () => failing.settings, { move: async () => { throw new Error("no press"); }, doubleClick: async () => {} }, (error) => calls.push(String(error)));
  failing.press();
  failing.moveTo(130, 100);
  await settle();
  assert.ok(calls.includes("Error: no press"));
  stop();
  failing.stop();
});

test("without the window-move routes (no host, or an older engine) region clicks and double-clicks still work and nothing calls the host", async () => {
  const h = harness({ clickable: true }, false);
  h.press({ target: h.child });
  h.release();
  h.press();
  h.moveTo(140, 100);
  h.release();
  await settle();
  assert.deepEqual(h.calls, ["click"]);
  h.stop();
  const plain = harness({ titleBarDoubleClick: false }, false);
  plain.press({ detail: 2 });
  plain.settings.titleBarDoubleClick = true;
  plain.press({ detail: 2 });
  await settle();
  assert.deepEqual(plain.calls, ["regionDoubleClick"]);
  plain.stop();
});

test("drag regions use the window-move routes only when the engine advertises them", () => {
  const chrome = readFileSync(new URL("./shims/web/chrome.tsx", import.meta.url), "utf8");
  assert.match(chrome, /WINDOW_DRAG_ROUTES\.every\(\(route\) => hostSupports\(route\)\)/);
  assert.doesNotMatch(chrome, /if \(!element \|\| !ardiaHost\) return;/);
  const host = readFileSync(new URL("../../../engine/ardiacore-linux/src/ardia/linux/ac_linux_host.cc", import.meta.url), "utf8");
  const bootstrap = host.slice(host.indexOf("base::DictValue ShellHostView::Bootstrap() const {"), host.indexOf("void ShellHostView::LayoutOverlay()"));
  for (const route of WINDOW_DRAG_ROUTES) assert.ok(bootstrap.includes(`.Append("${route}")`), route);
});
