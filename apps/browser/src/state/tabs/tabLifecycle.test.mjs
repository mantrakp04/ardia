import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

globalThis.__DEV__ = false;

const performance = import.meta.resolve("../../platform/performance.ts");
const profiles = import.meta.resolve("../../platform/profiles.ts");
globalThis.engineCalls = [];
const stubs = {
  "../../platform/performance": `export * from ${JSON.stringify(performance)};
    export const onSystemState = () => ({ remove() {} });
    export const systemState = async () => null;
    export const setBatterySaver = async (mode) => (globalThis.engineCalls.push(["batterySaver", mode]), { state: 0, active: false });
    export const setMemorySaver = async (request) => (globalThis.engineCalls.push(["memorySaver", request]), { ...request, active: request.state === "on", invalid: [] });`,
  "../../platform/profiles": `export * from ${JSON.stringify(profiles)};
    export const releaseProfile = async () => {};`,
  "../app/toasts": "export const showToast = () => {};",
  "../settings/settingsWindows": "export const openSettings = () => {};",
  "../pages/urls": "export const isInternalTab = (t) => !/^https?:/.test(t.url ?? '');",
};
registerHooks({
  resolve(specifier, context, next) {
    if (!/\/state\/tabs\/(?:tabLifecycle|memorySaver|shownTabs|recentTabWarmup)\.ts$/.test(context.parentURL ?? "") || !(specifier in stubs)) return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  },
});

const { useBrowser } = await import("../browser/store.ts");
const lifecycle = await import("./tabLifecycle.ts");
const { keepActiveSiteOf, memorySaverRequest } = await import("./memorySaver.ts");
const { reloadRecentTabs } = await import("./recentTabWarmup.ts");
const { loadSession: loadSavedSession } = await import("../session/persist.ts");
const { docs: savedDocs } = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const memorySaverCalls = () => globalThis.engineCalls.filter(([name]) => name === "memorySaver").map(([, request]) => request);

test("Memory Saver is on and Balanced by default, as in Helium, with no sites kept active", () => {
  S().hydrate({});
  assert.deepEqual(memorySaverRequest(S().settings), { state: "on", aggressiveness: "balanced", sites: [] });
});

test("the app's Memory Saver settings reach the engine at launch and on every change", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  S().hydrate({ settings: { memorySaver: false, memorySaverMode: "maximum", keepActiveSites: ["music.youtube.com"] } });
  globalThis.engineCalls.length = 0;
  lifecycle.startTabLifecycle();
  assert.deepEqual(memorySaverCalls(), [{ state: "off", aggressiveness: "maximum", sites: ["music.youtube.com"] }]);
  S().updateSettings({ memorySaver: true });
  S().updateSettings({ memorySaverMode: "moderate" });
  S().updateSettings({ keepActiveSites: ["music.youtube.com", "figma.com"] });
  S().updateSettings({ showFullUrl: !S().settings.showFullUrl });
  assert.deepEqual(memorySaverCalls().slice(1), [
    { state: "on", aggressiveness: "maximum", sites: ["music.youtube.com"] },
    { state: "on", aggressiveness: "moderate", sites: ["music.youtube.com"] },
    { state: "on", aggressiveness: "moderate", sites: ["music.youtube.com", "figma.com"] },
  ]);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.deepEqual(globalThis.engineCalls.filter(([name]) => name === "batterySaver").map(([, mode]) => mode), ["off"], "Battery Saver is always Chrome's: on or off, never left to Chrome's default");
});

test("a saved Memory Saver mode or site list the engine wouldn't take falls back instead of reaching it", () => {
  assert.deepEqual(memorySaverRequest({ memorySaver: true, memorySaverMode: "turbo", keepActiveSites: ["a.com", 3] }), { state: "on", aggressiveness: "balanced", sites: ["a.com"] });
  assert.deepEqual(memorySaverRequest({ memorySaver: undefined, memorySaverMode: undefined, keepActiveSites: undefined }), { state: "on", aggressiveness: "balanced", sites: [] });
});

test("a kept-active site lowercases only its scheme and host, since Chrome matches the path and query as typed", () => {
  assert.equal(keepActiveSiteOf("  HTTPS://Example.COM/Editor?Doc=AbC "), "https://example.com/Editor?Doc=AbC");
  assert.equal(keepActiveSiteOf("Docs.Google.com/Document/D/XyZ"), "docs.google.com/Document/D/XyZ");
  assert.equal(keepActiveSiteOf("[*.]YouTube.com"), "[*.]youtube.com");
  assert.equal(keepActiveSiteOf("https://Figma.com/"), "https://figma.com", "a bare trailing slash goes, as before");
  assert.equal(keepActiveSiteOf("music.youtube.com"), "music.youtube.com");
});

test("a synced list saved with lowercased entries reaches the engine unchanged", () => {
  assert.deepEqual(memorySaverRequest({ memorySaver: true, memorySaverMode: "balanced", keepActiveSites: ["https://example.com/editor"] }).sites, ["https://example.com/editor"]);
});

test("a tab Chrome discarded shows as sleeping until it's ready again or gone", () => {
  S().hydrate({});
  lifecycle.noteDiscarded("t1");
  lifecycle.noteDiscarded("t2");
  assert.deepEqual(lifecycle.useLifecycle.getState().discarded, { t1: true, t2: true });
  lifecycle.noteReady("t1");
  lifecycle.noteGone("t2");
  assert.deepEqual(lifecycle.useLifecycle.getState().discarded, {});
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
  const hydrated = (settings) => {
    savedDocs.set("session.json", JSON.stringify({ version: 7, profiles: S().profiles, profileOrder: S().profileOrder, settings, windows: [], windowOrder: [], tabs: [], groups: [], splits: [] }));
    S().hydrate(loadSavedSession());
    return { ...S().settings, chosen: S().settingsMeta.chosen };
  };
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
  const cold = (id) => ({ ...S().tabs[id], page: { kind: "idle" }, lastActiveAt: Date.now() });
  useBrowser.setState({ tabs: { ...S().tabs, [pin]: cold(pin), [warm]: cold(warm) } });
  const sys = { physicalMemory: 32 * 2 ** 30, onBattery: false, lowPowerMode: false, memoryPressure: "normal" };

  const queued = reloadRecentTabs(sys);
  assert.ok(queued.includes(pin) && queued.includes(warm));
  S().activate(pin);
  S().closeTab(pin);
  assert.equal(S().tabs[pin].page.kind, "asleep");
  t.mock.timers.tick(2000 * queued.length);

  assert.equal(S().tabs[pin].page.kind, "asleep", "the closed pin stays closed");
  assert.equal(S().tabs[pin].page.nav, undefined);
  assert.ok(S().tabs[warm].page.nav, "a pin left alone still warms up");
  assert.notEqual(S().tabs[warm].page.kind, "asleep");
});
