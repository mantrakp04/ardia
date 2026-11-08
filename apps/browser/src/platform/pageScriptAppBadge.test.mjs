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

function badgePage({ native = true, top = true, secure = true } = {}) {
  const sent = [];
  const nativeCalls = [];
  class Navigator {}
  if (native) {
    Object.defineProperty(Navigator.prototype, "setAppBadge", {
      value: {
        setAppBadge(contents) {
          nativeCalls.push(["set", contents]);
          if (contents !== undefined && !(Number(contents) >= 0)) throw new TypeError("Value is outside the 'unsigned long long' value range.");
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
          return Promise.resolve();
        },
      }.clearAppBadge,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  const navigator = new Navigator();
  const window = { Navigator, isSecureContext: secure };
  const guard = (fn) =>
    function () {
      try {
        return Reflect.apply(fn, this, arguments);
      } catch (e) {}
    };
  new Function("window", "navigator", "isTop", "send", "guard", "apply", "isFinite", `${helper}${badging}`)(
    window,
    navigator,
    top,
    (kind, data) => sent.push({ kind, data }),
    guard,
    Reflect.apply,
    Number.isFinite,
  );
  return { navigator, Navigator, sent, nativeCalls };
}

test("setAppBadge and clearAppBadge still reach Chrome and report the badge", async () => {
  const p = badgePage();
  await p.navigator.setAppBadge(3);
  await p.navigator.setAppBadge();
  await p.navigator.setAppBadge(0);
  await p.navigator.clearAppBadge();
  assert.deepEqual(p.nativeCalls, [["set", 3], ["set", undefined], ["set", 0], ["clear"]]);
  assert.deepEqual(
    p.sent.map((m) => [m.kind, m.data]),
    [
      ["appBadge", { count: 3 }],
      ["appBadge", { flag: true }],
      ["appBadge", { count: 0 }],
      ["appBadge", { count: 0 }],
    ],
  );
  assert.equal(Function.prototype.toString.call(p.navigator.setAppBadge), "function () { [native code] }");
  assert.equal(p.navigator.setAppBadge.name, "setAppBadge");
});

test("what Chrome refuses throws and reports nothing", () => {
  const p = badgePage();
  assert.throws(() => p.navigator.setAppBadge(-1), TypeError);
  assert.deepEqual(p.sent, []);
  p.navigator.setAppBadge.call({}, 2);
  assert.deepEqual(p.sent, []);
});

test("without Chrome's methods the page still gets a working Badging API", async () => {
  const p = badgePage({ native: false });
  assert.equal(typeof p.navigator.setAppBadge, "function");
  assert.equal(p.navigator.setAppBadge.length, 0);
  assert.equal("setAppBadge" in p.navigator, true);
  await p.navigator.setAppBadge(7);
  await p.navigator.clearAppBadge();
  await assert.rejects(p.navigator.setAppBadge(Number.NaN), TypeError);
  assert.deepEqual(
    p.sent.map((m) => m.data),
    [{ count: 7 }, { count: 0 }],
  );
});

test("frames and insecure pages are left alone", () => {
  for (const options of [{ top: false }, { secure: false }]) {
    const p = badgePage(options);
    p.navigator.setAppBadge(1);
    assert.deepEqual(p.sent, []);
  }
});
