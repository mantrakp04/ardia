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
const notifications = slice("  let pageNotification = null;\n", "  if (!installNotifications())");
const playing = slice("  const play = HTMLMediaElement.prototype.play;\n", "  const proto = session && ");

const nativeLooking = (fn) => {
  assert.equal(Function.prototype.toString.call(fn), "function () { [native code] }");
  assert.equal("prototype" in fn, false);
  assert.deepEqual(Reflect.ownKeys(fn).sort(), ["length", "name"]);
  assert.throws(() => new fn(), TypeError);
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

function notificationPage({ permission = "granted" } = {}) {
  const sent = [];
  const shownNatively = [];
  const nativeCloses = [];
  const nativeShows = [];
  const registrations = new WeakSet();
  class NativeNotification extends EventTarget {
    constructor(title) {
      super();
      shownNatively.push(title);
    }
  }
  const statics = {
    get permission() {
      return permission;
    },
    get maxActions() {
      return 2;
    },
    requestPermission() {
      return Promise.resolve(permission);
    },
  };
  for (const key of ["permission", "maxActions", "requestPermission"])
    Object.defineProperty(NativeNotification, key, { ...Object.getOwnPropertyDescriptor(statics, key), enumerable: true });
  Object.defineProperty(NativeNotification.prototype, "close", {
    value: { close() { nativeCloses.push(this); } }.close,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  class ServiceWorkerRegistration {}
  Object.defineProperty(ServiceWorkerRegistration.prototype, "active", {
    get() {
      if (!registrations.has(this)) throw new TypeError("Illegal invocation");
      return this.worker;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(ServiceWorkerRegistration.prototype, "showNotification", {
    value: {
      showNotification(title, options) {
        nativeShows.push(this);
        if (!registrations.has(this)) return Promise.reject(new TypeError("Illegal invocation"));
        if (arguments.length < 1) return Promise.reject(new TypeError("1 argument required, but only 0 present."));
        if (!this.worker) return Promise.reject(new TypeError("No active registration available on the ServiceWorkerRegistration."));
        if (permission !== "granted") return Promise.reject(new TypeError("No notification permission has been granted for this origin."));
        return Promise.resolve();
      },
    }.showNotification,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  const window = { Notification: NativeNotification, ServiceWorkerRegistration, focus() {} };
  const handlers = Object.create(null);
  const guard = (fn) =>
    function () {
      try {
        return Reflect.apply(fn, this, arguments);
      } catch (e) {}
    };
  const install = new Function(
    "window",
    "frame",
    "absolute",
    "send",
    "guard",
    "handlers",
    "apply",
    `${helper}${notifications}return installNotifications;`,
  )(window, "f", (u) => u, (kind, data) => sent.push({ kind, data }), guard, handlers, Reflect.apply);
  assert.equal(install(), true);
  const registration = new ServiceWorkerRegistration();
  registrations.add(registration);
  registration.worker = { state: "activated" };
  const idle = new ServiceWorkerRegistration();
  registrations.add(idle);
  idle.worker = null;
  return { window, NativeNotification, sent, shownNatively, nativeCloses, nativeShows, registration, idle, install, proto: ServiceWorkerRegistration.prototype };
}

test("Notification looks like Chrome's constructor and still shows Ardia's notification", async () => {
  const p = notificationPage();
  const Notification = p.window.Notification;
  assert.notEqual(Notification, p.NativeNotification);
  assert.equal(Function.prototype.toString.call(Notification), "function () { [native code] }");
  assert.equal(Notification.name, "Notification");
  assert.equal(Notification.length, 1);
  assert.deepEqual(Reflect.ownKeys(Notification).sort(), ["length", "maxActions", "name", "permission", "prototype", "requestPermission"]);
  for (const key of ["permission", "maxActions", "requestPermission"])
    assert.deepEqual(Object.getOwnPropertyDescriptor(Notification, key), Object.getOwnPropertyDescriptor(p.NativeNotification, key));
  assert.equal(Notification.permission, "granted");
  assert.throws(() => Notification("hi"), {
    name: "TypeError",
    message: "Failed to construct 'Notification': Please use the 'new' operator, this DOM object constructor cannot be called as a function.",
  });
  const n = new Notification("hi", { body: "there" });
  assert.ok(n instanceof Notification);
  assert.equal(n.constructor, Notification);
  assert.equal(p.sent[0].kind, "notification");
  assert.equal(p.sent[0].data.title, "hi");
  assert.deepEqual(p.shownNatively, []);
  nativeLooking(n.close);
  n.close();
  assert.equal(p.sent[1].kind, "notificationClose");
  const stranger = {};
  n.close.call(stranger);
  assert.deepEqual(p.nativeCloses, [stranger]);
  assert.equal(p.install(), true);
  assert.equal(p.window.Notification, Notification);
});

test("showNotification: a tamper probe's new runs nothing, and what Chrome refuses gets Chrome's answer", async () => {
  const p = notificationPage();
  const show = p.proto.showNotification;
  nativeLooking(show);
  assert.throws(() => new show(), TypeError);
  await assert.rejects(show.call(p.proto, "x"), { message: "Illegal invocation" });
  await assert.rejects(show.call(p.registration), { message: "1 argument required, but only 0 present." });
  await assert.rejects(show.call(p.idle, "x"), { message: "No active registration available on the ServiceWorkerRegistration." });
  assert.equal(p.sent.length, 0);
  await show.call(p.registration, "Build done", { body: "green" });
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0].data.title, "Build done");
  assert.equal(p.nativeShows.length, 3);
});

test("showNotification without permission is refused by Chrome and shows nothing", async () => {
  const p = notificationPage({ permission: "default" });
  await assert.rejects(p.registration.showNotification("x"), { message: "No notification permission has been granted for this origin." });
  await settle();
  assert.deepEqual(p.sent, []);
});

function mediaPage() {
  const nativePlays = [];
  const elements = new WeakSet();
  class Node {}
  Object.defineProperty(Node.prototype, "isConnected", {
    get() {
      if (!(this instanceof Node)) throw new TypeError("Illegal invocation");
      return !!this.connected;
    },
    configurable: true,
  });
  class HTMLMediaElement extends Node {
    addEventListener(type) {
      (this.listened ??= []).push(type);
    }
  }
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    get() {
      if (!elements.has(this)) throw new TypeError("Illegal invocation");
      return true;
    },
    configurable: true,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    value: {
      play() {
        nativePlays.push(this);
        return elements.has(this) ? Promise.resolve() : Promise.reject(new TypeError("Illegal invocation"));
      },
    }.play,
    writable: true,
    enumerable: true,
    configurable: true,
  });
  const watched = [];
  const tracked = new WeakSet();
  new Function(
    "HTMLMediaElement",
    "Node",
    "tracked",
    "mediaEvents",
    "onMediaEvent",
    "detachedMediaWatchers",
    "guard",
    "apply",
    `${helper}${playing}`,
  )(HTMLMediaElement, Node, tracked, ["play", "pause"], () => {}, [(m) => watched.push(m)], (fn) => fn, Reflect.apply);
  const element = (connected) => {
    const m = new HTMLMediaElement();
    m.connected = connected;
    elements.add(m);
    return m;
  };
  return { HTMLMediaElement, nativePlays, watched, element };
}

test("play: a tamper probe's new runs nothing; a detached player is still watched; a stranger gets Chrome's answer", async () => {
  const p = mediaPage();
  const play = p.HTMLMediaElement.prototype.play;
  nativeLooking(play);
  assert.throws(() => new play(), TypeError);
  await assert.rejects(play.call(p.HTMLMediaElement.prototype), { message: "Illegal invocation" });
  await assert.rejects(play.call({}), { message: "Illegal invocation" });
  assert.deepEqual(p.watched, []);
  const detached = p.element(false);
  await detached.play();
  await detached.play();
  assert.deepEqual(p.watched, [detached]);
  assert.deepEqual(detached.listened, ["play", "pause"]);
  const attached = p.element(true);
  await attached.play();
  assert.deepEqual(p.watched, [detached]);
  assert.equal(p.nativePlays.length, 5);
});
