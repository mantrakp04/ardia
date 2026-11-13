import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TAB_POLICY_LOCK, isTabPolicyOwner, policyToastTarget, resetLinuxTabPoliciesForTests, sharedBatterySaver, startLinuxTabPolicies, watchHostInputActivity,
} from "./hostPolicies.ts";
import { showToast } from "./policyToasts.ts";
import { useToasts } from "../../browser/src/state/app/toasts.ts";

function inputTarget() {
  const listeners = new Map();
  return { listeners, addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: (type) => listeners.delete(type) };
}

function engineEvents() {
  const listeners = new Set();
  return {
    listeners,
    addListener: (event, listener) => {
      assert.equal(event, "engine");
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit: (payload) => { for (const listener of [...listeners]) listener(payload); },
  };
}

function pendingLock() {
  const requests = [];
  return {
    requests,
    request: (name, callback) => {
      requests.push({ name, callback });
      return new Promise(() => {});
    },
    grant: () => requests.shift()?.callback(),
  };
}

function broadcast() {
  const peers = [];
  const make = () => {
    const listeners = [];
    const channel = {
      sent: [],
      postMessage: (data) => {
        channel.sent.push(data);
        for (const peer of peers) if (peer !== channel) for (const listener of peer.listeners) listener({ data });
      },
      addEventListener: (_type, listener) => listeners.push(listener),
      close: () => {},
      listeners,
    };
    peers.push(channel);
    return channel;
  };
  return make;
}

function deps(overrides = {}) {
  let clock = 1_000_000;
  const counts = { lifecycles: 0, trims: 0 };
  const providers = [];
  const engine = engineEvents();
  return {
    counts, providers, engine, advance: (ms) => { clock += ms; },
    value: {
      target: inputTarget(), now: () => clock,
      provide: (provider) => { providers.push(provider); return () => providers.splice(providers.indexOf(provider), 1); },
      startLifecycle: () => ++counts.lifecycles, startTrim: () => ++counts.trims,
      activity: (listener) => watchHostInputActivity(engine, listener),
      ...overrides,
    },
  };
}

test("native input activity from page views resets the shared idle clock", () => {
  resetLinuxTabPoliciesForTests();
  const setup = deps();
  const stop = startLinuxTabPolicies(setup.value);
  const idle = setup.providers[0]("ArdiaEngine", "inputIdleSeconds");
  setup.advance(5000);
  assert.equal(idle(), 5);
  setup.engine.emit({ name: "engine.systemState", data: {} });
  assert.equal(idle(), 5);
  setup.engine.emit({ name: "engine.inputActivity", data: {} });
  assert.equal(idle(), 0);
  setup.advance(1500);
  assert.equal(idle(), 1.5);
  stop();
  assert.equal(setup.engine.listeners.size, 0);
});

test("only the window holding the tab-policy lock runs the app-wide memory trim", () => {
  resetLinuxTabPoliciesForTests();
  const locks = pendingLock();
  const setup = deps({ locks });
  startLinuxTabPolicies(setup.value);
  assert.equal(setup.counts.lifecycles, 1, "every window still manages its own tabs");
  assert.equal(setup.counts.trims, 0);
  assert.equal(isTabPolicyOwner(), false);
  assert.deepEqual(locks.requests.map((r) => r.name), [TAB_POLICY_LOCK]);
  const held = locks.grant();
  assert.ok(held instanceof Promise, "the lock is held for the window's lifetime");
  assert.equal(isTabPolicyOwner(), true);
  assert.equal(setup.counts.trims, 1);

  resetLinuxTabPoliciesForTests();
  const unavailable = deps({ locks: { request: () => Promise.reject(new Error("no locks")) } });
  startLinuxTabPolicies(unavailable.value);
  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    assert.equal(isTabPolicyOwner(), true, "without Web Locks the window runs everything itself");
    assert.equal(unavailable.counts.trims, 1);
  });
});

test("battery saver toasts appear only in the renderer that owns the focused window", () => {
  resetLinuxTabPoliciesForTests();
  assert.equal(policyToastTarget("w1"), "w1", "no window binding keeps the shared behaviour");
  const setup = deps({ windowId: "mine" });
  startLinuxTabPolicies(setup.value);
  useToasts.setState({ toasts: {} });
  showToast("someone-else", "Battery Saver Mode Activated", "Busy background tabs are paused.", { icon: "battery.25" });
  assert.deepEqual(useToasts.getState().toasts, {}, "another window's renderer shows it");
  assert.equal(policyToastTarget("mine"), "mine");
  showToast("mine", "Battery Saver Mode Activated", "Busy background tabs are paused.", { icon: "battery.25" });
  assert.equal(useToasts.getState().toasts.mine?.title, "Battery Saver Mode Activated");
});

test("engine.batterySaver is applied by the owner and shared with the other windows", async () => {
  const make = broadcast();
  const ownerChannel = make();
  const otherChannel = make();
  resetLinuxTabPoliciesForTests();
  startLinuxTabPolicies(deps({ channel: otherChannel, locks: pendingLock() }).value);
  ownerChannel.postMessage({ mode: "on", reply: { state: 3, active: true } });
  let applied = 0;
  const apply = async () => { ++applied; return { state: 0, active: false }; };
  assert.deepEqual(await sharedBatterySaver("on", apply), { state: 3, active: true });
  assert.equal(applied, 0, "a window that is not the owner reuses the owner's reply");
  const waiting = sharedBatterySaver("off", apply, 1000);
  ownerChannel.postMessage({ mode: "off", reply: { state: 0, active: false } });
  assert.deepEqual(await waiting, { state: 0, active: false });
  assert.equal(applied, 0);
  assert.deepEqual(await sharedBatterySaver("default", apply, 5), { state: 0, active: false });
  assert.equal(applied, 1, "without an owner reply in time the window applies it itself");
  otherChannel.listeners.forEach((listener) => listener({ data: { mode: 1 } }));

  resetLinuxTabPoliciesForTests();
  const locks = pendingLock();
  startLinuxTabPolicies(deps({ channel: ownerChannel, locks }).value);
  locks.grant();
  ownerChannel.sent.length = 0;
  assert.deepEqual(await sharedBatterySaver("on", async () => ({ state: 3, active: true })), { state: 3, active: true });
  assert.deepEqual(ownerChannel.sent, [{ mode: "on", reply: { state: 3, active: true } }]);
});

test("a timed-out Battery Saver request never overwrites a newer one", async () => {
  const make = broadcast();
  const ownerChannel = make();
  const otherChannel = make();
  resetLinuxTabPoliciesForTests();
  startLinuxTabPolicies(deps({ channel: otherChannel, locks: pendingLock() }).value);
  const applied = [];
  const apply = (mode) => async () => { applied.push(mode); return { state: mode === "on" ? 3 : 0, active: mode === "on" }; };
  const stale = sharedBatterySaver("on", apply("on"), 20);
  ownerChannel.postMessage({ mode: "off", reply: { state: 0, active: false } });
  assert.deepEqual(await sharedBatterySaver("off", apply("off"), 20), { state: 0, active: false });
  await stale;
  assert.deepEqual(applied, [], "the stale 'on' fallback must not apply after a newer 'off'");
  assert.deepEqual(await sharedBatterySaver("on", apply("on"), 5), { state: 3, active: true });
  assert.deepEqual(applied, ["on"], "the latest request still applies itself when no owner answers");
});

test("private windows never take the tab-policy lock or trim, and apply Battery Saver themselves", async () => {
  resetLinuxTabPoliciesForTests();
  const locks = pendingLock();
  const channel = broadcast()();
  const setup = deps({ locks, channel, privateWindow: true });
  startLinuxTabPolicies(setup.value);
  assert.equal(locks.requests.length, 0);
  assert.equal(setup.counts.trims, 0);
  assert.equal(setup.counts.lifecycles, 1);
  assert.equal(isTabPolicyOwner(), false);
  let applied = 0;
  assert.deepEqual(await sharedBatterySaver("on", async () => { ++applied; return { state: 3 }; }, 1000), { state: 3 });
  assert.equal(applied, 1);
  assert.deepEqual(channel.sent, []);
});

test("stop releases the tab-policy lock and closes the channel", async () => {
  resetLinuxTabPoliciesForTests();
  const locks = pendingLock();
  let closed = 0;
  const channel = { ...broadcast()(), close: () => { ++closed; } };
  const setup = deps({ locks, channel });
  const stop = startLinuxTabPolicies(setup.value);
  const held = locks.grant();
  assert.equal(isTabPolicyOwner(), true);
  stop();
  assert.equal(await Promise.race([held.then(() => "released"), new Promise((resolve) => setTimeout(() => resolve("held"), 20))]), "released");
  assert.equal(closed, 1);
  assert.equal(isTabPolicyOwner(), false);

  resetLinuxTabPoliciesForTests();
  const late = pendingLock();
  const lateSetup = deps({ locks: late });
  startLinuxTabPolicies(lateSetup.value)();
  await late.grant();
  assert.equal(lateSetup.counts.trims, 0, "a lock granted after stop is handed back at once");
  assert.notEqual(startLinuxTabPolicies(deps().value), undefined);
});
