import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const slice = (from, to) => {
  const start = script.indexOf(from);
  const end = script.indexOf(to, start);
  assert.ok(start > 0 && end > start, `page_script.js has ${from.trim()}`);
  return script.slice(start, end);
};
const helper = slice("  const asNative = ", "  const { keys, setPrototypeOf } = Object;\n");
const badging = slice("  if (isTop && window.isSecureContext && window.Navigator) {\n", "\n  const PO = window.PerformanceObserver;");

const settle = () => new Promise((resolve) => setImmediate(resolve));

function badgePage({ native = true, top = true, secure = true, chromeRefuses = false } = {}) {
  const sent = [];
  const nativeCalls = [];
  const timers = [];
  class Navigator {}
  const navigator = new Navigator();
  const receiverCheck = (self) => (self === navigator ? null : Promise.reject(new TypeError("Illegal invocation")));
  if (native) {
    Object.defineProperty(Navigator.prototype, "setAppBadge", {
      value: {
        setAppBadge(contents) {
          nativeCalls.push(["set", ...arguments]);
          const refused = receiverCheck(this);
          if (refused) return refused;
          if (chromeRefuses) return Promise.reject(new DOMException("Not allowed", "NotAllowedError"));
          if (contents !== undefined && typeof contents !== "number") return Promise.reject(new TypeError("Chrome got an unconverted value"));
          return Promise.resolve();
        },
      }.setAppBadge,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(Navigator.prototype, "clearAppBadge", {
      value: {
        clearAppBadge() {
          nativeCalls.push(["clear"]);
          return receiverCheck(this) ?? (chromeRefuses ? Promise.reject(new DOMException("Not allowed", "NotAllowedError")) : Promise.resolve());
        },
      }.clearAppBadge,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  const window = { Navigator, isSecureContext: secure };
  const guard = (fn) =>
    function () {
      try {
        return Reflect.apply(fn, this, arguments);
      } catch (e) {}
    };
  new Function("window", "navigator", "isTop", "send", "guard", "apply", "isFinite", "setTimeout", `${helper}${badging}`)(
    window,
    navigator,
    top,
    (kind, data) => sent.push({ kind, data }),
    guard,
    Reflect.apply,
    Number.isFinite,
    (fn, ms) => timers.push({ fn, ms }),
  );
  const flush = async () => {
    await settle();
    while (timers.length) timers.shift().fn();
  };
  return { navigator, sent, nativeCalls, timers, flush };
}

const reported = (p) => p.sent.map((m) => m.data);

test("Chrome gets each call with the value converted once, and the badge Chrome accepted is reported", async () => {
  const p = badgePage();
  let reads = 0;
  await p.navigator.setAppBadge({ valueOf: () => ++reads * 3 });
  assert.equal(reads, 1);
  assert.deepEqual(p.nativeCalls, [["set", 3]]);
  await p.flush();
  assert.deepEqual(reported(p), [{ count: 3 }]);
  await p.navigator.setAppBadge();
  await p.flush();
  await p.navigator.setAppBadge(-0.5);
  await p.flush();
  await p.navigator.setAppBadge(2.9);
  await p.flush();
  await p.navigator.clearAppBadge();
  await p.flush();
  assert.deepEqual(reported(p), [{ count: 3 }, { flag: true }, { count: 0 }, { count: 2 }, { count: 0 }]);
  assert.equal(Function.prototype.toString.call(p.navigator.setAppBadge), "function () { [native code] }");
  assert.equal(p.navigator.setAppBadge.name, "setAppBadge");
});

test("values WebIDL refuses reject without reaching Chrome or the app", async () => {
  const p = badgePage();
  for (const bad of [-1, 2 ** 53, Number.NaN, Infinity, 1n, Symbol("x")]) await assert.rejects(p.navigator.setAppBadge(bad), TypeError, String(bad));
  await p.flush();
  assert.deepEqual(p.nativeCalls, []);
  assert.deepEqual(p.sent, []);
});

test("a call Chrome rejects reports nothing", async () => {
  const p = badgePage({ chromeRefuses: true });
  await assert.rejects(p.navigator.setAppBadge(4), { name: "NotAllowedError" });
  await assert.rejects(p.navigator.clearAppBadge(), { name: "NotAllowedError" });
  await p.flush();
  assert.deepEqual(p.sent, []);
});

test("a page that breaks Promise lookups can't make an accepted call throw", async () => {
  const p = badgePage();
  const original = Object.getOwnPropertyDescriptor(Promise.prototype, "constructor");
  Object.defineProperty(Promise.prototype, "constructor", {
    get() {
      throw new Error("page trap");
    },
    configurable: true,
  });
  let result;
  try {
    result = p.navigator.setAppBadge(3);
  } finally {
    Object.defineProperty(Promise.prototype, "constructor", original);
  }
  assert.ok(result instanceof Promise);
  await result;
  assert.deepEqual(p.nativeCalls, [["set", 3]]);
});

test("another receiver goes to Chrome untouched and reports nothing", async () => {
  const p = badgePage();
  const stranger = {};
  await assert.rejects(p.navigator.setAppBadge.call(stranger, 2), TypeError);
  await p.flush();
  assert.deepEqual(p.nativeCalls, [["set", 2]]);
  assert.deepEqual(p.sent, []);
});

test("a burst of calls sends the first at once and then one message with the last value, and nothing when it ends where it began", async () => {
  const p = badgePage();
  const calls = [];
  for (let i = 1; i <= 1000; i++) calls.push(p.navigator.setAppBadge(i));
  await Promise.all(calls);
  assert.deepEqual(reported(p), [{ count: 1 }]);
  assert.equal(p.timers.length, 1);
  assert.ok(p.timers[0].ms > 0 && p.timers[0].ms <= 250);
  await p.flush();
  assert.deepEqual(reported(p), [{ count: 1 }, { count: 1000 }]);
  await p.navigator.setAppBadge(5);
  await p.navigator.setAppBadge(1000);
  await p.flush();
  assert.deepEqual(reported(p), [{ count: 1 }, { count: 1000 }]);
});

test("without Chrome's methods the page still gets a working Badging API that refuses a wrong receiver", async () => {
  const p = badgePage({ native: false });
  assert.equal(typeof p.navigator.setAppBadge, "function");
  assert.equal(p.navigator.setAppBadge.length, 0);
  await p.navigator.setAppBadge(7);
  await p.flush();
  await p.navigator.clearAppBadge();
  await p.flush();
  await assert.rejects(p.navigator.setAppBadge(Number.NaN), TypeError);
  await assert.rejects(p.navigator.setAppBadge.call({}, 1), { name: "TypeError", message: "Illegal invocation" });
  await assert.rejects(p.navigator.clearAppBadge.call({}), { name: "TypeError", message: "Illegal invocation" });
  await p.flush();
  assert.deepEqual(reported(p), [{ count: 7 }, { count: 0 }]);
});

test("frames and insecure pages are left alone", async () => {
  for (const options of [{ top: false }, { secure: false }]) {
    const p = badgePage(options);
    await p.navigator.setAppBadge(1);
    await p.flush();
    assert.deepEqual(p.sent, []);
  }
});
