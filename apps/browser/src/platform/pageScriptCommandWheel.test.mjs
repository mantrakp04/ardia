import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("    const getterOf = (proto, name) =>");
const end = script.indexOf("  handlers.config = (config) =>");
assert.ok(start > 0 && end > start, "page_script.js has the ⌘-wheel block");
const block = script.slice(script.lastIndexOf("  try {", start), end);

function frame() {
  const sent = [];
  const listeners = new Set();
  class Event {
    constructor({ cancelable = true } = {}) {
      this._cancelable = cancelable;
      this._prevented = false;
    }
    get cancelable() {
      return this._cancelable;
    }
    get defaultPrevented() {
      return this._prevented;
    }
    preventDefault() {
      if (this._cancelable) this._prevented = true;
    }
  }
  class MouseEvent extends Event {
    constructor(init = {}) {
      super(init);
      this._meta = !!init.metaKey;
    }
    get metaKey() {
      return this._meta;
    }
  }
  class WheelEvent extends MouseEvent {
    constructor(init = {}) {
      super(init);
      this._deltaY = init.deltaY ?? 0;
    }
    get deltaY() {
      return this._deltaY;
    }
  }
  class EventTarget {
    addEventListener(type, fn) {
      if (type === "wheel") listeners.add(fn);
    }
    removeEventListener(type, fn) {
      if (type === "wheel") listeners.delete(fn);
    }
  }
  const window = new EventTarget();
  const handlers = Object.create(null);
  const apply = Reflect.apply;
  const guard = (fn) =>
    function () {
      try {
        return apply(fn, this, arguments);
      } catch (e) {}
    };
  const send = (kind, data) => sent.push({ kind, data });
  runInNewContext(block, { window, handlers, apply, guard, send, Event, MouseEvent, WheelEvent, EventTarget, Object, Reflect });
  const wheel = ({ deltaY, page = false, cancelable = true, metaKey = true }) => {
    const e = new WheelEvent({ deltaY, cancelable, metaKey });
    if (page) e.preventDefault();
    for (const fn of [...listeners]) fn.call(window, e);
    return e;
  };
  return { handlers, sent, wheel, listening: () => listeners.size };
}

test("every ⌘-wheel the armed page sees gets one reply, cancelled ones included", () => {
  const f = frame();
  f.handlers.commandWheel({ armed: true });
  const cancelledByPage = f.wheel({ deltaY: -30, page: true });
  const unhandled = f.wheel({ deltaY: 30 });
  const uncancelable = f.wheel({ deltaY: 30, cancelable: false });
  assert.deepEqual(
    JSON.parse(JSON.stringify(f.sent.map((m) => m.data))),
    [
      { handled: true, dy: -30 },
      { handled: false, dy: 30 },
      { handled: true, dy: 30 },
    ],
  );
  assert.equal(cancelledByPage.defaultPrevented, true);
  assert.equal(unhandled.defaultPrevented, true);
  assert.equal(uncancelable.defaultPrevented, false);
});

test("a wheel without ⌘ disarms the frame and gets no reply", () => {
  const f = frame();
  f.handlers.commandWheel({ armed: true });
  const plain = f.wheel({ deltaY: 30, metaKey: false });
  assert.equal(plain.defaultPrevented, false);
  assert.equal(f.listening(), 0);
  assert.deepEqual(f.sent, []);
});

test("disarming removes the listener, and arming twice adds it once", () => {
  const f = frame();
  f.handlers.commandWheel({ armed: true });
  f.handlers.commandWheel({ armed: true });
  assert.equal(f.listening(), 1);
  f.handlers.commandWheel({ armed: false });
  assert.equal(f.listening(), 0);
  f.wheel({ deltaY: 30 });
  assert.deepEqual(f.sent, []);
});
