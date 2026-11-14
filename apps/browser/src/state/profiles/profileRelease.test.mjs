import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

globalThis.__DEV__ = false;
globalThis.loadedProfileTest = [];
globalThis.releaseProfileCalls = [];
const profiles = import.meta.resolve("../../platform/profiles.ts");
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "../../platform/profiles" && context.parentURL?.endsWith("/tabs/tabLifecycle.ts")) {
      const source = `export * from ${JSON.stringify(profiles)};
        export const loadedProfiles = async () => globalThis.loadedProfileTest;
        export const releaseProfile = async (profile) => {
          globalThis.releaseProfileCalls.push(profile);
          if (globalThis.releaseProfileCalls.length === 1) return {status: "busy"};
          globalThis.loadedProfileTest = [];
          return {status: "released"};
        };`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { startTabLifecycle } = await import("../tabs/tabLifecycle.ts");
const { slowTimersForTests } = await import("../../platform/slowTimers.ts");
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test("native-only profiles wait five continuous minutes and busy releases retry", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const state = () => useBrowser.getState();
  state().hydrate({});
  const work = state().createProfile({ name: "Work" });
  const window = state().createWindow({ profileId: "default" });
  globalThis.loadedProfileTest = [work];
  startTabLifecycle();
  const clock = slowTimersForTests(() => Date.now());
  try {
    await flush();
    t.mock.timers.tick(240_000);
    await flush();
    state().switchProfile(window, work);
    state().switchProfile(window, "default");
    t.mock.timers.tick(60_000);
    await flush();
    assert.deepEqual(globalThis.releaseProfileCalls, []);
    t.mock.timers.tick(240_000);
    await flush();
    assert.deepEqual(globalThis.releaseProfileCalls, [work]);
    t.mock.timers.tick(60_000);
    await flush();
    assert.deepEqual(globalThis.releaseProfileCalls, [work, work]);
    t.mock.timers.tick(600_000);
    await flush();
    assert.deepEqual(globalThis.releaseProfileCalls, [work, work]);
  } finally {
    clock.clear();
  }
});
