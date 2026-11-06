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
const source = slice("  const displayRequests = new Map();\n", "  const PO = window.PerformanceObserver;\n");

const illegal = "Failed to execute 'getDisplayMedia' on 'MediaDevices': Illegal invocation";
const badOptions = "Failed to execute 'getDisplayMedia' on 'MediaDevices': The provided value is not of type 'DisplayMediaStreamOptions'.";

function page({ active = false, policyAllows = true } = {}) {
  const sent = [];
  const nativeCalls = [];
  const real = new WeakSet();
  class MediaDevices {}
  const nativeGetDisplayMedia = {
    getDisplayMedia() {
      nativeCalls.push(this);
      if (!real.has(this)) return Promise.reject(new TypeError(illegal));
      const options = arguments[0];
      if (options !== undefined && options !== null && typeof options !== "object" && typeof options !== "function")
        return Promise.reject(new TypeError(badOptions));
      return new Promise(() => {});
    },
  }.getDisplayMedia;
  Object.defineProperty(MediaDevices.prototype, "getDisplayMedia", {
    value: nativeGetDisplayMedia,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(MediaDevices.prototype, "getUserMedia", { value() {}, writable: true, enumerable: true, configurable: true });
  Object.defineProperty(MediaDevices.prototype, "ondevicechange", {
    get() {
      if (!real.has(this)) throw new TypeError("Illegal invocation");
      return null;
    },
    enumerable: true,
    configurable: true,
  });
  const devices = new MediaDevices();
  real.add(devices);
  class UserActivation {
    get isActive() {
      return active;
    }
  }
  const navigator = { mediaDevices: devices, userActivation: new UserActivation() };
  const document = { featurePolicy: { allowsFeature: () => policyAllows } };
  const handlers = Object.create(null);
  const install = new Function(
    "navigator",
    "document",
    "send",
    "apply",
    "handlers",
    "DOMException",
    `${helper}${source}return { installDisplayMedia, restoreDisplayMedia };`,
  )(navigator, document, (kind, data) => sent.push({ kind, data }), Reflect.apply, handlers, DOMException);
  return {
    devices,
    proto: MediaDevices.prototype,
    native: nativeGetDisplayMedia,
    shim: MediaDevices.prototype.getDisplayMedia,
    sent,
    nativeCalls,
    install: install.installDisplayMedia,
    restore: install.restoreDisplayMedia,
  };
}

const rejection = async (promise) => {
  try {
    await promise;
  } catch (e) {
    return `${e.name}: ${e.message}`;
  }
  return "resolved";
};

test("Castle's tamper probe (new, then a call on the prototype) asks nothing and leaves no stray rejection, as in Chrome (#903)", async () => {
  const p = page();
  const stray = [];
  const onStray = (reason) => stray.push(reason);
  process.on("unhandledRejection", onStray);
  try {
    for (const call of [(fn, proto) => fn.call(proto), (fn, proto) => fn.apply(proto)]) {
      try {
        let constructed = new p.shim();
        const t = call(p.shim, p.proto);
        if (t && typeof t.then === "function") t.catch(() => {});
        throw Error();
      } catch (e) {
        assert.equal(e.constructor, TypeError);
      }
    }
    assert.throws(() => new p.shim(), TypeError);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onStray);
  }
  assert.deepEqual(stray, []);
  assert.deepEqual(p.sent, []);
});

test("the shim looks like the native method where pages check", () => {
  const { shim } = page();
  assert.equal(typeof shim, "function");
  assert.equal(shim.name, "getDisplayMedia");
  assert.equal(shim.length, 0);
  assert.equal("prototype" in shim, false);
  assert.deepEqual(Reflect.ownKeys(shim).sort(), ["length", "name"]);
  assert.match(Function.prototype.toString.call(shim), /^function (getDisplayMedia)?\(\) \{ \[native code\] \}$/);
  assert.throws(() => Object.create(shim).toString(), TypeError);
  const before = Object.getPrototypeOf(shim);
  assert.throws(() => Object.setPrototypeOf(shim, Object.create(shim)), { name: "TypeError", message: "Cyclic __proto__ value" });
  assert.equal(Object.getPrototypeOf(shim), before);
});

test("calls Chrome refuses get Chrome's own answer and never reach the picker", async () => {
  const p = page({ active: true });
  assert.equal(await rejection(p.shim.call(p.proto)), `TypeError: ${illegal}`);
  assert.equal(await rejection(p.shim.call({})), `TypeError: ${illegal}`);
  assert.equal(await rejection(p.devices.getDisplayMedia("screen")), `TypeError: ${badOptions}`);
  assert.equal(p.nativeCalls.length, 3);
  assert.deepEqual(p.sent, []);
});

test("a request blocked by permissions policy goes to Chrome, which refuses it", async () => {
  const p = page({ active: true, policyAllows: false });
  p.devices.getDisplayMedia({ video: true });
  assert.deepEqual(p.nativeCalls, [p.devices]);
  assert.deepEqual(p.sent, []);
});

test("a page's own request without a click is refused; with a click it opens the picker", async () => {
  const quiet = page();
  assert.equal(await rejection(quiet.devices.getDisplayMedia({ video: true })), "InvalidStateError: getDisplayMedia() requires transient activation (user gesture).");
  assert.deepEqual(quiet.sent, []);
  const clicked = page({ active: true });
  clicked.devices.getDisplayMedia({ video: true, audio: true });
  assert.deepEqual(clicked.sent, [{ kind: "displayMedia", data: { id: 1, audio: true, systemAudio: true, windowAudio: "system" } }]);
  assert.deepEqual(clicked.nativeCalls, []);
});

test("the shim is in place as soon as the page script runs, before Ardia's config arrives (#914)", async () => {
  const p = page();
  assert.notEqual(p.shim, p.native);
  assert.equal(await rejection(p.devices.getDisplayMedia()), "InvalidStateError: getDisplayMedia() requires transient activation (user gesture).");
  assert.deepEqual(p.nativeCalls, []);
});

test("config without Ardia's picker gives the page Chrome's own method back, and config with it installs the shim again", () => {
  const p = page();
  p.restore();
  assert.equal(p.proto.getDisplayMedia, p.native);
  p.install();
  assert.notEqual(p.proto.getDisplayMedia, p.native);
  assert.equal(Function.prototype.toString.call(p.proto.getDisplayMedia), "function () { [native code] }");
});

test("config doesn't wrap a page's own wrapper of the shim a second time", () => {
  const p = page();
  const wrapper = function getDisplayMedia(...args) {
    return p.shim.apply(this, args);
  };
  p.proto.getDisplayMedia = wrapper;
  p.install();
  assert.equal(p.proto.getDisplayMedia, wrapper);
  p.restore();
  assert.equal(p.proto.getDisplayMedia, wrapper);
});
