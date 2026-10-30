import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const bridge = readFileSync(new URL("../content-blocker/ardia-linux-bridge.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../content-blocker/ardia-linux-bridge.html", import.meta.url), "utf8");
const EXTENSION = "fajbdaomknpkicfjcpipdmcpoamdmilh";
const OFF = "/^(?:ardia-blocking-off|)/";

function fakeUblock({ ready = true, invalidated = false, stalled = false, silent = [] } = {}) {
  const state = {
    whitelist: ["chrome-extension-scheme", "moz-extension-scheme"],
    whitelistDefault: ["chrome-extension-scheme", "moz-extension-scheme"],
    available: {
      "ublock-filters": { content: "filters", group: "default", title: "uBlock filters", entryCount: 100 },
      easylist: { content: "filters", group: "ads", title: "EasyList", entryCount: 50000 },
      "fanboy-cookiemonster": { content: "filters", group: "annoyances", title: "Cookie notices", off: true, entryCount: 9000 },
      "DEU-0": { content: "filters", group: "regions", title: "DEU", off: true, lang: "de", entryCount: 10 },
      "user-filters": { content: "filters", group: "user", title: "My filters" },
    },
    autoUpdate: true,
    reloads: 0,
    messages: [],
  };
  const storage = {};
  const messaging = {
    send(channel, message) {
      assert.equal(channel, "dashboard");
      state.messages.push(message.what);
      if (silent.includes(message.what)) return new Promise(() => {});
      switch (message.what) {
        case "getWhitelist":
          return Promise.resolve({ whitelist: [...state.whitelist], whitelistDefault: state.whitelistDefault });
        case "getLists":
          return Promise.resolve({ available: structuredClone(state.available), netFilterCount: 1234, cosmeticFilterCount: 56, autoUpdate: state.autoUpdate });
        case "setWhitelist":
          state.whitelist = message.whitelist.split("\n").filter(Boolean);
          return Promise.resolve(null);
        case "userSettings":
          state[message.name] = message.value;
          return Promise.resolve(null);
        case "applyFilterListSelection":
          for (const [id, list] of Object.entries(state.available)) {
            if (list.group === "user") continue;
            list.off = !message.toSelect.includes(id);
          }
          return Promise.resolve(null);
        case "reloadAllFilters":
          state.reloads++;
          return Promise.resolve(null);
        default:
          return Promise.resolve(undefined);
      }
    },
  };
  return { state, storage, messaging, ready, invalidated, stalled };
}

function load({ origin = `chrome-extension://${EXTENSION}`, ublock = fakeUblock() } = {}) {
  const attributes = new Map();
  const observers = [];
  const root = {
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
    setAttribute(name, value) {
      attributes.set(name, String(value));
      for (const o of observers) if (o.filter.includes(name)) queueMicrotask(() => o.callback());
    },
    removeAttribute(name) {
      if (!attributes.delete(name)) return;
      for (const o of observers) if (o.filter.includes(name)) queueMicrotask(() => o.callback());
    },
  };
  const background = ublock.ready ? { "µBlock": { isReadyPromise: ublock.stalled ? new Promise(() => {}) : Promise.resolve() } } : {};
  let looks = 0;
  const locks = [];
  const context = {
    document: { documentElement: root },
    location: { origin, href: `${origin}/ardia-linux-bridge.html` },
    navigator: {
      languages: ["en-US", "de"],
      locks: {
        request(name, options, hold) {
          const held = hold();
          locks.push({ name, options, held });
          return held;
        },
      },
    },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe(target, options) {
        assert.equal(target, root);
        assert.equal(JSON.stringify(options), JSON.stringify({ attributes: true, attributeFilter: ["data-ardia-request"] }));
        observers.push({ callback: this.callback, filter: options.attributeFilter });
      }
    },
    chrome: {
      runtime: { id: EXTENSION, lastError: undefined },
      extension: {
        getBackgroundPage: () => {
          if (ublock.invalidated && ++looks > 1) throw new Error("Extension context invalidated.");
          return background;
        },
      },
      i18n: { getUILanguage: () => "en" },
      storage: {
        local: {
          get(key, done) {
            done(key in ublock.storage ? { [key]: ublock.storage[key] } : {});
          },
          set(value, done) {
            Object.assign(ublock.storage, value);
            done();
          },
          remove(key, done) {
            delete ublock.storage[key];
            done();
          },
        },
      },
    },
    fetch: async (url) => {
      assert.equal(url, "/assets/assets.json");
      return { json: async () => ({ easylist: {}, "ublock-filters": {}, "fanboy-cookiemonster": { off: true }, "DEU-0": { off: true, lang: "de" } }) };
    },
    vAPI: { messaging: ublock.messaging },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    JSON,
    Promise,
    Object,
    Array,
    Number,
    String,
    Set,
    Error,
    queueMicrotask,
  };
  context.self = context;
  runInNewContext(bridge, context);
  let ticket = 0;
  const call = async (op, args = {}, { deadlineMs = 2000, failNext = false } = {}) => {
    const id = ++ticket;
    root.removeAttribute("data-ardia-reply");
    root.setAttribute("data-ardia-request", JSON.stringify({ ticket: id, op, args, deadlineMs, failNext }));
    for (let i = 0; i < 400; i++) {
      const raw = root.getAttribute("data-ardia-reply");
      if (raw) {
        const reply = JSON.parse(raw);
        if (reply.ticket === id) return reply;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`no reply to ${op}`);
  };
  const invalidate = () => {
    context.chrome.runtime.id = undefined;
  };
  return { root, call, ublock, attributes, invalidate, locks };
}

test("the bridge page loads uBlock's messaging client before the bridge and marks itself ready", () => {
  const scripts = [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ["js/vapi.js", "js/vapi-common.js", "js/vapi-client.js", "ardia-linux-bridge.js"]);
  assert.doesNotMatch(page, /<!--/);
  const { root } = load();
  assert.equal(root.getAttribute("data-ardia-bridge"), "ready");
});

test("state reports filter lists, defaults, counts and user exceptions", async () => {
  const { call } = load();
  const { value } = await call("state");
  assert.equal(value.enabled, true);
  assert.equal(value.networkFilters, 1234);
  assert.equal(value.cosmeticFilters, 56);
  assert.deepEqual(value.allowedHosts, []);
  const byId = Object.fromEntries(value.lists.map((l) => [l.id, l]));
  assert.equal(byId["user-filters"], undefined);
  assert.equal(byId.easylist.enabled, true);
  assert.equal(byId.easylist.defaultOn, true);
  assert.equal(byId["fanboy-cookiemonster"].enabled, false);
  assert.equal(byId["fanboy-cookiemonster"].defaultOn, false);
  assert.equal(byId["DEU-0"].defaultOn, true);
  assert.equal(byId.easylist.filters, 50000);
});

test("site exceptions cover subdomains and revoking removes every covering directive", async () => {
  const { call, ublock } = load();
  assert.deepEqual(await call("isAllowed", { host: "news.example.com" }), { ticket: 1, value: false });
  assert.deepEqual(await call("setAllowed", { host: "example.com", allowed: true }), { ticket: 2, value: null });
  assert.equal((await call("isAllowed", { host: "news.example.com" })).value, true);
  assert.equal((await call("isAllowed", { host: "notexample.com" })).value, false);
  assert.deepEqual((await call("state")).value.allowedHosts, ["example.com"]);
  await call("setAllowed", { host: "news.example.com", allowed: false });
  assert.equal((await call("isAllowed", { host: "news.example.com" })).value, false);
  assert.deepEqual(ublock.state.whitelist, ["chrome-extension-scheme", "moz-extension-scheme"]);
});

test("turning blocking off adds the off directive and stops list updates; on removes both", async () => {
  const { call, ublock } = load();
  await call("setEnabled", { enabled: false });
  assert.ok(ublock.state.whitelist.includes(OFF));
  assert.equal(ublock.state.autoUpdate, false);
  assert.equal((await call("state")).value.enabled, false);
  assert.deepEqual((await call("state")).value.allowedHosts, []);
  await call("setEnabled", { enabled: true });
  assert.ok(!ublock.state.whitelist.includes(OFF));
  assert.equal(ublock.state.autoUpdate, true);
});

test("enabling a list applies the selection and reloads filters, leaving no pending reload", async () => {
  const { call, ublock } = load();
  await call("setList", { id: "fanboy-cookiemonster", enabled: true });
  assert.equal(ublock.state.available["fanboy-cookiemonster"].off, false);
  assert.equal(ublock.state.available.easylist.off, false);
  assert.equal(ublock.state.reloads, 1);
  assert.equal(ublock.storage.ardiaReloadPending, undefined);
  await call("setList", { id: "easylist", enabled: false });
  assert.equal(ublock.state.available.easylist.off, true);
  assert.equal((await call("setList", { id: "nope", enabled: true })).error, "no list nope");
  for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal((await call("setList", { id, enabled: true })).error, `no list ${id}`);
  }
  assert.equal(ublock.state.reloads, 2);
});

test("errors are reported, never success: dev failure, unknown operations, foreign pages and a blocker that never starts", async () => {
  const { call } = load();
  assert.equal((await call("setEnabled", { enabled: false }, { failNext: true })).error, "getWhitelist: failed (dev)");
  assert.match((await call("eval", { code: "1" })).error, /unknown operation/);
  assert.match((await call("__proto__")).error, /unknown operation/);
  const foreign = load({ origin: "https://example.com" });
  assert.match((await foreign.call("state")).error, /not the extension page/);
  const stalled = load({ ublock: fakeUblock({ ready: false }) });
  assert.match((await stalled.call("state", {}, { deadlineMs: 50 })).error, /timed out|never started/);
});

test("a bridge page whose extension context was invalidated replies with that error instead of going silent", async () => {
  const lost = load({ ublock: fakeUblock({ ready: false, invalidated: true }) });
  const reply = await lost.call("state", {}, { deadlineMs: 1500 });
  assert.match(reply.error, /Extension context invalidated/);
});

test("a call waiting on uBlock's old background page answers as soon as uBlock reloads itself", async () => {
  const reloading = load({ ublock: fakeUblock({ stalled: true }) });
  setTimeout(reloading.invalidate, 100);
  const started = Date.now();
  const reply = await reloading.call("state", {}, { deadlineMs: 20000 });
  assert.match(reply.error, /Extension context invalidated/);
  assert.ok(Date.now() - started < 1500);
});

test("settings reads the selected lists, every whitelist directive and auto-update for another profile to copy", async () => {
  const { call } = load();
  await call("setAllowed", { host: "news.example", allowed: true });
  await call("setEnabled", { enabled: false });
  const { value } = await call("settings");
  assert.deepEqual(value, {
    lists: ["easylist", "ublock-filters", "user-filters"],
    whitelist: [OFF, "chrome-extension-scheme", "moz-extension-scheme", "news.example"].sort(),
    autoUpdate: false,
  });
});

test("follow copies the default profile's lists, exceptions and auto-update, and writes nothing already equal", async () => {
  const leader = load();
  await leader.call("setList", { id: "fanboy-cookiemonster", enabled: true });
  await leader.call("setAllowed", { host: "news.example", allowed: true });
  await leader.call("setEnabled", { enabled: false });
  const { value: settings } = await leader.call("settings");
  const follower = load();
  assert.deepEqual(await follower.call("follow", settings), { ticket: 1, value: null });
  assert.deepEqual((await follower.call("settings")).value, settings);
  assert.equal(follower.ublock.state.reloads, 1);
  assert.equal((await follower.call("isAllowed", { host: "a.news.example" })).value, true);
  assert.equal((await follower.call("state")).value.enabled, false);
  const before = follower.ublock.state.messages.length;
  assert.deepEqual((await follower.call("follow", settings)).value, null);
  const written = follower.ublock.state.messages.slice(before).filter((m) => m !== "getLists" && m !== "getWhitelist");
  assert.deepEqual(written, []);
  for (const bad of [{}, { lists: "easylist", whitelist: [] }, { lists: [], whitelist: [3] }, { lists: [1], whitelist: [] }]) {
    assert.match((await follower.call("follow", bad)).error, /no settings to copy/);
  }
});
