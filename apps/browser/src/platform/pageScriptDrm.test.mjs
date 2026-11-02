import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("    const NavigatorType = window.Navigator;\n");
const end = script.indexOf("  } catch (e) {}\n", start);
assert.ok(start > 0 && end > start, "page_script.js has the DRM block");
const source = script.slice(start, end);

class HTMLMediaElement {
  constructor(state = {}) {
    Object.assign(this, { paused: true, ended: false, readyState: 0, currentTime: 0, mediaKeys: null, error: null }, state);
    this.listeners = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
}

function page(supported) {
  const sent = [];
  const timers = [];
  let now = 0;
  const inDocument = [];
  const documentListeners = {};
  class Navigator {}
  Object.defineProperty(Navigator.prototype, "requestMediaKeySystemAccess", {
    value(keySystem) {
      return supported.includes(keySystem) ? Promise.resolve({ keySystem }) : Promise.reject(new Error("NotSupportedError"));
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });
  const navigator = new Navigator();
  navigator.userActivation = { isActive: false };
  const document = {
    querySelectorAll: () => inDocument,
    addEventListener: (type, fn) => (documentListeners[type] ??= []).push(fn),
  };
  const setTimeout = (fn, ms) => timers.push({ at: now + ms, fn });
  const guard = (fn) =>
    function () {
      try {
        return Reflect.apply(fn, this, arguments);
      } catch (e) {}
    };
  const detachedMediaWatchers = [];
  const run = new Function("window", "apply", "send", "document", "navigator", "HTMLMediaElement", "setTimeout", "guard", "detachedMediaWatchers", source);
  run({ Navigator }, Reflect.apply, (kind, data) => sent.push({ kind, data }), document, navigator, HTMLMediaElement, setTimeout, guard, detachedMediaWatchers);
  const advance = (ms) => {
    now += ms;
    for (let due; (due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0]); ) {
      timers.splice(timers.indexOf(due), 1);
      due.fn();
    }
  };
  const fire = (m, type) => {
    for (const fn of documentListeners[type] ?? []) fn({ type, target: m });
  };
  const fireDetached = (m, type) => {
    for (const fn of m.listeners[type] ?? []) fn({ type, target: m });
  };
  const addMedia = (state) => {
    const m = new HTMLMediaElement(state);
    inDocument.push(m);
    return m;
  };
  const detachedPlay = (state) => {
    const m = new HTMLMediaElement(state);
    for (const watch of detachedMediaWatchers) watch(m);
    return m;
  };
  const refuse = async (keySystem = "com.widevine.alpha") => {
    await assert.rejects(navigator.requestMediaKeySystemAccess(keySystem, []));
    await settle();
  };
  return { navigator, Navigator, sent, advance, fire, fireDetached, addMedia, detachedPlay, refuse };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const drm = (keySystem = "com.widevine.alpha") => [{ kind: "drm", data: { keySystem } }];

test("a refused capability check alone never prompts, with or without media on the page", async () => {
  const p = page(["org.w3.clearkey"]);
  await p.refuse();
  p.advance(10000);
  p.addMedia({ readyState: 4 });
  await p.refuse("com.microsoft.playready");
  p.advance(10000);
  assert.deepEqual(p.sent, []);
});

test("a clear video waiting for Play at 0 s doesn't count as failed protected playback", async () => {
  const p = page([]);
  p.addMedia({ paused: true, readyState: 4, currentTime: 0 });
  await p.refuse();
  p.advance(6000);
  assert.deepEqual(p.sent, []);
});

test("a clear video that plays after a refused probe keeps the page quiet", async () => {
  const p = page([]);
  await p.refuse();
  const video = p.addMedia({ paused: false, readyState: 1 });
  p.fire(video, "play");
  Object.assign(video, { readyState: 4, currentTime: 3 });
  p.advance(6000);
  assert.deepEqual(p.sent, []);
});

test("playback that never starts after a refusal prompts once, naming the first refused system", async () => {
  const p = page([]);
  await p.refuse();
  await p.refuse("com.microsoft.playready");
  const video = p.addMedia({ paused: false, readyState: 1 });
  p.fire(video, "play");
  p.advance(4999);
  assert.deepEqual(p.sent, []);
  p.advance(1);
  p.fire(p.addMedia({ paused: false, readyState: 1 }), "play");
  p.advance(6000);
  assert.deepEqual(p.sent, drm());
});

test("a play attempt before the refusal is judged once the refusal is known", async () => {
  const p = page([]);
  const video = p.addMedia({ paused: false, readyState: 1 });
  p.fire(video, "play");
  p.advance(1000);
  await p.refuse();
  p.advance(4000);
  assert.deepEqual(p.sent, drm());
});

test("a player still stalled when a later refusal arrives prompts after a fresh grace period", async () => {
  const p = page([]);
  const video = p.addMedia({ paused: false, readyState: 1 });
  p.fire(video, "play");
  p.advance(6000);
  assert.deepEqual(p.sent, []);
  await p.refuse();
  p.advance(4999);
  assert.deepEqual(p.sent, []);
  p.advance(1);
  assert.deepEqual(p.sent, drm());
});

test("a player that played before a later refusal stays quiet", async () => {
  const p = page([]);
  const video = p.addMedia({ paused: false, readyState: 1 });
  p.fire(video, "play");
  p.advance(6000);
  Object.assign(video, { readyState: 4, currentTime: 4 });
  await p.refuse();
  p.advance(6000);
  assert.deepEqual(p.sent, []);
});

test("a paused or ended attempt isn't a failure", async () => {
  const p = page([]);
  await p.refuse();
  const video = p.addMedia({ paused: false, readyState: 1 });
  p.fire(video, "play");
  video.paused = true;
  p.advance(6000);
  assert.deepEqual(p.sent, []);
});

test("after a quiet probe, a later refused request during a user's activation still prompts", async () => {
  const p = page([]);
  await p.refuse();
  p.advance(10000);
  assert.deepEqual(p.sent, []);
  p.navigator.userActivation.isActive = true;
  await p.refuse();
  p.advance(5000);
  assert.deepEqual(p.sent, drm());
});

test("an activated refusal stays quiet when media then plays", async () => {
  const p = page([]);
  p.navigator.userActivation.isActive = true;
  await p.refuse();
  p.addMedia({ paused: false, readyState: 4, currentTime: 2 });
  p.advance(6000);
  assert.deepEqual(p.sent, []);
});

test("media that's encrypted and still has no keys prompts, media that got keys doesn't", async () => {
  const p = page([]);
  const keyed = p.addMedia({ paused: false, readyState: 1 });
  p.fire(keyed, "encrypted");
  keyed.mediaKeys = {};
  p.advance(2000);
  assert.deepEqual(p.sent, []);
  const locked = p.addMedia({ paused: false, readyState: 1 });
  p.fire(locked, "waitingforkey");
  p.advance(2000);
  assert.deepEqual(p.sent, [{ kind: "drm", data: { keySystem: "" } }]);
});

test("a decode error after a refusal prompts, one before any refusal doesn't", async () => {
  const p = page([]);
  const broken = p.addMedia({ error: { code: 3 } });
  p.fire(broken, "error");
  assert.deepEqual(p.sent, []);
  await p.refuse();
  p.fire(broken, "error");
  assert.deepEqual(p.sent, drm());
});

test("media the page never adds to the document is watched too", async () => {
  const p = page([]);
  await p.refuse();
  const audio = p.detachedPlay({ paused: false, readyState: 1 });
  p.fireDetached(audio, "play");
  p.advance(5000);
  assert.deepEqual(p.sent, drm());
});

test("Clear Key and supported systems aren't reported, and the method keeps its shape", async () => {
  const { navigator, Navigator, sent, advance, fire, addMedia } = page(["org.w3.clearkey", "com.widevine.alpha"]);
  assert.deepEqual(await navigator.requestMediaKeySystemAccess("com.widevine.alpha", []), { keySystem: "com.widevine.alpha" });
  await assert.rejects(navigator.requestMediaKeySystemAccess("org.w3.unknown", []));
  await settle();
  fire(addMedia({ paused: false, readyState: 1 }), "play");
  advance(6000);
  assert.deepEqual(sent, []);
  const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "requestMediaKeySystemAccess");
  assert.equal(descriptor.enumerable, true);
  assert.equal(descriptor.value.name, "requestMediaKeySystemAccess");
  assert.equal(descriptor.value.length, 2);
  assert.equal(Object.hasOwn(navigator, "requestMediaKeySystemAccess"), false);
});
