import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

globalThis.__DEV__ = false;

const ardiacore = new URL("../test-native-stub.mjs", import.meta.url).href;
const stubs = {
  "@ardia/ardiacore": `export * from ${JSON.stringify(ardiacore)};
    export const listTasks = async () => [];
    export const onSystemState = () => ({ remove() {} });
    export const systemState = async () => null;
    export const releaseProfile = async () => {};
    export const setBatterySaver = (mode) => globalThis.batterySaverReply(mode);`,
  "../components/layout/splitActions": "export const showToast = () => {};",
  "../components/settings/windows": "export const openSettings = () => {};",
  "../components/pages": "export const isInternalTab = (t) => !/^https?:/.test(t.url ?? '');",
};
registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/lib/tabLifecycle.ts") || !(specifier in stubs)) return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  },
});

const { useBrowser } = await import("../store/browser.ts");
const { webviews } = await import("./webviews.ts");
const lifecycle = await import("./tabLifecycle.ts");

const S = () => useBrowser.getState();

function fakePage() {
  const page = { dirty: false, evaluated: 0, discarded: 0, release: () => {} };
  page.handle = {
    evaluate: async () => (page.evaluated++, page.dirty),
    setFrozen: () => new Promise((resolve) => (page.release = resolve)),
    discard: async () => (page.discarded++, "discarded"),
  };
  return page;
}

test("a tab shown and typed in while it was being frozen doesn't sleep", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://b.com", background: true });
  const page = fakePage();
  webviews.set(b, page.handle);
  lifecycle.useLifecycle.setState({ batterySaver: true });

  const freezing = lifecycle.freezeTab(b);
  await new Promise((resolve) => setTimeout(resolve, 0));
  S().activate(b);
  page.dirty = true;
  page.release();
  await freezing;
  S().activate(a);

  assert.equal(await lifecycle.sleepTab(b), false);
  assert.equal(page.evaluated, 1, "asks the page now");
  assert.equal(page.discarded, 0);
  webviews.delete(b);
});

test("a tab without unsaved input sleeps", async () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  const b = S().newTab(w, { url: "https://b.com", background: true });
  const page = fakePage();
  webviews.set(b, page.handle);
  assert.equal(await lifecycle.sleepTab(b), true);
  assert.equal(page.discarded, 1);
  webviews.delete(b);
});

const STATE = { off: 0, belowThreshold: 1, on: 3 };

async function syncWith(on, reply) {
  lifecycle.useLifecycle.setState({ batterySaver: on });
  globalThis.batterySaverReply = reply;
  return lifecycle.syncChromeBatterySaver();
}

test("Chrome owns Battery Saver when its effective state is the one asked for", async () => {
  assert.equal(await syncWith(true, async (mode) => ({ state: STATE[mode], active: mode === "on" })), true);
  assert.equal(await syncWith(false, async (mode) => ({ state: STATE[mode], active: false })), true);
});

test("a policy that pins Chrome's battery saver keeps our sampler running", async () => {
  assert.equal(await syncWith(true, async () => ({ state: STATE.off, active: false })), false);
  assert.equal(await syncWith(false, async () => ({ state: STATE.belowThreshold, active: false })), false);
});

test("an engine without the call keeps our sampler running", async () => {
  assert.equal(await syncWith(true, async () => { throw new Error("not an engine call"); }), false);
});

test("an older reply landing last doesn't override the newer one", async () => {
  let releaseFirst;
  lifecycle.useLifecycle.setState({ batterySaver: true });
  globalThis.batterySaverReply = () => new Promise((resolve) => (releaseFirst = () => resolve({ state: STATE.on, active: true })));
  const first = lifecycle.syncChromeBatterySaver();
  const second = syncWith(true, async () => ({ state: STATE.off, active: false }));
  assert.equal(await second, false);
  releaseFirst();
  assert.equal(await first, false);
});

test("Battery Saver turns on at 20% battery or lower, in Low Power Mode, or whenever unplugged when asked to", () => {
  const sys = (onBattery, batteryLevel, lowPowerMode = false) => ({ onBattery, batteryLevel, lowPowerMode, memoryPressure: "normal", physicalMemory: 16 * 2 ** 30 });
  const wanted = (when, state) => lifecycle.batterySaverWanted(when, state).on;
  assert.equal(wanted("lowBattery", sys(true, 0.8)), false, "on battery with charge left");
  assert.equal(wanted("lowBattery", sys(true, 0.2)), true);
  assert.equal(wanted("lowBattery", sys(true, 0.204)), true, "shows as 20%");
  assert.equal(wanted("lowBattery", sys(true, 0.21)), false);
  assert.equal(wanted("lowBattery", sys(false, 0.1)), false, "plugged in");
  assert.equal(wanted("lowBattery", sys(false, 0.9, true)), true, "Low Power Mode");
  assert.equal(wanted("lowBattery", sys(true, null)), false, "no battery level");
  assert.equal(wanted("unplugged", sys(true, 0.9)), true);
  assert.equal(wanted("unplugged", sys(false, 0.9)), false);
  assert.equal(wanted("never", sys(true, 0.05, true)), false);
  assert.equal(wanted("lowBattery", null), false);
});

test("Battery Saver turned on by low battery stays on through 20%/21% readings until the Mac is plugged in", () => {
  const sys = (onBattery, batteryLevel) => ({ onBattery, batteryLevel, lowPowerMode: false, memoryPressure: "normal", physicalMemory: 16 * 2 ** 30 });
  let held = false;
  const step = (when, state) => {
    const next = lifecycle.batterySaverWanted(when, state, held);
    held = next.lowBatteryHeld;
    return next.on;
  };
  assert.deepEqual([0.21, 0.2, 0.21, 0.2, 0.21, 0.5].map((level) => step("lowBattery", sys(true, level))), [false, true, true, true, true, true]);
  assert.equal(step("lowBattery", sys(false, 0.21)), false, "plugged in");
  assert.equal(step("lowBattery", sys(true, 0.21)), false, "unplugged again above 20%");
  assert.equal(step("lowBattery", sys(true, 0.2)), true);
  assert.equal(step("never", sys(true, 0.2)), false);
  assert.equal(step("lowBattery", sys(true, 0.21)), false, "a changed setting starts over");
});

test("Battery Saver's old switch: a choice and any off are kept, the old default moves to When battery is low", () => {
  const hydrated = (settings) => (S().hydrate({ settings }), S().settings);
  const untouched = hydrated({ batterySaver: true, showFullUrl: true, chosen: ["showFullUrl"], inferred: [] });
  assert.equal(untouched.batterySaverWhen, "lowBattery");
  assert.equal("batterySaver" in untouched, false);
  assert.deepEqual(untouched.chosen, ["showFullUrl"]);
  const off = hydrated({ batterySaver: false, chosen: ["batterySaver"], inferred: [] });
  assert.equal(off.batterySaverWhen, "never");
  assert.deepEqual(off.chosen, ["batterySaverWhen"]);
  assert.equal(hydrated({ batterySaver: true, chosen: ["batterySaver"], inferred: [] }).batterySaverWhen, "unplugged");
  assert.equal(hydrated({ batterySaver: false, chosen: ["batterySaver"], inferred: ["batterySaver"] }).batterySaverWhen, "never", "off was never the default, so it was chosen");
  assert.equal(hydrated({ batterySaver: false }).batterySaverWhen, "never", "legacy save turned off");
  assert.equal(hydrated({ batterySaver: true, chosen: ["batterySaver"], inferred: ["batterySaver"] }).batterySaverWhen, "lowBattery", "on, saved before choices were tracked");
  assert.equal(hydrated({ batterySaver: true }).batterySaverWhen, "lowBattery", "legacy save left on");
  assert.equal(hydrated({ batterySaverWhen: "never", chosen: ["batterySaverWhen"] }).batterySaverWhen, "never");
});

test("a recent pin queued for warming at launch stays closed when the user closes it before its turn", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com" });
  const pin = S().newTab(w, { url: "https://p.com", background: true, pinned: true });
  const warm = S().newTab(w, { url: "https://q.com", background: true, pinned: true });
  const cold = (id) => ({ ...S().tabs[id], navigation: null, lastActiveAt: Date.now() });
  useBrowser.setState({ tabs: { ...S().tabs, [pin]: cold(pin), [warm]: cold(warm) } });
  const sys = { physicalMemory: 32 * 2 ** 30, onBattery: false, lowPowerMode: false, memoryPressure: "normal" };

  const queued = lifecycle.reloadRecentTabs(sys);
  assert.ok(queued.includes(pin) && queued.includes(warm));
  S().activate(pin);
  S().closeTab(pin);
  assert.equal(S().tabs[pin].unloaded, true);
  t.mock.timers.tick(2000 * queued.length);

  assert.equal(S().tabs[pin].unloaded, true, "the closed pin stays closed");
  assert.equal(S().tabs[pin].navigation, null);
  assert.ok(S().tabs[warm].navigation, "a pin left alone still warms up");
  assert.equal(!!S().tabs[warm].unloaded, false);
});
