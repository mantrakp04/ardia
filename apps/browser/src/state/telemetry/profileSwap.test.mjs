import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
globalThis.requestAnimationFrame = (frame) => {
  queueMicrotask(() => frame(0));
  return 0;
};
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", appBuild: "300", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, decidedAt: 1, askDoneAt: 1, installId: "install-1", crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
globalThis.fetch = async () => ({ status: 200 });

const client = await import("./client.ts");
const local = await import("./localStore.ts");
const { SWAP_WAIT_MS, noteProfileSwapped, profileSwapProperties, profileSwitched } = await import("./profileSwap.ts");
client.startClient();

const switches = () => {
  local.flushLocal();
  return stub.telemetryLocal.records().filter((r) => r.event === "profile_switched");
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a native swap report adds swap_ms, profile_loaded and held_timed_out beside switch_ms and profiles", async () => {
  const before = switches().length;
  profileSwitched("w1", 8, { via_switcher: true });
  noteProfileSwapped("w1", { profileLoaded: false, activeMs: 412.4, swapMs: 2841.6, heldTimedOut: true });
  await settle();
  const [event] = switches().slice(before);
  assert.ok(event);
  assert.equal(event.properties.swap_ms, 2842);
  assert.equal(event.properties.swap_active_ms, 412);
  assert.equal(event.properties.profile_loaded, false);
  assert.equal(event.properties.held_timed_out, true);
  assert.equal(event.properties.profiles, 8);
  assert.equal(event.properties.via_switcher, true);
  assert.equal(typeof event.properties.switch_ms, "number");
});

test("a report for another window leaves the event waiting, and a loaded, drawn swap is recorded as such", async () => {
  const before = switches().length;
  profileSwitched("w2", 3, {});
  noteProfileSwapped("w3", { profileLoaded: true, activeMs: 1, swapMs: 2, heldTimedOut: false });
  await settle();
  assert.equal(switches().length, before);
  noteProfileSwapped("w2", { profileLoaded: true, activeMs: 3, swapMs: 40, heldTimedOut: false });
  await settle();
  const [event] = switches().slice(before);
  assert.equal(event.properties.swap_ms, 40);
  assert.equal(event.properties.profile_loaded, true);
  assert.equal(event.properties.held_timed_out, false);
});

test("a report with no waiting switch is dropped, not given to the next switch", async () => {
  const before = switches().length;
  noteProfileSwapped("w4", { profileLoaded: true, activeMs: 1, swapMs: 9, heldTimedOut: false });
  profileSwitched("w4", 2, {});
  await settle();
  assert.equal(switches().length, before);
  noteProfileSwapped("w4", { profileLoaded: false, activeMs: 5, swapMs: 77, heldTimedOut: false });
  await settle();
  const [event] = switches().slice(before);
  assert.equal(event.properties.swap_ms, 77);
});

test("with no native report the event still goes out after the wait, without the swap fields", async (t) => {
  const before = switches().length;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  profileSwitched("w5", 4, {});
  await settle();
  t.mock.timers.tick(SWAP_WAIT_MS - 1);
  await settle();
  assert.equal(switches().length, before);
  t.mock.timers.tick(1);
  await settle();
  t.mock.timers.reset();
  const [event] = switches().slice(before);
  assert.ok(event);
  assert.equal(typeof event.properties.switch_ms, "number");
  assert.equal(event.properties.profiles, 4);
  for (const key of ["swap_ms", "swap_active_ms", "profile_loaded", "held_timed_out"]) assert.equal(key in event.properties, false);
});

test("only numbers and booleans come through, and a bad value is skipped", () => {
  assert.deepEqual(profileSwapProperties(null), {});
  assert.deepEqual(profileSwapProperties({ swapMs: "https://example.com", activeMs: -1, profileLoaded: "yes", heldTimedOut: false, url: "https://example.com" }), { held_timed_out: false });
  assert.deepEqual(profileSwapProperties({ swapMs: Number.NaN, activeMs: 12.5, profileLoaded: true }), { swap_active_ms: 13, profile_loaded: true });
});
